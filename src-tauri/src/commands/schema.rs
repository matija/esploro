use mysql_async::prelude::Queryable;
use serde::Serialize;
use tauri::State;

use crate::{AppState, DriverSession};

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
    pub is_enum: bool,
}

// ─── list_databases ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_databases(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let sessions = state.sessions.lock().await;
    let info = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await.map_err(|e| e.to_string())?;
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
        DriverSession::Mysql(pool) => {
            let mut conn = pool.get_conn().await.map_err(|e| e.to_string())?;
            let rows: Vec<mysql_async::Row> = conn
                .query(
                    "SELECT schema_name FROM information_schema.schemata \
                     WHERE schema_name NOT IN \
                       ('information_schema','performance_schema','mysql','sys') \
                     ORDER BY schema_name",
                )
                .await
                .map_err(|e| e.to_string())?;
            Ok(rows
                .iter()
                .filter_map(|r| mysql_str(r, 0))
                .collect())
        }
    }
}

// ─── list_schemas ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_schemas(
    session_id: String,
    database: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let sessions = state.sessions.lock().await;
    let info = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await.map_err(|e| e.to_string())?;
            let rows = client
                .query(
                    "SELECT schema_name \
                     FROM information_schema.schemata \
                     WHERE catalog_name = current_database() \
                       AND schema_name NOT IN \
                         ('pg_catalog','information_schema','pg_toast') \
                     ORDER BY schema_name",
                    &[],
                )
                .await
                .map_err(|e| e.to_string())?;
            Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
        }
        DriverSession::Mysql(_) => {
            // MySQL has no schema level; return the database name as pseudo-schema
            // so the tree can fetch objects without additional branching.
            Ok(vec![database])
        }
    }
}

// ─── list_objects ────────────────────────────────────────────────────────────

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

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await.map_err(|e| e.to_string())?;

            let table_rows = client
                .query(
                    "SELECT t.table_name, t.table_type, \
                            CASE WHEN s.reltuples >= 0 THEN s.reltuples::bigint ELSE NULL END \
                     FROM information_schema.tables t \
                     LEFT JOIN pg_class s \
                       ON s.relname = t.table_name \
                       AND s.relnamespace = \
                         (SELECT oid FROM pg_namespace WHERE nspname = $1) \
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
                    tables.push(TableSummary { name, estimated_row_count: estimated_rows });
                } else {
                    views.push(name);
                }
            }

            let seq_rows = client
                .query(
                    "SELECT sequence_name FROM information_schema.sequences \
                     WHERE sequence_schema = $1 ORDER BY sequence_name",
                    &[&schema],
                )
                .await
                .map_err(|e| e.to_string())?;
            let sequences: Vec<String> = seq_rows.iter().map(|r| r.get(0)).collect();

            let fn_rows = client
                .query(
                    "SELECT p.proname, pg_get_function_result(p.oid) \
                     FROM pg_proc p \
                     JOIN pg_namespace n ON n.oid = p.pronamespace \
                     WHERE n.nspname = $1 AND p.prokind = 'f' \
                     ORDER BY p.proname",
                    &[&schema],
                )
                .await
                .map_err(|e| e.to_string())?;
            let functions: Vec<FunctionSummary> = fn_rows
                .iter()
                .map(|r| FunctionSummary { name: r.get(0), result_type: r.get(1) })
                .collect();

            Ok(SchemaObjects { tables, views, sequences, functions })
        }
        DriverSession::Mysql(pool) => {
            // For MySQL, `schema` is the database name.
            let mut conn = pool.get_conn().await.map_err(|e| e.to_string())?;
            let rows: Vec<mysql_async::Row> = conn
                .exec(
                    "SELECT TABLE_NAME, TABLE_TYPE \
                     FROM information_schema.TABLES \
                     WHERE TABLE_SCHEMA = ? \
                     ORDER BY TABLE_TYPE, TABLE_NAME",
                    (&schema,),
                )
                .await
                .map_err(|e| e.to_string())?;

            let mut tables = Vec::new();
            let mut views = Vec::new();
            for row in &rows {
                let name = mysql_str(row, 0).unwrap_or_default();
                let table_type = mysql_str(row, 1).unwrap_or_default();
                if table_type == "BASE TABLE" {
                    tables.push(TableSummary { name, estimated_row_count: None });
                } else if table_type == "VIEW" {
                    views.push(name);
                }
            }

            Ok(SchemaObjects {
                tables,
                views,
                sequences: vec![],
                functions: vec![],
            })
        }
    }
}

// ─── list_columns ────────────────────────────────────────────────────────────

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

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await.map_err(|e| e.to_string())?;
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
                       ) AS is_foreign_key, \
                       EXISTS ( \
                         SELECT 1 \
                         FROM pg_type t \
                         JOIN pg_namespace n ON n.oid = t.typnamespace \
                         WHERE t.typname = c.udt_name \
                           AND n.nspname = c.udt_schema \
                           AND t.typtype = 'e' \
                       ) AS is_enum \
                     FROM information_schema.columns c \
                     WHERE c.table_schema = $1 AND c.table_name = $2 \
                     ORDER BY c.ordinal_position",
                    &[&schema, &table],
                )
                .await
                .map_err(|e| e.to_string())?;

            Ok(rows
                .iter()
                .map(|r| ColumnDef {
                    name: r.get(0),
                    data_type: r.get(1),
                    is_nullable: r.get(2),
                    column_default: r.get(3),
                    is_primary_key: r.get(4),
                    is_foreign_key: r.get(5),
                    foreign_key_ref: None,
                    is_enum: r.get(6),
                })
                .collect())
        }
        DriverSession::Mysql(pool) => {
            // For MySQL, `schema` is the database name.
            let mut conn = pool.get_conn().await.map_err(|e| e.to_string())?;
            let rows: Vec<mysql_async::Row> = conn
                .exec(
                    "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT \
                     FROM information_schema.COLUMNS \
                     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
                     ORDER BY ORDINAL_POSITION",
                    (&schema, &table),
                )
                .await
                .map_err(|e| e.to_string())?;

            Ok(rows
                .iter()
                .map(|r| {
                    let col_type = mysql_str(r, 1).unwrap_or_default();
                    let col_key = mysql_str(r, 3).unwrap_or_default();
                    let is_enum = col_type.to_lowercase().starts_with("enum");
                    ColumnDef {
                        name: mysql_str(r, 0).unwrap_or_default(),
                        data_type: col_type,
                        is_nullable: mysql_str(r, 2).as_deref() == Some("YES"),
                        column_default: mysql_str(r, 4),
                        is_primary_key: col_key == "PRI",
                        is_foreign_key: col_key == "MUL",
                        foreign_key_ref: None,
                        is_enum,
                    }
                })
                .collect())
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn mysql_str(row: &mysql_async::Row, idx: usize) -> Option<String> {
    use mysql_async::Value;
    match row.as_ref(idx)? {
        Value::NULL => None,
        Value::Bytes(b) => Some(String::from_utf8_lossy(b).into_owned()),
        Value::Int(n) => Some(n.to_string()),
        Value::UInt(n) => Some(n.to_string()),
        Value::Float(f) => Some(f.to_string()),
        Value::Double(f) => Some(f.to_string()),
        Value::Date(y, m, d, h, min, s, _) => {
            if *h == 0 && *min == 0 && *s == 0 {
                Some(format!("{y:04}-{m:02}-{d:02}"))
            } else {
                Some(format!("{y:04}-{m:02}-{d:02} {h:02}:{min:02}:{s:02}"))
            }
        }
        Value::Time(neg, days, h, min, s, _) => {
            let sign = if *neg { "-" } else { "" };
            let total_h = days * 24 + *h as u32;
            Some(format!("{sign}{total_h:02}:{min:02}:{s:02}"))
        }
    }
}
