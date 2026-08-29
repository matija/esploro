//! Structured application error returned by every Tauri command.
//!
//! Commands return `Result<T, AppError>`. `AppError` serializes as an
//! internally-tagged object — `{ "kind": "...", "message": "...", "code": ...,
//! "position": ... }` — so the frontend can branch on `kind` instead of
//! string-matching error text (see `src/lib/ipc.ts`).
//!
//! Connection-error classification lives in [`AppError::is_retryable`], which
//! replaces the old `is_pg_connection_err` string-grep.

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[allow(dead_code)]
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct AppErrorWire {
    kind: String,
    message: String,
    code: Option<String>,
    position: Option<u32>,
}

#[derive(Debug, thiserror::Error, specta::Type)]
#[specta(type = AppErrorWire)]
pub enum AppError {
    #[error("Session not found")]
    SessionNotFound,
    #[error("{0}")]
    Connection(String),
    #[error("{message}")]
    Sql {
        code: Option<String>,
        position: Option<u32>,
        message: String,
    },
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    License(String),
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    /// Stable discriminant used as the serialized `kind` field. The frontend
    /// branches on these exact strings.
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::SessionNotFound => "SessionNotFound",
            AppError::Connection(_) => "Connection",
            AppError::Sql { .. } => "Sql",
            AppError::Validation(_) => "Validation",
            AppError::License(_) => "License",
            AppError::Io(_) => "Io",
            AppError::Internal(_) => "Internal",
        }
    }

    /// True for errors that indicate a dropped/recyclable connection, so the
    /// caller may retry once on a fresh pooled connection. Mirrors the old
    /// `is_pg_connection_err` SQLSTATE/substring grep, now driven by the typed
    /// classification done in the `From` impls.
    ///
    /// SQLSTATE: 57P01=admin_shutdown, 57P02=crash_shutdown, 08006=connection_failure.
    pub fn is_retryable(&self) -> bool {
        match self {
            AppError::Connection(_) => true,
            AppError::Sql {
                code: Some(code), ..
            } => {
                matches!(code.as_str(), "57P01" | "57P02" | "08006")
            }
            _ => false,
        }
    }

    /// Prepend developer context to the message while preserving `kind` (and
    /// any SQL `code`/`position`). Used at query sites that want the failing
    /// SQL/params in the message without losing retry classification.
    pub fn context(self, ctx: impl std::fmt::Display) -> Self {
        match self {
            AppError::Sql {
                code,
                position,
                message,
            } => AppError::Sql {
                code,
                position,
                message: format!("{ctx}  {message}"),
            },
            AppError::Connection(m) => AppError::Connection(format!("{ctx}  {m}")),
            AppError::Validation(m) => AppError::Validation(format!("{ctx}  {m}")),
            AppError::License(m) => AppError::License(format!("{ctx}  {m}")),
            AppError::Io(m) => AppError::Io(format!("{ctx}  {m}")),
            AppError::Internal(m) => AppError::Internal(format!("{ctx}  {m}")),
            AppError::SessionNotFound => AppError::SessionNotFound,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let (code, position) = match self {
            AppError::Sql { code, position, .. } => (code.clone(), *position),
            _ => (None, None),
        };
        let mut st = serializer.serialize_struct("AppError", 4)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.serialize_field("code", &code)?;
        st.serialize_field("position", &position)?;
        st.end()
    }
}

// ── Conversions ──────────────────────────────────────────────────────────────
//
// `From<String>`/`From<&str>` bucket ad-hoc string errors (validation messages,
// SQL builders, file/keychain helpers that still produce strings) into
// `Internal`, so existing `?`/`.map_err(AppError::from)` sites convert cleanly.
// The DB-error impls produce the typed `Sql`/`Connection` variants that
// `is_retryable` depends on.

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Internal(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Internal(s.to_string())
    }
}

impl From<tokio_postgres::Error> for AppError {
    fn from(e: tokio_postgres::Error) -> Self {
        if let Some(db) = e.as_db_error() {
            let position = match db.position() {
                Some(tokio_postgres::error::ErrorPosition::Original(p)) => Some(*p),
                _ => None,
            };
            AppError::Sql {
                code: Some(db.code().code().to_string()),
                position,
                message: e.to_string(),
            }
        } else {
            // No server SQLSTATE → connection/protocol/IO-level failure
            // (broken pipe, connection closed/reset, unexpected EOF, …).
            // `to_string()` drops the source, so keep the cause too.
            let mut msg = e.to_string();
            if let Some(src) = std::error::Error::source(&e) {
                msg = format!("{msg}: {src}");
            }
            AppError::Connection(crate::db::humanize_connection_error(msg))
        }
    }
}

impl From<deadpool_postgres::PoolError> for AppError {
    fn from(e: deadpool_postgres::PoolError) -> Self {
        use deadpool_postgres::PoolError;
        match e {
            PoolError::Backend(e) => AppError::from(e),
            // Deadpool's own timeout text ("Timeout occurred while creating a
            // new object") tells the user nothing; explain what to check.
            // `deadpool::managed::TimeoutType` is not re-exported by
            // deadpool-postgres, so discriminate on its Debug name.
            PoolError::Timeout(t) if format!("{t:?}") == "Wait" => AppError::Connection(format!(
                "All connections to this database are busy (waited {}s). Try again in a moment.",
                crate::db::POOL_WAIT_TIMEOUT.as_secs()
            )),
            PoolError::Timeout(_) => AppError::Connection(crate::db::unreachable_message(
                crate::db::CONNECT_TIMEOUT.as_secs(),
            )),
            other => AppError::Connection(crate::db::humanize_connection_error(other.to_string())),
        }
    }
}

impl From<mysql_async::Error> for AppError {
    fn from(e: mysql_async::Error) -> Self {
        if let mysql_async::Error::Server(ref se) = e {
            AppError::Sql {
                code: Some(se.code.to_string()),
                position: None,
                message: e.to_string(),
            }
        } else {
            AppError::Connection(crate::db::humanize_connection_error(e.to_string()))
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl From<deadpool_postgres::CreatePoolError> for AppError {
    fn from(e: deadpool_postgres::CreatePoolError) -> Self {
        AppError::Connection(e.to_string())
    }
}

impl From<tauri_plugin_updater::Error> for AppError {
    fn from(e: tauri_plugin_updater::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_kind_and_message() {
        let json = serde_json::to_value(AppError::SessionNotFound).unwrap();
        assert_eq!(json["kind"], "SessionNotFound");
        assert_eq!(json["message"], "Session not found");
        assert!(json["code"].is_null());
    }

    #[test]
    fn sql_variant_exposes_code_and_position() {
        let err = AppError::Sql {
            code: Some("42601".to_string()),
            position: Some(7),
            message: "syntax error".to_string(),
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "Sql");
        assert_eq!(json["code"], "42601");
        assert_eq!(json["position"], 7);
    }

    #[test]
    fn connection_variant_is_retryable() {
        assert!(AppError::Connection("connection closed".into()).is_retryable());
    }

    #[test]
    fn shutdown_sqlstates_are_retryable() {
        for code in ["57P01", "57P02", "08006"] {
            let err = AppError::Sql {
                code: Some(code.to_string()),
                position: None,
                message: "shutdown".to_string(),
            };
            assert!(err.is_retryable(), "{code} should be retryable");
        }
    }

    #[test]
    fn syntax_error_is_not_retryable() {
        let err = AppError::Sql {
            code: Some("42601".to_string()),
            position: None,
            message: "syntax error".to_string(),
        };
        assert!(!err.is_retryable());
    }

    #[test]
    fn context_preserves_kind_and_code() {
        let err = AppError::Sql {
            code: Some("42601".to_string()),
            position: None,
            message: "boom".to_string(),
        }
        .context("Filter query failed");
        match err {
            AppError::Sql { code, message, .. } => {
                assert_eq!(code.as_deref(), Some("42601"));
                assert!(message.starts_with("Filter query failed"));
                assert!(message.contains("boom"));
            }
            _ => panic!("kind changed"),
        }
    }
}
