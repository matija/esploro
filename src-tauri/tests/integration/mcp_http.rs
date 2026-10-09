use super::common;
use esploro_lib::{
    mcp::{
        activity::{ActivityStatus, ActivityStore},
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
    app.state::<AppState>()
        .sessions
        .lock()
        .await
        .extend(sessions);
    for id in ["postgres", "mysql", "mariadb"] {
        let schema = call(address, "inspect_schema", json!({"connectionId":id})).await;
        assert_ne!(schema["isError"], true, "{schema}");
        assert!(schema["structuredContent"]["schemas"].as_array().is_some());
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
