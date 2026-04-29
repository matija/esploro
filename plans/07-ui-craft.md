# Phase 07 — UI Craft Reset

**Goal:** Raise Esploro's interface to the same craft level as Yaak: dense, polished, responsive, and full of useful small details. This phase does not add new database capability. It makes the existing capability feel like a finished desktop product.

**Done when:**

- The app shell, sidebar, command palette, settings, query editor, and table viewer share one detailed visual system.
- Appearance settings include live font customization for UI and editor fonts.
- Font preferences persist to app prefs and apply before first paint.
- CodeMirror uses the app's editor font and theme variables.
- Loading, empty, error, hover, active, selected, focus, disabled, and success states are designed for primary flows.
- `npm run type-check` and `npm run lint` pass.

---

## 7.1 Audit Current UI

Create a short checklist before editing components.

Files to inspect:

- `src/components/AppShell.tsx`
- `src/components/Sidebar.tsx`
- `src/components/SidebarSection.tsx`
- `src/components/TabBar.tsx`
- `src/components/CommandPalette.tsx`
- `src/features/connections/ConnectionList.tsx`
- `src/features/schema/SchemaTree.tsx`
- `src/features/table-viewer/TableViewerTab.tsx`
- `src/features/query-editor/QueryEditorTab.tsx`
- `src/features/query-editor/SqlEditor.tsx`
- `src/features/settings/AppearanceSettings.tsx`
- `src/styles/tokens.css`
- `src/styles/index.css`

For each surface, record missing states:

- Empty
- Loading
- Error
- Hover
- Pressed
- Selected
- Keyboard focus
- Disabled
- Success
- Context menu

Do not start by redesigning everything visually. Start by finding missing state coverage.

---

## 7.2 Expand Design Tokens

File: `src/styles/tokens.css`

Add token groups for craft-level UI.

### Surface Tokens

```css
:root {
  --surface-base: var(--color-bg-base);
  --surface-sidebar: var(--color-bg-sidebar);
  --surface-raised: var(--color-bg-elevated);
  --surface-inset: var(--color-bg-subtle);
  --surface-hover: var(--color-bg-subtle);
  --surface-pressed: var(--color-bg-active);
  --surface-selected: var(--color-bg-active);
  --surface-overlay: color-mix(in srgb, var(--color-bg-elevated) 96%, transparent);
}
```

### Border Tokens

```css
:root {
  --border-subtle: color-mix(in srgb, var(--color-border) 55%, transparent);
  --border-default: var(--color-border);
  --border-strong: var(--color-border-strong);
  --border-focus: var(--color-accent);
  --border-danger: var(--color-danger);
}
```

### Font Tokens

```css
:root {
  --font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  --font-editor: ui-monospace, "SF Mono", Menlo, Monaco, "Courier New", monospace;
  --font-ui-size: 13px;
  --font-editor-size: 13px;
  --font-editor-line-height: 1.5;
}
```

### Motion Tokens

```css
:root {
  --motion-fast: 100ms;
  --motion-base: 150ms;
  --motion-slow: 220ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-enter: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-exit: cubic-bezier(0.7, 0, 0.84, 0);
}
```

### Radius And Shadow Tokens

```css
:root {
  --radius-control: 6px;
  --radius-badge: 4px;
  --radius-popover: 8px;
  --radius-panel: 10px;
  --radius-modal: 12px;
  --shadow-hairline: inset 0 0 0 1px var(--border-subtle);
  --shadow-popover: 0 12px 30px color-mix(in srgb, #000 18%, transparent);
  --shadow-active-pane: 0 0 0 1px var(--border-focus), 0 0 0 4px color-mix(in srgb, var(--color-accent) 16%, transparent);
}
```

Acceptance:

- No component adds new hardcoded color, radius, shadow, motion, or font values when a token exists.
- Existing Tairiki and macOS themes populate the same token contract.

---

## 7.3 Add UI Preference Model

Add one shared UI preferences model used by settings, startup, and CodeMirror.

Frontend shape:

```ts
export type UiPreferences = {
  ui: {
    theme: 'tairiki-light' | 'tairiki-dark' | 'system' | 'macos-light' | 'macos-dark'
    fontFamily: string
    fontSize: number
  }
  editor: {
    fontFamily: string
    fontSize: number
    lineHeight: number
  }
}
```

Defaults:

```ts
export const defaultUiPreferences: UiPreferences = {
  ui: {
    theme: 'tairiki-light',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
    fontSize: 13,
  },
  editor: {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.5,
  },
}
```

Implementation notes:

- Keep default values in one file, likely `src/features/settings/preferences.ts` or `src/store/preferences.ts`.
- Validate font sizes with safe ranges.
- UI font size range: 11-16 px.
- Editor font size range: 11-18 px.
- Editor line height range: 1.25-1.8.
- Bad stored values fall back to defaults, but do not delete the prefs file automatically.

Acceptance:

- The app has one default preference source.
- Settings and startup use the same defaults.

---

## 7.4 Persist Preferences In Tauri

Backend target: write preferences to `$APP_DATA_DIR/prefs.json`.

Commands:

```rust
#[tauri::command]
pub async fn get_ui_preferences(state: State<'_, AppState>) -> Result<UiPreferences, String>

#[tauri::command]
pub async fn set_ui_preferences(preferences: UiPreferences, state: State<'_, AppState>) -> Result<(), String>
```

If the current app already has a generic `set_ui_pref(key, value)`, keep it only if it is working and typed enough. Prefer a typed command for this phase because font preferences should be validated.

Persistence rules:

- Create `prefs.json` if missing.
- Preserve unrelated keys.
- Write atomically: write temp file, then rename.
- Return defaults if file is missing.
- Return defaults plus a logged warning if file is malformed.

Acceptance:

- Theme and font preferences survive app restart.
- Invalid JSON does not prevent app boot.

---

## 7.5 Apply Preferences Before First Paint

File: `index.html` and startup bootstrap code.

Requirement:

- Apply theme and font CSS variables before React renders.
- Avoid visible font flash or theme flash.

Plan:

- Add an inline bootstrap script that reads a small cached preference snapshot from `localStorage`.
- Apply `data-theme` or theme class to `<html>`.
- Apply CSS variables for fonts and sizes:

```js
document.documentElement.style.setProperty('--font-ui', prefs.ui.fontFamily)
document.documentElement.style.setProperty('--font-ui-size', `${prefs.ui.fontSize}px`)
document.documentElement.style.setProperty('--font-editor', prefs.editor.fontFamily)
document.documentElement.style.setProperty('--font-editor-size', `${prefs.editor.fontSize}px`)
document.documentElement.style.setProperty('--font-editor-line-height', String(prefs.editor.lineHeight))
```

Then, after React starts:

- Load canonical prefs from Tauri.
- Apply them again.
- Update the local bootstrap cache.

Acceptance:

- Reloading the app does not flash default theme or default fonts.
- If local cache is stale, canonical Tauri prefs win after startup.

---

## 7.6 Build Appearance Settings

File: `src/features/settings/AppearanceSettings.tsx`

Replace a simple theme picker with a crafted settings panel.

Sections:

- Theme
- Interface font
- Editor font
- Preview
- Reset

Controls:

- Segmented control for theme.
- Font family input for UI font.
- Font family input for editor font.
- Optional quick-pick list for common fonts:
  - System UI
  - SF Pro
  - Helvetica Neue
  - SF Mono
  - Menlo
  - Monaco
- Number stepper or slider for UI font size.
- Number stepper or slider for editor font size.
- Number stepper or segmented density control for editor line height.
- Reset button.

Preview panel:

```text
Sidebar Row        public.users
Query Editor       select * from public.users where id = 42;
Grid Cell          2026-04-29 10:42:13
Badge              varchar
```

Interaction rules:

- Changes apply live.
- Save is not required.
- Reset asks for confirmation only if there are custom values.
- Inputs show invalid state for empty font stacks or out-of-range sizes.
- Invalid values are not persisted.

Acceptance:

- A user can customize UI and editor fonts without editing files.
- CodeMirror updates when editor font settings change.

---

## 7.7 Update CodeMirror Theme

Files:

- `src/features/query-editor/SqlEditor.tsx`
- `src/features/query-editor/tairikiTheme.ts`

Requirements:

- Replace hardcoded editor font size and family with CSS variables.
- Use the active theme tokens for gutter, active line, selection, cursor, diagnostics, and autocomplete.
- Make autocomplete popup look like the rest of the app.

CodeMirror CSS target:

```ts
EditorView.theme({
  '&': {
    fontFamily: 'var(--font-editor)',
    fontSize: 'var(--font-editor-size)',
    lineHeight: 'var(--font-editor-line-height)',
    backgroundColor: 'var(--surface-base)',
    color: 'var(--color-text-primary)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--surface-base)',
    color: 'var(--color-text-tertiary)',
    borderRight: '1px solid var(--border-subtle)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--surface-hover)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 24%, transparent) !important',
  },
})
```

Acceptance:

- Editor font settings affect CodeMirror immediately.
- Autocomplete and diagnostics no longer look like default browser widgets.

---

## 7.8 Polish App Shell

Files:

- `src/components/AppShell.tsx`
- `src/components/TabBar.tsx`
- `src/styles/index.css`

Add:

- Layered titlebar/toolbar surface.
- Consistent toolbar height.
- Tab states: active, hover, dirty, loading, error.
- Better tab truncation.
- Empty work-area state.
- Status bar.
- Splitter affordance for sidebar resize.

Tab details:

- Active tab has a quiet raised surface and accent hairline.
- Dirty query tabs show a small dot.
- Loading table/query tabs show a tiny spinner or pulsing mark.
- Error tabs show danger accent only when the tab is not active; active tab shows error in content.
- Close buttons appear on hover or when focused.

Status bar details:

- Left: active connection and database.
- Center: background work, if any.
- Right: last query duration, row count, or license state.

Acceptance:

- The shell looks intentionally layered.
- Users can tell tab state without opening each tab.

---

## 7.9 Polish Sidebar

Files:

- `src/components/Sidebar.tsx`
- `src/components/SidebarSection.tsx`
- `src/features/connections/ConnectionList.tsx`
- `src/features/schema/SchemaTree.tsx`
- `src/features/query-editor/SavedQueriesSection.tsx`

Add:

- Empty connection state with primary CTA.
- Connection row hover actions: connect, edit, more.
- Row focus-visible state.
- Loading skeleton rows for schema expansion.
- Inline error row when schema load fails.
- Object-specific icon and accent color.
- Compact metadata lines where useful: host, database, row count if known.
- Context menus for connection, schema object, saved query.

Sidebar row contract:

```ts
type SidebarRowState =
  | 'idle'
  | 'hover'
  | 'selected'
  | 'focused'
  | 'loading'
  | 'error'
  | 'disabled'
```

Acceptance:

- The sidebar remains readable at high density.
- Every row can be used with mouse and keyboard.
- Empty and error states lead to a next action.

---

## 7.10 Polish Command Palette

File: `src/components/CommandPalette.tsx`

Add:

- Group headers.
- Result subtitle.
- Shortcut hint.
- Recent/default commands when query is empty.
- No-results action suggestions.
- Loading state for async schema-backed results.
- Keyboard focus ring that matches the rest of the app.

Result shape:

```ts
type CommandResult = {
  id: string
  group: 'Connections' | 'Schema' | 'Queries' | 'Commands' | 'Settings'
  icon: React.ReactNode
  title: string
  subtitle?: string
  shortcut?: string
  action: () => void
}
```

Acceptance:

- `Cmd+K` can open settings, new query, saved queries, tables, and connections.
- Empty and no-results states are useful.

---

## 7.11 Polish Table Viewer

File: `src/features/table-viewer/TableViewerTab.tsx`

Add:

- Skeleton grid while loading.
- Distinct empty states for empty table and empty filtered result.
- Column header layout with type badge, sort state, filter state, key/nullable hints.
- Cell selection state.
- Cell context menu: copy value, copy row JSON, copy row CSV, copy column name.
- Better value rendering:
  - `NULL` pill
  - empty string pill
  - boolean badge
  - JSON monospace preview
  - date/time aligned text
  - numbers with tabular figures
  - long text truncation with expand/copy affordance
- Footer with row range, total count if known, page controls, execution/load time.

Acceptance:

- Users can understand loading, no rows, and filtered-out rows.
- Copy flows are discoverable by context menu and keyboard shortcut.

---

## 7.12 Polish Query Editor

Files:

- `src/features/query-editor/QueryEditorTab.tsx`
- `src/features/query-editor/SqlEditor.tsx`

Add:

- Toolbar with connection badge, run button, save state, query duration.
- Run states: idle, pending, success, error.
- Resizable editor/results split with persisted height.
- Error summary panel above results.
- Empty results state before first run.
- Multiple result-set separators.
- Saved query dirty indicator.
- Keyboard shortcut hints.

Acceptance:

- Running SQL feels responsive even before results arrive.
- Errors are visible in both editor context and result context.

---

## 7.13 Add Menus And Micro-Interactions

Add context menus where they add real value:

- Connection row: connect, disconnect, edit, duplicate, delete.
- Schema table: open table, new query from table, copy qualified name.
- Grid cell: copy value, copy row, inspect value.
- Tab: close, close others, close to right, copy title.
- Saved query: open, rename, duplicate, delete.

Motion rules:

- Use `--motion-fast` for hover.
- Use `--motion-base` for disclosure and popovers.
- Respect `prefers-reduced-motion`.
- Avoid big sliding panels unless they make spatial sense.

Acceptance:

- Menus are styled and keyboard-accessible.
- Motion is noticeable only because it makes state changes easier to follow.

---

## 7.14 Verification

Run:

```bash
npm run type-check
npm run lint
```

Manual checks:

- Fresh app with no connections.
- Light theme.
- Dark theme.
- Custom UI font.
- Custom editor font.
- Invalid font stack then reset.
- Sidebar keyboard navigation.
- Command palette search and no-results state.
- Table loading, empty, filtered empty, and populated states.
- Query success and query error states.
- Reduced motion enabled at OS/browser level.

Regression checks:

- Existing connection flows still work.
- Existing schema browsing still works.
- Existing table viewer queries still work.
- Existing SQL execution still works.
- Existing license settings remain reachable.

---

## Suggested Commit Slices

1. Expand tokens and add shared preferences model.
2. Persist and bootstrap theme/font preferences.
3. Build Appearance settings with font controls and preview.
4. Update CodeMirror theme to use editor font tokens.
5. Polish app shell, tabs, and status bar.
6. Polish sidebar states and context menus.
7. Polish command palette.
8. Polish table viewer states and cell rendering.
9. Polish query editor states and result panel.
10. Final accessibility, reduced-motion, lint, and type-check pass.
