# Phase 03 — Schema Browser

**Goal:** After connecting, the sidebar reveals a lazy-loading tree: databases → schemas → tables/views/sequences/functions → columns. A search box narrows the tree. Right-click opens a context menu with useful actions.

**Done when:**
- Tree loads the first level (databases) immediately on connect.
- Each subsequent level loads only when the user expands the node.
- Column list expands inline under a table node.
- Fuzzy search filters the visible tree in real time.
- Context menu offers: Copy name, Copy qualified name, Open in table viewer, Open in query editor.
- Schema tree state (expanded nodes) persists per connection across app restarts.

---

## 3.1 Tauri commands

File: `src-tauri/src/commands/schema.rs`

```rust
#[tauri::command]
pub async fn list_databases(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String>

#[tauri::command]
pub async fn list_schemas(
    session_id: String,
    database: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String>

#[tauri::command]
pub async fn list_objects(
    session_id: String,
    database: String,
    schema: String,
    state: State<'_, AppState>,
) -> Result<SchemaObjects, String>

#[derive(Serialize)]
pub struct SchemaObjects {
    pub tables:    Vec<TableSummary>,
    pub views:     Vec<String>,
    pub sequences: Vec<String>,
    pub functions: Vec<FunctionSummary>,
}

#[derive(Serialize)]
pub struct TableSummary {
    pub name: String,
    pub estimated_row_count: Option<i64>,
}

#[tauri::command]
pub async fn list_columns(
    session_id: String,
    database: String,
    schema: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<ColumnDef>, String>

#[derive(Serialize)]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub column_default: Option<String>,
    pub is_primary_key: bool,
    pub is_foreign_key: bool,
    pub foreign_key_ref: Option<String>,  // "schema.table.column"
}
```

### SQL queries used

**list_databases:**
```sql
SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;
```

**list_schemas:**
```sql
SELECT schema_name FROM information_schema.schemata
WHERE catalog_name = current_database()
  AND schema_name NOT IN ('pg_catalog','information_schema','pg_toast')
ORDER BY schema_name;
```

**list_objects (tables + views):**
```sql
SELECT
  t.table_name,
  t.table_type,
  s.reltuples::bigint AS estimated_rows
FROM information_schema.tables t
LEFT JOIN pg_class s
  ON s.relname = t.table_name
  AND s.relnamespace = (
    SELECT oid FROM pg_namespace WHERE nspname = $1
  )
WHERE t.table_schema = $1
ORDER BY t.table_type, t.table_name;
```

**list_columns:**
```sql
SELECT
  c.column_name,
  c.udt_name AS data_type,
  c.is_nullable = 'YES' AS is_nullable,
  c.column_default,
  (
    SELECT count(*) > 0 FROM information_schema.key_column_usage k
    JOIN information_schema.table_constraints tc
      ON tc.constraint_name = k.constraint_name
     AND tc.constraint_type = 'PRIMARY KEY'
     AND tc.table_schema = c.table_schema
     AND tc.table_name = c.table_name
    WHERE k.column_name = c.column_name
      AND k.table_schema = c.table_schema
      AND k.table_name = c.table_name
  ) AS is_primary_key,
  (
    SELECT count(*) > 0 FROM information_schema.key_column_usage k2
    JOIN information_schema.table_constraints tc2
      ON tc2.constraint_name = k2.constraint_name
     AND tc2.constraint_type = 'FOREIGN KEY'
    WHERE k2.column_name = c.column_name
      AND k2.table_schema = c.table_schema
      AND k2.table_name = c.table_name
  ) AS is_foreign_key
FROM information_schema.columns c
WHERE c.table_schema = $1 AND c.table_name = $2
ORDER BY c.ordinal_position;
```

Note: `list_objects` for sequences and functions uses separate queries from `pg_proc` / `pg_sequences`; these are lower priority and can return empty lists initially.

---

## 3.2 Tree data structure (frontend)

```typescript
type TreeNode =
  | { kind: 'database'; name: string; sessionId: string }
  | { kind: 'schema'; name: string; database: string; sessionId: string }
  | { kind: 'group'; label: 'Tables' | 'Views' | 'Sequences' | 'Functions'; parent: SchemaPath }
  | { kind: 'table'; name: string; schema: string; database: string; sessionId: string; estimatedRows?: number }
  | { kind: 'view'; name: string; schema: string; database: string; sessionId: string }
  | { kind: 'column'; def: ColumnDef; table: string; schema: string; database: string }
```

Tree state lives in Zustand (`schemaSlice`):
```typescript
interface SchemaSlice {
  expandedNodes: Set<string>;  // node keys, persisted per connection to localStorage
  toggleNode: (key: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}
```

React Query manages fetched data:
```typescript
useQuery(['databases', sessionId], () => invoke('list_databases', { sessionId }))
useQuery(['schemas', sessionId, db], () => invoke('list_schemas', { sessionId, database: db }), { enabled: isExpanded })
// etc.
```

---

## 3.3 SchemaTree component

`src/features/schema/SchemaTree.tsx`

Renders a virtualized list (TanStack Virtual) of flattened visible tree nodes. Virtualization is important when a schema has hundreds of tables.

Flatten algorithm:
1. Start with database nodes for the session.
2. If database is expanded: add its schema nodes (fetched or loading).
3. If schema is expanded: add group nodes (Tables, Views…).
4. If group is expanded: add table/view nodes.
5. If table is expanded: add column nodes.

**Search behavior:**
- When `searchQuery` is non-empty, run fuzzy match against all table/view names across all loaded schemas.
- Matching nodes are shown with their ancestor path visible but collapsed (only the match + path is shown).
- Use a simple `string.toLowerCase().includes(q.toLowerCase())` for v1; upgrade to fuse.js if needed.

---

## 3.4 Tree node rendering

Each node type renders differently:

| Node | Icon | Secondary text |
|---|---|---|
| Database | cylinder icon | — |
| Schema | folder icon | — |
| Group | none (indented label) | count badge |
| Table | grid icon | estimated row count |
| View | eye icon | "view" badge |
| Column | — | type badge + nullable/PK/FK indicators |

Column indicators (small inline badges):
- `PK` — gold background
- `FK` — blue background
- `?` (nullable) — gray

---

## 3.5 Context menu

Radix `DropdownMenu` triggered on right-click (`onContextMenu`):

For table/view nodes:
```
Copy table name
Copy qualified name (schema.table)
─────────────────
Open table viewer        ⌘↵
Open in query editor  →  prefills: SELECT * FROM schema.table LIMIT 100;
```

For column nodes:
```
Copy column name
Copy type
```

---

## 3.6 Command palette integration

When a connection is active, the palette searches loaded table names:
- "schema.table" → action: Open table viewer.

---

## Acceptance checklist

- [ ] Connect to a Postgres instance; databases appear immediately in sidebar.
- [ ] Expand database → schemas load with a spinner, then appear.
- [ ] Expand schema → Tables/Views/etc. groups appear.
- [ ] Expand Tables → table list with estimated row counts.
- [ ] Expand table → column list with type + PK/FK badges.
- [ ] Search filters to matching tables across all loaded schemas.
- [ ] Right-click table → "Open table viewer" opens a table tab (stub in this phase, wired in 04).
- [ ] Right-click table → "Copy qualified name" puts `schema.table` on clipboard.
- [ ] Expanded nodes remembered after app restart for the same connection.
- [ ] 500-table schema renders without visible jank (virtualization working).
