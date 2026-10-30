use super::{McpListener, ENDPOINT};
use serde::Serialize;
use tauri::Manager;
use tokio::sync::Mutex;

#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum McpStatus {
    Starting,
    Running,
    Error { message: String },
    Stopped,
}

pub struct McpLifecycle<L = McpListener> {
    inner: Mutex<Inner<L>>,
    transition: Mutex<()>,
}

struct Inner<L> {
    status: McpStatus,
    token: Option<String>,
    listener: Option<L>,
}

impl<L> Default for McpLifecycle<L> {
    fn default() -> Self {
        Self {
            transition: Mutex::new(()),
            inner: Mutex::new(Inner {
                status: McpStatus::Starting,
                token: None,
                listener: None,
            }),
        }
    }
}

impl<L> McpLifecycle<L> {
    async fn start_with<F, Fut>(&self, token: Result<String, String>, bind: F)
    where
        F: FnOnce(String) -> Fut,
        Fut: std::future::Future<Output = Result<L, String>>,
    {
        let mut inner = self.inner.lock().await;
        if inner.status != McpStatus::Starting {
            return;
        }
        match token {
            Ok(token) => {
                inner.token = Some(token.clone());
                match bind(token).await {
                    Ok(listener) => {
                        inner.listener = Some(listener);
                        inner.status = McpStatus::Running;
                    }
                    Err(message) => inner.status = McpStatus::Error { message },
                }
            }
            Err(message) => inner.status = McpStatus::Error { message },
        }
    }

    async fn prepare(&self, enabled: bool) -> bool {
        let mut inner = self.inner.lock().await;
        if !enabled {
            inner.status = McpStatus::Stopped;
            return false;
        }
        if inner.listener.is_some() {
            return false;
        }
        inner.status = McpStatus::Starting;
        true
    }

    async fn stop(&self) -> Option<L> {
        let mut inner = self.inner.lock().await;
        inner.status = McpStatus::Stopped;
        inner.token = None;
        inner.listener.take()
    }
}

impl McpLifecycle {
    pub async fn start(&self, app: tauri::AppHandle) {
        let _transition = self.transition.lock().await;
        self.start_enabled(app).await;
    }

    async fn start_enabled(&self, app: tauri::AppHandle) {
        if !self
            .prepare(app.state::<super::policy::PolicyStore>().get().enabled)
            .await
        {
            return;
        }
        let token = tauri::async_runtime::spawn_blocking(super::token::load_or_create)
            .await
            .map_err(|_| "MCP token task failed".to_string())
            .and_then(|result| {
                result.map_err(|_| "Cannot access MCP token in Keychain".to_string())
            });
        self.start_with(token, |token| async {
            McpListener::bind(token, app)
                .await
                .map_err(|error| error.to_string())
        })
        .await;
    }

    async fn replace_with<F, Fut>(&self, persist: F) -> Result<String, String>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<String, String>>,
    {
        self.stop_listener().await;
        match persist().await {
            Ok(token) => Ok(token),
            Err(message) => {
                self.inner.lock().await.status = McpStatus::Error {
                    message: message.clone(),
                };
                Err(message)
            }
        }
    }

    pub async fn shutdown(&self) {
        let _transition = self.transition.lock().await;
        self.stop_listener().await;
    }

    async fn stop_listener(&self) {
        if let Some(listener) = self.stop().await {
            if let Err(error) = listener.shutdown().await {
                tauri_plugin_log::log::warn!("MCP shutdown: {error}");
            }
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_mcp_policy(
    policy: tauri::State<'_, super::policy::PolicyStore>,
) -> super::policy::McpPolicy {
    policy.get()
}

#[tauri::command]
#[specta::specta]
pub async fn set_mcp_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpLifecycle>,
    enabled: bool,
) -> Result<(), String> {
    let _transition = state.transition.lock().await;
    state.stop_listener().await;
    let store = app.state::<super::policy::PolicyStore>();
    let mut policy = store.get();
    policy.enabled = enabled;
    store.save(policy).map_err(|error| error.to_string())?;
    state.start_enabled(app.clone()).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_mcp_grants(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpLifecycle>,
    permitted_connection_ids: Vec<String>,
) -> Result<(), String> {
    let _transition = state.transition.lock().await;
    state.stop_listener().await;
    let store = app.state::<super::policy::PolicyStore>();
    let mut policy = store.get();
    policy.permitted_connection_ids = permitted_connection_ids;
    store.save(policy).map_err(|error| error.to_string())?;
    state.start_enabled(app.clone()).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn replace_mcp_token(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpLifecycle>,
) -> Result<(), String> {
    let _transition = state.transition.lock().await;
    let token = state
        .replace_with(|| async {
            tauri::async_runtime::spawn_blocking(super::token::replace)
                .await
                .map_err(|_| "MCP token replacement task failed".to_string())?
                .map_err(|_| "Cannot replace MCP token in Keychain; MCP is stopped".to_string())
        })
        .await?;
    if state
        .prepare(app.state::<super::policy::PolicyStore>().get().enabled)
        .await
    {
        state
            .start_with(Ok(token), |token| async {
                McpListener::bind(token, app)
                    .await
                    .map_err(|error| error.to_string())
            })
            .await;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn retry_mcp(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpLifecycle>,
) -> Result<(), String> {
    state.start(app).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_mcp_status(state: tauri::State<'_, McpLifecycle>) -> Result<McpStatus, String> {
    Ok(state.inner.lock().await.status.clone())
}

#[tauri::command]
#[specta::specta]
pub fn get_mcp_endpoint() -> String {
    ENDPOINT.into()
}

#[tauri::command]
#[specta::specta]
pub async fn get_mcp_token(state: tauri::State<'_, McpLifecycle>) -> Result<String, String> {
    state
        .inner
        .lock()
        .await
        .token
        .clone()
        .ok_or_else(|| "MCP token is unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn repeated_transitions_conflict_retry_and_restart() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let path = directory.join("policy.json");
        let store = super::super::policy::PolicyStore::open(path.clone());
        let state = McpLifecycle::default();
        assert!(!state.prepare(store.get().enabled).await);
        let mut policy = store.get();
        policy.enabled = true;
        policy.permitted_connection_ids = vec!["saved".into()];
        store.save(policy.clone()).unwrap();
        let address = "127.0.0.1:19482".parse().unwrap();
        let conflict = tokio::net::TcpListener::bind(address).await.unwrap();
        assert!(state.prepare(store.get().enabled).await);
        state
            .start_with(Ok("secret".into()), |token| async {
                McpListener::bind_at::<tauri::Wry>(address, token, None)
                    .await
                    .map_err(|error| error.to_string())
            })
            .await;
        assert!(matches!(
            state.inner.lock().await.status,
            McpStatus::Error { .. }
        ));
        drop(conflict);
        for _ in 0..3 {
            let restarted = super::super::policy::PolicyStore::open(path.clone());
            assert_eq!(restarted.get(), policy);
            assert!(state.prepare(restarted.get().enabled).await);
            state
                .start_with(Ok("secret".into()), |token| async {
                    McpListener::bind_at::<tauri::Wry>(address, token, None)
                        .await
                        .map_err(|error| error.to_string())
                })
                .await;
            assert_eq!(state.inner.lock().await.status, McpStatus::Running);
            assert!(!state.prepare(true).await);
            state.stop().await.unwrap().shutdown().await.unwrap();
            assert!(state.stop().await.is_none());
            let released = tokio::net::TcpListener::bind(address).await.unwrap();
            drop(released);
        }
        policy.enabled = false;
        store.save(policy.clone()).unwrap();
        let restarted = super::super::policy::PolicyStore::open(path);
        assert_eq!(restarted.get(), policy);
        assert!(!state.prepare(restarted.get().enabled).await);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn replacement_stops_listener_before_persistence_and_stays_stopped_on_failure() {
        let state = McpLifecycle::default();
        let address = "127.0.0.1:0".parse().unwrap();
        state
            .start_with(Ok("old".into()), |token| async {
                McpListener::bind_at::<tauri::Wry>(address, token, None)
                    .await
                    .map_err(|error| error.to_string())
            })
            .await;
        let token = state
            .replace_with(|| async {
                assert!(state.inner.lock().await.listener.is_none());
                Ok("new".into())
            })
            .await
            .unwrap();
        assert_eq!(token, "new");
        assert_eq!(state.inner.lock().await.status, McpStatus::Stopped);
        assert!(state.prepare(true).await);
        state
            .start_with(Ok(token), |token| async {
                McpListener::bind_at::<tauri::Wry>(address, token, None)
                    .await
                    .map_err(|error| error.to_string())
            })
            .await;
        assert_eq!(state.inner.lock().await.status, McpStatus::Running);
        assert!(state
            .replace_with(|| async {
                assert!(state.inner.lock().await.listener.is_none());
                Err("Keychain write failed".into())
            })
            .await
            .is_err());
        let inner = state.inner.lock().await;
        assert!(inner.listener.is_none());
        assert!(inner.token.is_none());
        assert!(matches!(inner.status, McpStatus::Error { .. }));
    }

    #[tokio::test]
    async fn success_and_exit() {
        let state = McpLifecycle::default();
        state
            .start_with(Ok("secret".into()), |_| async { Ok(42) })
            .await;
        let inner = state.inner.lock().await;
        assert_eq!(inner.status, McpStatus::Running);
        assert_eq!(inner.token.as_deref(), Some("secret"));
        assert!(!serde_json::to_string(&inner.status)
            .unwrap()
            .contains("secret"));
        drop(inner);
        assert_eq!(state.stop().await, Some(42));
        assert_eq!(state.stop().await, None);
        assert!(state.inner.lock().await.token.is_none());
    }

    #[tokio::test]
    async fn token_and_bind_errors() {
        for token_error in [true, false] {
            let state = McpLifecycle::<()>::default();
            let token = if token_error {
                Err("Keychain unavailable".into())
            } else {
                Ok("secret".into())
            };
            state
                .start_with(token, |_| async {
                    assert!(!token_error);
                    Err("Port occupied".into())
                })
                .await;
            assert!(matches!(
                state.inner.lock().await.status,
                McpStatus::Error { .. }
            ));
            assert_eq!(state.stop().await, None);
        }
    }

    #[tokio::test]
    async fn exit_before_token_load_finishes_prevents_bind() {
        let state = McpLifecycle::<()>::default();
        state.stop().await;
        state
            .start_with(Ok("secret".into()), |_| async { panic!("must not bind") })
            .await;
        assert_eq!(state.inner.lock().await.status, McpStatus::Stopped);
    }

    #[tokio::test]
    async fn exit_during_bind_takes_started_listener() {
        let state = McpLifecycle::default();
        let (started, ready) = tokio::sync::oneshot::channel();
        let start = state.start_with(Ok("secret".into()), |_| async {
            started.send(()).unwrap();
            tokio::task::yield_now().await;
            Ok(42)
        });
        let stop = async {
            ready.await.unwrap();
            assert_eq!(state.stop().await, Some(42));
        };
        tokio::join!(start, stop);
        assert_eq!(state.inner.lock().await.status, McpStatus::Stopped);
    }
}
