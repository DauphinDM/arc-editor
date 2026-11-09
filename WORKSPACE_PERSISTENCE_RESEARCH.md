# Per-Project Workspace Persistence — Research & Implementation Plan

Goal: when the user opens a folder, Arc restores exactly what that folder looked like last time — open tabs, split layout (direction, nesting, ratios), active group, file explorer expansion state, and related session state. Every folder has its own layout independent of other folders.

---

## 1. Current state in Arc (audit)

What exists today (`src/App.tsx`, ~4273 lines):

| State | Type / location | Persisted? |
|---|---|---|
| Tab positions of opened files | `openFiles: OpenFile[]` (path, name, revision, dirty) + `fileContents: Map<string, string>` in a ref | No |
| Editor groups (tab containers) | `groups: EditorGroup[]` (`{ id, activePath, tabs: string[] }`), tabs are **relative** paths | No |
| Split tree + ratios | `layout: LayoutNode` — recursive binary tree `{ type: 'group', groupId }` / `{ type: 'split', id, direction, ratio, first, second }` | No |
| Active group | `activeGroupId: GroupId` | No |
| Explorer expansion | `expanded: Set<string>` (relative dir paths) | No |
| Selected entries | `selectedPath`, `selectedPaths`, `selectedDirectory` | No |
| File viewer panel | `viewerOpen: boolean`, drag-resized width (inline style) | No |
| Terminal sessions | `terminals: TerminalSession[]` (`{ id, key, cwd, title, command? }`), each spawning `terminal_open` PTY | No |
| Last opened folder | `localStorage['arc.lastWorkspace']` (absolute path) | Yes — this is what auto-reopens the folder on start (App.tsx:2150–2169) |
| App settings / themes | `localStorage['arc.settings']`, `arc.theme.*` | Yes (global, not per-project) |

Key existing facts that shape the design:

- On `openWorkspace` (App.tsx:2171–2212) everything is **deliberately reset**: empty tabs, single `group-1`, cleared expansion. A restore hook belongs right at/after this reset, and at the startup auto-reopen path in App.tsx:2150.
- `openFile()` (App.tsx:2214) loads content async + handles missing/large files — good, restoration can reuse it, but it shows a `window.confirm` for files > 5 MB. For silent restore this path must bypass or auto-decline the dialog.
- Tabs and expansion state use **workspace-relative paths** — portable across machines and safe to store. Only `arc.lastWorkspace` is absolute.
- IDs are runtime-generated counters (`group-N`, `split-N`) — persisted data must not reference these IDs directly; store structure + order, rehydrate fresh IDs on load.
- No crash-safety story today: closing the window is the only exit; nothing is flushed except settings.

---

## 2. How other editors do it

### 2.1 VS Code — per-workspace SQLite db, app-side

VS Code never writes UI state into your project folder (except `.vscode/settings.json`, which is *settings*, not session state). All per-workspace session state lives in the app's user-data dir:

```
~/.config/Code/User/workspaceStorage/<md5 of workspace path>/
    workspace.json    // identifies the folder (file:// URI)
    state.vscdb       // SQLite, key-value
    state.vscdb.backup
```

What it stores per workspace: opened editors + grid (split) layout, active editor, sidebar visibility, recently opened files in quick open, tree expansion, scroll positions, "don't show again" choices, enabled extensions, etc. (List confirmed by the VS Code team in microsoft/vscode#61928, which is also the milestone where workspace storage migrated from `window.localStorage` to SQLite.)

Details worth copying:

- **Workspace identity = hash of the folder path** (`workspace.json` maps hash → URI). Opening X always finds the same bucket.
- **Write timing:** state is collected and flushed on (a) window close, (b) window blur (`onDidChangeFocus` → `flush()`), and (c) **periodically every ~60 s while the window is focused but idle**, because crash/OS-shutdown may prevent a clean flush (commit 54ab792, microsoft/vscode#87158). Flushing fires a single `onWillSaveState` event that every subsystem answers with its current state. Never blocks shutdown — writes go to SQLite, not one giant JSON rewrite... note: they do serialize the JSON blob of editor state anyway; the db just makes partial updates cheap.
- **Crash recovery (hot exit):** separate from layout persistence. Unsaved buffer contents are continuously backed up 1 s after typing stops into `User/Backups/<hash>/<file|untitled>/<md5-of-path>/...`, with an index in `Backups/workspaces.json`. On relaunch, any backups found are restored (VS Code blog, 2016-11-30; issue #16544). Design note from the blog: backups are keyed per folder even though restore is opportunistically app-wide, precisely so backups "can't go missing" if the user forgets which folder they had open.
- **Corruption tolerance:** on db error VS Code falls back to an empty/in-memory DB and *still renders the workbench*. Persistence must never be able to brick the app (explicitly tested in #61928).
- Window-restore behavior is user-configurable (`window.reopenFolders`: one / none / all).

### 2.2 Sublime Text — workspace file (in-project, JSON)

Sublime is the editor that literally writes a state file next to your project:

- `project.sublime-project` — shareable definition (folders, settings, build systems). Meant to be committed.
- `project.sublime-workspace` — **session data**: open files, tab order, pane layout, selections, unsaved buffer contents (hot exit), find history, undo stacks per buffer. Never commit; actively regenerated on basically every interaction.
- Without a project file, global `Local/Session.sublime_session` plays the workspace file's role for the last session.

Quirks documented on their forum: on window close, dirty state goes to the `.sublime-workspace`; on whole-app quit only the global session file is written — a known hot-exit gotcha. Undo history per buffer is capped at 128 kB so the session file can't grow forever (~4 MB worst case with 30 dirty files).

Takeaway: Sublime proves **a readable JSON file per project is viable**, but also shows the maintenance pain (file changes constantly, git noise, per-machine state leaking into shared repos). That's why VS Code and Zed hide it in the app-data dir.

### 2.3 JetBrains — `.idea/workspace.xml` (in-project, auto-ignored)

JetBrains splits state by scope in the `.idea` dir: shareable project config in named XMLs, and **`workspace.xml`** for the personal session (open editors, tabs, run configurations, breakpoints, tool window layout). The IDE itself adds `.idea/workspace.xml` to `.gitignore` on first commit. Their 2025 workspaces blog post confirms the core problem they've been fighting: asynchronously and inconsistently changing UI state files break VCS sync between two devs — which is the argument for keeping session state out of the project folder entirely.

### 2.4 Zed — SQLite in app-data, debounced serialization

Zed (closest architecture to Arc: modern app, tree-of-panes semantics):

- Per-workspace state in `~/.local/share/zed/db/0-stable/` (Linux), SQLite.
- Two layers: `WorkspaceDb` (relational: pane groups, panes, items, recent projects, trusted worktrees) + `KeyValueStore` (small JSON blobs: window bounds, sidebar visibility).
- Serialized model mirrors Arc's exactly: `SerializedWorkspace` → recursive `SerializedPaneGroup` (axis + ratio) → `SerializedPane` (ordered items + active index) → `SerializedItem` (buffer id, per-file scroll etc.).
- Write path: full serialization of the workspace on each state change, **throttled/debounced at 200 ms**.
- Their docs confirm what's in there: tabs + panes per project, per-file scrollbar/scroll position, recent projects list.

### 2.5 Synthesis — what they all agree on

1. **Workspace identity is derived from the folder path**, hashed, stable forever in the app's storage.
2. **Session state never lives in the project folder** (VS Code, Zed) — or only via a deliberately committed config portion with the personal part auto-ignored (JetBrains). Sublime's in-project file is the outlier generative of constant git noise.
3. **State = structure, not IDs.** Persisted documents encode the tree shape, ordering, and ratios; runtime IDs are reassigned on load.
4. **Robust writes:** debounce + periodic flush + flush-on-blur/close; tolerate corruption; restore must be all-or-nothing per subsystem (bad gracefulness beats no restore).
5. **Unsaved content is a separate concern** (VS Code "hot exit" backups) from layout persistence; keep them orthogonal.

---

## 3. Where Arc should store the state

Options:

| Option | Pros | Cons |
|---|---|---|
| A. In-project folder (`.arc/workspace.json`) | Survives reinstall/move; inspectable | Git noise; pollutes project; Arc has no existing per-project dir; JetBrains pain applies |
| B. App-data dir keyed by workspace path hash (`appDataDir()/workspaces/<hash>.json`) | Clean project; matches VS Code/Zed; no `.gitignore` dependency | Tied to per-machine; user can't hand-edit easily |
| C. Single global `arc.workspaces.json` in appDataDir with one entry per workspace | Simple, one file, easy GC | Grows unbounded; concurrent writes from two windows risk clobber |

**Recommended: B** — a JSON file per workspace under `appDataDir()/workspaces/`. Arc already uses `appDataDir()` for themes (App.tsx:1496), so the plumbing and mental model exist. Use a filesystem-safe hash of the normalized absolute path (vanity: `sha-256` hex of lowercase-normalized path; also store the raw path inside the file so an orphan bucket can self-identify and be GC'd). No SQLite needed — a workspace's JSON is a few KB; Sublime does far worse.

Single JSON file per bucket; `writeTextFile` with a rename-to-tmp atomic pattern isn't natively available — acceptable risk for v1; mitigate by keeping the previous file as `.bak` before overwriting and falling back to it if the new file fails to parse.

---

## 4. Data model (v1)

```jsonc
// appDataDir()/workspaces/<hash>.json
{
  "version": 1,                  // APP_SETTINGS_VERSION-style bump for future migrations
  "workspace": "/home/me/proj",  // raw path, for GC/identification
  "savedAt": "2026-11-09T12:34:56.000Z",
  "layout": {
    // LayoutNode with groupId replaced by dense integer indexes into "groups"
    "type": "split", "direction": "vertical", "ratio": 0.62,
    "id": 0,                     // optional; runtime split ids get regenerated anyway
    "first": { "type": "group", "group": 0 },
    "second": {
      "type": "split", "direction": "horizontal", "ratio": 0.4,
      "id": 1,
      "first": { "type": "group", "group": 1 },
      "second": { "type": "group", "group": 2 }
    }
  },
  "groups": [
    { "active": "src/App.tsx", "tabs": ["src/App.tsx", "src/main.tsx"] },
    { "active": "src/pluginRuntime.ts", "tabs": ["src/pluginRuntime.ts", "PLUGIN_API.md"] },
    { "active": "", "tabs": [] }
  ],
  "activeGroup": 0,
  "viewer": { "open": true, "width": 244 },
  "expandedDirs": ["src", "src/components"],
  "selectedPath": "src/App.tsx",
  "terminals": [
    // v1: intent only ("this many terminal tabs existed"), NOT live processes
    { "title": "npm run dev", "command": "npm run dev", "cwd": "." }
  ],
  "filter": ""
}
```

Deliberate omissions for v1:

- **No unsaved buffer contents.** Layout restore ≠ hot exit. Dirty buffers already warn on quit? (Arc currently has no such warning — worth a follow-up ticket: either implement hot-exit backups into the same bucket dir, e.g. `workspaces/<hash>/backups/`, or warn on close.) Keep this feature out of the first cut.
- **No scroll/cursor positions.** Zed/VS Code store them; Arc's CodeMirror state is per-`EditorView` and can be added later as a `fileState: { [relPath]: { scrollTop } }` map — additive, no schema break.
- **No deletion timestamps** for modified files; the `expanded`/`selectedPath` entries that no longer exist are simply filtered at load.

---

## 5. What exactly to save

Serialize on a schedule, from a single "snapshot" function reading refs/state:

- `layout`, `groups`, `openFiles`, `activeGroupId` (the core ask)
- `viewerOpen` + viewer width (read from the CSS/dragged inline value)
- `expanded`
- `selectedPath`
- terminal *intent*: each open session's title, cwd, command
- command/search UI state if desired later

## 6. Save triggers (VS Code/Zed hybrid)

1. **Debounced save** (200–300 ms) on any change to the snapshot inputs — matching Zed's throttle. Simplest correct hook: one `useEffect` with `[layout, groups, openFiles, activeGroupId, expanded, viewerOpen, terminals]` deps calling a schedule function; all counters (split/group ids) must be assigned with the *next values* into the serialization... simpler: serialize a **transformed** snapshot that maps group ids → indexes, so counters stay out of the file.
2. **Flush on window blur** (`blur` event / Tauri `window` focus events) — cheap insurance between sessions.
3. **Flush on close.** Tauri 2: `getCurrentWindow().onCloseRequested()` — call `snapshot()` synchronously (JSON stringify, single small file, fast) before allowing close.
4. **Periodic flush every 60 s** while idle — crash insurance (VS Code's answer to OS updates/crashes stealing the last state).
5. Optionally **only save workspaces that had access granted** (don't snapshot state for folders whose access was declined).

## 7. Restore flow

Insert into both existing workspace-entry paths (they share the reset block):

- Startup auto-open, App.tsx:2150–2169 (`historyRestoreStarted`)
- `openWorkspace()`, App.tsx:2171–2212 — after the deliberate reset, load and apply the bucket.

Steps:

1. Build bucket key from the selected absolute path; `JSON.parse` the file. On any failure → check `<hash>.json.bak` → give up silently with no restore (VS Code rule: **never fail the app open because state is bad**).
2. Validate `version`; if it doesn't match, attempt migration or ignore unknown fields (forward-compat reading).
3. Filter/tab prune:
   - `groups[].tabs` keep only paths that still exist (`stat`) after `refreshWorkspace()`; drop missing, dropping possibly-empty tabs; if a group's active is gone, fall back to last surviving tab.
   - Filter `expandedDirs` to directories that exist.
   - If all tabs vanish → restore to single empty group (current default) instead of an orphan split tree.
4. Rebuild runtime state:
   - `nextGroups`: reassign fresh ids `group-N` from `groupCounter.current`, tabs in stored order. Ensure at least one group (use pruneLayout ultimately).
   - Deserialize `layout` recursively with the same new group ids (recursive function over the transformed node shape; reuse `LayoutNode`/`insertSplit` types as-is).
   - `setLayout(...)`, `setActiveGroupId(...)`, `setGroups(...)`, `setExpanded(...)`, viewer width/open, terminal *intent list* (phase: see below).
5. **Content load:** don't `openFile()` per path (it would fire 20 dialogs when several tabs exceed 5 MB). Write a small `restoreOpenFiles(paths)` that reads content + fills `fileContents`/`openFiles` directly (mirroring `openFile`'s body) and skips the size confirm (or uses a size limit + flag to skip silently).
6. Ports of ordering matter: apply layout **before** content reads fire their setState, so tabs render inside restored groups on the first paint after file tree load.

### Terminals

Real PTY sessions can't live past the window. Restore as **intent**: recreate N terminal tabs with the stored command/cwd via the existing `terminal_open` flow (Arc already stores `cwd` + optional `command` in `TerminalSession`). This matches how VS Code treats terminal sessions (it restores *terminals* only in limited ways, and their layout otherwise) while still feeling like "same as I left it." Gate behind a setting, default on.

## 8. Concurrency, sizing, GC

- **Two windows on the same folder:** identical bucket → last writer wins. Chrome tab/`working dir` semantics differ; VS Code treats this the same way. Document the limitation; optionally skip saving when the same workspace is open twice simultaneously.
- **Bucket size:** well under 1 MB for realistic sessions; debounce handles churn.
- **Orphan GC:** on app start, walk `workspaces/*`, parse each file, drop files whose `workspace` path no longer `stat`s (or older than N days). Follows the `workspace.json` self-identifying pattern VS Code uses.
- **Unsaved empty groups:** never persist a `groups: []`/fusion-pruned state — `groups` should always contain ≥ 1 group so layout never references a missing index.

## 9. Plugin & settings interplay

- Plugins create tabs under `internal:plugin-view:<id>` — persist them plain-string (runtime re-mount will call `panel.mount`); if a plugin was disabled since, the resulting tab prunes like a missing file.
- `filter`, search state, undo stack, clipboard: **don't persist** (VS Code doesn't either, except find history — skip for v1).

---

## 10. Implementation plan (concrete)

New module `src/workspaceState.ts` (name free both ways; no file exists):

1. `workspaceHash(path: string): string` — normalize (`stripTrailing separators, lowercase? no: keep case, Linux is cased; hash utf8 of nn-normalized absolute path with separators unified to `/`), SHA-256 via `crypto.subtle.digest`, hex slice.
2. `pathsFor(path)` → `join(await appDataDir(), 'workspaces', hash + '.json')`.
3. `serializeSnapshot(state: SerializableSnapshot): object` — the transform in §4: layout → indexed tree.
4. `deserializeSnapshot<T>(raw | .bak): Snapshot` with defensive field-by-field validation (arrays of strings, one `switch` per layout node).
5. `saveWorkspaceState(path, snapshot)` (write to file; previous file renamed to `.bak` first), `loadWorkspaceState(path)` (read, `.bak` fallback, `version` check).
6. `gcWorkspaces()` — §8 orphan sweep, run once on app start after load.

Wiring into `App.tsx`:

1. One shared `restoreForWorkspace(path: string): Promise<void>` used by both the startup auto-open and `openWorkspace`, executed **after** `refreshWorkspace(path)` so the file tree/stat is fresh.
2. One `useEffect` subscribing to `[layout, groups, openFiles, activeGroupId, expanded, viewerOpen, terminals]` with a `setTimeout`-debounced snapshot (300 ms; clear on re-fire; skip when `!workspace`).
3. `blur` listener + `onCloseRequested` for sync flush; 60 s interval flush.
4. `restoreOpenFiles(relPaths)` as in §7.5 — basically the body of `openFile` minus the confirm dialog.
5. Terminal intent re-opening wired to the existing terminal creation effect/`terminals` state setter path (mirroring `TerminalSession` construction with fresh `id`/`key`).
6. Survivor-filter for tabs/dirs described in §7.3.
7. Theme maker / GitHub panels (`internal:*` keys) — persist as part of `groups`.

Testing checklist (manual — Arc has no test framework):

- Open folder A → split L/R, open 3 files L, 2 files R, collapse/expand dirs, drag viewer narrower → quit → relaunch: identical.
- Open folder B: stays separate from A.
- Delete a file that was tabbed externally → relaunch: tab gone, no dialog, no empty pane splits.
- Corrupt the JSON by hand → app opens fine; `.bak` kicks in or restore is skipped without a hang.
- Two rapid edits → only one disk write per debounce window (log `console.count` in dev).
- Crash (kill -9) during idle → relaunch restores state from the ≤60 s-old flush, minus recent edits (acceptable).
- Very long file path, non-ASCII path, symlink folder — bucket naming stable.
- Folder renamed on disk → old bucket orphans; new folder starts fresh; GC removes the stale bucket next launch.

## 11. Risk register

| Risk | Mitigation |
|---|---|
| Write during shutdown races close | Tauri `onCloseRequested` gives an await point for a sync snapshot before allow-close; debounce tail also flushed there |
| Restore zooms editor but content load fails (binary, gone) | survivor filter pre-check with `stat`; `readTextFile` errors are caught per file and just drop the tab, never the tree |
| Large sessions slow first paint | tabs/content load is already `async` per tab; layout paint is instant from JSON; no PTY work before first render |
| Concurrent saves corrupt file | single writer is the whole UI thread; `writeTextFile` is atomic-enough at these sizes; `.bak` recover path |
| User expects file viewer width/side persisted but resizes differ across monitor changes | clamp/min rules already exist in the drag handler; width clamped on load |

## 12. Follow-ups (out of scope for v1)

- Hot-exit-style backup of unsaved buffers (`workspaces/<hash>/backups/`, 1 s after typing stops, index file — direct port of the VS Code design).
- Per-file scroll/cursor restore (stored per relative path; Zed stores this per item in `SerializedPane`).
- "Save workspace as..." style multiple workspaces per folder (Sublime's feature) — not worth it until someone asks.
- Persisting window size/position (Tauri `window` plugin state per workspace).

---

## Sources

- VS Code storage layout & contents: https://stackoverflow.com/questions/57760451/ and https://stackoverflow.com/questions/58900482/
- VS Code workspace storage `localStorage` → SQLite change and test matrix: microsoft/vscode#61928
- VS Code periodic/idle flush + flush-on-blur: commit `54ab792` (microsoft/vscode#87158)
- VS Code hot exit design and backup layout: https://code.visualstudio.com/blogs/2016/11/30/hot-exit-in-insiders, microsoft/vscode#16544
- Sublime Text projects/workspaces: https://docs.sublimetext.io/guide/usage/file-management/projects.html, https://www.sublimetext.com/docs/projects.html, forum threads on hot exit/session quirks (2021)
- JetBrains `.idea/workspace.xml` handling + workspaces blog 2025-03: https://blog.jetbrains.com/idea/2025/03/ide-workspaces-development-challenges-and-plans/
- Zed persistence architecture and locations: https://zed.dev/docs/troubleshooting, https://deepwiki.com/zed-industries/zed/3.4-workspace-persistence
