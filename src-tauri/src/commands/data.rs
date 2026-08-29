use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{AppError, AppState, DriverSession};

mod row_mutation_execution;
mod row_mutations;
mod sql_execution;
mod table_queries;
mod table_query_execution;
mod type_mapping;
mod where_clauses;

use self::row_mutation_execution::{
    delete_rows_mysql, delete_rows_pg, insert_rows_mysql, insert_rows_pg,
    preview_delete_rows_sql_pg, preview_insert_rows_sql_mysql, preview_insert_rows_sql_pg,
    preview_update_rows_sql_mysql, preview_update_rows_sql_pg, update_rows_mysql, update_rows_pg,
};
use self::sql_execution::{execute_sql_mysql, execute_sql_pg};
use self::table_query_execution::{
    count_table_mysql, count_table_pg, query_table_mysql, query_table_pg,
};
pub use self::type_mapping::CellValue;

// Returns a plain-`String` error: these validators are shared with the
// `String`-returning SQL builders; command-level callers convert the message
// into `AppError::Internal` via `?`/`From<String>`.
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

#[derive(Deserialize, specta::Type, Clone)]
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

#[derive(Deserialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColumnFilter {
    pub column: String,
    pub operator: FilterOperator,
    pub value: Option<String>,
}

#[derive(Deserialize, specta::Type, Clone)]
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

#[derive(Deserialize, specta::Type, Clone)]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TableQueryResult {
    pub columns: Vec<ResultColumn>,
    pub rows: Vec<Vec<CellValue>>,
    pub ctids: Vec<Option<String>>,
    pub page: u32,
    pub page_size: u32,
    pub execution_ms: u64,
    /// True when the driver saw at least one row past `page_size` — i.e. a
    /// next page exists. Lets the UI paginate without a `COUNT(*)`.
    pub has_more: bool,
}

#[derive(Deserialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PkCondition {
    pub column: String,
    pub value: String,
}

#[derive(Deserialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColumnChange {
    pub column: String,
    pub value: Option<String>,
}

#[derive(Deserialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RowChange {
    pub pk_conditions: Vec<PkCondition>,
    pub ctid: Option<String>,
    pub column_changes: Vec<ColumnChange>,
}

#[derive(Deserialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRowsRequest {
    pub schema: String,
    pub table: String,
    pub changes: Vec<RowChange>,
}

#[derive(Deserialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRowRequest {
    pub pk_conditions: Vec<PkCondition>,
    pub ctid: Option<String>,
}

#[derive(Deserialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRowsRequest {
    pub schema: String,
    pub table: String,
    pub rows: Vec<DeleteRowRequest>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRowResult {
    pub sql: String,
    pub error: Option<String>,
}

#[derive(Deserialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewRowValues {
    pub column_values: Vec<ColumnChange>,
}

#[derive(Deserialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InsertRowsRequest {
    pub schema: String,
    pub table: String,
    pub rows: Vec<NewRowValues>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InsertRowResult {
    pub sql: String,
    pub error: Option<String>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TableCountResult {
    pub count: i64,
    pub is_estimate: bool,
}

#[derive(Serialize, specta::Type, Clone)]
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
) -> Result<PoolHandle, AppError> {
    let info = sessions.get(session_id).ok_or(AppError::SessionNotFound)?;
    Ok(match &info.driver {
        DriverSession::Postgres(pool) => PoolHandle::Pg(pool.clone()),
        DriverSession::Mysql(pool) => PoolHandle::Mysql(pool.clone()),
    })
}

/// Lock the session map, resolve the session's pool handle, and drop the lock
/// before any query runs — queries operate on the cloned `Arc` pool, so the
/// session map is not held across `.await`.
async fn lock_pool(state: &AppState, session_id: &str) -> Result<PoolHandle, AppError> {
    let sessions = state.sessions.lock().await;
    resolve_pool(&sessions, session_id)
}

/// Resolve the session pool and dispatch to the driver-specific closure.
///
/// For Postgres the closure is retried **once** if the first attempt fails with
/// a retryable (dropped-connection) error — the pool hands out a fresh
/// connection on the retry. This collapses the lock → resolve → one-shot-retry
/// block that was duplicated across the data commands. MySQL runs once.
async fn with_pool<T, PgFut, MyFut>(
    state: &AppState,
    session_id: &str,
    on_pg: impl Fn(std::sync::Arc<deadpool_postgres::Pool>) -> PgFut,
    on_mysql: impl FnOnce(std::sync::Arc<mysql_async::Pool>) -> MyFut,
) -> Result<T, AppError>
where
    PgFut: std::future::Future<Output = Result<T, AppError>>,
    MyFut: std::future::Future<Output = Result<T, AppError>>,
{
    match lock_pool(state, session_id).await? {
        PoolHandle::Pg(pool) => match on_pg(pool.clone()).await {
            Err(ref e) if e.is_retryable() => on_pg(pool).await,
            other => other,
        },
        PoolHandle::Mysql(pool) => on_mysql(pool).await,
    }
}

#[tauri::command]
#[specta::specta]
pub async fn query_table_data(
    session_id: String,
    request: TableQueryRequest,
    state: State<'_, AppState>,
) -> Result<TableQueryResult, AppError> {
    validate_identifier(&request.schema)?;
    validate_identifier(&request.table)?;

    with_pool(
        &state,
        &session_id,
        |pool| query_table_pg(pool, request.clone()),
        |pool| query_table_mysql(pool, request.clone()),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn query_table_count(
    session_id: String,
    request: TableQueryRequest,
    state: State<'_, AppState>,
) -> Result<TableCountResult, AppError> {
    validate_identifier(&request.schema)?;
    validate_identifier(&request.table)?;

    with_pool(
        &state,
        &session_id,
        |pool| count_table_pg(pool, request.clone()),
        |pool| count_table_mysql(pool, request.clone()),
    )
    .await
}

// ─── update_rows ─────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn update_rows(
    session_id: String,
    request: UpdateRowsRequest,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    validate_identifier(&request.schema)?;
    validate_identifier(&request.table)?;

    with_pool(
        &state,
        &session_id,
        |pool| update_rows_pg(pool, request.clone()),
        |pool| update_rows_mysql(pool, request.clone()),
    )
    .await
}

// ─── preview_update_rows_sql ─────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn preview_update_rows_sql(
    session_id: String,
    request: UpdateRowsRequest,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    validate_identifier(&request.schema)?;
    validate_identifier(&request.table)?;

    match lock_pool(&state, &session_id).await? {
        PoolHandle::Pg(pool) => preview_update_rows_sql_pg(pool, request).await,
        PoolHandle::Mysql(pool) => preview_update_rows_sql_mysql(pool, request).await,
    }
}

// ─── delete_rows ─────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn delete_rows(
    session_id: String,
    request: DeleteRowsRequest,
    state: State<'_, AppState>,
) -> Result<Vec<DeleteRowResult>, AppError> {
    validate_identifier(&request.schema)?;
    validate_identifier(&request.table)?;

    with_pool(
        &state,
        &session_id,
        |pool| delete_rows_pg(pool, request.clone()),
        |pool| delete_rows_mysql(pool, request.clone()),
    )
    .await
}

// ─── preview_delete_rows_sql ─────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn preview_delete_rows_sql(
    session_id: String,
    request: DeleteRowsRequest,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    validate_identifier(&request.schema)?;
    validate_identifier(&request.table)?;

    match lock_pool(&state, &session_id).await? {
        PoolHandle::Pg(pool) => preview_delete_rows_sql_pg(pool, request).await,
        PoolHandle::Mysql(_) => Ok(row_mutations::build_mysql_delete_preview_sql(
            &request.schema,
            &request.table,
            &request.rows,
        )),
    }
}

// ─── insert_rows ─────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn insert_rows(
    session_id: String,
    request: InsertRowsRequest,
    state: State<'_, AppState>,
) -> Result<Vec<InsertRowResult>, AppError> {
    validate_identifier(&request.schema)?;
    validate_identifier(&request.table)?;

    with_pool(
        &state,
        &session_id,
        |pool| insert_rows_pg(pool, request.clone()),
        |pool| insert_rows_mysql(pool, request.clone()),
    )
    .await
}

// ─── preview_insert_rows_sql ─────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn preview_insert_rows_sql(
    session_id: String,
    request: InsertRowsRequest,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    validate_identifier(&request.schema)?;
    validate_identifier(&request.table)?;

    match lock_pool(&state, &session_id).await? {
        PoolHandle::Pg(pool) => preview_insert_rows_sql_pg(pool, request).await,
        PoolHandle::Mysql(pool) => preview_insert_rows_sql_mysql(pool, request).await,
    }
}

// ─── execute_sql ─────────────────────────────────────────────────────────────

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ResultColumn>,
    pub rows: Vec<Vec<CellValue>>,
    pub rows_affected: Option<u64>,
    pub execution_ms: u64,
    pub error: Option<QueryError>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QueryError {
    pub message: String,
    pub position: Option<u32>,
    pub code: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn execute_sql(
    session_id: String,
    sql: String,
    state: State<'_, AppState>,
) -> Result<Vec<QueryResult>, AppError> {
    let results = with_pool(
        &state,
        &session_id,
        |pool| execute_sql_pg(pool, sql.clone()),
        |pool| execute_sql_mysql(pool, sql.clone()),
    )
    .await;

    // Invalidate on the *attempt*, not on success: a partially applied batch or
    // a statement that errored after committing earlier DDL still leaves the
    // cached tree stale.
    if crate::commands::schema::sql_contains_ddl(&sql) {
        state.schema_cache.invalidate(&session_id, None, None).await;
    }

    results
}
