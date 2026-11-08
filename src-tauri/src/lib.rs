use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::env;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

#[derive(Default)]
struct TerminalState(Mutex<TerminalSessions>);

#[derive(Default)]
struct LocalHttpServerState(Mutex<HashMap<String, LocalHttpServer>>);

struct LocalHttpServer {
    root: PathBuf,
    port: u16,
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

#[derive(Default)]
struct TerminalSessions {
    active: HashMap<String, Arc<TerminalProcess>>,
    closed: VecDeque<String>,
}

struct TerminalProcess {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
}

#[derive(Serialize, Clone)]
struct TerminalOutput {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct LocalServerInfo {
    root: String,
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubChange {
    path: String,
    status: String,
    staged: bool,
    unstaged: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubStatus {
    platform: String,
    git_installed: bool,
    gh_installed: bool,
    authenticated: bool,
    is_repo: bool,
    is_github_repo: bool,
    branch: Option<String>,
    branches: Vec<String>,
    remote: Option<String>,
    repo_url: Option<String>,
    ahead: usize,
    behind: usize,
    changes: Vec<GithubChange>,
    user_name: String,
    user_email: String,
}

impl Drop for LocalHttpServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

impl Drop for LocalHttpServerState {
    fn drop(&mut self) {
        if let Ok(servers) = self.0.get_mut() {
            servers.clear();
        }
    }
}

impl Drop for TerminalState {
    fn drop(&mut self) {
        let Ok(sessions) = self.0.get_mut() else {
            return;
        };
        for process in sessions.active.values() {
            if let Ok(mut child) = process.child.lock() {
                if child.try_wait().ok().flatten().is_none() {
                    let _ = child.kill();
                }
                let _ = child.wait();
            }
        }
    }
}

#[tauri::command]
fn terminal_spawn(
    app: tauri::AppHandle,
    state: State<'_, TerminalState>,
    id: String,
    cwd: Option<String>,
    command: Option<String>,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|error| error.to_string())?;
    if sessions.closed.iter().any(|closed| closed == &id) {
        return Err("Terminal session is closed".to_string());
    }
    if sessions.active.contains_key(&id) {
        return Ok(());
    }

    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    let shell = env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
    #[cfg(not(target_os = "windows"))]
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let mut command_builder = CommandBuilder::new(&shell);
    #[cfg(target_os = "windows")]
    command_builder.arg("/Q");
    #[cfg(not(target_os = "windows"))]
    command_builder.arg("-i");
    command_builder.env("TERM", "xterm-256color");
    command_builder.env("COLORTERM", "truecolor");
    if let Some(directory) = cwd.filter(|path| !path.is_empty()) {
        command_builder.cwd(directory);
    }
    let child = pair
        .slave
        .spawn_command(command_builder)
        .map_err(|error| error.to_string())?;
    drop(pair.slave);
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let process = Arc::new(TerminalProcess {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
    });
    sessions.active.insert(id.clone(), process);
    if let Some(command) = command.filter(|command| !command.trim().is_empty()) {
        let process = sessions
            .active
            .get(&id)
            .expect("terminal process was inserted");
        let mut writer = process.writer.lock().map_err(|error| error.to_string())?;
        writer
            .write_all(format!("{}\r", command.trim()).as_bytes())
            .map_err(|error| error.to_string())?;
    }

    std::thread::spawn(move || read_terminal_output(app, id, reader));
    Ok(())
}

fn read_terminal_output(app: tauri::AppHandle, id: String, mut reader: Box<dyn Read + Send>) {
    let (sender, receiver) = sync_channel::<Vec<u8>>(4);
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(length) => {
                    if sender.send(buffer[..length].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    let mut pending = Vec::with_capacity(32 * 1024);
    loop {
        match receiver.recv_timeout(Duration::from_millis(8)) {
            Ok(chunk) => {
                pending.extend_from_slice(&chunk);
                if pending.len() >= 32 * 1024 && !emit_terminal_output(&app, &id, &mut pending) {
                    break;
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if !emit_terminal_output(&app, &id, &mut pending) {
                    break;
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                emit_terminal_output(&app, &id, &mut pending);
                break;
            }
        }
    }

    if let Some(state) = app.try_state::<TerminalState>() {
        let process = state
            .0
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.active.remove(&id));
        if let Some(process) = process {
            if let Ok(mut child) = process.child.lock() {
                if child.try_wait().ok().flatten().is_none() {
                    let _ = child.kill();
                }
                let _ = child.wait();
            }
        }
    }
}

fn emit_terminal_output(app: &tauri::AppHandle, id: &str, pending: &mut Vec<u8>) -> bool {
    if pending.is_empty() {
        return true;
    }
    let data = String::from_utf8_lossy(pending).into_owned();
    pending.clear();
    app.emit(
        "terminal-output",
        TerminalOutput {
            id: id.to_string(),
            data,
        },
    )
    .is_ok()
}

#[tauri::command]
fn terminal_write(state: State<'_, TerminalState>, id: String, data: String) -> Result<(), String> {
    let process = state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .active
        .get(&id)
        .cloned()
        .ok_or_else(|| "Terminal session not found".to_string())?;
    let mut writer = process.writer.lock().map_err(|error| error.to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_resize(
    state: State<'_, TerminalState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let process = state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .active
        .get(&id)
        .cloned()
        .ok_or_else(|| "Terminal session not found".to_string())?;
    let master = process.master.lock().map_err(|error| error.to_string())?;
    master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_close(state: State<'_, TerminalState>, id: String) -> Result<(), String> {
    let process = {
        let mut sessions = state.0.lock().map_err(|error| error.to_string())?;
        if !sessions.closed.iter().any(|closed| closed == &id) {
            sessions.closed.push_back(id.clone());
            if sessions.closed.len() > 128 {
                sessions.closed.pop_front();
            }
        }
        sessions.active.remove(&id)
    };
    if let Some(process) = process {
        if let Ok(mut child) = process.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    Ok(())
}

#[tauri::command]
async fn workspace_pick(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dialog = app.dialog().file().set_title("Open workspace");
    let folder = if let Some(window) = app.get_webview_window("main") {
        dialog.set_parent(&window).blocking_pick_folder()
    } else {
        dialog.blocking_pick_folder()
    };
    folder
        .map(|folder| {
            folder
                .into_path()
                .map(|path| path.to_string_lossy().into_owned())
                .map_err(|error| error.to_string())
        })
        .transpose()
}

#[tauri::command]
fn workspace_access_allowed(app: tauri::AppHandle, root: String) -> Result<bool, String> {
    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Could not access folder: {error}"))?;
    Ok(app.fs_scope().is_allowed(root))
}

#[tauri::command]
fn workspace_grant_access(app: tauri::AppHandle, root: String) -> Result<(), String> {
    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Could not access folder: {error}"))?;
    if !root.is_dir() {
        return Err("Workspace path is not a folder.".to_string());
    }
    app.fs_scope()
        .allow_directory(root, true)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn workspace_allow_hidden_path(
    app: tauri::AppHandle,
    root: String,
    path: String,
    directory: bool,
) -> Result<(), String> {
    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Could not access workspace: {error}"))?;
    let path = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("Could not access hidden path: {error}"))?;
    if !path.starts_with(&root) {
        return Err("Hidden path is outside the workspace.".to_string());
    }
    let scope = app.fs_scope();
    if directory {
        scope
            .allow_directory(path, true)
            .map_err(|error| error.to_string())
    } else {
        scope.allow_file(path).map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn plugin_process_is_running(names: Vec<String>) -> Result<bool, String> {
    if names.is_empty()
        || names.iter().any(|name| {
            name.is_empty()
                || name.contains('/')
                || name.contains('\\')
                || name.chars().any(char::is_whitespace)
        })
    {
        return Err("Process names must be non-empty executable names.".to_string());
    }
    #[cfg(target_os = "linux")]
    {
        let processes = fs::read_dir("/proc")
            .map_err(|error| format!("Could not inspect running processes: {error}"))?;
        for process in processes.flatten() {
            if !process
                .file_name()
                .to_string_lossy()
                .chars()
                .all(|character| character.is_ascii_digit())
            {
                continue;
            }
            let command_line = fs::read(process.path().join("cmdline")).unwrap_or_default();
            let matches = command_line
                .split(|byte| *byte == 0)
                .filter_map(|argument| std::str::from_utf8(argument).ok())
                .filter_map(|argument| Path::new(argument).file_name())
                .any(|name| {
                    names
                        .iter()
                        .any(|candidate| name.to_string_lossy() == candidate.as_str())
                });
            if matches {
                return Ok(true);
            }
        }
        Ok(false)
    }
    #[cfg(not(target_os = "linux"))]
    {
        Ok(false)
    }
}

fn gh_command() -> Command {
    Command::new("gh")
}

fn git_output(root: &Path, args: &[&str]) -> Result<Output, String> {
    Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))
}

fn output_message(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => "Command failed.".to_string(),
        (false, true) => stdout,
        (true, false) => stderr,
        (false, false) => format!("{stdout}\n{stderr}"),
    }
}

fn require_success(output: Output) -> Result<Output, String> {
    if output.status.success() {
        Ok(output)
    } else {
        Err(output_message(&output))
    }
}

fn resolve_git_root(root: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not access workspace: {error}"))?;
    let output = git_output(&root, &["rev-parse", "--show-toplevel"])?;
    if !output.status.success() {
        return Err("This folder is not inside a Git repository.".to_string());
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("Could not access Git repository: {error}"))
}

fn git_config_value(root: &Path, key: &str) -> String {
    git_output(root, &["config", "--get", key])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default()
}

fn remote_url(root: &Path, remote: &str) -> Option<String> {
    git_output(root, &["remote", "get-url", remote])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn github_web_url(remote: &str) -> Option<String> {
    let value = if let Some(path) = remote.strip_prefix("git@github.com:") {
        format!("https://github.com/{path}")
    } else if let Some(path) = remote.strip_prefix("ssh://git@github.com/") {
        format!("https://github.com/{path}")
    } else if remote.starts_with("https://github.com/") || remote.starts_with("http://github.com/")
    {
        remote.to_string()
    } else {
        return None;
    };
    Some(
        value
            .trim_end_matches('/')
            .trim_end_matches(".git")
            .to_string(),
    )
}

fn list_remotes(root: &Path) -> Vec<String> {
    git_output(root, &["remote"])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn github_remote_name(root: &Path) -> Option<String> {
    let remotes = list_remotes(root);
    remotes
        .iter()
        .find(|remote| {
            remote_url(root, remote)
                .and_then(|url| github_web_url(&url))
                .is_some()
        })
        .cloned()
        .or_else(|| {
            remotes
                .iter()
                .find(|remote| remote.as_str() == "origin")
                .cloned()
        })
        .or_else(|| remotes.first().cloned())
}

fn describe_change(path: String, index: char, worktree: char) -> GithubChange {
    let code = [index, worktree];
    let status = if code == ['?', '?'] {
        "Untracked"
    } else if code.contains(&'R') {
        "Renamed"
    } else if code.contains(&'C') {
        "Copied"
    } else if code.contains(&'D') {
        "Deleted"
    } else if code.contains(&'A') {
        "Added"
    } else if code.contains(&'U') {
        "Conflict"
    } else {
        "Modified"
    };
    GithubChange {
        path,
        status: status.to_string(),
        staged: index != ' ' && index != '?',
        unstaged: worktree != ' ',
    }
}

fn parse_changes(data: &[u8]) -> Vec<GithubChange> {
    let records = String::from_utf8_lossy(data);
    let mut entries = records.split('\0').filter(|entry| !entry.is_empty());
    let mut changes = Vec::new();
    while let Some(record) = entries.next() {
        let bytes = record.as_bytes();
        if bytes.len() < 4 {
            continue;
        }
        let index = bytes[0] as char;
        let worktree = bytes[1] as char;
        let path = String::from_utf8_lossy(&bytes[3..]).into_owned();
        changes.push(describe_change(path, index, worktree));
        if index == 'R' || index == 'C' || worktree == 'R' || worktree == 'C' {
            entries.next();
        }
    }
    changes
}

#[tauri::command]
fn github_status(root: String) -> Result<GithubStatus, String> {
    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Could not access workspace: {error}"))?;
    let git_installed = Command::new("git")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    let gh_installed = gh_command()
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    let authenticated = if gh_installed {
        gh_command()
            .args(["auth", "status"])
            .current_dir(&root)
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    } else {
        false
    };
    let mut status = GithubStatus {
        platform: env::consts::OS.to_string(),
        git_installed,
        gh_installed,
        authenticated,
        is_repo: false,
        is_github_repo: false,
        branch: None,
        branches: Vec::new(),
        remote: None,
        repo_url: None,
        ahead: 0,
        behind: 0,
        changes: Vec::new(),
        user_name: String::new(),
        user_email: String::new(),
    };
    if !git_installed {
        return Ok(status);
    }
    status.user_name = git_config_value(&root, "user.name");
    status.user_email = git_config_value(&root, "user.email");
    let Ok(repo_root) = resolve_git_root(&root) else {
        return Ok(status);
    };
    status.is_repo = true;
    status.user_name = git_config_value(&repo_root, "user.name");
    status.user_email = git_config_value(&repo_root, "user.email");
    status.branch = git_output(&repo_root, &["branch", "--show-current"])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|branch| !branch.is_empty());
    status.branches = git_output(&repo_root, &["branch", "--format=%(refname:short)"])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|branch| !branch.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    status.changes = git_output(
        &repo_root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )
    .ok()
    .filter(|output| output.status.success())
    .map(|output| parse_changes(&output.stdout))
    .unwrap_or_default();
    let remotes = list_remotes(&repo_root);
    status.is_github_repo = remotes.iter().any(|remote| {
        remote_url(&repo_root, remote)
            .and_then(|url| github_web_url(&url))
            .is_some()
    });
    status.remote = github_remote_name(&repo_root);
    status.repo_url = status
        .remote
        .as_ref()
        .and_then(|remote| remote_url(&repo_root, remote).and_then(|url| github_web_url(&url)));
    if let (Some(remote), Some(branch)) = (status.remote.as_ref(), status.branch.as_ref()) {
        let tracking_ref = format!("{remote}/{branch}");
        if let Ok(output) = git_output(
            &repo_root,
            &[
                "rev-list",
                "--left-right",
                "--count",
                &format!("{tracking_ref}...HEAD"),
            ],
        ) {
            if output.status.success() {
                let counts: Vec<usize> = String::from_utf8_lossy(&output.stdout)
                    .split_whitespace()
                    .filter_map(|count| count.parse().ok())
                    .collect();
                if counts.len() == 2 {
                    status.behind = counts[0];
                    status.ahead = counts[1];
                }
            }
        }
    }
    Ok(status)
}

#[tauri::command]
fn github_configure_identity(name: String, email: String) -> Result<(), String> {
    let name = name.trim();
    let email = email.trim();
    if name.is_empty() || email.is_empty() {
        return Err("Enter both your Git name and email.".to_string());
    }
    require_success(
        Command::new("git")
            .args(["config", "--global", "user.name", name])
            .output()
            .map_err(|error| format!("Could not run Git: {error}"))?,
    )?;
    require_success(
        Command::new("git")
            .args(["config", "--global", "user.email", email])
            .output()
            .map_err(|error| format!("Could not run Git: {error}"))?,
    )?;
    Ok(())
}

#[tauri::command]
fn github_stage(root: String, path: String, stage: bool) -> Result<(), String> {
    let root = resolve_git_root(Path::new(&root))?;
    let output = if stage {
        Command::new("git")
            .args(["add", "--"])
            .arg(path)
            .current_dir(root)
            .output()
    } else {
        Command::new("git")
            .args(["reset", "--"])
            .arg(path)
            .current_dir(root)
            .output()
    }
    .map_err(|error| format!("Could not run Git: {error}"))?;
    require_success(output)?;
    Ok(())
}

#[tauri::command]
fn github_commit(root: String, message: String) -> Result<(), String> {
    let root = resolve_git_root(Path::new(&root))?;
    let message = message.trim();
    if message.is_empty() {
        return Err("Enter a commit message.".to_string());
    }
    let output = Command::new("git")
        .args(["commit", "-m", message])
        .current_dir(root)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    require_success(output)?;
    Ok(())
}

#[tauri::command]
fn github_fetch(root: String) -> Result<(), String> {
    let root = resolve_git_root(Path::new(&root))?;
    let remote = github_remote_name(&root)
        .ok_or_else(|| "Add a GitHub remote before checking for updates.".to_string())?;
    let output = Command::new("git")
        .args(["fetch", &remote])
        .current_dir(root)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    require_success(output)?;
    Ok(())
}

#[tauri::command]
fn github_pull(root: String) -> Result<(), String> {
    let root = resolve_git_root(Path::new(&root))?;
    let remote = github_remote_name(&root)
        .ok_or_else(|| "Add a GitHub remote before pulling.".to_string())?;
    let branch = git_output(&root, &["branch", "--show-current"])?;
    let branch = String::from_utf8_lossy(&branch.stdout).trim().to_string();
    if branch.is_empty() {
        return Err("Create or switch to a branch before pulling.".to_string());
    }
    let output = Command::new("git")
        .args(["pull", "--rebase", &remote, &branch])
        .current_dir(root)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    require_success(output)?;
    Ok(())
}

#[tauri::command]
fn github_push(root: String) -> Result<(), String> {
    let root = resolve_git_root(Path::new(&root))?;
    let remote = github_remote_name(&root)
        .ok_or_else(|| "Add a GitHub remote before pushing.".to_string())?;
    let branch = git_output(&root, &["branch", "--show-current"])?;
    let branch = String::from_utf8_lossy(&branch.stdout).trim().to_string();
    if branch.is_empty() {
        return Err("Create or switch to a branch before pushing.".to_string());
    }
    let output = Command::new("git")
        .args(["push", "--set-upstream", &remote, &branch])
        .current_dir(root)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    require_success(output)?;
    Ok(())
}

#[tauri::command]
fn github_switch_branch(root: String, branch: String) -> Result<(), String> {
    let root = resolve_git_root(Path::new(&root))?;
    let output = Command::new("git")
        .args(["switch", &branch])
        .current_dir(root)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    require_success(output)?;
    Ok(())
}

#[tauri::command]
fn github_create_branch(root: String, branch: String) -> Result<(), String> {
    let root = resolve_git_root(Path::new(&root))?;
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("Enter a branch name.".to_string());
    }
    require_success(
        Command::new("git")
            .args(["check-ref-format", "--branch", branch])
            .current_dir(&root)
            .output()
            .map_err(|error| format!("Could not run Git: {error}"))?,
    )?;
    let output = Command::new("git")
        .args(["switch", "-c", branch])
        .current_dir(root)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    require_success(output)?;
    Ok(())
}

#[tauri::command]
fn github_create_repo(root: String, name: String, visibility: String) -> Result<(), String> {
    if visibility != "public" && visibility != "private" {
        return Err("Choose public or private visibility.".to_string());
    }
    let name = name.trim();
    if name.is_empty() {
        return Err("Enter a repository name.".to_string());
    }
    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Could not access workspace: {error}"))?;
    let auth = gh_command()
        .args(["auth", "status"])
        .current_dir(&root)
        .output()
        .map_err(|error| format!("GitHub CLI is not installed: {error}"))?;
    if !auth.status.success() {
        return Err("Sign in to GitHub before creating a repository.".to_string());
    }
    let existing_root = git_output(&root, &["rev-parse", "--show-toplevel"])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| PathBuf::from(String::from_utf8_lossy(&output.stdout).trim()).canonicalize())
        .transpose()
        .map_err(|error| format!("Could not access Git repository: {error}"))?;
    let repo_root = if let Some(repo_root) = existing_root {
        repo_root
    } else {
        let init = Command::new("git")
            .args(["init", "--initial-branch=main"])
            .current_dir(&root)
            .output()
            .map_err(|error| format!("Could not run Git: {error}"))?;
        if !init.status.success() {
            let fallback = Command::new("git")
                .arg("init")
                .current_dir(&root)
                .output()
                .map_err(|error| format!("Could not run Git: {error}"))?;
            require_success(fallback)?;
            let _ = git_output(&root, &["branch", "-M", "main"]);
        }
        root
    };
    let remotes = list_remotes(&repo_root);
    let remote = if remotes.iter().any(|remote| remote == "origin") {
        let mut candidate = "github".to_string();
        let mut suffix = 2;
        while remotes.contains(&candidate) {
            candidate = format!("github-{suffix}");
            suffix += 1;
        }
        candidate
    } else {
        "origin".to_string()
    };
    let visibility_flag = format!("--{visibility}");
    let create = gh_command()
        .args(["repo", "create", name, "--source"])
        .arg(&repo_root)
        .args(["--remote", &remote, &visibility_flag])
        .current_dir(&repo_root)
        .output()
        .map_err(|error| format!("Could not run GitHub CLI: {error}"))?;
    require_success(create)?;
    let has_commit = git_output(&repo_root, &["rev-parse", "--verify", "HEAD"])
        .map(|output| output.status.success())
        .unwrap_or(false);
    if has_commit {
        let branch = git_output(&repo_root, &["branch", "--show-current"])?;
        let branch = String::from_utf8_lossy(&branch.stdout).trim().to_string();
        if !branch.is_empty() {
            let push = Command::new("git")
                .args(["push", "--set-upstream", &remote, &branch])
                .current_dir(&repo_root)
                .output()
                .map_err(|error| format!("Repository created, but push failed: {error}"))?;
            if !push.status.success() {
                return Err(format!(
                    "Repository created, but push failed: {}",
                    output_message(&push)
                ));
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn plugin_local_server_start(
    app: tauri::AppHandle,
    state: State<'_, LocalHttpServerState>,
    plugin_id: String,
    root: String,
    entry: String,
) -> Result<LocalServerInfo, String> {
    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Could not access local server folder: {error}"))?;
    if !root.is_dir() {
        return Err("Local server needs a folder.".to_string());
    }
    if !app.fs_scope().is_allowed(&root) {
        return Err("Plugin local server folder is outside approved workspace access.".to_string());
    }
    if entry.contains('\\')
        || Path::new(&entry)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Invalid local server entry path.".to_string());
    }

    let mut active = state.0.lock().map_err(|error| error.to_string())?;
    if let Some(server) = active.get(&plugin_id).filter(|server| server.root == root) {
        return Ok(local_server_info(&server.root, server.port, &entry));
    }
    drop(active.remove(&plugin_id));

    let server = create_local_http_server(root)?;
    let info = local_server_info(&server.root, server.port, &entry);
    active.insert(plugin_id, server);
    Ok(info)
}

#[tauri::command]
fn plugin_local_server_stop(
    state: State<'_, LocalHttpServerState>,
    plugin_id: String,
) -> Result<bool, String> {
    let server = state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&plugin_id);
    let was_running = server.is_some();
    drop(server);
    Ok(was_running)
}

fn local_server_info(root: &Path, port: u16, entry: &str) -> LocalServerInfo {
    let encoded_entry = encode_url_path(entry);
    let path = if encoded_entry.is_empty() {
        "/".to_string()
    } else {
        format!("/{encoded_entry}")
    };
    LocalServerInfo {
        root: root.to_string_lossy().into_owned(),
        url: format!("http://127.0.0.1:{port}{path}"),
    }
}

fn create_local_http_server(root: PathBuf) -> Result<LocalHttpServer, String> {
    let listener = TcpListener::bind(("127.0.0.1", 5500))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
        .map_err(|error| format!("Could not start local server: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not read local server address: {error}"))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Could not configure local server: {error}"))?;

    let stop = Arc::new(AtomicBool::new(false));
    let generation = Arc::new(AtomicU64::new(local_file_signature(&root)));
    let server_stop = Arc::clone(&stop);
    let server_generation = Arc::clone(&generation);
    let server_root = root.clone();
    let server_thread = thread::spawn(move || {
        while !server_stop.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let request_root = server_root.clone();
                    let request_generation = Arc::clone(&server_generation);
                    thread::spawn(move || {
                        handle_local_request(stream, &request_root, &request_generation);
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(40));
                }
                Err(_) => break,
            }
        }
    });

    let watch_stop = Arc::clone(&stop);
    let watch_generation = Arc::clone(&generation);
    let watch_root = root.clone();
    let watcher_thread = thread::spawn(move || {
        let mut previous = watch_generation.load(Ordering::Relaxed);
        while !watch_stop.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(700));
            if watch_stop.load(Ordering::Relaxed) {
                break;
            }
            let current = local_file_signature(&watch_root);
            if current != previous {
                watch_generation.store(current, Ordering::Relaxed);
                previous = current;
            }
        }
    });

    Ok(LocalHttpServer {
        root,
        port,
        stop,
        threads: vec![server_thread, watcher_thread],
    })
}

fn handle_local_request(mut stream: TcpStream, root: &Path, generation: &AtomicU64) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut request = Vec::with_capacity(1024);
    let mut buffer = [0_u8; 1024];
    while request.len() < 16 * 1024 && !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(length) => request.extend_from_slice(&buffer[..length]),
        }
    }
    let header_end = request
        .windows(4)
        .position(|bytes| bytes == b"\r\n\r\n")
        .unwrap_or(request.len());
    let request_line = String::from_utf8_lossy(&request[..header_end]);
    let Some(mut parts) = request_line.lines().next().map(str::split_whitespace) else {
        respond_live_request(
            &mut stream,
            "400 Bad Request",
            "text/plain",
            b"Bad request",
            false,
        );
        return;
    };
    let method = parts.next().unwrap_or("");
    let Some(raw_path) = parts.next() else {
        respond_live_request(
            &mut stream,
            "400 Bad Request",
            "text/plain",
            b"Bad request",
            false,
        );
        return;
    };
    let is_head = method == "HEAD";
    if method != "GET" && !is_head {
        respond_live_request(
            &mut stream,
            "405 Method Not Allowed",
            "text/plain",
            b"Method not allowed",
            false,
        );
        return;
    }

    let raw_path = raw_path.split(['?', '#']).next().unwrap_or("/");
    let Some(relative) = decode_url_path(raw_path) else {
        respond_live_request(
            &mut stream,
            "400 Bad Request",
            "text/plain",
            b"Invalid path",
            is_head,
        );
        return;
    };
    if relative == "__glasswing_live_reload" {
        let body = generation.load(Ordering::Relaxed).to_string();
        respond_live_request(
            &mut stream,
            "200 OK",
            "text/plain; charset=utf-8",
            body.as_bytes(),
            is_head,
        );
        return;
    }

    let relative_path = Path::new(&relative);
    if relative_path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        respond_live_request(
            &mut stream,
            "403 Forbidden",
            "text/plain",
            b"Forbidden",
            is_head,
        );
        return;
    }
    let requested = root.join(relative_path);
    let Ok(mut path) = requested.canonicalize() else {
        respond_live_request(
            &mut stream,
            "404 Not Found",
            "text/plain",
            b"Not found",
            is_head,
        );
        return;
    };
    if !path.starts_with(root) {
        respond_live_request(
            &mut stream,
            "403 Forbidden",
            "text/plain",
            b"Forbidden",
            is_head,
        );
        return;
    }

    if path.is_dir() {
        if let Some(index) = ["index.html", "index.htm"]
            .iter()
            .map(|name| path.join(name))
            .find(|candidate| candidate.is_file())
        {
            path = match index.canonicalize() {
                Ok(index) if index.starts_with(root) => index,
                _ => {
                    respond_live_request(
                        &mut stream,
                        "403 Forbidden",
                        "text/plain",
                        b"Forbidden",
                        is_head,
                    );
                    return;
                }
            };
        } else {
            let body = directory_listing(root, &path);
            respond_live_request(
                &mut stream,
                "200 OK",
                "text/html; charset=utf-8",
                body.as_bytes(),
                is_head,
            );
            return;
        }
    }

    let Ok(mut body) = fs::read(&path) else {
        respond_live_request(
            &mut stream,
            "404 Not Found",
            "text/plain",
            b"Not found",
            is_head,
        );
        return;
    };
    let content_type = mime_type(&path);
    if content_type == "text/html; charset=utf-8" {
        body = inject_live_reload(body);
    }
    respond_live_request(&mut stream, "200 OK", content_type, &body, is_head);
}

fn respond_live_request(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    is_head: bool,
) {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    );
    if stream.write_all(header.as_bytes()).is_ok() && !is_head {
        let _ = stream.write_all(body);
    }
}

fn decode_url_path(path: &str) -> Option<String> {
    let mut decoded = Vec::with_capacity(path.len());
    let bytes = path.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = *bytes.get(index + 1)?;
            let low = *bytes.get(index + 2)?;
            decoded.push((hex_value(high)? << 4) | hex_value(low)?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    let decoded = String::from_utf8(decoded).ok()?;
    Some(decoded.trim_start_matches('/').to_string())
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn encode_url_path(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len());
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'/') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "txt" => "text/plain; charset=utf-8",
        "md" => "text/markdown; charset=utf-8",
        "wasm" => "application/wasm",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn inject_live_reload(body: Vec<u8>) -> Vec<u8> {
    let mut html = String::from_utf8_lossy(&body).into_owned();
    let script = "<script>(()=>{let last='';const poll=async()=>{try{const response=await fetch('/__glasswing_live_reload',{cache:'no-store'});const next=await response.text();if(last&&next!==last)location.reload();last=next}catch{}setTimeout(poll,1000)};poll()})()</script>";
    if let Some(position) = html.rfind("</body>") {
        html.insert_str(position, script);
    } else {
        html.push_str(script);
    }
    html.into_bytes()
}

fn directory_listing(root: &Path, directory: &Path) -> String {
    let mut entries = fs::read_dir(directory)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if file_type.is_symlink() {
                return None;
            }
            Some((
                entry.file_name().to_string_lossy().into_owned(),
                file_type.is_dir(),
            ))
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.0.to_lowercase().cmp(&right.0.to_lowercase()));
    let relative = directory.strip_prefix(root).unwrap_or(Path::new(""));
    let parent = if relative.as_os_str().is_empty() {
        String::new()
    } else {
        "<li><a href='../'>..</a></li>".to_string()
    };
    let rows = entries
        .into_iter()
        .map(|(name, is_directory)| {
            let suffix = if is_directory { "/" } else { "" };
            let relative_url = relative.to_string_lossy().replace('\\', "/");
            let prefix = if relative_url.is_empty() {
                String::new()
            } else {
                format!("{}/", encode_url_path(&relative_url))
            };
            let href = format!("/{prefix}{}{suffix}", encode_url_path(&name));
            format!(
                "<li><a href=\"{href}\">{}{suffix}</a></li>",
                html_escape(&name)
            )
        })
        .collect::<String>();
    let title = if relative.is_empty() {
        "/"
    } else {
        relative.to_str().unwrap_or("/")
    };
    format!("<!doctype html><meta charset='utf-8'><title>Index of {}</title><h1>Index of {}</h1><ul>{parent}{rows}</ul>", html_escape(title), html_escape(title))
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn local_file_signature(root: &Path) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let mut pending = vec![root.to_path_buf()];
    let mut count = 0;
    while let Some(directory) = pending.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let name = entry.file_name();
            if file_type.is_dir() {
                if matches!(
                    name.to_str(),
                    Some("node_modules" | ".git" | "target" | ".next" | ".cache")
                ) {
                    continue;
                }
                pending.push(path.clone());
            }
            path.strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .hash(&mut hasher);
            if let Ok(metadata) = entry.metadata() {
                metadata.len().hash(&mut hasher);
                metadata
                    .modified()
                    .unwrap_or(SystemTime::UNIX_EPOCH)
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
                    .hash(&mut hasher);
            }
            count += 1;
            if count >= 20_000 {
                return hasher.finish();
            }
        }
    }
    hasher.finish()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalState::default())
        .manage(LocalHttpServerState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            workspace_pick,
            workspace_access_allowed,
            workspace_grant_access,
            workspace_allow_hidden_path,
            plugin_process_is_running,
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_close,
            github_status,
            github_configure_identity,
            github_stage,
            github_commit,
            github_fetch,
            github_pull,
            github_push,
            github_switch_branch,
            github_create_branch,
            github_create_repo,
            plugin_local_server_start,
            plugin_local_server_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running Glasswing");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(port: u16, path: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    #[test]
    fn parses_git_status_and_github_remote_urls() {
        let changes = parse_changes(b" M work.txt\0A  staged.txt\0?? new.txt\0");
        assert_eq!(changes.len(), 3);
        assert_eq!(changes[0].path, "work.txt");
        assert!(changes[0].unstaged);
        assert!(!changes[0].staged);
        assert_eq!(changes[1].status, "Added");
        assert!(changes[1].staged);
        assert_eq!(changes[2].status, "Untracked");

        assert_eq!(
            github_web_url("git@github.com:owner/project.git").as_deref(),
            Some("https://github.com/owner/project")
        );
        assert_eq!(
            github_web_url("https://github.com/owner/project.git").as_deref(),
            Some("https://github.com/owner/project")
        );
        assert_eq!(github_web_url("https://gitlab.com/owner/project"), None);
    }

    #[test]
    fn local_server_serves_files_blocks_traversal_and_reloads() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("glasswing-local-server-{suffix}"));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("index.html"), "<!doctype html><body>hello</body>").unwrap();
        let server = create_local_http_server(root.clone()).unwrap();

        let page = request(server.port, "/");
        assert!(page.starts_with("HTTP/1.1 200 OK"));
        assert!(page.contains("hello"));
        assert!(page.contains("__glasswing_live_reload"));
        assert!(request(server.port, "/..%2Fsecret").starts_with("HTTP/1.1 403 Forbidden"));

        let before = request(server.port, "/__glasswing_live_reload")
            .split("\r\n\r\n")
            .nth(1)
            .unwrap()
            .to_string();
        fs::write(root.join("style.css"), "body { color: red; }").unwrap();
        thread::sleep(Duration::from_millis(900));
        let after = request(server.port, "/__glasswing_live_reload")
            .split("\r\n\r\n")
            .nth(1)
            .unwrap()
            .to_string();
        assert_ne!(before, after);

        drop(server);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn local_server_encodes_file_urls() {
        assert_eq!(
            encode_url_path("folder/a file.html"),
            "folder/a%20file.html"
        );
        assert_eq!(
            decode_url_path("/folder/a%20file.html").as_deref(),
            Some("folder/a file.html")
        );
    }
}
