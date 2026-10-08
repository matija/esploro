use super::{
    validate_sql, SqlDialect, MAX_CONCURRENT_QUERIES, MAX_RESULT_PAYLOAD_BYTES, MAX_RESULT_ROWS,
    QUERY_TIMEOUT,
};
use crate::{AppError, DriverSession};
use futures_util::{pin_mut, TryStreamExt};
use mysql_async::prelude::Queryable;
use serde_json::{json, Value};

static QUERIES: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(MAX_CONCURRENT_QUERIES);

struct Output {
    value: Value,
}

impl Output {
    fn new() -> Self {
        Self {
            value: json!({"columns":[],"rows":[],"truncated":false,"truncationReasons":[],"omittedValues":0}),
        }
    }

    fn truncate(&mut self, reason: &str) {
        self.value["truncated"] = json!(true);
        let reasons = self.value["truncationReasons"].as_array_mut().unwrap();
        if !reasons.contains(&json!(reason)) {
            reasons.push(json!(reason));
        }
    }

    fn columns(&mut self, names: impl Iterator<Item = String>) -> bool {
        let mut bytes = 256;
        for name in names {
            bytes += json!(name).to_string().len() + 1;
            if bytes > MAX_RESULT_PAYLOAD_BYTES {
                self.value["columns"] = json!([]);
                self.truncate("payloadLimit");
                return false;
            }
            self.value["columns"]
                .as_array_mut()
                .unwrap()
                .push(json!(name));
        }
        true
    }

    fn row(&mut self, cells: impl Iterator<Item = Value>) -> bool {
        if self.value["rows"].as_array().unwrap().len() == MAX_RESULT_ROWS {
            self.truncate("rowLimit");
            return false;
        }
        let mut row = Vec::new();
        let mut omitted = 0;
        let mut bytes = self.value.to_string().len() + 256;
        for cell in cells {
            if cell.get("omitted") == Some(&json!(true))
                || cell.to_string().len() > MAX_RESULT_PAYLOAD_BYTES - 1024
            {
                row.push(json!({"omitted":true,"reason":"valueTooLarge"}));
                omitted += 1;
                self.truncate("oversizedValue");
            } else {
                row.push(cell);
            }
            bytes += row.last().unwrap().to_string().len() + 1;
            if bytes > MAX_RESULT_PAYLOAD_BYTES {
                self.truncate("payloadLimit");
                return false;
            }
        }
        self.value["rows"].as_array_mut().unwrap().push(json!(row));
        if self.value.to_string().len() > MAX_RESULT_PAYLOAD_BYTES - 256 {
            self.value["rows"].as_array_mut().unwrap().pop();
            self.truncate("payloadLimit");
            return false;
        }
        let n = self.value["omittedValues"].as_u64().unwrap();
        self.value["omittedValues"] = json!(n + omitted);
        true
    }
}

pub async fn execute(driver: &DriverSession, sql: &str) -> Result<Value, AppError> {
    let _permit = QUERIES.try_acquire().map_err(|_| {
        AppError::Connection("busy: retryable; two agent queries are already running".into())
    })?;
    validate_sql(
        sql,
        match driver {
            DriverSession::Postgres(_) => SqlDialect::Postgres,
            DriverSession::Mysql(_) => SqlDialect::Mysql,
        },
    )
    .map_err(AppError::Connection)?;
    let deadline = tokio::time::Instant::now() + QUERY_TIMEOUT;
    let mut output = Output::new();
    match driver {
        DriverSession::Postgres(pool) => {
            let client = tokio::time::timeout_at(deadline, pool.get())
                .await
                .map_err(|_| AppError::Connection("Query timed out".into()))??;
            let client = deadpool_postgres::Object::take(client);
            tokio::time::timeout_at(deadline, async {
                client.batch_execute("ROLLBACK").await?;
                let version: String = client.query_one("SELECT version()", &[]).await?.get(0);
                if !version.starts_with("PostgreSQL ") {
                    return Err(AppError::Connection(
                        "Unsupported server; read-only execution refused".into(),
                    ));
                }
                client.batch_execute("BEGIN READ ONLY").await?;
                {
                    let stream = client.simple_query_raw(sql).await?;
                    pin_mut!(stream);
                    while let Some(message) = stream.try_next().await? {
                        if let tokio_postgres::SimpleQueryMessage::RowDescription(columns) =
                            &message
                        {
                            if !output.columns(columns.iter().map(|c| c.name().to_string())) {
                                return Ok(());
                            }
                        }
                        if let tokio_postgres::SimpleQueryMessage::Row(row) = message {
                            let cells = (0..row.len()).map(|i| {
                                if row
                                    .get(i)
                                    .is_some_and(|s| s.len() > MAX_RESULT_PAYLOAD_BYTES - 1024)
                                {
                                    json!({"omitted":true,"reason":"valueTooLarge"})
                                } else {
                                    serde_json::to_value(crate::db::pg_text_value(row.get(i)))
                                        .unwrap()
                                }
                            });
                            if !output.row(cells) {
                                return Ok(());
                            }
                        }
                    }
                }
                client.batch_execute("ROLLBACK").await?;
                Ok::<_, AppError>(())
            })
            .await
            .map_err(|_| AppError::Connection("Query timed out; connection discarded".into()))??;
        }
        DriverSession::Mysql(pool) => {
            let conn = tokio::time::timeout_at(deadline, crate::db::mysql_conn(pool))
                .await
                .map_err(|_| AppError::Connection("Query timed out".into()))??;
            let mut isolated = crate::db::IsolatedMysql(Some(conn));
            let conn = isolated.0.as_mut().unwrap();
            let result = tokio::time::timeout_at(deadline, async {
                conn.query_drop("ROLLBACK").await?;
                let (version, comment): (String, String) = conn.query_first("SELECT VERSION(), @@version_comment").await?.ok_or_else(|| AppError::Connection("Cannot identify server".into()))?;
                let major = version.split('.').next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
                if !(version.contains("MariaDB") && major >= 10 || !version.contains("MariaDB") && major >= 5 && comment.contains("MySQL")) {
                    return Err(AppError::Connection("Unsupported server; read-only execution refused".into()));
                }
                conn.query_drop("START TRANSACTION READ ONLY").await?;
                let mut result = conn.query_iter(sql).await?;
                if !output.columns(result.columns_ref().iter().map(|c| c.name_str().into_owned())) { return Ok(()); }
                while let Some(row) = result.next().await? {
                    let cells = (0..row.len()).map(|i| {
                        if matches!(row.as_ref(i), Some(mysql_async::Value::Bytes(bytes)) if bytes.len() > MAX_RESULT_PAYLOAD_BYTES - 1024) {
                            json!({"omitted":true,"reason":"valueTooLarge"})
                        } else {
                            serde_json::to_value(crate::commands::data::mysql_cell_value(&row, i)).unwrap()
                        }
                    });
                    if !output.row(cells) { return Ok(()); }
                }
                result.drop_result().await?;
                conn.query_drop("ROLLBACK").await?;
                Ok::<_, AppError>(())
            }).await;
            let _ = tokio::time::timeout(
                crate::db::RECYCLE_TIMEOUT,
                isolated.0.take().unwrap().disconnect(),
            )
            .await;
            result.map_err(|_| {
                AppError::Connection("Query timed out; connection discarded".into())
            })??;
        }
    }
    Ok(output.value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_counts_serialized_utf8_and_marks_omissions() {
        let mut output = Output::new();
        assert!(output.columns(["value".to_string()].into_iter()));
        assert!(output.row([json!({"t":"text","v":"\"".repeat(600_000)})].into_iter()));
        assert_eq!(output.value["rows"][0][0]["omitted"], true);
        assert_eq!(output.value["omittedValues"], 1);
        for _ in 0..100 {
            if !output.row([json!({"t":"text","v":"界".repeat(10_000)})].into_iter()) {
                break;
            }
        }
        assert!(output.value.to_string().len() <= MAX_RESULT_PAYLOAD_BYTES);
        assert!(output.value["truncationReasons"]
            .as_array()
            .unwrap()
            .contains(&json!("payloadLimit")));
    }
}
