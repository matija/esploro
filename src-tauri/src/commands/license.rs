use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_log::log::warn;

use crate::{AppError, AppState};

mod dodo;
mod ui_preferences;

pub use self::dodo::revalidate_license_background;
pub use self::ui_preferences::{UiPreferenceEditor, UiPreferenceUi, UiPreferences};

use self::ui_preferences::{
    default_ui_preferences, normalize_ui_preferences, preferences_from_json,
};

const CUSTOMER_PORTAL_URL: &str =
    "https://customer.dodopayments.com/login/bus_0Nd287Njbj0coK51YHj55";

const KEYCHAIN_SERVICE: &str = "app.esploro";
const KEYCHAIN_ACCOUNT: &str = "commercial-license";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, specta::Type, Clone, Debug, PartialEq)]
pub enum LicenseTier {
    Personal,
    Commercial,
    Unlicensed,
}

#[derive(Serialize, specta::Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub tier: LicenseTier,
    pub banner_visible: bool,
    pub grace_period_ends: Option<String>,
    pub show_usage_dialog: bool,
    /// True when a cached license exists but hasn't been re-validated for >14 days offline.
    pub revalidation_required: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct StoredLicense {
    license_key: String,
    validated_at: String,
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
    #[serde(default)]
    pub ui: Option<UiPreferenceUi>,
    #[serde(default)]
    pub editor: Option<UiPreferenceEditor>,
}

// ---------------------------------------------------------------------------
// Keychain helpers
// ---------------------------------------------------------------------------

fn read_stored_license() -> Option<StoredLicense> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).ok()?;
    match entry.get_password() {
        Ok(json) => serde_json::from_str(&json).ok(),
        Err(keyring::Error::NoEntry) => None,
        Err(e) => {
            warn!("failed to read license from keychain: {e}");
            None
        }
    }
}

fn write_stored_license(stored: &StoredLicense) -> Result<(), AppError> {
    let json = serde_json::to_string(stored)?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)?;
    entry.set_password(&json).map_err(AppError::from)
}

fn clear_stored_license() {
    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        entry.delete_password().ok();
    }
}

// ---------------------------------------------------------------------------
// File path helpers
// ---------------------------------------------------------------------------

async fn prefs_path(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app data dir");
    tokio::fs::create_dir_all(&dir).await.ok();
    dir.join("prefs.json")
}

// ---------------------------------------------------------------------------
// Prefs helpers
// ---------------------------------------------------------------------------

async fn read_prefs_json(app: &AppHandle) -> Result<Option<Value>, AppError> {
    let path = prefs_path(app).await;
    let data = match tokio::fs::read_to_string(&path).await {
        Ok(data) => data,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(AppError::from(e)),
    };

    serde_json::from_str::<Value>(&data)
        .map(Some)
        .map_err(AppError::from)
}

async fn write_json_atomic(path: &Path, value: &Value) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let data = serde_json::to_string_pretty(value)?;
    let tmp_path = path.with_extension("json.tmp");
    tokio::fs::write(&tmp_path, data).await?;
    tokio::fs::rename(&tmp_path, path)
        .await
        .map_err(AppError::from)
}

async fn load_prefs(app: &AppHandle) -> UserPrefs {
    let path = prefs_path(app).await;
    match tokio::fs::read_to_string(&path).await {
        Ok(data) => {
            if let Ok(prefs) = serde_json::from_str::<UserPrefs>(&data) {
                return prefs;
            }
            warn!("failed to parse prefs.json; using defaults");
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => warn!("failed to read prefs.json: {e}; using defaults"),
    }
    UserPrefs {
        usage_type_answered: false,
        usage_type: None,
        first_launch: Utc::now().to_rfc3339(),
        commercial_detected_at: None,
        ui_theme: None,
        ui: None,
        editor: None,
    }
}

async fn save_prefs(app: &AppHandle, prefs: &UserPrefs) -> Result<(), AppError> {
    let path = prefs_path(app).await;
    let value = serde_json::to_value(prefs)?;
    write_json_atomic(&path, &value).await
}

// ---------------------------------------------------------------------------
// Status computation
// ---------------------------------------------------------------------------

/// Pure status computation — no I/O; accepts all inputs as parameters.
fn compute_status_pure(
    stored: Option<&StoredLicense>,
    prefs: &UserPrefs,
    banner_dismissed: bool,
    now: chrono::DateTime<Utc>,
) -> LicenseStatus {
    if let Some(stored) = stored {
        if let Ok(validated_at) = chrono::DateTime::parse_from_rfc3339(&stored.validated_at) {
            let age = now - validated_at.with_timezone(&Utc);
            if age < chrono::Duration::days(14) {
                return LicenseStatus {
                    tier: LicenseTier::Commercial,
                    banner_visible: false,
                    grace_period_ends: None,
                    show_usage_dialog: false,
                    revalidation_required: false,
                };
            }
            // Key exists but offline too long — revert to Unlicensed
            return LicenseStatus {
                tier: LicenseTier::Unlicensed,
                banner_visible: false,
                grace_period_ends: None,
                show_usage_dialog: false,
                revalidation_required: true,
            };
        }
    }

    // Commercial usage detected — show banner immediately (subject only to session dismissal).
    if prefs.commercial_detected_at.is_some() {
        return LicenseStatus {
            tier: LicenseTier::Unlicensed,
            banner_visible: !banner_dismissed,
            grace_period_ends: None,
            show_usage_dialog: false,
            revalidation_required: false,
        };
    }

    // Personal or unknown — check if we should show the usage dialog
    let first_launch = chrono::DateTime::parse_from_rfc3339(&prefs.first_launch)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or(now);
    let days_since_launch = (now - first_launch).num_days();
    let show_usage_dialog = !prefs.usage_type_answered && days_since_launch >= 3;

    let tier = if prefs.usage_type.as_deref() == Some("personal") {
        LicenseTier::Personal
    } else {
        LicenseTier::Unlicensed
    };

    LicenseStatus {
        tier,
        banner_visible: false,
        grace_period_ends: None,
        show_usage_dialog,
        revalidation_required: false,
    }
}

/// Returns status from cached state only — no network calls.
async fn compute_status(app: &AppHandle, banner_dismissed: bool) -> LicenseStatus {
    let prefs = load_prefs(app).await;
    let stored = read_stored_license();
    compute_status_pure(stored.as_ref(), &prefs, banner_dismissed, Utc::now())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub async fn get_license_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LicenseStatus, AppError> {
    // Best-effort cleanup of legacy file-based license key
    let legacy_path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("license.key"));
    if let Some(path) = legacy_path {
        tokio::fs::remove_file(&path).await.ok();
    }

    let dismissed = *state.banner_dismissed.lock().await;
    Ok(compute_status(&app, dismissed).await)
}

#[tauri::command]
#[specta::specta]
pub async fn activate_license(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
) -> Result<LicenseStatus, AppError> {
    match dodo::call_dodo_validate(key.trim()).await {
        Ok(true) => {
            let stored = StoredLicense {
                license_key: key.trim().to_string(),
                validated_at: Utc::now().to_rfc3339(),
            };
            write_stored_license(&stored)?;
            let dismissed = *state.banner_dismissed.lock().await;
            Ok(compute_status(&app, dismissed).await)
        }
        Ok(false) => Err(AppError::License(
            dodo::dodo_invalid_key_message().to_string(),
        )),
        Err(ref e) => Err(AppError::License(dodo::dodo_error_message(e))),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn deactivate_license(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LicenseStatus, AppError> {
    clear_stored_license();
    let dismissed = *state.banner_dismissed.lock().await;
    Ok(compute_status(&app, dismissed).await)
}

#[tauri::command]
#[specta::specta]
pub async fn answer_usage_dialog(
    app: AppHandle,
    state: State<'_, AppState>,
    answer: String,
) -> Result<LicenseStatus, AppError> {
    let mut prefs = load_prefs(&app).await;
    prefs.usage_type_answered = true;
    prefs.usage_type = Some(answer.clone());
    if answer == "commercial" && prefs.commercial_detected_at.is_none() {
        prefs.commercial_detected_at = Some(Utc::now().to_rfc3339());
    }
    save_prefs(&app, &prefs).await?;
    let dismissed = *state.banner_dismissed.lock().await;
    Ok(compute_status(&app, dismissed).await)
}

#[tauri::command]
#[specta::specta]
pub async fn dismiss_license_banner(state: State<'_, AppState>) -> Result<(), AppError> {
    *state.banner_dismissed.lock().await = true;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn notify_connection_count(
    app: AppHandle,
    state: State<'_, AppState>,
    count: usize,
) -> Result<LicenseStatus, AppError> {
    let mut prefs = load_prefs(&app).await;
    if count >= 4 && prefs.commercial_detected_at.is_none() {
        prefs.commercial_detected_at = Some(Utc::now().to_rfc3339());
        save_prefs(&app, &prefs).await?;
    }
    let dismissed = *state.banner_dismissed.lock().await;
    Ok(compute_status(&app, dismissed).await)
}

#[tauri::command]
#[specta::specta]
pub fn open_customer_portal() -> Result<(), AppError> {
    std::process::Command::new("open")
        .arg(CUSTOMER_PORTAL_URL)
        .spawn()
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn open_url(url: String) -> Result<(), AppError> {
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn get_ui_preferences(app: AppHandle) -> Result<UiPreferences, AppError> {
    match read_prefs_json(&app).await {
        Ok(Some(value)) => Ok(preferences_from_json(&value)),
        Ok(None) => Ok(default_ui_preferences()),
        Err(error) => {
            warn!("failed to parse prefs.json: {error}; using UI preference defaults");
            Ok(default_ui_preferences())
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn set_ui_preferences(
    app: AppHandle,
    preferences: UiPreferences,
) -> Result<(), AppError> {
    let preferences = normalize_ui_preferences(preferences);
    let mut root = match read_prefs_json(&app).await {
        Ok(Some(Value::Object(map))) => map,
        Ok(Some(_)) | Ok(None) => Map::new(),
        Err(error) => {
            warn!("failed to parse prefs.json before writing UI preferences: {error}");
            Map::new()
        }
    };

    root.insert("ui".to_string(), serde_json::to_value(&preferences.ui)?);
    root.insert(
        "editor".to_string(),
        serde_json::to_value(&preferences.editor)?,
    );
    root.insert(
        "uiTheme".to_string(),
        Value::String(preferences.ui.theme.clone()),
    );

    write_json_atomic(&prefs_path(&app).await, &Value::Object(root)).await
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn base_prefs() -> UserPrefs {
        UserPrefs {
            usage_type_answered: false,
            usage_type: None,
            first_launch: Utc::now().to_rfc3339(),
            commercial_detected_at: None,
            ui_theme: None,
            ui: None,
            editor: None,
        }
    }

    fn stored(validated_at: chrono::DateTime<Utc>) -> StoredLicense {
        StoredLicense {
            license_key: "test-key".to_string(),
            validated_at: validated_at.to_rfc3339(),
        }
    }

    // -- State-machine transitions --

    #[test]
    fn freshly_validated_key_is_commercial() {
        let now = Utc::now();
        let s = stored(now - Duration::hours(1));
        let status = compute_status_pure(Some(&s), &base_prefs(), false, now);
        assert_eq!(status.tier, LicenseTier::Commercial);
        assert!(!status.banner_visible);
        assert!(!status.revalidation_required);
    }

    #[test]
    fn key_validated_13_days_ago_is_still_commercial() {
        let now = Utc::now();
        let s = stored(now - Duration::days(13));
        let status = compute_status_pure(Some(&s), &base_prefs(), false, now);
        assert_eq!(status.tier, LicenseTier::Commercial);
        assert!(!status.revalidation_required);
    }

    #[test]
    fn key_validated_over_14_days_ago_requires_revalidation() {
        let now = Utc::now();
        let s = stored(now - Duration::days(15));
        let status = compute_status_pure(Some(&s), &base_prefs(), false, now);
        assert_eq!(status.tier, LicenseTier::Unlicensed);
        assert!(status.revalidation_required);
        assert!(!status.banner_visible);
    }

    #[test]
    fn commercial_detected_shows_banner_immediately() {
        // No 14-day grace period: as soon as commercial usage is detected the banner is shown
        // (subject only to session dismissal).
        let now = Utc::now();
        let mut prefs = base_prefs();
        prefs.commercial_detected_at = Some(now.to_rfc3339());
        let status = compute_status_pure(None, &prefs, false, now);
        assert_eq!(status.tier, LicenseTier::Unlicensed);
        assert!(status.banner_visible);
        assert!(status.grace_period_ends.is_none());
        assert!(!status.revalidation_required);
    }

    #[test]
    fn commercial_detected_banner_hidden_when_dismissed_for_session() {
        let now = Utc::now();
        let mut prefs = base_prefs();
        prefs.commercial_detected_at = Some(now.to_rfc3339());
        let status = compute_status_pure(None, &prefs, true, now);
        assert_eq!(status.tier, LicenseTier::Unlicensed);
        assert!(!status.banner_visible);
    }

    #[test]
    fn commercial_detected_long_ago_still_shows_banner() {
        // Sanity: the previous 14-day grace bug suppressed the banner for 14 days. Even a
        // long-ago detection must still surface the banner now.
        let now = Utc::now();
        let mut prefs = base_prefs();
        prefs.commercial_detected_at = Some((now - Duration::days(20)).to_rfc3339());
        let status = compute_status_pure(None, &prefs, false, now);
        assert!(status.banner_visible);
        assert!(status.grace_period_ends.is_none());
    }

    #[test]
    fn no_stored_license_no_commercial_detection_is_unlicensed_no_banner() {
        let now = Utc::now();
        let status = compute_status_pure(None, &base_prefs(), false, now);
        assert_eq!(status.tier, LicenseTier::Unlicensed);
        assert!(!status.banner_visible);
        assert!(!status.revalidation_required);
    }
}
