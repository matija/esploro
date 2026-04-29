# Esploro — Product Requirements Document

## Overview

Esploro is a native macOS database client built with Tauri. It targets developers and data engineers who want a fast, keyboard-friendly, visually cohesive tool to explore and query PostgreSQL databases — without the weight of Electron-based alternatives.

The name means *I explore* in Italian. The product is open source, free for personal use, and requires a commercial license for business use.

---

## Goals

- Deliver a macOS-native experience that respects platform conventions (vibrancy, system colors, SF Pro, native traffic lights, sidebar patterns).
- Be fast: sub-50 ms connection latency, instant schema tree rendering, virtualized table grids for large result sets.
- Cover the daily workflow: connect → browse schemas → inspect tables → filter data → run SQL.
- Provide a licensing model that funds development without alienating individual users.

## Non-Goals (v1)

- Support for databases other than PostgreSQL (MySQL, SQLite, etc.) — designed for future addition, not shipped in v1.
- SSH tunnel support — post-v1.
- Data editing (INSERT/UPDATE/DELETE via grid) — query editor handles mutations; grid is read-only in v1.
- Team/collaboration features.
- Windows or Linux builds — macOS-first; the architecture does not prevent cross-platform later.

---

## User Personas

**Solo Developer** — runs Postgres locally or on a small VPS. Wants to inspect tables while building features. Personal use; free tier.

**Freelance Consultant** — connects to client databases during engagements. Uses Esploro professionally; requires commercial license.

**Data Analyst** — runs ad-hoc SQL queries daily, exports results. May work for a company; commercial license applies.

---

## Core Features — MVP

### 1. Connection Management

- Store named connection profiles (display name, host, port, database, user, password, SSL mode).
- Passwords stored in macOS Keychain via the system `keyring` crate.
- Support local connections via Unix socket path (e.g., `/var/run/postgresql`).
- Test-connection button before saving.
- Connections sidebar grouped by user-defined folders (optional).
- Quick-connect from URL string (`postgres://user:pass@host:5432/db`).

### 2. Schema Browser

- Tree: Connection → Databases → Schemas → Tables / Views / Sequences / Functions.
- Lazy-load each tree level on expansion (no full upfront fetch).
- Table node shows column list inline on expand: name, type, nullable, default, PK/FK indicator.
- Search/filter box to narrow the tree (fuzzy, case-insensitive).
- Right-click context menu: Copy table name, Copy qualified name, Open table viewer, Open in query editor (prefills `SELECT * FROM ...`).

### 3. Table Viewer

- Grid view for a selected table: paginated, 200 rows per page.
- Column headers show data type as a badge.
- Column-level filter bar: per-column text input with operator selector (=, !=, LIKE, IS NULL, IS NOT NULL, >, <, >=, <=).
- Active filters shown as removable chips above the grid.
- Sort by clicking column header (cycle: asc → desc → none).
- Copy cell value or copy row as JSON / CSV.
- Row count shown in footer ("Showing 1–200 of 14 382 rows").
- Null values rendered distinctly (e.g., grayed-out `NULL` pill).

### 4. SQL Query Editor

- Full-screen tab per query, multiple tabs supported.
- CodeMirror 6 editor with:
  - SQL syntax highlighting.
  - Auto-complete for schema-aware table/column names.
  - Keyboard shortcut to run (⌘↵).
- Result panel below the editor (same virtualized grid as table viewer).
- Multiple result sets shown when query returns more than one.
- Query execution time displayed.
- Error messages shown inline with line/column reference.
- Save query to local library (name + folder); browse saved queries from sidebar.

### 5. macOS-Native UI

- Sidebar + detail split view using `NSVisualEffectView`-style sidebar vibrancy (Tauri window config).
- System font (SF Pro) throughout.
- Traffic light buttons in the standard position.
- Standard macOS toolbar above the detail area.
- Keyboard-navigable sidebar (arrow keys, Enter to open).
- ⌘K command palette: fuzzy search connections, tables, saved queries.
- All colors sourced exclusively from CSS design tokens — no hardcoded values anywhere in components.

### 6. Theme System

Users can switch the application theme without restarting. The active theme is persisted in the UI prefs JSON file and applied before first paint (no flash of unstyled content).

**Theme picker:** A dropdown or segmented control inside Settings (⌘,), under an "Appearance" section. No separate page required; the change applies live as the user selects.

#### Built-in themes

| Name | Description |
|---|---|
| **Tairiki Light** _(default)_ | Light theme derived from the [tairiki.nvim](https://github.com/deparr/tairiki.nvim) color scheme; described in full below |
| **Tairiki Dark** | Dark companion theme derived from tairiki.nvim; described in full below |
| **macOS Dark** | Follows `NSColor` semantic tokens and `prefers-color-scheme: dark`; vibrancy-native |
| **macOS Light** | Follows `NSColor` semantic tokens and `prefers-color-scheme: light`; vibrancy-native |

Additional community themes may be shipped in later versions. The token contract defined here is the extension point.

#### Default theme: Tairiki Light

Tairiki Light is a clean, high-contrast light theme. The palette originates from tairiki.nvim's light variant: a pure white base with deep navy primary text and saturated, VSCode-lineage syntax colors. The overall character is crisp and professional — readable in daylight, familiar to developers who use light IDEs.

**Color palette**

| Token | Value | Source | Usage |
|---|---|---|---|
| `--color-bg-base` | `#ffffff` | `bg` | Main content area background |
| `--color-bg-sidebar` | `#f0f0f8` | `bg_light` | Sidebar, left panel |
| `--color-bg-elevated` | `#f0f0f8` | `bg_light` | Modals, popovers, dropdowns |
| `--color-bg-subtle` | `#e8e8e0` | `bg_light2` | Alternating row tint, hover states |
| `--color-bg-active` | `#d8d8d0` | `bg_light3` | Selected sidebar item, focused row |
| `--color-border` | `#d0d0c8` | between `bg_light2`/`bg_light3` | Dividers, panel borders |
| `--color-border-strong` | `#b0b0a8` | — | Input outlines on focus |
| `--color-text-primary` | `#001070` | `fg` | Primary labels, table cell values |
| `--color-text-secondary` | `#797979` | `fg_dark2` | Metadata, column types, row counts |
| `--color-text-tertiary` | `#595959` | `fg_dark3` | Placeholders, disabled labels |
| `--color-text-inverse` | `#ffffff` | — | Text on accent-colored backgrounds |
| `--color-accent` | `#0070c1` | `blue` | Primary buttons, focused rings, active indicators |
| `--color-accent-hover` | `#005a9e` | darkened `blue` | Hover state for accent elements |
| `--color-accent-subtle` | `#dceeff` | — | Accent tint background (badges, chips) |
| `--color-success` | `#008000` | `green` | Connected indicator, success toasts |
| `--color-warning` | `#7c5c20` | `yellow` | Commercial-use banner |
| `--color-danger` | `#a31515` | `red` | Error states, destructive actions |
| `--color-null` | `#797979` | `fg_dark2` | NULL pill text |
| `--color-null-bg` | `#e8e8e0` | `bg_light2` | NULL pill background |

**Syntax colors (CodeMirror editor — Tairiki Light)**

| Role | Value | Source |
|---|---|---|
| Keywords | `#7929c8` | `purple` |
| Functions | `#0070c1` | `blue` |
| Strings | `#008000` | `green` |
| Types | `#7c5c20` | `yellow` |
| Constants | `#df5926` | `orange` |
| Operators / modifiers | `#693988` | `light_purple` |
| Special / tags | `#a31515` | `red` |
| Comments | `#cd0009` | `comment` |

#### Dark theme: Tairiki Dark

Tairiki Dark is derived from tairiki.nvim's dark variant: a near-black base with muted, earthy accent colors in the Tomorrow Night tradition — blue, purple, green, orange. The mood is calm and focused; nothing fights for attention.

**Color palette**

| Token | Value | Source | Usage |
|---|---|---|---|
| `--color-bg-base` | `#151515` | `bg` | Main content area background |
| `--color-bg-sidebar` | `#111111` | darker than `bg` | Sidebar, left panel |
| `--color-bg-elevated` | `#1d1f21` | `bg_light` | Modals, popovers, dropdowns |
| `--color-bg-subtle` | `#191b1d` | blend `bg`/`bg_light` | Alternating row tint, hover states |
| `--color-bg-active` | `#282828` | `bg_light2` | Selected sidebar item, focused row |
| `--color-border` | `#222222` | — | Dividers, panel borders |
| `--color-border-strong` | `#3b3f4c` | `bg_light3` | Input outlines on focus |
| `--color-text-primary` | `#c5c8c6` | `fg` | Primary labels, table cell values |
| `--color-text-secondary` | `#969896` | `fg_dark2` | Metadata, column types, row counts |
| `--color-text-tertiary` | `#696969` | `fg_dark3` | Placeholders, disabled labels |
| `--color-text-inverse` | `#111111` | — | Text on accent-colored backgrounds |
| `--color-accent` | `#81a2be` | `blue` | Primary buttons, focused rings, active indicators |
| `--color-accent-hover` | `#99b8d0` | lightened `blue` | Hover state for accent elements |
| `--color-accent-subtle` | `#1e2a35` | blend `blue`/`bg` | Accent tint background (badges, chips) |
| `--color-success` | `#b5bd68` | `green` | Connected indicator, success toasts |
| `--color-warning` | `#f0c674` | `yellow` | Commercial-use banner |
| `--color-danger` | `#cc6666` | `red` | Error states, destructive actions |
| `--color-null` | `#696969` | `fg_dark3` | NULL pill text |
| `--color-null-bg` | `#1d1f21` | `bg_light` | NULL pill background |

**Syntax colors (CodeMirror editor — Tairiki Dark)**

| Role | Value | Source |
|---|---|---|
| Keywords | `#b294bb` | `purple` |
| Functions | `#81a2be` | `blue` |
| Strings | `#b5bd68` | `green` |
| Types | `#f0c674` | `yellow` |
| Constants | `#de935f` | `orange` |
| Operators / modifiers | `#c397d8` | `light_purple` |
| Special / tags | `#cc6666` | `red` |
| Comments | `#a89984` | `comment` |

#### Shared visual design (all themes)

**Typography**

Design goal: every typographic decision should be indistinguishable from a native AppKit application. Sizes, weights, tracking, and rendering all mirror what macOS uses at equivalent information density. Postico and Xcode's sidebar are the reference points.

_Font stacks_

| Role | CSS value |
|---|---|
| UI text | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif` |
| Monospace | `ui-monospace, "SF Mono", Menlo, Monaco, "Courier New", monospace` |

`-apple-system` automatically selects SF Pro Text (≤19 px) or SF Pro Display (≥20 px) and handles optical sizing. Never load a web font for UI text.

_Font rendering_

Apply globally on `<html>` or `<body>`:

```css
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
```

This matches Retina rendering in native apps. Never use `subpixel-antialiased` — it looks wrong on modern macOS.

_Type scale_

Each row maps directly to an `NSFont.systemFont(ofSize:weight:)` call at the equivalent pt size (1 pt = 1 px at logical resolution).

| Token | Size | Line height | Weight | Usage |
|---|---|---|---|---|
| `--text-caption2` | 10 px | 12 px | 400 | Keyboard shortcut badges, overflow indicators |
| `--text-caption` | 11 px | 13 px | 400 | Column type badges, status-bar details, group header labels |
| `--text-footnote` | 12 px | 16 px | 400 | Secondary metadata: row counts, connection host, timestamps |
| `--text-body` | 13 px | 18 px | 400 | Body default: sidebar labels, table cell values, input text |
| `--text-subheadline` | 13 px | 18 px | 500 | Interactive labels, button text, tab labels, active sidebar items |
| `--text-headline` | 15 px | 20 px | 600 | Panel section headers, column headers in the data grid |
| `--text-title3` | 17 px | 22 px | 400 | Modal titles |
| `--text-title2` | 20 px | 24 px | 600 | Empty-state primary headings |

_Weights_

| Name | Value | Equivalent |
|---|---|---|
| Regular | 400 | `NSFont.Weight.regular` |
| Medium | 500 | `NSFont.Weight.medium` |
| Semibold | 600 | `NSFont.Weight.semibold` |

700 (bold) is never used in the UI — it has no macOS equivalent in the SF Pro system-font weight range that AppKit exposes.

_Letter spacing_

SF Pro embeds its own optical tracking. Do not add `letter-spacing` to body text or it will look over-spaced. The only exceptions:

- **Uppercase sidebar group headers** (e.g., "CONNECTIONS"): `letter-spacing: 0.06em` — mirrors Finder and Mail sidebar group rows.
- **ALL-CAPS column type badges**: `letter-spacing: 0.04em`.
- No `letter-spacing` on any other element.

_Tabular numbers in data grids_

All table cell values, row counts, and pagination numbers must use tabular lining figures so numeric columns align:

```css
font-variant-numeric: tabular-nums;
font-feature-settings: "tnum" 1;
```

Apply only to `.data-grid-cell` and numeric footer text; not globally (proportional figures look better in prose labels and sidebar items).

_Sidebar typography_ (mirrors Finder / Xcode source navigator)

| Element | Size | Weight | Transform | Tracking |
|---|---|---|---|---|
| Group header row label | 11 px | 500 | uppercase | 0.06 em |
| Connection / folder row label | 13 px | 400 | none | none |
| Active connection row label | 13 px | 500 | none | none |
| Tree leaf node (table, view, function) | 13 px | 400 | none | none |

_Query editor_

- Font stack: `ui-monospace, "SF Mono", Menlo, Monaco, "Courier New", monospace`.
- Base size: 13 px.
- Line height: 1.5 (19.5 px) — matches Xcode's default editor line height.
- Tab size: 2 spaces.

_Inline monospace_ (JSON cell values, connection URL inputs, SQL snippets outside the editor)

- Same monospace stack.
- Size: 12 px (one step smaller than the editor to distinguish from editor context at a glance).
- Always apply `font-variant-numeric: tabular-nums`.

_CSS tokens_

All type-scale values live in `src/styles/tokens.css` alongside color tokens. Components reference these; they never hardcode sizes.

```css
:root {
  --text-caption2:    10px;
  --text-caption:     11px;
  --text-footnote:    12px;
  --text-body:        13px;
  --text-headline:    15px;
  --text-title3:      17px;
  --text-title2:      20px;

  --leading-caption:  12px;
  --leading-footnote: 16px;
  --leading-body:     18px;
  --leading-headline: 20px;
  --leading-title3:   22px;

  --weight-regular:   400;
  --weight-medium:    500;
  --weight-semibold:  600;
}
```

_Prohibited_

- Loading any web font for UI text.
- `font-size` values in `rem` or `em` for the type scale — use `px` only (the root `font-size` must never be overridden).
- `font-weight: bold` (700) anywhere in the UI.
- `letter-spacing` on body, label, or cell text.
- `text-transform: uppercase` except on sidebar group header labels.

**Component appearances**

- **Border radius:** 6 px for inputs and small controls; 8 px for cards and popovers; 10 px for modals; 4 px for inline badges/chips.
- **Sidebar items:** 32 px tall, 8 px horizontal padding, left icon (16 px), label at 13 px/500 weight. Active item uses `--color-bg-active` background + `--color-accent` left border (2 px). Hover uses `--color-bg-subtle`.
- **Connection status dot:** 8 px circle; `--color-success` when connected, `--color-text-tertiary` when idle.
- **Folder rows:** Same height as connection rows; chevron rotates 90° on expand (150 ms ease-out).
- **Tab bar:** 36 px tall, sits directly below the macOS toolbar. Active tab: bottom border in `--color-accent` (2 px). Inactive tabs: `--color-text-secondary` label.
- **Buttons:** Primary — `--color-accent` fill, `--color-text-inverse` label, 6 px radius, 32 px height. Secondary — transparent fill, `--color-text-primary` label, `--color-border` outline. Danger — `--color-danger` fill.
- **Inputs:** `--color-bg-elevated` fill, `--color-border` outline at rest, `--color-border-strong` + `--color-accent` ring on focus (2 px ring, 2 px offset).
- **Data grid:** Header row — `--color-bg-subtle` background, `--color-text-secondary` labels, monospace type badge with `--color-accent-subtle` fill. Cell rows alternate between `--color-bg-base` and transparent. Selected row uses `--color-bg-active`. Null cells render a pill with `--color-null-bg`/`--color-null` colors.
- **Scrollbars:** Overlay style, 4 px wide, `--color-border-strong` thumb, disappear after inactivity.
- **Context menus and dropdowns:** `--color-bg-elevated` background, `--color-border` border, 8 px radius, 4 px padding. Focused item uses `--color-accent` background, `--color-text-inverse` label.
- **Toasts / notifications:** Appear at bottom-right, 320 px wide, 8 px radius, `--color-bg-elevated` background. Icon + colored left border (4 px) indicates severity.

**Spacing and layout**

- Sidebar width: 240 px (resizable 180–360 px), persisted per session.
- Content area padding: 16 px.
- Table viewer toolbar (filter bar, pagination footer): 40 px height.
- Query editor / result split: 50/50 default, draggable, persisted.

#### macOS Dark and macOS Light themes

These themes replace all `--color-*` tokens with macOS semantic equivalents (e.g., `--color-bg-base` → `NSColor.windowBackgroundColor`). Sidebar vibrancy (`NSVisualEffectView`) is enabled only in these two themes. They follow `prefers-color-scheme` automatically if the user has selected "Follow System" rather than pinning a specific macOS variant.

#### Technical implementation notes

- All tokens live in `src/styles/tokens.css`. Each theme is a CSS class on `<html>` (e.g., `theme-tairiki-light`, `theme-tairiki-dark`, `theme-macos-dark`, `theme-macos-light`). The default class (`theme-tairiki-light`) is applied synchronously in a `<script>` tag in `index.html` before React hydrates.
- Theme preference stored in `$APP_DATA_DIR/prefs.json` under `ui.theme`. Loaded by a Tauri command at startup and injected into the window as `window.__ESPLORO_THEME__` before the JS bundle runs.
- The Tauri command surface gains one new command: `set_ui_pref(key, value)` (generic, reused for other preferences).
- No runtime CSS-in-JS; all theming is static CSS custom properties.

---

## Tairiki Theme — Implementation Roadmap

The PRD defines the full Tairiki palette but the implementation has historically lagged behind. This section tracks what has been done and what remains.

### Completed

- **Token foundations** — `tokens.css` now holds the full Tairiki Light and Dark palette (22 tokens each: text, backgrounds, borders, accent, semantic, and syntax colors). All hardcoded generic alphas replaced with named Tairiki values (`#001070` navy primary, `#0070c1` accent, etc.).
- **Tailwind utilities** — `@theme inline` in `index.css` exposes all tokens as utility classes including `text-syntax-string`, `bg-subtle`, `text-success`, `bg-syntax-keyword/10`, etc.
- **Schema tree icon colors** — each node kind gets its Tairiki syntax color: database → accent blue, table → success green, view → keyword purple, function → enum orange, sequence → type amber.
- **Column type badges** — column header badges in the table viewer use the syntax palette: text types → green, numeric → blue, timestamps → amber, booleans → red, json → orange.
- **PK/FK/nullable badges** — `ColBadge` in the schema tree uses `bg-syntax-type/15 text-syntax-type` (PK) and `bg-syntax-number/15 text-syntax-number` (FK) instead of hardcoded `dark:` variants.
- **NULL pill** — monospace, tracking-wide, `text-tertiary bg-control`, no italic.
- **Alternating rows** — odd table rows get a `bg-subtle/30` tint.
- **Theme picker** — Light / Dark / System commands in the command palette; theme persisted in localStorage.

### Phase 2 — Connection list & sidebar polish

- Connection status dot: use `--ds-success` (green) when connected, `--ds-tertiary` when idle.
- Sidebar active item: `--ds-bg-active` background + 2 px `--ds-accent` left border (currently uses accent/10 ring only).
- Folder chevron transition: 150 ms ease-out (already partially done, audit and standardize).
- Tab bar active indicator: bottom border `--ds-accent` 2 px (verify against spec).

### Phase 3 — CodeMirror Tairiki theme

Replace the `oneDark` import in `SqlEditor.tsx` with a custom CodeMirror `HighlightStyle` + `EditorView.theme` that reads from the Tairiki palette:

| Role | Light | Dark |
|---|---|---|
| Keywords | `#7929c8` | `#b294bb` |
| Functions | `#0070c1` | `#81a2be` |
| Strings | `#008000` | `#b5bd68` |
| Types | `#7c5c20` | `#f0c674` |
| Constants | `#df5926` | `#de935f` |
| Operators | `#693988` | `#c397d8` |
| Comments | `#cd0009` | `#a89984` |

The theme object should be rebuilt reactively when the active theme changes (watch `data-theme` attribute on `<html>`).

### Phase 4 — Appearance settings UI

- Add an "Appearance" section to the settings tab (opened via License Settings tab for now, or add a dedicated Settings tab).
- Segmented control: **Tairiki Light** | **Tairiki Dark** | **System**.
- Persist via a Tauri command writing to `$APP_DATA_DIR/prefs.json` under `ui.theme`, not just `localStorage`.
- Apply chosen theme synchronously in `index.html` via `<script>` before React hydrates (no flash of unstyled content).

### Phase 5 — Extended token coverage

- **Enum type detection**: teach `getTypeFamily` to identify Postgres enums (backend should flag `oid_kind = 'e'` in `list_columns` response) and render them as `text-syntax-enum bg-syntax-enum/10`.
- **Context menus & dropdowns**: `bg-elevated` background (`--ds-sidebar-bg`), accent hover item with `text-inverse` label.
- **Toasts/notifications**: bottom-right, `--ds-bg-subtle` background, colored 4 px left border by severity.
- **Input focus ring**: `border-border-strong ring-2 ring-accent/30` on focus.
- **Scrollbar thumb**: `--ds-border-strong`, 4 px overlay style, fade after inactivity.

---

## Technical Architecture

### Stack

| Layer | Technology |
|---|---|
| Shell | Tauri 2.x |
| Frontend | React 19 + TypeScript |
| Styling | Tailwind CSS (custom macOS design token theme) |
| Components | Radix UI primitives (unstyled, styled to match HIG) |
| Editor | CodeMirror 6 |
| Grid | TanStack Virtual (row virtualization) + TanStack Table |
| State | Zustand (global) + React Query (server state / cache) |
| Icons | Lucide React (supplemented by inline SVG for SF Symbol lookalikes) |
| Backend | Tauri commands (Rust) |
| DB driver | `tokio-postgres` + `deadpool-postgres` (connection pool per connection profile) |
| Credentials | `keyring` crate → macOS Keychain |
| Config/State | JSON files in `$APP_DATA_DIR` (connections, saved queries, UI prefs) |
| License | Local license file + HMAC verification; optional online activation ping |

### Tauri Command Surface (Rust → Frontend)

```
connections:
  create_connection(profile) -> ConnectionId
  update_connection(id, profile)
  delete_connection(id)
  list_connections() -> Vec<ConnectionSummary>
  test_connection(profile) -> Result<(), String>
  connect(id) -> SessionId
  disconnect(session_id)

schema:
  list_databases(session_id) -> Vec<String>
  list_schemas(session_id, db) -> Vec<String>
  list_tables(session_id, db, schema) -> Vec<TableSummary>
  list_columns(session_id, db, schema, table) -> Vec<ColumnDef>
  list_views / list_functions / list_sequences (same pattern)

data:
  query_table(session_id, TableQuery { table, filters, sort, page, page_size }) -> QueryResult
  execute_sql(session_id, sql) -> Vec<QueryResult>

saved_queries:
  save_query(name, folder, sql) -> QueryId
  list_saved_queries() -> Vec<SavedQuerySummary>
  delete_saved_query(id)

license:
  get_license_status() -> LicenseStatus
  activate_license(key) -> Result<LicenseStatus, String>
```

### Data Flow

```
User action (React) → invoke() → Tauri command → Rust handler
  → tokio-postgres (async) → Postgres server
  → serialized result → React Query cache → UI re-render
```

---

## Design Principles

1. **macOS first, not macOS-skinned.** Use native window chrome, sidebar conventions, and keyboard shortcuts that macOS users expect. No fake OS widgets.
2. **Data never leaves the machine by default.** All database traffic goes through Rust directly to the server. No proxy, no cloud relay.
3. **Keyboard-complete.** Every primary action reachable without a mouse: ⌘K palette, ⌘T new tab, ⌘↵ run query, ⌘W close tab, arrow-key sidebar nav.
4. **Progressive disclosure.** Schema tree loads lazily. Filters appear on demand. Advanced connection options (SSL certs, client certs) are collapsed behind "Advanced."

---

## Licensing Model

Inspired by Yaak's approach: source-available, not fully open source.

| Tier | Use | Price |
|---|---|---|
| Personal | Non-commercial, individual developer | Free forever |
| Commercial | Used at a company / for client work / by a team | One-time or annual license (TBD) |

**Implementation:**
- License key = base64(JSON payload) + HMAC-SHA256 signature signed with a private key baked into the build.
- Frontend check at startup: read key file from `$APP_DATA_DIR/license.key`, verify signature, parse payload (tier, issued_at, expires_at optional, machine_id optional).
- Soft enforcement: commercial features are not gated in v1; a yellow banner appears after 14-day trial period if no valid commercial license and usage appears commercial (heuristic: >3 connections, or user dismisses "personal use?" dialog).
- Hard enforcement deferred: v1 uses honor-system + banner; v2 can add optional online seat check.
- License purchase: Stripe Checkout link in-app; fulfillment sends key via email.

---

## Success Metrics (v1)

- Cold-start to usable connection: < 2 seconds on M-series Mac.
- Schema tree renders 500 tables in < 100 ms.
- Table viewer handles 10 000 visible rows without frame drops (virtualization).
- Crash rate: < 0.1% of sessions.
- License conversion: ≥ 5% of active users convert to commercial within 90 days of release.
