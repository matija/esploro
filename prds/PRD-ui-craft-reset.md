# Esploro PRD — UI Craft Reset

> Status: Active replacement PRD.
>
> The previous PRD is deprecated. It described the original database-client MVP and early theme work. Keep the existing phase plans as implementation history, but use this file as the current source of truth for the product shape and UI bar.

## Product Intent

Esploro is a native-feeling macOS database client for PostgreSQL. It should feel fast, precise, and carefully made. The target is not a generic admin panel. The target is a desktop tool with the density and craft of Yaak: useful chrome, layered panels, crisp states, smooth command flows, and small details that make the app feel alive.

The app should still do the core job:

- Connect to PostgreSQL databases.
- Browse schemas and objects.
- Inspect table data.
- Run SQL.
- Save useful queries.

The reset changes the quality bar. UI polish is now a first-class product requirement, not a cleanup pass after features.

## Deprecated Scope

The old PRD is deprecated in these ways:

- It treated macOS-native UI as mostly sidebar, vibrancy, fonts, and tokens. The new requirement is a complete crafted interface system.
- It treated appearance settings as theme selection. The new requirement includes font customization and a previewable settings surface.
- It specified many isolated feature details, but not enough interaction detail. The new requirement defines empty states, loading states, keyboard flows, panel choreography, and micro-interactions.
- It allowed the UI to be acceptable if it was functional. The new requirement is that the UI must feel deliberate at every layer.

The database feature scope remains PostgreSQL-first. The licensing model remains personal-free and commercial-paid unless a later PRD changes it.

## Experience Goal

The first ten seconds should communicate quality:

- The window opens without visual flash.
- The sidebar, toolbar, tab strip, and content area feel like one designed object.
- Empty states teach the next action instead of showing blank panels.
- Controls have real hover, pressed, focused, disabled, and loading states.
- Lists and grids feel dense but not cramped.
- The command palette feels fast and central.
- The query editor and result grid feel like a developer tool, not a form.

## Visual Direction

Esploro should use a restrained macOS base with crafted details:

- Soft layered surfaces instead of flat gray blocks.
- Fine borders, hairlines, and separators that adapt to light and dark themes.
- Compact controls with clear hierarchy.
- Color is a first-class UI primitive, not decoration. Use the Tairiki theme colors to make state, hierarchy, and object identity stand out clearly.
- Noticeable accent color use for focus, selection, active tabs, query success, warnings, errors, active connections, schema object types, badges, and status metadata.
- Rich but quiet motion: fades, scale of 0.98 to 1, chevron rotation, row reveal, panel resize feedback.
- No generic SaaS cards, heavy gradients, rounded blobs, or large marketing-style empty states.

Yaak is the craft reference for density, contrast, and polish. Esploro should not copy Yaak's palette. It must use the Tairiki theme as the visual source of truth while matching Yaak's level of attention: every row, badge, popover, splitter, shortcut hint, and state should look intentionally designed.

## Color Direction

Color must carry meaning throughout the app. The interface should be calmer than a game or marketing site, but it must not collapse into neutral gray chrome. Important states and structured data should be scannable at a glance.

Use the Tairiki theme as the required palette foundation:

- Tairiki light and Tairiki dark are the primary themes for the craft reset.
- Do not introduce the Yaak screenshot palette as a theme or copy its exact hues.
- All semantic colors must be expressed as Tairiki-backed tokens.
- macOS/system themes may remain available later, but they must not weaken the Tairiki-first visual direction.

Required first-class color usage:

- Navigation: selected sidebar rows, active tabs, active panes, current connection, and command palette highlights must use visible accent treatments.
- Status: success, warning, error, pending, disconnected, and loading states must have distinct colors plus shape or text differences for accessibility.
- Database objects: databases, schemas, tables, views, functions, sequences, columns, keys, foreign keys, nullable fields, indexes, and constraints must have stable object colors.
- Query work: run button state, execution duration, affected rows, result count, error location, diagnostics, and transaction state must use semantic color.
- Data grid: null, empty string, boolean, JSON, date/time, numeric, modified, selected, filtered, and sorted cells must be visually distinguishable.
- Editor: syntax highlighting, autocomplete, diagnostics, active line, selection, search matches, and bracket matching must use the Tairiki token system.
- Settings: preview panels should demonstrate the color system with realistic sidebar, editor, grid, badge, and status examples.

Color treatment rules:

- Prefer colored text, icons, thin rails, badges, focus rings, selection fills, and low-opacity backgrounds over large saturated blocks.
- Every color-coded state must still work in light and dark Tairiki themes.
- Do not rely on color alone for destructive actions, errors, or connection health.
- Avoid one-off component colors. If a useful color does not exist, add a semantic token before using it.
- Preserve readability: body text stays high contrast, while color is used to emphasize structure and action.

## Information Architecture

The app shell has five primary regions:

| Region | Purpose |
|---|---|
| Sidebar | Connections, schema tree, saved queries, compact status |
| Toolbar | Current context, primary actions, global search, settings entry |
| Tab strip | Open tables, query editors, settings, transient utility tabs |
| Work area | Table viewer, query editor, schema detail, settings |
| Status bar | Connection health, row counts, execution time, background work |

The UI should always answer three questions:

- Where am I connected?
- What object or query am I looking at?
- What action can I take next?

## Core UI Requirements

### App Shell

- Use a three-layer shell: sidebar, toolbar/tab chrome, content canvas.
- Support sidebar resize with live feedback and persisted width.
- Add splitter affordances that are visible on hover and keyboard focus.
- Show traffic-light safe spacing in the titlebar area.
- Keep global actions stable: command palette, new query, settings.
- Add a compact status bar with connection state, background task count, and last action.

### Sidebar

- Include connection groups, schema objects, saved queries, and recent objects.
- Give each row clear states: idle, hover, selected, focused, loading, error, disconnected.
- Use object-specific glyphs and color accents for databases, schemas, tables, views, functions, sequences, columns, primary keys, foreign keys, and nullable fields.
- Add disclosure animation and nested indentation that stays readable at high density.
- Add inline action buttons that appear on hover, not permanent clutter.
- Add a polished empty state for no connections with a primary action and paste-URL shortcut.

### Toolbar And Tabs

- Tabs need close, dirty, loading, and error states.
- Query tabs show saved/unsaved state.
- Table tabs show schema-qualified names with truncation that preserves the table name.
- Toolbars should be contextual but stable. Primary actions stay in the same area across tabs.
- Keyboard shortcuts appear as small right-aligned hints in menus and palette rows.

### Command Palette

- `Cmd+K` is the main navigation surface.
- It should search connections, tables, views, saved queries, commands, and settings.
- Results should be grouped with compact headers.
- Each result should show an icon, title, subtitle, and optional shortcut.
- Empty search should show useful default commands.
- No-results state should offer to create a connection or new query when relevant.

### Table Viewer

- Grid density is a feature. Default row height should be compact, with a setting to change density later.
- Headers show column name, type badge, sort state, filter state, and nullable/key indicators.
- Filters should feel like a built tool: chips, operator picker, inline editing, clear-all action.
- Cell selection should be obvious and copy-friendly.
- Null, empty string, boolean, JSON, date, number, and long text values must render distinctly.
- Loading should use skeleton rows that match the grid shape.
- Empty result sets should explain whether the table is empty or filters removed all rows.

### Query Editor

- CodeMirror must match the active theme and font settings.
- The editor needs a polished gutter, active line, selection, matching bracket, autocomplete, and diagnostics styling.
- The run button should show pending, success, error, and duration states.
- Result panels should be resizable and persist their split.
- Errors should show a compact summary above results and an inline marker in the editor when position is known.
- Multiple result sets should be clearly separated without feeling like separate pages.

### Settings

Settings is a real surface, not an afterthought.

- Add a dedicated Settings tab or modal that feels native and dense.
- Include sections for Appearance, Editor, Data Grid, Connections, Licensing, and Advanced.
- Appearance must include theme, accent color if supported, UI font, editor font, and font size controls.
- Changes should preview live and persist immediately.
- Risky actions require confirmation.

## Font Customization

Font customization is required for the first UI craft pass.

### User Controls

Appearance settings must include:

- UI font family.
- Editor font family.
- UI font size.
- Editor font size.
- Line height or density preset for editor text.
- Reset to defaults.

### Defaults

| Role | Default |
|---|---|
| UI font | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif` |
| Editor font | `ui-monospace, "SF Mono", Menlo, Monaco, "Courier New", monospace` |
| UI size | `13px` |
| Editor size | `13px` |
| Editor line height | `1.5` |

### Constraints

- Do not load remote fonts.
- Let users type a font stack or choose from detected common fonts.
- Apply font settings through CSS variables.
- Apply settings before first paint to avoid font flash.
- CodeMirror must read the same editor font variables as the rest of the app.
- Bad font input must not break the UI. Keep reset available.

### Persistence

Store preferences in `$APP_DATA_DIR/prefs.json` under:

```json
{
  "ui": {
    "theme": "tairiki-light",
    "fontFamily": "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Helvetica Neue\", sans-serif",
    "fontSize": 13
  },
  "editor": {
    "fontFamily": "ui-monospace, \"SF Mono\", Menlo, Monaco, \"Courier New\", monospace",
    "fontSize": 13,
    "lineHeight": 1.5
  }
}
```

## Themes And Tokens

The existing Tairiki theme work remains valid, but the token system must expand to support craft-level UI.

Required token groups:

- Surfaces: base, sidebar, raised, inset, overlay, selected, hover, pressed.
- Borders: subtle, default, strong, focus, destructive.
- Text: primary, secondary, tertiary, disabled, inverse, accent.
- Semantic state: success, warning, danger, info, pending, disconnected, loading.
- Schema accents: database, schema, table, view, function, sequence, column, key, foreign-key, nullable, index, constraint.
- Data value accents: null, empty, boolean, json, date-time, number, text, modified, filtered, sorted.
- Query accents: running, succeeded, failed, duration, row-count, transaction, diagnostic.
- Editor syntax: keyword, function, string, type, constant, operator, comment, error.
- Motion: fast, base, slow, easing-standard, easing-enter, easing-exit.
- Radius: control, badge, popover, panel, modal.
- Shadows: hairline, popover, modal, active-pane.
- Fonts: UI family, editor family, UI size, editor size, editor line height.

Components must not hardcode color, shadow, radius, motion, or font values when a token exists. New component color needs must become semantic tokens first, backed by the Tairiki theme.

## Interaction Requirements

- Every interactive element must have hover, active, focus-visible, disabled, and loading states when applicable.
- Keyboard focus must be visible and consistent.
- Context menus should be available for schema nodes, table rows, grid cells, tabs, and saved queries.
- Destructive actions must be separated in menus and styled as destructive.
- Long-running actions should show progress or a pending state within 150 ms.
- Errors should explain what failed and offer the next action when possible.
- Success should be quiet: status text or a small toast, not a modal.

## Motion Requirements

Motion must be subtle and fast.

- Hover transitions: 100-140 ms.
- Disclosure and row reveal: 140-180 ms.
- Dialog and popover enter: 120-160 ms.
- Dialog and popover exit: 80-120 ms.
- Respect `prefers-reduced-motion`.
- Do not animate large layout changes when the user is dragging a splitter.

## Acceptance Bar

The UI craft pass is complete when:

- A new user can create a connection from the empty state without guessing.
- The app has no unstyled default browser controls in primary flows.
- The sidebar, command palette, settings, query editor, and table viewer share one visual system.
- Tairiki light and dark feel colorful and intentional, with visible semantic color across navigation, status, schema objects, the editor, and the data grid.
- Color improves scanability without copying Yaak's palette or relying on color alone for critical meaning.
- Font customization works, persists, survives restart, and affects CodeMirror.
- Loading, empty, error, hover, focus, selected, disabled, and success states exist for all primary surfaces.
- The app still passes `npm run type-check`, `npm run lint`, and the relevant Tauri build checks.

## App Icon

Esploro's app icon should feel at home in the macOS Dock: crafted, confident, and recognizable at every size.

### Icon Concept

Use the **Binoculars** glyph from [Phosphor Icons](https://phosphoricons.com/) (the `bold` or `fill` weight) as the primary symbol. The binoculars metaphor fits the product — exploring and inspecting data from a distance.

### macOS Icon Specification

macOS app icons follow Apple's squircle container with a continuous-curvature rounded rectangle (superellipse, corner radius ≈ 22.37% of the icon size). The design must:

- Render well at 16 × 16 through 1024 × 1024.
- Look at home alongside system apps (Finder, Terminal, Xcode) in the Dock.
- Use a solid, slightly textured or subtly gradient background in the Tairiki accent tone — not a flat gray and not a photo-realistic 3D render.
- Place the binoculars glyph centered, in white or near-white, at roughly 58–62% of the icon canvas width.
- Optionally add a thin 1 px inner stroke inside the squircle border at low opacity to give depth without going skeuomorphic.

### Required Sizes

Tauri bundles icons from `src-tauri/icons/`. The following files are required:

| File | Size |
|---|---|
| `icon.icns` | macOS multi-resolution bundle |
| `icon.ico` | Windows (not primary target but Tauri expects it) |
| `icon.png` | 512 × 512 fallback |
| `32x32.png` | Small Dock / menu bar |
| `128x128.png` | Launchpad |
| `128x128@2x.png` | Retina Launchpad |

### Production Process

1. Start from the Phosphor SVG source for `Binoculars` at the `bold` or `fill` weight (download from phosphoricons.com or the npm package `phosphor-icons`).
2. Design the squircle container in Figma or Sketch: set fill to the Tairiki accent color (use the `--color-accent` token value), apply an inner shadow at 5% opacity for subtle depth.
3. Place the binoculars glyph as a white shape, centered, at ~60% icon canvas width.
4. Export at 1024 × 1024 as a PNG master.
5. Use the Tauri CLI helper or `iconutil` to generate all required sizes and the `.icns` bundle:
   ```sh
   # Tauri shortcut (generates all sizes from a 1024x1024 PNG):
   npx tauri icon src-tauri/icons/icon-master.png
   ```
6. Commit all generated files under `src-tauri/icons/`.
7. Verify in `tauri.conf.json` that `bundle.icon` references the correct paths.

### Acceptance

- Icon is crisp and recognizable at 32 × 32 in the Dock.
- Icon does not look like a default Tauri placeholder.
- No pixelation or aliasing at any standard macOS display density.
- Icon renders correctly in light and dark menubar (macOS auto-adapts from the `.icns` bundle).

## Implementation Plan

The execution plan lives in `plans/07-ui-craft.md`.
