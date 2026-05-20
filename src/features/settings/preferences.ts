export const uiThemeValues = [
  "tairiki-light",
  "tairiki-dark",
  "system",
  "macos-light",
  "macos-dark",
  "tokyo-night",
  "tokyo-night-day",
  "github-dark",
  "github-light",
] as const;

export type UiTheme = (typeof uiThemeValues)[number];

export const rowDensityValues = ["compact", "comfortable", "spacious"] as const;
export type RowDensity = (typeof rowDensityValues)[number];

export const gridPageSizeValues = [50, 100, 200, 500] as const;
export type GridPageSize = (typeof gridPageSizeValues)[number];

export const editorTabSizeValues = [2, 4, 8] as const;
export type EditorTabSize = (typeof editorTabSizeValues)[number];

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
    tabSize: EditorTabSize;
    wordWrap: boolean;
  };
  grid: {
    rowDensity: RowDensity;
    pageSize: GridPageSize;
    showTotalCount: boolean;
  };
};

export const uiPreferenceRanges = {
  uiFontSize: { min: 11, max: 16 },
  editorFontSize: { min: 11, max: 18 },
  editorLineHeight: { min: 1.25, max: 1.8 },
} as const;

export const defaultUiPreferences: UiPreferences = {
  ui: {
    theme: "system",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
    fontSize: 13,
  },
  editor: {
    fontFamily:
      'ui-monospace, "SF Mono", Menlo, Monaco, "Courier New", monospace',
    fontSize: 12,
    lineHeight: 1.5,
    tabSize: 2,
    wordWrap: false,
  },
  grid: {
    rowDensity: "compact",
    pageSize: 200,
    showTotalCount: true,
  },
};

export const uiPreferencesBootstrapKey = "esploro-ui-preferences";

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

function isEditorTabSize(value: unknown): value is EditorTabSize {
  return (editorTabSizeValues as readonly unknown[]).includes(value);
}

function isGridPageSize(value: unknown): value is GridPageSize {
  return (gridPageSizeValues as readonly unknown[]).includes(value);
}

function isRowDensity(value: unknown): value is RowDensity {
  return (rowDensityValues as readonly unknown[]).includes(value);
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
  const grid = isRecord(root.grid) ? root.grid : {};

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
      tabSize: isEditorTabSize(editor.tabSize)
        ? editor.tabSize
        : defaultUiPreferences.editor.tabSize,
      wordWrap:
        typeof editor.wordWrap === "boolean"
          ? editor.wordWrap
          : defaultUiPreferences.editor.wordWrap,
    },
    grid: {
      rowDensity: isRowDensity(grid.rowDensity)
        ? grid.rowDensity
        : defaultUiPreferences.grid.rowDensity,
      pageSize: isGridPageSize(grid.pageSize)
        ? grid.pageSize
        : defaultUiPreferences.grid.pageSize,
      showTotalCount:
        typeof grid.showTotalCount === "boolean"
          ? grid.showTotalCount
          : defaultUiPreferences.grid.showTotalCount,
    },
  };
}

export function themeToDomAttribute(theme: unknown): "light" | "dark" | null {
  switch (normalizeTheme(theme)) {
    case "tairiki-light":
    case "macos-light":
    case "tokyo-night-day":
    case "github-light":
      return "light";
    case "tairiki-dark":
    case "macos-dark":
    case "tokyo-night":
    case "github-dark":
      return "dark";
    case "system":
      return null;
  }
}

export function themeToPaletteAttribute(theme: unknown): string | null {
  switch (normalizeTheme(theme)) {
    case "tokyo-night":
      return "tokyo-night";
    case "tokyo-night-day":
      return "tokyo-night-day";
    case "github-dark":
      return "github-dark";
    case "github-light":
      return "github-light";
    default:
      return null;
  }
}

export function applyUiPreferencesToDocument(preferences: UiPreferences): void {
  if (typeof document === "undefined") return;

  const normalized = normalizeUiPreferences(preferences);
  const root = document.documentElement;
  const domTheme = themeToDomAttribute(normalized.ui.theme);
  const palette = themeToPaletteAttribute(normalized.ui.theme);

  if (domTheme === null) {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", domTheme);
  }

  if (palette === null) {
    root.removeAttribute("data-palette");
  } else {
    root.setAttribute("data-palette", palette);
  }

  root.style.setProperty("--font-ui", normalized.ui.fontFamily);
  root.style.setProperty("--font-ui-size", `${normalized.ui.fontSize}px`);
  root.style.setProperty("--font-editor", normalized.editor.fontFamily);
  root.style.setProperty("--font-editor-size", `${normalized.editor.fontSize}px`);
  root.style.setProperty(
    "--font-editor-line-height",
    String(normalized.editor.lineHeight),
  );
}

export function cacheUiPreferencesForBootstrap(preferences: UiPreferences): void {
  if (typeof localStorage === "undefined") return;

  try {
    localStorage.setItem(
      uiPreferencesBootstrapKey,
      JSON.stringify(normalizeUiPreferences(preferences)),
    );
  } catch {
    // A stale or missing bootstrap cache is non-fatal; Tauri prefs remain canonical.
  }
}
