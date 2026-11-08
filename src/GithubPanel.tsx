import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDownToLine, ArrowUpFromLine, Check, Circle, ExternalLink, GitBranch, Github,
  LoaderCircle, Plus, RefreshCw, Upload,
} from "lucide-react";
import "./GithubPanel.css";

type GithubChange = {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
};

type GithubStatus = {
  gitInstalled: boolean;
  ghInstalled: boolean;
  authenticated: boolean;
  isRepo: boolean;
  isGithubRepo: boolean;
  branch: string | null;
  branches: string[];
  remote: string | null;
  repoUrl: string | null;
  ahead: number;
  behind: number;
  changes: GithubChange[];
  userName: string;
  userEmail: string;
};

export default function GithubPanel({ workspace, onLogin }: { workspace: string; onLogin: () => void }) {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [repoName, setRepoName] = useState(workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? "my-project");
  const [visibility, setVisibility] = useState("private");
  const [gitName, setGitName] = useState("");
  const [gitEmail, setGitEmail] = useState("");
  const [branchName, setBranchName] = useState("");
  const [commitMessage, setCommitMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setError("GitHub tools are available in Glasswing desktop.");
      setLoading(false);
      return;
    }
    setError("");
    try {
      const next = await invoke<GithubStatus>("github_status", { root: workspace });
      setStatus(next);
      setGitName((value) => value || next.userName);
      setGitEmail((value) => value || next.userEmail);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    setRepoName(workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? "my-project");
    void refresh();
  }, [refresh, workspace]);

  const perform = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (success) setNotice(success);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const stageAll = async () => {
    if (!status) return;
    const shouldStage = status.changes.some((change) => !change.staged);
    await perform(async () => {
      for (const change of status.changes) {
        if (!shouldStage && !change.staged) continue;
        await invoke("github_stage", { root: workspace, path: change.path, stage: shouldStage });
      }
    });
  };

  const openLink = async (url: string) => {
    try {
      await openUrl(url);
    } catch (cause) {
      setError(`Could not open browser: ${String(cause)}`);
    }
  };

  if (loading) return <div className="github-panel"><div className="github-loading"><LoaderCircle size={17} className="github-spin" /> Checking GitHub setup…</div></div>;

  return <div className="github-panel">
    <header className="github-header">
      <div className="github-heading"><Github size={19} /><div><strong>GitHub</strong><span>{workspace.split(/[\\/]/).filter(Boolean).at(-1)}</span></div></div>
      <button className="github-icon-button" title="Refresh repository" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} /></button>
    </header>

    {error && <div className="github-feedback error">{error}</div>}
    {notice && <div className="github-feedback success">{notice}</div>}

    {!status?.gitInstalled ? <section className="github-setup-card">
      <h2>Install Git to continue</h2>
      <p>Git manages local changes and branches. Install Git, then refresh this panel.</p>
      <button className="github-primary" onClick={() => void openLink("https://git-scm.com/downloads")}><ExternalLink size={14} /> Get Git</button>
    </section> : !status.ghInstalled ? <section className="github-setup-card">
      <h2>Connect GitHub</h2>
      <p>Install GitHub CLI to sign in, publish repositories, and sync with GitHub.</p>
      <button className="github-primary" onClick={() => void openLink("https://cli.github.com")}><ExternalLink size={14} /> Install GitHub CLI</button>
    </section> : !status.authenticated ? <section className="github-setup-card">
      <div className="github-setup-icon"><Github size={24} /></div>
      <h2>Set up GitHub with Glasswing</h2>
      <p>Sign in once. Glasswing uses GitHub CLI for secure authentication and repository publishing.</p>
      <button className="github-primary" onClick={onLogin}><Github size={15} /> Sign in to GitHub</button>
      <span className="github-help">A terminal opens for GitHub’s browser sign-in flow. Return here and refresh when done.</span>
    </section> : !status.isGithubRepo ? <>
      {!status.userName || !status.userEmail ? <IdentitySetup
        name={gitName}
        email={gitEmail}
        disabled={busy}
        onName={setGitName}
        onEmail={setGitEmail}
        onSave={() => void perform(() => invoke("github_configure_identity", { name: gitName, email: gitEmail }), "Git identity saved.")}
      /> : null}
      <section className="github-setup-card publish-card">
        <div className="github-setup-icon"><Upload size={22} /></div>
        <h2>{status.isRepo ? "Publish this repository" : "Create a GitHub repository"}</h2>
        <p>{status.isRepo
          ? "This folder has Git history but no GitHub remote. Create a repository and connect it."
          : "Create a GitHub repository from this folder. Glasswing initializes Git when needed."}</p>
        <label className="github-field"><span>Repository name</span><input value={repoName} onChange={(event) => setRepoName(event.target.value)} placeholder="my-project" /></label>
        <label className="github-field"><span>Visibility</span><select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="private">Private</option><option value="public">Public</option></select></label>
        <button className="github-primary" disabled={busy || !repoName.trim()} onClick={() => void perform(
          () => invoke("github_create_repo", { root: workspace, name: repoName.trim(), visibility }),
          "GitHub repository created.",
        )}>{busy ? <LoaderCircle size={14} className="github-spin" /> : <Plus size={14} />} Create repository</button>
      </section>
    </> : <>
      <section className="github-repo-summary">
        <div className="github-repo-title"><div><span className="github-overline">CURRENT REPOSITORY</span><strong>{status.repoUrl?.replace("https://github.com/", "") ?? workspace.split(/[\\/]/).filter(Boolean).at(-1)}</strong></div>
          {status.repoUrl && <button className="github-icon-button" title="Open repository in browser" onClick={() => void openLink(status.repoUrl!)}><ExternalLink size={15} /></button>}
        </div>
        <div className="github-repo-meta"><GitBranch size={13} /> <span>{status.branch ?? "No branch"}</span><span className="github-meta-spacer" />
          {status.ahead > 0 && <span className="github-count"><ArrowUpFromLine size={12} /> {status.ahead}</span>}
          {status.behind > 0 && <span className="github-count"><ArrowDownToLine size={12} /> {status.behind}</span>}
          {status.ahead === 0 && status.behind === 0 && <span>Up to date</span>}
        </div>
      </section>

      {!status.userName || !status.userEmail ? <IdentitySetup
        name={gitName}
        email={gitEmail}
        disabled={busy}
        onName={setGitName}
        onEmail={setGitEmail}
        onSave={() => void perform(() => invoke("github_configure_identity", { name: gitName, email: gitEmail }), "Git identity saved.")}
      /> : null}

      <section className="github-section github-branch-row">
        <label className="github-field"><span>Current branch</span><select value={status.branch ?? ""} disabled={busy || !status.branches.length} onChange={(event) => void perform(() => invoke("github_switch_branch", { root: workspace, branch: event.target.value }))}>
          {!status.branch && <option value="">No branch</option>}
          {status.branches.map((branch) => <option value={branch} key={branch}>{branch}</option>)}
        </select></label>
        <div className="github-create-branch"><input value={branchName} onChange={(event) => setBranchName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void perform(async () => { await invoke("github_create_branch", { root: workspace, branch: branchName }); setBranchName(""); }); }} placeholder="New branch" aria-label="New branch name" />
          <button className="github-icon-button" title="Create and switch branch" disabled={busy || !branchName.trim()} onClick={() => void perform(async () => { await invoke("github_create_branch", { root: workspace, branch: branchName }); setBranchName(""); })}><Plus size={15} /></button></div>
      </section>

      <section className="github-section github-changes">
        <div className="github-section-heading"><strong>Changes</strong><span>{status.changes.length}</span>
          {status.changes.length > 0 && <button className="github-text-button" disabled={busy} onClick={() => void stageAll()}>{status.changes.every((change) => change.staged) ? "Unstage all" : "Stage all"}</button>}
        </div>
        {status.changes.length ? <div className="github-change-list">{status.changes.map((change) => <label className="github-change" key={change.path} title={change.path}>
          <input type="checkbox" checked={change.staged} disabled={busy} onChange={(event) => void perform(() => invoke("github_stage", { root: workspace, path: change.path, stage: event.target.checked }))} />
          <span className={`github-change-status ${change.status.toLowerCase()}`}>{change.status.slice(0, 1)}</span>
          <span className="github-change-path">{change.path}</span>
          <span className="github-change-kind">{change.staged && change.unstaged ? "Staged + modified" : change.status}</span>
        </label>)}</div> : <div className="github-empty-changes"><Check size={15} /> No local changes</div>}
      </section>

      <section className="github-commit-section">
        <textarea value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Summary (required)" rows={2} />
        <button className="github-primary github-commit-button" disabled={busy || !commitMessage.trim() || !status.changes.some((change) => change.staged) || !status.userName || !status.userEmail} onClick={() => void perform(async () => {
          await invoke("github_commit", { root: workspace, message: commitMessage });
          setCommitMessage("");
        }, "Changes committed.")}>{busy ? <LoaderCircle size={14} className="github-spin" /> : <Check size={14} />} Commit staged changes</button>
      </section>

      <section className="github-sync-row">
        <button className="github-secondary" disabled={busy || !status.remote} onClick={() => void perform(() => invoke("github_pull", { root: workspace }))}><ArrowDownToLine size={14} /> Pull</button>
        <button className="github-primary" disabled={busy || !status.remote || !status.branch} onClick={() => void perform(() => invoke("github_push", { root: workspace }))}><ArrowUpFromLine size={14} /> Push</button>
      </section>
      <div className="github-footer"><Circle size={8} fill="currentColor" /> Connected to GitHub{status.remote ? ` · ${status.remote}` : ""}</div>
    </>}
  </div>;
}

function IdentitySetup({ name, email, disabled, onName, onEmail, onSave }: {
  name: string;
  email: string;
  disabled: boolean;
  onName: (value: string) => void;
  onEmail: (value: string) => void;
  onSave: () => void;
}) {
  return <section className="github-identity-card">
    <strong>Set up commit identity</strong>
    <span>Git uses this name and email on your commits. Glasswing saves them to your global Git config.</span>
    <input value={name} onChange={(event) => onName(event.target.value)} placeholder="Your name" aria-label="Git name" />
    <input value={email} onChange={(event) => onEmail(event.target.value)} placeholder="you@example.com" aria-label="Git email" />
    <button className="github-secondary" disabled={disabled || !name.trim() || !email.trim()} onClick={onSave}>Save identity</button>
  </section>;
}
