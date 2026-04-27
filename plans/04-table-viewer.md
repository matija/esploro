# Phase 04 — Table Viewer

**Goal:** Clicking a table in the schema browser opens a dedicated tab with a high-performance virtualized grid showing paginated rows, per-column filters, column sorting, and cell/row copy actions.

**Done when:**
- Table opens in a new tab with its name in the tab bar.
- First 200 rows load automatically; pagination navigates between pages.
- Each column header shows the data type badge; clicking sorts (asc → desc → none).
- Filter bar: per-column inputs with operator selector; active filters shown as chips.
- Null values rendered as a distinct `NULL` pill.
- Copy cell (⌘C on focused cell) and copy row as JSON/CSV (right-click).
- Footer shows "Showing 1–200 of N rows" (N from `COUNT(*)`).

---

## 4.1 Tauri command

File: `src-tauri/src/commands/data.rs`

```rust
#[tauri::command]
pub async fn query_table(
    session_id: String,
    request: TableQueryRequest,
    state: State<'_, AppState>,
) -> Result<TableQueryResult, String>

#[derive(Deserialize)]
pub struct TableQueryRequest {
    pub database: String,
    pub schema: String,
    pub table: String,
    pub filters: Vec<ColumnFilter>,
    pub sort_column: Option<String>,
    pub sort_direction: Option<SortDirection>,  // Asc | Desc
    pub page: u32,      // 0-indexed
    pub page_size: u32, // default 200
}

#[derive(Deserialize)]
pub struct ColumnFilter {
    pub column: String,
    pub operator: FilterOperator,
    pub value: Option<String>,  // None for IS NULL / IS NOT NULL
}

#[derive(Deserialize)]
pub enum FilterOperator {
    Eq, Neq, Like, ILike, Gt, Lt, Gte, Lte, IsNull, IsNotNull,
}

#[derive(Deserialize)]
pub enum SortDirection { Asc, Desc }

#[derive(Serialize)]
pub struct TableQueryResult {
    pub columns: Vec<ResultColumn>,
    pub rows: Vec<Vec<Option<String>>>,  // all values as strings; null = None
    pub total_count: i64,
    pub page: u32,
    pub page_size: u32,
    pub execution_ms: u64,
}

#[derive(Serialize)]
pub struct ResultColumn {
    pub name: String,
    pub data_type: String,
}
```

### SQL generation (Rust)

Build query dynamically using parameterized placeholders to prevent injection:

```rust
fn build_table_query(req: &TableQueryRequest) -> (String, Vec<String>) {
    // Identifiers (schema, table, column names) are validated against
    // [a-zA-Z0-9_] before interpolation — reject anything else.
    let mut params: Vec<String> = vec![];
    let mut where_clauses: Vec<String> = vec![];

    for filter in &req.filters {
        validate_identifier(&filter.column)?;
        let p_idx = params.len() + 1;
        let clause = match filter.operator {
            FilterOperator::Eq         => { params.push(v); format!("\"{}\" = ${}", col, p_idx) }
            FilterOperator::Like       => { params.push(v); format!("\"{}\" LIKE ${}", col, p_idx) }
            FilterOperator::IsNull     => format!("\"{}\" IS NULL", col),
            FilterOperator::IsNotNull  => format!("\"{}\" IS NOT NULL", col),
            // ... etc.
        };
        where_clauses.push(clause);
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let order_sql = match (&req.sort_column, &req.sort_direction) {
        (Some(col), Some(dir)) => {
            validate_identifier(col)?;
            let d = match dir { SortDirection::Asc => "ASC", SortDirection::Desc => "DESC" };
            format!("ORDER BY \"{}\" {}", col, d)
        }
        _ => String::new(),
    };

    let offset = req.page * req.page_size;
    let sql = format!(
        "SELECT * FROM \"{}\".\"{}\" {} {} LIMIT {} OFFSET {}",
        req.schema, req.table, where_sql, order_sql, req.page_size, offset
    );

    // Count query (same WHERE, no ORDER/LIMIT)
    let count_sql = format!(
        "SELECT COUNT(*) FROM \"{}\".\"{}\" {}",
        req.schema, req.table, where_sql
    );

    (sql, count_sql, params)
}
```

**Security note:** Column and table names are validated against `^[a-zA-Z_][a-zA-Z0-9_$]*$` before interpolation. Filter values are always passed as parameters (never interpolated).

Run both queries concurrently with `tokio::join!`.

---

## 4.2 TableViewerTab component

`src/features/table-viewer/TableViewerTab.tsx`

Layout:
```
┌─────────────────────────────────────────────────────────┐
│ [Filter bar]  [active filter chips]  [Clear all]        │
├─────────────────────────────────────────────────────────┤
│  col1 ▲  │  col2  │  col3  │  col4  │ ...              │ ← header
├──────────┼────────┼────────┼────────┼──────────────────┤
│  val     │ val    │  NULL  │ val    │                   │ ← virtualized rows
│  ...                                                    │
├─────────────────────────────────────────────────────────┤
│  Showing 1–200 of 14,382 rows  │  [< Prev]  [Next >]   │ ← footer
└─────────────────────────────────────────────────────────┘
```

### Grid implementation

Use `@tanstack/react-table` for column definition + sort state, plus `@tanstack/react-virtual` for row virtualization.

```typescript
const table = useReactTable({
  data: rows,
  columns: columnDefs,
  getCoreRowModel: getCoreRowModel(),
  manualSorting: true,   // sort handled server-side
  manualFiltering: true, // filter handled server-side
  onSortingChange: setSorting,
  state: { sorting },
});

const rowVirtualizer = useVirtualizer({
  count: rows.length,
  getScrollElement: () => tableContainerRef.current,
  estimateSize: () => 32,
  overscan: 10,
});
```

### Column header

```typescript
function ColumnHeader({ column, def }: ...) {
  return (
    <div className="flex items-center gap-1 cursor-pointer select-none"
         onClick={() => column.toggleSorting()}>
      <span>{def.name}</span>
      <Badge variant="type">{def.data_type}</Badge>
      <SortIcon direction={column.getIsSorted()} />
    </div>
  );
}
```

### Filter bar

A horizontal strip that shows one input per column (scrollable if many columns). Each input has a dropdown for the operator:

```
[column name]  [= ▼]  [input field]
```

Operators available per type family:
- **Text types** (text, varchar, char): =, ≠, LIKE, ILIKE, IS NULL, IS NOT NULL
- **Numeric types** (int, float, numeric): =, ≠, >, <, ≥, ≤, IS NULL, IS NOT NULL
- **All others** (bool, timestamp, uuid, …): =, ≠, IS NULL, IS NOT NULL

Filter state in local component state; debounced 300ms before triggering React Query refetch.

Active filters rendered as chips above the grid:
```
[column: LIKE '%foo%'  ×]   [age: > 18  ×]   [Clear all]
```

### Null rendering

```typescript
function CellValue({ value }: { value: string | null }) {
  if (value === null)
    return <span className="text-secondary-label italic text-xs px-1 rounded bg-control-bg">NULL</span>;
  return <span className="font-mono text-sm">{value}</span>;
}
```

### Copy actions

- Focused cell: `⌘C` copies the raw cell value to clipboard.
- Right-click row → context menu:
  - "Copy row as JSON" → `JSON.stringify({ col: val, ... })`
  - "Copy row as CSV" → comma-separated values, quoted if needed

---

## 4.3 Pagination

Footer with prev/next buttons. State: `page` (0-indexed) in local state. On page change → React Query refetch with new `page`.

```typescript
const { data, isLoading, isFetching } = useQuery(
  ['table', sessionId, database, schema, table, filters, sorting, page],
  () => invoke('query_table', { sessionId, request: { database, schema, table, filters, sortColumn, sortDirection, page, pageSize: 200 } }),
  { keepPreviousData: true }  // don't flash empty while loading next page
);
```

`keepPreviousData: true` keeps the previous page visible while the next loads — prevents the grid from going blank.

---

## 4.4 Tab integration

When user right-clicks a table in the schema browser and selects "Open table viewer":
```typescript
openTab({
  id: crypto.randomUUID(),
  type: 'table',
  title: `${schema}.${table}`,
  sessionId,
  database,
  schema,
  table,
});
```

Multiple tabs for the same table are allowed (different filter states).

---

## Acceptance checklist

- [ ] Open table viewer from schema browser right-click.
- [ ] Grid renders 200 rows; columns show correct type badges.
- [ ] Sort by a column → data re-fetches sorted; sort indicator updates.
- [ ] Add a text LIKE filter → results narrow correctly.
- [ ] Add an IS NULL filter → only null rows returned.
- [ ] Active filters shown as chips; click × on chip removes that filter.
- [ ] Navigate to page 2 → data updates; footer shows correct range.
- [ ] NULL cells render as distinct pill, not empty string.
- [ ] Right-click row → "Copy row as JSON" → paste shows valid JSON.
- [ ] 10 000-row result set (via large page size test) scrolls at 60fps.
- [ ] `keepPreviousData` prevents blank flash on page turn.
- [ ] SQL injection attempt in filter value (e.g. `'; DROP TABLE foo; --`) is safely parameterized.
