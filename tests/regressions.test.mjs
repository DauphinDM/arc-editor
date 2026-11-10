import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state';
import { history, historyField, redo, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';

// Exercise the real callbacks without importing Tauri or mounting the entire
// desktop shell. AST extraction keeps these tests dependency-free and avoids
// duplicating the implementations under test.
const sources = Object.fromEntries(['App.tsx', 'pluginRuntime.ts'].map((name) => [
  name, ts.createSourceFile(name, readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
]));
function findNode(file, predicate) {
  let found;
  function visit(node) {
    if (!found && predicate(node)) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(sources[file]);
  assert.ok(found, `Missing source node in ${file}`);
  return found;
}
function evaluate(text, context) {
  const js = ts.transpileModule(`(${text})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return vm.runInNewContext(js, context);
}
function callback(name, context, file = 'App.tsx') {
  const node = findNode(file, (node) => ts.isVariableDeclaration(node) && node.name.getText() === name);
  return evaluate(node.initializer.getText(), context);
}
function declaration(name, context, file = 'pluginRuntime.ts') {
  return evaluate(findNode(file, (node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(), context);
}
const ref = (current) => ({ current });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const noop = () => {};
function editorFixture() {
  const file = { path: 'a.ts', name: 'a.ts', dirty: true, revision: 0 };
  const state = { files: [file], message: '', conflicts: new Set(), writes: [], events: [] };
  const context = {
    useCallback: (fn) => fn,
    workspace: '/project', openFiles: state.files, openFilesRef: ref(state.files),
    settings: { prettierOnSave: false }, settingsRef: ref({ showHiddenFiles: false }),
    fileContents: ref(new Map([['a.ts', 'original']])),
    fileContentVersions: ref(new Map([['a.ts', 1]])), fileContentVersion: ref(1),
    dirtyBuffers: ref(new Set()),
    workspaceGeneration: ref(0), savesInProgress: ref(new Set()), diskReadRequests: ref(new Map()),
    watcherRoot: ref('/project'), lastDiskWrite: ref(new Map()),
    pluginRuntime: { applyWillSave: async (_path, text) => text, emitEvent: (...args) => state.events.push(args) },
    contentFingerprint: (text) => text,
    writeTextFile: async (...args) => { state.writes.push(args); },
    setOpenFiles: (update) => {
      state.files = typeof update === 'function' ? update(state.files) : update;
      context.openFilesRef.current = state.files;
    },
    setMessage: (update) => { state.message = typeof update === 'function' ? update(state.message) : update; },
    setDiskConflicts: (update) => { state.conflicts = update(state.conflicts); },
    window: { setTimeout: noop },
  };
  context.cacheFileContent = callback('cacheFileContent', context);
  context.updateFile = callback('updateFile', context);
  return { context, state };
}

test('save aborts if typing occurs during will-save or formatting', async () => {
  for (const formatting of [false, true]) {
    const { context, state } = editorFixture();
    const pending = deferred();
    if (formatting) {
      context.settings.prettierOnSave = true;
      context.prettierFormat = () => pending.promise;
    } else context.pluginRuntime.applyWillSave = () => pending.promise;
    const saving = callback('saveFile', context)('a.ts');
    await Promise.resolve();
    context.updateFile('a.ts', 'newer edits');
    pending.resolve('formatted old text');
    assert.equal(await saving, false);
    assert.equal(context.fileContents.current.get('a.ts'), 'newer edits');
    assert.equal(state.files[0].dirty, true);
    assert.equal(state.writes.length, 0);
    assert.equal(context.savesInProgress.current.size, 0);
  }
});

test('typing during disk write is retained and overlapping saves are rejected', async () => {
  const { context, state } = editorFixture();
  const writing = deferred();
  context.writeTextFile = async (...args) => { state.writes.push(args); await writing.promise; };
  const save = callback('saveFile', context);
  const saving = save('a.ts');
  await Promise.resolve();
  assert.equal(await save('a.ts'), false);
  context.updateFile('a.ts', 'newer edits');
  writing.resolve();
  assert.equal(await saving, false);
  assert.equal(context.fileContents.current.get('a.ts'), 'newer edits');
  assert.equal(state.files[0].dirty, true);
  assert.equal(state.writes.length, 1);
  assert.match(state.message, /newer edits remain unsaved/);
});

test('normal formatted save updates the buffer and clears dirty', async () => {
  const { context, state } = editorFixture();
  context.pluginRuntime.applyWillSave = async () => 'formatted';
  assert.equal(await callback('saveFile', context)('a.ts'), true);
  assert.equal(context.fileContents.current.get('a.ts'), 'formatted');
  assert.equal(state.files[0].dirty, false);
  assert.equal(state.files[0].revision, 1);
  assert.equal(context.lastDiskWrite.current.get('a.ts'), 'formatted');
});

const modification = [{ root: '/project', kind: 'modified', paths: ['/project/a.ts'] }];
test('watcher rechecks edits after asynchronous reads, including edit-and-revert', async () => {
  for (const revert of [false, true]) {
    const { context, state } = editorFixture();
    state.files[0].dirty = false;
    const reading = deferred();
    context.readTextFile = () => reading.promise;
    const processing = callback('processFsEvents', context)(modification);
    context.updateFile('a.ts', 'typed');
    if (revert) context.updateFile('a.ts', 'original');
    reading.resolve('external change');
    await processing;
    assert.equal(context.fileContents.current.get('a.ts'), revert ? 'original' : 'typed');
    assert.equal(state.files[0].dirty, true);
    assert.ok(state.conflicts.has('a.ts'));
  }
});

test('watcher ignores stale reads after a workspace switch or newer read', async () => {
  const { context, state } = editorFixture();
  state.files[0].dirty = false;
  const first = deferred();
  const second = deferred();
  const reads = [first, second];
  context.readTextFile = () => reads.shift().promise;
  const process = callback('processFsEvents', context);
  const old = process(modification);
  const latest = process(modification);
  second.resolve('latest disk text');
  await latest;
  first.resolve('older disk text');
  await old;
  assert.equal(context.fileContents.current.get('a.ts'), 'latest disk text');
  assert.equal(state.files[0].dirty, false);
  const stale = deferred();
  context.readTextFile = () => stale.promise;
  const processing = process(modification);
  context.workspaceGeneration.current += 1;
  context.cacheFileContent('a.ts', 'new workspace buffer');
  stale.resolve('old workspace text');
  await processing;
  assert.equal(context.fileContents.current.get('a.ts'), 'new workspace buffer');
});

test('save cannot update a buffer that was closed and reopened during preparation', async () => {
  const { context, state } = editorFixture();
  const pending = deferred();
  context.pluginRuntime.applyWillSave = () => pending.promise;
  const saving = callback('saveFile', context)('a.ts');
  context.fileContents.current.delete('a.ts');
  context.cacheFileContent('a.ts', 'original');
  pending.resolve('stale formatted text');
  assert.equal(await saving, false);
  assert.equal(state.writes.length, 0);
});

test('workspace cancellation preserves tabs, buffers, terminals and the file tree', async () => {
  const { context, state } = editorFixture();
  const scanning = deferred();
  const calls = [];
  state.files[0].dirty = false;
  Object.assign(context, {
    folderDialogOpen: ref(false), invoke: async () => '/another-project',
    requestWorkspaceAccess: async () => true,
    refreshWorkspace: async (_root, apply) => { assert.equal(apply, false); return scanning.promise; },
    setFiles: () => calls.push('tree'),
    localStorage: { setItem: () => calls.push('storage') },
    terminals: [{ id: 'terminal' }], forgetTerminalOutput: () => calls.push('terminal'),
    window: { confirm: () => { calls.push('confirm'); return false; } },
  });
  const switching = callback('openWorkspace', context)();
  await Promise.resolve();
  await Promise.resolve();
  context.updateFile('a.ts', 'typed while scanning');
  // React may not have committed its dirty flag yet. The synchronous buffer
  // marker must still prevent silently discarding the new edits.
  context.openFilesRef.current = [{ ...state.files[0], dirty: false }];
  scanning.resolve([]);
  await switching;
  assert.deepEqual(calls, ['confirm']);
  assert.equal(context.fileContents.current.get('a.ts'), 'typed while scanning');
  assert.equal(state.files.length, 1);
  assert.equal(context.folderDialogOpen.current, false);
});

test('failed recursive deletion retains a complete, persistent recovery copy', async () => {
  for (const partialCopy of [false, true]) {
    const { context, state } = editorFixture();
    let original = ['first', 'second'];
    const backups = new Map();
    Object.assign(context, {
      removeNestedEntries: (entries) => entries, trashCounter: ref(0),
      join: async (...parts) => path.posix.join(...parts), appDataDir: async () => '/appdata', mkdir: async () => {},
      copyTreeEntry: async (_from, to) => {
        backups.set(to, [...original]);
        if (partialCopy) throw new Error('copy failed');
      },
      remove: async (target) => {
        if (target === '/project/folder') { original = ['second']; throw new Error('permission denied'); }
        backups.delete(target);
      },
      exists: async (target) => backups.has(target),
    });
    await callback('deleteEntries', context)([{ name: 'folder', path: 'folder', kind: 'directory' }]);
    if (partialCopy) {
      assert.deepEqual(original, ['first', 'second']);
      assert.equal(backups.size, 0);
    } else {
      assert.deepEqual(original, ['second']);
      assert.equal(backups.size, 1);
      const [location, contents] = [...backups][0];
      assert.match(location, /^\/appdata\/delete-recovery\//);
      assert.deepEqual(contents, ['first', 'second']);
      assert.ok(state.message.includes(location));
    }
  }
});

test('workspace switching waits for active saves instead of discarding buffers', async () => {
  const { context, state } = editorFixture();
  context.savesInProgress.current.add('a.ts');
  Object.assign(context, {
    folderDialogOpen: ref(false), invoke: async () => '/another-project',
    requestWorkspaceAccess: async () => true, refreshWorkspace: async () => [],
    setFiles: () => assert.fail('Tree must not change while saving'),
    window: { confirm: () => assert.fail('Cannot discard a save in progress') },
  });
  await callback('openWorkspace', context)();
  assert.equal(context.workspaceGeneration.current, 0);
  assert.equal(context.fileContents.current.get('a.ts'), 'original');
  assert.match(state.message, /save to finish/);
});

test('tab switching and moving between panes preserve undo/redo and selection', () => {
  // Use the actual EditorPane creation/cleanup effect with real CodeMirror
  // state/history and a lightweight view (no browser DOM required).
  const effect = findNode('App.tsx', (node) => ts.isCallExpression(node) && node.expression.getText() === 'useEffect' && node.getText().includes('const snapshotKey'));
  class TestView {
    static updateListener = EditorView.updateListener;
    static domEventHandlers = () => [];
    constructor({ state }) { this.state = state; this.scrollDOM = { scrollTop: 0, scrollLeft: 0 }; }
    dispatch = (spec) => { this.state = this.state.update(spec).state; };
    destroy() {}
  }
  const context = {
    file: { path: 'a.ts', content: 'original' }, workspace: '/project',
    host: ref({}), view: ref(null), editorViews: ref(new Map()), editorSnapshots: ref(new Map()),
    compartments: { settings: new Compartment(), theme: new Compartment(), language: new Compartment() },
    group: { id: 'first-pane' }, pluginEditorExtensions: [],
    onChange: noop, onActivate: noop, onSelectionChangeRef: ref(noop),
    EditorView: TestView, EditorState, history, historyField, Transaction,
    externalContentUpdate: Annotation.define(), highlightSelectionMatches: () => [],
    requestAnimationFrame: (fn) => fn(),
  };
  const mount = () => evaluate(effect.arguments[0].getText(), context)();
  let cleanup = mount();
  context.view.current.dispatch({ changes: { from: 0, insert: 'edited ' }, selection: { anchor: 7 } });
  context.view.current.scrollDOM.scrollTop = 42;
  cleanup();
  context.file = { path: 'b.ts', content: 'other' };
  cleanup = mount();
  cleanup();
  context.file = { path: 'a.ts', content: 'edited original' };
  context.group = { id: 'second-pane' };
  cleanup = mount();
  assert.equal(context.view.current.state.selection.main.head, 7);
  assert.equal(context.view.current.scrollDOM.scrollTop, 42);
  assert.ok(undo(context.view.current));
  assert.equal(context.view.current.state.doc.toString(), 'original');
  assert.ok(redo(context.view.current));
  assert.equal(context.view.current.state.doc.toString(), 'edited original');
  cleanup();
});

function pluginFixture() {
  const files = new Map([
    ['/source/plugin.json', Buffer.from('{}')], ['/source/main.js', Buffer.from('export function activate() {}')],
    ['/source/images/logo.png', Buffer.from([0, 255, 128, 42])], ['/source/templates/page.html', Buffer.from('<h1>hello</h1>')],
    ['/plugins/example/main.js', Buffer.from('old plugin')], ['/plugins/example/old.txt', Buffer.from('old asset')],
  ]);
  const directories = new Set(['/source', '/source/images', '/source/templates', '/plugins', '/plugins/example']);
  const context = {
    join: async (...parts) => path.posix.join(...parts), appDataDir: async () => '/data', crypto: { randomUUID: () => 'test-id' },
    mkdir: async (folder) => { directories.add(folder); },
    readDir: async (folder) => [
      ...[...directories].filter((entry) => entry !== folder && path.posix.dirname(entry) === folder).map((entry) => ({ name: path.posix.basename(entry), isDirectory: true })),
      ...[...files.keys()].filter((entry) => path.posix.dirname(entry) === folder).map((entry) => ({ name: path.posix.basename(entry), isFile: true })),
    ],
    exists: async (target) => directories.has(target) || files.has(target),
    copyFile: async (from, to) => { files.set(to, Buffer.from(files.get(from))); },
    writeTextFile: async (to, text) => { files.set(to, Buffer.from(text)); },
    renameFile: async (from, to) => {
      for (const [name, bytes] of [...files]) if (name === from || name.startsWith(`${from}/`)) {
        files.set(to + name.slice(from.length), bytes); files.delete(name);
      }
      for (const name of [...directories]) if (name === from || name.startsWith(`${from}/`)) {
        directories.add(to + name.slice(from.length)); directories.delete(name);
      }
    },
    remove: async (target) => {
      for (const name of files.keys()) if (name === target || name.startsWith(`${target}/`)) files.delete(name);
      for (const name of directories) if (name === target || name.startsWith(`${target}/`)) directories.delete(name);
    },
  };
  context.copyPluginFolder = declaration('copyPluginFolder', context);
  const install = declaration('installPluginPackage', context);
  return { context, files, install: () => install('/source', '/plugins/example', { id: 'example', main: 'main.js' }, 'new source') };
}

test('plugin installation copies nested binary assets and replaces old resources', async () => {
  const { files, install } = pluginFixture();
  await install();
  assert.equal(files.get('/plugins/example/main.js').toString(), 'new source');
  assert.deepEqual(files.get('/plugins/example/images/logo.png'), Buffer.from([0, 255, 128, 42]));
  assert.equal(files.get('/plugins/example/templates/page.html').toString(), '<h1>hello</h1>');
  assert.equal(files.has('/plugins/example/old.txt'), false);
  assert.equal([...files.keys()].some((key) => key.startsWith('/data/plugin-installs/')), false);
});

test('copy failure and failed replacement leave the previous plugin intact', async () => {
  for (const failCopy of [false, true]) {
    const { context, files, install } = pluginFixture();
    if (failCopy) context.copyFile = async () => { throw new Error('copy failed'); };
    else {
      const rename = context.renameFile;
      context.renameFile = async (from, to) => {
        if (from.endsWith('/package')) throw new Error('rename failed');
        await rename(from, to);
      };
    }
    await assert.rejects(install(), /failed/);
    assert.equal(files.get('/plugins/example/main.js').toString(), 'old plugin');
    assert.equal(files.get('/plugins/example/old.txt').toString(), 'old asset');
  }
});

test('failed rollback preserves the backup and reports its location', async () => {
  const { context, files, install } = pluginFixture();
  const rename = context.renameFile;
  context.renameFile = async (from, to) => {
    if (from.endsWith('/package') || from.endsWith('/previous')) throw new Error('rename failed');
    await rename(from, to);
  };
  await assert.rejects(install(), /Previous plugin preserved at \/data\/plugin-installs\/test-id\/previous/);
  assert.equal(files.get('/data/plugin-installs/test-id/previous/main.js').toString(), 'old plugin');
});

test('plugin symlinks fail safely without removing the installed package', async () => {
  const { context, files, install } = pluginFixture();
  context.readDir = async () => [{ name: 'outside', isSymlink: true }];
  await assert.rejects(install(), /symlinks are not supported/);
  assert.equal(files.get('/plugins/example/main.js').toString(), 'old plugin');
});

test('installer rejects selecting a parent of its staging folder', async () => {
  const { context, files } = pluginFixture();
  const install = declaration('installPluginPackage', context);
  await assert.rejects(install('/', '/plugins/example', { main: 'main.js' }, 'new source'), /parent of Arc's staging directory/);
  assert.equal(files.get('/plugins/example/main.js').toString(), 'old plugin');
});
