//! Shared connection-acquisition helpers and the timeouts that bound them.
//!
//! Without an explicit timeout a TCP connect to an unreachable host (VPN down,
//! firewall dropping SYNs) never returns, so a query would sit in "Still
//! running…" forever instead of surfacing an error. Every path that takes a
//! connection out of a pool goes through the timeouts defined here.

use std::time::Duration;

use crate::AppError;

/// Max time to establish a brand-new connection (TCP + TLS + auth).
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Max time to wait for a free slot in an exhausted pool.
pub const POOL_WAIT_TIMEOUT: Duration = Duration::from_secs(30);

/// Max time for the liveness check performed on a recycled connection.
pub const RECYCLE_TIMEOUT: Duration = Duration::from_secs(5);

/// TCP keepalive idle time, so a connection whose network vanished mid-query
/// fails within about a minute instead of hanging on the OS default.
pub const KEEPALIVE_IDLE: Duration = Duration::from_secs(30);

/// User-facing message for an unreachable server. Deadpool's own timeout text
/// ("Timeout occurred while creating a new object") means nothing to a user.
pub fn unreachable_message(secs: u64) -> String {
    format!(
        "Could not reach the database server within {secs}s. \
         The host may be unreachable — check your network, VPN, or the host/port settings."
    )
}

/// Rewrite a raw driver connection error into something a user can act on.
/// The drivers' own timeout text ("error connecting to server: connection
/// timed out", "Timeout occurred while creating a new object") does not say
/// what to check.
pub fn humanize_connection_error(raw: String) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("timed out") || lower.contains("timeout occurred") {
        return unreachable_message(CONNECT_TIMEOUT.as_secs());
    }
    // Deadpool's pool-internal preamble means nothing outside the pool.
    let trimmed = raw
        .strip_prefix("Error occurred while creating a new object: ")
        .unwrap_or(&raw);
    // `mysql_async` nests its own Display ("Input/output error: Input/output
    // error: …"); collapse consecutive repeats.
    let mut parts: Vec<&str> = trimmed.split(": ").collect();
    parts.dedup();
    parts.join(": ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_becomes_an_actionable_message() {
        let msg = humanize_connection_error(
            "error connecting to server: connection timed out".into(),
        );
        assert!(msg.contains("Could not reach the database server"));
        assert!(msg.contains("VPN"));
    }

    #[test]
    fn repeated_segments_are_collapsed() {
        let msg = humanize_connection_error(
            "Input/output error: Input/output error: failed to lookup address".into(),
        );
        assert_eq!(msg, "Input/output error: failed to lookup address");
    }

    #[test]
    fn non_timeout_errors_keep_their_detail() {
        let msg = humanize_connection_error(
            "Error occurred while creating a new object: password authentication failed".into(),
        );
        assert_eq!(msg, "password authentication failed");
    }
}

/// Take a MySQL connection from the pool, bounded by [`CONNECT_TIMEOUT`].
/// `mysql_async` has no TCP connect timeout of its own, so we impose one.
pub async fn mysql_conn(pool: &mysql_async::Pool) -> Result<mysql_async::Conn, AppError> {
    match tokio::time::timeout(CONNECT_TIMEOUT, pool.get_conn()).await {
        Ok(res) => res.map_err(AppError::from),
        Err(_) => Err(AppError::Connection(unreachable_message(
            CONNECT_TIMEOUT.as_secs(),
        ))),
    }
}
