# Plugin API — Missing Feature Checklist

Features present in `PLUGIN_API_PROPOSALS.md` but absent from `PLUGIN_API.md`. Each item must be verified as functional, not merely documented. Check an item only after its behavior is implemented and tested.

Status key: `[ ]` not done, `[x]` implemented and verified.

## Lifecycle

- [x] `api.timers.setTimeout`
- [x] `api.timers.clearTimeout`

## Editor context and events

- [x] `api.editor.getLastActive`
- [x] `api.editor.getLanguage`
- [x] `api.editor.getCursor`
- [x] `api.editor.getSelections`
- [x] `api.editor.getVisibleRanges`
- [x] `api.editor.onContextChanged`

## Languages

- [x] `api.languages.registerHoverProvider`
- [x] `api.languages.registerDefinitionProvider`
- [x] `api.languages.registerReferenceProvider`
- [x] `api.languages.registerRenameProvider`
- [x] `api.languages.registerCodeActionProvider`
- [x] `api.languages.registerCodeLensProvider`
- [x] `api.languages.registerInlayHintsProvider`
- [x] `api.languages.registerSignatureHelpProvider`
- [x] `api.languages.registerDocumentSymbolProvider`
- [x] `api.languages.registerWorkspaceSymbolProvider`
- [x] `api.languages.registerSemanticTokensProvider`
- [x] `api.languages.registerFoldingProvider`
- [x] `api.languages.registerSelectionRangeProvider`
- [x] `api.languages.registerGrammar`
- [x] `api.languages.startServer`

## Files and paths

- [x] `api.files.openWriteStream`
- [x] `api.files.exists`
- [x] `api.files.registerProvider`
- [x] `api.paths.join`
- [x] `api.paths.fromUri`

## Processes and sockets

- [x] `api.ipc.connectPipe`
- [x] `process.closeStdin`
- [x] `process.onStderr`
- [x] `process.onExit`
- [x] `process.onError`
- [x] `socket.onError`
- [x] `socket.onClose`
- [x] `socket.close`

## Networking

- [x] `api.net.isOnline`

## Icons and assets

- [x] `api.icons.unregister`
- [x] `api.assets.readBytes`
- [x] `api.assets.resolvePath`

## UI

- [x] `api.ui.registerTreeView`
- [x] `api.ui.setContext`
- [x] `api.ui.focusView`
- [x] `api.ui.closeView`
- [x] `output.append`
- [x] `output.clear`
- [x] `output.dispose`

## Diagnostics

- [x] `collection.delete`
- [x] `collection.clear`
- [x] `collection.dispose`

## Storage and services

- [x] `api.storage.workspace.remove`
- [x] `api.storage.workspace.clear`
- [x] `api.services.get`

## Commands, keybindings, and plugins

- [x] `api.commands.list`
- [x] `api.keybindings.unregister`
- [x] `api.plugins.get`
- [x] `api.plugins.onChanged`

## Window

- [x] `api.window.onVisibilityChanged`
- [x] `api.window.getIdleTime`

## Tasks and debugging

- [x] `api.tasks.onStarted`
- [x] `api.tasks.onFinished`
- [x] `api.debug.registerAdapter`
- [x] `api.debug.stop`
- [x] `api.debug.getActiveSession`
- [x] `api.debug.onSessionChanged`

## MCP

- [x] `api.mcp.unregisterServer`
- [x] `api.mcp.listServers`
- [x] `api.mcp.getServer`
- [x] `api.mcp.disconnect`
- [x] `api.mcp.restart`
- [x] `api.mcp.getCapabilities`
- [x] `api.mcp.onServerChanged`
- [x] `api.mcp.setLogLevel`
- [x] `api.mcp.ping`
- [x] `api.mcp.listResourceTemplates`
- [x] `api.mcp.readResource`
- [x] `api.mcp.subscribeResource`
- [x] `api.mcp.onResourcesChanged`
- [x] `api.mcp.listPrompts`
- [x] `api.mcp.getPrompt`
- [x] `api.mcp.onPromptsChanged`
- [x] `api.mcp.complete`
- [x] `api.mcp.setRoots`
- [x] `api.mcp.onSamplingRequest`
- [x] `api.mcp.onElicitationRequest`
- [x] `api.mcp.onAuthorizationRequired`
- [x] `api.mcp.exposeTool`
- [x] `api.mcp.exposeResource`
- [x] `api.mcp.exposeResourceTemplate`
- [x] `api.mcp.exposePrompt`
- [x] `api.mcp.notifyResourceChanged`
- [x] `api.mcp.getExposure`
- [x] `api.mcp.onExposureChanged`

## Verification gates

- [x] `npm run build`
- [x] `cargo test`
- [x] Search runtime for remaining registry-only or stub implementations
- [x] Update `PLUGIN_API.md` only for verified behavior

## Notes

- `api.ipc.connectPipe` is implemented and works on Windows only; Unix returns a clear platform error.
- `api.window.getIdleTime` reports milliseconds since the last keyboard, pointer, wheel, or focus activity in Arc. Tauri has no cross-platform system-idle API.
- `api.mcp.notifyResourceChanged` notifies plugins locally. The loopback HTTP MCP bridge is request/response only, so external MCP clients re-read resources instead of receiving push updates.
- Provider results use the documented CodeMirror-friendly shapes; provider failures are isolated per provider.
