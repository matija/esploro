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
- macOS semantic colors (label, secondary label, separator, control background, etc.) via CSS variables backed by `@media (prefers-color-scheme)`.
- Traffic light buttons in the standard position.
- Standard macOS toolbar above the detail area.
- Keyboard-navigable sidebar (arrow keys, Enter to open).
- ⌘K command palette: fuzzy search connections, tables, saved queries.

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
