# Arc Plugin API

This guide describes the JavaScript API available to installed Arc plugins. Keep this file beside your coding agent while building a plugin.

## Quick start

Create a folder containing `plugin.json` and `main.js`:

```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "A sample Arc plugin",
  "main": "main.js"
}
```

```js
export function activate(api) {
  api.ui.registerAction({
    id: "hello",
    label: "Hello",
    icon: "puzzle",
    onClick: () => api.ui.notify(`Hello from ${api.plugin.name}!`),
  });

  return () => {
    // Release timers, subscriptions, styles, and other resources here.
  };
}
```

Install the folder from **Plugins → Install from folder**. `activate(api)` runs when plugin enables. Return cleanup function to release plugin resources on disable or uninstall.

## Plugin API overview

| API | Purpose |
| --- | --- |
| `api.plugin` | Current plugin ID, name, and version |
| `api.app` | Read app state, open workspaces and built-in panels, set window title |
| `api.files` | List, read, write, create, delete, rename, copy, open, and refresh workspace files |
| `api.editor` | Read and edit active or open documents, selections, save, format, and focus |
| `api.terminal` | Open, list, send input, resize, and close terminal sessions |
| `api.settings`, `api.themes` | Read and change app settings and themes |
| `api.dialogs`, `api.clipboard` | Open/save dialogs and read/write text or HTML clipboard data |
| `api.window` | Minimize, maximize, resize, fullscreen, center, keep on top, or close app window |
| `api.ui` | Notifications, prompts, toolbar actions, context menus, status items, commands, panels, CSS |
| `api.commands` | Execute commands registered by plugins |
| `api.events` | Subscribe to app events or publish plugin-scoped events |
| `api.storage` | Persistent key/value storage scoped to this plugin |
| `api.localServer` | Start and stop plugin-owned local HTTP server |
| `api.process` | Check executable names on Linux |
| `api.codemirror` | Shared CodeMirror/Lezer modules for language plugins |
| `api.languages`, `api.diagnostics` | Register languages, providers, grammars, and diagnostic collections |
| `api.paths`, `api.workspaceFolders`, `api.workspaceTrust` | Path helpers and workspace metadata |
| `api.process`, `api.pty`, `api.ipc`, `api.net` | Owned processes, terminals, sockets, HTTP servers, fetch, WebSockets, downloads |
| `api.icons`, `api.assets` | Register SVG icons and read bundled plugin assets |
| `api.configuration`, `api.secrets` | Declarative settings and plugin-scoped secrets |
| `api.keybindings`, `api.plugins`, `api.services` | Shortcuts, installed-plugin metadata, and cross-plugin services |
| `api.git`, `api.tasks`, `api.tests`, `api.debug`, `api.auth`, `api.links` | Git, tasks, test controllers, debugging, authentication, and URI links |
| `api.mcp` | MCP stdio/HTTP client, tools, resources, prompts, and exposure |
| `api.lifecycle`, `api.timers`, `api.disposables` | Automatic plugin cleanup lifecycle |
| `api.invoke` | Invoke a Tauri command directly |
| `api.openUrl`, `api.openTerminal`, `api.notify` | Convenience aliases for common UI actions |

Workspace file paths use paths relative to current workspace, such as `src/main.js`. `api.workspace` is current workspace path, or an empty string when no workspace is open.

## App control

```js
const state = api.app.getState();
console.log(state.workspace, state.activeFile, state.openFiles, state.terminals);

await api.app.openWorkspace();
api.app.openSettings();
api.app.openGithub();
api.app.openPlugins();
api.app.openPanel("my-panel");
api.app.setTitle("Arc — My Plugin");
```

`getState()` returns workspace path, active file, open files and dirty flags, terminal sessions, settings, and active theme.

## Workspace files

```js
const entries = await api.files.list("src"); // Immediate children only.
const text = await api.files.read("src/main.js");
await api.files.write("src/main.js", `${text}\n// Updated by plugin\n`);
await api.files.create("notes/plugin-notes.md", "Created by plugin.\n");
await api.files.createDirectory("generated/reports");
await api.files.copy("src/main.js", "backup/main.js");
await api.files.rename("src/main.js", "src/app.js"); // Same directory only.
await api.files.delete("backup/main.js");
await api.files.open("src/app.js");
await api.files.refresh();
```

`files.list(path)` returns `{ path, name, kind }` objects for one directory. `files.create` creates missing parent folders. `files.write` updates an open editor and saves it when that file is open. `files.delete` updates editor and file-viewer state.

## Editor control

```js
const editor = api.editor.getActive();
if (editor) {
  console.log(editor.path, editor.text, editor.dirty, editor.selection);
  api.editor.setSelection(0, 0, editor.path);
  api.editor.insertText("// Inserted by plugin\n", editor.path);
  await api.editor.save(editor.path);
}

await api.editor.open("src/main.js");
api.editor.setText("console.log('Hello');\n");
api.editor.focus();
await api.editor.format();
```

Editor methods accept optional workspace-relative file path. Without a path, methods use active editor. `getActive()` returns `null` when no file editor is active.

## Terminal control

```js
const id = api.terminal.open("npm test");
console.log(api.terminal.list());
if (id) {
  await api.terminal.write(id, "\r");
  await api.terminal.resize(id, 100, 30);
  // Keep session open, or close it later:
  // await api.terminal.close(id);
}
```

`api.openTerminal(command)` is a shorthand for `api.terminal.open(command)`.

## Settings and themes

```js
const settings = api.settings.get();
api.settings.update({ wordWrap: true, tabSize: 4 });

const themes = api.themes.list();
api.themes.set(themes[0].id);
```

`settings.update` accepts partial app settings. `themes.set(id)` returns `false` when theme ID does not exist.

## Dialogs and clipboard

```js
const files = await api.dialogs.openFile({
  multiple: true,
  filters: [{ name: "Source files", extensions: ["js", "ts", "php"] }],
});
const folder = await api.dialogs.openFolder();
const savePath = await api.dialogs.saveFile({ defaultPath: "report.txt" });

const copied = await api.clipboard.readText();
await api.clipboard.writeText(copied.toUpperCase());
await api.clipboard.writeHtml("<strong>Hello</strong>", "Hello");
```

File dialogs return selected path, an array of paths, or `null` when canceled.

## Window control

```js
await api.window.setSize(1200, 800);
await api.window.center();
await api.window.toggleMaximize();
await api.window.setFullscreen(true);
await api.window.setAlwaysOnTop(true);
await api.window.minimize();
await api.window.close(); // Closes Arc.
```

Window controls require Arc desktop. Closing app ends all plugin sessions.

## UI contributions

### Toolbar actions

```js
api.ui.registerAction({
  id: "build",
  label: "Build",
  title: "Build current workspace",
  icon: "puzzle",
  onClick: async () => {
    await api.terminal.open("npm run build");
  },
});
```

Toolbar icons: `puzzle`, `globe`, or `server`. Unknown icon values use the puzzle icon.

### Context menu items

```js
api.ui.registerContextMenuItem({
  id: "inspect-file",
  label: "Inspect with plugin",
  onClick: ({ workspace, target }) => {
    api.ui.notify(target ? `${workspace}/${target.path}` : workspace);
  },
});
```

Context contains workspace path and optional `{ name, path, kind }` target.

### Status bar

```js
api.ui.registerStatusItem({
  id: "mode",
  text: "Preview: Ready",
  tooltip: "Click to open preview settings",
  position: "right",
  onClick: () => api.app.openPanel("preview-settings"),
});
```

### Plugin panels

```js
api.ui.registerPanel({
  id: "preview-settings",
  title: "Preview Settings",
  mount(container) {
    const heading = document.createElement("h2");
    heading.textContent = "Preview Settings";
    container.replaceChildren(heading);
    return () => container.replaceChildren();
  },
});
```

Panels appear in Plugin Manager and open as editor tabs. `mount` receives a DOM element. Return a cleanup function to release listeners and DOM resources.

### CSS and dialogs

```js
const removeStyles = api.ui.addStyles(`
  .editor-pane { --plugin-accent: #7c9cff; }
`);
api.ui.notify("Plugin started");
if (api.ui.confirm("Continue?")) {
  const value = api.ui.prompt("Enter value", "example");
}
// Call removeStyles() when style should stop applying.
```

Styles apply across Arc. Arc removes registered plugin styles when plugin disables.

## Commands and command palette

Commands appear in command palette opened with **Ctrl+Shift+P** (or **Cmd+Shift+P** on macOS). Optional shortcuts support `Ctrl`, `Cmd`, `Shift`, and `Alt`, such as `Ctrl+Shift+F`.

```js
api.ui.registerCommand({
  id: "format-active",
  title: "Format active file with My Plugin",
  description: "Runs plugin-specific formatting",
  shortcut: "Ctrl+Shift+F",
  run: () => api.editor.format(),
});

await api.commands.execute("format-active");
```

Use `api.commands.execute("plugin-id:command-id")` to execute another enabled plugin's command.

## Events

```js
const stopListening = api.events.on("editor:changed", (event) => {
  console.log(event.path, event.content);
});

api.events.on("workspace:changed", ({ path }) => console.log(path));
api.events.on("file:saved", ({ path }) => console.log(`Saved ${path}`));
api.events.emit("ready", { time: Date.now() }); // Emits plugin:<your-plugin-id>:ready.

// stopListening() is optional; disable also removes plugin event listeners.
```

App events: `workspace:changed`, `editor:active`, `editor:changed`, `file:saved`, `settings:changed`, `terminal:opened`, `terminal:closed`.

## Plugin storage

```js
api.storage.set("lastBuild", { status: "passed", time: Date.now() });
const lastBuild = api.storage.get("lastBuild", null);
api.storage.remove("lastBuild");
api.storage.clear(); // Clears only this plugin's keys.
```

## Native services

```js
const server = await api.localServer.start(api.workspace, "index.html");
await api.openUrl(server.url);
await api.localServer.stop();

const isRunning = await api.process.isRunning(["httpd", "mysqld"]);
```

The local HTTP server is scoped to your plugin ID and stops when plugin deactivates. Process lookup supports Linux; other platforms return `false`.

## Lifecycle and compatibility

- Plugin source is a self-contained JavaScript ES module. Do not use bare package imports.
- `activate(api)` may be asynchronous and may return a cleanup function.
- Contributions, event subscriptions, and styles disappear when plugin disables.
- Plugin JavaScript runs with broad access to Arc and Tauri APIs. Install plugins only from trusted sources.
- Prefer public `api.*` methods over direct `api.invoke` calls. Native command names may change.
- Plugin IDs and contribution IDs use lowercase letters, numbers, dots, underscores, and hyphens.

## Extended API

The following namespaces extend the plugin API. They follow the same lifecycle rules: registrations, subscriptions, timers, workers, processes, sockets, servers, and MCP sessions created by a plugin are released when the plugin is disabled or uninstalled. Functions that register a contribution return a disposable function.

### Lifecycle and capabilities

```js
if (api.supports("process.spawn")) { /* feature available */ }

const unsubscribe = api.ui.registerStatusItem({ /* ... */ });
api.disposables.add(unsubscribe);

api.lifecycle.onDeactivate(async () => {
  // Async cleanup before disable/uninstall.
});
api.lifecycle.onShutdown(() => {
  // Best-effort cleanup before Arc exits.
});

const timer = api.timers.setInterval(() => api.ui.notify("tick"), 10_000);
api.timers.clearInterval(timer); // Optional; unload cancels it automatically.

const worker = api.workers.create(await api.assets.url("worker.js"));
```

### Editor context and events

```js
const context = api.editor.getContext();
// { path, uri, name, language, version, cursor, selection, selections,
//   dirty, focused, visibleRanges }

api.editor.onActiveChanged((context) => console.log("active", context?.path));
api.editor.onSelectionChanged((context) => console.log(context?.cursor));
api.editor.onDocumentOpened(({ path, name }) => console.log(path, name));
api.editor.onDocumentClosed(({ path }) => console.log(path));
api.editor.onDocumentChanged(({ path, content }) => console.log(path));
api.editor.onDocumentSaved(({ path }) => console.log(path));
```

Editor navigation and edits:

```js
api.editor.replaceRange({ from: 0, to: 4 }, "const", "src/main.js");
api.editor.applyEdits([{ range: { from: 0, to: 0 }, text: "// Arc\n" }], "src/main.js");
await api.editor.applyWorkspaceEdit({
  changes: { "src/main.js": [{ range: { from: 0, to: 0 }, text: "// hi\n" }] },
});
api.editor.insertSnippet("console.log(${1:value});$0", undefined, "src/main.js");
api.editor.revealRange({ from: 0, to: 20 }, "src/main.js");
await api.editor.openAt("src/main.js", 12, 3);
api.editor.setLanguage("markdown", "src/main.js");
await api.editor.openDiff("file:///a.txt", "file:///b.txt", "Compare");
```

Decorations, custom editors, virtual content, and pre-save hooks:

```js
const type = api.editor.registerDecorationType({ className: "my-highlight" });
api.editor.setDecorations(type, [{ from: 0, to: 8 }], "src/main.js");

api.editor.registerContentProvider("my-plugin", {
  read: async (uri) => "virtual content",
});
api.editor.registerCustomEditor("**/*.cell", {
  mount(container, context) { /* custom viewer */ },
});
api.editor.onWillSave(async ({ path, content }) => content.trimEnd() + "\n");
```

### Languages and diagnostics

```js
api.languages.register({
  id: "csharp",
  name: "C#",
  extensions: ["cs"],
  filenames: ["*.csproj"],
  load: () => importExtension,
});

api.languages.registerCompletionProvider({ language: "csharp" }, {
  provideCompletionItems: async ({ text, offset }) => [
    { label: "Console", type: "class" },
  ],
});
api.languages.registerFormattingProvider({ language: "csharp" }, {
  provideFormatting: async ({ text }) => text.trim(),
});

const collection = api.diagnostics.createCollection("csharp");
collection.set("file:///src/Program.cs", [
  { severity: "error", message: "Missing semicolon", from: 10, to: 20 },
]);
```

All language provider registrations return disposables. `api.codemirror` exposes Arc's own `language`, `view`, `state`, `autocomplete`, and `highlight` modules so plugins do not bundle duplicate CodeMirror or Lezer instances.

### Files, workspace, and paths

```js
const entries = await api.files.listRecursive("src", { maxDepth: 4 });
const all = await api.files.find("**/*.ts", { exclude: ["dist"] });
const hits = await api.files.searchText("TODO", { include: "src/**" });
const bytes = await api.files.readBytes("logo.png");
await api.files.writeBytes("copy.png", bytes);
await api.files.writeAtomic("settings.json", "{}");
await api.files.move("a.txt", "archive/a.txt", { overwrite: true });
await api.files.trash("old.txt");
const info = await api.files.stat("a.txt");
const stopWatching = api.files.watch("src/**", (event) => console.log(event));

const stream = await api.files.openReadStream("large.bin");
const chunk = await stream.read(64 * 1024);
await stream.close();

const folder = await api.paths.resolve(api.workspace, "src");
const uri = api.paths.toUri(folder);
const relative = api.paths.relative(api.workspace, folder);
```

`api.workspaceFolders.get()` lists workspace folders. `api.workspaceTrust.isTrusted()` reports whether the active workspace is trusted. Both namespaces provide `onChanged` subscriptions.

### Processes, PTYs, sockets, and HTTP

```js
const proc = await api.process.spawn("npm", ["run", "dev"], { cwd: api.workspace });
proc.onStdout((chunk) => console.log(chunk));
await proc.write("q");
await proc.stop();

const result = await api.process.exec("git", ["status"], { cwd: api.workspace });
const gitPath = await api.process.which("git");

const pty = await api.pty.spawn("bash", [], { cwd: api.workspace });
pty.onStdout((chunk) => console.log(chunk));

const socket = await api.ipc.connectUnix("/tmp/my.sock");
socket.onData((bytes) => console.log(bytes));
await socket.write(new TextEncoder().encode("ping\n"));

const tcp = await api.net.connectTcp("127.0.0.1", 9000);
const server = await api.net.listenHttp(async (request) => ({
  status: 200,
  headers: { "content-type": "text/plain" },
  body: "ok",
}));
console.log(server.url);
await server.close();
```

### Networking

```js
const response = await api.net.fetch("https://example.com", { timeoutMs: 10_000 });
const ws = await api.net.connectWebSocket("wss://example.com/socket");
ws.onMessage((data) => console.log(data));

const events = api.net.connectEventSource("https://example.com/events");
events.onMessage((event) => console.log(event.data));

await api.net.download("https://example.com/file.zip", "downloads/file.zip", {
  onProgress: (received, total) => console.log(received, total),
});

api.net.onOnlineChanged((online) => console.log("online", online));
```

### Icons, assets, and UI

```js
api.icons.register("logo", "<svg viewBox='0 0 16 16'>...</svg>");
const logo = api.icons.get("logo");

const url = await api.assets.url("logo.svg");
const text = await api.assets.readText("templates/page.html");

api.ui.updateAction("build", { label: "Build again", enabled: false });
api.ui.updateStatusItem("mode", { text: "Ready" });
api.ui.registerMenuItem("explorer/context", {
  id: "inspect",
  label: "Inspect",
  onClick: () => api.ui.notify("Inspected"),
});

api.ui.registerSidebarView({ id: "outline", title: "Outline", mount(container) {} });
api.ui.registerBottomView({ id: "problems", title: "Problems", mount(container) {} });
api.ui.registerCustomTab({ id: "preview", title: "Preview", mount(container) {} });
api.ui.setViewBadge("outline", 3);

const picked = await api.ui.showQuickPick([
  { label: "Development", value: "dev" },
  { label: "Production", value: "prod" },
]);
const name = await api.ui.showInputBox({
  prompt: "Project name",
  validate: (value) => (value ? null : "Required"),
});
await api.ui.showProgress({ title: "Indexing" }, async (report) => {
  report("Scanning files");
});
api.ui.showNotification("Deploy complete", {
  severity: "info",
  actions: [{ label: "Open log", run: () => console.log("log") }],
});

const output = api.ui.createOutputChannel("My Plugin");
output.appendLine("Started");
output.show();
```

### Configuration, storage, secrets, and services

```js
api.configuration.register({
  id: "settings",
  title: "My Plugin",
  properties: {
    endpoint: { type: "string", default: "https://example.com" },
    trace: { type: "boolean", default: false },
  },
});
const endpoint = api.configuration.get("endpoint", "https://example.com");
api.configuration.update("trace", true);
api.configuration.onChanged(({ key, value }) => console.log(key, value));

api.storage.workspace.set("lastFile", "src/main.js");
const lastWorkspaceFile = api.storage.workspace.get("lastFile", null);

await api.secrets.set("token", "secret-value");
const token = await api.secrets.get("token");
await api.secrets.delete("token");

api.services.register("my-plugin:api", { hello: () => "hi" });
const service = await api.services.whenAvailable("my-plugin:api");
```

### Commands, keybindings, plugins, themes, and window

```js
api.commands.onExecuted(({ id, pluginId, success }) => console.log(id, success));
api.keybindings.register("build", "Ctrl+Alt+B");

const installed = api.plugins.list();
await api.plugins.whenAvailable("other-plugin");

const colors = api.themes.getColors();
api.themes.onChanged((theme) => console.log(theme.name));

const focused = await api.window.isFocused();
api.window.onFocusChanged((isFocused) => console.log(isFocused));
console.log(api.window.getVisibility());
```

### Git, tasks, tests, debugging, auth, and links

```js
const repositories = await api.git.getRepositories();
const status = await api.git.getStatus(repositories[0]);
const branch = await api.git.getBranch();
const diff = await api.git.getDiff(repositories[0], "src/main.js");
const stopPolling = api.git.onChanged(repositories[0], () => console.log("git changed"));

api.tasks.registerProvider("npm", {
  provideTasks: async () => [{ label: "dev", executable: "npm", args: ["run", "dev"] }],
});
const run = await api.tasks.run({ executable: "npm", args: ["test"] });
run.onExit(({ code }) => console.log(code));

const tests = api.tests.createController("unit", "Unit Tests");
tests.setItems([{ label: "parses input", status: "passed" }]);

const session = await api.debug.start({ type: "my-debugger", program: "app.js" });
await session.stop();

api.auth.registerProvider("github", {
  getSessions: async () => null,
  createSession: async (scopes) => ({ token: "..." }),
});
const auth = await api.auth.getSession("github", ["repo"], { createIfNone: true });

api.links.registerUriHandler((uri) => console.log(uri));
const callback = api.links.createCallbackUrl("oauth");
```

### MCP (Model Context Protocol)

```js
api.mcp.registerServer("local", {
  type: "stdio",
  command: "my-mcp-server",
  args: ["--stdio"],
});
const server = await api.mcp.connect("local");
const tools = await api.mcp.listTools("local");
const result = await api.mcp.callTool("local", "read_file", { path: "README.md" });
const resources = await api.mcp.listResources("local");

api.mcp.onToolsChanged("local", () => console.log("tools changed"));
api.mcp.onLog(({ serverId, level, message }) => console.log(serverId, level, message));

api.mcp.exposeTool({ name: "hello" }, async () => ({ content: "hello" }));
```

Remote MCP servers use Streamable HTTP when `type: "http"` and a `url` are supplied. Local servers use stdio with the configured executable, arguments, working directory, and environment. Connections, notifications, cancellation, timeouts, tools, resources, prompts, completion, roots, sampling/elicitation handlers, and exposure registration are routed through Arc's plugin lifecycle.
