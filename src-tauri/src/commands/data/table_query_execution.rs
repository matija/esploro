use std::collections::{HashMap, HashSet};
use std::time::Instant;

use mysql_async::prelude::Queryable;

use super::table_queries::{
    build_mysql_count_sql, build_mysql_data_sql, build_mysql_order_sql, build_mysql_select_list,
    build_pg_count_sql, build_pg_data_sql, build_pg_order_sql, build_pg_select_list,
};
use super::type_mapping::{mysql_cell_value, mysql_str, pg_cell_value, resolve_pg_cast, CellValue};
use super::where_clauses::{build_mysql_where_clause, build_pg_where_clause, build_where_sql};
use super::{ResultColumn, TableCountResult, TableQueryRequest, TableQueryResult};

pub(super) async fn query_table_pg(
    pool: std::sync::Arc<deadpool_postgres::Pool>,
    request: TableQueryRequest,
) -> Result<TableQueryResult, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;

    let col_rows = client
        .query(
            "SELECT c.column_name, c.udt_name, c.is_nullable, c.data_type, \
                    EXISTS ( \
                        SELECT 1 \
                        FROM pg_type t \
                        JOIN pg_namespace n ON n.oid = t.typnamespace \
                        WHERE n.nspname = c.udt_schema \
                          AND t.typname = c.udt_name \
                          AND t.typtype = 'e' \
                    ) AS is_enum \
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

    let pk_cols: HashSet<String> = client
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

    let fk_cols: HashSet<String> = client
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
                is_enum: r.get(4),
                name,
            }
        })
        .collect();

    // Map: column_name -> udt_name (used for native-type detection and cell reading)
    let col_type_map: HashMap<String, String> = col_rows
        .iter()
        .map(|r| (r.get::<_, String>(0), r.get::<_, String>(1)))
        .collect();

    // Map: column_name -> resolved cast type (used for filter WHERE clauses).
    // Uses resolve_pg_cast so domain and custom UDTs resolve correctly via data_type fallback.
    let col_cast_map: HashMap<String, String> = col_rows
        .iter()
        .map(|r| {
            let name: String = r.get(0);
            let udt_name: String = r.get(1);
            let data_type: String = r.get(3);
            (name, resolve_pg_cast(&udt_name, &data_type))
        })
        .collect();

    let (where_clauses, param_values) = build_pg_where_clause(&request.filters, &col_cast_map)?;

    let where_sql = build_where_sql(&where_clauses, &request.raw_where);

    let order_sql = build_pg_order_sql(&request.sort_column, &request.sort_direction)?;
    let col_select = build_pg_select_list(&result_columns, &col_type_map);

    // ctid_idx is the index of the appended ctid column in each result row
    let ctid_idx = result_columns.len();

    let data_sql = build_pg_data_sql(
        &request.schema,
        &request.table,
        &col_select,
        &where_sql,
        &order_sql,
        request.page,
        request.page_size,
    );

    let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = param_values
        .iter()
        .map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync))
        .collect();

    let start = Instant::now();
    let data_rows = client
        .query(data_sql.as_str(), params.as_slice())
        .await
        .map_err(|e| {
            let param_str = param_values.join(", ");
            format!(
                "Filter query failed — SQL: {data_sql}  Params: [{param_str}]  Error(Display): {e}  Error(Debug): {e:?}"
            )
        })?;
    let execution_ms = start.elapsed().as_millis() as u64;

    let mut rows: Vec<Vec<CellValue>> = Vec::with_capacity(data_rows.len());
    let mut ctids: Vec<Option<String>> = Vec::with_capacity(data_rows.len());

    for row in &data_rows {
        let cells: Vec<CellValue> = result_columns
            .iter()
            .enumerate()
            .map(|(i, col)| {
                let udt = col_type_map
                    .get(&col.name)
                    .map(|s| s.as_str())
                    .unwrap_or("text");
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

pub(super) async fn count_table_pg(
    pool: std::sync::Arc<deadpool_postgres::Pool>,
    request: TableQueryRequest,
) -> Result<TableCountResult, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;

    // Fast path: no filters -> use reltuples estimate without querying information_schema.
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
            return Ok(TableCountResult {
                count,
                is_estimate: true,
            });
        }
    }

    // Build WHERE from filters (same logic as query_table_pg).
    // Query both udt_name and data_type so resolve_pg_cast can fall back
    // to the base type when udt_name is a domain/custom UDT name.
    let col_cast_map: HashMap<String, String> = client
        .query(
            "SELECT column_name, udt_name, data_type FROM information_schema.columns \
             WHERE table_schema = $1 AND table_name = $2",
            &[&request.schema, &request.table],
        )
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|r| {
            let name: String = r.get(0);
            let udt_name: String = r.get(1);
            let data_type: String = r.get(2);
            (name, resolve_pg_cast(&udt_name, &data_type))
        })
        .collect();

    let (where_clauses, param_values) = build_pg_where_clause(&request.filters, &col_cast_map)?;

    let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = param_values
        .iter()
        .map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync))
        .collect();

    let where_sql = build_where_sql(&where_clauses, &request.raw_where);
    let count_sql = build_pg_count_sql(&request.schema, &request.table, &where_sql);
    let row = client
        .query_one(count_sql.as_str(), params.as_slice())
        .await
        .map_err(|e| format!("Count query failed — SQL: {count_sql}  Error: {e}"))?;
    Ok(TableCountResult {
        count: row.get(0),
        is_estimate: false,
    })
}

pub(super) async fn query_table_mysql(
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
            let data_type = mysql_str(r, 1).unwrap_or_default();
            let col_key = mysql_str(r, 3).unwrap_or_default();
            ResultColumn {
                name: mysql_str(r, 0).unwrap_or_default(),
                is_enum: data_type.to_lowercase().starts_with("enum("),
                data_type,
                is_nullable: mysql_str(r, 2).as_deref() == Some("YES"),
                is_primary_key: col_key == "PRI",
                is_foreign_key: col_key == "MUL",
            }
        })
        .collect();

    let (where_clauses, param_values) = build_mysql_where_clause(&request.filters)?;
    let where_sql = build_where_sql(&where_clauses, &request.raw_where);

    let order_sql = build_mysql_order_sql(&request.sort_column, &request.sort_direction)?;
    let col_select = build_mysql_select_list(&result_columns);

    let data_sql = build_mysql_data_sql(
        &request.schema,
        &request.table,
        &col_select,
        &where_sql,
        &order_sql,
        request.page,
        request.page_size,
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

pub(super) async fn count_table_mysql(
    pool: std::sync::Arc<mysql_async::Pool>,
    request: TableQueryRequest,
) -> Result<TableCountResult, String> {
    let mut conn = pool.get_conn().await.map_err(|e| e.to_string())?;

    let (where_clauses, param_values) = build_mysql_where_clause(&request.filters)?;
    let where_sql = build_where_sql(&where_clauses, &request.raw_where);
    let count_sql = build_mysql_count_sql(&request.schema, &request.table, &where_sql);
    let count_rows = conn
        .exec::<mysql_async::Row, _, _>(count_sql.as_str(), param_values)
        .await
        .map_err(|e| e.to_string())?;
    let count = count_rows
        .first()
        .and_then(|r| mysql_str(r, 0))
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    Ok(TableCountResult {
        count,
        is_estimate: false,
    })
}
