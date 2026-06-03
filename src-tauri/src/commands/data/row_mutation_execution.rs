use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use mysql_async::prelude::Queryable;

use super::row_mutations::{
    build_mysql_delete_sql, build_mysql_update_preview_sql, build_mysql_update_sql,
    build_pg_delete_preview_statement, build_pg_delete_sql, build_pg_update_preview_sql,
    build_pg_update_sql,
};
use super::type_mapping::{mysql_str, resolve_pg_cast};
use super::{validate_column_identifier, DeleteRowResult, DeleteRowsRequest, UpdateRowsRequest};

pub(super) async fn update_rows_pg(
    pool: Arc<deadpool_postgres::Pool>,
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

pub(super) async fn update_rows_mysql(
    pool: Arc<mysql_async::Pool>,
    request: UpdateRowsRequest,
) -> Result<(), String> {
    let mut conn = pool.get_conn().await.map_err(|e| e.to_string())?;

    // Look up PK columns — required for MySQL (no ctid)
    let pk_cols: HashSet<String> = {
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

pub(super) async fn preview_update_rows_sql_pg(
    pool: Arc<deadpool_postgres::Pool>,
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

pub(super) async fn preview_update_rows_sql_mysql(
    pool: Arc<mysql_async::Pool>,
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

pub(super) async fn delete_rows_pg(
    pool: Arc<deadpool_postgres::Pool>,
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

pub(super) async fn delete_rows_mysql(
    pool: Arc<mysql_async::Pool>,
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

pub(super) async fn preview_delete_rows_sql_pg(
    pool: Arc<deadpool_postgres::Pool>,
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
