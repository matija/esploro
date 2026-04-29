# Phase 07.1 UI State Audit

This checklist records the current state coverage before expanding tokens or changing component visuals. It is intentionally limited to the surfaces named in `plans/07-ui-craft.md`.

## App Shell (`src/components/AppShell.tsx`)

- Empty: Welcome view exists, but it is shortcut-oriented instead of guiding first connection/query actions.
- Loading: No shell-level background work or pending state.
- Error: No shell-level error/status surface.
- Hover/pressed/focus: Delegated to child controls; no toolbar or status bar controls yet.
- Selected: Active tab controls main content.
- Disabled/success/context menu: Not represented.
- Gap: No status bar, layered toolbar, or active connection/database summary.

## Sidebar (`src/components/Sidebar.tsx`)

- Empty: Connection list renders a minimal "No connections yet" message; no primary CTA or paste URL shortcut.
- Loading: Profile load logs errors only; no loading or retry state.
- Error: Profile load errors are console-only.
- Hover/pressed/focus: Add button and resize handle have hover/active basics; resize handle has no focus affordance.
- Selected: Selection lives in connection/schema children.
- Disabled/success/context menu: Not represented at sidebar shell level.
- Gap: Resize affordance is invisible until dragging, and connection loading/errors do not surface in the UI.

## Sidebar Sections (`src/components/SidebarSection.tsx`)

- Empty/loading/error/selected/disabled/success/context menu: Not represented.
- Hover: Section header changes text color.
- Pressed: No pressed state beyond browser default.
- Focus: Relies on global `:focus-visible`; no section-specific focus treatment.
- Gap: Disclosure animation is present, but open/closed content has no reveal state or reduced-motion handling.

## Tabs (`src/components/TabBar.tsx`)

- Empty: No tab-empty state needed while welcome tab exists.
- Loading/error/dirty/success/context menu: Not represented.
- Hover/selected: Active and hover states exist.
- Pressed/focus/disabled: No explicit pressed, keyboard focus, or disabled states.
- Gap: Close button is intended to appear on hover via `group-hover`, but the tab root does not have `group`, so inactive close buttons stay hidden unless the tab is active.

## Command Palette (`src/components/CommandPalette.tsx`)

- Empty: Empty query shows all commands; no curated defaults/recent commands.
- Loading: No async loading state for schema-backed results.
- Error: Connection command failures are console-only.
- Hover/selected/focus: Hover and keyboard-selected states exist; input gets focus on open.
- Pressed/disabled/success: Not represented.
- Context menu: Not applicable.
- Gap: Results have a single trailing group label, not grouped headers, subtitles, or shortcut hints.

## Connection List (`src/features/connections/ConnectionList.tsx`)

- Empty: Minimal text only; no CTA.
- Loading: Per-connection connect pending disables the connect button; no spinner or row pending affordance.
- Error: Connect/disconnect/delete failures are console-only.
- Hover/selected/focus: Row hover, active connection, and keyboard-focused row exist.
- Pressed: No explicit row/button pressed state.
- Disabled: Connect button uses disabled opacity while connecting.
- Success: Active connection dot communicates connected state.
- Context menu: Not represented.
- Gap: Rows show only display name; host/database metadata and richer hover actions are missing.

## Schema Tree (`src/features/schema/SchemaTree.tsx`)

- Empty: Search no-results exists; empty databases/schemas/groups are mostly skipped silently.
- Loading: Loading rows exist but are text-only, not skeletons.
- Error: Error row renderer exists, but query error states are not added to the flat item list.
- Hover/selected/focus: Hover and keyboard focus states exist.
- Pressed/disabled/success: Not represented.
- Context menu: Present for tables/views/columns.
- Gap: Context menu styling is basic and not keyboard-navigable; loading/error states need to be wired consistently from React Query errors.

## Table Viewer (`src/features/table-viewer/TableViewerTab.tsx`)

- Empty: Distinguishes no rows vs filtered-out rows.
- Loading: Centered spinner exists; no grid-shaped skeleton.
- Error: Centered error text exists with no retry or next action.
- Hover/selected/focus: Header/row hover and selected cell exist; no keyboard cell focus model.
- Pressed: Not represented.
- Disabled: Pagination buttons disable.
- Success: Execution time in footer after load.
- Context menu: Row-level JSON/CSV copy exists; cell-level copy/value/column actions are missing.
- Gap: Value rendering only distinguishes `NULL`; booleans, empty strings, JSON, dates, numbers, and long text still share one rendering path.

## Query Editor (`src/features/query-editor/QueryEditorTab.tsx`)

- Empty: Before first run, the result area is absent rather than an empty results state.
- Loading: Run button shows a spinner while executing.
- Error: Result section and bottom banner can show errors.
- Hover/selected/focus: Toolbar buttons have hover; result grid cell selection exists.
- Pressed/disabled: Run button disables while pending or disconnected; pressed states are minimal.
- Success: Duration badge appears after results.
- Context menu: Result grid has no context menu.
- Gap: Result split height is local state only, and saved-query dirty state is not surfaced.

## SQL Editor (`src/features/query-editor/SqlEditor.tsx`)

- Empty: Empty editor is a blank CodeMirror surface.
- Loading/success/context menu: Not represented.
- Error: Diagnostics are set when PostgreSQL position is available.
- Hover/pressed/selected/focus: Mostly handled by CodeMirror defaults and theme extension.
- Disabled: Not represented.
- Gap: Font family/size are hardcoded to `var(--font-mono)` and `13px`, so editor font preferences cannot apply yet.

## Appearance Settings (`src/features/settings/AppearanceSettings.tsx`)

- Empty/loading/error/success/context menu: Not represented.
- Hover/selected: Theme segmented control has hover and selected states.
- Pressed/focus/disabled: No explicit pressed, focus-visible, or disabled states.
- Gap: Only theme can be changed; UI/editor font family, size, line height, preview, validation, and reset controls are absent.

## Tokens And Global CSS (`src/styles/tokens.css`, `src/styles/index.css`)

- Current coverage: Tairiki light/dark color and syntax tokens exist, mapped into Tailwind theme colors.
- Missing token groups: `surface-*`, `border-*`, `font-editor`, font sizes, editor line height, motion durations/easings, radius tokens, and shadow tokens.
- Gap: Global CSS sets `--font-ui` and `--font-mono` in Tailwind config rather than the PRD's runtime preference variables.

## Recommended Next Task

Proceed with Phase 7.2, "Expand Design Tokens", before component polish. Later UI work should use the new token contract instead of adding more component-local hardcoded colors, radii, shadows, motion, or font values.
