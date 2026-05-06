# PRD: MySQL/MariaDB Support + Better Table Filtering

Two features. They share a release because MySQL type names affect how filters behave, and it's cleaner to do them together than to ship half a filter system, then retrofit it for MySQL types.

---

## Feature 1: MySQL and MariaDB connections

### Problem

Esploro only connects to PostgreSQL. A lot of freelance and hobbyist work runs on MySQL or MariaDB — WordPress, Laravel, Rails with MySQL adapter, managed databases on PlanetScale and Railway. Every time a user opens a non-Postgres database, they have to switch to a different client.

### What we want

A user should be able to add a MySQL or MariaDB connection the same way they add a Postgres one. They pick the driver from a dropdown, fill in host/port/database/user/password, hit Connect, and browse tables. The table viewer, schema browser, and query editor should all work.

MySQL and MariaDB are close enough to treat as one driver. We call the driver `mysql` internally and surface "MySQL / MariaDB" in the UI.

### User stories

1. As a user, I can create a connection profile with driver set to "MySQL / MariaDB", so that I can connect to a MySQL or MariaDB server.
2. As a user, the default port fills in as 3306 when I pick MySQL, so that I don't have to look it up.
3. As a user, I can browse the schema tree — databases, tables, and columns — the same way I do in Postgres connections.
4. As a user, I can open a table and page through its rows in the table viewer.
5. As a user, I can run SQL queries in the query editor against a MySQL connection.
6. As a user, column types show up correctly (VARCHAR, INT, DATETIME, TINYINT, etc.) and filter operators are appropriate for each type.
7. As a user, connections are tested before saving, with a clear error if the host is unreachable or credentials are wrong.

### What MySQL is missing (vs Postgres)

- **No schema layer.** In MySQL, database = schema. The schema browser shows databases → tables → columns. No intermediate schema node.
- **No ILIKE.** MySQL's LIKE is case-insensitive by default with a UTF-8 collation. We expose LIKE only; no ILIKE operator for MySQL text columns.
- **No native boolean type.** MySQL uses `TINYINT(1)` for booleans. Map `tinyint` to the `boolean` type family when the column length is 1; otherwise numeric.
- **No UUID type.** Store as `CHAR(36)` or `VARCHAR(36)`. Treat as text family.
- **Different INFORMATION_SCHEMA column names.** `COLUMN_TYPE` (MySQL) vs `udt_name` (Postgres), `IS_NULLABLE = 'YES'` in both but the primary-key query differs (use `COLUMN_KEY = 'PRI'` in MySQL instead of joining `pg_constraint`).

### Implementation decisions

**Driver abstraction in Rust**

Define a `DbDriver` trait (or an enum dispatch) with methods:
- `query_table(...)` → `TableQueryResult`
- `list_databases()` → `Vec<String>`
- `list_tables(database)` → `Vec<TableInfo>`
- `list_columns(database, table)` → `Vec<ColumnInfo>`
- `execute_query(sql)` → `QueryResult`

The `AppState` pool map changes from `HashMap<SessionId, deadpool_postgres::Pool>` to `HashMap<SessionId, DriverSession>` where `DriverSession` is an enum:

```rust
enum DriverSession {
    Postgres(deadpool_postgres::Pool),
    Mysql(mysql_async::Pool),
}
```

All Tauri commands dispatch through this enum. The command signatures stay the same.

**Crate: `mysql_async`**

Use `mysql_async` — it's async-native, well-maintained, and doesn't pull in `sqlx`'s full macro surface. Add `mysql_async = { version = "0.34", features = ["default"] }` to `Cargo.toml`.

**ConnectionProfile changes**

Add a `driver` field:

```rust
pub enum DbDriver { Postgres, Mysql }
```

Default to `Postgres` so existing profiles deserialize cleanly. Serialize as `"postgres"` / `"mysql"`.

**Connection form changes**

- Add a segmented control (or Select) at the top of the connection form: `PostgreSQL | MySQL / MariaDB`.
- When MySQL is selected: default port → 3306; hide the SSL mode field for now (MySQL SSL is a separate config surface, defer to v2); hide the schema field in the form (MySQL has no schema).
- When testing or saving, validate that host + port + database + username are all set.

**Schema browser changes**

- For MySQL sessions, the tree is: database node → table nodes (no schema level).
- `list_tables` uses `SHOW TABLES IN <database>` or `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?`.
- `list_columns` uses `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`.
- Primary key: `COLUMN_KEY = 'PRI'`. Foreign key: `COLUMN_KEY = 'MUL'` (approximation; exact FK detection needs `INFORMATION_SCHEMA.KEY_COLUMN_USAGE`, but MUL is good enough for the badge).

**Type family mapping for MySQL**

Extend `getTypeFamily` in `types.ts` to handle MySQL type names:

| MySQL type | Family |
|---|---|
| varchar, char, text, tinytext, mediumtext, longtext, enum, set | text |
| int, bigint, smallint, tinyint (length ≠ 1), float, double, decimal | numeric |
| tinyint(1) | boolean |
| date, datetime, timestamp, time, year | date |
| json | json |
| binary, varbinary, blob, mediumblob, longblob | other |

**Filter operators for MySQL**

`getOperatorsForFamily` already returns correct sets except: remove `ILike` for MySQL connections. Pass the active driver down to the type utilities, or check on the Rust side when building the WHERE clause — if driver is MySQL and operator is ILike, treat it as Like.

**Query pagination**

MySQL: use `LIMIT ? OFFSET ?` — same as Postgres. The `COUNT(*)` subquery pattern is identical.

**Out of scope for v1**

- MySQL SSL/TLS configuration in the connection form.
- SSH tunnel support.
- MariaDB-specific features (Sequences, JSON differences). We test against MariaDB 10.6+ and MySQL 8.x; older versions may have minor issues.
- PlanetScale's HTTP API mode (use standard MySQL driver; PlanetScale supports it).
- Auto-increment / sequence introspection in the schema browser.

---

## Feature 2: Better table filtering

### Problem

The current filter bar shows every column as an inline `FilterInput` widget in a horizontally scrolling row. For a table with 8 or more columns, you have to scroll to find the column you want. The operator is a native `<select>`, which doesn't match the app's style. There's no way to set a filter from the context menu. And the filter bar takes up a full row of vertical space even when no filters are active.

The experience feels tacked on rather than designed.

### What we want

Filtering should feel fast and intentional. Three entry points:

1. **Column header click → filter popover.** Clicking the filter icon in a column header (or pressing ⌘F while a column is focused) opens a small popover anchored to that column. The popover shows the column name, an operator selector (Radix `Select`, not native), and a value input. Confirm with Enter or click outside to apply.
2. **"Filter by this value" in the cell context menu.** Right-clicking a cell shows a new item: "Filter by this value". Choosing it sets `col = 'cell_value'` immediately. Right-clicking a NULL cell shows "Filter: IS NULL".
3. **Active filter chips → click to edit.** Clicking an active filter chip reopens the popover for that column, pre-filled.

The always-visible filter bar is removed. Its job is replaced by these three entry points plus the chip row.

### User stories

1. As a user, I click the filter icon on a column header and a popover opens for that column, so that I can set a filter without scrolling.
2. As a user, the operator selector in the popover is styled to match the app (not a native select), so that it feels native to Esploro.
3. As a user, I right-click a cell and choose "Filter by this value", so that I can filter by a value I can already see without typing.
4. As a user, right-clicking a NULL cell shows "Filter: IS NULL" in the context menu, so that I can filter nulls from row data.
5. As a user, clicking an active filter chip reopens the edit popover for that filter, so that I can adjust it without removing and re-adding.
6. As a user, pressing Escape in the filter popover closes it without applying changes, so that I can cancel without side effects.
7. As a user, pressing Enter confirms the filter, so that I can filter quickly with the keyboard.
8. As a user, with no active filters, no filter UI takes up space except the filter icon in column headers (which appears on header hover), so that the table has maximum vertical space.

### Implementation decisions

**Remove the filter bar**

Delete the `{columns.length > 0 && (<div className="shrink-0 border-b ..."> ...FilterInput... </div>)}` block from `TableViewerTab.tsx`. The `FilterInput` component can be deleted or repurposed inside the popover.

**Column header filter icon**

The column header already shows a `<Filter size={9}>` icon when `isFiltered`. Change this: always show the filter icon on header hover (not just when filtered), and make it a button that opens the popover. Use `onClick` on the icon, `stopPropagation` to avoid triggering the sort.

**Filter popover component**

New `ColumnFilterPopover` component using Radix `Popover`. It receives:
- `col: ResultColumn`
- `driver: "postgres" | "mysql"` (to determine whether ILike is available)
- `entry: FilterEntry | undefined`
- `onApply: (entry: FilterEntry | null) => void`
- `onClose: () => void`

Inside:
- Column name + type badge at the top (read-only).
- Radix `Select` for the operator (styled to match the app).
- Text input for the value (hidden when operator is IsNull/IsNotNull).
- "Apply" button + "Clear filter" button (if a filter exists).
- `autoFocus` on the value input when the popover opens.
- Enter key in the input triggers Apply.
- Escape closes without applying (Radix Popover handles this via `onEscapeKeyDown`).

**Operator selector**

Use Radix `Select` with `SelectTrigger`, `SelectContent`, `SelectItem`. Style the trigger to look like the app's `bg-control` buttons. Group operators by family (comparison, null checks) with a `SelectSeparator` between groups.

**"Filter by this value" in context menu**

In `CellContextMenu`, add after the existing items:

```
<div className="my-1 border-t border-separator" />
<button onClick={filterByValue}>Filter by this value</button>  // shows cell value preview
{cellValue === null && <button onClick={filterIsNull}>Filter: IS NULL</button>}
```

`filterByValue` calls `onFilterByValue(colName, cellValue)`. The parent wires this into `setFilterDraft`. The context menu already has `colIdx` and `columns`; no new props needed beyond a callback.

**Chip → edit flow**

In the active chip row, make each chip clickable. Clicking a chip sets a `editingFilterCol: string | null` state in `TableViewerTab`. The corresponding column header's popover opens (position it from a ref on that column header). This is the same popover; just triggered differently.

**State shape stays the same**

`filterDraft`, `activeFilters`, `apiFilters`, `removeFilter`, `clearAllFilters` — all unchanged. The popover just writes into `filterDraft` using the existing `setFilterDraft` callback.

**Keyboard shortcut**

`⌘F` when the table has focus: open the filter popover for the first column, or for the currently sorted column if one is set. Implement as a `keydown` listener in `TableViewerTab` (same pattern as the existing `⌘C` for copy).

### What changes and what stays

| What | Change |
|---|---|
| Horizontal filter bar | Removed |
| `FilterInput` component | Removed (or inlined into popover) |
| Active filter chips row | Kept; chips are now clickable |
| `filterDraft` / `activeFilters` state | Unchanged |
| 300ms debounce | Unchanged |
| Filter icon in column headers | Now visible on hover; triggers popover |
| Operator selector | Radix Select instead of native `<select>` |
| Context menu | Gains "Filter by this value" and "Filter: IS NULL" |

### Out of scope

- Multi-value filters (IN / NOT IN). The operator set stays as-is.
- OR between filters for the same column. All active filters are AND-combined.
- Saved filter presets.
- Filtering by range with a date picker widget (type the date string for now).
- Search-across-all-columns (a separate "Search" feature, not a filter).

---

## Testing

**MySQL** ✅ Implementation complete (manual testing pending live MySQL instance)

- [ ] Connect to a local MySQL 8 instance and a local MariaDB 10.6 instance. Verify schema tree, table viewer, query editor.
- [ ] Connect to a Railway-hosted MySQL instance (tests TLS path once SSL is wired).
- [ ] Verify `tinyint(1)` columns display as true/false, not 0/1.
- [ ] Verify that LIKE operator is used for MySQL text filters (no ILIKE).
- [ ] Verify error message when connection fails (wrong password, wrong host).

**Filtering** ✅ Implementation complete (manual testing pending live table data)

- [ ] Open a wide table (10+ columns). Filter popover opens for any column via header click.
- [ ] "Filter by this value" sets the filter and the chip appears.
- [ ] Clicking a chip re-opens the popover pre-filled with the current operator and value.
- [ ] Enter confirms, Escape cancels.
- [ ] ⌘F opens the filter popover.
- [ ] No filter bar visible when no filters are active.
