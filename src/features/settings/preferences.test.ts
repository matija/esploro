import {
  applyUiPreferencesToDocument,
  cacheUiPreferencesForBootstrap,
  defaultUiPreferences,
  editorTabSizeValues,
  gridPageSizeValues,
  normalizeTheme,
  normalizeUiPreferences,
  rowDensityValues,
  themeToDomAttribute,
  uiPreferenceRanges,
  uiThemeValues,
  type UiPreferences,
} from "./preferences";

// Preferences arrive from disk (a Tauri-managed JSON file) and from an older
// schema, so every accessor has to survive arbitrary input. These tests drive
// the normalizers with the shapes that actually reach them: valid values,
// out-of-range numbers, legacy themes, and outright garbage.
describe("normalizeTheme", () => {
  it("passes every known theme through unchanged", () => {
    for (const theme of uiThemeValues) {
      expect(normalizeTheme(theme)).toBe(theme);
    }
  });

  it("maps the legacy light/dark themes onto their Tairiki successors", () => {
    expect(normalizeTheme("light")).toBe("tairiki-light");
    expect(normalizeTheme("dark")).toBe("tairiki-dark");
  });

  it("falls back to the default theme for unknown or non-string values", () => {
    const fallback = defaultUiPreferences.ui.theme;
    expect(normalizeTheme("solarized")).toBe(fallback);
    expect(normalizeTheme(undefined)).toBe(fallback);
    expect(normalizeTheme(null)).toBe(fallback);
    expect(normalizeTheme(42)).toBe(fallback);
    expect(normalizeTheme({ theme: "github-dark" })).toBe(fallback);
  });
});

describe("normalizeUiPreferences", () => {
  it("returns the defaults for values with no usable shape", () => {
    for (const input of [undefined, null, "nope", 7, []]) {
      expect(normalizeUiPreferences(input)).toEqual(defaultUiPreferences);
    }
  });

  it("returns the defaults unchanged when given the defaults", () => {
    expect(normalizeUiPreferences(defaultUiPreferences)).toEqual(defaultUiPreferences);
  });

  it("keeps a fully valid non-default preference set", () => {
    const stored: UiPreferences = {
      ui: { theme: "rose-pine", fontFamily: "Inter", fontSize: 15 },
      editor: {
        fontFamily: "Fira Code",
        fontSize: 14,
        lineHeight: 1.6,
        tabSize: 4,
        wordWrap: true,
      },
      grid: { rowDensity: "spacious", pageSize: 500, showTotalCount: false },
    };
    expect(normalizeUiPreferences(stored)).toEqual(stored);
  });

  it("fills in each missing section from the defaults", () => {
    expect(normalizeUiPreferences({ ui: { theme: "github-dark" } })).toEqual({
      ...defaultUiPreferences,
      ui: { ...defaultUiPreferences.ui, theme: "github-dark" },
    });
  });

  it("ignores sections that are present but not objects", () => {
    expect(
      normalizeUiPreferences({ ui: "dark", editor: null, grid: 3 }),
    ).toEqual(defaultUiPreferences);
  });

  it("rejects blank font families but keeps meaningful ones", () => {
    const blank = normalizeUiPreferences({
      ui: { fontFamily: "   " },
      editor: { fontFamily: "" },
    });
    expect(blank.ui.fontFamily).toBe(defaultUiPreferences.ui.fontFamily);
    expect(blank.editor.fontFamily).toBe(defaultUiPreferences.editor.fontFamily);

    const set = normalizeUiPreferences({ ui: { fontFamily: "Inter" } });
    expect(set.ui.fontFamily).toBe("Inter");
  });

  it("clamps font sizes and line height to their advertised ranges", () => {
    const { uiFontSize, editorFontSize, editorLineHeight } = uiPreferenceRanges;

    const low = normalizeUiPreferences({
      ui: { fontSize: uiFontSize.min - 1 },
      editor: { fontSize: editorFontSize.min - 1, lineHeight: editorLineHeight.min - 0.1 },
    });
    expect(low.ui.fontSize).toBe(defaultUiPreferences.ui.fontSize);
    expect(low.editor.fontSize).toBe(defaultUiPreferences.editor.fontSize);
    expect(low.editor.lineHeight).toBe(defaultUiPreferences.editor.lineHeight);

    const high = normalizeUiPreferences({
      ui: { fontSize: uiFontSize.max + 1 },
      editor: { fontSize: editorFontSize.max + 1, lineHeight: editorLineHeight.max + 0.1 },
    });
    expect(high.ui.fontSize).toBe(defaultUiPreferences.ui.fontSize);
    expect(high.editor.fontSize).toBe(defaultUiPreferences.editor.fontSize);
    expect(high.editor.lineHeight).toBe(defaultUiPreferences.editor.lineHeight);
  });

  it("accepts the exact range endpoints", () => {
    const { uiFontSize, editorFontSize, editorLineHeight } = uiPreferenceRanges;
    const edges = normalizeUiPreferences({
      ui: { fontSize: uiFontSize.min },
      editor: { fontSize: editorFontSize.max, lineHeight: editorLineHeight.min },
    });
    expect(edges.ui.fontSize).toBe(uiFontSize.min);
    expect(edges.editor.fontSize).toBe(editorFontSize.max);
    expect(edges.editor.lineHeight).toBe(editorLineHeight.min);
  });

  it("rejects non-finite and non-numeric sizes", () => {
    const bad = normalizeUiPreferences({
      ui: { fontSize: Number.NaN },
      editor: { fontSize: Number.POSITIVE_INFINITY, lineHeight: "1.5" },
    });
    expect(bad.ui.fontSize).toBe(defaultUiPreferences.ui.fontSize);
    expect(bad.editor.fontSize).toBe(defaultUiPreferences.editor.fontSize);
    expect(bad.editor.lineHeight).toBe(defaultUiPreferences.editor.lineHeight);
  });

  it("accepts every enumerated tab size, page size and row density", () => {
    for (const tabSize of editorTabSizeValues) {
      expect(normalizeUiPreferences({ editor: { tabSize } }).editor.tabSize).toBe(tabSize);
    }
    for (const pageSize of gridPageSizeValues) {
      expect(normalizeUiPreferences({ grid: { pageSize } }).grid.pageSize).toBe(pageSize);
    }
    for (const rowDensity of rowDensityValues) {
      expect(normalizeUiPreferences({ grid: { rowDensity } }).grid.rowDensity).toBe(rowDensity);
    }
  });

  it("rejects enumerated values that are off-list or the wrong type", () => {
    const bad = normalizeUiPreferences({
      editor: { tabSize: 3 },
      grid: { pageSize: "200", rowDensity: "cozy" },
    });
    expect(bad.editor.tabSize).toBe(defaultUiPreferences.editor.tabSize);
    expect(bad.grid.pageSize).toBe(defaultUiPreferences.grid.pageSize);
    expect(bad.grid.rowDensity).toBe(defaultUiPreferences.grid.rowDensity);
  });

  it("requires real booleans for the toggles", () => {
    const truthy = normalizeUiPreferences({
      editor: { wordWrap: "true" },
      grid: { showTotalCount: 0 },
    });
    expect(truthy.editor.wordWrap).toBe(defaultUiPreferences.editor.wordWrap);
    expect(truthy.grid.showTotalCount).toBe(defaultUiPreferences.grid.showTotalCount);

    const explicit = normalizeUiPreferences({
      editor: { wordWrap: true },
      grid: { showTotalCount: false },
    });
    expect(explicit.editor.wordWrap).toBe(true);
    expect(explicit.grid.showTotalCount).toBe(false);
  });

  it("does not mutate or alias the input object", () => {
    const input = { ui: { theme: "rose-pine" } };
    const result = normalizeUiPreferences(input);
    expect(input).toEqual({ ui: { theme: "rose-pine" } });
    expect(result.ui).not.toBe(input.ui);
  });
});

describe("themeToDomAttribute", () => {
  it("resolves every theme to light, dark, or null", () => {
    for (const theme of uiThemeValues) {
      expect(["light", "dark", null]).toContain(themeToDomAttribute(theme));
    }
  });

  it("classifies light and dark palettes", () => {
    expect(themeToDomAttribute("github-light")).toBe("light");
    expect(themeToDomAttribute("catppuccin-latte")).toBe("light");
    expect(themeToDomAttribute("rose-pine-dawn")).toBe("light");
    expect(themeToDomAttribute("tokyo-night-day")).toBe("light");
    expect(themeToDomAttribute("github-dark")).toBe("dark");
    expect(themeToDomAttribute("catppuccin-mocha")).toBe("dark");
    expect(themeToDomAttribute("rose-pine-moon")).toBe("dark");
    expect(themeToDomAttribute("tokyo-night")).toBe("dark");
  });

  it("returns null for the system theme so CSS media queries take over", () => {
    expect(themeToDomAttribute("system")).toBeNull();
  });

  it("normalizes unknown and legacy input before resolving", () => {
    expect(themeToDomAttribute("light")).toBe("light");
    expect(themeToDomAttribute("dark")).toBe("dark");
    expect(themeToDomAttribute("nonsense")).toBe(
      themeToDomAttribute(defaultUiPreferences.ui.theme),
    );
  });
});

describe("applyUiPreferencesToDocument", () => {
  const root = document.documentElement;

  function prefs(overrides: Partial<UiPreferences["ui"]> = {}): UiPreferences {
    return {
      ...defaultUiPreferences,
      ui: { ...defaultUiPreferences.ui, ...overrides },
    };
  }

  afterEach(() => {
    root.removeAttribute("data-theme");
    root.removeAttribute("data-palette");
    root.removeAttribute("style");
  });

  it("sets the theme and palette attributes for a palette theme", () => {
    applyUiPreferencesToDocument(prefs({ theme: "catppuccin-mocha" }));
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.getAttribute("data-palette")).toBe("catppuccin-mocha");
  });

  it("omits the palette attribute for themes without a palette", () => {
    root.setAttribute("data-palette", "rose-pine");
    applyUiPreferencesToDocument(prefs({ theme: "tairiki-light" }));
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.hasAttribute("data-palette")).toBe(false);
  });

  it("clears the theme attribute for the system theme", () => {
    root.setAttribute("data-theme", "dark");
    applyUiPreferencesToDocument(prefs({ theme: "system" }));
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(root.hasAttribute("data-palette")).toBe(false);
  });

  it("writes the font custom properties the stylesheet reads", () => {
    applyUiPreferencesToDocument({
      ui: { theme: "github-dark", fontFamily: "Inter", fontSize: 15 },
      editor: {
        fontFamily: "Fira Code",
        fontSize: 14,
        lineHeight: 1.6,
        tabSize: 4,
        wordWrap: true,
      },
      grid: { rowDensity: "compact", pageSize: 100, showTotalCount: true },
    });
    expect(root.style.getPropertyValue("--font-ui")).toBe("Inter");
    expect(root.style.getPropertyValue("--font-ui-size")).toBe("15px");
    expect(root.style.getPropertyValue("--font-editor")).toBe("Fira Code");
    expect(root.style.getPropertyValue("--font-editor-size")).toBe("14px");
    expect(root.style.getPropertyValue("--font-editor-line-height")).toBe("1.6");
  });

  it("normalizes before applying, so bad values never reach the DOM", () => {
    applyUiPreferencesToDocument({
      ui: { theme: "nonsense", fontFamily: "  ", fontSize: 99 },
    } as unknown as UiPreferences);
    expect(root.style.getPropertyValue("--font-ui")).toBe(
      defaultUiPreferences.ui.fontFamily,
    );
    expect(root.style.getPropertyValue("--font-ui-size")).toBe(
      `${defaultUiPreferences.ui.fontSize}px`,
    );
    expect(root.getAttribute("data-theme")).toBe(
      themeToDomAttribute(defaultUiPreferences.ui.theme),
    );
  });
});

describe("cacheUiPreferencesForBootstrap", () => {
  const key = "esploro-ui-preferences";

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("stores the normalized preferences as JSON", () => {
    cacheUiPreferencesForBootstrap({
      ...defaultUiPreferences,
      ui: { ...defaultUiPreferences.ui, theme: "rose-pine" },
    });
    expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual({
      ...defaultUiPreferences,
      ui: { ...defaultUiPreferences.ui, theme: "rose-pine" },
    });
  });

  it("normalizes garbage before caching it", () => {
    cacheUiPreferencesForBootstrap({
      ui: { theme: "nonsense", fontSize: 99 },
    } as unknown as UiPreferences);
    expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual(defaultUiPreferences);
  });

  it("swallows storage failures — a stale bootstrap cache is not fatal", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => cacheUiPreferencesForBootstrap(defaultUiPreferences)).not.toThrow();
  });
});
