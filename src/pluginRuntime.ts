import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { readText as readClipboardText, writeHtml as writeClipboardHtml, writeText as writeClipboardText } from "@tauri-apps/plugin-clipboard-manager";
import { copyFile, exists, mkdir, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import type { EditorView } from "@codemirror/view";
import type { AppSettings, ThemeDefinition } from "./settings";

const builtinManifestSources = import.meta.glob<string>("../plugins/*/plugin.json", { eager: true, query: "?raw", import: "default" });
const builtinPluginSources = import.meta.glob<string>("../plugins/*/main.js", { eager: true, query: "?raw", import: "default" });

const disabledStorageKey = "arc.plugins.disabled";
const builtinsSeededKey = "arc.plugins.builtinsSeeded";

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  main: "main.js";
};

export type InstalledPlugin = PluginManifest & { enabled: boolean; source: string; builtin: boolean };

export type PluginActionDefinition = {
  id: string;
  label: string;
  title?: string;
  icon?: string;
  onClick: () => void | Promise<void>;
};

export type PluginToolbarAction = PluginActionDefinition & {
  pluginId: string;
  pluginName: string;
};

export type PluginContext = {
  workspace: string;
  target?: { name: string; path: string; kind: "file" | "directory" };
};

export type PluginContextMenuDefinition = {
  id: string;
  label: string;
  onClick: (context: PluginContext) => void | Promise<void>;
};

export type PluginContextMenuItem = PluginContextMenuDefinition & {
  pluginId: string;
  pluginName: string;
};

export type PluginCommandDefinition = {
  id: string;
  title: string;
  description?: string;
  shortcut?: string;
  run: () => void | Promise<void>;
};

export type PluginCommand = PluginCommandDefinition & { pluginId: string; pluginName: string };

export type PluginStatusItemDefinition = {
  id: string;
  text: string;
  tooltip?: string;
  position?: "left" | "right";
  onClick?: () => void | Promise<void>;
};

export type PluginStatusItem = PluginStatusItemDefinition & { pluginId: string; pluginName: string };

export type PluginPanelDefinition = {
  id: string;
  title: string;
  mount: (container: HTMLElement) => void | (() => void);
};

export type PluginPanelContribution = PluginPanelDefinition & { pluginId: string; pluginName: string };

export type PluginEventName = "workspace:changed" | "editor:active" | "editor:changed" | "file:saved" | "settings:changed" | "terminal:opened" | "terminal:closed";

export type PluginEditorSnapshot = {
  path: string;
  name: string;
  text: string;
  dirty: boolean;
  selection: { from: number; to: number };
};

export type PluginAppSnapshot = {
  workspace: string;
  activeFile: string;
  openFiles: { path: string; name: string; dirty: boolean }[];
  terminals: { id: string; title: string; cwd: string }[];
  settings: AppSettings;
  theme: ThemeDefinition;
};

export type PluginApi = {
  plugin: { id: string; name: string; version: string };
  workspace: string;
  platform: "windows" | "linux" | "macos";
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  openUrl: (url: string) => Promise<void>;
  openTerminal: (command?: string) => void;
  notify: (message: string) => void;
  app: {
    getState: () => PluginAppSnapshot;
    openWorkspace: () => Promise<void>;
    openSettings: () => void;
    openGithub: () => void;
    openPlugins: () => void;
    openPanel: (id: string) => void;
    setTitle: (title: string) => void;
  };
  files: {
    list: (path?: string) => Promise<{ path: string; name: string; kind: "file" | "directory" }[]>;
    read: (path: string) => Promise<string>;
    write: (path: string, content: string) => Promise<void>;
    create: (path: string, content?: string) => Promise<void>;
    createDirectory: (path: string) => Promise<void>;
    delete: (path: string) => Promise<void>;
    rename: (path: string, nextPath: string) => Promise<void>;
    copy: (path: string, destination: string) => Promise<void>;
    open: (path: string) => Promise<void>;
    refresh: () => Promise<void>;
  };
  editor: {
    getActive: () => PluginEditorSnapshot | null;
    getText: (path?: string) => string | null;
    setText: (text: string, path?: string) => void;
    insertText: (text: string, path?: string) => void;
    getSelection: (path?: string) => { from: number; to: number } | null;
    setSelection: (from: number, to?: number, path?: string) => void;
    focus: (path?: string) => void;
    open: (path: string) => Promise<void>;
    save: (path?: string) => Promise<boolean>;
    format: (path?: string) => Promise<void>;
  };
  terminal: {
    open: (command?: string) => string | null;
    list: () => { id: string; title: string; cwd: string }[];
    write: (id: string, data: string) => Promise<void>;
    resize: (id: string, cols: number, rows: number) => Promise<void>;
    close: (id: string) => Promise<void>;
  };
  settings: { get: () => AppSettings; update: (patch: Partial<AppSettings>) => void };
  themes: { list: () => { id: string; name: string }[]; set: (id: string) => boolean };
  dialogs: {
    openFile: (options?: { multiple?: boolean; filters?: { name: string; extensions: string[] }[] }) => Promise<string | string[] | null>;
    openFolder: () => Promise<string | null>;
    saveFile: (options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
  };
  clipboard: { readText: () => Promise<string>; writeText: (text: string) => Promise<void>; writeHtml: (html: string, fallbackText?: string) => Promise<void> };
  window: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
    setSize: (width: number, height: number) => Promise<void>;
    setFullscreen: (fullscreen: boolean) => Promise<void>;
    setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<void>;
    center: () => Promise<void>;
  };
  ui: {
    notify: (message: string) => void;
    confirm: (message: string) => boolean;
    prompt: (message: string, defaultValue?: string) => string | null;
    registerAction: (action: PluginActionDefinition) => void;
    registerContextMenuItem: (item: PluginContextMenuDefinition) => void;
    registerStatusItem: (item: PluginStatusItemDefinition) => void;
    registerCommand: (command: PluginCommandDefinition) => void;
    registerPanel: (panel: PluginPanelDefinition) => void;
    addStyles: (css: string) => () => void;
  };
  commands: { list: () => { id: string; title: string; description?: string; pluginName: string }[]; execute: (id: string) => Promise<void> };
  events: {
    on: (event: string, listener: (payload: unknown) => void) => () => void;
    emit: (event: string, payload?: unknown) => void;
  };
  storage: {
    get: <T = unknown>(key: string, fallback?: T) => T;
    set: (key: string, value: unknown) => void;
    remove: (key: string) => void;
    clear: () => void;
  };
  localServer: {
    start: (root: string, entry?: string) => Promise<{ root: string; url: string }>;
    stop: () => Promise<boolean>;
  };
  process: { isRunning: (names: string[]) => Promise<boolean> };
  registerAction: (action: PluginActionDefinition) => void;
  registerContextMenuItem: (item: PluginContextMenuDefinition) => void;
};

type PluginHostActions = {
  getAppState: () => PluginAppSnapshot;
  getThemes: () => { id: string; name: string }[];
  openWorkspace: () => Promise<void>;
  openSettings: () => void;
  openGithub: () => void;
  openPlugins: () => void;
  openPluginPanel: (id: string) => void;
  setTitle: (title: string) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  setTheme: (id: string) => boolean;
  refreshWorkspace: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  renameFile: (path: string, name: string) => Promise<void>;
  saveFile: (path: string) => Promise<boolean>;
  formatFile: (path: string) => Promise<void>;
  getEditor: (path?: string) => EditorView | null;
  getEditorSnapshot: (path?: string) => PluginEditorSnapshot | null;
  setEditorText: (path: string, text: string) => void;
  getTerminals: () => { id: string; title: string; cwd: string }[];
  openTerminal: (command?: string) => string | null;
  writeTerminal: (id: string, data: string) => Promise<void>;
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>;
  closeTerminal: (id: string) => Promise<void>;
};

type ActivePlugin = { source: string; url: string; active: boolean; cleanup?: () => void; disposables: (() => void)[] };

type PluginModule = {
  activate: (api: PluginApi) => void | (() => void) | Promise<void | (() => void)>;
};

function readDisabledIds(): Set<string> {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(disabledStorageKey) ?? "[]");
    return new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function parseManifest(value: unknown, allowBuiltin = false): PluginManifest {
  if (!value || typeof value !== "object") throw new Error("plugin.json must contain a JSON object.");
  const manifest = value as Record<string, unknown>;
  if (typeof manifest.id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(manifest.id)) {
    throw new Error("Plugin ID must use 2–64 lowercase letters, numbers, dots, underscores, or hyphens.");
  }
  if (!allowBuiltin && builtinPackages.some((builtin) => builtin.manifest.id === manifest.id)) {
    throw new Error("Plugin ID is reserved by a built-in plugin.");
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) throw new Error("Plugin name is required.");
  if (typeof manifest.version !== "string" || !manifest.version.trim()) throw new Error("Plugin version is required.");
  if (typeof manifest.description !== "string") throw new Error("Plugin description is required.");
  if (manifest.main !== "main.js") throw new Error('Plugin entry file must be "main.js".');
  return {
    id: manifest.id,
    name: manifest.name.trim(),
    version: manifest.version.trim(),
    description: manifest.description.trim(),
    main: "main.js",
  };
}

const builtinPackages = Object.entries(builtinManifestSources).map(([manifestPath, manifestJson]) => {
  const sourcePath = manifestPath.replace(/plugin\.json$/, "main.js");
  const source = builtinPluginSources[sourcePath];
  if (typeof source !== "string") throw new Error(`Built-in plugin is missing main.js: ${manifestPath}`);
  return { manifest: parseManifest(JSON.parse(manifestJson), true), source };
});

export function usePluginRuntime(
  workspace: string,
  notify: (message: string) => void,
  hostActions: PluginHostActions,
) {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [actions, setActions] = useState<PluginToolbarAction[]>([]);
  const [contextMenuItems, setContextMenuItems] = useState<PluginContextMenuItem[]>([]);
  const [commands, setCommands] = useState<PluginCommand[]>([]);
  const [statusItems, setStatusItems] = useState<PluginStatusItem[]>([]);
  const [panels, setPanels] = useState<PluginPanelContribution[]>([]);
  const [pluginDirectory, setPluginDirectory] = useState("");
  const hostActionsRef = useRef(hostActions);
  hostActionsRef.current = hostActions;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const activeModules = useRef(new Map<string, ActivePlugin>());
  const listeners = useRef(new Map<string, Set<(payload: unknown) => void>>());
  const commandRef = useRef(new Map<string, PluginCommand>());
  commandRef.current = new Map(commands.map((command) => [command.id, command]));

  const emitEvent = useCallback((event: string, payload?: unknown) => {
    listeners.current.get(event)?.forEach((listener) => {
      try { listener(payload); } catch (error) { notify(`Plugin event listener failed: ${String(error)}`); }
    });
    window.dispatchEvent(new CustomEvent(`arc:${event}`, { detail: payload }));
  }, [notify]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const root = await join(await appDataDir(), "plugins");
        await mkdir(root, { recursive: true });
        if (!cancelled) setPluginDirectory(root);
        const seedBuiltins = localStorage.getItem(builtinsSeededKey) !== "true";
        for (const builtin of builtinPackages) {
          const folder = await join(root, builtin.manifest.id);
          if (seedBuiltins || await exists(folder)) await writePluginFiles(folder, builtin.manifest, builtin.source);
        }
        if (seedBuiltins) localStorage.setItem(builtinsSeededKey, "true");
        const disabled = readDisabledIds();
        const entries = await readDir(root);
        const loaded: InstalledPlugin[] = [];
        for (const entry of entries) {
          if (!entry.isDirectory) continue;
          try {
            const folder = await join(root, entry.name);
            const manifestPath = await join(folder, "plugin.json");
            const sourcePath = await join(folder, "main.js");
            const parsed = JSON.parse(await readTextFile(manifestPath));
            const id = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).id : undefined;
            const isBuiltin = builtinPackages.some((builtin) => builtin.manifest.id === id);
            const manifest = parseManifest(parsed, isBuiltin);
            const source = await readTextFile(sourcePath);
            loaded.push({ ...manifest, source, enabled: !disabled.has(manifest.id), builtin: isBuiltin });
          } catch (error) {
            notify(`Could not load plugin in ${entry.name}: ${String(error)}`);
          }
        }
        if (!cancelled) setPlugins(loaded);
      } catch (error) {
        if (!cancelled) notify(`Could not load plugins: ${String(error)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [notify]);

  const availableBuiltins = builtinPackages
    .filter((builtin) => !plugins.some((plugin) => plugin.id === builtin.manifest.id))
    .map((builtin) => builtin.manifest);

  useEffect(() => {
    const desired = new Map(plugins.filter((plugin) => plugin.enabled).map((plugin) => [plugin.id, plugin]));
    for (const [id, active] of activeModules.current) {
      const plugin = desired.get(id);
      if (plugin && plugin.source === active.source) continue;
      active.active = false;
      active.disposables.forEach((dispose) => { try { dispose(); } catch { /* Plugin cleanup must not interrupt other plugins. */ } });
      try { active.cleanup?.(); } catch { /* Plugin cleanup must not interrupt other plugins. */ }
      URL.revokeObjectURL(active.url);
      activeModules.current.delete(id);
      setActions((current) => current.filter((action) => action.pluginId !== id));
      setContextMenuItems((current) => current.filter((item) => item.pluginId !== id));
      setCommands((current) => current.filter((command) => command.pluginId !== id));
      setStatusItems((current) => current.filter((item) => item.pluginId !== id));
      setPanels((current) => current.filter((panel) => panel.pluginId !== id));
    }

    for (const plugin of desired.values()) {
      if (activeModules.current.has(plugin.id)) continue;
      const url = URL.createObjectURL(new Blob([plugin.source], { type: "text/javascript" }));
      const active: ActivePlugin = { source: plugin.source, url, active: true, disposables: [] };
      activeModules.current.set(plugin.id, active);
      void (async () => {
        try {
          const pluginModule = await import(/* @vite-ignore */ url) as PluginModule;
          if (!active.active || activeModules.current.get(plugin.id) !== active) return;
          if (typeof pluginModule.activate !== "function") throw new Error("main.js must export activate(api).");
          const validateId = (id: string) => {
            if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) throw new Error(`Plugin ${plugin.name} registered an invalid contribution ID.`);
          };
          const registerAction = (definition: PluginActionDefinition) => {
            if (!active.active || activeModules.current.get(plugin.id) !== active) return;
            validateId(definition.id);
            if (!definition.label.trim() || typeof definition.onClick !== "function") throw new Error(`Plugin ${plugin.name} registered an invalid toolbar action.`);
            const action = { ...definition, id: `${plugin.id}:${definition.id}`, pluginId: plugin.id, pluginName: plugin.name };
            setActions((current) => [...current.filter((entry) => entry.id !== action.id), action]);
          };
          const registerContextMenuItem = (definition: PluginContextMenuDefinition) => {
            if (!active.active || activeModules.current.get(plugin.id) !== active) return;
            validateId(definition.id);
            if (!definition.label.trim() || typeof definition.onClick !== "function") throw new Error(`Plugin ${plugin.name} registered an invalid context menu item.`);
            const item = { ...definition, id: `${plugin.id}:${definition.id}`, pluginId: plugin.id, pluginName: plugin.name };
            setContextMenuItems((current) => [...current.filter((entry) => entry.id !== item.id), item]);
          };
          const registerCommand = (definition: PluginCommandDefinition) => {
            if (!active.active || activeModules.current.get(plugin.id) !== active) return;
            validateId(definition.id);
            if (!definition.title.trim() || typeof definition.run !== "function") throw new Error(`Plugin ${plugin.name} registered an invalid command.`);
            const command = { ...definition, id: `${plugin.id}:${definition.id}`, pluginId: plugin.id, pluginName: plugin.name };
            commandRef.current.set(command.id, command);
            setCommands((current) => [...current.filter((entry) => entry.id !== command.id), command]);
          };
          const registerStatusItem = (definition: PluginStatusItemDefinition) => {
            if (!active.active || activeModules.current.get(plugin.id) !== active) return;
            validateId(definition.id);
            if (!definition.text.trim()) throw new Error(`Plugin ${plugin.name} registered an invalid status item.`);
            const item = { ...definition, id: `${plugin.id}:${definition.id}`, pluginId: plugin.id, pluginName: plugin.name };
            setStatusItems((current) => [...current.filter((entry) => entry.id !== item.id), item]);
          };
          const registerPanel = (definition: PluginPanelDefinition) => {
            if (!active.active || activeModules.current.get(plugin.id) !== active) return;
            validateId(definition.id);
            if (!definition.title.trim() || typeof definition.mount !== "function") throw new Error(`Plugin ${plugin.name} registered an invalid panel.`);
            const panel = { ...definition, id: `${plugin.id}:${definition.id}`, pluginId: plugin.id, pluginName: plugin.name };
            setPanels((current) => [...current.filter((entry) => entry.id !== panel.id), panel]);
          };
          const resolveFilePath = (path: string, allowRoot = false) => pluginWorkspacePath(workspaceRef.current, path, allowRoot);
          const scopedStorageKey = (key: string) => `arc.plugin.${plugin.id}.${key}`;
          const getEditor = (path?: string) => hostActionsRef.current.getEditor(path);
          const runCommand = async (id: string) => {
            const command = commandRef.current.get(id.includes(":") ? id : `${plugin.id}:${id}`);
            if (!command) throw new Error(`Unknown plugin command: ${id}`);
            await command.run();
          };
          const api: PluginApi = {
            plugin: { id: plugin.id, name: plugin.name, version: plugin.version },
            get workspace() { return workspaceRef.current; },
            platform: /win/i.test(navigator.platform) ? "windows" : /mac/i.test(navigator.platform) ? "macos" : "linux",
            invoke: (command, args) => invoke(command, args),
            openUrl: (externalUrl) => openUrl(externalUrl),
            openTerminal: (command) => hostActionsRef.current.openTerminal(command),
            notify,
            app: {
              getState: () => hostActionsRef.current.getAppState(),
              openWorkspace: () => hostActionsRef.current.openWorkspace(),
              openSettings: () => hostActionsRef.current.openSettings(),
              openGithub: () => hostActionsRef.current.openGithub(),
              openPlugins: () => hostActionsRef.current.openPlugins(),
              openPanel: (id) => hostActionsRef.current.openPluginPanel(id.includes(":") ? id : `${plugin.id}:${id}`),
              setTitle: (title) => hostActionsRef.current.setTitle(title),
            },
            files: {
              list: async (path = "") => {
                const directory = await resolveFilePath(path, true);
                const entries = await readDir(directory);
                return entries.map((entry) => ({
                  name: entry.name,
                  path: path ? `${path.replace(/\\/g, "/").replace(/\/$/, "")}/${entry.name}` : entry.name,
                  kind: entry.isDirectory ? "directory" as const : "file" as const,
                }));
              },
              read: (path) => readTextFile(resolveFilePath(path)),
              write: async (path, content) => {
                const destination = await resolveFilePath(path);
                await mkdir(await parentDirectoryPath(destination), { recursive: true });
                if (hostActionsRef.current.getEditorSnapshot(path)) {
                  hostActionsRef.current.setEditorText(path, content);
                  if (!await hostActionsRef.current.saveFile(path)) throw new Error(`Could not save ${path}.`);
                } else {
                  await writeTextFile(destination, content);
                  emitEvent("file:saved", { path });
                }
                await hostActionsRef.current.refreshWorkspace();
              },
              create: async (path, content = "") => {
                const destination = await resolveFilePath(path);
                if (await exists(destination)) throw new Error(`File already exists: ${path}`);
                await mkdir(await parentDirectoryPath(destination), { recursive: true });
                await writeTextFile(destination, content);
                await hostActionsRef.current.refreshWorkspace();
              },
              createDirectory: async (path) => {
                await mkdir(await resolveFilePath(path), { recursive: true });
                await hostActionsRef.current.refreshWorkspace();
              },
              delete: async (path) => {
                await resolveFilePath(path);
                await hostActionsRef.current.deleteFile(path);
              },
              rename: async (path, nextPath) => {
                await resolveFilePath(path);
                await resolveFilePath(nextPath);
                const oldParts = path.replace(/\\/g, "/").split("/");
                const nextParts = nextPath.replace(/\\/g, "/").split("/");
                if (oldParts.slice(0, -1).join("/") !== nextParts.slice(0, -1).join("/")) throw new Error("Rename cannot move files to another directory.");
                await hostActionsRef.current.renameFile(path, nextParts.at(-1) ?? "");
              },
              copy: async (path, destination) => {
                const source = await resolveFilePath(path);
                const target = await resolveFilePath(destination);
                await mkdir(await parentDirectoryPath(target), { recursive: true });
                await copyFile(source, target);
                await hostActionsRef.current.refreshWorkspace();
              },
              open: async (path) => {
                await resolveFilePath(path);
                await hostActionsRef.current.openFile(path);
              },
              refresh: () => hostActionsRef.current.refreshWorkspace(),
            },
            editor: {
              getActive: () => hostActionsRef.current.getEditorSnapshot(),
              getText: (path) => getEditor(path)?.state.doc.toString() ?? hostActionsRef.current.getEditorSnapshot(path)?.text ?? null,
              setText: (text, path) => {
                const snapshot = hostActionsRef.current.getEditorSnapshot(path);
                if (!snapshot) throw new Error("No open editor matches that path.");
                hostActionsRef.current.setEditorText(snapshot.path, text);
              },
              insertText: (text, path) => {
                const editor = getEditor(path);
                if (editor) {
                  const range = editor.state.selection.main;
                  editor.dispatch({ changes: { from: range.from, to: range.to, insert: text }, selection: { anchor: range.from + text.length } });
                  editor.focus();
                  return;
                }
                const snapshot = hostActionsRef.current.getEditorSnapshot(path);
                if (!snapshot) throw new Error("No open editor matches that path.");
                const updatedText = snapshot.text.slice(0, snapshot.selection.from) + text + snapshot.text.slice(snapshot.selection.to);
                hostActionsRef.current.setEditorText(snapshot.path, updatedText);
              },
              getSelection: (path) => {
                const editor = getEditor(path);
                if (!editor) return null;
                const range = editor.state.selection.main;
                return { from: range.from, to: range.to };
              },
              setSelection: (from, to = from, path) => {
                const editor = getEditor(path);
                if (!editor) throw new Error("No open editor matches that path.");
                editor.dispatch({ selection: { anchor: from, head: to } });
                editor.focus();
              },
              focus: (path) => getEditor(path)?.focus(),
              open: async (path) => {
                await resolveFilePath(path);
                await hostActionsRef.current.openFile(path);
              },
              save: async (path) => {
                const active = hostActionsRef.current.getEditorSnapshot(path);
                return active ? hostActionsRef.current.saveFile(active.path) : false;
              },
              format: async (path) => {
                const active = hostActionsRef.current.getEditorSnapshot(path);
                if (active) await hostActionsRef.current.formatFile(active.path);
              },
            },
            terminal: {
              open: (command) => hostActionsRef.current.openTerminal(command),
              list: () => hostActionsRef.current.getTerminals(),
              write: (id, data) => hostActionsRef.current.writeTerminal(id, data),
              resize: (id, cols, rows) => hostActionsRef.current.resizeTerminal(id, cols, rows),
              close: (id) => hostActionsRef.current.closeTerminal(id),
            },
            settings: {
              get: () => hostActionsRef.current.getAppState().settings,
              update: (patch) => hostActionsRef.current.updateSettings(patch),
            },
            themes: {
              list: () => hostActionsRef.current.getThemes(),
              set: (id) => hostActionsRef.current.setTheme(id),
            },
            dialogs: {
              openFile: async (options) => {
                const selected = await open({ directory: false, multiple: options?.multiple ?? false, filters: options?.filters });
                return typeof selected === "string" || Array.isArray(selected) ? selected : null;
              },
              openFolder: async () => {
                const selected = await open({ directory: true, multiple: false });
                return typeof selected === "string" ? selected : null;
              },
              saveFile: (options) => save(options),
            },
            clipboard: {
              readText: () => readClipboardText(),
              writeText: (text) => writeClipboardText(text),
              writeHtml: (html, fallbackText) => writeClipboardHtml(html, fallbackText),
            },
            window: {
              minimize: () => getCurrentWindow().minimize(),
              toggleMaximize: () => getCurrentWindow().toggleMaximize(),
              close: () => getCurrentWindow().close(),
              setSize: (width, height) => getCurrentWindow().setSize(new LogicalSize(width, height)),
              setFullscreen: (fullscreen) => getCurrentWindow().setFullscreen(fullscreen),
              setAlwaysOnTop: (alwaysOnTop) => getCurrentWindow().setAlwaysOnTop(alwaysOnTop),
              center: () => getCurrentWindow().center(),
            },
            ui: {
              notify,
              confirm: (message) => window.confirm(message),
              prompt: (message, defaultValue) => window.prompt(message, defaultValue),
              registerAction,
              registerContextMenuItem,
              registerStatusItem,
              registerCommand,
              registerPanel,
              addStyles: (css) => {
                if (css.length > 100_000) throw new Error("Plugin stylesheet exceeds 100 KB.");
                const style = document.createElement("style");
                style.dataset.arcPlugin = plugin.id;
                style.textContent = css;
                document.head.append(style);
                const dispose = () => style.remove();
                active.disposables.push(dispose);
                return dispose;
              },
            },
            commands: {
              list: () => [...commandRef.current.values()].map(({ id, title, description, pluginName }) => ({ id, title, description, pluginName })),
              execute: runCommand,
            },
            events: {
              on: (event, listener) => {
                const callbacks = listeners.current.get(event) ?? new Set<(payload: unknown) => void>();
                callbacks.add(listener);
                listeners.current.set(event, callbacks);
                const dispose = () => {
                  callbacks.delete(listener);
                  if (!callbacks.size) listeners.current.delete(event);
                };
                active.disposables.push(dispose);
                return dispose;
              },
              emit: (event, payload) => emitEvent(`plugin:${plugin.id}:${event}`, payload),
            },
            storage: {
              get: <T,>(key: string, fallback?: T) => {
                try {
                  const value = localStorage.getItem(scopedStorageKey(key));
                  return value === null ? fallback as T : JSON.parse(value) as T;
                } catch {
                  return fallback as T;
                }
              },
              set: (key, value) => localStorage.setItem(scopedStorageKey(key), JSON.stringify(value)),
              remove: (key) => localStorage.removeItem(scopedStorageKey(key)),
              clear: () => Object.keys(localStorage).filter((key) => key.startsWith(scopedStorageKey(""))).forEach((key) => localStorage.removeItem(key)),
            },
            localServer: {
              start: (root, entry = "") => invoke<{ root: string; url: string }>("plugin_local_server_start", { pluginId: plugin.id, root, entry }),
              stop: () => invoke<boolean>("plugin_local_server_stop", { pluginId: plugin.id }),
            },
            process: { isRunning: (names) => invoke<boolean>("plugin_process_is_running", { names }) },
            registerAction,
            registerContextMenuItem,
          };
          const cleanup = await pluginModule.activate(api);
          if (typeof cleanup === "function") {
            if (active.active) active.cleanup = cleanup;
            else cleanup();
          }
        } catch (error) {
          if (active.active) notify(`Could not activate plugin ${plugin.name}: ${String(error)}`);
          if (activeModules.current.get(plugin.id) === active) activeModules.current.delete(plugin.id);
          URL.revokeObjectURL(url);
        }
      })();
    }
  }, [notify, plugins]);

  useEffect(() => () => {
    for (const active of activeModules.current.values()) {
      active.active = false;
      active.disposables.forEach((dispose) => { try { dispose(); } catch { /* Plugin cleanup must not interrupt app shutdown. */ } });
      try { active.cleanup?.(); } catch { /* Plugin cleanup must not interrupt app shutdown. */ }
      URL.revokeObjectURL(active.url);
    }
    activeModules.current.clear();
  }, []);

  const installFromFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false, recursive: true, title: "Install plugin folder" });
    if (typeof selected !== "string") return;
    const manifest = parseManifest(JSON.parse(await readTextFile(await join(selected, "plugin.json"))));
    const source = await readTextFile(await join(selected, manifest.main));
    if (!window.confirm(`Install “${manifest.name}”? Plugin JavaScript runs inside Arc and can call its plugin API.`)) return;

    const root = await join(await appDataDir(), "plugins");
    await mkdir(root, { recursive: true });
    const destination = await join(root, manifest.id);
    if (await exists(destination)) {
      if (!window.confirm(`Replace installed plugin “${manifest.name}”?`)) return;
      await remove(destination, { recursive: true });
    }
    await mkdir(destination, { recursive: true });
    await writeTextFile(await join(destination, "plugin.json"), JSON.stringify(manifest, null, 2));
    await writeTextFile(await join(destination, manifest.main), source);
    const disabled = readDisabledIds();
    disabled.delete(manifest.id);
    localStorage.setItem(disabledStorageKey, JSON.stringify([...disabled]));
    setPlugins((current) => [...current.filter((plugin) => plugin.id !== manifest.id), { ...manifest, source, enabled: true, builtin: false }]);
  }, []);

  const installBuiltin = useCallback(async (id: string) => {
    const builtin = builtinPackages.find((plugin) => plugin.manifest.id === id);
    if (!builtin) throw new Error("Unknown built-in plugin.");
    const root = await join(await appDataDir(), "plugins");
    const folder = await join(root, id);
    if (await exists(folder)) return;
    await writePluginFiles(folder, builtin.manifest, builtin.source);
    const disabled = readDisabledIds();
    disabled.delete(id);
    localStorage.setItem(disabledStorageKey, JSON.stringify([...disabled]));
    setPlugins((current) => [...current, { ...builtin.manifest, source: builtin.source, enabled: true, builtin: true }]);
  }, []);

  const setEnabled = useCallback((id: string, enabled: boolean) => {
    setPlugins((current) => current.map((plugin) => plugin.id === id ? { ...plugin, enabled } : plugin));
    const disabled = readDisabledIds();
    if (enabled) disabled.delete(id);
    else disabled.add(id);
    localStorage.setItem(disabledStorageKey, JSON.stringify([...disabled]));
  }, []);

  const uninstall = useCallback(async (id: string) => {
    const folder = await join(await appDataDir(), "plugins", id);
    await remove(folder, { recursive: true });
    setPlugins((current) => current.filter((plugin) => plugin.id !== id));
    const disabled = readDisabledIds();
    disabled.delete(id);
    localStorage.setItem(disabledStorageKey, JSON.stringify([...disabled]));
  }, []);

  return { plugins, actions, contextMenuItems, commands, statusItems, panels, emitEvent, pluginDirectory, availableBuiltins, installFromFolder, installBuiltin, setEnabled, uninstall };
}

function pluginWorkspacePath(root: string, path: string, allowRoot = false): string {
  if (!root) throw new Error("Open a workspace first.");
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (!allowRoot && !parts.length) throw new Error("Workspace path is required.");
  if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Plugin file paths must stay inside the workspace.");
  }
  const separator = root.includes("\\") ? "\\" : "/";
  return parts.length ? `${root.replace(/[\\/]$/, "")}${separator}${parts.join(separator)}` : root;
}

function parentDirectoryPath(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index < 0 ? path : path.slice(0, index);
}

async function writePluginFiles(folder: string, manifest: PluginManifest, source: string) {
  await mkdir(folder, { recursive: true });
  await writeTextFile(await join(folder, "plugin.json"), JSON.stringify(manifest, null, 2));
  await writeTextFile(await join(folder, manifest.main), source);
}
