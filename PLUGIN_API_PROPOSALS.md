# Arc Plugin API — Proposed Functions

Proposed additions, not currently implemented APIs. Each signature describes the intended behavior; final TypeScript types can be defined by Arc's maintainer. Optional arguments use `?`.

Prefer extending existing Arc APIs instead of adding duplicate implementations. Existing `api.workspace` is a path string, so workspace-folder functions use a separate namespace.

## Shared rules

- Registration and event-subscription functions return a disposable handle or unsubscribe function.
- Plugin-owned processes, sockets, workers, views, servers, and registrations are disposed automatically on disable/uninstall.
- Async operations support cancellation where applicable; streaming operations provide backpressure.
- File APIs default to workspace scope. Access outside it requires explicit permission.
- Process execution, networking, secrets, and MCP access require appropriate permissions. Pass executable arguments as arrays, not shell strings.
- Use structured errors with stable codes. Document which functions require desktop Arc and which platforms they support.

## Lifecycle and capabilities

| Function | Purpose |
| --- | --- |
| `api.supports(capability)` | Check whether this Arc version/platform supports a feature. |
| `api.disposables.add(resource)` | Attach a resource to the plugin's automatic cleanup lifecycle. |
| `api.lifecycle.onDeactivate(handler)` | Register async cleanup before the plugin is disabled or unloaded. |
| `api.lifecycle.onShutdown(handler)` | Register bounded, best-effort cleanup before Arc exits normally. |
| `api.timers.setTimeout(handler, delay)` | Schedule a one-off callback cancelled automatically on unload. |
| `api.timers.setInterval(handler, interval)` | Schedule repeated callbacks cancelled automatically on unload. |
| `api.workers.create(scriptPath)` | Start a plugin-owned worker for CPU-heavy work outside the UI thread. |

## Editor context and events

| Function | Purpose |
| --- | --- |
| `api.editor.getContext()` | Return focused editor metadata: URI/path, language, document version, cursor, selection, and dirty state. Distinguish editor focus from focused panels. |
| `api.editor.getLastActive()` | Return the last still-open source editor even when a plugin panel has focus. |
| `api.editor.getLanguage(path?)` | Return the actual language ID, including user overrides. |
| `api.editor.getCursor(path?)` | Return cursor line, column, and character offset. |
| `api.editor.getSelections(path?)` | Return all selections and cursors. |
| `api.editor.getVisibleRanges(path?)` | Return document ranges visible in the editor viewport. |
| `api.editor.onActiveChanged(handler)` | Notify when the active source editor changes or closes. |
| `api.editor.onContextChanged(handler)` | Notify when editor metadata changes, including language or focus. |
| `api.editor.onSelectionChanged(handler)` | Notify when selections or cursor positions change. |
| `api.editor.onDocumentOpened(handler)` | Notify when a document is opened. |
| `api.editor.onDocumentClosed(handler)` | Notify when a document is closed. |
| `api.editor.onDocumentChanged(handler)` | Deliver incremental edits and document versions, not necessarily whole document contents. |
| `api.editor.onDocumentSaved(handler)` | Notify after a document is successfully saved. |

## Editing and navigation

| Function | Purpose |
| --- | --- |
| `api.editor.replaceRange(range, text, path?)` | Replace a specific range without resetting the entire document. |
| `api.editor.applyEdits(edits, path?, expectedVersion?)` | Apply multiple edits as one undo operation; reject stale versions when supplied. |
| `api.editor.applyWorkspaceEdit(edit)` | Apply a coordinated multi-file edit with version checks and defined rollback behavior. |
| `api.editor.insertSnippet(snippet, range?, path?)` | Insert snippets with placeholders and tab stops. |
| `api.editor.revealRange(range, path?)` | Scroll a range into view. |
| `api.editor.openAt(path, line, column?)` | Open a document at a specific location. |
| `api.editor.setLanguage(languageId, path?)` | Change a document's language mode. |
| `api.editor.registerDecorationType(options)` | Define a reusable editor highlight, gutter marker, or inline decoration style. |
| `api.editor.setDecorations(type, ranges, path?)` | Apply or clear decorations for a document. |
| `api.editor.openDiff(leftUri, rightUri, title?)` | Open a comparison view for two documents. |
| `api.editor.registerContentProvider(scheme, provider)` | Supply virtual document content for a URI scheme. |
| `api.editor.registerCustomEditor(filePattern, provider)` | Provide specialized viewers/editors for matching files. |
| `api.editor.onWillSave(handler)` | Supply bounded, cancellable pre-save edits without recursive saves. |

## Language tooling

Selectors identify matching languages, URI schemes, and/or file patterns.

| Function | Purpose |
| --- | --- |
| `api.languages.register(definition)` | Register a language ID, extensions, aliases, and editor configuration. |
| `api.languages.registerCompletionProvider(selector, provider)` | Supply autocomplete suggestions and optional completion resolution. |
| `api.languages.registerHoverProvider(selector, provider)` | Supply hover documentation. |
| `api.languages.registerDefinitionProvider(selector, provider)` | Resolve go-to-definition locations. |
| `api.languages.registerReferenceProvider(selector, provider)` | Locate references to a symbol. |
| `api.languages.registerRenameProvider(selector, provider)` | Produce safe workspace edits for symbol renaming. |
| `api.languages.registerFormattingProvider(selector, provider)` | Format documents or selected ranges. |
| `api.languages.registerCodeActionProvider(selector, provider)` | Supply quick fixes and refactoring actions. |
| `api.languages.registerCodeLensProvider(selector, provider)` | Add contextual commands above source lines. |
| `api.languages.registerInlayHintsProvider(selector, provider)` | Supply inline hints such as inferred types or parameter names. |
| `api.languages.registerSignatureHelpProvider(selector, provider)` | Supply function signatures and active-parameter information. |
| `api.languages.registerDocumentSymbolProvider(selector, provider)` | Supply the current document's outline. |
| `api.languages.registerWorkspaceSymbolProvider(provider)` | Search symbols across workspace files. |
| `api.languages.registerSemanticTokensProvider(selector, provider)` | Supply semantic syntax-highlighting tokens. |
| `api.languages.registerFoldingProvider(selector, provider)` | Supply collapsible code regions. |
| `api.languages.registerSelectionRangeProvider(selector, provider)` | Supply increasingly broad syntax-aware selection ranges. |
| `api.languages.registerGrammar(languageId, grammar)` | Attach a supported syntax grammar to a language. |
| `api.languages.startServer(options)` | Start a plugin-owned Language Server Protocol client/server session. |
| `api.diagnostics.createCollection(name)` | Create an owned collection of errors, warnings, and informational diagnostics. |

## Workspace and files

| Function | Purpose |
| --- | --- |
| `api.workspaceFolders.get()` | List folders in a single-root or multi-root workspace. |
| `api.workspaceFolders.onChanged(handler)` | Notify when workspace folders are added or removed. |
| `api.workspaceTrust.isTrusted()` | Check whether the current workspace is trusted. |
| `api.workspaceTrust.onChanged(handler)` | Notify when trust is granted or revoked. |
| `api.files.listRecursive(path?, options?)` | Enumerate descendants with exclusions, depth/result limits, and cancellation. |
| `api.files.watch(pattern, handler, options?)` | Watch matching files for creation, changes, deletion, and supported rename notifications. |
| `api.files.find(pattern, options?)` | Find file paths using glob patterns and ignore rules. |
| `api.files.searchText(query, options?)` | Stream matching text locations across workspace files. |
| `api.files.readBytes(path)` | Read binary file data. |
| `api.files.writeBytes(path, bytes)` | Write binary file data. |
| `api.files.openReadStream(path)` | Read large files incrementally. |
| `api.files.openWriteStream(path)` | Write large files incrementally with backpressure. |
| `api.files.stat(path)` | Return file type, size, timestamps, and available permission metadata. |
| `api.files.exists(path)` | Check whether a path exists within permitted scope. |
| `api.files.move(source, destination)` | Move files/directories, including across directories, with explicit overwrite behavior. |
| `api.files.trash(path)` | Move a file to the system trash when supported. |
| `api.files.writeAtomic(path, content)` | Replace file contents atomically where the filesystem supports it. |
| `api.files.registerProvider(scheme, provider)` | Register a remote or virtual filesystem. |
| `api.paths.join(...parts)` | Join path segments using defined platform semantics. |
| `api.paths.resolve(...parts)` | Resolve a normalized absolute path without granting access to it. |
| `api.paths.relative(from, to)` | Compute a relative path between locations. |
| `api.paths.toUri(path)` | Convert a native path into an escaped file URI. |
| `api.paths.fromUri(uri)` | Convert a supported file URI into a native path. |

## Processes and sockets

| Function | Purpose |
| --- | --- |
| `api.process.spawn(executable, args, options?)` | Launch an owned background process with argument arrays, environment, cwd, and streaming I/O. |
| `api.process.which(executable)` | Locate an executable using the host environment. |
| `api.process.exec(executable, args, options?)` | Run a bounded command and collect exit status/stdout/stderr with output limits. |
| `api.pty.spawn(executable, args, options?)` | Launch an owned interactive process with a pseudo-terminal. |
| `api.ipc.connectUnix(path, options?)` | Open a permission-controlled binary Unix-domain socket connection. |
| `api.ipc.connectPipe(name, options?)` | Connect to a Windows named pipe. |
| `api.net.connectTcp(host, port, options?)` | Open a permission-controlled TCP connection. |
| `api.net.listenHttp(handler, options?)` | Start an owned HTTP server, loopback-only by default, with automatic port allocation and request limits. |

## Networking

| Function | Purpose |
| --- | --- |
| `api.net.fetch(url, options?)` | Make native HTTP requests with domain permissions, timeouts, cancellation, and streaming bodies. |
| `api.net.connectWebSocket(url, options?)` | Open an owned WebSocket connection. |
| `api.net.connectEventSource(url, options?)` | Consume a server-sent event stream with explicit reconnection policy. |
| `api.net.download(url, destination, options?)` | Download to a permitted location with progress and cancellation. |
| `api.net.isOnline()` | Return the host's best available network-connectivity indication. |
| `api.net.onOnlineChanged(handler)` | Notify when network connectivity changes. |

Native networking should respect system proxies/certificates and must not silently bypass plugin permissions merely because browser CORS does not apply.

## Icons and bundled assets

| Function | Purpose |
| --- | --- |
| `api.icons.register(name, svg)` | Register sanitized, plugin-namespaced SVG artwork for actions, views, and plugin branding. |
| `api.icons.unregister(name)` | Remove an icon owned by the calling plugin. |
| `api.icons.get(name)` | Retrieve a registered icon definition. |
| `api.assets.url(relativePath)` | Return a webview-safe URL for an installed plugin asset. |
| `api.assets.readText(relativePath)` | Read a bundled text asset. |
| `api.assets.readBytes(relativePath)` | Read a bundled binary asset. |
| `api.assets.resolvePath(relativePath)` | Resolve a bundled asset to a native path for permitted native helpers; prevent path traversal. |

Asset functions require installing the whole plugin folder. Extend existing action registration to accept custom icons, and support a manifest logo. Local asset URLs are not automatically accessible to external services such as Discord.

## UI and controls

| Function | Purpose |
| --- | --- |
| `api.ui.updateAction(id, changes)` | Change an existing action's label, icon, enabled state, checked state, or tooltip. |
| `api.ui.updateStatusItem(id, changes)` | Update a status-bar contribution without removing and recreating it. |
| `api.ui.registerMenuItem(menu, item)` | Add an owned item to a named editor/explorer/tab/toolbar menu. |
| `api.ui.registerSidebarView(options)` | Add a view to the sidebar. |
| `api.ui.registerBottomView(options)` | Add a view beside terminal/output/problems. |
| `api.ui.registerTreeView(options)` | Register a lazy-loaded tree with selection, expansion, icons, and item actions. |
| `api.ui.registerCustomTab(options)` | Open an owned custom editor-area tab with defined lifecycle. |
| `api.ui.setViewBadge(viewId, badge)` | Set or clear a view's count/status badge. |
| `api.ui.showQuickPick(items, options?)` | Display a searchable single- or multi-select picker. |
| `api.ui.showInputBox(options?)` | Display a validated text/password input dialog. |
| `api.ui.showProgress(options, task)` | Run work with progress reporting and optional cancellation. |
| `api.ui.showNotification(message, options?)` | Show severity, action buttons, and optional progress in a notification. |
| `api.ui.createOutputChannel(name)` | Create a named log/output stream visible in Arc. |
| `api.ui.setContext(key, value)` | Set plugin-scoped context used by declarative menu/keybinding conditions. |
| `api.ui.focusView(id)` | Focus a registered view. |
| `api.ui.closeView(id)` | Close a view where its placement supports closing. |

## Settings, storage, and secrets

| Function | Purpose |
| --- | --- |
| `api.configuration.register(schema)` | Declare settings, types, defaults, descriptions, scopes, and generated controls. |
| `api.configuration.get(key, fallback?)` | Read the effective setting after scope/default resolution. |
| `api.configuration.update(key, value, scope?)` | Validate and persist a setting globally or for a workspace. |
| `api.configuration.onChanged(handler)` | Notify when effective plugin settings change. |
| `api.storage.workspace.get(key, fallback?)` | Read plugin state scoped to the current workspace. |
| `api.storage.workspace.set(key, value)` | Persist plugin state scoped to the current workspace. |
| `api.storage.workspace.remove(key)` | Remove a workspace-scoped state entry. |
| `api.storage.workspace.clear()` | Clear only this plugin's state for the current workspace. |
| `api.secrets.get(key)` | Read a plugin-scoped secret from the OS credential store. |
| `api.secrets.set(key, value)` | Store a secret without placing it in normal settings or logs. |
| `api.secrets.delete(key)` | Remove a stored secret. |

## Commands and shortcuts

| Function | Purpose |
| --- | --- |
| `api.commands.list()` | Enumerate available commands and public metadata. |
| `api.commands.onExecuted(handler)` | Observe command IDs/status, without exposing sensitive arguments by default. |
| `api.keybindings.register(commandId, shortcut, condition?)` | Add a shortcut with context conditions and conflict handling. |
| `api.keybindings.unregister(commandId, shortcut)` | Remove a shortcut owned by the plugin. |

## Other plugins

| Function | Purpose |
| --- | --- |
| `api.plugins.list()` | List installed plugins and public version/enabled-state metadata. |
| `api.plugins.get(id)` | Inspect a specific plugin's public metadata. |
| `api.plugins.whenAvailable(id)` | Wait cancellably for a plugin to become available. |
| `api.plugins.onChanged(handler)` | Observe installation, update, enable, disable, and removal. |
| `api.services.register(name, implementation)` | Publish a versioned, plugin-namespaced service instead of a window global. |
| `api.services.get(name)` | Resolve an available public service. |
| `api.services.whenAvailable(name)` | Wait cancellably for a public service. |

## Theme and window

| Function | Purpose |
| --- | --- |
| `api.themes.getColors()` | Read documented semantic theme tokens. |
| `api.themes.onChanged(handler)` | Notify when the active theme or its tokens change. |
| `api.window.isFocused()` | Check whether Arc's window has focus. |
| `api.window.onFocusChanged(handler)` | Observe window focus changes. |
| `api.window.getVisibility()` | Read visible/minimized/hidden state where supported. |
| `api.window.onVisibilityChanged(handler)` | Observe visibility changes. |
| `api.window.getIdleTime()` | Read system/user idle duration where supported and permitted. |

## Git, tasks, and testing

| Function | Purpose |
| --- | --- |
| `api.git.getRepositories()` | List repositories associated with workspace folders. |
| `api.git.getStatus(repository)` | Read staged, unstaged, and untracked changes. |
| `api.git.getBranch(repository)` | Read current branch or detached-HEAD metadata. |
| `api.git.getDiff(repository, path?)` | Read repository/file diffs with explicit staged/unstaged options. |
| `api.git.onChanged(repository, handler)` | Observe status, HEAD, and branch changes. |
| `api.tasks.registerProvider(type, provider)` | Supply discoverable build/run task definitions. |
| `api.tasks.run(task)` | Execute a task and return a cancellable execution handle. |
| `api.tasks.onStarted(handler)` | Observe task execution start. |
| `api.tasks.onFinished(handler)` | Observe task completion and exit status. |
| `api.tests.createController(id, label)` | Create a test tree/controller with discovery, run/debug profiles, and results reporting. |

## Debugging, authentication, and links

| Function | Purpose |
| --- | --- |
| `api.debug.registerAdapter(type, factory)` | Register a Debug Adapter Protocol implementation/factory. |
| `api.debug.start(configuration)` | Start a debug session after configuration validation. |
| `api.debug.stop(sessionId)` | Stop a debug session. |
| `api.debug.getActiveSession()` | Read active debug-session metadata. |
| `api.debug.onSessionChanged(handler)` | Observe session start, stop, and active-session changes. |
| `api.auth.registerProvider(id, provider)` | Register an authentication provider with scoped sessions. |
| `api.auth.getSession(providerId, scopes, options?)` | Obtain an existing or user-approved authentication session. |
| `api.links.registerUriHandler(handler)` | Handle deep links routed to this plugin. |
| `api.links.createCallbackUrl(path)` | Create a plugin-scoped callback URL; authentication flows still need state/PKCE validation. |

## MCP — Model Context Protocol

Arc can act as an **MCP client/host** to connect to external servers, and optionally expose plugin contributions through an **Arc-owned MCP server**. These are separate roles. Route both through Arc's permission, trust, authentication, and lifecycle systems rather than making each plugin reimplement the protocol.

Use supported MCP protocol-version negotiation and capability detection. Standard transports are **stdio** for local servers and **Streamable HTTP** for remote servers; support legacy HTTP+SSE only when needed for compatibility. Protocol details can evolve independently of these proposed function names.

### MCP client: connections and server management

| Function | Purpose |
| --- | --- |
| `api.mcp.registerServer(id, definition)` | Declare a plugin-owned server connection profile: stdio executable/arguments or HTTP endpoint, metadata, and secret references. Registration alone must not silently execute it. |
| `api.mcp.unregisterServer(id)` | Remove an owned profile and close its owned connection. |
| `api.mcp.listServers()` | List server profiles visible to the plugin and their connection states, without exposing secrets. |
| `api.mcp.getServer(id)` | Read a permitted server's public metadata and status. |
| `api.mcp.connect(id, options?)` | Connect after required approval; initialize, negotiate protocol/capabilities, and return a server handle. |
| `api.mcp.disconnect(id)` | Close a connection and clean up owned transport/process resources. |
| `api.mcp.restart(id)` | Restart an owned local server or reconnect a remote server. |
| `api.mcp.getCapabilities(id)` | Read negotiated server capabilities instead of assuming tools/resources/prompts exist. |
| `api.mcp.onServerChanged(handler)` | Observe connection state, negotiated capabilities, failures, and profile changes. |
| `api.mcp.onLog(handler)` | Receive structured MCP server logging notifications with server attribution and secret redaction. |
| `api.mcp.setLogLevel(serverId, level)` | Request a supported server logging level. |
| `api.mcp.ping(serverId, options?)` | Check protocol responsiveness with a timeout. |

### MCP client: tools

| Function | Purpose |
| --- | --- |
| `api.mcp.listTools(serverId, options?)` | Enumerate tool names, descriptions, input schemas, optional output schemas, and annotations; handle pagination. |
| `api.mcp.callTool(serverId, name, arguments, options?)` | Validate input and request approved tool execution; return content, structured output, and tool-level error status. Support cancellation/progress. |
| `api.mcp.onToolsChanged(serverId, handler)` | Refresh tool discovery when a supporting server sends list-change notifications. |

Tool annotations such as read-only/destructive hints are not security guarantees. Protocol failures and tool results marked `isError` must remain distinguishable.

### MCP client: resources

| Function | Purpose |
| --- | --- |
| `api.mcp.listResources(serverId, options?)` | Enumerate resources with URIs, metadata, MIME types, and pagination. |
| `api.mcp.listResourceTemplates(serverId, options?)` | Enumerate parameterized resource URI templates. |
| `api.mcp.readResource(serverId, uri, options?)` | Read a permitted resource, preserving text/binary content and MIME metadata. |
| `api.mcp.subscribeResource(serverId, uri, handler)` | Subscribe to updates when the server supports resource subscriptions; return a disposable subscription. |
| `api.mcp.onResourcesChanged(serverId, handler)` | Observe resource-list changes when advertised by the server. |

### MCP client: prompts and completion

| Function | Purpose |
| --- | --- |
| `api.mcp.listPrompts(serverId, options?)` | Discover prompt templates and their arguments, including pagination. |
| `api.mcp.getPrompt(serverId, name, arguments?, options?)` | Resolve a prompt into its returned messages/content without automatically sending it to a model. |
| `api.mcp.onPromptsChanged(serverId, handler)` | Observe prompt-list changes when supported. |
| `api.mcp.complete(serverId, reference, argument, options?)` | Request argument completions for a prompt or resource-template reference when supported. |

### MCP client: host-side requests

These functions implement client capabilities requested by servers. Arc must advertise only capabilities it actually provides.

| Function | Purpose |
| --- | --- |
| `api.mcp.setRoots(serverId, roots)` | Set user-approved workspace roots visible to a connection and send roots-change notifications when supported. Roots describe scope; they are not an OS sandbox. |
| `api.mcp.onSamplingRequest(handler)` | Handle server-initiated model-generation requests through Arc's approved model access, budget controls, and user consent. |
| `api.mcp.onElicitationRequest(handler)` | Handle supported server requests for user input through Arc-owned consent UI; respect negotiated modes and never use forms to collect passwords or tokens. |
| `api.mcp.onAuthorizationRequired(handler)` | Surface remote-server authorization requirements through a trusted Arc authentication flow rather than arbitrary plugin HTML. |

### Expose plugin features through Arc's MCP server

| Function | Purpose |
| --- | --- |
| `api.mcp.exposeTool(definition, handler)` | Register a namespaced MCP tool with validated input/output schemas and an owned execution handler. |
| `api.mcp.exposeResource(definition, handler)` | Expose a specific permitted resource with URI, MIME type, and read handler. |
| `api.mcp.exposeResourceTemplate(definition, handler)` | Expose a parameterized resource with URI-template validation and scoped reads. |
| `api.mcp.exposePrompt(definition, handler)` | Publish a prompt template with declared arguments and a message-generation handler. |
| `api.mcp.notifyResourceChanged(uri)` | Notify subscribed clients when an exposed resource changes. |
| `api.mcp.getExposure()` | Inspect which of this plugin's contributions are enabled and visible to external MCP clients. |
| `api.mcp.onExposureChanged(handler)` | Observe user changes to this plugin's MCP exposure permissions. |

Registrations return disposables and trigger supported list-change notifications automatically. Arc owns server startup, transport, authentication, client access, and global enable/disable—not the plugin. Never expose every editor command, file, terminal, or secret by default.

### MCP requirements behind these functions

- Per-server and per-tool permissions, explicit approval for side effects, and revocable exposure settings.
- Local-process approval showing the real executable, arguments, working directory, and requested environment access.
- Scoped access to configured servers; plugins must not automatically inherit every connection or its credentials.
- Remote authentication using the applicable MCP authorization specification, secure credential storage, and token audience/resource validation. No token passthrough to unrelated services.
- Treat server tool output, resources, and prompts as untrusted data, not instructions that override user intent or security policy.
- Enforce workspace trust and filesystem permissions inside exposed handlers. MCP roots alone do not enforce filesystem boundaries.
- Timeouts, cancellation, progress, pagination, bounded output, redacted logs, and clear ownership attribution.
- HTTP servers bind to loopback by default, validate Origin where applicable, and require authentication for exposed sensitive capabilities. Remote exposure requires separate explicit approval.
- Do not advertise sampling, elicitation, subscriptions, or other optional features unless implemented and negotiated.

## Methods on returned handles

### Background process

| Function | Purpose |
| --- | --- |
| `process.write(data)` | Write to stdin with backpressure. |
| `process.closeStdin()` | Signal end-of-input without immediately terminating the process. |
| `process.onStdout(handler)` | Receive stdout chunks. |
| `process.onStderr(handler)` | Receive stderr chunks. |
| `process.onExit(handler)` | Receive exit code/signal and completion status. |
| `process.onError(handler)` | Observe spawn/I/O failures. |
| `process.stop(options?)` | Request graceful termination, then terminate the owned process tree after a deadline if needed. |

### Socket

| Function | Purpose |
| --- | --- |
| `socket.write(bytes)` | Send binary data with backpressure. |
| `socket.onData(handler)` | Receive binary chunks; callers handle message framing. |
| `socket.onError(handler)` | Observe transport errors. |
| `socket.onClose(handler)` | Observe connection closure. |
| `socket.close()` | Close the connection and release resources. |

### Diagnostics

| Function | Purpose |
| --- | --- |
| `diagnostics.set(uri, items)` | Replace this collection's diagnostics for a document. |
| `diagnostics.delete(uri)` | Remove this collection's diagnostics for one document. |
| `diagnostics.clear()` | Remove all diagnostics in the collection. |
| `diagnostics.dispose()` | Remove the collection and its contributions. |

### Output channel

| Function | Purpose |
| --- | --- |
| `output.append(text)` | Append text without adding a newline. |
| `output.appendLine(text)` | Append a line of text. |
| `output.show()` | Reveal the output channel. |
| `output.clear()` | Clear displayed output. |
| `output.dispose()` | Remove the channel and release its buffers. |

## Suggested first implementation batch

1. `api.editor.getContext()`, `getLastActive()`, and context-change events.
2. `api.process.spawn()`, owned process cleanup, and Unix-socket/named-pipe connections.
3. Bundled-asset functions, icon registration, and action/status updates.
4. Declarative configuration and OS-backed secrets.
5. MCP connection management plus tools/resources/prompts, followed by carefully permissioned plugin exposure.

These remove the largest workarounds used by the Discord RPC, shared-icon, and plugin-logo extensions without hardcoding one extension's functionality into Arc.
