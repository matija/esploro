use std::collections::HashMap;

use mysql_async::prelude::Queryable;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{AppState, DriverSession};

mod row_mutations;
mod sql_execution;
mod table_queries;
mod table_query_execution;
mod type_mapping;
mod where_clauses;

use self::row_mutations::{
    build_mysql_delete_preview_sql, build_mysql_delete_sql, build_mysql_update_preview_sql,
    build_mysql_update_sql, build_pg_delete_preview_statement, build_pg_delete_sql,
    build_pg_update_preview_sql, build_pg_update_sql,
};
use self::sql_execution::{execute_sql_mysql, execute_sql_pg};
use self::table_query_execution::{
    count_table_mysql, count_table_pg, query_table_mysql, query_table_pg,
};
use self::type_mapping::{mysql_str, resolve_pg_cast, CellValue};

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
pub(super) fn validate_column_identifier(s: &str) -> Result<(), String> {
    if s.is_empty() {
        return Err("Identifier cannot be empty".into());
    }
    if s.contains('\0') || s.contains('"') || s.contains('`') {
        return Err(format!("Invalid identifier: '{s}'"));
    }
    Ok(())
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
    #[serde(default)]
    pub raw_where: Option<String>,
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
    e.contains("57P01") || e.contains("57P02") || e.contains("08006") || {
        let lower = e.to_lowercase();
        lower.contains("connection closed")
            || lower.contains("broken pipe")
            || lower.contains("connection reset")
            || lower.contains("unexpected eof")
    }
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

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRowRequest {
    pub pk_conditions: Vec<PkCondition>,
    pub ctid: Option<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRowsRequest {
    pub schema: String,
    pub table: String,
    pub rows: Vec<DeleteRowRequest>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRowResult {
    pub sql: String,
    pub error: Option<String>,
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
    pub is_enum: bool,
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
        PoolHandle::Pg(pool) => match query_table_pg(pool.clone(), request.clone()).await {
            Err(ref e) if is_pg_connection_err(e) => query_table_pg(pool, request).await,
            other => other,
        },
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
        PoolHandle::Pg(pool) => match count_table_pg(pool.clone(), request.clone()).await {
            Err(ref e) if is_pg_connection_err(e) => count_table_pg(pool, request).await,
            other => other,
        },
        PoolHandle::Mysql(pool) => count_table_mysql(pool, request).await,
    }
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
        PoolHandle::Pg(pool) => match update_rows_pg(pool.clone(), request.clone()).await {
            Err(ref e) if is_pg_connection_err(e) => update_rows_pg(pool, request).await,
            other => other,
        },
        PoolHandle::Mysql(pool) => update_rows_mysql(pool, request).await,
    }
}

async fn update_rows_pg(
    pool: std::sync::Arc<deadpool_postgres::Pool>,
    request: UpdateRowsRequest,
) -> Result<(), String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;

    let col_rows: Vec<tokio_postgres::Row> = client
        .query(
            "SELECT column_name, udt_name, data_type FROM information_schema.columns \
             WHERE table_schema = $1 AND table_name = $2",
            &[&request.schema, &request.table],
        )
        .await
        .map_err(|e| e.to_string())?;

    // Keep raw udt_name for array detection (starts with '_').
    let col_type_map: HashMap<String, String> = col_rows
        .iter()
        .map(|r| (r.get::<_, String>(0), r.get::<_, String>(1)))
        .collect();

    // Resolved cast type for UPDATE SET/WHERE casts.
    let col_cast_map: HashMap<String, String> = col_rows
        .iter()
        .map(|r| {
            let name: String = r.get(0);
            let udt_name: String = r.get(1);
            let data_type: String = r.get(2);
            (name, resolve_pg_cast(&udt_name, &data_type))
        })
        .collect();

    client
        .batch_execute("BEGIN")
        .await
        .map_err(|e| e.to_string())?;

    for change in &request.changes {
        if change.column_changes.is_empty() {
            continue;
        }

        let mutation = match build_pg_update_sql(
            &request.schema,
            &request.table,
            change,
            &col_type_map,
            &col_cast_map,
        ) {
            Ok(mutation) => mutation,
            Err(e) => {
                client.batch_execute("ROLLBACK").await.ok();
                return Err(e);
            }
        };

        let pg_params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = mutation
            .params
            .iter()
            .map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync))
            .collect();

        if let Err(e) = client
            .execute(mutation.sql.as_str(), pg_params.as_slice())
            .await
        {
            client.batch_execute("ROLLBACK").await.ok();
            return Err(e.to_string());
        }
    }

    client
        .batch_execute("COMMIT")
        .await
        .map_err(|e| e.to_string())
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
        return Err("Inline editing requires a primary key — this table has none".to_string());
    }

    conn.exec_drop("START TRANSACTION", ())
        .await
        .map_err(|e| e.to_string())?;

    let result: Result<(), String> = (async {
        for change in &request.changes {
            if change.column_changes.is_empty() {
                continue;
            }

            let mutation = build_mysql_update_sql(&request.schema, &request.table, change)?;

            conn.exec_drop(mutation.sql.as_str(), mutation.params)
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
    conn.exec_drop("COMMIT", ())
        .await
        .map_err(|e| e.to_string())
}

// ─── preview_update_rows_sql ─────────────────────────────────────────────────

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

    let col_rows: Vec<tokio_postgres::Row> = client
        .query(
            "SELECT column_name, udt_name, data_type FROM information_schema.columns \
             WHERE table_schema = $1 AND table_name = $2",
            &[&request.schema, &request.table],
        )
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .collect();

    // Raw udt_name needed for array detection (_ prefix).
    let col_type_map: HashMap<String, String> = col_rows
        .iter()
        .map(|r| (r.get::<_, String>(0), r.get::<_, String>(1)))
        .collect();

    // Resolved cast type for UPDATE SET/WHERE casts.
    let col_cast_map: HashMap<String, String> = col_rows
        .iter()
        .map(|r| {
            let name: String = r.get(0);
            let udt_name: String = r.get(1);
            let data_type: String = r.get(2);
            (name, resolve_pg_cast(&udt_name, &data_type))
        })
        .collect();

    build_pg_update_preview_sql(
        &request.schema,
        &request.table,
        &request.changes,
        &col_type_map,
        &col_cast_map,
    )
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

    build_mysql_update_preview_sql(&request.schema, &request.table, &request.changes)
}

// ─── delete_rows ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn delete_rows(
    session_id: String,
    request: DeleteRowsRequest,
    state: State<'_, AppState>,
) -> Result<Vec<DeleteRowResult>, String> {
    validate_identifier(&request.schema)?;
    validate_identifier(&request.table)?;

    let handle = {
        let sessions = state.sessions.lock().await;
        resolve_pool(&sessions, &session_id)?
    };

    match handle {
        PoolHandle::Pg(pool) => match delete_rows_pg(pool.clone(), request.clone()).await {
            Err(ref e) if is_pg_connection_err(e) => delete_rows_pg(pool, request).await,
            other => other,
        },
        PoolHandle::Mysql(pool) => delete_rows_mysql(pool, request).await,
    }
}

async fn delete_rows_pg(
    pool: std::sync::Arc<deadpool_postgres::Pool>,
    request: DeleteRowsRequest,
) -> Result<Vec<DeleteRowResult>, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;

    let col_rows: Vec<tokio_postgres::Row> = client
        .query(
            "SELECT column_name, udt_name, data_type FROM information_schema.columns \
             WHERE table_schema = $1 AND table_name = $2",
            &[&request.schema, &request.table],
        )
        .await
        .map_err(|e| e.to_string())?;

    let col_cast_map: HashMap<String, String> = col_rows
        .iter()
        .map(|r| {
            let name: String = r.get(0);
            let udt_name: String = r.get(1);
            let data_type: String = r.get(2);
            (name, resolve_pg_cast(&udt_name, &data_type))
        })
        .collect();

    let mut results = Vec::with_capacity(request.rows.len());

    for row in &request.rows {
        for pk in &row.pk_conditions {
            validate_column_identifier(&pk.column)?;
        }

        let delete_sql =
            match build_pg_delete_sql(&request.schema, &request.table, row, &col_cast_map) {
                Ok(delete_sql) => delete_sql,
                Err(e) => {
                    results.push(DeleteRowResult {
                        sql: String::new(),
                        error: Some(e),
                    });
                    continue;
                }
            };

        let pg_params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = delete_sql
            .params
            .iter()
            .map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync))
            .collect();

        let error = client
            .execute(delete_sql.exec_sql.as_str(), pg_params.as_slice())
            .await
            .err()
            .map(|e| e.to_string());
        results.push(DeleteRowResult {
            sql: delete_sql.display_sql,
            error,
        });
    }

    Ok(results)
}

async fn delete_rows_mysql(
    pool: std::sync::Arc<mysql_async::Pool>,
    request: DeleteRowsRequest,
) -> Result<Vec<DeleteRowResult>, String> {
    let mut conn = pool.get_conn().await.map_err(|e| e.to_string())?;

    let mut results = Vec::with_capacity(request.rows.len());

    for row in &request.rows {
        for pk in &row.pk_conditions {
            validate_column_identifier(&pk.column)?;
        }

        let delete_sql = match build_mysql_delete_sql(&request.schema, &request.table, row) {
            Ok(delete_sql) => delete_sql,
            Err(e) => {
                results.push(DeleteRowResult {
                    sql: String::new(),
                    error: Some(e),
                });
                continue;
            }
        };

        let error = conn
            .exec_drop(delete_sql.exec_sql.as_str(), delete_sql.params)
            .await
            .err()
            .map(|e| e.to_string());
        results.push(DeleteRowResult {
            sql: delete_sql.display_sql,
            error,
        });
    }

    Ok(results)
}

// ─── preview_delete_rows_sql ─────────────────────────────────────────────────

#[tauri::command]
pub async fn preview_delete_rows_sql(
    session_id: String,
    request: DeleteRowsRequest,
    state: State<'_, AppState>,
) -> Result<String, String> {
    validate_identifier(&request.schema)?;
    validate_identifier(&request.table)?;

    let handle = {
        let sessions = state.sessions.lock().await;
        resolve_pool(&sessions, &session_id)?
    };

    match handle {
        PoolHandle::Pg(pool) => preview_delete_rows_sql_pg(pool, request).await,
        PoolHandle::Mysql(_) => Ok(build_mysql_delete_preview_sql(
            &request.schema,
            &request.table,
            &request.rows,
        )),
    }
}

async fn preview_delete_rows_sql_pg(
    pool: std::sync::Arc<deadpool_postgres::Pool>,
    request: DeleteRowsRequest,
) -> Result<String, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;

    let col_rows: Vec<tokio_postgres::Row> = client
        .query(
            "SELECT column_name, udt_name, data_type FROM information_schema.columns \
             WHERE table_schema = $1 AND table_name = $2",
            &[&request.schema, &request.table],
        )
        .await
        .map_err(|e| e.to_string())?;

    let col_cast_map: HashMap<String, String> = col_rows
        .iter()
        .map(|r| {
            let name: String = r.get(0);
            let udt_name: String = r.get(1);
            let data_type: String = r.get(2);
            (name, resolve_pg_cast(&udt_name, &data_type))
        })
        .collect();

    let mut statements: Vec<String> = vec![];
    for row in &request.rows {
        for pk in &row.pk_conditions {
            validate_column_identifier(&pk.column)?;
        }
        statements.push(build_pg_delete_preview_statement(
            &request.schema,
            &request.table,
            row,
            &col_cast_map,
        )?);
    }

    Ok(statements.join("\n"))
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
        PoolHandle::Pg(pool) => match execute_sql_pg(pool.clone(), sql.clone()).await {
            Err(ref e) if is_pg_connection_err(e) => execute_sql_pg(pool, sql).await,
            other => other,
        },
        PoolHandle::Mysql(pool) => execute_sql_mysql(pool, sql).await,
    }
}
