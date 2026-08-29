//! Shared setup for the `integration-db` suite: env-var lookup, pool
//! construction from a bare connection URL, and a mock-runtime `AppState`
//! wired up with one live session so command functions can be called
//! directly.

use std::sync::Arc;

use esploro_lib::{AppState, DriverSession, SessionInfo};
use tauri::Manager;

/// Reads an env var; returns `None` (letting the caller skip) when unset or
/// empty, so the suite never fails just because a database isn't provisioned.
pub fn env_url(var: &str) -> Option<String> {
    match std::env::var(var) {
        Ok(v) if !v.trim().is_empty() => Some(v),
        _ => None,
    }
}

/// Skips the current test with a message on stdout when `url` is `None`.
/// Used as: `let Some(url) = common::env_url("...") else { return common::skip("...") };`
pub fn skip(reason: &str) {
    println!("skipping: {reason}");
}

/// Best-effort extraction of the trailing path segment (the database name)
/// from a `postgres://` or `mysql://` connection URL.
pub fn db_name_from_url(url: &str) -> String {
    let without_query = url.split('?').next().unwrap_or(url);
    without_query
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_string()
}

pub fn pg_pool(url: &str) -> deadpool_postgres::Pool {
    let mut cfg = deadpool_postgres::Config::new();
    cfg.url = Some(url.to_string());
    cfg.manager = Some(deadpool_postgres::ManagerConfig {
        recycling_method: deadpool_postgres::RecyclingMethod::Verified,
    });
    cfg.create_pool(
        Some(deadpool_postgres::Runtime::Tokio1),
        tokio_postgres::NoTls,
    )
    .expect("failed to build Postgres pool from ESPLORO_TEST_POSTGRES_URL")
}

pub fn mysql_pool(url: &str) -> mysql_async::Pool {
    mysql_async::Pool::new(url)
}

/// A mock-runtime Tauri app with `AppState` managed and one session pointed
/// at `driver`. Command functions can be invoked directly via
/// `app.state::<AppState>()`, exactly as the real IPC handler would receive
/// them, without needing a running window or the keychain-backed `connect`
/// command.
pub struct TestApp {
    pub app: tauri::App<tauri::test::MockRuntime>,
    pub session_id: String,
}

impl TestApp {
    pub fn state(&self) -> tauri::State<'_, AppState> {
        self.app.state::<AppState>()
    }
}

pub async fn setup(driver: DriverSession) -> TestApp {
    let state = AppState::default();
    let session_id = uuid::Uuid::new_v4().to_string();
    state.sessions.lock().await.insert(
        session_id.clone(),
        SessionInfo {
            driver,
            connection_id: "integration-test".into(),
        },
    );

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("failed to build mock Tauri app");

    TestApp { app, session_id }
}

pub async fn setup_pg(url: &str) -> TestApp {
    setup(DriverSession::Postgres(Arc::new(pg_pool(url)))).await
}

pub async fn setup_mysql(url: &str) -> TestApp {
    setup(DriverSession::Mysql(Arc::new(mysql_pool(url)))).await
}

/// Unique-enough table name so concurrent CI runs against the same database
/// don't collide.
pub fn unique_table_name(prefix: &str) -> String {
    format!("{prefix}_{}", uuid::Uuid::new_v4().simple())
}
