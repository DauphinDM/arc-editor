import { Code2, FolderOpen, Palette, RotateCcw, Search, Terminal, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { DEFAULT_SETTINGS, DEFAULT_THEME, type AppSettings, type ThemeDefinition } from "./settings";
import "./SettingsPanel.css";

const settingsCategories = [
  { id: "editor", label: "Editor", description: "Formatting, editing behavior, and typography.", icon: Code2 },
  { id: "appearance", label: "Appearance", description: "Transparency, interface style, and color themes.", icon: Palette },
  { id: "terminal", label: "Terminal", description: "Shell text, cursor, and scrollback.", icon: Terminal },
  { id: "files", label: "Files", description: "Workspace browsing preferences.", icon: FolderOpen },
] as const;

type SettingsCategory = typeof settingsCategories[number]["id"];

export default function SettingsPanel({
  settings,
  themes,
  onChange,
  onClose,
  onOpenThemeMaker,
  customThemeIds,
  onDeleteTheme,
}: {
  settings: AppSettings;
  themes: ThemeDefinition[];
  onChange: (settings: Partial<AppSettings>) => void;
  onClose: () => void;
  onOpenThemeMaker: () => void;
  customThemeIds: Set<string>;
  onDeleteTheme: (id: string) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("editor");
  const [themeSearch, setThemeSearch] = useState("");
  const filteredThemes = useMemo(() => themes.filter((theme) => theme.name.toLowerCase().includes(themeSearch.toLowerCase())), [themeSearch, themes]);
  const selectedTheme = themes.find((theme) => theme.id === settings.selectedTheme) ?? DEFAULT_THEME;
  const terminalSelectionColor = settings.terminalSelectionColor || selectedTheme.colors.selection.slice(0, 7);
  const transparency = (key: "glassAppTransparency" | "glassSidebarTransparency" | "editorGlassTransparency" | "glassTabsTransparency" | "glassTerminalTransparency" | "glassFloatingTransparency" | "glassSettingsTransparency" | "glassControlsTransparency", label: string) => <label className="setting-field" key={key}>
    <span>{label} <b>{settings[key]}%</b></span>
    <input type="range" min="0" max="100" step="1" value={settings[key]} onChange={(event) => onChange({ [key]: Number(event.target.value) })} />
  </label>;
  const toggle = (key: keyof AppSettings, label: string, description: string) => <label className="setting-toggle" key={key}>
    <span><strong>{label}</strong><small>{description}</small></span>
    <input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => onChange({ [key]: event.target.checked })} />
  </label>;

  const selectedCategory = settingsCategories.find((category) => category.id === activeCategory)!;

  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="settings-header"><div><h2 id="settings-title">Settings</h2><span>Arc preferences</span></div><button className="tool-button" aria-label="Close settings" onClick={onClose}><X size={15} /></button></header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings categories">
          <div className="settings-nav-list">
            {settingsCategories.map((category) => {
              const Icon = category.icon;
              return <button key={category.id} className="settings-nav-button" aria-current={activeCategory === category.id ? "page" : undefined} onClick={() => setActiveCategory(category.id)}>
                <Icon size={16} aria-hidden="true" /><span>{category.label}</span>
              </button>;
            })}
          </div>
          <button className="settings-reset" title="Reset all settings" onClick={() => onChange({ ...DEFAULT_SETTINGS })}><RotateCcw size={13} /> Reset all settings</button>
        </nav>
        <section className="settings-main" aria-labelledby="settings-category-title">
          <header className="settings-page-heading"><h3 id="settings-category-title">{selectedCategory.label}</h3><p>{selectedCategory.description}</p></header>
          <div className="settings-scroll" key={activeCategory}>
            {activeCategory === "editor" && <>
              <section className="settings-section"><h3>Formatting</h3>
                {toggle("prettierOnSave", "Format on save", "Run Prettier when saving supported files.")}
                <div className="setting-note">Format current file: <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd></div>
              </section>
              <section className="settings-section"><h3>Editing</h3>
                {toggle("lineNumbers", "Line numbers", "Show line numbers beside code.")}
                {toggle("indentGuides", "Indent guides", "Show vertical guides for indented code.")}
                {toggle("activeLine", "Highlight active line", "Highlight line under the caret.")}
                {toggle("wordWrap", "Word wrap", "Wrap long lines to editor width.")}
                {toggle("autoCloseBrackets", "Auto-close brackets", "Insert matching brackets and quotes.")}
                {toggle("bracketMatching", "Bracket matching", "Highlight matching brackets.")}
                {toggle("autocomplete", "Autocomplete", "Show code completion suggestions.")}
                {toggle("autoIndent", "Auto indent", "Indent new lines based on surrounding code.")}
              </section>
              <section className="settings-section"><h3>Typography</h3>
                <label className="setting-field"><span>Font family</span><select value={settings.fontFamily} onChange={(event) => onChange({ fontFamily: event.target.value })}>
                  <option value="'JetBrains Mono', 'SFMono-Regular', Consolas, monospace">JetBrains Mono</option>
                  <option value="'Fira Code', monospace">Fira Code</option>
                  <option value="'SFMono-Regular', Consolas, monospace">System monospace</option>
                  <option value="ui-monospace, monospace">Platform default</option>
                </select></label>
                <label className="setting-field"><span>Font size <b>{settings.fontSize}px</b></span><input type="range" min="10" max="24" step="1" value={settings.fontSize} onChange={(event) => onChange({ fontSize: Number(event.target.value) })} /></label>
                <label className="setting-field"><span>Line height <b>{settings.lineHeight.toFixed(1)}</b></span><input type="range" min="1.2" max="2.2" step="0.1" value={settings.lineHeight} onChange={(event) => onChange({ lineHeight: Number(event.target.value) })} /></label>
                <label className="setting-field"><span>Tab size</span><select value={settings.tabSize} onChange={(event) => onChange({ tabSize: Number(event.target.value) })}><option value="2">2 spaces</option><option value="4">4 spaces</option><option value="8">8 spaces</option></select></label>
              </section>
            </>}
            {activeCategory === "appearance" && <>
              <section className="settings-section"><h3>Transparency and blur</h3>
                {toggle("editorGlassEnabled", "Frosted glass", "Apply transparency across app surfaces.")}
                {settings.editorGlassEnabled && <>
                  {toggle("nativeBackgroundBlurEnabled", "Blur desktop background", "Use native OS blur when supported. Linux X11 is unsupported; system controls strength.")}
                  {transparency("glassAppTransparency", "Window background")}
                  {transparency("glassSidebarTransparency", "File viewer")}
                  {transparency("editorGlassTransparency", "Editor")}
                  {transparency("glassTabsTransparency", "Tabs and toolbars")}
                  {transparency("glassTerminalTransparency", "Terminal")}
                  {transparency("glassFloatingTransparency", "Menus and popovers")}
                  {transparency("glassSettingsTransparency", "Settings panel")}
                  {transparency("glassControlsTransparency", "Inputs and controls")}
                  <label className="setting-field"><span>In-app blur <b>{settings.editorGlassBlur}px</b></span><input type="range" min="0" max="40" step="1" value={settings.editorGlassBlur} onChange={(event) => onChange({ editorGlassBlur: Number(event.target.value) })} /></label>
                </>}
              </section>
              <section className="settings-section"><h3>Interface</h3>
                <label className="setting-field"><span>App theme</span><select value={settings.appTheme} onChange={(event) => onChange({ appTheme: event.target.value as AppSettings["appTheme"] })}>
                  <option value="classic">Classic</option>
                  <option value="macos">Modern</option>
                </select></label>
                <div className="setting-note">App style and editor color theme are independent.</div>
              </section>
              <section className="settings-section"><h3>Editor colors</h3>
                <label className="theme-search"><Search size={13} /><input value={themeSearch} onChange={(event) => setThemeSearch(event.target.value)} placeholder="Search color themes" /></label>
                <div className="theme-list" role="list" aria-label="Editor color themes">
                  {filteredThemes.map((theme) => <div className={`theme-choice ${settings.selectedTheme === theme.id ? "active" : ""}`} key={theme.id} role="listitem">
                    <button aria-pressed={settings.selectedTheme === theme.id} onClick={() => onChange({ selectedTheme: theme.id })}>
                      <span className="theme-choice-name">{theme.name}<small>{customThemeIds.has(theme.id) ? "Custom" : "Built-in"}</small></span>
                      <span className="theme-swatches" aria-hidden="true">{[theme.colors.background, theme.colors.keyword, theme.colors.string, theme.colors.function].map((color, index) => <i key={index} style={{ background: color }} />)}</span>
                    </button>
                    {customThemeIds.has(theme.id) && <button className="theme-remove" title={`Remove ${theme.name}`} aria-label={`Remove ${theme.name}`} onClick={() => onDeleteTheme(theme.id)}><Trash2 size={13} /></button>}
                  </div>)}
                  {!filteredThemes.length && <div className="theme-list-empty">No matching themes.</div>}
                </div>
                <button className="settings-action" onClick={onOpenThemeMaker}>Open Theme Maker</button>
              </section>
            </>}
            {activeCategory === "terminal" && <section className="settings-section"><h3>Terminal</h3>
              <label className="setting-field"><span>Font family</span><select value={settings.terminalFontFamily} onChange={(event) => onChange({ terminalFontFamily: event.target.value })}>
                <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
                <option value="'Fira Code', monospace">Fira Code</option>
                <option value="'SFMono-Regular', Consolas, monospace">System monospace</option>
                <option value="ui-monospace, monospace">Platform default</option>
              </select></label>
              <label className="setting-field"><span>Font size <b>{settings.terminalFontSize}px</b></span><input type="range" min="10" max="24" step="1" value={settings.terminalFontSize} onChange={(event) => onChange({ terminalFontSize: Number(event.target.value) })} /></label>
              <label className="setting-field"><span>Cursor shape</span><select value={settings.terminalCursorStyle} onChange={(event) => onChange({ terminalCursorStyle: event.target.value as AppSettings["terminalCursorStyle"] })}>
                <option value="block">Block</option><option value="underline">Underline</option><option value="bar">Bar</option>
              </select></label>
              {toggle("terminalCursorBlink", "Blinking cursor", "Blink the terminal cursor.")}
              <label className="setting-field"><span>Scrollback lines <b>{settings.terminalScrollback}</b></span><input type="range" min="500" max="5000" step="500" value={settings.terminalScrollback} onChange={(event) => onChange({ terminalScrollback: Number(event.target.value) })} /></label>
              <label className="setting-field"><span>Padding <b>{settings.terminalPadding}px</b></span><input type="range" min="0" max="24" step="2" value={settings.terminalPadding} onChange={(event) => onChange({ terminalPadding: Number(event.target.value) })} /></label>
              {toggle("terminalScrollbar", "Show scrollbar", "Show the terminal's scrollback scrollbar.")}
              {toggle("terminalShowTitle", "Show shell title", "Use the title reported by the running shell in its tab.")}
              <label className="setting-field"><span>Selection color</span><input type="color" value={terminalSelectionColor} onChange={(event) => onChange({ terminalSelectionColor: event.target.value })} /></label>
              {settings.terminalSelectionColor && <button className="settings-action" onClick={() => onChange({ terminalSelectionColor: "" })}>Use theme selection color</button>}
            </section>}
            {activeCategory === "files" && <section className="settings-section"><h3>File viewer</h3>
              {toggle("showHiddenFiles", "Show hidden files", "Include dotfiles and hidden folders in workspace tree.")}
            </section>}
          </div>
        </section>
      </div>
    </aside>
  </div>;
}
