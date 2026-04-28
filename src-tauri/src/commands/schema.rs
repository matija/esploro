use serde::Serialize;
use tauri::State;

use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSummary {
    pub name: String,
    pub estimated_row_count: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionSummary {
    pub name: String,
    pub result_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObjects {
    pub tables: Vec<TableSummary>,
    pub views: Vec<String>,
    pub sequences: Vec<String>,
    pub functions: Vec<FunctionSummary>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub column_default: Option<String>,
    pub is_primary_key: bool,
    pub is_foreign_key: bool,
    pub foreign_key_ref: Option<String>,
}

#[tauri::command]
pub async fn list_databases(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let sessions = state.sessions.lock().await;
    let info = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    let client = info.pool.get().await.map_err(|e| e.to_string())?;

    let rows = client
        .query(
            "SELECT datname FROM pg_database \
             WHERE datistemplate = false \
             ORDER BY datname",
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
}

#[tauri::command]
pub async fn list_schemas(
    session_id: String,
    // database ignored in v1; pool is bound to the configured database
    _database: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let sessions = state.sessions.lock().await;
    let info = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    let client = info.pool.get().await.map_err(|e| e.to_string())?;

    let rows = client
        .query(
            "SELECT schema_name \
             FROM information_schema.schemata \
             WHERE catalog_name = current_database() \
               AND schema_name NOT IN ('pg_catalog','information_schema','pg_toast') \
             ORDER BY schema_name",
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
}

#[tauri::command]
pub async fn list_objects(
    session_id: String,
    _database: String,
    schema: String,
    state: State<'_, AppState>,
) -> Result<SchemaObjects, String> {
    let sessions = state.sessions.lock().await;
    let info = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    let client = info.pool.get().await.map_err(|e| e.to_string())?;

    // Tables + views in one pass
    let table_rows = client
        .query(
            "SELECT t.table_name, t.table_type, \
                    CASE WHEN s.reltuples >= 0 THEN s.reltuples::bigint ELSE NULL END \
             FROM information_schema.tables t \
             LEFT JOIN pg_class s \
               ON s.relname = t.table_name \
               AND s.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1) \
             WHERE t.table_schema = $1 \
             ORDER BY t.table_type, t.table_name",
            &[&schema],
        )
        .await
        .map_err(|e| e.to_string())?;

    let mut tables = Vec::new();
    let mut views = Vec::new();

    for row in &table_rows {
        let name: String = row.get(0);
        let table_type: String = row.get(1);
        let estimated_rows: Option<i64> = row.get(2);

        if table_type == "BASE TABLE" {
            tables.push(TableSummary {
                name,
                estimated_row_count: estimated_rows,
            });
        } else {
            views.push(name);
        }
    }

    // Sequences
    let seq_rows = client
        .query(
            "SELECT sequence_name \
             FROM information_schema.sequences \
             WHERE sequence_schema = $1 \
             ORDER BY sequence_name",
            &[&schema],
        )
        .await
        .map_err(|e| e.to_string())?;
    let sequences: Vec<String> = seq_rows.iter().map(|r| r.get(0)).collect();

    // Functions (excluding internal pg_ functions)
    let fn_rows = client
        .query(
            "SELECT p.proname, pg_get_function_result(p.oid) \
             FROM pg_proc p \
             JOIN pg_namespace n ON n.oid = p.pronamespace \
             WHERE n.nspname = $1 \
               AND p.prokind = 'f' \
             ORDER BY p.proname",
            &[&schema],
        )
        .await
        .map_err(|e| e.to_string())?;
    let functions: Vec<FunctionSummary> = fn_rows
        .iter()
        .map(|r| FunctionSummary {
            name: r.get(0),
            result_type: r.get(1),
        })
        .collect();

    Ok(SchemaObjects {
        tables,
        views,
        sequences,
        functions,
    })
}

#[tauri::command]
pub async fn list_columns(
    session_id: String,
    _database: String,
    schema: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<ColumnDef>, String> {
    let sessions = state.sessions.lock().await;
    let info = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    let client = info.pool.get().await.map_err(|e| e.to_string())?;

    let rows = client
        .query(
            "SELECT \
               c.column_name, \
               c.udt_name AS data_type, \
               (c.is_nullable = 'YES') AS is_nullable, \
               c.column_default, \
               ( \
                 SELECT count(*) > 0 \
                 FROM information_schema.key_column_usage k \
                 JOIN information_schema.table_constraints tc \
                   ON tc.constraint_name = k.constraint_name \
                  AND tc.constraint_type = 'PRIMARY KEY' \
                  AND tc.table_schema = c.table_schema \
                  AND tc.table_name = c.table_name \
                 WHERE k.column_name = c.column_name \
                   AND k.table_schema = c.table_schema \
                   AND k.table_name = c.table_name \
               ) AS is_primary_key, \
               ( \
                 SELECT count(*) > 0 \
                 FROM information_schema.key_column_usage k2 \
                 JOIN information_schema.table_constraints tc2 \
                   ON tc2.constraint_name = k2.constraint_name \
                  AND tc2.constraint_type = 'FOREIGN KEY' \
                 WHERE k2.column_name = c.column_name \
                   AND k2.table_schema = c.table_schema \
                   AND k2.table_name = c.table_name \
               ) AS is_foreign_key \
             FROM information_schema.columns c \
             WHERE c.table_schema = $1 AND c.table_name = $2 \
             ORDER BY c.ordinal_position",
            &[&schema, &table],
        )
        .await
        .map_err(|e| e.to_string())?;

    let columns = rows
        .iter()
        .map(|r| ColumnDef {
            name: r.get(0),
            data_type: r.get(1),
            is_nullable: r.get(2),
            column_default: r.get(3),
            is_primary_key: r.get(4),
            is_foreign_key: r.get(5),
            foreign_key_ref: None,
        })
        .collect();

    Ok(columns)
}
