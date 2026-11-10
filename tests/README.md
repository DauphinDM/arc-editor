# Regression tests

Run from the repository root with the existing Node/TypeScript dependencies:

```sh
node --test tests/*.test.mjs
```

These tests extract the actual TypeScript callbacks using the TypeScript AST,
then supply in-memory filesystem/Tauri mocks. Editor history uses real
CodeMirror state and commands with a minimal view, without needing a DOM.
They do not read, write, or delete user workspace files.

Coverage includes asynchronous save/watcher races, workspace-switch
cancellation, partial recursive-delete failures, tab undo/redo, nested binary
plugin assets, installation rollback and recovery-backup preservation.
