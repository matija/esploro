# Phase 05 — SQL Query Editor

**Goal:** A full-featured SQL editor tab: CodeMirror 6 with schema-aware autocomplete, ⌘↵ to run, result grid below, multiple result sets, execution time, error highlighting, and a local saved-query library.

**Done when:**
- New query tab opens via ⌘T or sidebar "+" button.
- CodeMirror renders with SQL syntax highlighting and line numbers.
- ⌘↵ executes the query against the active connection's session.
- Results appear in the same virtualized grid as the table viewer.
- Multiple result sets (from multiple statements) rendered as stacked panels.
- Errors show the message with position highlighted in the editor.
- Query execution time displayed in the result panel header.
- Save query (⌘S) prompts for name/folder; saved queries appear in sidebar.
- Saved queries reopenable via sidebar or ⌘K.

---

## 5.1 Tauri commands

File: `src-tauri/src/commands/data.rs` (extend existing file)

```rust
#[tauri::command]
pub async fn execute_sql(
    session_id: String,
    sql: String,
    state: State<'_, AppState>,
) -> Result<Vec<QueryResult>, String>

#[derive(Serialize)]
pub struct QueryResult {
    pub columns: Vec<ResultColumn>,
    pub rows: Vec<Vec<Option<String>>>,
    pub rows_affected: Option<u64>,   // for INSERT/UPDATE/DELETE
    pub execution_ms: u64,
    pub error: Option<QueryError>,
}

#[derive(Serialize)]
pub struct QueryError {
    pub message: String,
    pub position: Option<u32>,  // byte offset in original SQL, if Postgres provides it
    pub code: Option<String>,   // SQLSTATE
}
```

### Multi-statement execution

Split on `;` boundaries (naive split is fine for v1 — a proper parser is post-v1). Execute statements sequentially; collect results. On error, stop and return results collected so far plus the error.

```rust
pub async fn execute_sql(session_id, sql, state) -> Result<Vec<QueryResult>, String> {
    let pool = /* get pool from state */;
    let client = pool.get().await.map_err(|e| e.to_string())?;
    
    let statements: Vec<&str> = sql.split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let mut results = vec![];
    for stmt in statements {
        let t0 = std::time::Instant::now();
        match client.query(stmt, &[]).await {
            Ok(rows) => {
                results.push(QueryResult::from_rows(rows, t0.elapsed().as_millis() as u64));
            }
            Err(e) => {
                results.push(QueryResult::from_error(e, t0.elapsed().as_millis() as u64));
                break;
            }
        }
    }
    Ok(results)
}
```

**Values serialized to strings:** same approach as table viewer — all `Row` column values converted via `ToString`/`Display` implementations. Types that don't implement `Display` fall back to `Debug`.

---

## 5.2 Saved queries (Tauri commands)

File: `src-tauri/src/commands/saved_queries.rs`

```rust
#[tauri::command]
pub async fn save_query(name: String, folder: Option<String>, sql: String)
    -> Result<String, String>  // returns id

#[tauri::command]
pub async fn list_saved_queries() -> Result<Vec<SavedQuerySummary>, String>

#[tauri::command]
pub async fn get_saved_query(id: String) -> Result<SavedQuery, String>

#[tauri::command]
pub async fn delete_saved_query(id: String) -> Result<(), String>

#[derive(Serialize, Deserialize)]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    pub folder: Option<String>,
    pub sql: String,
    pub created_at: String,
    pub updated_at: String,
}
```

Stored in `$APP_DATA_DIR/saved_queries.json`.

---

## 5.3 CodeMirror setup

Install:
```bash
npm install \
  @codemirror/lang-sql \
  @codemirror/view \
  @codemirror/state \
  @codemirror/commands \
  @codemirror/autocomplete \
  @codemirror/lint \
  @codemirror/theme-one-dark
```

`src/features/query-editor/SqlEditor.tsx`:

```typescript
const extensions = useMemo(() => [
  sql({
    schema: schemaCompletions,  // built from loaded schema tree
    upperCaseKeywords: false,
  }),
  keymap.of([{
    key: 'Mod-Enter',
    run: (view) => { onRun(view.state.doc.toString()); return true; },
  }]),
  EditorView.theme({
    '&': { fontFamily: 'var(--font-mono)', fontSize: '13px' },
    '.cm-content': { padding: '12px 0' },
  }),
  lineNumbers(),
  highlightActiveLineGutter(),
  foldGutter(),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
], [schemaCompletions, onRun]);
```

### Schema-aware autocomplete

`schemaCompletions` is built from the loaded schema tree nodes:

```typescript
function buildSchemaCompletions(tree: SchemaNode[]): SQLConfig['schema'] {
  const schema: SQLConfig['schema'] = {};
  for (const db of tree) {
    for (const sc of db.schemas ?? []) {
      for (const tbl of sc.tables ?? []) {
        const qualifiedName = `${sc.name}.${tbl.name}`;
        schema[qualifiedName] = tbl.columns?.map(c => c.name) ?? [];
        schema[tbl.name] = tbl.columns?.map(c => c.name) ?? [];
      }
    }
  }
  return schema;
}
```

Autocomplete fires when typing a table name after `FROM`, `JOIN`, `INTO`, or after `.` following a schema/table name.

### Error highlighting

When `QueryError.position` is set, compute the line/column and use CodeMirror's `setDiagnostics` to draw a red underline:

```typescript
useEffect(() => {
  if (!error?.position || !editorView) return;
  const pos = error.position;
  const diagnostics = [{
    from: pos,
    to: pos + 1,
    severity: 'error',
    message: error.message,
  }];
  editorView.dispatch(setDiagnostics(editorView.state, diagnostics));
}, [error, editorView]);
```

---

## 5.4 QueryEditorTab component

`src/features/query-editor/QueryEditorTab.tsx`

Layout (resizable split, vertical):
```
┌─────────────────────────────────────────────────────────┐
│ [connection badge]  [Run ⌘↵]  [Save ⌘S]  [time badge]  │ ← toolbar
├─────────────────────────────────────────────────────────┤
│                                                         │
│  CodeMirror editor (flex-grow)                          │
│                                                         │
├─────────────────────────────────────────────────────────┤  ← drag handle
│  Result panel (resizable, min 120px)                    │
│    [Statement 1 — 14,382 rows in 42ms]                  │
│    [grid]                                               │
│    [Statement 2 — 1 row affected in 5ms]                │
└─────────────────────────────────────────────────────────┘
```

**Result panel tabs:** If multiple result sets, show them as stacked sections (not tabs) — scroll through them. Each section has a header: "Result 1 — N rows | N rows affected — Xms".

**Run state:** While executing, the Run button shows a spinner and is disabled. Cancel is not implemented in v1 (statement runs to completion).

**Connection badge:** Shows which connection/database is active. Clicking it opens a dropdown to switch the query's target session (if multiple connections are open).

---

## 5.5 Saved queries sidebar section

`src/features/query-editor/SavedQueriesSection.tsx`

Appears below the schema tree in the sidebar, in its own collapsible section.

```
▼ Saved Queries
  ▼ Reports
      Monthly Revenue
      Churn Analysis
  ─ Ad Hoc Queries
      User Lookup
```

Click opens the query in a new tab (or focuses existing tab if already open). Right-click → Delete, Rename.

---

## 5.6 Command palette integration

New commands registered:
- "New Query" → opens a fresh QueryEditorTab.
- Each saved query → "Open: {name}" action → opens/focuses tab.
- "Run Query" (when a query tab is focused) → triggers run.

---

## 5.7 Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Run query | ⌘↵ |
| New query tab | ⌘T |
| Save query | ⌘S |
| Format SQL (future) | ⌘⇧F |
| Close tab | ⌘W |

---

## Acceptance checklist

- [ ] New query tab opens blank with cursor ready.
- [ ] Type `SELECT * FROM ` → autocomplete suggests loaded table names.
- [ ] Type `users.` → autocomplete suggests column names.
- [ ] ⌘↵ runs query; spinner shown during execution.
- [ ] Single SELECT → result grid appears with data.
- [ ] Two SELECTs separated by `;` → two result sections shown.
- [ ] INSERT statement → "1 row affected" shown, no grid.
- [ ] Syntax error → CodeMirror shows red underline at error position; error message in result panel.
- [ ] Execution time badge updates on each run.
- [ ] ⌘S → save dialog appears; query saved; appears in sidebar.
- [ ] Click saved query in sidebar → opens in new tab with SQL pre-filled.
- [ ] Delete saved query from sidebar right-click → removed immediately.
- [ ] ⌘K → search "Monthly" → saved query appears in results.
- [ ] Run a query that returns 50 000 rows → grid virtualizes correctly, no crash.
