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
