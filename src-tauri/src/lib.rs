mod commands;
mod error;

pub use error::AppError;

use std::collections::HashMap;
use std::sync::Arc;
use tauri::menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::Emitter;
use tauri_plugin_log::{log::LevelFilter, RotationStrategy, Target, TargetKind};
use tokio::sync::Mutex;

pub use commands::connections::ConnectionProfile;

pub enum DriverSession {
    Postgres(Arc<deadpool_postgres::Pool>),
    Mysql(Arc<mysql_async::Pool>),
}

pub struct SessionInfo {
    pub driver: DriverSession,
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

fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::new()
        .commands(tauri_specta::collect_commands![
            commands::connections::list_connections,
            commands::connections::create_connection,
            commands::connections::update_connection,
            commands::connections::delete_connection,
            commands::connections::test_connection,
            commands::connections::connect,
            commands::connections::disconnect,
            commands::data::query_table_data,
            commands::data::query_table_count,
            commands::data::update_rows,
            commands::data::preview_update_rows_sql,
            commands::data::delete_rows,
            commands::data::preview_delete_rows_sql,
            commands::data::execute_sql,
            commands::saved_queries::save_query,
            commands::saved_queries::list_saved_queries,
            commands::saved_queries::get_saved_query,
            commands::saved_queries::delete_saved_query,
            commands::schema::list_schemas,
            commands::schema::list_objects,
            commands::schema::list_columns,
            commands::roles::list_roles,
            commands::roles::list_role_members,
            commands::roles::get_role_dependents,
            commands::roles::create_role,
            commands::roles::alter_role,
            commands::roles::drop_role,
            commands::roles::manage_role_membership,
            commands::roles::list_role_privileges,
            commands::roles::manage_role_privileges,
            commands::roles::list_table_privileges,
            commands::roles::manage_table_privileges,
            commands::roles::list_schema_privileges,
            commands::roles::manage_schema_privileges,
            commands::license::get_license_status,
            commands::license::activate_license,
            commands::license::deactivate_license,
            commands::license::answer_usage_dialog,
            commands::license::dismiss_license_banner,
            commands::license::notify_connection_count,
            commands::license::open_customer_portal,
            commands::license::open_url,
            commands::license::get_ui_preferences,
            commands::license::set_ui_preferences,
            commands::updater::check_for_update,
            commands::updater::install_update,
        ])
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
        .dangerously_cast_bigints_to_number()
}

#[cfg(debug_assertions)]
fn export_typescript_bindings(builder: &tauri_specta::Builder<tauri::Wry>) {
    let export_path =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/lib/bindings.ts");

    builder
        .export(specta_typescript::Typescript::default(), export_path)
        .expect("failed to export TypeScript bindings");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta_builder = specta_builder();

    #[cfg(debug_assertions)]
    export_typescript_bindings(&specta_builder);

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(LevelFilter::Info)
                .rotation_strategy(RotationStrategy::KeepSome(3))
                .max_file_size(256_000)
                .targets([
                    Target::new(TargetKind::LogDir {
                        file_name: Some("esploro".into()),
                    }),
                    Target::new(TargetKind::Stdout),
                ])
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .setup(|app| {
            // Native macOS menu bar
            let mut app_submenu = SubmenuBuilder::new(app, "Esploro").item(&MenuItem::with_id(
                app,
                "about",
                "About Esploro",
                true,
                None::<&str>,
            )?);
            // Only the packaged Distribution build can self-update, so the item
            // is absent elsewhere rather than failing when invoked. The web side
            // mirrors this in `isSelfUpdateAvailable()` (src/features/updates/api.ts).
            if !cfg!(debug_assertions) {
                app_submenu = app_submenu.item(&MenuItem::with_id(
                    app,
                    "check-for-updates",
                    "Check for Updates…",
                    true,
                    None::<&str>,
                )?);
            }
            let app_submenu = app_submenu
                .separator()
                .item(&MenuItem::with_id(
                    app,
                    "settings",
                    "Settings…",
                    true,
                    Some("cmd+,"),
                )?)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let window_submenu = SubmenuBuilder::new(app, "Window")
                .item(&PredefinedMenuItem::minimize(app, None)?)
                .item(&PredefinedMenuItem::maximize(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::fullscreen(app, None)?)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&edit_submenu)
                .item(&window_submenu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                if event.id() == "settings" {
                    let _ = app.emit("menu:open-settings", ());
                } else if event.id() == "about" {
                    let _ = app.emit("menu:open-about", ());
                } else if event.id() == "check-for-updates" {
                    let _ = app.emit("menu:check-for-updates", ());
                }
            });

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    commands::license::revalidate_license_background(handle.clone()).await;
                    tokio::time::sleep(tokio::time::Duration::from_secs(24 * 60 * 60)).await;
                }
            });
            Ok(())
        })
        .invoke_handler(specta_builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn exports_typescript_bindings() {
        let builder = super::specta_builder();
        super::export_typescript_bindings(&builder);
    }
}
