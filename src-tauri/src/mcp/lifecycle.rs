use super::{McpListener, ENDPOINT};
use serde::Serialize;
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
}

struct Inner<L> {
    status: McpStatus,
    token: Option<String>,
    listener: Option<L>,
}

impl<L> Default for McpLifecycle<L> {
    fn default() -> Self {
        Self {
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

    async fn stop(&self) -> Option<L> {
        let mut inner = self.inner.lock().await;
        inner.status = McpStatus::Stopped;
        inner.token = None;
        inner.listener.take()
    }
}

impl McpLifecycle {
    pub async fn start(&self, app: tauri::AppHandle) {
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

    pub async fn shutdown(&self) {
        if let Some(listener) = self.stop().await {
            if let Err(error) = listener.shutdown().await {
                tauri_plugin_log::log::warn!("MCP shutdown: {error}");
            }
        }
    }
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
