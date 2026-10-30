use crate::{commands::connections, AppError, AppState, ConnectionProfile};
use serde_json::{json, Value};
use tauri::Manager;

use super::policy::PolicyStore;

fn authorize(policy: &PolicyStore, id: &str) -> Result<(), AppError> {
    if policy.permits(id) {
        Ok(())
    } else {
        Err(unavailable())
    }
}

fn unavailable() -> AppError {
    AppError::Connection(
        "Connection unavailable. Use list_connections to select an available profile.".into(),
    )
}

pub fn definitions() -> Value {
    json!([
        {"name":"list_connections","description":"List permitted saved connection identifiers and labels without credentials. Does not connect to databases.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}},
        {"name":"execute_query","description":"Execute one read-only SELECT, including CTEs, joins, subqueries and set operations. Supports identifiers, literals, ordinary operators, predicates and CASE. Only unqualified count, sum, avg, min, max, abs, round, lower, upper, length, coalesce and nullif functions are allowed. No writes, casts, table functions, locks, executable comments or multiple statements. Other expressions fail closed. Results are bounded; busy errors are retryable.","inputSchema":{"type":"object","properties":{"connectionId":{"type":"string","minLength":1},"sql":{"type":"string","minLength":1}},"required":["connectionId","sql"],"additionalProperties":false}},
        {"name":"inspect_schema","description":"Page schemas with connectionId, tables/views with schema, or columns with schema and object. Stable name order; concurrent DDL may change pages. Results include truncated, truncationReasons, omittedEntries and nextCursor. Oversized entries are omitted with advancing continuation. Cursors are opaque, target-bound and expire on restart or cache eviction. Payloads are capped at 256,000 UTF-8 bytes.","inputSchema":{"type":"object","properties":{"connectionId":{"type":"string","minLength":1},"schema":{"type":"string","minLength":1},"object":{"type":"string","minLength":1},"limit":{"type":"integer","minimum":1,"maximum":100,"default":50},"cursor":{"type":"string"}},"required":["connectionId"],"additionalProperties":false}}
    ])
}

fn discovery(profiles: &[ConnectionProfile], policy: &PolicyStore) -> Value {
    Value::Array(
        profiles
            .iter()
            .filter(|p| policy.permits(&p.id))
            .map(|p| json!({"connectionId":p.id,"label":p.display_name}))
            .collect(),
    )
}

async fn inspect(
    profiles: &[ConnectionProfile],
    arguments: &Value,
    state: &AppState,
    policy: &PolicyStore,
) -> Result<Value, AppError> {
    let request =
        super::inspect::Request::parse(arguments).map_err(|e| AppError::Validation(e.into()))?;
    let id = arguments["connectionId"].as_str().unwrap();
    authorize(policy, id)?;
    let profile = profiles
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(unavailable)?;
    let result = async {
        let session = connections::ensure_session(profile, state).await?;
        authorize(policy, id)?;
        inspect_page(request, session, state).await
    }
    .await;
    authorize(policy, id)?;
    result.map_err(|error| {
        AppError::Connection(format!("Cannot inspect connection {id}: {error}. Check the database availability and host/port settings."))
    })
}

async fn inspect_page(
    request: super::inspect::Request,
    session: String,
    state: &AppState,
) -> Result<Value, AppError> {
    let driver = {
        let sessions = state.sessions.lock().await;
        match &sessions
            .get(&session)
            .ok_or_else(|| AppError::Connection("Session not found".into()))?
            .driver
        {
            crate::DriverSession::Postgres(pool) => crate::DriverSession::Postgres(pool.clone()),
            crate::DriverSession::Mysql(pool) => crate::DriverSession::Mysql(pool.clone()),
        }
    };
    request.execute(&driver).await
}

pub(crate) async fn call_cancellable<R: tauri::Runtime>(
    app: Option<&tauri::AppHandle<R>>,
    name: &str,
    arguments: &Value,
    mut cancelled: tokio::sync::watch::Receiver<bool>,
) -> Result<Value, &'static str> {
    tokio::select! {
        biased;
        _ = cancelled.changed() => Err("Request cancelled"),
        result = call(app, name, arguments) => result,
    }
}

pub async fn call<R: tauri::Runtime>(
    app: Option<&tauri::AppHandle<R>>,
    name: &str,
    arguments: &Value,
) -> Result<Value, &'static str> {
    let deadline = tokio::time::Instant::now() + super::QUERY_TIMEOUT;
    let valid = arguments.as_object().is_some_and(|args| match name {
        "list_connections" => args.is_empty(),
        "inspect_schema" => super::inspect::Request::parse(arguments).is_ok(),
        "execute_query" => {
            args.len() == 2
                && args
                    .get("sql")
                    .and_then(Value::as_str)
                    .is_some_and(|s| !s.is_empty())
                && args
                    .get("connectionId")
                    .and_then(Value::as_str)
                    .is_some_and(|s| !s.is_empty())
        }
        _ => false,
    });
    if !valid {
        return Err("Unknown tool or invalid arguments");
    }
    if matches!(name, "inspect_schema" | "execute_query") {
        return Ok(
            match super::database_request(deadline, async |deadline| {
                call_until(app, name, arguments, deadline)
                    .await
                    .map_err(|e| AppError::Validation(e.into()))
            })
            .await
            {
                Ok(value) => value,
                Err(error) => {
                    json!({"content":[{"type":"text","text":error.to_string()}],"structuredContent":{"error":error.to_string(),"retryable":error.to_string().starts_with("busy:")},"isError":true})
                }
            },
        );
    }
    call_until(app, name, arguments, deadline).await
}

async fn call_until<R: tauri::Runtime>(
    app: Option<&tauri::AppHandle<R>>,
    name: &str,
    arguments: &Value,
    deadline: tokio::time::Instant,
) -> Result<Value, &'static str> {
    let mut activity = None;
    let started = std::time::Instant::now();
    let result = async {
        let app = app.ok_or_else(|| AppError::Connection("Application is unavailable".into()))?;
        let policy = app.state::<PolicyStore>();
        if name != "list_connections" {
            authorize(&policy, arguments["connectionId"].as_str().unwrap())?;
        }
        let profiles = connections::load_profiles(app).await;
        if name == "execute_query" {
            let store = app.state::<super::activity::ActivityStore>();
            let id = arguments["connectionId"].as_str().unwrap();
            let label = profiles
                .as_ref()
                .ok()
                .and_then(|profiles| profiles.iter().find(|p| p.id == id))
                .map(|p| p.display_name.clone());
            activity = store
                .begin(Some(app), id, label, arguments["sql"].as_str().unwrap())
                .ok();
        }
        let profiles = profiles?;
        match name {
            "list_connections" => Ok(discovery(&profiles, &policy)),
            "execute_query" => {
                let id = arguments["connectionId"].as_str().unwrap();
                let profile = profiles
                    .iter()
                    .find(|p| p.id == id)
                    .ok_or_else(unavailable)?;
                super::validate_sql(
                    arguments["sql"].as_str().unwrap(),
                    match profile.driver {
                        connections::DbDriver::Postgres => super::SqlDialect::Postgres,
                        connections::DbDriver::Mysql => super::SqlDialect::Mysql,
                    },
                )
                .map_err(AppError::Validation)?;
                let state = app.state::<AppState>();
                authorize(&policy, id)?;
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
                authorize(&policy, id)?;
                super::query::execute_until(&driver, arguments["sql"].as_str().unwrap(), deadline)
                    .await
            }
            _ => inspect(&profiles, arguments, &app.state::<AppState>(), &policy).await,
        }
    }
    .await;
    if let (Some(app), Some(id)) = (app, activity) {
        let _ = app.state::<super::activity::ActivityStore>().finish(
            Some(app),
            &id,
            started.elapsed().as_millis() as u64,
            &result,
        );
    }
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

    fn grants(profiles: &[ConnectionProfile]) -> PolicyStore {
        let path =
            std::env::temp_dir().join(format!("esploro-tools-{}.json", uuid::Uuid::new_v4()));
        let policy = PolicyStore::open(path.clone());
        policy
            .save(super::super::policy::McpPolicy {
                enabled: true,
                permitted_connection_ids: profiles.iter().map(|p| p.id.clone()).collect(),
                ..Default::default()
            })
            .unwrap();
        std::fs::remove_file(path).unwrap();
        policy
    }

    fn profile(driver: &str) -> ConnectionProfile {
        serde_json::from_value(json!({"id":uuid::Uuid::new_v4().to_string(),"displayName":"Local database","color":null,"folder":null,"driver":driver,"host":"127.0.0.1","port":1,"socketPath":null,"database":"app","username":"secret-user","sslMode":"disable","createdAt":"","updatedAt":""})).unwrap()
    }

    #[tokio::test]
    async fn discovery_exposes_all_profiles_without_credentials_or_sessions() {
        let state = AppState::default();
        let profiles = vec![profile("postgres"), profile("mysql")];
        let result = discovery(&profiles, &grants(&profiles));
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
            let error = inspect(
                std::slice::from_ref(&profile),
                &json!({"connectionId":profile.id}),
                &state,
                &grants(std::slice::from_ref(&profile)),
            )
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
            let error = inspect(
                std::slice::from_ref(&profile),
                &json!({"connectionId":profile.id}),
                &state,
                &grants(std::slice::from_ref(&profile)),
            )
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
    async fn missing_profile_is_actionable_and_opens_no_session() {
        let state = AppState::default();
        let error = inspect(
            &[],
            &json!({"connectionId":"missing"}),
            &state,
            &grants(&[]),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("unavailable") && error.contains("list_connections"));
        assert!(state.sessions.lock().await.is_empty());
    }
}
