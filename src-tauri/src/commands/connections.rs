use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use deadpool_postgres::{Config as PoolConfig, Runtime};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio_postgres::NoTls;
use uuid::Uuid;

use crate::{AppState, DriverSession, SessionInfo};

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DbDriver {
    #[default]
    Postgres,
    Mysql,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SslMode {
    Disable,
    #[default]
    Prefer,
    Require,
    VerifyFull,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub display_name: String,
    pub color: Option<String>,
    pub folder: Option<String>,
    #[serde(default)]
    pub driver: DbDriver,
    /// TCP hostname/IP; None when using socket_path
    pub host: Option<String>,
    pub port: u16,
    /// Unix socket directory path (e.g. /var/run/postgresql)
    pub socket_path: Option<String>,
    pub database: String,
    pub username: String,
    pub ssl_mode: SslMode,
    #[serde(default)]
    pub pool_max_connections: u32,
    pub created_at: String,
    pub updated_at: String,
}

/// What the frontend sends for create/update/test (no timestamps, no id)
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub display_name: String,
    pub color: Option<String>,
    pub folder: Option<String>,
    #[serde(default)]
    pub driver: DbDriver,
    pub host: Option<String>,
    pub port: u16,
    pub socket_path: Option<String>,
    pub database: String,
    pub username: String,
    pub ssl_mode: SslMode,
    #[serde(default)]
    pub pool_max_connections: u32,
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

fn error_chain(e: impl std::error::Error) -> String {
    let mut s = e.to_string();
    let mut src = e.source();
    while let Some(err) = src {
        s.push_str(": ");
        s.push_str(&err.to_string());
        src = err.source();
    }
    s
}

// ---------------------------------------------------------------------------
// Keychain helpers
// ---------------------------------------------------------------------------

fn keychain_entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("esploro", &format!("connection:{id}")).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// File-storage helpers
// ---------------------------------------------------------------------------

fn connections_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("connections.json"))
}

async fn load_profiles(app: &AppHandle) -> Result<Vec<ConnectionProfile>, String> {
    let path = connections_path(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let data = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

async fn save_profiles(app: &AppHandle, profiles: &[ConnectionProfile]) -> Result<(), String> {
    let path = connections_path(app)?;
    let data = serde_json::to_string_pretty(profiles).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, data)
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Pool builders
// ---------------------------------------------------------------------------

fn build_pg_pool(
    profile: &ConnectionProfile,
    password: &str,
) -> Result<deadpool_postgres::Pool, String> {
    let mut cfg = PoolConfig::new();

    // Unix socket path takes priority; tokio-postgres recognises a host
    // starting with '/' as a socket directory.
    if let Some(socket) = &profile.socket_path {
        cfg.host = Some(socket.clone());
    } else {
        cfg.host = Some(profile.host.clone().unwrap_or_else(|| "localhost".into()));
    }
    cfg.port = Some(profile.port);
    cfg.dbname = Some(profile.database.clone());
    cfg.user = Some(profile.username.clone());
    cfg.password = Some(password.to_string());

    let max = pool_max_size(profile.pool_max_connections);
    cfg.pool = Some(deadpool_postgres::PoolConfig {
        max_size: max,
        ..Default::default()
    });

    cfg.create_pool(Some(Runtime::Tokio1), NoTls)
        .map_err(|e| e.to_string())
}

fn pool_max_size(configured: u32) -> usize {
    const DEFAULT: usize = 5;
    const HARD_CAP: usize = 10;
    if configured == 0 {
        DEFAULT
    } else {
        (configured as usize).min(HARD_CAP)
    }
}

fn build_mysql_pool(
    profile: &ConnectionProfile,
    password: &str,
) -> Result<mysql_async::Pool, String> {
    let host = profile.host.as_deref().unwrap_or("localhost");
    let max = pool_max_size(profile.pool_max_connections);
    let constraints = mysql_async::PoolConstraints::new(1, max)
        .unwrap_or_else(|| mysql_async::PoolConstraints::new(1, 5).unwrap());
    let pool_opts = mysql_async::PoolOpts::default().with_constraints(constraints);
    let opts = mysql_async::OptsBuilder::default()
        .ip_or_hostname(host)
        .tcp_port(profile.port)
        .db_name(Some(profile.database.clone()))
        .user(Some(profile.username.clone()))
        .pass(Some(password.to_string()))
        .pool_opts(pool_opts);
    Ok(mysql_async::Pool::new(opts))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_connections(app: AppHandle) -> Result<Vec<ConnectionProfile>, String> {
    load_profiles(&app).await
}

#[tauri::command]
pub async fn create_connection(
    app: AppHandle,
    input: ConnectionInput,
    password: String,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Store password in Keychain before writing the profile
    keychain_entry(&id)?
        .set_password(&password)
        .map_err(|e| e.to_string())?;

    let profile = ConnectionProfile {
        id: id.clone(),
        display_name: input.display_name,
        color: input.color,
        folder: input.folder,
        driver: input.driver,
        host: input.host,
        port: input.port,
        socket_path: input.socket_path,
        database: input.database,
        username: input.username,
        ssl_mode: input.ssl_mode,
        pool_max_connections: input.pool_max_connections,
        created_at: now.clone(),
        updated_at: now,
    };

    let mut profiles = load_profiles(&app).await?;
    profiles.push(profile);
    save_profiles(&app, &profiles).await?;

    Ok(id)
}

#[tauri::command]
pub async fn update_connection(
    app: AppHandle,
    id: String,
    input: ConnectionInput,
    password: Option<String>,
) -> Result<(), String> {
    let mut profiles = load_profiles(&app).await?;
    let profile = profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Connection {id} not found"))?;

    profile.display_name = input.display_name;
    profile.color = input.color;
    profile.folder = input.folder;
    profile.driver = input.driver;
    profile.host = input.host;
    profile.port = input.port;
    profile.socket_path = input.socket_path;
    profile.database = input.database;
    profile.username = input.username;
    profile.ssl_mode = input.ssl_mode;
    profile.pool_max_connections = input.pool_max_connections;
    profile.updated_at = chrono::Utc::now().to_rfc3339();

    if let Some(pwd) = password {
        keychain_entry(&id)?
            .set_password(&pwd)
            .map_err(|e| e.to_string())?;
    }

    save_profiles(&app, &profiles).await
}

#[tauri::command]
pub async fn delete_connection(
    app: AppHandle,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Remove from storage
    let mut profiles = load_profiles(&app).await?;
    profiles.retain(|p| p.id != id);
    save_profiles(&app, &profiles).await?;

    // Remove Keychain entry (best-effort; entry might not exist)
    let _ = keychain_entry(&id).and_then(|e| e.delete_password().map_err(|x| x.to_string()));

    // Close any active sessions for this connection
    let mut sessions = state.sessions.lock().await;
    sessions.retain(|_, info| info.connection_id != id);

    Ok(())
}

#[tauri::command]
pub async fn test_connection(input: ConnectionInput, password: String) -> Result<u64, String> {
    let profile = ConnectionProfile {
        id: String::new(),
        display_name: String::new(),
        color: None,
        folder: None,
        driver: input.driver,
        host: input.host,
        port: input.port,
        socket_path: input.socket_path,
        database: input.database,
        username: input.username,
        ssl_mode: input.ssl_mode,
        pool_max_connections: input.pool_max_connections,
        created_at: String::new(),
        updated_at: String::new(),
    };

    let start = Instant::now();
    match profile.driver {
        DbDriver::Postgres => {
            let pool = build_pg_pool(&profile, &password)?;
            let client = pool.get().await.map_err(error_chain)?;
            client.execute("SELECT 1", &[]).await.map_err(error_chain)?;
        }
        DbDriver::Mysql => {
            use mysql_async::prelude::Queryable;
            let pool = build_mysql_pool(&profile, &password)?;
            let mut conn = pool.get_conn().await.map_err(error_chain)?;
            conn.query_drop("SELECT 1").await.map_err(error_chain)?;
        }
    }
    Ok(start.elapsed().as_millis() as u64)
}

#[tauri::command]
pub async fn connect(
    app: AppHandle,
    id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let profiles = load_profiles(&app).await?;
    let profile = profiles
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Connection {id} not found"))?;

    let password = keychain_entry(&id)?
        .get_password()
        .map_err(|e| e.to_string())?;

    let session_id = Uuid::new_v4().to_string();

    match profile.driver {
        DbDriver::Postgres => {
            let pool = build_pg_pool(profile, &password)?;
            let client = pool.get().await.map_err(error_chain)?;
            client.execute("SELECT 1", &[]).await.map_err(error_chain)?;
            drop(client);
            state.sessions.lock().await.insert(
                session_id.clone(),
                SessionInfo {
                    driver: DriverSession::Postgres(Arc::new(pool)),
                    connection_id: id,
                },
            );
        }
        DbDriver::Mysql => {
            use mysql_async::prelude::Queryable;
            let pool = build_mysql_pool(profile, &password)?;
            let mut conn = pool.get_conn().await.map_err(error_chain)?;
            conn.query_drop("SELECT 1").await.map_err(error_chain)?;
            drop(conn);
            state.sessions.lock().await.insert(
                session_id.clone(),
                SessionInfo {
                    driver: DriverSession::Mysql(Arc::new(pool)),
                    connection_id: id,
                },
            );
        }
    }

    Ok(session_id)
}

#[tauri::command]
pub async fn disconnect(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.sessions.lock().await.remove(&session_id);
    Ok(())
}
