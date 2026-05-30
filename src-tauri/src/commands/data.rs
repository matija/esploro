use std::collections::HashMap;
use std::time::Instant;

use mysql_async::prelude::Queryable;
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio_postgres::SimpleQueryMessage;

use crate::{AppState, DriverSession};

fn validate_identifier(s: &str) -> Result<(), String> {
    if s.is_empty() {
        return Err("Identifier cannot be empty".into());
    }
    let mut chars = s.chars();
    let first = chars.next().unwrap();
    if !first.is_alphabetic() && first != '_' {
        return Err(format!("Invalid identifier: '{s}'"));
    }
    if !s
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '$')
    {
        return Err(format!("Invalid identifier: '{s}'"));
    }
    Ok(())
}

// Relaxed validation for column names that are always emitted with quoting
// (PG: "col", MySQL: `col`). Only rejects chars that break the quoting itself.
fn validate_column_identifier(s: &str) -> Result<(), String> {
    if s.is_empty() {
        return Err("Identifier cannot be empty".into());
    }
    if s.contains('\0') || s.contains('"') || s.contains('`') {
        return Err(format!("Invalid identifier: '{s}'"));
    }
    Ok(())
}

fn pg_cast_for_udt(udt: &str) -> &'static str {
    match udt {
        "int2" | "int4" | "int8" => "bigint",
        "float4" | "float8" | "numeric" | "money" => "numeric",
        "date" => "date",
        "timestamp" | "timestamptz" => "timestamptz",
        "timetz" | "time" => "time",
        "bool" | "boolean" => "boolean",
        "uuid" => "uuid",
        "json" => "json",
        "jsonb" => "jsonb",
        _ => "text",
    }
}

// Convert a JSON-array string (e.g. `[1, 2, 3]`) to a PostgreSQL array literal
// (e.g. `{1,2,3}`).  Each element is double-quoted to let Postgres do the type
// coercion from text.  NULL JSON elements become SQL NULL elements.
fn json_to_pg_array_literal(json_str: &str) -> Result<String, String> {
    let arr: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("Invalid JSON array: {e}"))?;
    let elements = arr
        .as_array()
        .ok_or_else(|| "Expected a JSON array".to_string())?;
    let parts: Vec<String> = elements
        .iter()
        .map(|v| {
            if v.is_null() {
                "NULL".to_string()
            } else {
                let s = match v {
                    serde_json::Value::Number(n) => n.to_string(),
                    serde_json::Value::Bool(b) => if *b { "true" } else { "false" }.to_string(),
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                // PG array element: double-quote and escape backslashes and double-quotes
                let escaped = s.replace('\\', "\\\\").replace('"', "\\\"");
                format!("\"{escaped}\"")
            }
        })
        .collect();
    Ok(format!("{{{}}}", parts.join(",")))
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TableQueryRequest {
    #[allow(dead_code)]
    pub database: String,
    pub schema: String,
    pub table: String,
    pub filters: Vec<ColumnFilter>,
    pub sort_column: Option<String>,
    pub sort_direction: Option<SortDirection>,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColumnFilter {
    pub column: String,
    pub operator: FilterOperator,
    pub value: Option<String>,
}

#[derive(Deserialize, Clone)]
pub enum FilterOperator {
    Eq,
    Neq,
    Like,
    ILike,
    Gt,
    Lt,
    Gte,
    Lte,
    IsNull,
    IsNotNull,
}

#[derive(Deserialize, Clone)]
pub enum SortDirection {
    Asc,
    Desc,
}

fn is_pg_connection_err(e: &str) -> bool {
    // SQLSTATE: 57P01=admin_shutdown, 57P02=crash_shutdown, 08006=connection_failure
    e.contains("57P01")
        || e.contains("57P02")
        || e.contains("08006")
        || {
            let lower = e.to_lowercase();
            lower.contains("connection closed")
                || lower.contains("broken pipe")
                || lower.contains("connection reset")
                || lower.contains("unexpected eof")
        }
}

// Tagged cell value sent to the frontend.
// serde serialises as {"t":"null"} or {"t":"int","v":42} etc.
#[derive(Serialize, Clone)]
#[serde(tag = "t", content = "v", rename_all = "lowercase")]
pub enum CellValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
    Json(serde_json::Value),
    Other(String),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableQueryResult {
    pub columns: Vec<ResultColumn>,
    pub rows: Vec<Vec<CellValue>>,
    pub ctids: Vec<Option<String>>,
    pub page: u32,
    pub page_size: u32,
    pub execution_ms: u64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PkCondition {
    pub column: String,
    pub value: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColumnChange {
    pub column: String,
    pub value: Option<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RowChange {
    pub pk_conditions: Vec<PkCondition>,
    pub ctid: Option<String>,
    pub column_changes: Vec<ColumnChange>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRowsRequest {
    pub schema: String,
    pub table: String,
    pub changes: Vec<RowChange>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCountResult {
    pub count: i64,
    pub is_estimate: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResultColumn {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary_key: bool,
    pub is_foreign_key: bool,
}

// ─── PG WHERE clause builder ─────────────────────────────────────────────────

// Returns (where_clauses, param_values).
// All typed casts use $p::text::{cast} so PostgreSQL infers $p as text during
// the extended query describe phase, which &String serialises cleanly.
fn build_pg_where_clause(
    filters: &[ColumnFilter],
    col_type_map: &HashMap<String, String>,
) -> Result<(Vec<String>, Vec<String>), String> {
    let mut param_values: Vec<String> = vec![];
    let mut where_clauses: Vec<String> = vec![];

    for filter in filters {
        validate_column_identifier(&filter.column)?;
        let col_q = format!("\"{}\"", filter.column);
        let udt = col_type_map
            .get(&filter.column)
            .map(|s| s.as_str())
            .unwrap_or("text");

        let clause = match filter.operator {
            FilterOperator::IsNull => format!("{col_q} IS NULL"),
            FilterOperator::IsNotNull => format!("{col_q} IS NOT NULL"),
            FilterOperator::Like => {
                param_values.push(filter.value.clone().unwrap_or_default());
                let p = param_values.len();
                format!("{col_q}::text LIKE ${p}")
            }
            FilterOperator::ILike => {
                param_values.push(filter.value.clone().unwrap_or_default());
                let p = param_values.len();
                format!("{col_q}::text ILIKE ${p}")
            }
            _ => {
                param_values.push(filter.value.clone().unwrap_or_default());
                let p = param_values.len();
                let cast = pg_cast_for_udt(udt);
                match filter.operator {
                    FilterOperator::Eq => format!("{col_q} = ${p}::text::{cast}"),
                    FilterOperator::Neq => format!("{col_q} != ${p}::text::{cast}"),
                    FilterOperator::Gt => format!("{col_q} > ${p}::text::{cast}"),
                    FilterOperator::Lt => format!("{col_q} < ${p}::text::{cast}"),
                    FilterOperator::Gte => format!("{col_q} >= ${p}::text::{cast}"),
                    FilterOperator::Lte => format!("{col_q} <= ${p}::text::{cast}"),
                    _ => unreachable!(),
                }
            }
        };
        where_clauses.push(clause);
    }

    Ok((where_clauses, param_values))
}

fn build_mysql_where_clause(
    filters: &[ColumnFilter],
) -> Result<(Vec<String>, Vec<mysql_async::Value>), String> {
    let mut param_values: Vec<mysql_async::Value> = vec![];
    let mut where_clauses: Vec<String> = vec![];

    for filter in filters {
        validate_column_identifier(&filter.column)?;
        let col_q = format!("`{}`", filter.column);

        let clause = match filter.operator {
            FilterOperator::IsNull => format!("{col_q} IS NULL"),
            FilterOperator::IsNotNull => format!("{col_q} IS NOT NULL"),
            // MySQL LIKE is case-insensitive by default (UTF-8); treat ILike as Like
            FilterOperator::Like | FilterOperator::ILike => {
                param_values.push(mysql_async::Value::Bytes(
                    filter.value.clone().unwrap_or_default().into_bytes(),
                ));
                format!("CAST({col_q} AS CHAR) LIKE ?")
            }
            _ => {
                param_values.push(mysql_async::Value::Bytes(
                    filter.value.clone().unwrap_or_default().into_bytes(),
                ));
                match filter.operator {
                    FilterOperator::Eq => format!("{col_q} = ?"),
                    FilterOperator::Neq => format!("{col_q} != ?"),
                    FilterOperator::Gt => format!("{col_q} > ?"),
                    FilterOperator::Lt => format!("{col_q} < ?"),
                    FilterOperator::Gte => format!("{col_q} >= ?"),
                    FilterOperator::Lte => format!("{col_q} <= ?"),
                    _ => unreachable!(),
                }
            }
        };
        where_clauses.push(clause);
    }

    Ok((where_clauses, param_values))
}

// ─── query_table_data / query_table_count ────────────────────────────────────

enum PoolHandle {
    Pg(std::sync::Arc<deadpool_postgres::Pool>),
    Mysql(std::sync::Arc<mysql_async::Pool>),
}

fn resolve_pool(
    sessions: &std::collections::HashMap<String, crate::SessionInfo>,
    session_id: &str,
) -> Result<PoolHandle, String> {
    let info = sessions
        .get(session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    Ok(match &info.driver {
        DriverSession::Postgres(pool) => PoolHandle::Pg(pool.clone()),
        DriverSession::Mysql(pool) => PoolHandle::Mysql(pool.clone()),
    })
}

#[tauri::command]
pub async fn query_table_data(
    session_id: String,
    request: TableQueryRequest,
    state: State<'_, AppState>,
) -> Result<TableQueryResult, String> {
    validate_identifier(&request.schema)?;
    validate_identifier(&request.table)?;

    let handle = {
        let sessions = state.sessions.lock().await;
        resolve_pool(&sessions, &session_id)?
    };

    match handle {
        PoolHandle::Pg(pool) => {
            match query_table_pg(pool.clone(), request.clone()).await {
                Err(ref e) if is_pg_connection_err(e) => query_table_pg(pool, request).await,
                other => other,
            }
        }
        PoolHandle::Mysql(pool) => query_table_mysql(pool, request).await,
    }
}

#[tauri::command]
pub async fn query_table_count(
    session_id: String,
    request: TableQueryRequest,
    state: State<'_, AppState>,
) -> Result<TableCountResult, String> {
    validate_identifier(&request.schema)?;
    validate_identifier(&request.table)?;

    let handle = {
        let sessions = state.sessions.lock().await;
        resolve_pool(&sessions, &session_id)?
    };

    match handle {
        PoolHandle::Pg(pool) => {
            match count_table_pg(pool.clone(), request.clone()).await {
                Err(ref e) if is_pg_connection_err(e) => count_table_pg(pool, request).await,
                other => other,
            }
        }
        PoolHandle::Mysql(pool) => count_table_mysql(pool, request).await,
    }
}

async fn query_table_pg(
    pool: std::sync::Arc<deadpool_postgres::Pool>,
    request: TableQueryRequest,
) -> Result<TableQueryResult, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;

    let col_rows = client
        .query(
            "SELECT c.column_name, c.udt_name, c.is_nullable \
             FROM information_schema.columns c \
             WHERE c.table_schema = $1 AND c.table_name = $2 \
             ORDER BY c.ordinal_position",
            &[&request.schema, &request.table],
        )
        .await
        .map_err(|e| e.to_string())?;

    if col_rows.is_empty() {
        return Err(format!(
            "Table \"{}\".\"{}\" not found or has no columns",
            request.schema, request.table
        ));
    }

    let pk_cols: std::collections::HashSet<String> = client
        .query(
            "SELECT a.attname \
             FROM pg_index i \
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) \
             WHERE i.indrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass \
               AND i.indisprimary",
            &[&request.schema, &request.table],
        )
        .await
        .unwrap_or_default()
        .iter()
        .map(|r| r.get::<_, String>(0))
        .collect();

    let fk_cols: std::collections::HashSet<String> = client
        .query(
            "SELECT DISTINCT a.attname \
             FROM pg_constraint con \
             JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey) \
             WHERE con.conrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass \
               AND con.contype = 'f'",
            &[&request.schema, &request.table],
        )
        .await
        .unwrap_or_default()
        .iter()
        .map(|r| r.get::<_, String>(0))
        .collect();

    let result_columns: Vec<ResultColumn> = col_rows
        .iter()
        .map(|r| {
            let name: String = r.get(0);
            ResultColumn {
                is_nullable: r.get::<_, String>(2) == "YES",
                is_primary_key: pk_cols.contains(&name),
                is_foreign_key: fk_cols.contains(&name),
                data_type: r.get(1),
                name,
            }
        })
        .collect();

    let col_type_map: HashMap<String, String> = col_rows
        .iter()
        .map(|r| (r.get::<_, String>(0), r.get::<_, String>(1)))
        .collect();

    let (where_clauses, param_values) =
        build_pg_where_clause(&request.filters, &col_type_map)?;

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let order_sql = match (&request.sort_column, &request.sort_direction) {
        (Some(col), Some(dir)) => {
            validate_column_identifier(col)?;
            let d = match dir {
                SortDirection::Asc => "ASC",
                SortDirection::Desc => "DESC",
            };
            format!("ORDER BY \"{col}\" {d}")
        }
        _ => String::new(),
    };

    // Select natively-typed columns without cast; cast everything else to text.
    let col_select: String = result_columns
        .iter()
        .map(|c| {
            let udt = col_type_map.get(&c.name).map(|s| s.as_str()).unwrap_or("text");
            if pg_native_udt(udt) {
                format!("\"{}\"", c.name)
            } else {
                format!("\"{}\"::text", c.name)
            }
        })
        .collect::<Vec<_>>()
        .join(", ");

    let offset = (request.page * request.page_size) as i64;
    let limit = request.page_size as i64;

    // ctid_idx is the index of the appended ctid column in each result row
    let ctid_idx = result_columns.len();

    let data_sql = format!(
        "SELECT {col_select}, ctid::text AS __ctid FROM \"{}\".\"{}\" {where_sql} {order_sql} LIMIT {limit} OFFSET {offset}",
        request.schema, request.table
    );

    let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = param_values
        .iter()
        .map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync))
        .collect();

    let start = Instant::now();
    let data_rows = client
        .query(data_sql.as_str(), params.as_slice())
        .await
        .map_err(|e| e.to_string())?;
    let execution_ms = start.elapsed().as_millis() as u64;

    let mut rows: Vec<Vec<CellValue>> = Vec::with_capacity(data_rows.len());
    let mut ctids: Vec<Option<String>> = Vec::with_capacity(data_rows.len());

    for row in &data_rows {
        let cells: Vec<CellValue> = result_columns
            .iter()
            .enumerate()
            .map(|(i, col)| {
                let udt = col_type_map.get(&col.name).map(|s| s.as_str()).unwrap_or("text");
                pg_cell_value(row, i, udt)
            })
            .collect();
        rows.push(cells);
        ctids.push(row.try_get::<_, Option<String>>(ctid_idx).ok().flatten());
    }

    Ok(TableQueryResult {
        columns: result_columns,
        rows,
        ctids,
        page: request.page,
        page_size: request.page_size,
        execution_ms,
    })
}

async fn count_table_pg(
    pool: std::sync::Arc<deadpool_postgres::Pool>,
    request: TableQueryRequest,
) -> Result<TableCountResult, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;

    // Fast path: no filters → use reltuples estimate without querying information_schema.
    if request.filters.is_empty() {
        let estimate_row = client
            .query_opt(
                "SELECT reltuples::bigint FROM pg_class \
                 WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1) \
                   AND relname = $2 AND reltuples >= 0",
                &[&request.schema, &request.table],
            )
            .await
            .map_err(|e| e.to_string())?;
        if let Some(row) = estimate_row {
            let count: i64 = row.get(0);
            return Ok(TableCountResult { count, is_estimate: true });
        }
    }

    // Build WHERE from filters (same logic as query_table_pg)
    let col_type_map: HashMap<String, String> = client
        .query(
            "SELECT column_name, udt_name FROM information_schema.columns \
             WHERE table_schema = $1 AND table_name = $2",
            &[&request.schema, &request.table],
        )
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|r| (r.get::<_, String>(0), r.get::<_, String>(1)))
        .collect();

    let (where_clauses, param_values) =
        build_pg_where_clause(&request.filters, &col_type_map)?;

    let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = param_values
        .iter()
        .map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync))
        .collect();

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };
    let count_sql = format!(
        "SELECT COUNT(*) FROM \"{}\".\"{}\" {where_sql}",
        request.schema, request.table
    );
    let row = client
        .query_one(count_sql.as_str(), params.as_slice())
        .await
        .map_err(|e| e.to_string())?;
    Ok(TableCountResult { count: row.get(0), is_estimate: false })
}

async fn query_table_mysql(
    pool: std::sync::Arc<mysql_async::Pool>,
    request: TableQueryRequest,
) -> Result<TableQueryResult, String> {
    // For MySQL, `schema` is the database name.
    let mut conn = pool.get_conn().await.map_err(|e| e.to_string())?;

    // Fetch column metadata from INFORMATION_SCHEMA
    let col_rows: Vec<mysql_async::Row> = conn
        .exec(
            "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY \
             FROM information_schema.COLUMNS \
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
             ORDER BY ORDINAL_POSITION",
            (&request.schema, &request.table),
        )
        .await
        .map_err(|e| e.to_string())?;

    if col_rows.is_empty() {
        return Err(format!(
            "Table `{}`.`{}` not found or has no columns",
            request.schema, request.table
        ));
    }

    let result_columns: Vec<ResultColumn> = col_rows
        .iter()
        .map(|r| {
            let col_key = mysql_str(r, 3).unwrap_or_default();
            ResultColumn {
                name: mysql_str(r, 0).unwrap_or_default(),
                data_type: mysql_str(r, 1).unwrap_or_default(),
                is_nullable: mysql_str(r, 2).as_deref() == Some("YES"),
                is_primary_key: col_key == "PRI",
                is_foreign_key: col_key == "MUL",
            }
        })
        .collect();

    let (where_clauses, param_values) = build_mysql_where_clause(&request.filters)?;
    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let order_sql = match (&request.sort_column, &request.sort_direction) {
        (Some(col), Some(dir)) => {
            validate_column_identifier(col)?;
            let d = match dir {
                SortDirection::Asc => "ASC",
                SortDirection::Desc => "DESC",
            };
            format!("ORDER BY `{col}` {d}")
        }
        _ => String::new(),
    };

    let col_select: String = result_columns
        .iter()
        .map(|c| format!("`{}`", c.name))
        .collect::<Vec<_>>()
        .join(", ");

    let offset = (request.page * request.page_size) as u64;
    let limit = request.page_size as u64;

    let data_sql = format!(
        "SELECT {col_select} FROM `{}`.`{}` {where_sql} {order_sql} LIMIT {limit} OFFSET {offset}",
        request.schema, request.table
    );

    let start = Instant::now();
    let data_rows = conn
        .exec::<mysql_async::Row, _, _>(data_sql.as_str(), param_values)
        .await
        .map_err(|e| e.to_string())?;
    let execution_ms = start.elapsed().as_millis() as u64;

    let rows: Vec<Vec<CellValue>> = data_rows
        .iter()
        .map(|row| {
            (0..result_columns.len())
                .map(|i| mysql_cell_value(row, i))
                .collect()
        })
        .collect();

    Ok(TableQueryResult {
        columns: result_columns,
        rows,
        ctids: vec![],
        page: request.page,
        page_size: request.page_size,
        execution_ms,
    })
}

async fn count_table_mysql(
    pool: std::sync::Arc<mysql_async::Pool>,
    request: TableQueryRequest,
) -> Result<TableCountResult, String> {
    let mut conn = pool.get_conn().await.map_err(|e| e.to_string())?;

    let (where_clauses, param_values) = build_mysql_where_clause(&request.filters)?;
    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };
    let count_sql = format!(
        "SELECT COUNT(*) FROM `{}`.`{}` {where_sql}",
        request.schema, request.table
    );
    let count_rows = conn
        .exec::<mysql_async::Row, _, _>(count_sql.as_str(), param_values)
        .await
        .map_err(|e| e.to_string())?;
    let count = count_rows
        .first()
        .and_then(|r| mysql_str(r, 0))
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    Ok(TableCountResult { count, is_estimate: false })
}

// ─── update_rows ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn update_rows(
    session_id: String,
    request: UpdateRowsRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    validate_identifier(&request.schema)?;
    validate_identifier(&request.table)?;

    let handle = {
        let sessions = state.sessions.lock().await;
        resolve_pool(&sessions, &session_id)?
    };

    match handle {
        PoolHandle::Pg(pool) => {
            match update_rows_pg(pool.clone(), request.clone()).await {
                Err(ref e) if is_pg_connection_err(e) => update_rows_pg(pool, request).await,
                other => other,
            }
        }
        PoolHandle::Mysql(pool) => update_rows_mysql(pool, request).await,
    }
}

async fn update_rows_pg(
    pool: std::sync::Arc<deadpool_postgres::Pool>,
    request: UpdateRowsRequest,
) -> Result<(), String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;

    let col_type_map: HashMap<String, String> = client
        .query(
            "SELECT column_name, udt_name FROM information_schema.columns \
             WHERE table_schema = $1 AND table_name = $2",
            &[&request.schema, &request.table],
        )
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|r| (r.get::<_, String>(0), r.get::<_, String>(1)))
        .collect();

    client.batch_execute("BEGIN").await.map_err(|e| e.to_string())?;

    for change in &request.changes {
        if change.column_changes.is_empty() {
            continue;
        }

        for cc in &change.column_changes {
            validate_column_identifier(&cc.column)?;
        }
        for pk in &change.pk_conditions {
            validate_column_identifier(&pk.column)?;
        }

        let mut params: Vec<String> = vec![];
        let mut set_parts: Vec<String> = vec![];

        for cc in &change.column_changes {
            if let Some(ref val) = cc.value {
                let udt = col_type_map.get(&cc.column).map(|s| s.as_str()).unwrap_or("text");
                if udt.starts_with('_') {
                    // PG array type: convert JSON array to PG array literal
                    let elem_type = udt.trim_start_matches('_');
                    let pg_array = match json_to_pg_array_literal(val) {
                        Ok(v) => v,
                        Err(e) => {
                            client.batch_execute("ROLLBACK").await.ok();
                            return Err(e);
                        }
                    };
                    params.push(pg_array);
                    let p = params.len();
                    set_parts.push(format!("\"{}\" = ${}::text::{}[]", cc.column, p, elem_type));
                } else {
                    params.push(val.clone());
                    let p = params.len();
                    let cast = pg_cast_for_udt(udt);
                    set_parts.push(format!("\"{}\" = ${}::text::{}", cc.column, p, cast));
                }
            } else {
                set_parts.push(format!("\"{}\" = NULL", cc.column));
            }
        }

        let where_clause = if !change.pk_conditions.is_empty() {
            let mut parts = vec![];
            for pk in &change.pk_conditions {
                params.push(pk.value.clone());
                let p = params.len();
                let udt = col_type_map.get(&pk.column).map(|s| s.as_str()).unwrap_or("text");
                let cast = pg_cast_for_udt(udt);
                parts.push(format!("\"{}\" = ${}::text::{}", pk.column, p, cast));
            }
            parts.join(" AND ")
        } else if let Some(ref ctid) = change.ctid {
            params.push(ctid.clone());
            let p = params.len();
            format!("ctid = ${}::tid", p)
        } else {
            client.batch_execute("ROLLBACK").await.ok();
            return Err("Row change has no PK conditions and no ctid".to_string());
        };

        let sql = format!(
            "UPDATE \"{}\".\"{}\" SET {} WHERE {}",
            request.schema, request.table,
            set_parts.join(", "),
            where_clause
        );

        let pg_params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = params
            .iter()
            .map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync))
            .collect();

        if let Err(e) = client.execute(sql.as_str(), pg_params.as_slice()).await {
            client.batch_execute("ROLLBACK").await.ok();
            return Err(e.to_string());
        }
    }

    client.batch_execute("COMMIT").await.map_err(|e| e.to_string())
}

async fn update_rows_mysql(
    pool: std::sync::Arc<mysql_async::Pool>,
    request: UpdateRowsRequest,
) -> Result<(), String> {
    let mut conn = pool.get_conn().await.map_err(|e| e.to_string())?;

    // Look up PK columns — required for MySQL (no ctid)
    let pk_cols: std::collections::HashSet<String> = {
        let rows: Vec<mysql_async::Row> = conn
            .exec(
                "SELECT COLUMN_NAME FROM information_schema.COLUMNS \
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_KEY = 'PRI'",
                (&request.schema, &request.table),
            )
            .await
            .map_err(|e| e.to_string())?;
        rows.iter().filter_map(|r| mysql_str(r, 0)).collect()
    };

    if pk_cols.is_empty() {
        return Err(
            "Inline editing requires a primary key — this table has none".to_string(),
        );
    }

    conn.exec_drop("START TRANSACTION", ()).await.map_err(|e| e.to_string())?;

    let result: Result<(), String> = (async {
        for change in &request.changes {
            if change.column_changes.is_empty() {
                continue;
            }
            for cc in &change.column_changes {
                validate_column_identifier(&cc.column)?;
            }
            for pk in &change.pk_conditions {
                validate_column_identifier(&pk.column)?;
            }

            let mut set_params: Vec<mysql_async::Value> = vec![];
            let mut set_parts: Vec<String> = vec![];

            for cc in &change.column_changes {
                if let Some(ref val) = cc.value {
                    set_parts.push(format!("`{}` = ?", cc.column));
                    set_params.push(mysql_async::Value::Bytes(val.as_bytes().to_vec()));
                } else {
                    set_parts.push(format!("`{}` = NULL", cc.column));
                }
            }

            if change.pk_conditions.is_empty() {
                return Err("MySQL row change has no PK conditions".to_string());
            }

            let mut where_parts: Vec<String> = vec![];
            let mut where_params: Vec<mysql_async::Value> = vec![];
            for pk in &change.pk_conditions {
                where_parts.push(format!("`{}` = ?", pk.column));
                where_params.push(mysql_async::Value::Bytes(pk.value.as_bytes().to_vec()));
            }

            let sql = format!(
                "UPDATE `{}`.`{}` SET {} WHERE {}",
                request.schema,
                request.table,
                set_parts.join(", "),
                where_parts.join(" AND "),
            );

            let all_params: Vec<mysql_async::Value> = set_params
                .into_iter()
                .chain(where_params)
                .collect();

            conn.exec_drop(sql.as_str(), all_params)
                .await
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await;

    if result.is_err() {
        conn.exec_drop("ROLLBACK", ()).await.ok();
        return result;
    }
    conn.exec_drop("COMMIT", ()).await.map_err(|e| e.to_string())
}

// ─── preview_update_rows_sql ─────────────────────────────────────────────────

fn sql_escape_string(s: &str) -> String {
    s.replace('\'', "''")
}

#[tauri::command]
pub async fn preview_update_rows_sql(
    session_id: String,
    request: UpdateRowsRequest,
    state: State<'_, AppState>,
) -> Result<String, String> {
    validate_identifier(&request.schema)?;
    validate_identifier(&request.table)?;

    let handle = {
        let sessions = state.sessions.lock().await;
        resolve_pool(&sessions, &session_id)?
    };

    match handle {
        PoolHandle::Pg(pool) => preview_update_rows_sql_pg(pool, request).await,
        PoolHandle::Mysql(pool) => preview_update_rows_sql_mysql(pool, request).await,
    }
}

async fn preview_update_rows_sql_pg(
    pool: std::sync::Arc<deadpool_postgres::Pool>,
    request: UpdateRowsRequest,
) -> Result<String, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;

    let col_type_map: HashMap<String, String> = client
        .query(
            "SELECT column_name, udt_name FROM information_schema.columns \
             WHERE table_schema = $1 AND table_name = $2",
            &[&request.schema, &request.table],
        )
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|r| (r.get::<_, String>(0), r.get::<_, String>(1)))
        .collect();

    let mut statements: Vec<String> = vec![];

    for change in &request.changes {
        if change.column_changes.is_empty() {
            continue;
        }
        for cc in &change.column_changes {
            validate_column_identifier(&cc.column)?;
        }
        for pk in &change.pk_conditions {
            validate_column_identifier(&pk.column)?;
        }

        let mut set_parts: Vec<String> = vec![];
        for cc in &change.column_changes {
            let part = match &cc.value {
                None => format!("\"{}\" = NULL", cc.column),
                Some(val) => {
                    let udt = col_type_map.get(&cc.column).map(|s| s.as_str()).unwrap_or("text");
                    if udt.starts_with('_') {
                        let elem_type = udt.trim_start_matches('_');
                        let pg_array = json_to_pg_array_literal(val)?;
                        format!("\"{}\" = '{}'::{}[]", cc.column, sql_escape_string(&pg_array), elem_type)
                    } else {
                        let cast = pg_cast_for_udt(udt);
                        let escaped = sql_escape_string(val);
                        if cast == "text" {
                            format!("\"{}\" = '{}'", cc.column, escaped)
                        } else {
                            format!("\"{}\" = '{}'::{}",  cc.column, escaped, cast)
                        }
                    }
                }
            };
            set_parts.push(part);
        }

        let where_clause = if !change.pk_conditions.is_empty() {
            let parts: Vec<String> = change.pk_conditions.iter().map(|pk| {
                let udt = col_type_map.get(&pk.column).map(|s| s.as_str()).unwrap_or("text");
                let cast = pg_cast_for_udt(udt);
                let escaped = sql_escape_string(&pk.value);
                if cast == "text" {
                    format!("\"{}\" = '{}'", pk.column, escaped)
                } else {
                    format!("\"{}\" = '{}'::{}",  pk.column, escaped, cast)
                }
            }).collect();
            parts.join(" AND ")
        } else if let Some(ref ctid) = change.ctid {
            format!("ctid = '{}'::tid", sql_escape_string(ctid))
        } else {
            return Err("Row change has no PK conditions and no ctid".to_string());
        };

        statements.push(format!(
            "UPDATE \"{}\".\"{}\" SET {} WHERE {};",
            request.schema,
            request.table,
            set_parts.join(", "),
            where_clause,
        ));
    }

    if statements.is_empty() {
        return Ok(String::new());
    }

    Ok(format!(
        "BEGIN;\n-- Generated by Esploro from inline edits. Review before running.\n{}\nCOMMIT;",
        statements.join("\n"),
    ))
}

async fn preview_update_rows_sql_mysql(
    pool: std::sync::Arc<mysql_async::Pool>,
    request: UpdateRowsRequest,
) -> Result<String, String> {
    let mut conn = pool.get_conn().await.map_err(|e| e.to_string())?;

    let pk_exists: bool = {
        let rows: Vec<mysql_async::Row> = conn
            .exec(
                "SELECT 1 FROM information_schema.COLUMNS \
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_KEY = 'PRI' LIMIT 1",
                (&request.schema, &request.table),
            )
            .await
            .map_err(|e| e.to_string())?;
        !rows.is_empty()
    };

    if !pk_exists {
        return Err("Inline editing requires a primary key — this table has none".to_string());
    }

    let mut statements: Vec<String> = vec![];

    for change in &request.changes {
        if change.column_changes.is_empty() {
            continue;
        }
        for cc in &change.column_changes {
            validate_column_identifier(&cc.column)?;
        }
        for pk in &change.pk_conditions {
            validate_column_identifier(&pk.column)?;
        }

        let set_parts: Vec<String> = change.column_changes.iter().map(|cc| {
            match &cc.value {
                None => format!("`{}` = NULL", cc.column),
                Some(val) => format!("`{}` = '{}'", cc.column, sql_escape_string(val)),
            }
        }).collect();

        if change.pk_conditions.is_empty() {
            return Err("MySQL row change has no PK conditions".to_string());
        }

        let where_parts: Vec<String> = change.pk_conditions.iter().map(|pk| {
            format!("`{}` = '{}'", pk.column, sql_escape_string(&pk.value))
        }).collect();

        statements.push(format!(
            "UPDATE `{}`.`{}` SET {} WHERE {};",
            request.schema,
            request.table,
            set_parts.join(", "),
            where_parts.join(" AND "),
        ));
    }

    if statements.is_empty() {
        return Ok(String::new());
    }

    Ok(format!(
        "START TRANSACTION;\n-- Generated by Esploro from inline edits. Review before running.\n{}\nCOMMIT;",
        statements.join("\n"),
    ))
}

// ─── execute_sql ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ResultColumn>,
    pub rows: Vec<Vec<CellValue>>,
    pub rows_affected: Option<u64>,
    pub execution_ms: u64,
    pub error: Option<QueryError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryError {
    pub message: String,
    pub position: Option<u32>,
    pub code: Option<String>,
}

#[tauri::command]
pub async fn execute_sql(
    session_id: String,
    sql: String,
    state: State<'_, AppState>,
) -> Result<Vec<QueryResult>, String> {
    let handle = {
        let sessions = state.sessions.lock().await;
        let info = sessions
            .get(&session_id)
            .ok_or_else(|| "Session not found".to_string())?;
        match &info.driver {
            DriverSession::Postgres(pool) => PoolHandle::Pg(pool.clone()),
            DriverSession::Mysql(pool) => PoolHandle::Mysql(pool.clone()),
        }
    };

    match handle {
        PoolHandle::Pg(pool) => {
            match execute_sql_pg(pool.clone(), sql.clone()).await {
                Err(ref e) if is_pg_connection_err(e) => execute_sql_pg(pool, sql).await,
                other => other,
            }
        }
        PoolHandle::Mysql(pool) => execute_sql_mysql(pool, sql).await,
    }
}

async fn execute_sql_pg(
    pool: std::sync::Arc<deadpool_postgres::Pool>,
    sql: String,
) -> Result<Vec<QueryResult>, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;

    let statements: Vec<&str> = sql
        .split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let mut results: Vec<QueryResult> = vec![];

    for stmt in statements {
        let t0 = Instant::now();
        match client.simple_query(stmt).await {
            Ok(messages) => {
                let execution_ms = t0.elapsed().as_millis() as u64;
                let mut columns: Vec<ResultColumn> = vec![];
                let mut rows: Vec<Vec<CellValue>> = vec![];
                let mut rows_affected: Option<u64> = None;

                for msg in messages {
                    match msg {
                        SimpleQueryMessage::Row(row) => {
                            if columns.is_empty() {
                                columns = (0..row.len())
                                    .map(|i| ResultColumn {
                                        name: row.columns()[i].name().to_string(),
                                        data_type: String::new(),
                                        is_nullable: false,
                                        is_primary_key: false,
                                        is_foreign_key: false,
                                    })
                                    .collect();
                            }
                            rows.push(
                                (0..row.len())
                                    .map(|i| match row.get(i) {
                                        None => CellValue::Null,
                                        Some(s) => CellValue::Text(s.to_string()),
                                    })
                                    .collect(),
                            );
                        }
                        SimpleQueryMessage::CommandComplete(n) => {
                            rows_affected = Some(n);
                        }
                        _ => {}
                    }
                }

                results.push(QueryResult {
                    columns,
                    rows,
                    rows_affected,
                    execution_ms,
                    error: None,
                });
            }
            Err(e) => {
                let execution_ms = t0.elapsed().as_millis() as u64;
                let position = e.as_db_error().and_then(|db| db.position()).and_then(|p| {
                    if let tokio_postgres::error::ErrorPosition::Original(pos) = p {
                        Some(*pos)
                    } else {
                        None
                    }
                });
                let code = e.as_db_error().map(|db| db.code().code().to_string());
                results.push(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    rows_affected: None,
                    execution_ms,
                    error: Some(QueryError {
                        message: e.to_string(),
                        position,
                        code,
                    }),
                });
                break;
            }
        }
    }

    Ok(results)
}

async fn execute_sql_mysql(
    pool: std::sync::Arc<mysql_async::Pool>,
    sql: String,
) -> Result<Vec<QueryResult>, String> {
    let mut conn = pool.get_conn().await.map_err(|e| e.to_string())?;

    let statements: Vec<&str> = sql
        .split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let mut results: Vec<QueryResult> = vec![];

    for stmt in statements {
        let t0 = Instant::now();
        match conn.query::<mysql_async::Row, _>(stmt).await {
            Ok(rows) => {
                let execution_ms = t0.elapsed().as_millis() as u64;
                let rows_affected = if rows.is_empty() {
                    Some(conn.affected_rows())
                } else {
                    None
                };

                let columns: Vec<ResultColumn> = if let Some(first) = rows.first() {
                    first
                        .columns_ref()
                        .iter()
                        .map(|c| ResultColumn {
                            name: c.name_str().into_owned(),
                            data_type: String::new(),
                            is_nullable: false,
                            is_primary_key: false,
                            is_foreign_key: false,
                        })
                        .collect()
                } else {
                    vec![]
                };

                let row_data: Vec<Vec<CellValue>> = rows
                    .iter()
                    .map(|row| (0..row.len()).map(|i| mysql_cell_value(row, i)).collect())
                    .collect();

                results.push(QueryResult {
                    columns,
                    rows: row_data,
                    rows_affected,
                    execution_ms,
                    error: None,
                });
            }
            Err(e) => {
                let execution_ms = t0.elapsed().as_millis() as u64;
                results.push(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    rows_affected: None,
                    execution_ms,
                    error: Some(QueryError {
                        message: e.to_string(),
                        position: None,
                        code: None,
                    }),
                });
                break;
            }
        }
    }

    Ok(results)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn pg_native_udt(udt: &str) -> bool {
    matches!(
        udt,
        "bool" | "boolean"
            | "int2" | "int4" | "int8"
            | "float4" | "float8"
            | "text" | "varchar" | "bpchar" | "char" | "name" | "citext"
            | "json" | "jsonb"
    )
}

fn pg_cell_value(row: &tokio_postgres::Row, i: usize, udt: &str) -> CellValue {
    macro_rules! get_opt {
        ($T:ty, $variant:expr) => {
            match row.try_get::<_, Option<$T>>(i) {
                Ok(None) => CellValue::Null,
                Ok(Some(v)) => $variant(v),
                Err(_) => CellValue::Null,
            }
        };
    }
    match udt {
        "bool" | "boolean" => get_opt!(bool, CellValue::Bool),
        "int2" => get_opt!(i16, |v: i16| CellValue::Int(v as i64)),
        "int4" => get_opt!(i32, |v: i32| CellValue::Int(v as i64)),
        "int8" => get_opt!(i64, CellValue::Int),
        "float4" => get_opt!(f32, |v: f32| CellValue::Float(v as f64)),
        "float8" => get_opt!(f64, CellValue::Float),
        "json" | "jsonb" => get_opt!(serde_json::Value, CellValue::Json),
        // text-like types: String FromSql works for these OIDs
        // uuid is not here — it arrives as ::text via the SELECT cast and is handled by the _ arm
        "text" | "varchar" | "bpchar" | "char" | "name" | "citext" => {
            get_opt!(String, CellValue::Text)
        }
        // Everything else was cast ::text in the SELECT; read as Other.
        _ => match row.try_get::<_, Option<String>>(i) {
            Ok(None) => CellValue::Null,
            Ok(Some(s)) => CellValue::Other(s),
            Err(_) => CellValue::Null,
        },
    }
}

fn mysql_cell_value(row: &mysql_async::Row, idx: usize) -> CellValue {
    use mysql_async::Value;
    match row.as_ref(idx) {
        None | Some(Value::NULL) => CellValue::Null,
        Some(Value::Int(n)) => CellValue::Int(*n),
        Some(Value::UInt(n)) => CellValue::Int(*n as i64),
        Some(Value::Float(f)) => CellValue::Float(*f as f64),
        Some(Value::Double(f)) => CellValue::Float(*f),
        Some(Value::Bytes(b)) => {
            CellValue::Text(String::from_utf8_lossy(b).into_owned())
        }
        Some(Value::Date(y, m, d, h, min, s, _)) => {
            if *h == 0 && *min == 0 && *s == 0 {
                CellValue::Other(format!("{y:04}-{m:02}-{d:02}"))
            } else {
                CellValue::Other(format!("{y:04}-{m:02}-{d:02} {h:02}:{min:02}:{s:02}"))
            }
        }
        Some(Value::Time(neg, days, h, min, s, _)) => {
            let sign = if *neg { "-" } else { "" };
            let total_h = days * 24 + *h as u32;
            CellValue::Other(format!("{sign}{total_h:02}:{min:02}:{s:02}"))
        }
    }
}

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

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn f(col: &str, op: FilterOperator, val: Option<&str>) -> ColumnFilter {
        ColumnFilter { column: col.to_string(), operator: op, value: val.map(str::to_string) }
    }

    #[test]
    fn uuid_eq_uses_text_intermediate() {
        let map = make_map(&[("id", "uuid")]);
        let (clauses, params) =
            build_pg_where_clause(&[f("id", FilterOperator::Eq, Some("abc"))], &map).unwrap();
        assert_eq!(clauses[0], r#""id" = $1::text::uuid"#);
        assert_eq!(params[0], "abc");
    }

    #[test]
    fn date_gt_uses_text_intermediate() {
        let map = make_map(&[("created_at", "date")]);
        let (clauses, params) = build_pg_where_clause(
            &[f("created_at", FilterOperator::Gt, Some("2024-01-01"))],
            &map,
        )
        .unwrap();
        assert_eq!(clauses[0], r#""created_at" > $1::text::date"#);
        assert_eq!(params[0], "2024-01-01");
    }

    #[test]
    fn timestamptz_lt_uses_text_intermediate() {
        let map = make_map(&[("ts", "timestamptz")]);
        let (clauses, _params) = build_pg_where_clause(
            &[f("ts", FilterOperator::Lt, Some("2024-06-01T00:00:00Z"))],
            &map,
        )
        .unwrap();
        assert_eq!(clauses[0], r#""ts" < $1::text::timestamptz"#);
    }

    #[test]
    fn boolean_eq_uses_text_intermediate() {
        let map = make_map(&[("active", "bool")]);
        let (clauses, _) = build_pg_where_clause(
            &[f("active", FilterOperator::Eq, Some("true"))],
            &map,
        )
        .unwrap();
        assert_eq!(clauses[0], r#""active" = $1::text::boolean"#);
    }

    #[test]
    fn numeric_gte_uses_text_intermediate() {
        let map = make_map(&[("amount", "numeric")]);
        let (clauses, params) = build_pg_where_clause(
            &[f("amount", FilterOperator::Gte, Some("100.50"))],
            &map,
        )
        .unwrap();
        assert_eq!(clauses[0], r#""amount" >= $1::text::numeric"#);
        assert_eq!(params[0], "100.50");
    }

    #[test]
    fn text_like_unaffected() {
        let map = make_map(&[("name", "text")]);
        let (clauses, params) =
            build_pg_where_clause(&[f("name", FilterOperator::Like, Some("%foo%"))], &map)
                .unwrap();
        assert_eq!(clauses[0], r#""name"::text LIKE $1"#);
        assert_eq!(params[0], "%foo%");
    }

    #[test]
    fn is_null_produces_no_param() {
        let map = make_map(&[("id", "uuid")]);
        let (clauses, params) =
            build_pg_where_clause(&[f("id", FilterOperator::IsNull, None)], &map).unwrap();
        assert_eq!(clauses[0], r#""id" IS NULL"#);
        assert!(params.is_empty());
    }

    #[test]
    fn multi_filter_params_numbered_sequentially() {
        let map = make_map(&[("id", "uuid"), ("name", "text")]);
        let filters = vec![
            f("id", FilterOperator::Eq, Some("some-uuid")),
            f("name", FilterOperator::Like, Some("%foo%")),
        ];
        let (clauses, params) = build_pg_where_clause(&filters, &map).unwrap();
        assert_eq!(clauses[0], r#""id" = $1::text::uuid"#);
        assert_eq!(clauses[1], r#""name"::text LIKE $2"#);
        assert_eq!(params.len(), 2);
    }
}
