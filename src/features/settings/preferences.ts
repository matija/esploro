export const uiThemeValues = [
  "tairiki-light",
  "tairiki-dark",
  "system",
  "macos-light",
  "macos-dark",
] as const;

export type UiTheme = (typeof uiThemeValues)[number];

export type UiPreferences = {
  ui: {
    theme: UiTheme;
    fontFamily: string;
    fontSize: number;
  };
  editor: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
  };
};

export const uiPreferenceRanges = {
  uiFontSize: { min: 11, max: 16 },
  editorFontSize: { min: 11, max: 18 },
  editorLineHeight: { min: 1.25, max: 1.8 },
} as const;

export const defaultUiPreferences: UiPreferences = {
  ui: {
    theme: "tairiki-light",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
    fontSize: 13,
  },
  editor: {
    fontFamily:
      'ui-monospace, "SF Mono", Menlo, Monaco, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.5,
  },
};

type LegacyTheme = "light" | "dark";

const legacyThemeMap: Record<LegacyTheme, UiTheme> = {
  light: "tairiki-light",
  dark: "tairiki-dark",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUiTheme(value: unknown): value is UiTheme {
  return (
    typeof value === "string" &&
    (uiThemeValues as readonly string[]).includes(value)
  );
}

function isLegacyTheme(value: unknown): value is LegacyTheme {
  return value === "light" || value === "dark";
}

function numberInRange(
  value: unknown,
  fallback: number,
  range: { min: number; max: number },
): number {
  if (!isFiniteNumber(value)) return fallback;
  if (value < range.min || value > range.max) return fallback;
  return value;
}

export function normalizeTheme(value: unknown): UiTheme {
  if (isUiTheme(value)) return value;
  if (isLegacyTheme(value)) return legacyThemeMap[value];
  return defaultUiPreferences.ui.theme;
}

export function normalizeUiPreferences(value: unknown): UiPreferences {
  const root = isRecord(value) ? value : {};
  const ui = isRecord(root.ui) ? root.ui : {};
  const editor = isRecord(root.editor) ? root.editor : {};

  return {
    ui: {
      theme: normalizeTheme(ui.theme),
      fontFamily: isNonEmptyString(ui.fontFamily)
        ? ui.fontFamily
        : defaultUiPreferences.ui.fontFamily,
      fontSize: numberInRange(
        ui.fontSize,
        defaultUiPreferences.ui.fontSize,
        uiPreferenceRanges.uiFontSize,
      ),
    },
    editor: {
      fontFamily: isNonEmptyString(editor.fontFamily)
        ? editor.fontFamily
        : defaultUiPreferences.editor.fontFamily,
      fontSize: numberInRange(
        editor.fontSize,
        defaultUiPreferences.editor.fontSize,
        uiPreferenceRanges.editorFontSize,
      ),
      lineHeight: numberInRange(
        editor.lineHeight,
        defaultUiPreferences.editor.lineHeight,
        uiPreferenceRanges.editorLineHeight,
      ),
    },
  };
}

export function themeToDomAttribute(theme: unknown): "light" | "dark" | null {
  switch (normalizeTheme(theme)) {
    case "tairiki-light":
    case "macos-light":
      return "light";
    case "tairiki-dark":
    case "macos-dark":
      return "dark";
    case "system":
      return null;
  }
}
