use crate::AppError;
use serde::Serialize;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    downloaded: usize,
    total: Option<u64>,
}

#[tauri::command]
#[specta::specta]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, AppError> {
    let updater = app.updater()?;
    let update = updater.check().await?;
    Ok(update.map(|u| UpdateInfo {
        version: u.version.clone(),
        notes: u.body.clone(),
    }))
}

#[tauri::command]
#[specta::specta]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), AppError> {
    let updater = app.updater()?;
    let Some(update) = updater.check().await? else {
        return Ok(());
    };

    let handle = app.clone();
    let downloaded = Arc::new(AtomicUsize::new(0));
    let downloaded_ref = downloaded.clone();

    update
        .download_and_install(
            move |chunk_len, total| {
                let d = downloaded_ref.fetch_add(chunk_len, Ordering::Relaxed) + chunk_len;
                let _ = handle.emit(
                    "update:progress",
                    ProgressPayload {
                        downloaded: d,
                        total,
                    },
                );
            },
            || {},
        )
        .await?;

    Ok(())
}
