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
        Duration::from_secs(15),
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
    let (status, value) = request(address, "acceptance-token", json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":name,"arguments":arguments}})).await;
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
        .manage(ActivityStore::open(directory.join("activity.json")).unwrap())
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
    for id in ["postgres", "mysql", "mariadb"] {
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
    assert_eq!(history.len(), 15);
    assert_eq!(
        history
            .iter()
            .filter(|entry| entry.status == ActivityStatus::Failed)
            .count(),
        9
    );
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
    let reopened = ActivityStore::open(directory.join("activity.json")).unwrap();
    assert_eq!(reopened.history().len(), 20);
    reopened.clear(Some(app.handle())).unwrap();
    assert!(ActivityStore::open(directory.join("activity.json"))
        .unwrap()
        .history()
        .is_empty());
    server.shutdown().await.unwrap();
    assert!(TcpStream::connect(address).await.is_err());
    drop(app);
    std::fs::remove_dir_all(directory).unwrap();
}
