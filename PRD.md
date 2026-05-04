# PRD: Typography & Visual Refresh

## Problem Statement

Esploro's current UI reads as functional but visually flat. The typography uses a conservative 13px baseline for both the interface and the editor, which feels cramped compared to modern macOS native apps. The color palette — while well-structured under the hood — skews heavily toward navy blue and grey, with limited chromatic warmth. Schema object colors, sidebar elements, and data value indicators don't feel distinct enough from one another, making the UI harder to scan at a glance. The overall effect is that the app feels technically solid but lacks visual personality and comfort.

## Solution

Refresh the typography and visual language to feel more polished and pleasant — warmer, more colorful, and better calibrated for readability. Use Yaak's font stack (Inter for UI, JetBrains Mono for the editor) as the reference point, and adopt its proven default sizes: 14px for the UI and 12px for the editor. Enrich the color palette with more distinct, vibrant hues for schema objects, data types, and semantic states — while keeping the color choices coherent with both the light and dark themes. The result should feel like a well-loved native macOS app, not a developer utility.

## User Stories

1. [x] As a user, I want the interface text to render at 14px by default, so that it is easier to read without having to manually increase the font size in settings.
2. [x] As a user, I want the editor text to render at 12px by default, so that code is legible without feeling oversized.
3. [x] As a user, I want the UI font to be Inter (with system-ui fallback), so that the interface matches the typographic quality of modern macOS apps like Yaak.
4. [x] As a user, I want the editor font to be JetBrains Mono (with monospace fallbacks), so that code has excellent ligature support and character distinction.
5. [x] As a user, I want the Inter and JetBrains Mono fonts to be bundled with the app, so that they render consistently regardless of what is installed on my machine.
6. [x] As a user, I want consistent line-height and letter-spacing across all UI text, so that reading feels comfortable rather than squeezed.
7. [x] As a user, I want schema object types (tables, views, functions, sequences) to be rendered in visually distinct, saturated colors, so that I can quickly identify object types in the sidebar tree without reading the label.
8. [x] As a user, I want the sidebar background to feel slightly warmer or more distinct from the main content area, so that the spatial hierarchy is clear at a glance.
9. [x] As a user, I want accent colors to feel more vivid and alive in both light and dark mode, so that interactive elements stand out.
10. [x] As a user, I want data type values in the table grid (nulls, booleans, JSON, numbers, dates) to use clearly differentiated colors, so that I can scan rows and understand data shape quickly.
11. [x] As a user, I want syntax highlighting in the query editor to use a vibrant, balanced palette, so that SQL keywords, strings, types, and comments are easy to distinguish.
12. [x] As a user, I want the dark theme colors to feel warm and rich rather than cold and muted, so that working at night is comfortable.
13. [x] As a user, I want the light theme colors to feel fresh and bright rather than navy-heavy, so that daytime use is pleasant.
14. [x] As a user, I want all color changes to respect the selected theme (system, light, dark), so that switching themes does not produce jarring visual inconsistencies.
15. [x] As a user, I want the appearance settings to reflect the new default font choices, so that the preset labels and preview match what I see in the app.
16. [x] As a user, I want the font size slider defaults to reflect the new 14px (UI) and 12px (editor) baselines, so that "reset to defaults" restores the refreshed values.
17. [x] As a user, I want the transition between hover, active, and selected states to feel smooth and intentional, so that the UI responds to my input without feeling sluggish or jarring.
18. [x] As a user, I want status bar text and tab bar labels to use the refreshed typography, so that the entire shell feels visually unified.
19. [x] As a user, I want connection status indicators and badge components to use the richer semantic colors, so that connection health is immediately obvious.
20. [x] As a user, I want toast notifications to use the refreshed color palette for success, warning, and error states, so that feedback messages are visually consistent with the rest of the app.
21. [x] As a user, I want the command palette text to use the refreshed font and sizing, so that searching for commands feels polished.
22. [x] As a user, I want column type badges in the schema inspector to use distinct, readable color coding, so that I can recognize column types (text, int, boolean, timestamp) at a glance.

## Implementation Decisions

### Font Stack

- [x] **UI font:** Inter Variable (variable font, weight range 300–700), falling back to `system-ui`, `-apple-system`, `sans-serif`. This matches Yaak's default interface font.
- [x] **Editor font:** JetBrains Mono (variable font, weight range 400–700), falling back to `ui-monospace`, `SF Mono`, `Menlo`, `monospace`. This matches Yaak's default editor font.
- [x] Both fonts should be self-hosted as WOFF2 variable fonts under `src/assets/fonts/` and declared via `@font-face` in `tokens.css` or a dedicated `fonts.css` imported before tokens. This avoids network round-trips in the Tauri webview.
- [x] `font-feature-settings: "ss01", "ss02", "cv01"` should be applied to Inter for better numeral and punctuation rendering.
- [x] `font-feature-settings: "liga", "calt"` should be applied to JetBrains Mono to enable ligatures in the editor.

### Default Font Sizes

- [x] `--font-ui-size` default changes from `13px` → `14px`
- [x] `--font-editor-size` default changes from `13px` → `12px`
- [x] Defaults in `preferences.ts` (`DEFAULT_UI_PREFERENCES`) updated to match.
- [x] Bootstrap script in `index.html` continues to apply localStorage values before React hydrates — defaults updated to 14/12.
- [x] Appearance settings slider ranges remain unchanged (11–16px for UI, 11–18px for editor); only the default values shift.

### Color Palette Refresh (tokens.css)

**Light theme changes:**
- `--ds-label`: shift from deep navy `#001070` toward a near-black with a slight warm tint (e.g. `#1a1a2e` → `#111118`) for more neutral, readable body text
- `--ds-accent`: introduce a more vibrant mid-blue (e.g. `#2563eb` Tailwind blue-600) to replace the corporate `#0070c1`
- `--ds-accent-subtle`: warmer, more saturated tint to match new accent
- `--ds-sidebar-bg`: subtle warm-grey tint (e.g. `#f5f5f7`) rather than the bluish `#f0f0f8`
- `--ds-success`: richer green (e.g. `#16a34a` / Tailwind green-600)
- `--ds-destructive`: warmer red (e.g. `#dc2626` / Tailwind red-600)
- `--ds-warning`: more saturated amber (e.g. `#d97706` / Tailwind amber-600)

**Dark theme changes:**
- Introduce a warmer base: `--ds-content-bg` shifts toward `#1c1c1e` (macOS dark surface) rather than a cold near-black
- `--ds-sidebar-bg` in dark: `#161618` (slightly deeper than content bg)
- `--ds-accent` in dark: `#60a5fa` (Tailwind blue-400) — vivid but not harsh
- Syntax colors in dark: increase saturation across the board (keyword purple, string green, number blue, type amber) for better contrast against the warmer dark background
- `--ds-success`/`--ds-warning`/`--ds-destructive` in dark: follow Tailwind 400-level palette equivalents

**Schema object color enrichment:**
- Assign each schema object type a distinct, memorable hue that works in both themes:
  - `--schema-table`: grass green
  - `--schema-view`: sky blue
  - `--schema-function`: amber/orange
  - `--schema-sequence`: coral/rose
  - `--schema-schema`: violet
  - `--schema-database`: indigo (accent)
  - `--schema-key`: gold/yellow
  - `--schema-foreign-key`: purple
- Colors should be derived from the `ds-syntax-*` palette for consistency rather than introducing new raw hex values.

### Appearance Settings

- [x] Add Inter and JetBrains Mono as the first (default) option in the UI and editor font pickers respectively.
- [x] Update preview panel to render at the new default sizes.
- [x] "Reset to defaults" restores `fontSize: 14` for UI and `editorFontSize: 12`.

### CodeMirror Theme (tairikiTheme.ts)

- [x] No structural changes — the theme already uses CSS variables. Changes flow through via updated `--editor-syntax-*` token values in `tokens.css`.
- [x] Enable JetBrains Mono ligatures via `font-variant-ligatures: common-ligatures` and `font-feature-settings: "liga", "calt"` on the `.cm-editor` element in the CodeMirror theme stylesheet.

### Tailwind Theme (index.css)

- [x] No changes needed. The `@theme inline` block maps CSS variables to utility classes — updating token values in `tokens.css` automatically updates generated utilities.

## Testing Decisions

**What makes a good test here:**
Typography and visual changes are best verified by visual inspection, but the behavioral surface (preference persistence, default values, theme switching) can and should be unit tested.

**What to test:**
- [x] `preferences.ts`: verify that `DEFAULT_UI_PREFERENCES` exports `fontSize: 14` and `editorFontSize: 12`, and that the validation schema accepts and clamps these correctly.
- Font loading: verify that the `@font-face` declarations reference files that exist at the expected paths in the build output.
- Theme switching: existing theme-application logic should continue to work; no new behavior is introduced.

**What not to test:**
- Pixel-perfect visual output — this is not feasible in a unit test context and is better verified by running the app.
- CSS variable resolution — this is browser behavior, not application logic.

**Prior art:**
- Preference validation tests (if any exist) in `src/features/settings/` are the closest analogue.

## Out of Scope

- Custom accent color picker (user-defined brand colors).
- Additional theme variants beyond the existing Tairiki Light / Tairiki Dark / System trio.
- Changing the data grid's row density defaults (covered by DataGridSettings).
- Any changes to the editor's keymap, completion behavior, or diagnostics rendering.
- Dark-mode-only or light-mode-only color variants for schema objects — both themes get a full, coherent set.
- Icon set changes or icon color adjustments beyond what flows naturally from token updates.

## Further Notes

- **Yaak reference:** The font choices (Inter + JetBrains Mono at 14px / 12px) are directly inspired by Yaak's defaults, which have proven comfortable for database and API tool UIs. Inter's optical sizing and JetBrains Mono's wide character support make them a strong pairing.
- **Variable fonts:** Using variable font files (`*.woff2`) instead of static weight files reduces the number of `@font-face` declarations and the total font payload.
- **Color derivation principle:** Where possible, new color values should be drawn from the Tailwind v4 palette (which is already a project dependency) rather than hand-picked hex values, to keep the palette grounded in a well-tested color system.
- **Contrast compliance:** All text/background combinations for the new palette should be verified against WCAG AA (4.5:1 for body text, 3:1 for large text) before finalizing values.
