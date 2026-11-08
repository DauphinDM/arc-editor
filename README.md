# Glasswing

Glasswing is a desktop IDE prototype for modern web development, built with Tauri 2, React, TypeScript, and CodeMirror 6.

## Development

Install Node.js and Rust, then install frontend dependencies:

```sh
npm install
```

Run the frontend in a browser:

```sh
npm run dev
```

Run the desktop application:

```sh
npm run tauri dev
```

Create a production frontend build:

```sh
npm run build
```

Open a workspace with `Ctrl+K`, then `Ctrl+O`. Press `Ctrl+T` to open a terminal tab. Drag editor tabs to pane edges to create nested horizontal or vertical splits; drag onto a tab bar to join that pane. Drag dividers to resize panes. `Ctrl+\` splits vertically; `Ctrl+Shift+\` splits horizontally. `F2` renames selected files or folders inline; `Delete` asks before deletion. Right-click files, folders, or empty viewer space for actions. `Shift+Alt+F` formats with Prettier. Saving also formats supported files. `Ctrl+S` or `Cmd+S` saves; `Ctrl+W` saves and closes active editor; `Ctrl+B` hides or shows the file viewer.

## Current scope

- Tauri desktop shell with native folder selection and scoped filesystem access.
- Minimal dark workspace with a file viewer, inline file/folder creation, language icons, editor tabs, and drag-created split views.
- CodeMirror editing with syntax highlighting, visible indentation guides, and Prettier formatting for common frontend formats.
- Workspace file browsing, create file/folder, autosave on close, search, and HTML tag completion while typing.
- Built-in Live Server starts from file-viewer context menus, serves on localhost, and reloads pages after file changes.
- Integrated shell terminal tabs with split-pane support and persistent settings.

LSP remains a future milestone. Glasswing has no accounts or Git integration.
