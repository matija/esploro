use crate::{
    commands::{connections, schema},
    AppError, AppState, ConnectionProfile,
};
use serde_json::{json, Value};
use tauri::Manager;

pub fn definitions() -> Value {
    json!([
        {"name":"list_connections","description":"List all saved connection identifiers and labels without credentials. Does not connect to databases.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}},
        {"name":"execute_query","description":"Execute one validated read-only SELECT. Results are bounded; busy errors are retryable.","inputSchema":{"type":"object","properties":{"connectionId":{"type":"string","minLength":1},"sql":{"type":"string","minLength":1}},"required":["connectionId","sql"],"additionalProperties":false}},
        {"name":"inspect_schema","description":"Inspect schemas, objects and table/view columns for a saved connection. Opens a session lazily using its Keychain password.","inputSchema":{"type":"object","properties":{"connectionId":{"type":"string","minLength":1}},"required":["connectionId"],"additionalProperties":false}}
    ])
}

fn discovery(profiles: &[ConnectionProfile]) -> Value {
    Value::Array(
        profiles
            .iter()
            .map(|p| json!({"connectionId":p.id,"label":p.display_name}))
            .collect(),
    )
}

async fn inspect(
    profiles: &[ConnectionProfile],
    id: &str,
    state: &AppState,
) -> Result<Value, AppError> {
    let profile = profiles.iter().find(|p| p.id == id).ok_or_else(|| {
        AppError::Connection(format!(
            "Connection {id} not found. Use list_connections to select a saved profile."
        ))
    })?;
    let result = async {
        let session = connections::ensure_session(profile, state).await?;
        inspect_session(profile, session, state).await
    }
    .await;
    result.map_err(|error| {
        AppError::Connection(format!("Cannot inspect connection {id}: {error}. Check the database availability and host/port settings."))
    })
}

async fn inspect_session(
    profile: &ConnectionProfile,
    session: String,
    state: &AppState,
) -> Result<Value, AppError> {
    let id = &profile.id;
    let mut schemas = Vec::new();
    for name in schema::schemas(&session, &profile.database, state).await? {
        let objects = schema::objects(
            session.clone(),
            profile.database.clone(),
            name.clone(),
            state,
        )
        .await?;
        let mut columns = serde_json::Map::new();
        for table in objects
            .tables
            .iter()
            .map(|t| &t.name)
            .chain(objects.views.iter())
        {
            columns.insert(
                table.clone(),
                serde_json::to_value(
                    schema::columns(
                        session.clone(),
                        profile.database.clone(),
                        name.clone(),
                        table.clone(),
                        state,
                    )
                    .await?,
                )?,
            );
        }
        schemas.push(json!({"name":name,"objects":objects,"columns":columns}));
    }
    Ok(json!({"connectionId":id,"schemas":schemas}))
}

pub async fn call<R: tauri::Runtime>(
    app: Option<&tauri::AppHandle<R>>,
    name: &str,
    arguments: &Value,
) -> Result<Value, &'static str> {
    let valid = arguments.as_object().is_some_and(|args| match name {
        "list_connections" => args.is_empty(),
        "inspect_schema" | "execute_query" => {
            (if name == "execute_query" {
                args.len() == 2
                    && args
                        .get("sql")
                        .and_then(Value::as_str)
                        .is_some_and(|s| !s.is_empty())
            } else {
                args.len() == 1
            }) && args
                .get("connectionId")
                .and_then(Value::as_str)
                .is_some_and(|id| !id.is_empty())
        }
        _ => false,
    });
    if !valid {
        return Err("Unknown tool or invalid arguments");
    }
    let mut activity = None;
    let started = std::time::Instant::now();
    let result = async {
        let app = app.ok_or_else(|| AppError::Connection("Application is unavailable".into()))?;
        let profiles = connections::load_profiles(app).await;
        if name == "execute_query" {
            let store = app.state::<super::activity::ActivityStore>();
            let id = arguments["connectionId"].as_str().unwrap();
            let label = profiles
                .as_ref()
                .ok()
                .and_then(|profiles| profiles.iter().find(|p| p.id == id))
                .map(|p| p.display_name.clone());
            activity =
                Some(store.begin(Some(app), id, label, arguments["sql"].as_str().unwrap())?);
        }
        let profiles = profiles?;
        match name {
            "list_connections" => Ok(discovery(&profiles)),
            "execute_query" => {
                let id = arguments["connectionId"].as_str().unwrap();
                let profile = profiles
                    .iter()
                    .find(|p| p.id == id)
                    .ok_or_else(|| AppError::Connection("Connection not found".into()))?;
                super::validate_sql(
                    arguments["sql"].as_str().unwrap(),
                    match profile.driver {
                        connections::DbDriver::Postgres => super::SqlDialect::Postgres,
                        connections::DbDriver::Mysql => super::SqlDialect::Mysql,
                    },
                )
                .map_err(AppError::Validation)?;
                let state = app.state::<AppState>();
                let session = connections::ensure_session(profile, &state).await?;
                let driver = match &state
                    .sessions
                    .lock()
                    .await
                    .get(&session)
                    .ok_or_else(|| AppError::Connection("Session not found".into()))?
                    .driver
                {
                    crate::DriverSession::Postgres(pool) => {
                        crate::DriverSession::Postgres(pool.clone())
                    }
                    crate::DriverSession::Mysql(pool) => crate::DriverSession::Mysql(pool.clone()),
                };
                super::query::execute(&driver, arguments["sql"].as_str().unwrap()).await
            }
            _ => {
                inspect(
                    &profiles,
                    arguments["connectionId"].as_str().unwrap(),
                    &app.state::<AppState>(),
                )
                .await
            }
        }
    }
    .await;
    let result = if let (Some(app), Some(id)) = (app, activity) {
        match app.state::<super::activity::ActivityStore>().finish(
            Some(app),
            &id,
            started.elapsed().as_millis() as u64,
            &result,
        ) {
            Ok(()) => result,
            Err(error) => Err(error),
        }
    } else {
        result
    };
    Ok(match result {
        Ok(value) => {
            json!({"content":[{"type":"text","text":value.to_string()}],"structuredContent": if name == "list_connections" { json!({"connections":value}) } else { value },"isError":false})
        }
        Err(error) => {
            json!({"content":[{"type":"text","text":error.to_string()}],"structuredContent":{"error":error.to_string(),"retryable":error.to_string().starts_with("busy:")},"isError":true})
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(driver: &str) -> ConnectionProfile {
        serde_json::from_value(json!({"id":uuid::Uuid::new_v4().to_string(),"displayName":"Local database","color":null,"folder":null,"driver":driver,"host":"127.0.0.1","port":1,"socketPath":null,"database":"app","username":"secret-user","sslMode":"disable","createdAt":"","updatedAt":""})).unwrap()
    }

    #[tokio::test]
    async fn discovery_exposes_all_profiles_without_credentials_or_sessions() {
        let state = AppState::default();
        let profiles = vec![profile("postgres"), profile("mysql")];
        let result = discovery(&profiles);
        assert_eq!(result.as_array().unwrap().len(), 2);
        for (entry, profile) in result.as_array().unwrap().iter().zip(&profiles) {
            assert_eq!(
                entry,
                &json!({"connectionId":profile.id,"label":profile.display_name})
            );
        }
        assert!(state.sessions.lock().await.is_empty());
    }

    #[tokio::test]
    async fn inspection_reports_missing_keychain_credentials_without_sessions() {
        for driver in ["postgres", "mysql"] {
            let state = AppState::default();
            let profile = profile(driver);
            let error = inspect(std::slice::from_ref(&profile), &profile.id, &state)
                .await
                .unwrap_err()
                .to_string();
            assert!(
                error.contains("Credentials unavailable") && error.contains("Keychain"),
                "{error}"
            );
            assert!(state.sessions.lock().await.is_empty());
        }
    }

    #[tokio::test]
    async fn inspection_reports_unreachable_databases_for_both_drivers() {
        let reserved = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = reserved.local_addr().unwrap().port();
        drop(reserved);
        for driver in ["postgres", "mysql"] {
            let mut profile = profile(driver);
            profile.port = port;
            let state = AppState::default();
            let pool = if driver == "postgres" {
                let mut config = deadpool_postgres::Config::new();
                config.host = profile.host.clone();
                config.port = Some(port);
                config.dbname = Some(profile.database.clone());
                config.user = Some(profile.username.clone());
                crate::DriverSession::Postgres(std::sync::Arc::new(
                    config
                        .create_pool(
                            Some(deadpool_postgres::Runtime::Tokio1),
                            tokio_postgres::NoTls,
                        )
                        .unwrap(),
                ))
            } else {
                crate::DriverSession::Mysql(std::sync::Arc::new(mysql_async::Pool::new(
                    mysql_async::OptsBuilder::default()
                        .ip_or_hostname("127.0.0.1")
                        .tcp_port(port),
                )))
            };
            state.sessions.lock().await.insert(
                "existing".into(),
                crate::SessionInfo {
                    driver: pool,
                    connection_id: profile.id.clone(),
                },
            );
            let error = inspect(std::slice::from_ref(&profile), &profile.id, &state)
                .await
                .unwrap_err()
                .to_string();
            assert!(error.to_lowercase().contains("refused"), "{error}");
            assert!(
                error.contains("host/port") && error.contains(&profile.id),
                "{error}"
            );
            assert_eq!(state.sessions.lock().await.len(), 1);
        }
    }

    #[tokio::test]
    async fn mysql_and_mariadb_inspection_returns_objects_and_columns_from_shared_cache() {
        let profile = profile("mysql");
        let state = AppState::default();
        let session = "session".to_string();
        let pool = mysql_async::Pool::new(mysql_async::OptsBuilder::default());
        state.sessions.lock().await.insert(
            session.clone(),
            crate::SessionInfo {
                connection_id: profile.id.clone(),
                driver: crate::DriverSession::Mysql(std::sync::Arc::new(pool)),
            },
        );
        let key = schema::SchemaCacheKey {
            session_id: session.clone(),
            database: profile.database.clone(),
            schema: profile.database.clone(),
        };
        state
            .schema_cache
            .store_objects(
                key.clone(),
                &schema::SchemaObjects {
                    tables: vec![schema::TableSummary {
                        name: "users".into(),
                        estimated_row_count: Some(2),
                    }],
                    views: vec![],
                    sequences: vec![],
                    functions: vec![],
                },
            )
            .await;
        state
            .schema_cache
            .store_columns(
                key,
                "users",
                &[schema::ColumnDef {
                    name: "id".into(),
                    data_type: "int".into(),
                    is_nullable: false,
                    column_default: None,
                    is_primary_key: true,
                    is_foreign_key: false,
                    foreign_key_ref: None,
                    is_enum: false,
                }],
            )
            .await;
        let result = inspect(std::slice::from_ref(&profile), &profile.id, &state)
            .await
            .unwrap();
        assert_eq!(
            result["schemas"][0]["objects"]["tables"][0]["name"],
            "users"
        );
        assert_eq!(
            result["schemas"][0]["columns"]["users"][0]["isPrimaryKey"],
            true
        );
        assert_eq!(state.sessions.lock().await.len(), 1);
    }

    #[tokio::test]
    async fn missing_profile_is_actionable_and_opens_no_session() {
        let state = AppState::default();
        let error = inspect(&[], "missing", &state)
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("not found") && error.contains("list_connections"));
        assert!(state.sessions.lock().await.is_empty());
    }
}
