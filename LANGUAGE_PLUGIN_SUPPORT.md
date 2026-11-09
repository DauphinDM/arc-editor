# Plugin Language Support — Research & Implementation Spec

Goal: extend the plugin API so community plugins can add support for programming languages
that the editor does not natively support (syntax highlighting, parsing, comment tokens,
indentation, snippets/autocomplete, and optionally formatting). The reference example
throughout this document is **C#** (`registered extensions: ['cs']`), but the design is
fully generic.

This document contains everything needed to implement the feature: current architecture
facts, design of the new API surface, step-by-step implementation plan, plugin-author
examples, gotchas, and deferred items.

---

## 1. Feasibility verdict

**Possible, and a clean fit for the existing plugin system.** No new dependencies, no
Tauri/Rust changes, no new security surface for v1. CodeMirror 6 (the editor) is
explicitly designed for languages to be added as extensions; the app already has the exact
"registered contribution" pattern (toolbar actions, status items, panels) that a language
registry needs.

What is missing today is only:

1. A way for plugin code to obtain shared CodeMirror/Lezer module references
   (blob-URL plugins cannot `import` them).
2. A registry that maps file extensions → plugin-supplied `Extension`s and feeds the
   editor's language compartment.
3. A formatter registry consulted before the Prettier fallback.
4. Documentation of the plugin authoring rules.

---

## 2. Current architecture (facts, with file:line)

### 2.1 How languages are attached today

- `src/App.tsx:771` — `loadCodeLanguage(extension: string): Promise<Extension>`.
  Hardcoded, statically-known mapping from file extension to an npm `@codemirror/lang-*`
  package, dynamically imported:
  - `html, htm, svg` → `@codemirror/lang-html`
  - `php` → local `php()` helper
  - `css, scss` → `@codemirror/lang-css`
  - `js, mjs, cjs, jsx, ts, tsx` → `@codemirror/lang-javascript` (jsx/typescript flags)
  - `json, jsonc` → `@codemirror/lang-json`
  - `md, mdx` → `@codemirror/lang-markdown`
  - unknown extension → `[]` (no language support)

- `src/App.tsx:839-843` — `EditorPane` owns three `Compartment`s: `settings`, `theme`,
  `language`. The language compartment starts empty (`App.tsx:863`).

- `src/App.tsx:912-927` — effect that calls `loadCodeLanguage(extensionOf(file.name))`
  when the file path changes, then reconfigures the language compartment via
  `compartments.language.reconfigure(language)`.

- `src/App.tsx:1012-1018` — theme compartment includes
  `syntaxHighlighting(buildCodeHighlighting(theme))`. Any language's highlighting works
  through this shared highlighter **as long as its tags come from the app's single
  `@lezer/highlight` instance**.

- `extensionOf(name)` (`src/App.tsx:651`) — lower-cases everything after the last dot.

### 2.2 How formatting works today

- `src/App.tsx:654` — `prettierFormat(name, content): Promise<string | null>`.
  Hardcoded parser map (html, css/scss, js, ts, json, markdown, yaml). Returns `null`
  for unknown extensions.
- `src/App.tsx:2621` — `formatFile(path)`. Calls `prettierFormat`; on `null` shows
  "Prettier does not support .{ext} files." This is the hook point for plugin formatters.

### 2.3 How the plugin system works today

- `src/pluginRuntime.ts` — `usePluginRuntime(workspace, notify, hostActions)` returns
  `{ plugins, actions, contextMenuItems, commands, statusItems, panels, emitEvent,
  pluginDirectory, availableBuiltins, installFromFolder, installBuiltin, setEnabled,
  uninstall }` (line 717).
- Plugin code is loaded as: `plugin.json` + `main.js` read from
  `<appDataDir>/plugins/<id>/`, `main.js` read as raw text, turned into a Blob, and
  loaded with `URL.createObjectURL` + dynamic `import(/* @vite-ignore */ url)` 
  (lines 363-368).
- Registered contribution pattern (the pattern to copy):
  - Types `PluginActionDefinition`, `PluginPanelDefinition`, etc. (lines 29-84).
  - Registration closures inside the activate flow: `registerAction` (374),
    `registerContextMenuItem` (381), `registerCommand` (388), `registerStatusItem` (396),
    `registerPanel` (403). Each does: liveness check via `active`/`activeModules`,
    ID validation regex, definition validation, prefix the id with `plugin.id:`, dedupe by
    id, `setX((current) => [...current.filter(...), entry])`.
  - On plugin disable/update/uninstall, contributions are removed state-side (354-358).
  - On plugin shutdown (global unmount effect, 654-662), `active.disposables` are run and
    `active.cleanup` is called.
- The public API object is built inside the activate flow (418-639) typed by `PluginApi`
  (105-199). Notable: `themes.set`, `ui.registerPanel`, `events`, `storage` — all useful
  precedents for shape/ergonomics.
- `PluginHostActions` (201-226) already includes `getEditor(path?)` returning the raw
  `EditorView` (218) and `formatFile` (217), but neither is exposed on the public
  `PluginApi` today.
- `src/App.tsx:3679` — `usePluginRuntime` call site (host actions object built there,
  includes `getEditor` at 3736 and `formatFile` at 3735).
- `src/App.tsx:3896` — panels flow into the component tree as
  `pluginViews={pluginRuntime.panels}`; `EditorPane` accepts `pluginViews`
  (props at 806/826). This is the wiring precedent for passing a new `pluginLanguages`
  registry into the editor components.
- `vite.config.ts:17` — `@codemirror/language` and `@lezer/*` are already chunked into a
  dedicated `editor-language` chunk, so they are bundled exactly once app-side.

### 2.4 Bundle/import constraints (critical)

- Plugin `main.js` is loaded from a **blob: URL**. A bare-specifier `import`
  (`import '@codemirror/language'`) inside blob code **cannot resolve** — blob URLs have
  no node_modules base. So plugins cannot import any npm package at runtime.
- Plugins therefore pre-bundle everything they need into the single `main.js` file.
- **Fatal gotcha**: a plugin must NOT bundle its own copies of `@codemirror/*` or
  `@lezer/*`. Facets, tags, and highlight styles match by **object identity**. A duplicate
  `@lezer/highlight` produces different `Tag` instances that the app theme highlighter
  does not recognize (no coloring); a duplicate `@codemirror/language` splits facet
  instances (`indentUnit`, etc.) and silently breaks keymaps/indentation. This failure is
  documented in the wild (gapmiss/cm-code-editor's CLAUDE.md describes exactly this
  Tab-keymap failure after esbuild bundled its own `@codemirror/language` alongside
  Obsidian's).
- **Consequence for the API**: the host must expose shared, host-owned module references
  to plugins. This is what `api.codemirror` does below.

### 2.5 CodeMirror language reality check

- Official `@codemirror/lang-*` packages exist for: clike-family (js/ts/java/c/cpp),
  css, html, json, markdown, php, python, rust, sql, xml, yaml, lezer. Notably **no
  official C# package**.
- Two routes to define a language without an existing package:
  1. **`StreamLanguage.define()`** (`@codemirror/language`) — CM5-style stateful
     tokenizer. Token functions may return `@lezer/highlight` `Tag` objects, which the
     app's theme highlighter picks up. Supports `languageData` (e.g.
     `commentTokens`), plus editor-level `indentService`/`foldService` can be passed as
     extra extensions. Tokenizer-only quality, but zero external tooling.
  2. **`LRLanguage.define()`** + a `@lezer/generator`-produced parser — proper
     incremental parse tree, `foldNodeProp`, `indentNodeProp`, `styleTags`. Requires the
     author to run the Lezer generator and bundle the generated parser into `main.js`,
     with `@lezer/*` externals resolved from the host (see §6.2).
- `~80+` languages are already tokenized in `@codemirror/legacy-modes` (ported CM5 modes;
  includes `csharp` inside `mode/clike`) — a plugin can copy that mode's tokenizer source
  (MIT) into their `main.js` with no bundler at all.
- Prior art for the API shape:
  - CodeMirror's own convention: a language package exports a zero-arg-ish factory
    returning a `LanguageSupport` (`codemirror.net/examples/lang-package/`).
  - Obsidian: `plugin.registerEditorExtension` accepts a raw CM6 `Extension` and hosts
    cm6 through `EditorState`-compatible shared modules; plugins are told to use the
    host's cm6, not their own.

---

## 3. Design

### 3.1 New type: `api.codemirror` (shared module namespace)

```ts
export type PluginCodeMirror = {
  language: typeof import("@codemirror/language");
  view: typeof import("@codemirror/view");
  state: typeof import("@codemirror/state");
  autocomplete: typeof import("@codemirror/autocomplete");
  highlight: typeof import("@lezer/highlight");
};
```

Add `codemirror: PluginCodeMirror;` to `PluginApi` (`pluginRuntime.ts:105`).

- Implemented as plain top-of-file static re-exports, e.g.
  `import * as languagePkg from "@codemirror/language";` then
  `codemirror: { language: languagePkg, view: viewPkg, state: statePkg, autocomplete:
  autocompletePkg, highlight: highlightPkg }`, built once at module scope (constant
  object), referenced inside `api` as `codemirror: codeMirrorModules`.
- These are the **app's own instances**. All extensions a plugin constructs from them
  compose correctly with the app's compartments and theme highlighter.
- Cost: zero — all these packages are already in the app bundle.

### 3.2 New API: `editor.registerLanguage`

```ts
export type PluginLanguageDefinition = {
  id: string;                    // unique per plugin; auto-scoped to `${pluginId}:${id}`
  name: string;                  // human-readable, e.g. "C#"
  field?: string;                // optional machine scope, e.g. a comment token
  extensions: string[];          // file extensions this language claims, e.g. ["cs"]
  filenames?: string[];          // optional exact file basenames, e.g. ["Dockerfile", "Makefile"]
  load: () => Extension | Promise<Extension>;   // the CodeMirror extension(s)
};
```

Add to `editor` namespace in `PluginApi` (134-145):

```ts
editor: {
  ...existing,
  registerLanguage: (definition: PluginLanguageDefinition) => void;
}
```

- Extension strings validated the same way as extensions elsewhere (lower-case
  alphanumerics/dash, 1-8 chars); `filenames` case-insensitive.
- `load` may be sync or async (`Promise<Extension>`), matching the existing
  `loadCodeLanguage` async contract.
- **Registration is scoped and cleaned up exactly like `registerPanel`**:
  - Registered id becomes `${plugin.id}:${definition.id}`.
  - Stored in a new `languages` state array identical in shape to panels:
    `PluginLanguageContribution = PluginLanguageDefinition & { pluginId; pluginName }`.
  - On disable/update/uninstall (354-358) and on shutdown (654-662), the language's
    entries are removed and the affected open editors reconfigure to their fallback.
- **Duplicate policy**: an extension already registered by another (still-enabled) plugin
  → reject with error
  `Extension ${ext} is already registered by plugin ${otherPluginName}.`
  One plugin per extension keeps deterministic lookup and avoids surprising overrides.
  Built-ins first, plugin languages fill the gaps.
- Also queue an edit: after language registration, reconfigure open editors (see 4.3).

### 3.3 New API: `editor.registerFormatter`

```ts
export type PluginFormatterDefinition = {
  id: string;                                   // auto-scoped like languages
  name: string;                                 // e.g. "CSharpier"
  extensions: string[];                         // e.g. ["cs"]
  format: (content: string) => Promise<string>; // full-file formatting only
};
```

Add `registerFormatter` to `editor` in `PluginApi`.

- Same scoped registry/cleanup pattern as languages.
- Lookup precedence in `formatFile`: plugin formatter (last registered wins for a given
  ext) → Prettier → current "not supported" message.
- Full-file only for v1 (no range formatting), matching what `prettierFormat` does.

### 3.4 Host state & plumbing

`usePluginRuntime` return object gains:

```ts
languages: PluginLanguageContribution[];
formatters: PluginFormatterContribution[];
```

(state arrays next to `panels` at 277-282, with the same filtering/cleanup steps as 354-358
and 654-662.)

Resolved lookup helpers exported from the host for `App.tsx`:

- `resolveLanguage(fileName)` → `PluginLanguageContribution | undefined`
  (checks plugin languages by exact extension, then by `filenames` entries, case-insensitive)
- `resolveFormatter(fileName)` → `PluginFormatterContribution | undefined`

These are plain functions over the state arrays; `App.tsx` can also do the matching
inline if that is simpler — keep logic in one place (`pluginRuntime.ts`) either way.

### 3.5 `App.tsx` integration

1. **`loadCodeLanguage`** (771): rename conceptually to accept the active plugin
   registry. Before the built-in extension list, check the plugin registry:
   ```ts
   async function loadCodeLanguage(
     fileName: string,
     pluginLanguages: PluginLanguageContribution[],
   ): Promise<Extension> {
     const contribution = resolvePluginLanguage(fileName, pluginLanguages);
     if (contribution) return contribution.load();
     // ...existing hardcoded cascade, still last...
   }
   ```
2. **`EditorPane`**: accept a new prop `pluginLanguages: PluginLanguageContribution[]`
   (same shape as existing `pluginViews` prop at 826). The load effect (912-927) becomes
   dependent on `pluginLanguages` as well:
   ```ts
   useEffect(() => {
     // same body; add `pluginLanguages` to the effect deps and to the
     // cancellation guard so re-registered languages reconfigure live.
   }, [compartments.language, file?.path, file?.name, pluginLanguages]);
   ```
   Because `pluginLanguages` is a state array from `usePluginRuntime`, every register /
   disable / uninstall triggers a re-dispatch of `compartments.language` with no editor
   rebuild and no data loss.
3. **`formatFile`** (2621):
   ```ts
   const formatter = pluginFormatters.find(...) ?? resolveFormatter(file.name);
   if (formatter) { const formatted = await formatter.format(content); ... }
   else { const formatted = await prettierFormat(file.name, content); ... }
   ```
   Errors from plugin formatters surface through the same `catch (error)` /
   `setMessage` path as Prettier failures.

### 3.6 One-time asset note

Lezer-grammar-based languages need a build step (see §6.2). The simplest ship-path for
this feature is the stream-tokenizer route (§6.1), which needs no bundler — a C# plugin
copying the `clike` mode's C# branch is a single hand-written `main.js`.

---

## 4. Implementation plan (ordered)

1. `src/pluginRuntime.ts`
   - Add `PluginLanguageDefinition`, `PluginLanguageContribution`,
     `PluginFormatterDefinition`, `PluginFormatterContribution` types near the other
     definition types (29-84).
   - Add module-scope `codeMirrorModules` object and `PluginCodeMirror` type.
   - Extend `PluginApi`: `codemirror`, `editor.registerLanguage`,
     `editor.registerFormatter`.
   - Add `languages` / `formatters` state arrays.
   - In the activate flow (after `registerPanel`, ~403-409) add `registerLanguage` and
     `registerFormatter` closures:
     - liveness check (`active` + `activeModules` identity), copy of the panel pattern;
     - validate `id` (same regex as `validateId`), `name.trim()`,
       `extensions` non-empty + each matches `/^[a-z0-9][a-z0-9-]{0,15}$/`,
       `filenames` (if present) matches `/^[a-z0-9._-]+$/i`, and `load`/`format` are
       functions;
     - duplicate-extension rejection across contributions **from other plugins**;
     - push `active.disposables` entries that unregister the contribution (so plugin
       crash/disable removal also cleans these state arrays);
     - prefix stored id with `${plugin.id}:`.
   - Removal points: extend the `setPanels(current => ...)` block (354-358) and the
     unmount cleanup (654-662) with `setLanguages` / `setFormatters` filtering by
     `pluginId`.
   - Wire `registerLanguage` / `registerFormatter` into the `api` object (next to
     `registerAction` at 637-638).
   - Export `resolvePluginLanguage(fileName, languages)` and
     `resolvePluginFormatter(fileName, formatters)` helpers.
2. `src/App.tsx`
   - `formatFile` consumes `pluginRuntime.formatters` first (2621-2646).
   - `loadCodeLanguage(fileName, pluginLanguages)` consults the plugin registry first.
   - Pass `pluginLanguages` + `pluginFormatters` through the same paths as
     `pluginViews` (3896) into `EditorPane`; add the prop and the effect-deps change.
   - Language effect deps must include `pluginLanguages` so already-open editors adopt
     a newly registered language (and fall back to built-ins when a language plugin is
     disabled).
3. `src/PluginPanel.tsx` (optional but recommended): display registered languages /
   formatters per installed plugin in the plugin detail view — helps users discover
   which plugin claims which extension.
4. `PLUGIN_API.md` — add:
   - `api.codemirror` reference table;
   - `editor.registerLanguage` section with the C# example below (§6.1);
   - `editor.registerFormatter` section with the JS formatter example below (§6.3);
   - the *Rules for plugin authors* list (§5);
   - note that registered extensions take precedence over the built-in list, one plugin
     per extension.
5. Flesh out one built-in-style example plugin under `plugins/` for testing only if the
   developer wants an e2e demo — not required for the feature itself.

Validation of the finished work:
- `npx tsc -b` clean.
- Manual: install a test C# plugin (§6.1); open `foo.cs` → highlighting + comment tokens
  + indent; disable plugin → falls back to plain text with no stale styling;
  re-enable → recovers; two plugins claiming `.cs` → second install blocked at
  registration time with the duplicate-extension error.

---

## 5. Rules for plugin authors (goes into PLUGIN_API.md verbatim-worthy)

1. Ship **one** `main.js` file, ESM, named export `activate(api)`.
2. **Do not bundle or import `@codemirror/*` or `@lezer/*` yourself.** Take everything
   from `api.codemirror.*` — these are the app's own modules. Your own copies will
   "work" syntactically but break silently: tags won't be themed, keymaps/indent facets
   will mismatch (tested against CM6's object-identity equality for facets/tags).
3. Your tokenizer/parser code (the language definition itself) **is** bundled into
   `main.js` — that is fine and expected. Only the CM/Lezer runtime must stay external.
4. Register one language per `extensions` set; do not claim an extension another plugin
   already registered — the host rejects duplicates at activation time.
5. `load()` may be asynchronous — parse-table-heavy grammars can lazy-load from a
   bundled data string inside `main.js`.
6. Formatting: `format(content)` receives the full file text and must return the
   fully-formatted text or throw. No selection/range formatting in v1.
7. Your code runs with full plugin privileges (same trust as today's plugins) — the
   existing install-confirmation dialog covers it; `registerLanguage` adds no new
   protected surface.

---

## 6. Plugin-author examples (reference implementations)

### 6.1 C# via `StreamLanguage` (no bundler needed)

```js
// plugins/csharp/main.js
export function activate(api) {
  const { language, highlight } = api.codemirror;
  const { StreamLanguage, LanguageSupport } = language;
  const { tags: t } = highlight;

  // Tokenizer adapted from @codemirror/legacy-modes/mode/clike ("csharp" branch, MIT).
  // Bundled verbatim into this file — allowed, because it is language definition code,
  // not @codemirror runtime.
  const words = { /* csharp keyword table copied from clike's cpp-like word list + C# additions */ };
  const cSharp = StreamLanguage.define({
    name: "csharp",
    token(stream, state) {
      // keyword/string/comment/number/placeholder handling — full copy from clike mode
      // (omit the tokenToTags shim; return Tag objects directly),
    },
    languageData: {
      commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
      closeBrackets: { brackets: ["(", "[", "{", "'", "\""] },
    },
  });

  api.editor.registerLanguage({
    id: "csharp",
    name: "C#",
    extensions: ["cs"],
    load: () => new LanguageSupport(cSharp),
  });
}
```

What this unlocks immediately: syntax highlighting via the app theme (tags route),
line/block comments, bracket auto-close, Tab indentation (host `indentUnit` — intact
because we did not bundle CM), plus any stream-parser `indentService`/`foldService`
passed as extra extensions inside `load()`'s `LanguageSupport`.

For real structural features (folding of regions/classes, precise auto-indent), the same
plugin can be upgraded to the Lezer route (§6.2) without touching the host API.

### 6.2 C# via a Lezer grammar (better parse tree, requires a build step)

Author flow:
1. Write `grammar.js` for `@lezer/generator`, generate `parser.js` at dev time.
2. Bundle `parser.js` + a thin wrapper into a **single ESM file** where imports of
   `@lezer/common`, `@lezer/highlight`, `@codemirror/language` are marked external and
   expected to be provided **by the host**, not bundled:
   ```
   import { LRParser } from "@lezer/common";        // fails from blob URL... 
   ```
   …which is exactly why §3.1 exists: the author must NOT emit bare imports. Two
   supported techniques for shipping generated parsers:
   - **(a) Rewrite generated imports.** A 3-line post-processing of the generated
     `parser.js` replacing `import ... from "@lezer/common"` /
     `"@lezer/highlight"` with constructor args. Document a tiny `tshy`-style
     codemod in PLUGIN_API.md, or
   - **(b) Ship without imports** — configure `@lezer/generator` with
     `--type-prefix` and write your own wrapper that receives the host modules as
     parameters:
     ```js
     export function activate(api) {
       const { language, highlight, state } = api.codemirror;
       const parser = makeParser({ LRNodeLike..., });   // parser tables as plain data
       ...
     }
     ```
   For v1 the community guidance is: prefer route (§6.1). Add the Lezer pattern to the
   docs only after one real grammar-based plugin proves the technique — do not
   over-engineer the host API for it now.
3. Wrap in `LRLanguage.define({ parser: parserWithMetadata, languageData: {...} })` and
   `registerLanguage` the same way as §6.1.

### 6.3 C# formatting plugin (pending `process.exec` — deferred)

Not achievable today: the API has no process-spawning capability
(`localServer.start/stop` and `process.isRunning` are the only things even close, and
`isRunning` is read-only). The moment the app ships a scoped `api.process.exec` (see §8),
a formatter plugin becomes:

```js
api.editor.registerFormatter({
  id: "csharpier",
  name: "CSharpier",
  extensions: ["cs"],
  format: async (content) => {
    const { stdout } = await api.process.exec("dotnet", ["csharpier", "--write-stdout"], { stdin: content });
    return stdout;
  },
});
```

Until then, formatters must be pure JS. Document `extensions: ["cs"]` formatter results
as future work — do not block language-support v1 on it.

### 6.4 Autocomplete/snippets (works today, no extra API)

```js
load: () => new LanguageSupport(cSharp, [
  api.codemirror.autocomplete.autocompletion({
    override: [/* or your own CompletionSource */],
  }),
])
```

Everything the language compartment receives is just another `Extension`, so
completions, search-key preservation, and host keymaps all compose normally.

---

## 7. Edge cases & risks

- **Race: file opened before plugin loads.** Language effect fires with plugin languages
  not yet registered → plain text. When the registration lands, `pluginLanguages`
  identity changes → effect re-runs → compartment reconfigures. No action needed; do
  not add a blocking wait.
- **Plugin crash after registering.** `activeCleanup`/disposables pattern removes
  contributions when `activeModules` entry is torn down (existing behavior for panels
  at 350-358). Copy it exactly.
- **Multiple editors across split groups.** Each `EditorPane` has its own compartment;
  the new effect-deps wiring handles all instances uniformly. No shared global state, no
  cross-editor races beyond normal React effects.
- **Extension casing / weird filenames.** `extensionOf` already lower-cases. Validation
  of `extensions` restricted to lowercase alphanumerics + dash; `filenames` compared
  lowercase.
- **Theme highlighting conflict.** Stream token functions should return `Tag` objects
  (from `api.codemirror.highlight.tags`) rather than legacy string class names, so the
  app's highlighter picks them up via `syntaxHighlighting(buildCodeHighlighting(theme))`
  (`App.tsx:1017`). Document this; returning strings silently produces no color under
  the app's modern highlighter.
- **Formatter error surface.** Plugin formatter throwing → same `setMessage(...)` path
  as Prettier failing, must not dirty the buffer before the throw (format first,
  apply only on string result).
- **Duplicate registration inside the same plugin.** Allowed (replace by scoped id,
  matching existing `setActions(... filter ...)` semantics) — only *cross-plugin*
  duplicates are rejected.
- **Bundle size.** Grammar-heavy plugins can produce large `main.js`. No JS size cap
  exists today (only the 100 KB CSS cap at 591); consider no cap for v1 and note it in
  the docs if it becomes a problem.

---

## 8. Explicitly deferred (not part of this feature)

- `api.process.exec(command, args, options)` for external formatters like CSharpier /
  clang-format. New trust surface — deserves its own design (scoped allowlist per
  plugin, user prompt on first use). Not required for highlighting/syntax/indent/
  comments/snippets.
- Tree-sitter / WASM-based parsers (Zed's model). CM6 adapters exist in the ecosystem
  but are not needed for the target use cases and would complicate the API.
- LSP integration (hover, go-to-def, diagnostics from a language server). Different
  architecture (needs Tauri-side long-lived subprocesses + protocol layer); revisit if
  `process.exec` ships.
- File-type icons for plugin-claimed extensions (`FileIcon` at `App.tsx:742` is
  hardcoded). Cosmetic, independent feature.
- Range/selection-restricted formatting. `prettierFormat` doesn't do it either; add
  later only with contract for cursors/selection preservation.

---

## 9. Summary of touched files

| File | Change |
| --- | --- |
| `src/pluginRuntime.ts` | `PluginCodeMirror` type + shared module object; `PluginLanguageDefinition`/`PluginFormatterDefinition` (+Contribution) types; `languages`/`formatters` state; `registerLanguage`/`registerFormatter` closures + cleanup; `api.codemirror` + `api.editor.registerLanguage`/`registerFormatter`; exported resolver helpers |
| `src/App.tsx` | `loadCodeLanguage` consults plugin registry; `formatFile` consults plugin formatters; new `pluginLanguages` prop into `EditorPane` with effect-deps wiring; formatter branch precedence |
| `src/PluginPanel.tsx` | (optional) show registered languages/formatters per plugin |
| `PLUGIN_API.md` | `api.codemirror` section, `registerLanguage` + C# example, `registerFormatter` section, "Rules for plugin authors" |

No new dependencies. No Tauri changes. No new host trust surface.
