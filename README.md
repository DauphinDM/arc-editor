# Arc

Arc is a desktop workspace for editing and running web projects. It brings a code editor, file browser, split views, terminal, local preview, and GitHub tools into one window.

## Download

Get the latest Windows, Linux, or macOS build from [GitHub Releases](https://github.com/TibeDev/vdb-ide/releases/latest).

Builds are currently unsigned. Windows and macOS may show a security prompt the first time you open Arc.

## Features

- Edit JavaScript, TypeScript, JSX, TSX, HTML, CSS, SCSS, PHP, JSON, and Markdown with syntax highlighting. Arc also provides HTML-tag and PHP completion.
- Browse, search, create, rename, move, copy, and delete workspace files. Undo file deletions with `Ctrl+Z`.
- Keep multiple editor tabs open. Drag tabs to create nested splits or move them between panes.
- Open shell terminals in the current workspace, with multiple tabs and splits.
- Preview a workspace through the included Live Server plugin. File changes reload in the browser.
- Stage and commit changes, switch or create branches, pull and push, or publish a GitHub repository from the GitHub panel.
- Change editor and terminal settings, choose built-in color themes, or create your own.
- Install local JavaScript plugins. Arc includes Live Server and Linux-only XAMPP plugins.

Arc does not include language-server support yet. The GitHub panel requires Git and GitHub CLI (`gh`).

## Shortcuts

| Shortcut                    | Action                                      |
| --------------------------- | ------------------------------------------- |
| `Ctrl+K`, then `Ctrl+O`     | Open a workspace folder                     |
| `Ctrl+N` / `Ctrl+Shift+N`   | Create a file / folder                      |
| `Ctrl+T`                    | Open a terminal                             |
| `Ctrl+Shift+P`              | Open the command palette                    |
| `Ctrl+\\` / `Ctrl+Shift+\\` | Split editor vertically / horizontally      |
| `Ctrl+B`                    | Show or hide the file browser               |
| `Ctrl+S` / `Ctrl+W`         | Save / save and close the active editor     |
| `F2` / `Delete`             | Rename / delete the selected file or folder |
| `Alt+Shift+F`               | Format the active file                      |

On macOS, replace `Ctrl` with `Command`. `Alt+Shift+F` uses `Option+Shift+F`.

## Run from source

Install Node.js and Rust. Desktop builds also need the platform dependencies listed in the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
git clone https://github.com/TibeDev/vdb-ide.git
cd vdb-ide
npm ci
npm run tauri dev
```

On Linux, install Tauri's [WebKitGTK and system package prerequisites](https://v2.tauri.app/start/prerequisites/#linux) first. Git and GitHub CLI are optional; install both to use the GitHub panel.

Run `npm run dev` to work on the frontend in a browser. Native desktop features require `npm run tauri dev`.

## Build

Build the frontend alone:

```sh
npm run build
```

Build desktop installers for the current platform:

```sh
npm run tauri build
```

Tauri writes installers under `src-tauri/target/release/bundle/`.

## Publish a release

GitHub Actions builds Linux (`.deb`, `.rpm`, `.AppImage`), Windows (`.msi`, `.exe`), and universal macOS (`.dmg`) installers when you push a version tag from `main`.

1. Update the version in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`.
2. Commit and push the version change to `main`.
3. Tag that commit and push the tag:

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

The workflow checks that the tag matches app versions and points to a commit on `main`. It publishes the GitHub release after all platform builds pass.

## Plugins

Install a plugin from **Plugins → Install from folder**. Each plugin folder needs `plugin.json` and a self-contained `main.js`. Plugin code runs inside Arc and can access app and workspace APIs, so install plugins only from sources you trust.

See [`PLUGIN_API.md`](PLUGIN_API.md) for the plugin API.
