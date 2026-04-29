use std::path::PathBuf;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::{AppHandle, Manager, State};

use crate::AppState;

type HmacSha256 = Hmac<Sha256>;

// Dev fallback; production builds set ESPLORO_LICENSE_SECRET_KEY at compile time.
const SIGNING_KEY: &[u8] = match option_env!("ESPLORO_LICENSE_SECRET_KEY") {
    Some(k) => k.as_bytes(),
    None => b"dev-esploro-license-secret-key-for-testing-only-64bytes-padded!",
};

const LICENSE_URL: &str = match option_env!("ESPLORO_STRIPE_URL") {
    Some(u) => u,
    None => "https://esploro.app/buy",
};

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LicensePayload {
    pub version: u32,
    pub tier: String,
    pub issued_at: String,
    pub expires_at: Option<String>,
    pub licensee: String,
    pub max_seats: Option<u32>,
    pub key_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum LicenseTier {
    Personal,
    Commercial,
    Unlicensed,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub tier: LicenseTier,
    pub licensee: Option<String>,
    pub expires_at: Option<String>,
    pub days_until_expiry: Option<i64>,
    pub banner_visible: bool,
    pub grace_period_ends: Option<String>,
    pub show_usage_dialog: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UserPrefs {
    pub usage_type_answered: bool,
    pub usage_type: Option<String>,
    pub first_launch: String,
    pub commercial_detected_at: Option<String>,
    #[serde(default)]
    pub ui_theme: Option<String>, // "light" | "dark" | "system"
}

#[derive(Debug)]
enum LicenseError {
    InvalidFormat,
    InvalidSignature,
    Expired,
}

impl std::fmt::Display for LicenseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LicenseError::InvalidFormat => write!(f, "Invalid key format"),
            LicenseError::InvalidSignature => write!(f, "Invalid key"),
            LicenseError::Expired => write!(f, "This license has expired"),
        }
    }
}

// ---------------------------------------------------------------------------
// File path helpers
// ---------------------------------------------------------------------------

fn license_key_path(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app data dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("license.key")
}

fn prefs_path(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app data dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("prefs.json")
}

// ---------------------------------------------------------------------------
// Prefs helpers
// ---------------------------------------------------------------------------

fn load_prefs(app: &AppHandle) -> UserPrefs {
    let path = prefs_path(app);
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(prefs) = serde_json::from_str::<UserPrefs>(&data) {
                return prefs;
            }
        }
    }
    let prefs = UserPrefs {
        usage_type_answered: false,
        usage_type: None,
        first_launch: Utc::now().to_rfc3339(),
        commercial_detected_at: None,
        ui_theme: None,
    };
    let _ = save_prefs(app, &prefs);
    prefs
}

fn save_prefs(app: &AppHandle, prefs: &UserPrefs) -> Result<(), String> {
    let path = prefs_path(app);
    let data = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// HMAC verification
// ---------------------------------------------------------------------------

fn verify_license_key(raw_key: &str) -> Result<LicensePayload, LicenseError> {
    let trimmed = raw_key.trim().trim_start_matches("ESPLORO-");
    let parts: Vec<&str> = trimmed.splitn(2, '.').collect();
    if parts.len() != 2 {
        return Err(LicenseError::InvalidFormat);
    }

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(parts[0])
        .map_err(|_| LicenseError::InvalidFormat)?;
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|_| LicenseError::InvalidFormat)?;

    let mut mac =
        HmacSha256::new_from_slice(SIGNING_KEY).expect("HMAC accepts any key length");
    mac.update(&payload_bytes);
    mac.verify_slice(&sig_bytes)
        .map_err(|_| LicenseError::InvalidSignature)?;

    let payload: LicensePayload =
        serde_json::from_slice(&payload_bytes).map_err(|_| LicenseError::InvalidFormat)?;

    if let Some(expires) = &payload.expires_at {
        let exp = chrono::DateTime::parse_from_rfc3339(expires)
            .map_err(|_| LicenseError::InvalidFormat)?;
        if exp.with_timezone(&Utc) < Utc::now() {
            return Err(LicenseError::Expired);
        }
    }

    Ok(payload)
}

// ---------------------------------------------------------------------------
// Status computation
// ---------------------------------------------------------------------------

fn compute_status(app: &AppHandle, banner_dismissed: bool) -> LicenseStatus {
    let prefs = load_prefs(app);

    // Check for a valid license key on disk
    let key_path = license_key_path(app);
    if key_path.exists() {
        if let Ok(key_str) = std::fs::read_to_string(&key_path) {
            if let Ok(payload) = verify_license_key(key_str.trim()) {
                let days_until_expiry = payload.expires_at.as_ref().and_then(|e| {
                    chrono::DateTime::parse_from_rfc3339(e).ok().map(|exp| {
                        (exp.with_timezone(&Utc) - Utc::now()).num_days()
                    })
                });
                return LicenseStatus {
                    tier: LicenseTier::Commercial,
                    licensee: Some(payload.licensee),
                    expires_at: payload.expires_at,
                    days_until_expiry,
                    banner_visible: false,
                    grace_period_ends: None,
                    show_usage_dialog: false,
                };
            }
        }
    }

    // Commercial usage detected?
    if let Some(detected_str) = &prefs.commercial_detected_at {
        if let Ok(detected) = chrono::DateTime::parse_from_rfc3339(detected_str) {
            let grace_end = detected.with_timezone(&Utc)
                + chrono::Duration::days(14);
            let grace_period_ends = Some(grace_end.to_rfc3339());
            let banner_visible = Utc::now() > grace_end && !banner_dismissed;
            return LicenseStatus {
                tier: LicenseTier::Unlicensed,
                licensee: None,
                expires_at: None,
                days_until_expiry: None,
                banner_visible,
                grace_period_ends,
                show_usage_dialog: false,
            };
        }
    }

    // Personal or unknown — check if we should show the usage dialog
    let first_launch = chrono::DateTime::parse_from_rfc3339(&prefs.first_launch)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());
    let days_since_launch = (Utc::now() - first_launch).num_days();
    let show_usage_dialog = !prefs.usage_type_answered && days_since_launch >= 3;

    let tier = if prefs.usage_type.as_deref() == Some("personal") {
        LicenseTier::Personal
    } else {
        LicenseTier::Unlicensed
    };

    LicenseStatus {
        tier,
        licensee: None,
        expires_at: None,
        days_until_expiry: None,
        banner_visible: false,
        grace_period_ends: None,
        show_usage_dialog,
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_license_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LicenseStatus, String> {
    let dismissed = *state.banner_dismissed.lock().await;
    Ok(compute_status(&app, dismissed))
}

#[tauri::command]
pub async fn activate_license(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
) -> Result<LicenseStatus, String> {
    let payload = verify_license_key(key.trim()).map_err(|e| e.to_string())?;
    if payload.tier != "commercial" {
        return Err("Not a commercial license key".to_string());
    }
    let key_path = license_key_path(&app);
    std::fs::write(&key_path, key.trim()).map_err(|e| e.to_string())?;
    let dismissed = *state.banner_dismissed.lock().await;
    Ok(compute_status(&app, dismissed))
}

#[tauri::command]
pub async fn deactivate_license(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LicenseStatus, String> {
    let key_path = license_key_path(&app);
    if key_path.exists() {
        std::fs::remove_file(&key_path).map_err(|e| e.to_string())?;
    }
    let dismissed = *state.banner_dismissed.lock().await;
    Ok(compute_status(&app, dismissed))
}

#[tauri::command]
pub async fn answer_usage_dialog(
    app: AppHandle,
    state: State<'_, AppState>,
    answer: String,
) -> Result<LicenseStatus, String> {
    let mut prefs = load_prefs(&app);
    prefs.usage_type_answered = true;
    prefs.usage_type = Some(answer.clone());
    if answer == "commercial" && prefs.commercial_detected_at.is_none() {
        prefs.commercial_detected_at = Some(Utc::now().to_rfc3339());
    }
    save_prefs(&app, &prefs)?;
    let dismissed = *state.banner_dismissed.lock().await;
    Ok(compute_status(&app, dismissed))
}

#[tauri::command]
pub async fn dismiss_license_banner(state: State<'_, AppState>) -> Result<(), String> {
    *state.banner_dismissed.lock().await = true;
    Ok(())
}

#[tauri::command]
pub async fn notify_connection_count(
    app: AppHandle,
    state: State<'_, AppState>,
    count: usize,
) -> Result<LicenseStatus, String> {
    let mut prefs = load_prefs(&app);
    if count >= 4 && prefs.commercial_detected_at.is_none() {
        prefs.commercial_detected_at = Some(Utc::now().to_rfc3339());
        save_prefs(&app, &prefs)?;
    }
    let dismissed = *state.banner_dismissed.lock().await;
    Ok(compute_status(&app, dismissed))
}

#[tauri::command]
pub fn open_license_url() -> Result<(), String> {
    std::process::Command::new("open")
        .arg(LICENSE_URL)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_ui_pref(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let mut prefs = load_prefs(&app);
    match key.as_str() {
        "ui.theme" => prefs.ui_theme = Some(value),
        _ => return Err(format!("Unknown pref key: {key}")),
    }
    save_prefs(&app, &prefs)
}
