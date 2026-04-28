mod commands;

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub use commands::connections::ConnectionProfile;

pub struct SessionInfo {
    pub pool: Arc<deadpool_postgres::Pool>,
    pub connection_id: String,
}

pub struct AppState {
    /// session_id -> SessionInfo
    pub sessions: Mutex<HashMap<String, SessionInfo>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::connections::list_connections,
            commands::connections::create_connection,
            commands::connections::update_connection,
            commands::connections::delete_connection,
            commands::connections::test_connection,
            commands::connections::connect,
            commands::connections::disconnect,
            commands::schema::list_databases,
            commands::schema::list_schemas,
            commands::schema::list_objects,
            commands::schema::list_columns,
            commands::data::query_table,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
