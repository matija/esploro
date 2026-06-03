# Esploro Architecture

## Overview

Esploro is a native macOS database client built with Tauri 2 (Rust backend + React frontend). It connects to PostgreSQL and MySQL/MariaDB databases, provides a table browser, and a multi-statement SQL editor.

---

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| Backend | Rust, Tokio async runtime |
| PostgreSQL driver | tokio-postgres 0.7 + deadpool-postgres 0.12 |
| MySQL driver | mysql_async 0.34 (built-in pool) |
| Frontend | React 19 + TypeScript |
| State management | Zustand (ephemeral + localStorage persistence) |
| Data fetching | TanStack Query v5 |
| UI | Tailwind CSS + shadcn/ui |
| Virtualized grids | @tanstack/react-virtual |
| Build tool | Vite + tsc |

---

## Directory Structure

```
esploro/
├── src/                        # React frontend
│   ├── components/             # Shared UI components
│   ├── features/               # Feature modules
│   │   ├── connections/        # Connection management
│   │   ├── table-viewer/       # Table data browser
│   │   ├── query-editor/       # SQL editor + results
│   │   └── schema-browser/     # Object explorer
│   ├── store/                  # Zustand store
│   └── main.tsx                # React Query setup, entry point
└── src-tauri/
    ├── src/
    │   ├── lib.rs              # AppState, session map, command registration
    │   └── commands/
    │       ├── connections.rs  # Connect / disconnect / pool lifecycle
    │       ├── schema.rs       # DB introspection
    │       ├── data.rs         # Table queries + free-form SQL execution
    │       ├── saved_queries.rs
    │       └── license.rs
    └── tauri.conf.json
```

---

## Complexity Budget

Large files are treated as a maintenance risk, not just a style issue. Keep each
source file focused on one responsibility, and split it once a second clear
responsibility appears (for example, command dispatch vs. SQL construction vs.
row decoding).

Soft line-count targets:

- **Frontend feature components:** keep the exported tab/page component near 500
  lines or less; move data loading, grid rendering, editing, toolbar/filter
  state, and formatting helpers into local hooks or child components when they
  become independently named responsibilities.
- **Rust command files:** keep the exported command module near 700 lines or
  less; move SQL builders, type/value mapping, row decoding, and backend-specific
  execution helpers into private submodules.
- **Extracted units:** keep helper modules around 400 lines or less unless they
  are a narrow table of cases. If an extracted file starts mixing orchestration,
  SQL construction, and decoding, split it again by responsibility.

These are review guidelines, not a lint gate. Exceeding a target is acceptable
when the file still has one coherent job, but a new feature should not make an
already-large file larger without either extracting a named responsibility or
recording why the split would be premature.

---

## Request Lifecycle

```
User action (React)
  → invoke("command_name", payload)   [Tauri IPC, JSON serialization]
  → Rust command handler
      → Acquire pool connection from session map
      → Execute SQL via tokio-postgres / mysql_async
      → Collect all rows into Vec<Vec<Option<String>>>
      → Serialize to JSON
  → Return to frontend as Promise
  → TanStack Query caches result (30s stale time)
  → Virtualized grid renders visible rows only
```

---

## Session & Connection Pool Model

`AppState` holds a `Mutex<HashMap<session_id, SessionInfo>>` where each `SessionInfo` wraps an `Arc<Pool>` — either a `deadpool_postgres::Pool` or a `mysql_async::Pool`.

One pool per active session. Pools are created on `connect` (after verifying with `SELECT 1`), dropped on `disconnect`. Passwords are stored in the macOS Keychain via the `keyring` crate.

---

## Query Execution

### Table viewer (`query_table`)

1. Fetch column metadata from `information_schema.columns`
2. Fetch primary keys from `pg_index`
3. Build parameterized `WHERE` + `ORDER BY` clause from frontend filters
4. Run data query (`SELECT … LIMIT {page_size} OFFSET {page * page_size}`) and `COUNT(*)` concurrently via `tokio::join!`
5. All columns cast to text (`::text` for PG, `CAST … AS CHAR` for MySQL)
6. Return `Vec<Vec<Option<String>>>` wrapped in `TableQueryResult`

Default page size: 200. User-configurable up to 10,000.

### SQL editor (`execute_sql`)

1. Split input on `;`, execute each statement sequentially via `client.simple_query()`
2. Collect all rows into memory
3. Stop on first error, return error position and PG error code
4. Return `Vec<QueryResult>` — one entry per statement

---

## Frontend State

**Zustand** manages tabs, active sessions, connection profiles, schema tree expansion, and UI preferences. Only `sidebarWidth`, `theme`, `expandedNodes`, and `recentObjects` persist to localStorage.

**TanStack Query** keys table queries on `[sessionId, schema, table, filters, sort, page]` with a 30-second stale time and one retry.

**Virtualization**: both the table viewer and query editor results use `useVirtualizer` (overscan 10) — only visible rows are in the DOM regardless of result set size.

---

## Data Persistence

| Data | Storage |
|---|---|
| Connection profiles | `{appDataDir}/connections.json` |
| Passwords | macOS Keychain |
| Saved queries | `{appDataDir}/saved_queries.json` |
| UI preferences | Tauri app data + localStorage |

---

## Performance & Scaling Issues

### Critical

**1. All query results loaded into memory on the Rust side before IPC transfer.**
There is no streaming. `Vec<Vec<Option<String>>>` is built fully in the Rust handler, then JSON-serialized and transferred in one IPC call. For large queries (e.g. `SELECT *` with no filter on a fat table) this can exhaust memory and block the UI. The page size cap of 10,000 rows partially mitigates this, but one row of 100 wide-text columns is still a large blob.

**2. `COUNT(*)` is run on every page change.**
The table viewer fires a full `COUNT(*)` query alongside every paginated data fetch. On large tables (tens of millions of rows) without an index on the filter column, this blocks a connection and can take seconds. There's no caching of the count across pages, and no way to skip it.

**3. `execute_sql` uses `simple_query` (text protocol), not the extended/binary protocol.**
`simple_query` sends everything as text and disables server-side prepared statements. For repeated queries this is slower and means the backend can't cache query plans. Fine for an ad-hoc editor, but worth knowing.

**4. Pool size is not configured — defaults vary and are invisible to the user.**
`deadpool-postgres` defaults to 16 connections. `mysql_async` defaults are undocumented (~5–10). For a desktop client this is almost always too many for the server's `max_connections` limit, especially if the user connects to the same host multiple times. There is no way to tune this in settings.

### Moderate

**5. All columns are cast to strings (`::text` / `CAST AS CHAR`).**
This loses type information before it reaches the frontend. The frontend has no way to distinguish `integer 0` from `string "0"`, which breaks correct NULL vs empty string rendering, numeric sorting, and future cell-editing. Re-parsing the string back to a type on the frontend is fragile (especially for dates, intervals, JSON, arrays).

**6. Schema introspection queries run on every expand, with no in-process cache.**
`list_objects` and `list_columns` hit `information_schema` tables on every tree node open. `information_schema` views are notoriously slow on large databases (thousands of tables). TanStack Query's 30-second cache helps within a session, but there is no persistent or configurable cache.

**7. `OFFSET`-based pagination degrades on large tables.**
`LIMIT n OFFSET m` forces the database to scan and discard the first `m` rows. At page 500 with page size 200 this is `OFFSET 100000` — a full sequential scan up to that point even with an index. Keyset pagination (WHERE id > last_seen_id) would be faster for deep pages, but is harder to implement generically.

**8. Saved query file I/O is synchronous.**
`saved_queries.rs` reads and writes `saved_queries.json` with blocking (non-async) file I/O inside async Tauri command handlers. On a slow disk or a large file this blocks the Tokio thread.

### Minor

**9. React Query stale time of 30 seconds can show stale table data.**
If another session or external tool modifies the table, the user may see old data for up to 30 seconds without manually refreshing.

**10. `expandedNodes` and `recentObjects` accumulate in localStorage without pruning.**
These grow unbounded as the user browses more objects. No eviction policy.

---

## What Works Well

- Virtualized grids: DOM size stays constant regardless of result set size.
- `tokio::join!` for concurrent metadata + data fetch on table open.
- Keychain-backed password storage — no plaintext credentials on disk.
- Session-scoped pools that are properly dropped on disconnect.
- SQL error positions surfaced from PG wire protocol.
- Multi-statement execution with per-statement timing.
