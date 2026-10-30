use super::common;
use esploro_lib::{
    mcp::{
        activity::{ActivityStatus, ActivityStore},
        policy::{McpPolicy, PolicyStore},
        server::McpListener,
    },
    AppState, DriverSession, SessionInfo,
};
use serde_json::{json, Value};
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tauri::Manager;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

async fn request(address: SocketAddr, token: &str, message: Value) -> (u16, Value) {
    let body = message.to_string();
    let mut socket = TcpStream::connect(address).await.unwrap();
    socket.write_all(format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:19482\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nMCP-Protocol-Version: 2025-06-18\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
    let mut response = String::new();
    tokio::time::timeout(
        Duration::from_secs(40),
        socket.read_to_string(&mut response),
    )
    .await
    .unwrap()
    .unwrap();
    let (headers, body) = response.split_once("\r\n\r\n").unwrap();
    (
        headers.split_whitespace().nth(1).unwrap().parse().unwrap(),
        serde_json::from_str(body).unwrap_or(Value::Null),
    )
}

async fn call(address: SocketAddr, name: &str, arguments: Value) -> Value {
    static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(100);
    let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let (status, value) = request(address, "acceptance-token", json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":arguments}})).await;
    assert_eq!(status, 200, "{value}");
    assert!(value.get("error").is_none(), "{value}");
    value["result"].clone()
}

async fn traverse(address: SocketAddr, mut args: Value, mode: &str) -> Vec<Value> {
    let mut entries = Vec::new();
    let mut previous = Value::Null;
    for _ in 0..1000 {
        let result = call(address, "inspect_schema", args.clone()).await;
        assert_eq!(result["isError"], false, "{result}");
        let page = &result["structuredContent"];
        assert!(serde_json::to_vec(page).unwrap().len() <= 256_000);
        assert_eq!(page["omittedEntries"], 0);
        let items = page[mode].as_array().unwrap();
        assert!(items.len() <= args["limit"].as_u64().unwrap_or(50) as usize);
        entries.extend(items.iter().cloned());
        if page["nextCursor"].is_null() {
            return entries;
        }
        assert_eq!(page["truncated"], true);
        assert_ne!(page["nextCursor"], previous);
        previous = page["nextCursor"].clone();
        args["cursor"] = previous.clone();
    }
    panic!("Inspection did not terminate");
}

async fn verify_sdk_client(
    app: &tauri::App<tauri::test::MockRuntime>,
    server: McpListener,
    address: SocketAddr,
    directory: &std::path::Path,
) {
    use mysql_async::prelude::Queryable;
    use std::{io, process::Stdio};
    use tokio::io::{AsyncBufReadExt, BufReader};

    let ids = ["postgres", "mysql", "mariadb"];
    app.state::<PolicyStore>()
        .save(McpPolicy {
            enabled: true,
            permitted_connection_ids: vec!["postgres".into()],
            ..Default::default()
        })
        .unwrap();
    server.shutdown().await.unwrap();
    assert!(TcpStream::connect(address).await.is_err());
    let address = "127.0.0.1:19482".parse().unwrap();
    let mut listener = Some(
        McpListener::bind_at(
            address,
            "acceptance-token".into(),
            Some(app.handle().clone()),
        )
        .await
        .unwrap(),
    );
    let script =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tools/mcp/verify-client.mjs");
    let mut child = tokio::process::Command::new("node")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap()).lines();
    let mut pg: Option<deadpool_postgres::ClientWrapper> = None;
    let mut mysql: Option<mysql_async::Conn> = None;
    let token_path = directory.join("sdk-token");
    let result = tokio::time::timeout(Duration::from_secs(120), async {
        input
            .write_all(format!("{}\n", json!({"url":format!("http://{address}/mcp"),"token":"acceptance-token"})).as_bytes())
            .await?;
        while let Some(line) = output.next_line().await? {
            let command: Value = serde_json::from_str(&line)?;
            let mut response = json!({"ok":true});
            match command["command"].as_str() {
                Some("grant") => {
                    app.state::<PolicyStore>().save(McpPolicy {
                        enabled: true,
                        permitted_connection_ids: ids.iter().map(|id| (*id).into()).collect(),
                        ..Default::default()
                    })?;
                }
                Some("lock") => {
                    if pg.is_some() || mysql.is_some() {
                        return Err(io::Error::other("Fixture lock already held").into());
                    }
                    let variable = match command["connectionId"].as_str() {
                        Some("postgres") => "ESPLORO_TEST_POSTGRES_URL",
                        Some("mysql") => "ESPLORO_TEST_MYSQL_URL",
                        Some("mariadb") => "ESPLORO_TEST_MARIADB_URL",
                        _ => return Err(io::Error::other("Unknown Database fixture").into()),
                    };
                    let url = std::env::var(variable)?;
                    if variable == "ESPLORO_TEST_POSTGRES_URL" {
                        let client = deadpool_postgres::Object::take(common::pg_pool(&url).get().await?);
                        client.batch_execute("BEGIN; LOCK TABLE t6_metadata.columns_page IN ACCESS EXCLUSIVE MODE").await?;
                        pg = Some(client);
                    } else {
                        let mut conn = mysql_async::Conn::new(mysql_async::Opts::from_url(&url)?).await?;
                        conn.query_drop("LOCK TABLES t6_metadata.columns_page WRITE").await?;
                        mysql = Some(conn);
                    }
                }
                Some("active" | "cancelled") => {
                    let expected_active = command["command"] == "active";
                    let until = tokio::time::Instant::now() + Duration::from_secs(8);
                    loop {
                        let sql = "SELECT c000 FROM t6_metadata.columns_page";
                        let active: i64 = if let Some(client) = &pg {
                            client.batch_execute("SELECT pg_stat_clear_snapshot()").await?;
                            client.query_one("SELECT count(*) FROM pg_stat_activity WHERE query = $1 AND pid <> pg_backend_pid()", &[&sql]).await?.get(0)
                        } else if let Some(conn) = &mut mysql {
                            conn.exec_first("SELECT count(*) FROM information_schema.PROCESSLIST WHERE INFO = ? OR INFO LIKE ?", (sql, format!("% FOR {sql}"))).await?.unwrap()
                        } else {
                            return Err(io::Error::other("No fixture lock held").into());
                        };
                        if (active > 0) == expected_active {
                            break;
                        }
                        if tokio::time::Instant::now() >= until {
                            return Err(io::Error::other(format!("Database work did not reach expected active state: {expected_active}")).into());
                        }
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                }
                Some("unlock") => {
                    if let Some(client) = pg.take() {
                        client.batch_execute("ROLLBACK").await?;
                    }
                    if let Some(conn) = mysql.take() {
                        conn.disconnect().await?;
                    }
                }
                Some("replace") => {
                    listener.take().ok_or_else(|| io::Error::other("Listener already stopped"))?.shutdown().await?;
                    let token = uuid::Uuid::new_v4().to_string();
                    std::fs::write(directory.join("sdk-token.tmp"), &token)?;
                    std::fs::rename(directory.join("sdk-token.tmp"), &token_path)?;
                    let persisted = std::fs::read_to_string(&token_path)?;
                    listener = Some(McpListener::bind_at(address, persisted.clone(), Some(app.handle().clone())).await?);
                    response["token"] = json!(persisted);
                }
                Some("shutdown") => {
                    listener.take().ok_or_else(|| io::Error::other("Listener already stopped"))?.shutdown().await?;
                    if TcpStream::connect(address).await.is_ok() {
                        return Err(io::Error::other("SDK fixture listener remains open").into());
                    }
                }
                _ => return Err(io::Error::other("Unknown SDK fixture command").into()),
            }
            input.write_all(format!("{response}\n").as_bytes()).await?;
        }
        let status = child.wait().await?;
        if !status.success() || listener.is_some() {
            return Err(io::Error::other(format!("SDK acceptance did not finish: {status}")).into());
        }
        Ok::<_, Box<dyn std::error::Error>>(())
    })
    .await;
    if child.try_wait().unwrap().is_none() {
        child.kill().await.unwrap();
    }
    let status = child.wait().await.unwrap();
    drop(pg);
    if let Some(conn) = mysql {
        conn.disconnect().await.unwrap();
    }
    if let Some(listener) = listener {
        listener.shutdown().await.unwrap();
    }
    assert!(TcpStream::connect(address).await.is_err());
    result.expect("SDK acceptance timed out").unwrap();
    assert!(status.success(), "SDK client failed: {status}");
    assert_eq!(app.state::<AppState>().sessions.lock().await.len(), 3);
}

#[tokio::test]
async fn listener_replacement_rejects_old_token_and_closes_keep_alive() {
    let reservation = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = reservation.local_addr().unwrap();
    drop(reservation);
    let listener = McpListener::bind_at::<tauri::Wry>(address, "old".into(), None)
        .await
        .unwrap();
    let mut socket = TcpStream::connect(address).await.unwrap();
    let message = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}});
    let body = message.to_string();
    socket.write_all(format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:19482\r\nAuthorization: Bearer old\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
    let mut response = vec![0; 8192];
    let count = tokio::time::timeout(Duration::from_secs(3), socket.read(&mut response))
        .await
        .unwrap()
        .unwrap();
    assert!(String::from_utf8_lossy(&response[..count]).starts_with("HTTP/1.1 200"));
    listener.shutdown().await.unwrap();
    let listener = McpListener::bind_at::<tauri::Wry>(address, "new".into(), None)
        .await
        .unwrap();
    let mut remaining = Vec::new();
    tokio::time::timeout(Duration::from_secs(3), socket.read_to_end(&mut remaining))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(request(address, "old", message.clone()).await.0, 401);
    assert_eq!(request(address, "new", message).await.0, 200);
    listener.shutdown().await.unwrap();
}

#[tokio::test]
async fn authenticated_http_tools_against_all_databases() {
    let _guard = super::mcp_query::AGENT_TESTS.lock().await;
    let directory = std::env::temp_dir().join(format!("esploro-http-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let state = AppState::default();
    let mut profiles = Vec::new();
    let mut sessions = Vec::new();
    for (id, variable, driver) in [
        ("postgres", "ESPLORO_TEST_POSTGRES_URL", "postgres"),
        ("mysql", "ESPLORO_TEST_MYSQL_URL", "mysql"),
        ("mariadb", "ESPLORO_TEST_MARIADB_URL", "mysql"),
    ] {
        let url = std::env::var(variable).expect("HTTP acceptance requires all three databases");
        let session = if driver == "postgres" {
            DriverSession::Postgres(Arc::new(common::pg_pool(&url)))
        } else {
            DriverSession::Mysql(Arc::new(common::mysql_pool(&url)))
        };
        let huge = "é".repeat(140_000);
        let definitions = (0..105)
            .map(|n| format!("c{n:03} INTEGER"))
            .collect::<Vec<_>>()
            .join(",");
        let setup = format!("CREATE SCHEMA t6_metadata; CREATE TABLE t6_metadata.columns_page ({definitions}); CREATE TABLE t6_metadata.oversized (a_huge TEXT DEFAULT '{huge}', z_end INTEGER); CREATE VIEW t6_metadata.a_view AS SELECT c000 FROM t6_metadata.columns_page");
        let medium = "é".repeat(70_000);
        let setup = format!("{setup}; CREATE TABLE t6_metadata.byte_pages (a TEXT DEFAULT '{medium}', b TEXT DEFAULT '{medium}')");
        match &session {
            DriverSession::Postgres(pool) => {
                pool.get()
                    .await
                    .unwrap()
                    .batch_execute(&setup)
                    .await
                    .unwrap();
            }
            DriverSession::Mysql(pool) => {
                use mysql_async::prelude::Queryable;
                let mut conn = pool.get_conn().await.unwrap();
                let variants = (0..1500)
                    .map(|n| format!("'v{n:04}{}'", "\u{1}".repeat(30)))
                    .collect::<Vec<_>>()
                    .join(",");
                let setup = setup.replace(
                    &format!("a_huge TEXT DEFAULT '{huge}'"),
                    &format!("a_huge ENUM({variants})"),
                );
                let medium_type = (0..800)
                    .map(|n| format!("'v{n:04}{}'", "\u{1}".repeat(30)))
                    .collect::<Vec<_>>()
                    .join(",");
                let setup = setup.replace(
                    &format!("TEXT DEFAULT '{medium}'"),
                    &format!("ENUM({medium_type})"),
                );
                for statement in setup.split(';').filter(|s| !s.trim().is_empty()) {
                    conn.query_drop(statement).await.unwrap();
                }
            }
        }
        sessions.push((
            id.to_string(),
            SessionInfo {
                driver: session,
                connection_id: id.into(),
            },
        ));
        profiles.push(json!({"id":id,"displayName":id,"driver":driver,"host":"127.0.0.1","port":1,"database":common::db_name_from_url(&url),"username":"acceptance","sslMode":"disable","createdAt":"","updatedAt":""}));
    }
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().identifier = directory.to_string_lossy().into_owned();
    let app = tauri::test::mock_builder()
        .manage(PolicyStore::open(directory.join("policy.json")))
        .manage(state)
        .manage(ActivityStore::open(directory.join("activity.json")))
        .build(context)
        .unwrap();
    let data = app.path().app_data_dir().unwrap();
    std::fs::create_dir_all(&data).unwrap();
    std::fs::write(
        data.join("connections.json"),
        serde_json::to_vec(&profiles).unwrap(),
    )
    .unwrap();
    let reserved = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = reserved.local_addr().unwrap();
    drop(reserved);
    let server = McpListener::bind_at(
        address,
        "acceptance-token".into(),
        Some(app.handle().clone()),
    )
    .await
    .unwrap();
    let message = json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_connections","arguments":{}}});
    assert_eq!(request(address, "wrong", message.clone()).await.0, 401);
    assert_eq!(request(address, "", message).await.0, 401);
    let discovery = json!({"jsonrpc":"2.0","id":1,"method":"tools/list"});
    let tools = request(address, "acceptance-token", discovery).await;
    assert_eq!(tools.0, 200);
    assert_eq!(tools.1["result"]["tools"].as_array().unwrap().len(), 3);
    let initialize = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"acceptance","version":"1"}}});
    assert_eq!(
        request(address, "acceptance-token", initialize).await.1["result"]["protocolVersion"],
        "2025-06-18"
    );
    let denied_list = call(address, "list_connections", json!({})).await;
    assert_eq!(denied_list["structuredContent"]["connections"], json!([]));
    for name in ["inspect_schema", "execute_query"] {
        let mut unavailable = None;
        for id in ["postgres", "mysql", "mariadb", "missing"] {
            let mut arguments = json!({"connectionId":id});
            if name == "execute_query" {
                arguments["sql"] = json!("SELECT 1 AS acceptance");
            }
            let result = call(address, name, arguments).await;
            assert_eq!(result["isError"], true, "{result}");
            assert!(result["structuredContent"].get("schemas").is_none());
            assert!(result["structuredContent"].get("rows").is_none());
            if let Some(expected) = &unavailable {
                assert_eq!(&result, expected);
            } else {
                unavailable = Some(result);
            }
            assert!(app.state::<AppState>().sessions.lock().await.is_empty());
        }
    }
    app.state::<PolicyStore>()
        .save(McpPolicy {
            enabled: true,
            permitted_connection_ids: vec!["postgres".into()],
            ..Default::default()
        })
        .unwrap();
    let filtered = call(address, "list_connections", json!({})).await;
    assert_eq!(
        filtered["structuredContent"]["connections"],
        json!([{"connectionId":"postgres","label":"postgres"}])
    );
    for name in ["inspect_schema", "execute_query"] {
        let mut expected = None;
        for id in ["mysql", "mariadb", "missing"] {
            let mut arguments = json!({"connectionId":id});
            if name == "execute_query" {
                arguments["sql"] = json!("SELECT 1 AS acceptance");
            }
            let result = call(address, name, arguments).await;
            assert_eq!(result["isError"], true);
            assert_eq!(result["structuredContent"].as_object().unwrap().len(), 2);
            if let Some(expected) = &expected {
                assert_eq!(&result, expected);
            } else {
                expected = Some(result);
            }
            assert!(app.state::<AppState>().sessions.lock().await.is_empty());
        }
    }
    app.state::<PolicyStore>()
        .save(McpPolicy {
            enabled: true,
            permitted_connection_ids: vec!["postgres".into(), "mysql".into(), "mariadb".into()],
            ..Default::default()
        })
        .unwrap();
    let list = call(address, "list_connections", json!({})).await;
    assert_eq!(
        list["structuredContent"]["connections"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert!(!list.to_string().contains("username"));
    assert!(app.state::<AppState>().sessions.lock().await.is_empty());
    for args in [
        json!({"connectionId":"postgres","cursor":"invalid"}),
        json!({"connectionId":"mysql","object":"x"}),
        json!({"connectionId":"mariadb","limit":101}),
    ] {
        let (_, invalid) = request(address, "acceptance-token", json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"inspect_schema","arguments":args}})).await;
        assert!(invalid.get("error").is_some(), "{invalid}");
        assert!(app.state::<AppState>().sessions.lock().await.is_empty());
    }
    app.state::<AppState>()
        .sessions
        .lock()
        .await
        .extend(sessions);
    let state = app.state::<AppState>();
    let held = state.sessions.lock().await;
    let pending = json!({"jsonrpc":"2.0","id":"cancel-me","method":"tools/call","params":{"name":"inspect_schema","arguments":{"connectionId":"postgres"}}});
    let work = tokio::spawn(request(address, "acceptance-token", pending.clone()));
    tokio::time::sleep(Duration::from_millis(250)).await;
    let duplicate = request(address, "acceptance-token", pending).await;
    assert_eq!(duplicate.1["error"]["code"], -32600);
    let cancel = json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"cancel-me"}});
    assert_eq!(request(address, "wrong-token", cancel.clone()).await.0, 401);
    assert!(!work.is_finished());
    assert_eq!(request(address, "acceptance-token", cancel).await.0, 202);
    let cancelled = tokio::time::timeout(Duration::from_secs(2), work)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(cancelled.1["error"]["code"], -32800);
    let disconnected = json!({"jsonrpc":"2.0","id":"disconnected","method":"tools/call","params":{"name":"inspect_schema","arguments":{"connectionId":"postgres"}}});
    let mut socket = TcpStream::connect(address).await.unwrap();
    let body = disconnected.to_string();
    socket.write_all(format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:19482\r\nAuthorization: Bearer acceptance-token\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nMCP-Protocol-Version: 2025-06-18\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;
    drop(socket);
    assert_eq!(
        request(address, "acceptance-token", disconnected).await.1["error"]["code"],
        -32600
    );
    let mut keep_alive = TcpStream::connect(address).await.unwrap();
    for message in [
        json!({"jsonrpc":"2.0","id":"ping","method":"ping"}),
        json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"disconnected"}}),
    ] {
        let body = message.to_string();
        keep_alive.write_all(format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:19482\r\nAuthorization: Bearer acceptance-token\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nMCP-Protocol-Version: 2025-06-18\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        let mut bytes = vec![0; 4096];
        let size = tokio::time::timeout(Duration::from_secs(2), keep_alive.read(&mut bytes))
            .await
            .unwrap()
            .unwrap();
        assert!(
            String::from_utf8_lossy(&bytes[..size]).contains(if message.get("id").is_some() {
                "200 OK"
            } else {
                "202 Accepted"
            })
        );
    }
    drop(keep_alive);
    tokio::time::sleep(Duration::from_millis(100)).await;
    let started = std::time::Instant::now();
    let inspection = tokio::spawn(call(
        address,
        "inspect_schema",
        json!({"connectionId":"postgres"}),
    ));
    let query = tokio::spawn(call(
        address,
        "execute_query",
        json!({"connectionId":"postgres","sql":"SELECT 1"}),
    ));
    tokio::time::sleep(Duration::from_millis(250)).await;
    for name in ["inspect_schema", "execute_query"] {
        let args = if name == "execute_query" {
            json!({"connectionId":"postgres","sql":"SELECT 1"})
        } else {
            json!({"connectionId":"postgres"})
        };
        let result = tokio::time::timeout(Duration::from_secs(2), call(address, name, args))
            .await
            .unwrap();
        assert_eq!(result["isError"], true, "{result}");
        assert_eq!(result["structuredContent"]["retryable"], true, "{result}");
    }
    for task in [inspection, query] {
        let result = task.await.unwrap();
        assert_eq!(result["isError"], true, "{result}");
        assert!(
            result["structuredContent"]["error"]
                .as_str()
                .unwrap()
                .contains("timed out"),
            "{result}"
        );
    }
    assert!(started.elapsed() < Duration::from_secs(35));
    drop(held);
    for name in ["inspect_schema", "execute_query"] {
        let args = if name == "execute_query" {
            json!({"connectionId":"postgres","sql":"SELECT 1"})
        } else {
            json!({"connectionId":"postgres"})
        };
        let result = call(address, name, args).await;
        assert_eq!(result["isError"], false, "{result}");
    }
    for id in ["postgres", "mysql", "mariadb"] {
        let driver = {
            let sessions = state.sessions.lock().await;
            match &sessions[id].driver {
                DriverSession::Postgres(pool) => DriverSession::Postgres(pool.clone()),
                DriverSession::Mysql(pool) => DriverSession::Mysql(pool.clone()),
            }
        };
        let sql = "SELECT c000 FROM t6_metadata.columns_page";
        let pg_blocker;
        let mut mysql_blocker;
        match &driver {
            DriverSession::Postgres(pool) => {
                pg_blocker = Some(pool.get().await.unwrap());
                pg_blocker
                    .as_ref()
                    .unwrap()
                    .batch_execute(
                        "BEGIN; LOCK TABLE t6_metadata.columns_page IN ACCESS EXCLUSIVE MODE",
                    )
                    .await
                    .unwrap();
                mysql_blocker = None;
            }
            DriverSession::Mysql(pool) => {
                use mysql_async::prelude::Queryable;
                pg_blocker = None;
                let mut conn = pool.get_conn().await.unwrap();
                conn.query_drop("LOCK TABLES t6_metadata.columns_page WRITE")
                    .await
                    .unwrap();
                mysql_blocker = Some(conn);
            }
        }
        let message = json!({"jsonrpc":"2.0","id":"database-cancel","method":"tools/call","params":{"name":"execute_query","arguments":{"connectionId":id,"sql":sql}}});
        let work = tokio::spawn(request(address, "acceptance-token", message));
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(!work.is_finished());
        request(address, "acceptance-token", json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"database-cancel"}})).await;
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), work)
                .await
                .unwrap()
                .unwrap()
                .1["error"]["code"],
            -32800
        );
        let until = tokio::time::Instant::now() + Duration::from_secs(8);
        loop {
            let active: i64 = if let Some(conn) = &pg_blocker {
                conn.query_one("SELECT count(*) FROM pg_stat_activity WHERE query = $1 AND pid <> pg_backend_pid()", &[&sql]).await.unwrap().get(0)
            } else {
                use mysql_async::prelude::Queryable;
                mysql_blocker
                    .as_mut()
                    .unwrap()
                    .exec_first::<i64, _, _>(
                        "SELECT count(*) FROM information_schema.PROCESSLIST WHERE INFO = ?",
                        (sql,),
                    )
                    .await
                    .unwrap()
                    .unwrap()
            };
            if active == 0 {
                break;
            }
            assert!(
                tokio::time::Instant::now() < until,
                "Cancelled database work remains active: {id}"
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if let Some(conn) = pg_blocker {
            conn.batch_execute("ROLLBACK").await.unwrap();
        }
        if let Some(mut conn) = mysql_blocker {
            use mysql_async::prelude::Queryable;
            conn.query_drop("UNLOCK TABLES").await.unwrap();
        }
        assert_eq!(
            call(
                address,
                "execute_query",
                json!({"connectionId":id,"sql":"SELECT 1"})
            )
            .await["isError"],
            false
        );
        let schema = call(address, "inspect_schema", json!({"connectionId":id})).await;
        assert_ne!(schema["isError"], true, "{schema}");
        assert!(schema["structuredContent"]["schemas"].as_array().is_some());
        let schemas = traverse(address, json!({"connectionId":id,"limit":1}), "schemas").await;
        assert!(schemas.iter().any(|s| s["name"] == "t6_metadata"));
        let objects = traverse(
            address,
            json!({"connectionId":id,"schema":"t6_metadata","limit":1}),
            "objects",
        )
        .await;
        assert_eq!(
            objects
                .iter()
                .map(|v| v["name"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["a_view", "byte_pages", "columns_page", "oversized"]
        );
        assert_eq!(objects[0]["kind"], "VIEW");
        assert_eq!(objects[1]["kind"], "BASE TABLE");
        let bytes = call(
            address,
            "inspect_schema",
            json!({"connectionId":id,"schema":"t6_metadata","object":"byte_pages","limit":100}),
        )
        .await;
        let bytes = &bytes["structuredContent"];
        assert!(serde_json::to_vec(bytes).unwrap().len() <= 256_000);
        assert_eq!(bytes["truncated"], true);
        assert_eq!(bytes["omittedEntries"], 0);
        assert_eq!(bytes["truncationReasons"], json!(["byteLimit"]));
        assert_eq!(bytes["columns"].as_array().unwrap().len(), 1);
        assert_eq!(bytes["columns"][0]["name"], "a");
        let continuation = call(address, "inspect_schema", json!({"connectionId":id,"schema":"t6_metadata","object":"byte_pages","cursor":bytes["nextCursor"]})).await;
        assert_eq!(continuation["structuredContent"]["columns"][0]["name"], "b");
        assert_eq!(continuation["structuredContent"]["truncated"], false);
        let columns = traverse(
            address,
            json!({"connectionId":id,"schema":"t6_metadata","object":"columns_page","limit":7}),
            "columns",
        )
        .await;
        let default_page = call(
            address,
            "inspect_schema",
            json!({"connectionId":id,"schema":"t6_metadata","object":"columns_page"}),
        )
        .await;
        let default_page = &default_page["structuredContent"];
        assert_eq!(default_page["columns"].as_array().unwrap().len(), 50);
        assert_eq!(default_page["truncationReasons"], json!(["pageLimit"]));
        let final_page = call(address, "inspect_schema", json!({"connectionId":id,"schema":"t6_metadata","object":"columns_page","limit":100,"cursor":default_page["nextCursor"]})).await;
        assert_eq!(
            final_page["structuredContent"]["columns"]
                .as_array()
                .unwrap()
                .len(),
            55
        );
        assert_eq!(
            final_page["structuredContent"]["columns"][0]["name"],
            "c050"
        );
        assert_eq!(final_page["structuredContent"]["truncated"], false);
        assert_eq!(columns.len(), 105);
        for (n, column) in columns.iter().enumerate() {
            assert_eq!(column["name"], format!("c{n:03}"));
            assert!(column["dataType"].as_str().is_some());
            assert_eq!(column["isNullable"], true);
            assert!(column.get("columnDefault").is_some());
        }
        let view = traverse(
            address,
            json!({"connectionId":id,"schema":"t6_metadata","object":"a_view"}),
            "columns",
        )
        .await;
        assert_eq!(view.len(), 1);
        let huge = call(
            address,
            "inspect_schema",
            json!({"connectionId":id,"schema":"t6_metadata","object":"oversized","limit":1}),
        )
        .await;
        let page = &huge["structuredContent"];
        assert!(serde_json::to_vec(page).unwrap().len() <= 256_000);
        assert_eq!(page["omittedEntries"], 1, "{huge}");
        assert_eq!(page["truncationReasons"], json!(["byteLimit"]));
        assert_eq!(page["truncated"], true);
        assert_eq!(page["columns"], json!([]));
        let end = call(address, "inspect_schema", json!({"connectionId":id,"schema":"t6_metadata","object":"oversized","limit":1,"cursor":page["nextCursor"]})).await;
        assert_eq!(end["structuredContent"]["columns"][0]["name"], "z_end");
        assert_eq!(end["structuredContent"]["truncated"], false);
        assert!(end["structuredContent"]["nextCursor"].is_null());
        for args in [
            json!({"connectionId":id,"cursor":"invalid"}),
            json!({"connectionId":id,"object":"x"}),
            json!({"connectionId":id,"limit":0}),
            json!({"connectionId":id,"limit":101}),
            json!({"connectionId":id,"limit":1.5}),
            json!({"connectionId":id,"schema":"different","cursor":page["nextCursor"]}),
            json!({"connectionId":id,"schema":"t6_metadata","object":"columns_page","cursor":page["nextCursor"]}),
            json!({"connectionId":format!("wrong-{id}"),"schema":"t6_metadata","object":"oversized","cursor":page["nextCursor"]}),
        ] {
            let (_, invalid) = request(address, "acceptance-token", json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"inspect_schema","arguments":args}})).await;
            assert!(invalid.get("error").is_some(), "{invalid}");
        }
        let result = call(
            address,
            "execute_query",
            json!({"connectionId":id,"sql":"SELECT 1 AS acceptance"}),
        )
        .await;
        assert_ne!(result["isError"], true, "{result}");
        assert_eq!(
            result["structuredContent"]["columns"],
            json!(["acceptance"])
        );
        assert_eq!(
            result["structuredContent"]["rows"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        for sql in [
            "DELETE FROM acceptance",
            "SELECT 1; SELECT 2",
            "SELECT * FROM missing_acceptance_table",
        ] {
            let result = call(
                address,
                "execute_query",
                json!({"connectionId":id,"sql":sql}),
            )
            .await;
            assert_eq!(result["isError"], true, "{result}");
        }
        for (sql, category) in [
            ("SELECT 'private_secret'; SELECT 2", "multiple statements:"),
            ("SELECT private_secret()", "functions:"),
            ("SELECT * FROM private_secret FOR UPDATE", "locks:"),
            (
                "SELECT CAST('private_secret' AS INTEGER)",
                "unsupported expression:",
            ),
            ("SELECT 'private_secret", "syntax:"),
        ] {
            let result = call(
                address,
                "execute_query",
                json!({"connectionId":id,"sql":sql}),
            )
            .await;
            assert_eq!(result["isError"], true, "{result}");
            let public = result.to_string();
            assert!(public.contains(category), "{public}");
            assert!(!public.contains("private_secret"), "{public}");
        }
        assert_ne!(
            call(
                address,
                "execute_query",
                json!({"connectionId":id,"sql":"SELECT 2"})
            )
            .await["isError"],
            true
        );
    }
    app.state::<PolicyStore>()
        .save(McpPolicy::default())
        .unwrap();
    assert_eq!(
        call(address, "list_connections", json!({})).await["structuredContent"]["connections"],
        json!([])
    );
    for name in ["inspect_schema", "execute_query"] {
        let mut arguments = json!({"connectionId":"postgres"});
        if name == "execute_query" {
            arguments["sql"] = json!("SELECT 1 AS acceptance");
        }
        let result = call(address, name, arguments).await;
        assert_eq!(result["isError"], true);
        assert!(result["structuredContent"].get("schemas").is_none());
        assert!(result["structuredContent"].get("rows").is_none());
        assert_eq!(app.state::<AppState>().sessions.lock().await.len(), 3);
    }
    app.state::<PolicyStore>()
        .save(McpPolicy {
            enabled: true,
            permitted_connection_ids: vec!["postgres".into(), "mysql".into(), "mariadb".into()],
            ..Default::default()
        })
        .unwrap();
    let history = app.state::<ActivityStore>().history();
    assert_eq!(history.len(), 20);
    assert_eq!(
        history
            .iter()
            .filter(|entry| entry.status == ActivityStatus::Failed)
            .count(),
        15
    );
    std::fs::create_dir(directory.join("activity.json.tmp")).unwrap();
    for _ in 0..10 {
        assert_ne!(
            call(
                address,
                "execute_query",
                json!({"connectionId":"postgres","sql":"SELECT 3"})
            )
            .await["isError"],
            true
        );
    }
    let history = app.state::<ActivityStore>().history();
    assert_eq!(history.len(), 20);
    assert!(history
        .windows(2)
        .all(|entries| entries[0].started_at >= entries[1].started_at));
    assert!(app.state::<ActivityStore>().degraded());
    assert_eq!(history[0].status, ActivityStatus::Succeeded);
    std::fs::remove_dir(directory.join("activity.json.tmp")).unwrap();
    app.state::<ActivityStore>().retry().unwrap();
    assert!(!app.state::<ActivityStore>().degraded());
    let reopened = ActivityStore::open(directory.join("activity.json"));
    assert_eq!(reopened.history().len(), 20);
    reopened.clear(Some(app.handle())).unwrap();
    assert!(ActivityStore::open(directory.join("activity.json"))
        .history()
        .is_empty());
    if std::env::var_os("ESPLORO_VERIFY_SDK").is_some() {
        verify_sdk_client(&app, server, address, &directory).await;
    } else {
        assert!(
            std::env::var_os("ESPLORO_REQUIRE_DATABASES").is_none(),
            "Required MCP acceptance must run the SDK client"
        );
        server.shutdown().await.unwrap();
    }
    assert!(TcpStream::connect(address).await.is_err());
    drop(app);
    std::fs::remove_dir_all(directory).unwrap();
}
