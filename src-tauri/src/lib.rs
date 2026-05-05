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
    /// Session-only banner dismiss flag (not persisted to disk)
    pub banner_dismissed: Mutex<bool>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            banner_dismissed: Mutex::new(false),
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
            commands::data::execute_sql,
            commands::saved_queries::save_query,
            commands::saved_queries::list_saved_queries,
            commands::saved_queries::get_saved_query,
            commands::saved_queries::delete_saved_query,
            commands::license::get_license_status,
            commands::license::activate_license,
            commands::license::deactivate_license,
            commands::license::answer_usage_dialog,
            commands::license::dismiss_license_banner,
            commands::license::notify_connection_count,
            commands::license::open_checkout_url,
            commands::license::open_customer_portal,
            commands::license::get_ui_preferences,
            commands::license::set_ui_preferences,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
