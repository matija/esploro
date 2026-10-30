use crate::AppError;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpPolicy {
    pub version: u32,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub permitted_connection_ids: Vec<String>,
}

impl Default for McpPolicy {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: false,
            permitted_connection_ids: Vec::new(),
        }
    }
}

impl McpPolicy {
    fn validate(&self) -> Result<(), AppError> {
        if self.version != 1 || self.permitted_connection_ids.iter().any(|id| id.is_empty()) {
            return Err(AppError::Validation("Invalid MCP policy".into()));
        }
        Ok(())
    }
}

pub struct PolicyStore {
    path: PathBuf,
    policy: Mutex<McpPolicy>,
}

impl PolicyStore {
    pub fn open(path: PathBuf) -> Self {
        let load = || -> Result<McpPolicy, AppError> {
            let policy: McpPolicy = serde_json::from_slice(&std::fs::read(&path)?)?;
            policy.validate()?;
            Ok(policy)
        };
        Self {
            policy: Mutex::new(load().unwrap_or_default()),
            path,
        }
    }

    pub fn get(&self) -> McpPolicy {
        self.policy.lock().unwrap().clone()
    }

    pub fn permits(&self, connection_id: &str) -> bool {
        let policy = self.policy.lock().unwrap();
        policy.enabled
            && policy
                .permitted_connection_ids
                .iter()
                .any(|id| id == connection_id)
    }

    pub fn save(&self, next: McpPolicy) -> Result<(), AppError> {
        let mut policy = self.policy.lock().unwrap();
        *policy = McpPolicy::default();
        next.validate()?;
        let parent = self.path.parent().unwrap();
        std::fs::create_dir_all(parent)?;
        let temporary = parent.join(format!(".mcp-policy-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| -> Result<(), AppError> {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            serde_json::to_writer(&mut file, &next)?;
            file.sync_all()?;
            std::fs::rename(&temporary, &self.path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result?;
        *policy = next;
        Ok(())
    }
}
