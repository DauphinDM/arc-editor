import { RotateCcw, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { DEFAULT_SETTINGS, DEFAULT_THEME, type AppSettings, type ThemeDefinition } from "./settings";

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

  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="settings-header"><div><h2 id="settings-title">Settings</h2><span>Editor preferences · Ctrl+,</span></div><button className="tool-button" aria-label="Close settings" onClick={onClose}><X size={15} /></button></header>
      <div className="settings-scroll">
        <section className="settings-section"><h3>Formatting</h3>
          {toggle("prettierOnSave", "Format on save", "Run Prettier when saving supported files.")}
          <div className="setting-note">Format current file: <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd></div>
        </section>
        <section className="settings-section"><h3>Editor</h3>
          {toggle("lineNumbers", "Line numbers", "Show line numbers beside code.")}
          {toggle("indentGuides", "Indent guides", "Show vertical guides for indented code.")}
          {toggle("activeLine", "Highlight active line", "Highlight line under the caret.")}
          {toggle("wordWrap", "Word wrap", "Wrap long lines to editor width.")}
          {toggle("autoCloseBrackets", "Auto-close brackets", "Insert matching brackets and quotes.")}
          {toggle("bracketMatching", "Bracket matching", "Highlight matching brackets.")}
          {toggle("autocomplete", "Autocomplete", "Show code completion suggestions.")}
          {toggle("autoIndent", "Auto indent", "Indent new lines based on surrounding code.")}
        </section>
        <section className="settings-section"><h3>App Glass</h3>
          {toggle("editorGlassEnabled", "Frosted glass", "Apply transparency across app surfaces. Linux blur depends on compositor settings.")}
          {settings.editorGlassEnabled && <>
            {transparency("glassAppTransparency", "Window background")}
            {transparency("glassSidebarTransparency", "File viewer")}
            {transparency("editorGlassTransparency", "Editor")}
            {transparency("glassTabsTransparency", "Tabs and toolbars")}
            {transparency("glassTerminalTransparency", "Terminal")}
            {transparency("glassFloatingTransparency", "Menus and popovers")}
            {transparency("glassSettingsTransparency", "Settings panel")}
            {transparency("glassControlsTransparency", "Inputs and controls")}
            <label className="setting-field"><span>Blur <b>{settings.editorGlassBlur}px</b></span><input type="range" min="0" max="40" step="1" value={settings.editorGlassBlur} onChange={(event) => onChange({ editorGlassBlur: Number(event.target.value) })} /></label>
            <label className="setting-field"><span>Background saturation <b>{settings.editorGlassSaturation}%</b></span><input type="range" min="50" max="200" step="5" value={settings.editorGlassSaturation} onChange={(event) => onChange({ editorGlassSaturation: Number(event.target.value) })} /></label>
          </>}
        </section>
        <section className="settings-section"><h3>Terminal</h3>
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
        </section>
        <section className="settings-section"><h3>File Viewer</h3>
          {toggle("showHiddenFiles", "Show hidden files", "Include dotfiles and hidden folders in workspace tree.")}
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
        <section className="settings-section"><h3>Appearance</h3>
          <label className="setting-field"><span>App theme</span><select value={settings.appTheme} onChange={(event) => onChange({ appTheme: event.target.value as AppSettings["appTheme"] })}>
            <option value="classic">Classic</option>
            <option value="macos">macOS</option>
          </select></label>
          <div className="setting-note">App theme changes interface style. Editor color themes stay separate.</div>
          <div className="setting-field"><span>Editor color theme</span></div>
          <label className="theme-search"><Search size={13} /><input value={themeSearch} onChange={(event) => setThemeSearch(event.target.value)} placeholder="Search themes" /></label>
          <div className="theme-list" role="list" aria-label="Themes">
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
        <button className="settings-reset" onClick={() => onChange({ ...DEFAULT_SETTINGS })}><RotateCcw size={13} /> Reset all settings</button>
      </div>
    </aside>
  </div>;
}
