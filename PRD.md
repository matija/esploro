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
- Subtle accent color use for focus, selection, active tabs, query success, and schema object types.
- Rich but quiet motion: fades, scale of 0.98 to 1, chevron rotation, row reveal, panel resize feedback.
- No generic SaaS cards, heavy gradients, rounded blobs, or large marketing-style empty states.

Yaak is the craft reference. Esploro should not copy Yaak directly, but it should match its level of attention: every row, badge, popover, splitter, shortcut hint, and state should look intentionally designed.

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
- Schema accents: database, schema, table, view, function, sequence, column, key, nullable.
- Editor syntax: keyword, function, string, type, constant, operator, comment, error.
- Motion: fast, base, slow, easing-standard, easing-enter, easing-exit.
- Radius: control, badge, popover, panel, modal.
- Shadows: hairline, popover, modal, active-pane.
- Fonts: UI family, editor family, UI size, editor size, editor line height.

Components must not hardcode color, shadow, radius, motion, or font values when a token exists.

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
- Font customization works, persists, survives restart, and affects CodeMirror.
- Loading, empty, error, hover, focus, selected, disabled, and success states exist for all primary surfaces.
- The app still passes `npm run type-check`, `npm run lint`, and the relevant Tauri build checks.

## Implementation Plan

The execution plan lives in `plans/07-ui-craft.md`.
