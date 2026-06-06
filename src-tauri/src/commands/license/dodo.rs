//! Dodo Payments license validation (external API) and the background
//! re-validation task. License-domain state (the keychain-stored license) lives
//! in the parent module; this module only talks to Dodo and refreshes that state.

use chrono::Utc;
use serde_json::Value;
use tauri::AppHandle;

use super::{clear_stored_license, read_stored_license, write_stored_license, StoredLicense};

const DODO_BASE: &str = if cfg!(debug_assertions) {
    "https://test.dodopayments.com"
} else {
    "https://live.dodopayments.com"
};

pub(super) enum DodoError {
    InvalidFormat,
    NetworkOrServer,
}

/// Calls `POST /licenses/validate` via the system `curl` binary.
/// Returns `Ok(true/false)` based on the `valid` field in Dodo's response.
pub(super) async fn call_dodo_validate(license_key: &str) -> Result<bool, DodoError> {
    let url = format!("{DODO_BASE}/licenses/validate");
    let body = format!(
        "{{\"license_key\":\"{}\"}}",
        license_key.replace('"', "\\\"")
    );

    let output = tokio::process::Command::new("curl")
        .args([
            "-s",
            "--max-time",
            "10",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "-H",
            "Accept: application/json",
            "-d",
            &body,
            "-w",
            "\n%{http_code}",
            &url,
        ])
        .output()
        .await
        .map_err(|_| DodoError::NetworkOrServer)?;

    if !output.status.success() {
        return Err(DodoError::NetworkOrServer);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // curl -w appends the status code on its own line
    let (response_body, http_code_str) = stdout
        .trim_end()
        .rsplit_once('\n')
        .ok_or(DodoError::NetworkOrServer)?;

    let http_code: u16 = http_code_str.trim().parse().unwrap_or(0);

    if http_code == 422 {
        return Err(DodoError::InvalidFormat);
    }
    if http_code >= 500 || http_code == 0 {
        return Err(DodoError::NetworkOrServer);
    }

    let parsed: Value =
        serde_json::from_str(response_body).map_err(|_| DodoError::NetworkOrServer)?;

    Ok(parsed
        .get("valid")
        .and_then(Value::as_bool)
        .unwrap_or(false))
}

pub(super) fn dodo_error_message(error: &DodoError) -> String {
    match error {
        DodoError::InvalidFormat => "Invalid license key format — check for typos".to_string(),
        DodoError::NetworkOrServer => {
            "Could not reach the license server — check your connection and try again".to_string()
        }
    }
}

pub(super) fn dodo_invalid_key_message() -> &'static str {
    "License key is not valid or has expired — check your subscription in the customer portal"
}

/// Re-validates the stored license key against Dodo if it is older than 24 hours.
/// Called on launch and then every 24 hours by the background task in lib.rs.
pub async fn revalidate_license_background(app: AppHandle) {
    let Some(stored) = read_stored_license() else {
        return;
    };
    let Ok(validated_at) = chrono::DateTime::parse_from_rfc3339(&stored.validated_at) else {
        return;
    };
    let age = Utc::now() - validated_at.with_timezone(&Utc);
    if age < chrono::Duration::hours(24) {
        return;
    }
    match call_dodo_validate(&stored.license_key).await {
        Ok(true) => {
            let refreshed = StoredLicense {
                license_key: stored.license_key,
                validated_at: Utc::now().to_rfc3339(),
            };
            write_stored_license(&refreshed).ok();
        }
        Ok(false) => {
            clear_stored_license();
        }
        Err(_) => {
            // Network or server error — offline grace applies; do nothing
        }
    }
    drop(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_format_error_message() {
        assert_eq!(
            dodo_error_message(&DodoError::InvalidFormat),
            "Invalid license key format — check for typos"
        );
    }

    #[test]
    fn network_error_message() {
        assert_eq!(
            dodo_error_message(&DodoError::NetworkOrServer),
            "Could not reach the license server — check your connection and try again"
        );
    }

    #[test]
    fn valid_false_message() {
        assert_eq!(
            dodo_invalid_key_message(),
            "License key is not valid or has expired — check your subscription in the customer portal"
        );
    }
}
