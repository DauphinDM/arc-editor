# Plugin API Expansion — Implementation Notes

Status: implementation substantially complete. Continuation work completed generated plugin configuration controls and OS-backed secrets.

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
  - one `type_complexity` suggestion on the HTTP request parser.
- Final edit added cleanup when plugin activation throws. Later `npm run build` runs passed.
- Continuation: `npm run build`, `cargo check`, `cargo test` (4 passed), and `cargo clippy` pass. Clippy reports two pre-existing warnings (`type_complexity`, `unnecessary_sort_by`).
- Follow-up implementation added working provider dispatch, LSP client handles, DAP adapter startup, real idle timing, tree expansion/actions, MCP exposure HTTP endpoint, and true streaming write handles.

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

- Definition (`F12`), reference (`Shift+F12`), rename (`F2`), code actions (`Mod-.`), signature help (`Ctrl+Shift+Space`), document/workspace symbols (command palette), code lens, inlay hints, semantic tokens, selection range (`Shift+Alt+Right`), folding, hover, completion, formatting, and grammars are consumed by the editor.
- `startServer` now performs the LSP initialize/initialized handshake and returns `request`, `notify`, `onNotification`, `onRequest`, and `shutdown` handle methods.
- Diagnostic collections store data and emit `diagnostics:changed`, but are not yet rendered as editor squiggles or a problems view.
- Language server documents are not synchronized automatically; plugins send `textDocument/*` notifications through the returned handle.
- Provider result handling accepts documented CodeMirror-friendly shapes; complex LSP-shaped objects are normalized where practical.

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
- `openWriteStream` writes chunks immediately through a real file handle; `close()` finalizes the handle and refreshes the workspace.

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
- Registered schemas appear in **Settings → Plugins** with generated controls for string, number, integer, boolean, object, array, and enum properties.
- `scope: "workspace"` persists per workspace; other values are global. Settings UI edits notify only the owning plugin through `api.configuration.onChanged`.
- Workspace storage is keyed by plugin and workspace path.
- Services are plugin-registered values and support waiting/listeners.
- Secrets are plugin-scoped and stored in the OS credential store through the `keyring` crate (Secret Service, Keychain, Credential Manager).
- Legacy base64 secrets in `localStorage` migrate to the credential store on first read. Secrets refuse to save when no credential store is available.

Limitations:

- Generated configuration controls cover scalar and JSON object/array values; there is no per-property custom editor registration.
- Secret reads keep returning a legacy `localStorage` value if the OS credential store is unavailable during migration.

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

- Debug adapters may provide `start`/`stop` callbacks or stdio `command`/`args`; the built-in path performs DAP `initialize` and `launch`/`attach` framing but does not yet broker breakpoints, stack traces, or variables.
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

- Arc starts a loopback streamable-HTTP MCP endpoint when the first exposure is registered. `getExposure()` returns the URL and bearer authorization value.
- The endpoint supports initialize, ping, tools, resources, resource templates, and prompts. External list-change push notifications are not implemented; clients re-read resources because the HTTP bridge is request/response only.
- Exposure registration is lifecycle-managed and namespace-prefixed by owning plugin.
- Remote authorization UI is not implemented; `onAuthorizationRequired` handles server notifications through plugin code.

## Documentation

`PLUGIN_API.md` now has an “Extended API” section with examples for every added namespace. The overview table includes the new namespaces.

## Suggested next steps

1. Wire custom editors and content providers into `EditorPane`/file opening.
2. Render diagnostics as editor squiggles and a problems view.
3. Expand DAP brokering to breakpoints, stack traces, variables, and a debug UI.
4. Consider a test explorer UI for `api.tests`.
5. Replace polling git change notifications with watcher-driven updates.
6. Add stream/push transport to the MCP exposure server if external resource notifications are required.
7. Bump versions in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` when releasing.
