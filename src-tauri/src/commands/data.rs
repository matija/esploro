use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{AppState, DriverSession};

mod row_mutation_execution;
mod row_mutations;
mod sql_execution;
mod table_queries;
mod table_query_execution;
mod type_mapping;
mod where_clauses;

use self::row_mutation_execution::{
    delete_rows_mysql, delete_rows_pg, preview_delete_rows_sql_pg, preview_update_rows_sql_mysql,
    preview_update_rows_sql_pg, update_rows_mysql, update_rows_pg,
};
use self::sql_execution::{execute_sql_mysql, execute_sql_pg};
use self::table_query_execution::{
    count_table_mysql, count_table_pg, query_table_mysql, query_table_pg,
};
use self::type_mapping::CellValue;

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
        PoolHandle::Mysql(_) => Ok(row_mutations::build_mysql_delete_preview_sql(
            &request.schema,
            &request.table,
            &request.rows,
        )),
    }
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
