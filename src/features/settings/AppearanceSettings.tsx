import { invoke } from "@tauri-apps/api/core";
import {
  Code2,
  Database,
  Monitor,
  Moon,
  RotateCcw,
  Sun,
  Table2,
  Type,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAppStore } from "../../store";
import { cn } from "../../lib/utils";
import {
  applyUiPreferencesToDocument,
  cacheUiPreferencesForBootstrap,
  defaultUiPreferences,
  normalizeUiPreferences,
  uiPreferenceRanges,
  type UiPreferences,
  type UiTheme,
} from "./preferences";

interface ThemeOption {
  value: UiTheme;
  label: string;
  icon: ReactNode;
}

interface FontPreset {
  label: string;
  value: string;
  target: "ui" | "editor" | "both";
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: "tairiki-light", label: "Tairiki Light", icon: <Sun size={13} /> },
  { value: "tairiki-dark", label: "Tairiki Dark", icon: <Moon size={13} /> },
  { value: "system", label: "System", icon: <Monitor size={13} /> },
];

const FONT_PRESETS: FontPreset[] = [
  {
    label: "System UI",
    value:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
    target: "ui",
  },
  {
    label: "SF Pro",
    value: '"SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif',
    target: "ui",
  },
  {
    label: "Helvetica Neue",
    value: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    target: "ui",
  },
  {
    label: "SF Mono",
    value: 'ui-monospace, "SF Mono", Menlo, Monaco, "Courier New", monospace',
    target: "editor",
  },
  {
    label: "Menlo",
    value: 'Menlo, Monaco, "Courier New", monospace',
    target: "editor",
  },
  {
    label: "Monaco",
    value: 'Monaco, Menlo, "Courier New", monospace',
    target: "editor",
  },
];

const LINE_HEIGHT_OPTIONS = [
  { label: "Tight", value: 1.35 },
  { label: "Default", value: 1.5 },
  { label: "Airy", value: 1.65 },
] as const;

function samePreferences(a: UiPreferences, b: UiPreferences): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isFontStackValid(value: string): boolean {
  return value.trim().length > 0;
}

function isInRange(value: number, range: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}

function canPersist(preferences: UiPreferences): boolean {
  return (
    isFontStackValid(preferences.ui.fontFamily) &&
    isFontStackValid(preferences.editor.fontFamily) &&
    isInRange(preferences.ui.fontSize, uiPreferenceRanges.uiFontSize) &&
    isInRange(preferences.editor.fontSize, uiPreferenceRanges.editorFontSize) &&
    isInRange(preferences.editor.lineHeight, uiPreferenceRanges.editorLineHeight)
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function AppearanceSettings() {
  const { theme, hydrateTheme } = useAppStore();
  const [preferences, setPreferences] = useState<UiPreferences>(() =>
    normalizeUiPreferences({ ...defaultUiPreferences, ui: { ...defaultUiPreferences.ui, theme } }),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    let cancelled = false;

    invoke<UiPreferences>("get_ui_preferences")
      .catch(() => defaultUiPreferences)
      .then((storedPreferences) => {
        if (cancelled) return;
        setPreferences(normalizeUiPreferences(storedPreferences));
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, []);

  const isValid = useMemo(() => canPersist(preferences), [preferences]);
  const isCustom = useMemo(
    () => !samePreferences(preferences, defaultUiPreferences),
    [preferences],
  );

  function persist(nextPreferences: UiPreferences): void {
    const normalized = normalizeUiPreferences(nextPreferences);

    if (!canPersist(nextPreferences)) {
      setSaveState("idle");
      return;
    }

    applyUiPreferencesToDocument(normalized);
    cacheUiPreferencesForBootstrap(normalized);
    hydrateTheme(normalized.ui.theme);
    setSaveState("saving");

    invoke("set_ui_preferences", { preferences: normalized })
      .then(() => {
        setSaveState("saved");
        window.setTimeout(() => setSaveState("idle"), 1600);
      })
      .catch((error) => {
        console.error(error);
        setSaveState("error");
      });
  }

  function updatePreferences(updater: (current: UiPreferences) => UiPreferences): void {
    setPreferences((current) => {
      const next = updater(current);
      persist(next);
      return next;
    });
  }

  function resetPreferences(): void {
    if (isCustom && !window.confirm("Reset appearance preferences to defaults?")) return;
    setPreferences(defaultUiPreferences);
    persist(defaultUiPreferences);
  }

  const uiFontInvalid = !isFontStackValid(preferences.ui.fontFamily);
  const editorFontInvalid = !isFontStackValid(preferences.editor.fontFamily);
  const uiSizeInvalid = !isInRange(preferences.ui.fontSize, uiPreferenceRanges.uiFontSize);
  const editorSizeInvalid = !isInRange(
    preferences.editor.fontSize,
    uiPreferenceRanges.editorFontSize,
  );

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[11px] font-medium text-secondary uppercase mb-1">
            Appearance
          </h3>
          <p className="text-[12px] text-tertiary">
            Theme and font preferences apply live and are stored in app preferences.
          </p>
        </div>
        <button
          type="button"
          onClick={resetPreferences}
          disabled={!isCustom}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-[12px]",
            "bg-control text-secondary shadow-[var(--shadow-hairline)] transition-colors duration-[var(--motion-fast)]",
            "hover:bg-subtle hover:text-label active:bg-active disabled:cursor-default disabled:opacity-45",
          )}
        >
          <RotateCcw size={13} />
          Reset
        </button>
      </div>

      <div className="space-y-2">
        <SettingLabel icon={<Monitor size={13} />} label="Theme" />
        <div className="flex w-fit gap-1 rounded-[var(--radius-control)] bg-control p-1 shadow-[var(--shadow-hairline)]">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() =>
                updatePreferences((current) => ({
                  ...current,
                  ui: { ...current.ui, theme: opt.value },
                }))
              }
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-[12px]",
                "transition-colors duration-[var(--motion-fast)]",
                preferences.ui.theme === opt.value
                  ? "bg-content text-label shadow-sm font-medium"
                  : "text-secondary hover:bg-subtle hover:text-label active:bg-active",
              )}
            >
              <span className={preferences.ui.theme === opt.value ? "text-accent" : ""}>
                {opt.icon}
              </span>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <FontSection
        icon={<Type size={13} />}
        title="Interface font"
        value={preferences.ui.fontFamily}
        invalid={uiFontInvalid}
        presets={FONT_PRESETS.filter((preset) => preset.target === "ui")}
        onChange={(fontFamily) =>
          updatePreferences((current) => ({
            ...current,
            ui: { ...current.ui, fontFamily },
          }))
        }
      />

      <RangeControl
        label="Interface size"
        value={preferences.ui.fontSize}
        min={uiPreferenceRanges.uiFontSize.min}
        max={uiPreferenceRanges.uiFontSize.max}
        step={1}
        invalid={uiSizeInvalid}
        suffix="px"
        onChange={(fontSize) =>
          updatePreferences((current) => ({
            ...current,
            ui: { ...current.ui, fontSize },
          }))
        }
      />

      <FontSection
        icon={<Code2 size={13} />}
        title="Editor font"
        value={preferences.editor.fontFamily}
        invalid={editorFontInvalid}
        presets={FONT_PRESETS.filter((preset) => preset.target === "editor")}
        onChange={(fontFamily) =>
          updatePreferences((current) => ({
            ...current,
            editor: { ...current.editor, fontFamily },
          }))
        }
      />

      <RangeControl
        label="Editor size"
        value={preferences.editor.fontSize}
        min={uiPreferenceRanges.editorFontSize.min}
        max={uiPreferenceRanges.editorFontSize.max}
        step={1}
        invalid={editorSizeInvalid}
        suffix="px"
        onChange={(fontSize) =>
          updatePreferences((current) => ({
            ...current,
            editor: { ...current.editor, fontSize },
          }))
        }
      />

      <div className="space-y-2">
        <SettingLabel icon={<Code2 size={13} />} label="Editor line height" />
        <div className="flex w-fit gap-1 rounded-[var(--radius-control)] bg-control p-1 shadow-[var(--shadow-hairline)]">
          {LINE_HEIGHT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() =>
                updatePreferences((current) => ({
                  ...current,
                  editor: { ...current.editor, lineHeight: opt.value },
                }))
              }
              className={cn(
                "h-7 rounded-[var(--radius-control)] px-2.5 text-[12px]",
                "transition-colors duration-[var(--motion-fast)]",
                preferences.editor.lineHeight === opt.value
                  ? "bg-content text-label shadow-sm font-medium"
                  : "text-secondary hover:bg-subtle hover:text-label active:bg-active",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <PreviewPanel preferences={preferences} />

      <div
        className={cn(
          "min-h-5 text-[12px]",
          saveState === "error" || !isValid ? "text-destructive" : "text-tertiary",
        )}
      >
        {!isValid && "Fix invalid font settings before they can be saved."}
        {isValid && saveState === "saving" && "Saving appearance preferences..."}
        {isValid && saveState === "saved" && "Saved."}
        {isValid && saveState === "error" && "Could not save preferences."}
      </div>
    </section>
  );
}

function SettingLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] font-medium text-secondary">
      <span className="text-accent">{icon}</span>
      {label}
    </div>
  );
}

function FontSection({
  icon,
  title,
  value,
  invalid,
  presets,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  invalid: boolean;
  presets: FontPreset[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <SettingLabel icon={icon} label={title} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        className={cn(
          "h-8 w-full rounded-[var(--radius-control)] border bg-content px-2.5 text-[12px] text-label",
          "shadow-[var(--shadow-hairline)] transition-colors duration-[var(--motion-fast)]",
          "placeholder:text-tertiary hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
          invalid ? "border-destructive" : "border-separator",
        )}
      />
      <div className="flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onChange(preset.value)}
            className="h-6 rounded-[var(--radius-badge)] bg-control px-2 text-[11px] text-secondary shadow-[var(--shadow-hairline)] transition-colors duration-[var(--motion-fast)] hover:bg-subtle hover:text-label active:bg-active"
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix,
  invalid,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  invalid: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium text-secondary">{label}</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(event) => onChange(Number(event.target.value))}
            aria-invalid={invalid}
            className={cn(
              "h-7 w-16 rounded-[var(--radius-control)] border bg-content px-2 text-right text-[12px] text-label",
              "shadow-[var(--shadow-hairline)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
              invalid ? "border-destructive" : "border-separator",
            )}
          />
          <span className="text-[12px] text-tertiary">{suffix}</span>
        </div>
      </div>
      <input
        type="range"
        value={Number.isFinite(value) ? value : min}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 w-full accent-[var(--ds-accent)]"
      />
    </div>
  );
}

function PreviewPanel({ preferences }: { preferences: UiPreferences }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-separator bg-sidebar p-3 shadow-[var(--shadow-hairline)]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase text-tertiary">Preview</span>
        <span className="rounded-[var(--radius-badge)] bg-accent-subtle px-1.5 py-0.5 text-[11px] text-accent">
          live
        </span>
      </div>

      <div className="grid gap-2">
        <div
          className="flex items-center gap-2 rounded-[var(--radius-control)] bg-content px-2 py-1.5 text-label shadow-[var(--shadow-hairline)]"
          style={{
            fontFamily: preferences.ui.fontFamily,
            fontSize: preferences.ui.fontSize,
          }}
        >
          <Database size={14} className="text-accent" />
          <span className="min-w-0 flex-1 truncate">production / public</span>
          <span className="rounded-[var(--radius-badge)] bg-control px-1.5 py-0.5 text-[11px] text-success">
            connected
          </span>
        </div>

        <div
          className="rounded-[var(--radius-control)] bg-content px-2 py-1.5 text-label shadow-[var(--shadow-hairline)]"
          style={{
            fontFamily: preferences.editor.fontFamily,
            fontSize: preferences.editor.fontSize,
            lineHeight: preferences.editor.lineHeight,
          }}
        >
          <span className="text-syntax-keyword">select</span>{" "}
          <span className="text-syntax-number">*</span>{" "}
          <span className="text-syntax-keyword">from</span>{" "}
          <span className="text-syntax-string">public.users</span>{" "}
          <span className="text-syntax-keyword">where</span>{" "}
          <span className="text-syntax-type">id</span>{" "}
          <span className="text-syntax-number">= 42</span>;
        </div>

        <div
          className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-[var(--radius-control)] bg-content px-2 py-1.5 text-label shadow-[var(--shadow-hairline)]"
          style={{
            fontFamily: preferences.ui.fontFamily,
            fontSize: preferences.ui.fontSize,
          }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <Table2 size={13} className="text-syntax-string" />
            <span className="truncate">users.created_at</span>
          </div>
          <span className="rounded-[var(--radius-badge)] bg-control px-1.5 py-0.5 text-[11px] text-syntax-type">
            timestamptz
          </span>
          <span className="font-mono text-[12px] text-secondary">2026-04-29 10:42:13</span>
        </div>
      </div>
    </div>
  );
}
