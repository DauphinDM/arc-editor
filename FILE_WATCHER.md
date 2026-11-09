# File Watcher Implementation Plan

> **Status: implemented.** `watch_project`/`unwatch_project` in `src-tauri/src/lib.rs` + listener/reducer in `src/App.tsx`. Watch registration is per-directory (root + each non-ignored subdir, `RecursiveMode::NonRecursive`), capped at `WATCH_MAX_DIRS`/`WATCH_MAX_FAILURES`; ignores skip `WATCH_IGNORED_NAMES` plus a root `.arcwatchignore`; open-tab behavior table (4c) is wired to the `disk-conflict` banner, silent reload, tab re-point and phantom tabs. Manual smoke tests below still apply.

Goal: when files/folders change on disk (created/renamed/modified/deleted from outside the app, e.g. a file manager), the workspace file tree updates live with no project reopen.

This document is written for an implementing agent. It contains the full architecture, exact crate choices, code the way the project structures things, edge cases, and a test plan.

---

## 1. Context about this codebase

- Tauri 2 + React 19 + TypeScript + Vite frontend.
- CodeMirror 6 editors, xterm terminal, tab system. `src-tauri/src/` currently contains only `lib.rs` and `main.rs`; there is a lot of JS to be wired.
- Existing deps: `tauri-plugin-fs` (frontend API only, no watcher), `tauri-plugin-dialog`, `portable-pty`.
- Cgo-free Rust so far. `notify` does not link C on Linux, so it keeps the build simple.

The file tree rendering lives in the frontend. Search for the tree component under `src/` and for a store (whatever holds the workspace state — context, zustand or useState chain). All patch logic targets that store.

---

## 2. Overall architecture

```
[OS filesystem] 
      |  inotify / FSEvents / ReadDirectoryChangesW
      v
notify-debouncer-full (Rust) ------- batched, deduped events, 200ms window
      |
      v
watch_project / unwatch_project (Tauri commands, src-tauri/src/lib.rs)
      |
      v  emit("fs-changed", <FsEvent>)   per window watching that root
[Frontend listener]  -- listen("fs-changed") in a useEffect at app root
      |
      v  route to store, one reducer/action
[File tree store]    -- insert/remove/move nodes idempotently
      |
      v
[Explorer component] -- re-renders from store
```

Streaming principle: the watcher never mutates the tree directly; it only sends deltas. The store applies deltas. Tree stays sorted, and every apply is idempotent (applying the same event twice must be a no-op).

---

## 3. Rust side in detail

### 3a. Dependencies

```toml
[dependencies]
notify = "8"                       # (or notify-debouncer-full = "0.5" which re-exports notify 8)
notify-debouncer-full = "0.5"
ignore = "0.4"                     # gitignore-aware filtering (optional but recommended)
serde_json = "1"
```

`notify-debouncer-full` bundles debouncing + rename pairing + one-shot initial-dir listing. Use it rather than raw `notify`.

### 3b. Event schema (payload sent to the frontend)

```rust
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FsEvent {
    root: String,          // canonical project root path; frontend filters on this
    kind: FsEventKind,     // "created" | "removed" | "renamed" | "modified"
    paths: Vec<String>,    // for created/removed/modified: [path]; for renamed: [from, to]
}
```

- `root` matters: two windows may watch different roots. Each event is only for the window whose frontend requested it; but tagging gives you a cheap correctness check.
- For `renamed`, `paths = [from, to]`.
- On Linux, if `paths` for created/removed has exactly one entry and it is expected to be a directory (dir flag not available on all kinds), the callback may also attach a one-shot directory listing event (see 3d).

### 3c. State + commands

```rust
use std::sync::Mutex;
use notify_debouncer_full::{Debouncer, RecommendedWatcher, DebouncedEvent};

pub struct GateState {
    watcher: Mutex<Option<Debouncer<RecommendedWatcher>>>,
    roots: Mutex<Vec<String>>,   // roots that should still receive events
}

#[tauri::command]
fn watch_project(app: AppHandle, state: State<'_, GateState>, root: String) -> Result<(), String> { ... }

#[tauri::command]
fn unwatch_project(state: State<'_, GateState>, root: String) -> Result<(), String> { ... }
```

Command-driven singleton watcher (one project open per window in this app — stay single-watcher, and use `roots` as a filter list rather than one watcher per root).

`watch_project` body:

```rust
let (tx, rx) = std::sync::mpsc::channel::<Result<Vec<DebouncedEvent>, notify::Error>>();
// configure: recursive, poll fallback off for now (see limits section)
let mut debouncer = notify_debouncer_full::new_debouncer(
    Duration::from_millis(200),
    None, // tick hint
    tx,
)?;

debouncer.watch(Path::new(&root), RecursiveMode::Recursive)
    .map_err(|e| e.to_string())?;

// store handle in state; spawn a thread consuming rx and emitting
std::thread::spawn(move || {
    for res in rx {
        for ev in res.unwrap_or_default() {
            if let Some(fs_event) = map_to_fs_event(&root, &ev) {
                app.emit("fs-changed", fs_event).ok();
            }
        }
    }
});
```

`unwatch_root(root)`: remove root from `roots`, drop the watcher if list is empty. Be careful with `Mutex` reentrancy —

Store pattern: hold `watcher: Option<Debouncer<RecommendedWatcher>>` and `roots: Vec<String>` in a single `Mutex<WatchState>`; `unwatch` clears when roots becomes empty.

### 3d. The directory-content race fix (critical)

Watchers have two well-known races. Fix them with a follow-up directory listing on any `created`/`renamed` whose path is (or may be) a directory.

**Bug 1 — missed intermediate directory:** `watch(path, Recursive)` must walk `path` and register every directory. If you create `a/b` and `a/b/c/file.txt` fast, the watcher may never register `a/b` and thus never see events inside it. This can happen if the `create` event for `a/b` arrives while the backend already emitted something for the workspace root before `a/b` existed.

**Bug 2 — stale event:** debouncer drops a `created` for a freshly added directory (something like this).

**Catch-up guard (do not skip):** after an event batch, for each `created` or `renamed` path `p` that might be a directory, do a synchronous one-shot listing:

- If `p` still exists and is a dir, emit a synthetic `created` FsEvent for **every file/dir found recursively under p (excluding ignored dirs)**. Frontend applies idempotently: nodes that already exist are skipped.
- If `p` no longer exists, skip — the frontend will get a `removed` event from the watcher or a later event will handle it.

This turns "watcher missed or mis-fired on a new folder" into "list-then-patch", which is always correct at the time of listing.

---

## 4. Frontend side in detail

### 4a. One `useEffect` at app root subscribes once

```ts
import { listen } from '@tauri-apps/api/event';

useEffect(() => {
  const un = listen<FsEvent>('fs-changed', evt => {
    const e = evt.payload;
    if (!currentRoot || !e.root.startsWith(currentRoot)) return;
    store.reduce(fsEventToAction(e, currentRoot));
  });
  return () => { un.then(f => f()); };
}, [currentRoot]);
```

### 4b. Filed event → store action mapping

```ts
type FsAction =
  | { type: 'add'; path: string; isDir: boolean; children?: TreeChildren[] }
  | { type: 'remove'; path: string }
  | { type: 'rename'; from: string; to: string; isDir: boolean }
  | { type: 'diskModified'; path: string };
```

Apply in this helper (container in store):

```ts
function applyFsEvent(e: FsEvent) {
  batch(() => {
    switch (e.kind) {
      case 'created':
      case 'renamed':
        upsert path into tree, sorted into parent's children;
        for directories: skip children that are already there (watcher's one-shot listing has them);
      case 'removed': remove path from tree;
      case 'modified': ensure path exists in tree (can also happen right after a rename with no `created`); no op otherwise.
    }
  });
}
```

Batch so a 40-item directory listing doesn't re-render 40 times.

Rules each op must obey:

- `upsert` — sorted by (directories-first, then name) the way the tree is ordered everywhere else. If node exists, replace payload but never overwrite user's open editor preview state.
- `remove` — no-op if missing. Also purge children of a removed directory.
- `rename` — no-op if missing? Actually better: `remove(from) + insert(to)` semantics with children ignoring both old and new to avoid dribble. Event order from OS isn't guaranteed, so treat rename as delete+insert-keep-state.
- **Crucial side effect:** rename **also abandons any open editor buffer path** must be re-pointed to the new path *only if the user has no unsaved changes there*. If they have unsaved changes, keep them and show a banner.

### 4c. Sync with open editors (this is UI behavior, not watcher behavior — still spec it)

When a `modified`/`renamed`/`removed` event touches the path of an open editor:

| event on open file | editor has unsaved changes | behavior |
| --- | --- | --- |
| `modified` | no | silently reload content from disk |
| `modified` | yes | keep buffer, show "File changed on disk" bar; user picks reload/overwrite |
| `renamed` (`from == open path`) | no | re-point editor to new path seamlessly |
| `renamed` | yes | keep buffer, banner; save writes to the new `to` path |
| `removed` | no | close tab |
| `removed` | yes | keep tab open in "phantom" state (existing content kept, save will error/recreate) |

This mirrors VS Code. The watcher only emits events; this table is the product decisions you implement in the editor code.

### 4d. Ignore list (consistent on both sides)

Skip anything considered "tooling junk", in least-recently-forgotten order:

- `node_modules`, `.git`, `dist`, `target`, `__pycache__`, `.venv`, `.cache`
- Honor a `.arcwatchignore` file in the project root if present (same syntax as `.gitignore`) so users can control it. `ignore` crate can read it.

The Rust side should already skip these before emit. The frontend applies a second filter (cheap) in case a race lets something through.

---

## 5. Registration errors, inotify watch limits, and graceful degradation

Linux `fs.inotify.max_user_watches` defaults to 8192 on many distros, each recursive watch on directory count matters. A project with a big `node_modules` will blow it.

Rules:

1. **Never prevent the app from launching or watching on this error.** Catch it, log it to the JS console via `emit("fs-watcher-error", …)` and keep running (tree still works, just not live).
2. Surface a toast: "Live file updates aren't available (too many files / watch limit reached). Changes will appear after the workspace is refreshed." Link to docs: `sysctl fs.inotify.max_user_watches=524288`.
3. **Frontend fallback:** even without watching, the existing on-supply resolution is "re-scan on window focus". Keeping it (dispatch an event on `focus` -> re-run the tree load command) guarantees the bug never gets worse than today's default behavior.

Also note: debouncer emits may saturate under heavy churn (e.g., `npm install` writing 20k files in 2 seconds). Throttle frontend reducer to one apply per animation frame — a `requestAnimationFrame`-coalesced reduce.

---

## 6. Lifetime and multi-root pitfalls

Scenarios that leak or corrupt state if you get it wrong — test each explicitly:

| scenario |
| --- |
| open project A → open project B in same window | unwatch A first, watch B. Final state: exactly one watcher |
| same project in two windows | singleton watcher keyed by root; refcount, or filter emit by window — choose one and document. Simplest for this app: single watcher per process, emit to all windows, each window filters on root |
| close project | unwatch. No dangling thread. The consuming thread exits when the channel closes or watcher dropped |
| watch fails (permission-denied on root?) | surface to frontend, tree still loads (via read_dir) |
| open/close fast in loop | no accumulated watchers or listeners (single listener in the app; commands are stateless between calls) |

There is exactly one `listen("fs-changed")` in the app. It lives for the whole session; it does not subscribe per project. Its callback gets the current root from the store and filters.

---

## 7. Security notes

- Event payloads include absolute filesystem paths, and the frontend will `read_dir` / read file contents from a path an event gave it — meaning a malicious/wrongrot client could probe arbitrary paths if events came from outside. Mitigations:
  - Rust side never emits paths outside the registered root: filter in the emit callback by `path.starts_with(root)` (canonicalize both sides once).
  - `tauri-plugin-fs` capability/scope: keep the plugin scope limited to workspace paths where it already is.
The watcher must never accept paths from outside its own event source. Do not route terminal or other command inputs into watch commands.

---

## 8. Implementation order (for the implementing agent)

Do it in this order; each step is verifiable on its own. **Do not skip step order; the race fixes depend on earlier steps.**

1. **Rust watch only, no emit filtering.** `watch_project`/`unwatch_project` commands + emit raw debounced events to a `console.log` in the frontend via `listen("fs-changed")`. Run `cargo run` and `npm run dev`, manually create/edit/rename/delete files in a file manager and observe the logs. This validates schema and debouncing first.
2. **Add ignore filtering** (skip `node_modules`, `.git`, etc., Rust side) and **path filters** (root prefix check).
3. **Directory listing catch-up**: on `created`/`renamed` paths that could be directories, list and emit. Test by creating a deep folder `a/b/c/d/e.txt` from Finder/Nautilus quickly.
4. **Tree store patch**: implement reducer ops from 4b idempotently, plus batching. Test single creates/deletes/renames.
5. **Open-file UX table** from 4c integrated into the editor/side file handlers.
6. **Error surface + watch-limit handling** (section 5 rules).
7. **Lifecycle tests** (section 6 table each row).

Rough size: ~150 lines Rust (excluding noise), ~120 lines TS for the listener + reducer; the open-file UX reuse in tabs is separate and likely the bulk of UI work.

---

## 9. Edge cases & gotchas checklist

- [ ] A file both created and deleted within the debouncer window → the events may coalesce to nothing. Fine: the tree never sees it and that's correct.
- [ ] Creating a file then renaming within 200ms → debouncer may emit only `renamed`. Tree should handle rename for a node it doesn't yet have by treating it as add.
- [ ] Save from within the editor while watcher is running → will produce a `modified` event for the path the user is editing. Since they saved, content == buffer. Do not show the "changed on disk" banner when the changed content matches the buffer hash (compare via store's last-sent on save; or simply ignore `modified` events within N ms of our own save command to a file in our open-editor set).
- [ ] Watcher fires when the tree is mid-render / switching workspaces → reducer must be defensive: applying a tree patch to a store whose root no longer matches must be a no-op (the `root` field check at 4a is the gate).
- [ ] Some directories (`/proc`, `/sys`) and network mounts (SMB/NFS) don't do inotify. If user opens a project there, watch will error — handle per section 5, and note that window-focus re-scan is the fallback.
- [ ] The workspace is moved/renamed externally while open → events stop (root path invalid) with possibly a watch error; leave stale, non-crashing state. Optionally surface "root moved" if a `removed` for the root itself arrives.
- [ ] Case-only rename on macOS/APFS (`foo` → `FOO`) may emit `remove` + `create` instead of rename — reducer must handle that pair without flicker.
- [ ] Removing the workspace root itself while watched fires a `removed` event for root — the reducer must handle a remove on the root node without crashing or wiping the UI.

---

## 10. Test plan

Manual smoke tests against the running app (open the dev app, use a file manager `nautilus` in another window, or `touch`/`mv` in a second terminal):

1. Create file at root level → appears in tree within ~500ms.
2. Create file 5 levels deep in a brand new folder tree → appears (tests race fix).
3. Delete a file → disappears. If it was open → close the tab (or phantom per 4c).
4. Rename a file in terminal (`mv a.txt b.txt`) → tree moves it. Open editor re-points or shows banner per rules.
5. `git checkout` a branch change that changes 15 files → all 15 update, no missing rows, no crashed render (batching works).
6. `npm install` in project → node_modules churn is invisible (ignore filtering works), no watch-limit error, no UI jank.
7. Open, then externally modify an open, unedited file → content reloads.
8. Open, edit, then externally modify the same open file → banner appears, user's changes remain, disk copy intact.
9. Two windows on two different projects → no cross-talk (root filter works).
10. Close a project → re-open same project in same window → file events flow again (no leaked/double listeners).
11. Run `watchers` count via `lsof | grep inotify` or `/proc/*/fd` when app runs long → stable count, no creep across the scenarios in section 6.

---

## 11. Reference behavior

VS Code's equivalent subsystem is `fileWatcher` in `vscode/code/fileservice`; the interesting parts to study if stuck:
- Per-window watcher singleton with roots filter (same shape as section 3c).
- Treat `created` of a directory followed by an immediate listing as the canonical pattern (their optimistic-new-folder handling). Same as section 3d.
- Watch-manager-level ignore logic that skips node_modules wholesale.
- Frontend tree application is strictly idempotent; nodes are added lazily for collapsed folders.

Last updated: 2026-11-09
