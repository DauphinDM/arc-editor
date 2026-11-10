# Plugin API Expansion — Implementation Notes

Status: implementation substantially complete, **not committed**, and the very last cleanup edit has not been rebuilt yet.

Source proposal: `PLUGIN_API_PROPOSALS.md`.

Primary implementation files:

| File | Change |
| --- | --- |
| `src/pluginRuntime.ts` | Main API surface, registries, lifecycle, MCP client, process/socket wrappers, UI helpers |
| `src/App.tsx` | Host wiring for editor context, editor events, language overrides, plugin formatters, will-save hooks, keybindings, custom icons, git helpers |
| `src-tauri/src/lib.rs` | Rust commands for processes, sockets, HTTP servers, trash, git diff, terminal exit events |
| `src/pluginExtensions.css` | Styles for plugin quick pick, input box, notifications, diff view, output panels, tree views, SVG icons |
| `PLUGIN_API.md` | Extended API documentation |

## Verification already performed

- `npm run build` passed several times while implementing.
- `cargo test` passed: 4 Rust tests.
- `cargo check` passed.
- `cargo clippy` passed with two warnings:
  - one pre-existing `sort_by` suggestion (not touched);
  - `DataChange` unused import in tests (pre-existing warning).
- Final edit added cleanup when plugin activation throws. That edit is applied, but `npm run build` was aborted before it finished. Re-run `npm run build` before committing.

## Lifecycle and capabilities

Added:

- `api.supports(capability)`
- `api.disposables.add(resource)`
- `api.lifecycle.onDeactivate(handler)`
- `api.lifecycle.onShutdown(handler)`
- `api.timers.setTimeout / setInterval / clearTimeout / clearInterval`
- `api.workers.create(scriptPath)`

Behavior:

- Timers and workers are cleared/terminated on disable/uninstall.
- Deactivate and shutdown handlers are registered per plugin.
- Registered disposables run on disable/uninstall and app shutdown.
- Plugin activation failures now clean up already-registered resources.

## Editor context and events

Added:

- `api.editor.getContext()`
- `api.editor.getLastActive()`
- `api.editor.getLanguage(path?)`
- `api.editor.getCursor(path?)`
- `api.editor.getSelections(path?)`
- `api.editor.getVisibleRanges(path?)`
- `api.editor.onActiveChanged`
- `api.editor.onContextChanged`
- `api.editor.onSelectionChanged`
- `api.editor.onDocumentOpened`
- `api.editor.onDocumentClosed`
- `api.editor.onDocumentChanged`
- `api.editor.onDocumentSaved`

Wiring:

- `App.tsx` tracks last active editor path.
- Editor selection changes emit `editor:selection-changed`.
- Document open/close is derived from `openFiles` transitions.
- Existing `editor:changed`, `file:saved`, `settings:changed` events feed the new subscriptions.

## Editing and navigation

Added:

- `api.editor.replaceRange`
- `api.editor.applyEdits`
- `api.editor.applyWorkspaceEdit`
- `api.editor.insertSnippet`
- `api.editor.revealRange`
- `api.editor.openAt`
- `api.editor.setLanguage`
- `api.editor.registerDecorationType`
- `api.editor.setDecorations`
- `api.editor.openDiff`
- `api.editor.registerContentProvider`
- `api.editor.registerCustomEditor`
- `api.editor.onWillSave`

Behavior:

- Edits use CodeMirror transactions.
- `insertSnippet` supports `$1`, `${1:default}`, and `$0` placeholder stripping.
- Decorations use a plugin-owned CodeMirror decoration field added to all editors.
- `onWillSave` handlers run before save formatting.
- `setLanguage` stores a per-file language override consumed by the editor pane.
- `openDiff` opens a plugin overlay and reads `file://` content when possible.

Limitations:

- `applyWorkspaceEdit` is sequential, not transactional with rollback.
- `openDiff` is a simple side-by-side text overlay, not the main editor diff system.
- Custom editor and content-provider registrations are stored but not yet integrated into file opening/rendering.
- Content-provider reads are not currently used by `editor.open`.

## Languages and diagnostics

Added namespaces:

- `api.languages.register`
- `api.languages.registerCompletionProvider`
- `api.languages.registerHoverProvider`
- `api.languages.registerDefinitionProvider`
- `api.languages.registerReferenceProvider`
- `api.languages.registerRenameProvider`
- `api.languages.registerFormattingProvider`
- `api.languages.registerCodeActionProvider`
- `api.languages.registerCodeLensProvider`
- `api.languages.registerInlayHintsProvider`
- `api.languages.registerSignatureHelpProvider`
- `api.languages.registerDocumentSymbolProvider`
- `api.languages.registerWorkspaceSymbolProvider`
- `api.languages.registerSemanticTokensProvider`
- `api.languages.registerFoldingProvider`
- `api.languages.registerSelectionRangeProvider`
- `api.languages.registerGrammar`
- `api.languages.startServer`
- `api.diagnostics.createCollection`
- `api.codemirror` with shared `language`, `view`, `state`, `autocomplete`, and `highlight` modules

Integrated today:

- Language registration feeds the editor language compartment by extension or filename.
- Completion providers feed CodeMirror autocomplete.
- Hover providers feed CodeMirror hover tooltips.
- Folding providers feed CodeMirror folding.
- Formatting providers are consumed by `formatFile` before the Prettier fallback.

Limitations:

- Definition, reference, rename, code action, code lens, inlay hints, signature help, document/workspace symbols, semantic tokens, selection range, and grammar registrations are stored/registered but not yet consumed by the editor UI.
- `startServer` starts an owned process and sends an LSP `initialize` request, but does not implement the full LSP client lifecycle.
- Diagnostic collections store data and emit `diagnostics:changed`, but are not yet rendered in an editor or problems view.

## Workspace, files, and paths

Added:

- `api.workspaceFolders.get / onChanged`
- `api.workspaceTrust.isTrusted / onChanged`
- `api.files.listRecursive`
- `api.files.watch`
- `api.files.find`
- `api.files.searchText`
- `api.files.readBytes`
- `api.files.writeBytes`
- `api.files.writeAtomic`
- `api.files.openReadStream`
- `api.files.openWriteStream`
- `api.files.stat`
- `api.files.exists`
- `api.files.move`
- `api.files.trash`
- `api.files.registerProvider`
- `api.paths.join / resolve / relative / toUri / fromUri / basename / dirname / extname / normalize`

Behavior:

- Recursive listing/search uses exclusions, depth limits, and result limits.
- File watching subscribes to the existing `fs-changed` Tauri event and filters by glob.
- Byte APIs use `@tauri-apps/plugin-fs`.
- Atomic writes write a temporary file and rename it.
- Streams are chunked/buffered wrappers.
- Virtual file providers are used by `read`, `readBytes`, `write`, `writeBytes`, `list`, and `exists`.

Limitations:

- `files.trash` moves items into the app cache trash folder, not the OS trash.
- File providers are not used by `stat`, streams, or file-open flows.
- `openWriteStream` buffers all chunks until `close()` rather than true streaming backpressure.

## Processes, PTYs, sockets, and HTTP

Added:

- `api.process.spawn`
- `api.process.which`
- `api.process.exec`
- `api.pty.spawn`
- `api.ipc.connectUnix`
- `api.ipc.connectPipe`
- `api.net.connectTcp`
- `api.net.listenHttp`

New Rust commands:

- `plugin_process_spawn`
- `plugin_process_write`
- `plugin_process_close_stdin`
- `plugin_process_stop`
- `plugin_process_exec`
- `plugin_process_which`
- `plugin_socket_connect`
- `plugin_socket_write`
- `plugin_socket_close`
- `plugin_http_server_start`
- `plugin_http_respond`
- `plugin_http_server_stop`
- `plugin_trash_path`
- `github_diff`

New Rust events:

- `plugin-process-output`
- `plugin-process-exit`
- `plugin-process-error`
- `plugin-socket-data`
- `plugin-socket-close`
- `plugin-http-request`
- `terminal-exit`

Behavior:

- Owned processes stream stdout/stderr and emit exit/error events.
- Plugin processes are killed on plugin disable and on app shutdown.
- TCP/Unix sockets stream binary data through Tauri events.
- Plugin HTTP servers bind to loopback by default and bridge requests to JS handlers.
- PTY support reuses Arc's existing terminal PTY implementation.

Limitations:

- `process.exec` ignores its timeout option and does not cap output size.
- Named pipes only work on Windows; Unix sockets only on Unix.
- PTY stdout and stderr share the terminal stream; stderr is not separate.
- HTTP server has no TLS, auth, or origin policy beyond loopback binding.

## Networking

Added:

- `api.net.fetch`
- `api.net.connectWebSocket`
- `api.net.connectEventSource`
- `api.net.download`
- `api.net.isOnline`
- `api.net.onOnlineChanged`

Behavior:

- Uses browser/webview `fetch`, `WebSocket`, and `EventSource`.
- Download streams response chunks to a workspace file and reports progress.
- Fetch supports `timeoutMs` via `AbortController`.

## Icons, assets, and UI

Added:

- `api.icons.register / unregister / get`
- `api.assets.url / readText / readBytes / resolvePath`
- `api.ui.updateAction`
- `api.ui.updateStatusItem`
- `api.ui.registerMenuItem`
- `api.ui.registerSidebarView`
- `api.ui.registerBottomView`
- `api.ui.registerTreeView`
- `api.ui.registerCustomTab`
- `api.ui.setViewBadge`
- `api.ui.showQuickPick`
- `api.ui.showInputBox`
- `api.ui.showProgress`
- `api.ui.showNotification`
- `api.ui.createOutputChannel`
- `api.ui.setContext`
- `api.ui.focusView`
- `api.ui.closeView`

Behavior:

- Icons are sanitized, plugin-namespaced SVGs, rendered in toolbar actions.
- Asset paths are confined to the installed plugin folder.
- Action/status updates mutate live React state.
- Quick pick, input box, notification, and diff overlays are standalone DOM overlays.
- Output channels create plugin panels that live-update as text is appended.
- Sidebar/bottom/custom tab views currently map onto plugin panels.
- Tree views create a simple lazy-loaded plugin panel tree.

Limitations:

- Sidebar and bottom views do not yet occupy dedicated Arc sidebar/bottom slots.
- Tree views do not fully implement VS Code-style lazy expansion/icons/actions.
- View badges are implemented via status-bar items rather than native view badges.
- `showProgress` reports via notifications and does not render a cancellable progress UI.

## Configuration, storage, secrets, services

Added:

- `api.configuration.register / get / update / onChanged`
- `api.storage.workspace.get / set / remove / clear`
- `api.secrets.get / set / delete`
- `api.services.register / get / whenAvailable`

Behavior:

- Configuration supports schema defaults, global values, and workspace-scoped values in `localStorage`.
- Workspace storage is keyed by plugin and workspace path.
- Services are plugin-registered values and support waiting/listeners.
- Secrets are plugin-scoped and encoded in `localStorage`.

Limitations:

- Secrets are **not** stored in the OS credential store. They are base64-encoded localStorage values.
- Configuration UI is not generated in `SettingsPanel.tsx`; values are programmatically readable/writable.

## Commands, keybindings, plugins, themes, window

Added:

- `api.commands.onExecuted`
- `api.keybindings.register / unregister`
- `api.plugins.list / get / whenAvailable / onChanged`
- `api.themes.getColors / onChanged`
- `api.window.isFocused / onFocusChanged / getVisibility / onVisibilityChanged / getIdleTime`

Behavior:

- Command execution emits success/failure events.
- Plugin keybindings are checked in the global key handler.
- Plugin metadata is exposed without secrets/source.
- Theme colors are read from the active theme object.
- Window focus and document visibility are wired to browser events.
- `getIdleTime` currently returns `0` because no idle-time backend was added.

## Git, tasks, tests, debugging, auth, links

Added:

- `api.git.getRepositories / getStatus / getBranch / getDiff / onChanged`
- `api.tasks.registerProvider / run / onStarted / onFinished`
- `api.tests.createController`
- `api.debug.registerAdapter / start / stop / getActiveSession / onSessionChanged`
- `api.auth.registerProvider / getSession`
- `api.links.registerUriHandler / createCallbackUrl`

Behavior:

- Git uses existing `github_*` commands plus new `github_diff`.
- Git change observation polls every 2.5 seconds.
- Tasks run owned processes with start/exit events.
- Test controllers publish item and result events.
- Debug sessions store active-session metadata and emit events.
- Auth providers can return/create sessions via plugin code.
- URI handlers are registered and callback URLs are generated.

Limitations:

- Debug support is session bookkeeping only; there is no DAP transport/bridge yet.
- Test controllers do not appear in a test explorer UI.
- Auth providers do not have Arc-owned credential/session UI.
- Deep links are not delivered by an OS deep-link integration yet; handlers are registry-only.
- Git change observation is polling, not watcher-driven.

## MCP

Added client management:

- `api.mcp.registerServer / unregisterServer / listServers / getServer`
- `api.mcp.connect / disconnect / restart / getCapabilities`
- `api.mcp.onServerChanged / onLog / setLogLevel / ping`

Added tools/resources/prompts:

- `api.mcp.listTools / callTool / onToolsChanged`
- `api.mcp.listResources / listResourceTemplates / readResource / subscribeResource / onResourcesChanged`
- `api.mcp.listPrompts / getPrompt / onPromptsChanged / complete`

Added host-side requests and exposure registration:

- `api.mcp.setRoots`
- `api.mcp.onSamplingRequest / onElicitationRequest / onAuthorizationRequired`
- `api.mcp.exposeTool / exposeResource / exposeResourceTemplate / exposePrompt / notifyResourceChanged / getExposure / onExposureChanged`

Behavior:

- Stdio MCP client implemented with JSON-RPC over an owned process.
- Remote MCP uses Streamable HTTP POST requests and `mcp-session-id`.
- Initialize/capability negotiation, tools, resources, prompts, completion, notifications, logs, roots, sampling/elicitation callbacks, and resource subscriptions are implemented.
- MCP connections are cleaned up with plugin lifecycle.
- Exposure registrations are stored and emit change events.

Limitations:

- There is **no Arc-owned MCP server** exposing plugin tools/resources/prompts to external MCP clients yet.
- Exposure APIs are registries/events only.
- Remote authorization UI is not implemented; `onAuthorizationRequired` is a handler registry.

## Documentation

`PLUGIN_API.md` now has an “Extended API” section with examples for every added namespace. The overview table includes the new namespaces.

## Suggested next steps

1. Re-run `npm run build` after the final activation-cleanup edit.
2. Decide whether to make secrets OS-backed (e.g. keyring/stronghold integration).
3. Wire custom editors and content providers into `EditorPane`/file opening.
4. Implement the remaining language-provider integrations or clearly mark registry-only providers.
5. Add an Arc-owned MCP server if plugin exposure must work end-to-end.
6. Consider real DAP and test explorer UIs for `api.debug` and `api.tests`.
7. Replace polling git change notifications with watcher-driven updates.
8. Bump versions in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` when releasing.
