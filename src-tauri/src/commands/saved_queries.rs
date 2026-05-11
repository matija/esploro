use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    pub folder: Option<String>,
    pub sql: String,
    pub created_at: String,
    pub updated_at: String,
}

fn queries_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap()
        .join("saved_queries.json")
}

async fn load(app: &AppHandle) -> Vec<SavedQuery> {
    let path = queries_path(app);
    let data = tokio::fs::read_to_string(&path).await.unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

async fn persist(app: &AppHandle, queries: &[SavedQuery]) -> Result<(), String> {
    let path = queries_path(app);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(queries).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, data)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn save_query(
    app: AppHandle,
    id: Option<String>,
    name: String,
    folder: Option<String>,
    sql: String,
) -> Result<String, String> {
    let mut queries = load(&app).await;
    let now = Utc::now().to_rfc3339();

    if let Some(existing_id) = id {
        if let Some(q) = queries.iter_mut().find(|q| q.id == existing_id) {
            q.name = name;
            q.folder = folder;
            q.sql = sql;
            q.updated_at = now;
            let ret_id = q.id.clone();
            persist(&app, &queries).await?;
            return Ok(ret_id);
        }
    }

    let new_id = Uuid::new_v4().to_string();
    queries.push(SavedQuery {
        id: new_id.clone(),
        name,
        folder,
        sql,
        created_at: now.clone(),
        updated_at: now,
    });
    persist(&app, &queries).await?;
    Ok(new_id)
}

#[tauri::command]
pub async fn list_saved_queries(app: AppHandle) -> Result<Vec<SavedQuery>, String> {
    Ok(load(&app).await)
}

#[tauri::command]
pub async fn get_saved_query(app: AppHandle, id: String) -> Result<SavedQuery, String> {
    load(&app)
        .await
        .into_iter()
        .find(|q| q.id == id)
        .ok_or_else(|| format!("Query not found: {id}"))
}

#[tauri::command]
pub async fn delete_saved_query(app: AppHandle, id: String) -> Result<(), String> {
    let mut queries = load(&app).await;
    let before = queries.len();
    queries.retain(|q| q.id != id);
    if queries.len() == before {
        return Err(format!("Query not found: {id}"));
    }
    persist(&app, &queries).await?;
    Ok(())
}
