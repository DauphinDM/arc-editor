# VS Code Extension Compatibility Research

Question: can Arc load existing VS Code extensions (.vsix) through a translation layer, on top of the current plugin manager and plugin API? This document covers how the pieces work today, how prior projects solved this, what a translation layer requires, and what we should (or should not) build. Research only; nothing implemented.

## TL;DR (verdict)

**Possible, partially, with a well-mapped subset.** Full compatibility is a multi-year effort even for Theia, which has had a team on it since 2019 and still documents hard limits (native modules, DOM hacks, private APIs, proposed APIs). A realistic target for Arc is a **tiered compatibility layer** that supports the most valuable extension categories first — themes, grammars, snippets, keymaps, simple command/UI extensions — with declared limits for the rest. The hard technical pieces all have public prior art:

- Intercepting `require('vscode')` and serving a shim: Theia does exactly this (`plugin-ext-vscode`), patching Node's `module._load` or injecting the API into a Web Worker.
- Hosting extensions in a worker with RPC back to the UI: VS Code itself (web extension host) and Theia (worker plugin host).
- TextMate grammars/themes in CodeMirror 6: `@cmshiki/shiki`, `codemirror-textmate`, `vscode-textmate` + oniguruma WASM all prove the bridge works.
- Marketplace distribution legally requires **Open VSX** (VS Code Marketplace ToU forbids other editors from using it).

Estimated subset: a meaningful Tier-1 (manifest + contributes + core `vscode` shim + loader + UI mapping) is roughly 2.8k–6k lines of integration code and several weeks of focused work. It compounds: each API namespace added raises the compatibility ceiling.

## 1. What Arc has today

From `src/pluginRuntime.ts` and `PLUGIN_API.md`:

- **Plugin format**: single directory with `plugin.json` + `main.js`, one self-contained ESM file, no bare imports. Loaded from `appDataDir()/plugins`, seeded built-ins, enable/disable/uninstall persisted in localStorage.
- **Loading mechanism**: source read as text, compiled to a Blob URL, dynamic `import()` in the **main realm** (same React page, same DOM). `activate(api)` may be async, returns optional cleanup.
- **API facade**: `api.plugin`, `app`, `files`, `editor`, `terminal`, `settings`, `themes`, `dialogs`, `clipboard`, `window`, `ui` (notify/confirm/prompt/actions/context menu/status items/commands/panels/styles), `commands`, `events`, `storage`, `localServer`, `process`, `invoke`.
- **Contribution registries**: actions, context menu items, commands (with palette + shortcuts), status items, panels — all namespaced `plugin-id:contribution-id`, torn down on disable.
- **Host actions** (`PluginHostActions`): app state snapshot, file ops, editor access via CodeMirror `EditorView` (text, selection, dispatch), terminals, settings/themes.
- **Events**: a fixed set (`workspace:changed`, `editor:active`, `editor:changed`, `file:saved`, `settings:changed`, `terminal:opened/closed`) plus plugin-scoped emit.

Implications for the translation layer:
- No isolation exists today (main realm). Same-realm VSIX loading is *possible* mechanically but escalates risk (CommonJS global/module pollution, crash-the-UI).
- The registries map well onto VS Code `contributes`: commands → commands, status items → status bar, panels → views/webviews, events → `onDidChange...`. The layer can be built **on top of** the existing runtime by treating the `vscode` shim as a second facade over the same host actions.
- Gaps that are *Arc API* gaps, not just VSIX gaps: real document model (TextDocument with versions/line math), decorations/inline UI in the editor, tree views (sidebar), quick pick/input as formal UI primitives, output channels, config model, secrets, LSP host. Several of these benefit native plugins too.

## 2. What a VS Code extension actually is

- A `.vsix` is a ZIP containing `extension/package.json` (manifest), entry JS (CommonJS `main` or web `browser`, or ESM `.mjs` since 1.86), bundled dependencies, optional `.node` native modules, and `contributes` (declarative wiring) + `activationEvents`.
- Extension code runs in an **extension host** — a separate Node.js process (desktop) or Web Worker (web) — never inside the UI process. It obtains the API via `require('vscode')` (or `import ... from 'vscode'`), which the host injects.
- API surface is large and evolving: `vscode.d.ts` has 2,000+ exported members across `window`, `workspace` (+ `workspace.fs` FileSystemProvider), `commands`, `languages`, `extensions`, `env`, `l10n`, `debug`, `tasks`, `scm`, `authentication`, `secrets` (proposed), plus data classes (`Uri`, `Position`, `Range`, `Selection`, `EventEmitter`, `Disposable`, `CancellationToken`, `WorkspaceEdit`, `Diagnostic`, `CompletionItem`, `Hover`, `CodeAction`, `TreeItem`, `StatusBarItem`, `OutputChannel`, `WebviewPanel`, `TreeView`, `QuickPick`, `TestItem`, `NotebookCell`...). Events are the connective tissue; providers (`registerXxxProvider`) are the Python/JS-infrastructure surface.
- Two runtimes per extension: `extensionKind: ["ui" | "workspace" | "web"]`. `main`/node extensions use `require`, `__dirname`, `child_process`, `fs`, `os`, `path`, sometimes native `.node`. `browser` extensions are workers with only `vscode` + the Web platform + `workspace.fs`.
- `engines.vscode` is a semver constraint. Most stable-API extensions allow `^1.x`. Proposed-API calls fail unless the host opts in (`ENABLE_PROPOSED_API`). Extensions also call *internal* commands (`vscode.open`, `vscode.diff`, `editor.action.*`, `workbench.action.*`...), which hosts must map (Theia maintains this mapping).

## 3. Prior art

### Eclipse Theia (the gold standard)

- Adds VS Code extension support via `@theia/plugin-ext`, `@theia/plugin-ext-vscode`, `@theia/vsx-registry`: shim serving a simulated `vscode` namespace, plugin host as sandboxed Node process *or* Web Worker, custom RPC synchronizing commands/documents/UI between host and frontend, built-in command mapping (`vscode.open` → OpenerService, etc.), webviews via iframe + postMessage, ESM extension loader hook.
- Runs a public API-coverage comparator (`vscode-theia-comparator`) against real VS Code versions and an `npx theia-vscodecov` tool that reports per-vsix missing symbols/commands. Despite years of work, limitations remain: native modules must be compiled for the host's Node; private/Electron-internal APIs fail; DOM-based UI hacks fail; proposed APIs unsupported.
- Takeaway: compatibility is an unbounded treadmill against a moving VS Code, and even the reference implementation is honest about it.

### Web-based VS Code hosts

- VS Code's own web extension host runs browser-capable extensions in a Web Worker with an RPC proxy to the workbench; extensions there cannot spawn processes or touch the DOM, and file access goes through `workspace.fs`.
- This is the cleanest architecture for a non-VS Code host that still wants real third-party extension code: isolate, proxy, and implement only the services the worker sees.

### OXP (Open Extension Protocol) — 2026, instructive failure boundary

- Cross-editor extension format (WASM components + host adapters). When bridging *ordinary* Open VSX `.vsix` packages via a `require('vscode')` shim, the author reports **~20% of extensions** engaged with only basic namespaces mapped (`window.showInformationMessage`, `workspace.fs`, `commands`); language servers and webviews are "the mountain" (their words).
- Confirms the subset math: shallow shim = theme/utility share only; deep value (linters, AI, SCM) requires child processes, language clients, webviews.

### RunVSAgent (JetBrains hosts for Kilo/Cline/Roo, 2025)

- Separate proof that the shim approach works end-to-end for *specific* heavy extensions: implement just the API surface those six-ish extensions need, in the host language (Kotlin), plus unzip-install VSIX files, or run the extension in a Node server. Consensus in the discussion: useful, but essentially reimplementing per-target and per-extension.

### Editors that chose not to do this

- Zed and Lapce built WASM/native extension systems instead and do not run VSIX. Their ecosystem fiction is "themes/languages are data, not code". This is evidence (not proof) that full VSIX support at their scale wasn't worth the floor cost of shimming.

### What does not exist

- No off-the-shelf, complete `vscode` npm shim (monaco/editor-agnostic) exists. Monaco does not run extensions. Fragmented partial shims (LSP-only `vscode-languageserver-protocol`, `monaco-languageclient`) exist but are not full API layers. Every serious host (Theia, VS Code web) built the shim inside themselves.

## 4. Legal/distribution

- **VS Code Marketplace**: ToU/URL-clause restricts marketplace artifacts to official Microsoft products. Downloading/restaging .vsix programmatically is explicitly called out by Theia maintainers as against ToU. Do **not** integrate marketplace download.
- **Open VSX** (Eclipse Foundation): open registry, same .vsix format, public API (search at `https://open-vsx.org/api/-/search`, item lookups and file URLs under `https://open-vsx.org/api/{namespace}/{name}/{version}/...`). Some popular extensions are missing or lag (e.g., Copilot); "install from .vsix" covers the rest innocuously.
- Extensions remain under their own licenses; hosts like VSCodium/Cursor operationalize Open VSX exactly this way.

## 5. Where the extension code should run in Arc (options)

**A. In-realm CommonJS loader (like current plugins, but CJS).**
Wrap each JS file with `new Function('require','module','exports',...)`, inject the shim plus fake Node core modules. Synchronous, simple, no new processes. But: CommonJS bundlers interleave; one bad extension can freeze or crash (React page); globals collide; no worker services; native `.node` impossible. Fits Arc's identity as a fast, do-it-yourself editor only if we accept instability risk. Not the long-term home.

**B. Worker extension host + RPC (Theia worker path / VS Code web path).**
One Web Worker (or a pool). Host side: manifest scanner, activation-event resolver, CommonJS module registry inside the worker, `vscode` shim implemented as RPC calls to the main thread, data classes served locally in the worker (cheap, no RPC), `require` shims for `path`, `events`, `buffer`, `os`, `xmlhttprequest`-free `http`, and worker-compatible `workspace.fs` backed by two calls into the plugin/runtime API. UI side: implements the "host services" (documents, editors, views, dialogs) against our existing registries. Pros: isolation, matches VS Code semantics, uses only what Tauri+browser give us now. Cons: worker can't spawn processes — shelling out to language servers/binaries needs a bridge to the Rust side (we already have `api.process`, `localServer`, terminal infrastructure).

**C. Node sidecar extension host (Theia node path).**
Ship a Node runtime (Tauri shell sidecar; bun/node single-binary ~40–90 MB) actually implementing or vendoring the real VS Code extension host bootstrap; extensions get true Node (breaking change: native `.node` modules become *depend on* our Node version; some fail regardless). Highest compatibility ceiling, largest distribution and maintenance cost, plus we would partially reimplement the workbench's half of the protocol anyway (that half is the same work as B, just also mapped over a different transport).

Deltas between B and C are mostly about *how many binaries run*, not about the shim's design. A sane course is B first with the RPC/chunked protocol shaped so the same shim logic could graduate to C later if demand warrants. Native-dependency extensions (`esbuild`, `tree-sitter`, debug adapters) stay out of reach until/unless C happens.

## 6. What the translation layer must cover

### Manifest/contributes translation (declarative — cheap, high value)

| VS Code contributes | Arc mapping | Notes |
| --- | --- | --- |
| `commands` (+ `menus.commandPalette`) | `api.ui.registerCommand` | titles/shortcuts via `keybindings` |
| `keybindings` | command palette + editor keymap | `Ctrl`/`Cmd` normalization |
| `viewsContainers.activitybar`, `views` | sidebar panels + `registerPanel`/tree view | TreeView needs a list renderer + `TreeItem` |
| `configuration` | merged settings fallback | extensions read only; writes go to Arc settings or no-op |
| `menus.*` (editor/context/title) | context menu items, toolbar actions | partial: no per-MCB refinements |
| `languages` | language registration | maps to CodeMirror suggestion/fallback language data |
| `grammars` | TextMate loader | VS Code textmate + oniguruma WASM (or regexes compiled to JS, as shiki's JS engine does) feeding a CM highlighter |
| `themes` | theme registration | convert token colors/syntax rules to CM `HighlightStyle`/CSS vars (proofed by `@cmshiki/shiki`) |
| `snippets` | completion source provider | straightforward |
| `jsonValidation`, `colors`, `markdown.previewStyles` | niche; support individually or ignore | |

### `vscode` API shim (the long pole; grouped by effort)

- **Pure classes/data (no host calls)**: `Uri`, `Position`, `Range`, `Selection`, `EventEmitter`, `Disposable`, `CancellationTokenSource`, `ThemeColor/Icon`, `Diagnostic`, `CompletionItem`, `CodeLens`... Implement locally in the worker; free wins.
- **State/registry APIs**: `commands.registerCommand/executeCommand/getCommands`, `env.*`, `l10n`, `workspace.getConfiguration`, `workspace.fs` (over our files API / Tauri fs), `workspace.findFiles`, `workspace.textDocuments`, `workspace.onDidChange...`, `window.activeTextEditor`, `window.textEditors`, `window.messages` (`showXxxMessage`, `setStatusBarMessage`, `withProgress`), `window.showQuickPick/InputBox`, `window.createOutputChannel`, `window.createStatusBarItem`, `window.createWebviewPanel`, `window.registerTreeDataProvider/registerWebviewViewProvider`, `languages.getDiagnostics`, `languages.createDiagnosticCollection`, `extensions.getExtension/all`, `WorkspaceConfiguration`, `WorkspaceEdit`, `TextDocument`, `TextEditor` abstractions.
- **Language providers** (big engineering arc; each provider bridges to CodeMirror extension points or AbortAll): hover, completion, signature help, definition/references/rename/folding/formatting (`documentHighlight`, `DocumentFormattingEditProvider`, `RenameProvider`, `SignatureHelpProvider`, `DocumentSymbolProvider`...). We own common infrastructure: document model + CodeMirror plugin layer. This is where most "language support" extensions land.
- **Outsized/deferred**: `debug` (needs our own DAP client + UI), `tasks`, `scm`, `notebooks`, `authentication`, `test`, `inlineCompletions`, `secrets`. With an honest subset, extensions that depend on these can be detected at load and fail politely ("extension X needs APIs Arc does not provide yet").
- **Non-API dependencies**: extensions also invoke internal VS Code commands; map the common ones (`vscode.open`, `vscode.diff`, `vscode.openFolder`, `editor.action.formatDocument`...). Theia's mapping list is the seed data.
- **`vscode-languageclient`** is *the* dependency of serious language extensions. Spawning servers = worker→Rust process bridge with capability gating; once present, Tier-3 language extensions become possible en masse.

### Loader internals

- Unzip `.vsix` (Rust `zip` crate) → install tree under `appDataDir()/extensions/{publisher}.{name}-{version}`; parse manifest; resolve `main`/`browser` by `extensionKind`.
- Worker-side CommonJS registry: cache per extension ID, prevent cross-extension `require` unless `extensionDependencies` declares it, remap bare deps inside the bundle (VSIX bundles are normally self-contained via esbuild/webpack; missing bare names → record and teach, don't guess).
- `engines.vscode` gate: report a fixed Arc-claimed version in the `^1.x` range our shim actually covers (start around `1.87–1.97`-ish where the API surface we implement exists; Tune as subset grows). Hard-block extensions whose code paths hit proposed APIs or tools like `@vscode/test-electron`, and warn on `extensionDependencies` for built-ins we don't ship (git, vscode-NPM-Scripts...).

### Legal and security seams (plain-English note)

Running third-party extension code inside a loaded webview that has workspace write and shell-bridge access carries real risk: extensions can read/write code, exfiltrate secrets via env access, and run arbitrary processes through the compat layer even BCE-neutral ones like "trusted" utility extensions depend on such escalation. Mitigations must exist before shipping: (1) install prompt identical to (or stricter than) the existing plugin flow, (2) per-extension capability broker (hasNodeProcess, hasNetwork, hasWorkspaceWrite — Theia and OXP both formalize this in their hosts), (3) worker isolation from the mainrealm (no direct DOM reach except through webviews with strict CSP), (4) clearly document that VSIX extensions from Open VSX/自定义 are untrusted inputs, (5) offline install from .vsix remains available but requires explicit user intent per extension. Sandbox workers are not perfect; they shrink blast radius, they don't make code safe.

## 7. Compatibility tiers (what actually runs at each step)

**Tier 0 — data contributions (no code execution):** themes, snippets, keymaps, grammars, language packs' static parts, `iconThemes`.
These don't need the extension host to run extension JS at all (many themes/grammars ship as data files; loaders may be trivial scripts). Enormous perceived compatibility for ~zero API risk. Typical hit list works immediately: One Dark/Dracula/One Monokai, language additions, icon themes.

**Tier 1 — shallow-code extensions (commands, notifications, views):** anything whose code touches only `window.*` messages, `commands.registerCommand`, `getConfiguration`, `workspace.fs`, quick pick, status bar, output channel, simple tree views, simple webviews. Roughly the "20% engaged" set OXP saw, plus views/webviews if we build them. Examples in spirit: TODO tree (tree view), indent-rainbow (decorations — needs decoration bridge), Error Lens hooks diagnostics (needs the linter/provider arc), Material Icon Theme (pure icons).

**Tier 2 — config/dev-tooling extensions:** extensions that *read files and buttons* plus do simple work; formatters that embed engines (Prettier-like, JS-only), snippet generation, editor UX utilities. Blocked only by child_process need — solved by the Rust-side process bridge (spawn formatter/linter binaries, gated by consent), feeding output back through the shim.

**Tier 3 — language servers:** `requirements`: process bridge + `vscode-languageclient` shim + provider bridge in CM. Unlocks the general "install language support for X" workflow users ask first. Theia and VS Code web both make this work; it is the single highest-value subproject.

**Out of reach for a long while:** GitLens (SCM + custom decorations + webviews), Python/C#/C++ (debuggers, adapters, per-language binary needs), Copilot-class AI (webviews + long-lived auth + model providers), Remote-SSH (needs full server), Jupyter, test runners, notebooks. Each incidentally needs multiple Tier-3 axes plus non-extension-host features (debug UI, SCM UI). Detect-and-fail-fast keeps them from silently misbehaving.

## 8. Recommendation

**Phase 0 — plugin API home improvements (do regardless, dually: native plugins benefit first).**
1. Formal document model: versioned TextDocument-like handle (open/changed/saved/downstream edits consistent) so both `api.editor` and the future shim read the same source of truth.
2. Decorations/gutters API over CodeMirror (mark ranges, lines, classes) — unlocks indent-rainbow-style native plugins and is the substrate for provider-driven UI.
3. Quick pick + input box as `api.ui` primitives (not `window.prompt`).
4. Tree view primitive (`TreeItem[]` + lazy children) rendered in sidebar panels.
5. Output channel (routed into an xterm tab) so logs stop needing `console`.
6. Persisted, organized, per-plugin key-value secrets (Tauri stronghole or OS keychain via plugin).

**Phase 1 — VSIX v1: Tier 0 contributions + Tier 1 execution.**
- .vsix install machinery (zip → extensions dir; Open VSX browse pane; explicit .vsix path flow).
- manifest/contributes translators (themes/grammars/snippets/keymaps/commands/views).
- Worker extension host with CommonJS registry and the *core* `vscode` shim (state APIs listed above, no providers yet), plus internal-command map.
- Compatibility telemetry: on activation failure, log missing symbols to an output channel so per-extension gaps are enumerated honestly (this is the `theia-vscodecov` pattern, done for Arc, and becomes our roadmap escalating with users).

**Phase 2 — pick a lane:** LSP bridge (Tier 3) for language support, or webview polish (Tier 1 deepening), by demand. Choose one, do it well, then the next.

**Explicitly do not build yet:** sidecar Node host, proposed-API emulation, marketplace-adjacent scraping, debug adapter infrastructure, notebook/test/scm APIs.

## 9. Risks register

- **Compatibility treadmill**: VS Code ships monthly; our shim freezes in time. Mitigation: pinned/declared engine claim, coverage tooling, user-visible per-extension gap reports.
- **Silent misbehavior gap**: an extension thinks it wrote a file but the fs provider didn't honor a flag. Guard: only implement `workspace.fs` flags/encodings we truly support; throw typed `FileSystemError` on unknown operations rather than fudging.
- **Process bridge misuse**: worker→Rust spawn is a real capability. Guard: allowlist-by-consent, never implicit.
- **Open VSX coverage gaps**: some extensions simply aren't there. Keep "install from .vsix" as first-class, and point users at missing-extension complaints politely.
- **Architecture drift**: shim's UI half requires touching registries in `pluginRuntime.ts`. Mitigation: build shim as a peer facade over `PluginHostActions` rather than nesting second-guessing of the public plugin API; keep VSIX-scoped extensions locked out of `api.invoke` entirely (a narrower capability set than native plugins).
- **Scope creep from consumers**: users will expect GitLens-class extensions early. Mitigation: publish the tier list; say what "supported" means (tier badge in the extension pane, seeded from manifest or behavioral probes).

## 10. Open questions (none block Phase 1)

1. Does Arc ever ship the Node sidecar path ( unlocks native-binary extensions) — Tauri sidecar size/hot updates acceptable, or veto permanently?
2. Which extension *host services* merits real parity work first: language providers, webviews, or tree views?
3. Do we want to claim engine version `^1.87+` silently, or surface "Arc shows as VS Code 1.87" to users?
4. Keep VSIX extensions and native plugins in separate registries (cleaner security diffs), or unify one registry with capability flags (cleaner UX)?
