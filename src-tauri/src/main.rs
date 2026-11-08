#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Avoid WebKitGTK/NVIDIA Wayland explicit-sync failures; honor explicit user overrides.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        let nvidia_loaded = std::path::Path::new("/sys/module/nvidia").exists();
        if nvidia_loaded && std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none() {
            std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
        }
    }

    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    migrate_app_data();

    arc_lib::run();
}

#[cfg(target_os = "linux")]
fn app_data_root() -> Option<std::path::PathBuf> {
    use std::path::PathBuf;

    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
}

#[cfg(target_os = "macos")]
fn app_data_root() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .map(|home| std::path::PathBuf::from(home).join("Library/Application Support"))
}

#[cfg(target_os = "windows")]
fn app_data_root() -> Option<std::path::PathBuf> {
    std::env::var_os("APPDATA").map(std::path::PathBuf::from)
}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
fn migrate_app_data() {
    let Some(data_dir) = app_data_root() else {
        return;
    };
    let old = data_dir.join("dev.glasswing.ide");
    let new = data_dir.join("dev.arc.ide");

    if old.is_dir() && !new.exists() {
        let _ = std::fs::rename(old, new);
    }
}
