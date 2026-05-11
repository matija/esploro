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

fn pg_cast_for_udt(udt: &str) -> &'static str {
    match udt {
        "int2" | "int4" | "int8" => "bigint",
        "float4" | "float8" | "numeric" | "money" => "numeric",
        "date" => "date",
        "timestamp" | "timestamptz" => "timestamptz",
        "timetz" | "time" => "time",
        "bool" | "boolean" => "boolean",
        "uuid" => "uuid",
        _ => "text",
    }
}

#[derive(Deserialize)]
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnFilter {
    pub column: String,
    pub operator: FilterOperator,
    pub value: Option<String>,
}

#[derive(Deserialize)]
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

#[derive(Deserialize)]
pub enum SortDirection {
    Asc,
    Desc,
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
    pub page: u32,
    pub page_size: u32,
    pub execution_ms: u64,
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
        PoolHandle::Pg(pool) => query_table_pg(pool, request).await,
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
        PoolHandle::Pg(pool) => count_table_pg(pool, request).await,
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

    let mut param_values: Vec<String> = vec![];
    let mut where_clauses: Vec<String> = vec![];

    for filter in &request.filters {
        validate_identifier(&filter.column)?;
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
                    FilterOperator::Eq => format!("{col_q} = ${p}::{cast}"),
                    FilterOperator::Neq => format!("{col_q} != ${p}::{cast}"),
                    FilterOperator::Gt => format!("{col_q} > ${p}::{cast}"),
                    FilterOperator::Lt => format!("{col_q} < ${p}::{cast}"),
                    FilterOperator::Gte => format!("{col_q} >= ${p}::{cast}"),
                    FilterOperator::Lte => format!("{col_q} <= ${p}::{cast}"),
                    _ => unreachable!(),
                }
            }
        };
        where_clauses.push(clause);
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let order_sql = match (&request.sort_column, &request.sort_direction) {
        (Some(col), Some(dir)) => {
            validate_identifier(col)?;
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

    let data_sql = format!(
        "SELECT {col_select} FROM \"{}\".\"{}\" {where_sql} {order_sql} LIMIT {limit} OFFSET {offset}",
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

    let rows: Vec<Vec<CellValue>> = data_rows
        .iter()
        .map(|row| {
            result_columns
                .iter()
                .enumerate()
                .map(|(i, col)| {
                    let udt = col_type_map.get(&col.name).map(|s| s.as_str()).unwrap_or("text");
                    pg_cell_value(row, i, udt)
                })
                .collect()
        })
        .collect();

    Ok(TableQueryResult {
        columns: result_columns,
        rows,
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

    let mut param_values: Vec<String> = vec![];
    let mut where_clauses: Vec<String> = vec![];
    for filter in &request.filters {
        validate_identifier(&filter.column)?;
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
                format!("{col_q}::text LIKE ${}", param_values.len())
            }
            FilterOperator::ILike => {
                param_values.push(filter.value.clone().unwrap_or_default());
                format!("{col_q}::text ILIKE ${}", param_values.len())
            }
            _ => {
                param_values.push(filter.value.clone().unwrap_or_default());
                let p = param_values.len();
                let cast = pg_cast_for_udt(udt);
                match filter.operator {
                    FilterOperator::Eq => format!("{col_q} = ${p}::{cast}"),
                    FilterOperator::Neq => format!("{col_q} != ${p}::{cast}"),
                    FilterOperator::Gt => format!("{col_q} > ${p}::{cast}"),
                    FilterOperator::Lt => format!("{col_q} < ${p}::{cast}"),
                    FilterOperator::Gte => format!("{col_q} >= ${p}::{cast}"),
                    FilterOperator::Lte => format!("{col_q} <= ${p}::{cast}"),
                    _ => unreachable!(),
                }
            }
        };
        where_clauses.push(clause);
    }

    let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = param_values
        .iter()
        .map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync))
        .collect();

    // When there are no filters, use reltuples as an instant estimate.
    if where_clauses.is_empty() {
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

    // Build WHERE clause using ? placeholders
    let mut param_values: Vec<mysql_async::Value> = vec![];
    let mut where_clauses: Vec<String> = vec![];

    for filter in &request.filters {
        validate_identifier(&filter.column)?;
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

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let order_sql = match (&request.sort_column, &request.sort_direction) {
        (Some(col), Some(dir)) => {
            validate_identifier(col)?;
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

    let mut param_values: Vec<mysql_async::Value> = vec![];
    let mut where_clauses: Vec<String> = vec![];
    for filter in &request.filters {
        validate_identifier(&filter.column)?;
        let col_q = format!("`{}`", filter.column);
        let clause = match filter.operator {
            FilterOperator::IsNull => format!("{col_q} IS NULL"),
            FilterOperator::IsNotNull => format!("{col_q} IS NOT NULL"),
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
        PoolHandle::Pg(pool) => execute_sql_pg(pool, sql).await,
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
            | "text" | "varchar" | "bpchar" | "char" | "name" | "citext" | "uuid"
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
        // text-like types: String FromSql works for text, varchar, bpchar, char, name, citext, uuid
        "text" | "varchar" | "bpchar" | "char" | "name" | "citext" | "uuid" => {
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
