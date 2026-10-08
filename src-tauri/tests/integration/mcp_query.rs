use super::common;
use esploro_lib::{mcp::query::execute, DriverSession};
use mysql_async::prelude::Queryable;
use std::sync::Arc;

static AGENT_TESTS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn check(driver: &DriverSession, table: &str) {
    let result = execute(driver, &format!("SELECT id FROM {table}"))
        .await
        .unwrap();
    assert_eq!(result["rows"].as_array().unwrap().len(), 1);
    for sql in [
        format!("DELETE FROM {table}"),
        format!("UPDATE {table} SET id = 2"),
        format!("INSERT INTO {table} VALUES (2)"),
        format!("SELECT * FROM {table} FOR UPDATE"),
        "EXPLAIN SELECT 1".into(),
        "SELECT 1; SELECT 2".into(),
    ] {
        assert!(execute(driver, &sql).await.is_err(), "{sql}");
    }
    let result = execute(driver, &format!("SELECT id FROM {table}"))
        .await
        .unwrap();
    assert_eq!(result["rows"].as_array().unwrap().len(), 1);
    assert_eq!(result["rows"][0][0]["v"].to_string().trim_matches('"'), "1");
    let empty = execute(driver, &format!("SELECT id FROM {table} WHERE id = 0"))
        .await
        .unwrap();
    assert_eq!(empty["columns"], serde_json::json!(["id"]));
    assert!(empty["rows"].as_array().unwrap().is_empty());
    let series = match driver {
        DriverSession::Postgres(_) => "WITH RECURSIVE numbers AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM numbers WHERE n < 1100) SELECT n FROM numbers",
        DriverSession::Mysql(_) => "WITH RECURSIVE numbers AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM numbers WHERE n < 1000) SELECT n FROM numbers UNION ALL SELECT 1001",
    };
    let result = execute(driver, series).await.unwrap();
    assert_eq!(result["rows"].as_array().unwrap().len(), 1000);
    assert_eq!(result["truncated"], true);
    assert_eq!(result["truncationReasons"], serde_json::json!(["rowLimit"]));
    let result = execute(driver, &format!("SELECT oversized FROM {table}"))
        .await
        .unwrap();
    assert_eq!(result["omittedValues"], 1);
    assert_eq!(result["rows"][0][0]["omitted"], true);
    assert!(result.to_string().len() <= 1_000_000);
    let payload = format!("WITH RECURSIVE numbers AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM numbers WHERE n < 100) SELECT payload FROM numbers CROSS JOIN {table}");
    let result = execute(driver, &payload).await.unwrap();
    assert_eq!(result["truncated"], true);
    assert!(result.to_string().len() <= 1_000_000);
    assert!(execute(driver, "SELECT 1 / 0 FROM missing_t8_table")
        .await
        .is_err());
    assert!(execute(driver, "SELECT 1").await.is_ok());
}

#[tokio::test]
async fn postgres_agent_queries() {
    let _guard = AGENT_TESTS.lock().await;
    let Some(url) = common::env_url("ESPLORO_TEST_POSTGRES_URL") else {
        return common::skip("Postgres URL unset");
    };
    let pool = Arc::new(common::pg_pool(&url));
    let table = common::unique_table_name("mcp");
    let client = pool.get().await.unwrap();
    client.batch_execute(&format!("CREATE TABLE {table} (id INTEGER, oversized TEXT, payload TEXT); INSERT INTO {table} VALUES (1, repeat('界', 400000), repeat('界', 10000))")).await.unwrap();
    drop(client);
    check(&DriverSession::Postgres(pool.clone()), &table).await;
    let client = pool.get().await.unwrap();
    client
        .batch_execute(&format!(
            "BEGIN; LOCK TABLE {table} IN ACCESS EXCLUSIVE MODE"
        ))
        .await
        .unwrap();
    let mut tasks = Vec::new();
    for _ in 0..2 {
        let driver = DriverSession::Postgres(pool.clone());
        let sql = format!("SELECT id FROM {table}");
        tasks.push(tokio::spawn(async move { execute(&driver, &sql).await }));
    }
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let count: i64 = client.query_one("SELECT count(*) FROM pg_stat_activity WHERE query = $1 AND wait_event_type = 'Lock'", &[&format!("SELECT id FROM {table}")]).await.unwrap().get(0);
            if count == 2 { break; }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            client.batch_execute("SELECT pg_stat_clear_snapshot()").await.unwrap();
        }
    }).await.unwrap();
    let error = execute(&DriverSession::Postgres(pool.clone()), "SELECT 1")
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("busy") && error.contains("retryable"));
    for task in tasks {
        assert!(task
            .await
            .unwrap()
            .unwrap_err()
            .to_string()
            .contains("timed out"));
    }
    client.batch_execute("ROLLBACK").await.unwrap();
    assert!(execute(&DriverSession::Postgres(pool.clone()), "SELECT 1")
        .await
        .is_ok());
    assert_eq!(
        client
            .query_one("SHOW transaction_read_only", &[])
            .await
            .unwrap()
            .get::<_, String>(0),
        "off"
    );
    client
        .batch_execute(&format!("UPDATE {table} SET id = 3; DROP TABLE {table}"))
        .await
        .unwrap();
}

#[tokio::test]
async fn mysql_agent_queries() {
    let _guard = AGENT_TESTS.lock().await;
    for var in ["ESPLORO_TEST_MYSQL_URL", "ESPLORO_TEST_MARIADB_URL"] {
        let Some(url) = common::env_url(var) else {
            common::skip(var);
            continue;
        };
        let pool = Arc::new(common::mysql_pool(&url));
        let table = common::unique_table_name("mcp");
        let mut conn = pool.get_conn().await.unwrap();
        conn.query_drop(format!(
            "CREATE TABLE {table} (id INTEGER, oversized LONGTEXT, payload TEXT)"
        ))
        .await
        .unwrap();
        conn.query_drop(format!(
            "INSERT INTO {table} VALUES (1, repeat('界', 400000), repeat('界', 10000))"
        ))
        .await
        .unwrap();
        drop(conn);
        check(&DriverSession::Mysql(pool.clone()), &table).await;
        let mut conn = pool.get_conn().await.unwrap();
        conn.query_drop(format!("UPDATE {table} SET id = 3"))
            .await
            .unwrap();
        conn.query_drop(format!("DROP TABLE {table}"))
            .await
            .unwrap();
        drop(conn);
        pool.as_ref().clone().disconnect().await.unwrap();
    }
}
