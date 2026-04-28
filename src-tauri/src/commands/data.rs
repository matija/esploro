use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

fn validate_identifier(s: &str) -> Result<(), String> {
    if s.is_empty() {
        return Err("Identifier cannot be empty".into());
    }
    let mut chars = s.chars();
    let first = chars.next().unwrap();
    if !first.is_alphabetic() && first != '_' {
        return Err(format!("Invalid identifier: '{s}'"));
    }
    if !s.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$') {
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
    pub database: String, // pool is bound to the configured database at connect time
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableQueryResult {
    pub columns: Vec<ResultColumn>,
    pub rows: Vec<Vec<Option<String>>>,
    pub total_count: i64,
    pub page: u32,
    pub page_size: u32,
    pub execution_ms: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResultColumn {
    pub name: String,
    pub data_type: String,
}

#[tauri::command]
pub async fn query_table(
    session_id: String,
    request: TableQueryRequest,
    state: State<'_, AppState>,
) -> Result<TableQueryResult, String> {
    validate_identifier(&request.schema)?;
    validate_identifier(&request.table)?;

    let pool = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&session_id)
            .ok_or_else(|| "Session not found".to_string())?
            .pool
            .clone()
    };

    let client = pool.get().await.map_err(|e| e.to_string())?;

    // Fetch column metadata — used to build ::text-cast SELECT and type-aware filter casts
    let col_rows = client
        .query(
            "SELECT column_name, udt_name FROM information_schema.columns \
             WHERE table_schema = $1 AND table_name = $2 \
             ORDER BY ordinal_position",
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

    let result_columns: Vec<ResultColumn> = col_rows
        .iter()
        .map(|r| ResultColumn {
            name: r.get(0),
            data_type: r.get(1),
        })
        .collect();

    let col_type_map: HashMap<String, String> = col_rows
        .iter()
        .map(|r| (r.get::<_, String>(0), r.get::<_, String>(1)))
        .collect();

    // Build WHERE clause with parameterised filter values
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

    // Cast every column to text so Rust can deserialise all types uniformly
    let col_select: String = result_columns
        .iter()
        .map(|c| format!("\"{}\"::text", c.name))
        .collect::<Vec<_>>()
        .join(", ");

    let offset = (request.page * request.page_size) as i64;
    let limit = request.page_size as i64;

    let data_sql = format!(
        "SELECT {col_select} FROM \"{}\".\"{}\" {where_sql} {order_sql} LIMIT {limit} OFFSET {offset}",
        request.schema, request.table
    );
    let count_sql = format!(
        "SELECT COUNT(*) FROM \"{}\".\"{}\" {where_sql}",
        request.schema, request.table
    );

    let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = param_values
        .iter()
        .map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync))
        .collect();

    let start = Instant::now();

    // Run data and count concurrently on two pool connections
    let client2 = pool.get().await.map_err(|e| e.to_string())?;
    let (data_result, count_result) = tokio::join!(
        client.query(data_sql.as_str(), params.as_slice()),
        client2.query_one(count_sql.as_str(), params.as_slice()),
    );

    let execution_ms = start.elapsed().as_millis() as u64;

    let data_rows = data_result.map_err(|e| e.to_string())?;
    let count_row = count_result.map_err(|e| e.to_string())?;
    let total_count: i64 = count_row.get(0);

    let rows: Vec<Vec<Option<String>>> = data_rows
        .iter()
        .map(|row| {
            (0..result_columns.len())
                .map(|i| row.get::<_, Option<String>>(i))
                .collect()
        })
        .collect();

    Ok(TableQueryResult {
        columns: result_columns,
        rows,
        total_count,
        page: request.page,
        page_size: request.page_size,
        execution_ms,
    })
}
