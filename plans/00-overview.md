# Plans Overview

Six phases, each independently shippable and reviewable. Each phase ends with a working, runnable binary.

| Phase | Name | Outcome |
|---|---|---|
| 01 | Scaffold | Tauri app boots; macOS shell (window chrome, sidebar layout, tabs) works |
| 02 | Connection Management | Create/edit/delete/test Postgres connection profiles; passwords in Keychain |
| 03 | Schema Browser | Lazy tree: databases → schemas → tables/views/columns; search |
| 04 | Table Viewer | Paginated grid; per-column filters; sort; copy |
| 05 | SQL Query Editor | CodeMirror editor; run query; result grid; saved queries |
| 06 | Licensing | License file verification; personal/commercial banner; activation flow |

## Cross-cutting conventions

**Tauri commands** live in `src-tauri/src/commands/` — one file per domain (connections, schema, data, license). Each command is `async` and returns `Result<T, String>` (errors serialized as plain strings for now; structured errors post-v1).

**Frontend** lives in `src/` (Vite + React). Feature directories:
```
src/
  components/     # shared UI primitives
  features/
    connections/
    schema/
    table-viewer/
    query-editor/
    license/
  hooks/          # shared hooks
  store/          # Zustand slices
  lib/            # tauri invoke wrappers, utils
```

**State layers:**
- Zustand: active session IDs, sidebar expansion state, open tabs, UI prefs.
- React Query: all async data from Tauri (schema tree nodes, table rows, query results). Cache keys include session ID + object path so multiple connections stay isolated.

**Design tokens** live in `src/styles/tokens.css` — CSS custom properties mapped to macOS semantic colors. Never hardcode a color outside of tokens.

## Dependency decisions (locked in at phase 01)

| Decision | Choice | Rationale |
|---|---|---|
| Tauri version | 2.x | Stable; better security model than v1 |
| React version | 19 | Concurrent features; compiler available |
| Build tool | Vite 6 | Fast; first-class Tauri plugin |
| CSS approach | Tailwind v4 + CSS variables | Utility classes; token system for macOS colors |
| DB crate | tokio-postgres | Async-native; no ORM overhead; direct control |
| Pool | deadpool-postgres | Pairs with tokio-postgres; simple |
| Credentials | keyring crate | macOS Keychain integration; cross-platform path for later |
