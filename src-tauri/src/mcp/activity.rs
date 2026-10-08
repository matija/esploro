use crate::AppError;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Emitter, State};

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ActivityStatus {
    Running,
    Succeeded,
    Failed,
    Interrupted,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityError {
    pub kind: String,
    pub message: String,
    pub code: Option<String>,
    pub position: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub started_at: String,
    pub profile_id: String,
    pub profile_label: Option<String>,
    pub sql: String,
    pub status: ActivityStatus,
    pub duration_ms: Option<u64>,
    pub returned_row_count: Option<u64>,
    pub truncated: bool,
    pub error: Option<ActivityError>,
}

pub struct ActivityStore {
    path: PathBuf,
    entries: Mutex<Vec<Activity>>,
}

impl ActivityStore {
    pub fn open(path: PathBuf) -> Result<Self, AppError> {
        let mut entries: Vec<Activity> = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.into()),
        };
        entries.truncate(super::HISTORY_RETENTION);
        for entry in &mut entries {
            if entry.status == ActivityStatus::Running {
                entry.status = ActivityStatus::Interrupted;
                entry.error = Some(ActivityError {
                    kind: "Interrupted".into(),
                    message: "Application stopped before execution completed".into(),
                    code: None,
                    position: None,
                });
            }
        }
        let store = Self {
            path,
            entries: Mutex::new(entries),
        };
        store.update(None, |_| {})?;
        Ok(store)
    }

    pub fn history(&self) -> Vec<Activity> {
        self.entries.lock().unwrap().clone()
    }

    fn update(
        &self,
        app: Option<&tauri::AppHandle>,
        change: impl FnOnce(&mut Vec<Activity>),
    ) -> Result<(), AppError> {
        let mut entries = self.entries.lock().unwrap();
        let mut next = entries.clone();
        change(&mut next);
        next.truncate(super::HISTORY_RETENTION);
        std::fs::create_dir_all(self.path.parent().unwrap())?;
        let temporary = self.path.with_extension("json.tmp");
        let mut file = std::fs::File::create(&temporary)?;
        serde_json::to_writer(&mut file, &next)?;
        file.sync_all()?;
        std::fs::rename(temporary, &self.path)?;
        *entries = next;
        if let Some(app) = app {
            let _ = app.emit("mcp-activity-changed", &*entries);
        }
        Ok(())
    }

    pub fn begin(
        &self,
        app: Option<&tauri::AppHandle>,
        profile_id: &str,
        profile_label: Option<String>,
        sql: &str,
    ) -> Result<String, AppError> {
        let id = uuid::Uuid::new_v4().to_string();
        let entry = Activity {
            id: id.clone(),
            started_at: chrono::Utc::now().to_rfc3339(),
            profile_id: profile_id.into(),
            profile_label,
            sql: sql.into(),
            status: ActivityStatus::Running,
            duration_ms: None,
            returned_row_count: None,
            truncated: false,
            error: None,
        };
        self.update(app, |entries| entries.insert(0, entry))?;
        Ok(id)
    }

    pub fn finish(
        &self,
        app: Option<&tauri::AppHandle>,
        id: &str,
        duration_ms: u64,
        result: &Result<serde_json::Value, AppError>,
    ) -> Result<(), AppError> {
        self.update(app, |entries| {
            if let Some(entry) = entries.iter_mut().find(|entry| entry.id == id) {
                entry.duration_ms = Some(duration_ms);
                match result {
                    Ok(value) => {
                        entry.status = ActivityStatus::Succeeded;
                        entry.returned_row_count =
                            Some(value["rows"].as_array().map_or(0, |rows| rows.len()) as u64);
                        entry.truncated = value["truncated"].as_bool().unwrap_or(false);
                    }
                    Err(error) => {
                        entry.status = ActivityStatus::Failed;
                        let (code, position) = match error {
                            AppError::Sql { code, position, .. } => (code.clone(), *position),
                            _ => (None, None),
                        };
                        entry.error = Some(ActivityError {
                            kind: error.kind().into(),
                            message: error.to_string(),
                            code,
                            position,
                        });
                    }
                }
            }
        })
    }

    pub fn clear(&self, app: Option<&tauri::AppHandle>) -> Result<(), AppError> {
        self.update(app, Vec::clear)
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_mcp_history(store: State<'_, ActivityStore>) -> Vec<Activity> {
    store.history()
}

#[tauri::command]
#[specta::specta]
pub fn clear_mcp_history(
    app: tauri::AppHandle,
    store: State<'_, ActivityStore>,
) -> Result<(), AppError> {
    store.clear(Some(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completion_preserves_start_order_and_failed_writes_preserve_history() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let path = directory.join("mcp_activity.json");
        let store = ActivityStore::open(path.clone()).unwrap();
        let first = store
            .begin(None, "a", Some("A".into()), "SELECT 1")
            .unwrap();
        let second = store
            .begin(None, "b", Some("B".into()), "SELECT 2")
            .unwrap();
        let result = Ok(serde_json::json!({"rows": [], "truncated": false}));
        store.finish(None, &second, 1, &result).unwrap();
        store.finish(None, &first, 2, &result).unwrap();
        assert_eq!(store.history()[0].id, second);
        assert_eq!(store.history()[1].id, first);
        std::fs::create_dir(path.with_extension("json.tmp")).unwrap();
        assert!(store.clear(None).is_err());
        assert_eq!(store.history().len(), 2);
        assert_eq!(
            ActivityStore::open(path.clone()).err().unwrap().kind(),
            "Io"
        );
        let persisted: Vec<Activity> =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(persisted.len(), 2);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn retention_order_persistence_rejections_and_clear() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let path = directory.join("mcp_activity.json");
        let store = ActivityStore::open(path.clone()).unwrap();
        for index in 0..25 {
            store
                .begin(
                    None,
                    "profile",
                    Some("Label".into()),
                    &format!("SELECT {index}"),
                )
                .unwrap();
        }
        let entries = store.history();
        assert_eq!(entries.len(), 20);
        assert_eq!(entries[0].sql, "SELECT 24");
        assert_eq!(entries[19].sql, "SELECT 5");
        let id = store
            .begin(None, "profile", Some("Label".into()), "DELETE FROM users")
            .unwrap();
        let result =
            super::super::validate_sql("DELETE FROM users", super::super::SqlDialect::Postgres)
                .map(|_| serde_json::json!({}))
                .map_err(AppError::Validation);
        store.finish(None, &id, 7, &result).unwrap();
        let reopened = ActivityStore::open(path.clone()).unwrap();
        assert_eq!(reopened.history()[0].status, ActivityStatus::Failed);
        assert_eq!(reopened.history()[0].sql, "DELETE FROM users");
        assert!(reopened.history()[0].error.is_some());
        assert_eq!(reopened.history()[1].status, ActivityStatus::Interrupted);
        let id = reopened.begin(None, "profile", None, "SELECT 1").unwrap();
        reopened
            .finish(
                None,
                &id,
                3,
                &Ok(serde_json::json!({"rows":[["private result"]],"truncated":true})),
            )
            .unwrap();
        assert_eq!(reopened.history()[0].returned_row_count, Some(1));
        assert!(reopened.history()[0].truncated);
        assert!(!std::fs::read_to_string(&path)
            .unwrap()
            .contains("private result"));
        reopened.clear(None).unwrap();
        reopened.finish(None, &id, 4, &result).unwrap();
        assert!(ActivityStore::open(path).unwrap().history().is_empty());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
