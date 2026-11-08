import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, FolderOpen, Plus, Save } from "lucide-react";
import { themeColorWithOpacity, THEME_COLOR_GROUPS, type AppSettings, type ThemeColors, type ThemeDefinition } from "./settings";

const sample = [
  { number: "1", parts: [{ text: "const", color: "keyword" }, { text: " greeting", color: "text" }, { text: " = ", color: "operator" }, { text: "'Hello, Arc!'", color: "string" }, { text: ";", color: "operator" }] },
  { number: "2", parts: [{ text: "", color: "text" }] },
  { number: "3", parts: [{ text: "function", color: "keyword" }, { text: " render", color: "function" }, { text: "(", color: "operator" }, { text: "theme", color: "property" }, { text: ") {", color: "operator" }] },
  { number: "4", parts: [{ text: "  return", color: "keyword" }, { text: " <", color: "operator" }, { text: "Panel", color: "tag" }, { text: " tone", color: "attribute" }, { text: "=", color: "operator" }, { text: "\"calm\"", color: "string" }, { text: " />", color: "operator" }] },
  { number: "5", parts: [{ text: "}", color: "operator" }] },
  { number: "6", parts: [{ text: "", color: "text" }] },
  { number: "7", parts: [{ text: "// Theme preview", color: "comment" }] },
];

function rgbFromHex(hex: string) {
  const value = hex.slice(1, 7);
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function hsvFromRgb([red, green, blue]: number[]) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  return { h: (hue + 360) % 360, s: max ? delta / max : 0, v: max };
}

function rgbFromHsv({ h, s, v }: { h: number; s: number; v: number }) {
  const chroma = v * s;
  const segment = h / 60;
  const x = chroma * (1 - Math.abs(segment % 2 - 1));
  const match = v - chroma;
  const rgb = segment < 1 ? [chroma, x, 0]
    : segment < 2 ? [x, chroma, 0]
      : segment < 3 ? [0, chroma, x]
        : segment < 4 ? [0, x, chroma]
          : segment < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return rgb.map((channel) => Math.round((channel + match) * 255));
}

function hexWithRgb(hex: string, rgb: number[]) {
  return `#${rgb.map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, "0")).join("")}${hex.length === 9 ? hex.slice(7) : ""}`;
}

function ThemeColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(value.slice(0, 7));
  const [hsv, setHsv] = useState(() => hsvFromRgb(rgbFromHex(value)));
  useEffect(() => {
    setHexDraft(value.slice(0, 7));
    setHsv(hsvFromRgb(rgbFromHex(value)));
  }, [value]);
  const updateSv = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const next = {
      ...hsv,
      s: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      v: 1 - Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
    setHsv(next);
    onChange(hexWithRgb(value, rgbFromHsv(next)));
  };
  const updateHue = (h: number) => {
    const next = { ...hsv, h };
    setHsv(next);
    onChange(hexWithRgb(value, rgbFromHsv(next)));
  };

  return <div className="theme-color-picker">
    <button className="theme-color-swatch" aria-label={`Change ${label} color`} title={`${label}: ${value}`} style={{ backgroundColor: value.slice(0, 7), borderColor: "#ffffff70" }} onClick={() => setOpen((current) => !current)} />
    {open && <div className="theme-color-popover">
      <strong>{label}</strong>
      <label className="theme-picker-hex">Hex<input value={hexDraft} spellCheck={false} onChange={(event) => {
        setHexDraft(event.target.value);
        if (/^#[0-9a-f]{6}$/i.test(event.target.value)) onChange(`${event.target.value}${value.length === 9 ? value.slice(7) : ""}`);
      }} /></label>
      <div className="theme-picker-sv" role="group" aria-label="Saturation and brightness" style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }} onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); updateSv(event); }} onPointerMove={(event) => { if (event.buttons) updateSv(event); }}>
        <i className="theme-picker-marker" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <label className="theme-picker-hue"><span>Hue</span><input aria-label="Hue" type="range" min="0" max="360" value={Math.round(hsv.h)} onChange={(event) => updateHue(Number(event.target.value))} /></label>
      <button className="theme-picker-done" onClick={() => setOpen(false)}>Done</button>
    </div>}
  </div>;
}

export default function ThemeMaker({
  initialTheme,
  themes,
  settings,
  onBack,
  onSave,
  onCreate,
  onOpenFolder,
  errorMessage,
}: {
  initialTheme: ThemeDefinition;
  themes: ThemeDefinition[];
  settings: AppSettings;
  onBack: () => void;
  onSave: (theme: ThemeDefinition) => void;
  onCreate: (theme: ThemeDefinition, name: string) => void;
  onOpenFolder: (theme: ThemeDefinition) => void;
  errorMessage: string;
}) {
  const [theme, setTheme] = useState<ThemeDefinition>(() => ({ ...initialTheme, colors: { ...initialTheme.colors } }));
  const [error, setError] = useState("");
  const glassFill = (color: string, transparency: number) => themeColorWithOpacity(
    color,
    1 - (settings.editorGlassEnabled ? Math.max(0, Math.min(100, transparency)) : 0) / 100,
  );
  const updateColor = (key: keyof ThemeColors, value: string) => setTheme((current) => ({ ...current, colors: { ...current.colors, [key]: value } }));
  const createTheme = () => {
    const name = window.prompt("Name for new theme:")?.trim();
    if (!name) return;
    if (themes.some((entry) => entry.name.trim().toLowerCase() === name.toLowerCase())) {
      setError(`A theme named “${name}” already exists.`);
      return;
    }
    setError("");
    onCreate(theme, name);
  };

  return <main className={`theme-maker-page ${settings.appTheme === "macos" ? "app-theme-macos" : ""} ${settings.editorGlassEnabled ? "editor-glass-enabled" : ""}`} style={{
    background: glassFill(theme.colors.background, settings.glassAppTransparency),
    color: theme.colors.text,
    "--editor-glass-blur": `${settings.editorGlassBlur}px`,
    "--editor-glass-saturation": `${settings.editorGlassSaturation}%`,
    "--glass-app-transparency": `${settings.editorGlassEnabled ? settings.glassAppTransparency : 0}%`,
    "--glass-sidebar-transparency": `${settings.editorGlassEnabled ? settings.glassSidebarTransparency : 0}%`,
    "--glass-controls-transparency": `${settings.editorGlassEnabled ? settings.glassControlsTransparency : 0}%`,
    "--glass-floating-transparency": `${settings.editorGlassEnabled ? settings.glassFloatingTransparency : 0}%`,
    "--glass-controls-surface": glassFill(theme.colors.raised, settings.glassControlsTransparency),
    "--glass-floating-surface": glassFill(theme.colors.raised, settings.glassFloatingTransparency),
    "--theme-raised": theme.colors.raised,
    "--theme-border": theme.colors.border,
    "--theme-text": theme.colors.text,
    "--theme-secondary": theme.colors.secondaryText,
    "--theme-muted": theme.colors.muted,
    "--theme-hover": theme.colors.hover,
    "--theme-selected": theme.colors.selected,
  } as CSSProperties}>
    <header className="theme-maker-header" style={{ background: glassFill(theme.colors.sidebar, settings.glassSidebarTransparency), borderColor: theme.colors.border }}>
      <button className="theme-back" onClick={onBack}><ArrowLeft size={15} /> Settings</button>
      <div className="theme-maker-title"><strong>Theme Maker</strong><span>Live editor preview</span></div>
      <label className="theme-maker-select-label"><span>Editing</span><select value={theme.id} onChange={(event) => {
        const selected = themes.find((entry) => entry.id === event.target.value);
        if (selected) {
          setTheme({ ...selected, colors: { ...selected.colors } });
          setError("");
        }
      }}>{themes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      <div className="theme-maker-actions">
        <button onClick={() => onOpenFolder(theme)}><FolderOpen size={13} /> Open Theme’s Folder</button>
        <button onClick={createTheme}><Plus size={13} /> Create New Theme</button>
        <button className="theme-save-button" onClick={() => { setError(""); onSave(theme); }}><Save size={13} /> Save Theme</button>
      </div>
    </header>
    {(error || errorMessage) && <div className="theme-maker-error" role="alert">{error || errorMessage}</div>}
    <div className="theme-maker-content">
      <aside className="theme-controls" style={{ background: glassFill(theme.colors.sidebar, settings.glassSidebarTransparency), borderColor: theme.colors.border }}>
        {THEME_COLOR_GROUPS.map((group) => <section className="theme-color-group" key={group.name}>
          <h2>{group.name}</h2>
          {group.keys.map((key) => <label className="theme-color-row" key={key}>
            <span>{key === "invalidBackground" ? "Invalid background" : key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</span>
            <ThemeColorPicker label={key} value={theme.colors[key]} onChange={(value) => updateColor(key, value)} />
          </label>)}
        </section>)}
      </aside>
      <section className="theme-preview-area">
        <div className="theme-preview-window" style={{ borderColor: theme.colors.border, background: theme.colors.editor, fontFamily: settings.fontFamily }}>
          <div className="theme-preview-sidebar" style={{ background: theme.colors.sidebar, borderColor: theme.colors.border }}>
            <div className="theme-preview-sidebar-heading" style={{ color: theme.colors.secondaryText }}>EXPLORER</div>
            <div className="theme-preview-tree"><span>⌄</span><span>src</span></div>
            <div className="theme-preview-tree child" style={{ color: theme.colors.secondaryText }}><span>◇</span><span>App.tsx</span></div>
            <div className="theme-preview-tree child selected" style={{ background: theme.colors.selected, color: theme.colors.text }}><span>◈</span><span>theme.ts</span></div>
            <div className="theme-preview-tree"><span>◇</span><span>styles.css</span></div>
          </div>
          <div className="theme-preview-editor">
            <div className="theme-preview-tab" style={{ background: theme.colors.editor, color: theme.colors.text, borderColor: theme.colors.border }}>theme.ts</div>
            <div className="theme-preview-code" style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight }}>
              {sample.map((line) => <div className="theme-preview-line" key={line.number} style={{ background: line.number === "4" ? theme.colors.activeLine : "transparent" }}>
                <span className="theme-preview-number" style={{ color: theme.colors.lineNumber }}>{line.number}</span>
                <code>{line.parts.map((part, index) => <span key={index} style={{ color: theme.colors[part.color as keyof ThemeColors] }}>{part.text}</span>)}</code>
              </div>)}
              <div className="theme-preview-cursor" style={{ background: theme.colors.cursor }} />
            </div>
            <div className="theme-preview-selection" style={{ background: theme.colors.selection }}>Selection preview</div>
          </div>
        </div>
      </section>
    </div>
  </main>;
}
