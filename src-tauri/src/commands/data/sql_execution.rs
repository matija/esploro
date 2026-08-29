use std::time::Instant;

use mysql_async::prelude::Queryable;
use tokio_postgres::SimpleQueryMessage;

use super::type_mapping::{mysql_cell_value, CellValue};
use super::{QueryError, QueryResult, ResultColumn};
use crate::AppError;

fn split_sql_statements(sql: &str) -> Vec<&str> {
    sql.split(';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect()
}

pub(super) async fn execute_sql_pg(
    pool: std::sync::Arc<deadpool_postgres::Pool>,
    sql: String,
) -> Result<Vec<QueryResult>, AppError> {
    let client = pool.get().await?;

    let statements = split_sql_statements(&sql);
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
                                        is_enum: false,
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

pub(super) async fn execute_sql_mysql(
    pool: std::sync::Arc<mysql_async::Pool>,
    sql: String,
) -> Result<Vec<QueryResult>, AppError> {
    let mut conn = crate::db::mysql_conn(&pool).await?;

    let statements = split_sql_statements(&sql);
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
                            is_enum: false,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_sql_statements_trims_and_drops_empty_segments() {
        let statements = split_sql_statements(" SELECT 1 ; ;\nUPDATE users SET name = 'a' ; ");

        assert_eq!(statements, vec!["SELECT 1", "UPDATE users SET name = 'a'"]);
    }
}
