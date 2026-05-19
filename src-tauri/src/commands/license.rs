use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, State};

use crate::AppState;

#[cfg(not(feature = "mas"))]
const CUSTOMER_PORTAL_URL: &str = "https://app.dodopayments.com/customer-portal";

#[cfg(not(feature = "mas"))]
const DODO_BASE: &str = if cfg!(debug_assertions) {
    "https://test.dodopayments.com"
} else {
    "https://live.dodopayments.com"
};

#[cfg(not(feature = "mas"))]
const KEYCHAIN_SERVICE: &str = "app.esploro";
#[cfg(not(feature = "mas"))]
const KEYCHAIN_ACCOUNT: &str = "commercial-license";

const DEFAULT_UI_THEME: &str = "tairiki-light";
const DEFAULT_UI_FONT_FAMILY: &str =
    "\"Inter Variable\", Inter, -apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Helvetica Neue\", sans-serif";
const DEFAULT_UI_FONT_SIZE: u8 = 14;
const DEFAULT_EDITOR_FONT_FAMILY: &str =
    "\"JetBrains Mono Variable\", \"JetBrains Mono\", ui-monospace, \"SF Mono\", Menlo, Monaco, \"Courier New\", monospace";
const DEFAULT_EDITOR_FONT_SIZE: u8 = 12;
const DEFAULT_EDITOR_LINE_HEIGHT: f64 = 1.5;

fn default_editor_tab_size() -> u8 {
    2
}

fn default_grid_row_density() -> String {
    "compact".to_string()
}

fn default_grid_page_size() -> u16 {
    200
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

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
    pub banner_visible: bool,
    pub grace_period_ends: Option<String>,
    pub show_usage_dialog: bool,
    /// True when a cached license exists but hasn't been re-validated for >14 days offline.
    pub revalidation_required: bool,
}

#[cfg(not(feature = "mas"))]
#[derive(Serialize, Deserialize, Clone, Debug)]
struct StoredLicense {
    license_key: String,
    validated_at: String,
}

/// Cached commercial-license signal, sourced per build flavour.
///
/// - **Direct** build: populated from the Dodo Payments validation cache
///   (`StoredLicense`). `Active` means the key was validated within the
///   14-day offline grace window; `Stale` means it has been longer and the
///   user must reconnect to revalidate.
/// - **MAS** build: populated from the StoreKit entitlement cache
///   (`StoredEntitlement`). Only `Active` is reachable — App Store
///   subscriptions are the source of truth, so there is no offline-grace
///   concept and the `Stale` variant is gated out.
#[derive(Debug, Clone, PartialEq, Eq)]
enum CachedLicense {
    Active,
    #[cfg(not(feature = "mas"))]
    Stale,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UiPreferences {
    pub ui: UiPreferenceUi,
    pub editor: UiPreferenceEditor,
    #[serde(default)]
    pub grid: UiGridConfig,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UiPreferenceUi {
    pub theme: String,
    pub font_family: String,
    pub font_size: u8,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UiPreferenceEditor {
    pub font_family: String,
    pub font_size: u8,
    pub line_height: f64,
    #[serde(default = "default_editor_tab_size")]
    pub tab_size: u8,
    #[serde(default)]
    pub word_wrap: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UiGridConfig {
    #[serde(default = "default_grid_row_density")]
    pub row_density: String,
    #[serde(default = "default_grid_page_size")]
    pub page_size: u16,
    #[serde(default = "default_show_total_count")]
    pub show_total_count: bool,
}

fn default_show_total_count() -> bool {
    true
}

impl Default for UiGridConfig {
    fn default() -> Self {
        UiGridConfig {
            row_density: default_grid_row_density(),
            page_size: default_grid_page_size(),
            show_total_count: default_show_total_count(),
        }
    }
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
// Keychain helpers (Direct build only — Dodo Payments cache)
// ---------------------------------------------------------------------------

#[cfg(not(feature = "mas"))]
fn read_stored_license() -> Option<StoredLicense> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).ok()?;
    match entry.get_password() {
        Ok(json) => serde_json::from_str(&json).ok(),
        Err(keyring::Error::NoEntry) => None,
        Err(e) => {
            eprintln!("Failed to read license from keychain: {e}");
            None
        }
    }
}

#[cfg(not(feature = "mas"))]
fn write_stored_license(stored: &StoredLicense) -> Result<(), String> {
    let json = serde_json::to_string(stored).map_err(|e| e.to_string())?;
    let entry =
        keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())?;
    entry.set_password(&json).map_err(|e| e.to_string())
}

#[cfg(not(feature = "mas"))]
fn clear_stored_license() {
    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        entry.delete_password().ok();
    }
}

// ---------------------------------------------------------------------------
// File path helpers
// ---------------------------------------------------------------------------

fn prefs_path(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app data dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("prefs.json")
}

// ---------------------------------------------------------------------------
// Prefs helpers
// ---------------------------------------------------------------------------

fn default_ui_preferences() -> UiPreferences {
    UiPreferences {
        ui: UiPreferenceUi {
            theme: DEFAULT_UI_THEME.to_string(),
            font_family: DEFAULT_UI_FONT_FAMILY.to_string(),
            font_size: DEFAULT_UI_FONT_SIZE,
        },
        editor: UiPreferenceEditor {
            font_family: DEFAULT_EDITOR_FONT_FAMILY.to_string(),
            font_size: DEFAULT_EDITOR_FONT_SIZE,
            line_height: DEFAULT_EDITOR_LINE_HEIGHT,
            tab_size: default_editor_tab_size(),
            word_wrap: false,
        },
        grid: UiGridConfig::default(),
    }
}

fn normalize_theme(theme: &str) -> String {
    match theme {
        "tairiki-light" | "tairiki-dark" | "system" | "macos-light" | "macos-dark"
        | "tokyo-night" | "tokyo-night-day" | "github-dark" | "github-light" => {
            theme.to_string()
        }
        "light" => "tairiki-light".to_string(),
        "dark" => "tairiki-dark".to_string(),
        _ => DEFAULT_UI_THEME.to_string(),
    }
}

fn non_empty_or_default(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn clamp_u8(value: u8, min: u8, max: u8, fallback: u8) -> u8 {
    if value < min || value > max {
        fallback
    } else {
        value
    }
}

fn clamp_f64(value: f64, min: f64, max: f64, fallback: f64) -> f64 {
    if !value.is_finite() || value < min || value > max {
        fallback
    } else {
        value
    }
}

fn normalize_tab_size(value: u8) -> u8 {
    match value {
        2 | 4 | 8 => value,
        _ => default_editor_tab_size(),
    }
}

fn normalize_grid_row_density(value: &str) -> String {
    match value {
        "compact" | "comfortable" | "spacious" => value.to_string(),
        _ => default_grid_row_density(),
    }
}

fn normalize_grid_page_size(value: u16) -> u16 {
    match value {
        50 | 100 | 200 | 500 => value,
        _ => default_grid_page_size(),
    }
}

fn normalize_ui_preferences(preferences: UiPreferences) -> UiPreferences {
    UiPreferences {
        ui: UiPreferenceUi {
            theme: normalize_theme(&preferences.ui.theme),
            font_family: non_empty_or_default(&preferences.ui.font_family, DEFAULT_UI_FONT_FAMILY),
            font_size: clamp_u8(preferences.ui.font_size, 11, 16, DEFAULT_UI_FONT_SIZE),
        },
        editor: UiPreferenceEditor {
            font_family: non_empty_or_default(
                &preferences.editor.font_family,
                DEFAULT_EDITOR_FONT_FAMILY,
            ),
            font_size: clamp_u8(
                preferences.editor.font_size,
                11,
                18,
                DEFAULT_EDITOR_FONT_SIZE,
            ),
            line_height: clamp_f64(
                preferences.editor.line_height,
                1.25,
                1.8,
                DEFAULT_EDITOR_LINE_HEIGHT,
            ),
            tab_size: normalize_tab_size(preferences.editor.tab_size),
            word_wrap: preferences.editor.word_wrap,
        },
        grid: UiGridConfig {
            row_density: normalize_grid_row_density(&preferences.grid.row_density),
            page_size: normalize_grid_page_size(preferences.grid.page_size),
            show_total_count: preferences.grid.show_total_count,
        },
    }
}

fn preferences_from_json(root: &Value) -> UiPreferences {
    let defaults = default_ui_preferences();
    let ui = root.get("ui").and_then(Value::as_object);
    let editor = root.get("editor").and_then(Value::as_object);
    let grid = root.get("grid").and_then(Value::as_object);
    let legacy_theme = root.get("uiTheme").and_then(Value::as_str);

    normalize_ui_preferences(UiPreferences {
        ui: UiPreferenceUi {
            theme: ui
                .and_then(|v| v.get("theme"))
                .and_then(Value::as_str)
                .or(legacy_theme)
                .unwrap_or(&defaults.ui.theme)
                .to_string(),
            font_family: ui
                .and_then(|v| v.get("fontFamily"))
                .and_then(Value::as_str)
                .unwrap_or(&defaults.ui.font_family)
                .to_string(),
            font_size: ui
                .and_then(|v| v.get("fontSize"))
                .and_then(Value::as_u64)
                .and_then(|v| u8::try_from(v).ok())
                .unwrap_or(defaults.ui.font_size),
        },
        editor: UiPreferenceEditor {
            font_family: editor
                .and_then(|v| v.get("fontFamily"))
                .and_then(Value::as_str)
                .unwrap_or(&defaults.editor.font_family)
                .to_string(),
            font_size: editor
                .and_then(|v| v.get("fontSize"))
                .and_then(Value::as_u64)
                .and_then(|v| u8::try_from(v).ok())
                .unwrap_or(defaults.editor.font_size),
            line_height: editor
                .and_then(|v| v.get("lineHeight"))
                .and_then(Value::as_f64)
                .unwrap_or(defaults.editor.line_height),
            tab_size: editor
                .and_then(|v| v.get("tabSize"))
                .and_then(Value::as_u64)
                .and_then(|v| u8::try_from(v).ok())
                .unwrap_or(defaults.editor.tab_size),
            word_wrap: editor
                .and_then(|v| v.get("wordWrap"))
                .and_then(Value::as_bool)
                .unwrap_or(defaults.editor.word_wrap),
        },
        grid: UiGridConfig {
            row_density: grid
                .and_then(|v| v.get("rowDensity"))
                .and_then(Value::as_str)
                .unwrap_or(&defaults.grid.row_density)
                .to_string(),
            page_size: grid
                .and_then(|v| v.get("pageSize"))
                .and_then(Value::as_u64)
                .and_then(|v| u16::try_from(v).ok())
                .unwrap_or(defaults.grid.page_size),
            show_total_count: grid
                .and_then(|v| v.get("showTotalCount"))
                .and_then(Value::as_bool)
                .unwrap_or(defaults.grid.show_total_count),
        },
    })
}

fn read_prefs_json(app: &AppHandle) -> Result<Option<Value>, String> {
    let path = prefs_path(app);
    if !path.exists() {
        return Ok(None);
    }

    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str::<Value>(&data)
        .map(Some)
        .map_err(|e| e.to_string())
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let data = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, path).map_err(|e| e.to_string())
}

fn load_prefs(app: &AppHandle) -> UserPrefs {
    let path = prefs_path(app);
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(prefs) = serde_json::from_str::<UserPrefs>(&data) {
                return prefs;
            }
            eprintln!("Failed to parse prefs.json; using defaults");
        }
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

fn save_prefs(app: &AppHandle, prefs: &UserPrefs) -> Result<(), String> {
    let path = prefs_path(app);
    let value = serde_json::to_value(prefs).map_err(|e| e.to_string())?;
    write_json_atomic(&path, &value)
}

// ---------------------------------------------------------------------------
// Dodo Payments validation (Direct build only)
// ---------------------------------------------------------------------------

#[cfg(not(feature = "mas"))]
enum DodoError {
    InvalidFormat,
    NetworkOrServer,
}

/// Calls `POST /licenses/validate` via the system `curl` binary.
/// Returns `Ok(true/false)` based on the `valid` field in Dodo's response.
#[cfg(not(feature = "mas"))]
async fn call_dodo_validate(license_key: &str) -> Result<bool, DodoError> {
    let url = format!("{DODO_BASE}/licenses/validate");
    let body = format!("{{\"license_key\":\"{}\"}}", license_key.replace('"', "\\\""));

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

    Ok(parsed.get("valid").and_then(Value::as_bool).unwrap_or(false))
}

// ---------------------------------------------------------------------------
// Cached-license resolution (per build)
// ---------------------------------------------------------------------------

/// Direct build: map a Dodo `StoredLicense` to the cross-build
/// `CachedLicense` abstraction. Returns `Active` while inside the 14-day
/// offline grace window, `Stale` afterwards (or if the timestamp is
/// unparseable — fail closed so the user revalidates).
#[cfg(not(feature = "mas"))]
fn direct_cached_license(stored: &StoredLicense, now: chrono::DateTime<Utc>) -> CachedLicense {
    match chrono::DateTime::parse_from_rfc3339(&stored.validated_at) {
        Ok(validated_at) => {
            let age = now - validated_at.with_timezone(&Utc);
            if age < chrono::Duration::days(14) {
                CachedLicense::Active
            } else {
                CachedLicense::Stale
            }
        }
        Err(_) => CachedLicense::Stale,
    }
}

/// MAS build: map a StoreKit `StoredEntitlement` to the cross-build
/// `CachedLicense` abstraction. Returns `Some(Active)` for the
/// non-consumable lifetime product (no `expires_at`) and for subscriptions
/// whose `expires_at` is still in the future. Returns `None` for expired or
/// unparseable subscriptions — App Store rules treat lapsed subscriptions as
/// unentitled, and StoreKit (not our cache) is the source of truth.
#[cfg(feature = "mas")]
fn mas_cached_license(
    stored: &crate::commands::iap::StoredEntitlement,
    now: chrono::DateTime<Utc>,
) -> Option<CachedLicense> {
    match stored.expires_at.as_deref() {
        None => Some(CachedLicense::Active),
        Some(expiry) => match chrono::DateTime::parse_from_rfc3339(expiry) {
            Ok(exp) if exp.with_timezone(&Utc) > now => Some(CachedLicense::Active),
            _ => None,
        },
    }
}

/// Read the cached license signal from the appropriate keychain entry for
/// the current build flavour.
#[cfg(not(feature = "mas"))]
fn current_cached_license(now: chrono::DateTime<Utc>) -> Option<CachedLicense> {
    read_stored_license().map(|stored| direct_cached_license(&stored, now))
}

#[cfg(feature = "mas")]
fn current_cached_license(now: chrono::DateTime<Utc>) -> Option<CachedLicense> {
    crate::commands::iap::read_stored_entitlement()
        .and_then(|stored| mas_cached_license(&stored, now))
}

// ---------------------------------------------------------------------------
// Status computation
// ---------------------------------------------------------------------------

/// Pure status computation — no I/O; accepts all inputs as parameters.
fn compute_status_pure(
    cached: Option<CachedLicense>,
    prefs: &UserPrefs,
    banner_dismissed: bool,
    now: chrono::DateTime<Utc>,
) -> LicenseStatus {
    if let Some(cached) = cached {
        match cached {
            CachedLicense::Active => {
                return LicenseStatus {
                    tier: LicenseTier::Commercial,
                    banner_visible: false,
                    grace_period_ends: None,
                    show_usage_dialog: false,
                    revalidation_required: false,
                };
            }
            #[cfg(not(feature = "mas"))]
            CachedLicense::Stale => {
                return LicenseStatus {
                    tier: LicenseTier::Unlicensed,
                    banner_visible: false,
                    grace_period_ends: None,
                    show_usage_dialog: false,
                    revalidation_required: true,
                };
            }
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
fn compute_status(app: &AppHandle, banner_dismissed: bool) -> LicenseStatus {
    let prefs = load_prefs(app);
    let now = Utc::now();
    let cached = current_cached_license(now);
    compute_status_pure(cached, &prefs, banner_dismissed, now)
}

// ---------------------------------------------------------------------------
// Error message helpers (Direct build only)
// ---------------------------------------------------------------------------

#[cfg(not(feature = "mas"))]
fn dodo_error_message(error: &DodoError) -> String {
    match error {
        DodoError::InvalidFormat => {
            "Invalid license key format — check for typos".to_string()
        }
        DodoError::NetworkOrServer => {
            "Could not reach the license server — check your connection and try again".to_string()
        }
    }
}

#[cfg(not(feature = "mas"))]
fn dodo_invalid_key_message() -> &'static str {
    "License key is not valid or has expired — check your subscription in the customer portal"
}

// ---------------------------------------------------------------------------
// Background re-validation (Direct build only)
// ---------------------------------------------------------------------------

/// Re-validates the stored license key against Dodo if it is older than 24 hours.
/// Called on launch and then every 24 hours by the background task in lib.rs.
#[cfg(not(feature = "mas"))]
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

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_license_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LicenseStatus, String> {
    // Best-effort cleanup of legacy file-based license key
    let legacy_path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("license.key"));
    if let Some(path) = legacy_path {
        if path.exists() {
            std::fs::remove_file(&path).ok();
        }
    }

    let dismissed = *state.banner_dismissed.lock().await;
    Ok(compute_status(&app, dismissed))
}

#[cfg(not(feature = "mas"))]
#[tauri::command]
pub async fn activate_license(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
) -> Result<LicenseStatus, String> {
    match call_dodo_validate(key.trim()).await {
        Ok(true) => {
            let stored = StoredLicense {
                license_key: key.trim().to_string(),
                validated_at: Utc::now().to_rfc3339(),
            };
            write_stored_license(&stored)?;
            let dismissed = *state.banner_dismissed.lock().await;
            Ok(compute_status(&app, dismissed))
        }
        Ok(false) => Err(dodo_invalid_key_message().to_string()),
        Err(ref e) => Err(dodo_error_message(e)),
    }
}

#[cfg(not(feature = "mas"))]
#[tauri::command]
pub async fn deactivate_license(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LicenseStatus, String> {
    clear_stored_license();
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

#[cfg(not(feature = "mas"))]
#[tauri::command]
pub fn open_customer_portal() -> Result<(), String> {
    std::process::Command::new("open")
        .arg(CUSTOMER_PORTAL_URL)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Build flavour identifier exposed to the frontend so a single bundled
/// `index.html` can render the right licensing UI for each binary. Returns:
/// - `"mas"` — Mac App Store build (StoreKit IAP, no Dodo, no updater)
/// - `"direct"` — GitHub Releases / Homebrew build (Dodo Payments, updater)
///
/// The frontend caches this with `staleTime: Infinity` since the value is
/// fixed for the lifetime of the running binary.
#[tauri::command]
pub fn get_build_flavor() -> &'static str {
    if cfg!(feature = "mas") {
        "mas"
    } else {
        "direct"
    }
}

#[tauri::command]
pub async fn get_ui_preferences(app: AppHandle) -> Result<UiPreferences, String> {
    match read_prefs_json(&app) {
        Ok(Some(value)) => Ok(preferences_from_json(&value)),
        Ok(None) => Ok(default_ui_preferences()),
        Err(error) => {
            eprintln!("Failed to parse prefs.json: {error}; using UI preference defaults");
            Ok(default_ui_preferences())
        }
    }
}

#[tauri::command]
pub async fn set_ui_preferences(app: AppHandle, preferences: UiPreferences) -> Result<(), String> {
    let preferences = normalize_ui_preferences(preferences);
    let mut root = match read_prefs_json(&app) {
        Ok(Some(Value::Object(map))) => map,
        Ok(Some(_)) | Ok(None) => Map::new(),
        Err(error) => {
            eprintln!("Failed to parse prefs.json before writing UI preferences: {error}");
            Map::new()
        }
    };

    root.insert(
        "ui".to_string(),
        serde_json::to_value(&preferences.ui).map_err(|e| e.to_string())?,
    );
    root.insert(
        "editor".to_string(),
        serde_json::to_value(&preferences.editor).map_err(|e| e.to_string())?,
    );
    root.insert(
        "uiTheme".to_string(),
        Value::String(preferences.ui.theme.clone()),
    );

    write_json_atomic(&prefs_path(&app), &Value::Object(root))
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

    // -- Status-state transitions (build-agnostic) --

    #[test]
    fn cached_active_is_commercial_no_banner() {
        let now = Utc::now();
        let status =
            compute_status_pure(Some(CachedLicense::Active), &base_prefs(), false, now);
        assert_eq!(status.tier, LicenseTier::Commercial);
        assert!(!status.banner_visible);
        assert!(!status.revalidation_required);
        assert!(status.grace_period_ends.is_none());
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
    fn no_cached_license_no_commercial_detection_is_unlicensed_no_banner() {
        let now = Utc::now();
        let status = compute_status_pure(None, &base_prefs(), false, now);
        assert_eq!(status.tier, LicenseTier::Unlicensed);
        assert!(!status.banner_visible);
        assert!(!status.revalidation_required);
    }

    #[cfg(not(feature = "mas"))]
    #[test]
    fn build_flavor_reports_direct_when_mas_feature_off() {
        assert_eq!(get_build_flavor(), "direct");
    }

    #[cfg(feature = "mas")]
    #[test]
    fn build_flavor_reports_mas_when_mas_feature_on() {
        assert_eq!(get_build_flavor(), "mas");
    }

    // -- Direct-only: Dodo cache mapping + error messages --

    #[cfg(not(feature = "mas"))]
    mod direct {
        use super::*;

        fn stored(validated_at: chrono::DateTime<Utc>) -> StoredLicense {
            StoredLicense {
                license_key: "test-key".to_string(),
                validated_at: validated_at.to_rfc3339(),
            }
        }

        #[test]
        fn freshly_validated_key_maps_to_active() {
            let now = Utc::now();
            let cached = direct_cached_license(&stored(now - Duration::hours(1)), now);
            assert_eq!(cached, CachedLicense::Active);
        }

        #[test]
        fn key_validated_13_days_ago_still_active() {
            let now = Utc::now();
            let cached = direct_cached_license(&stored(now - Duration::days(13)), now);
            assert_eq!(cached, CachedLicense::Active);
        }

        #[test]
        fn key_validated_over_14_days_ago_is_stale() {
            let now = Utc::now();
            let cached = direct_cached_license(&stored(now - Duration::days(15)), now);
            assert_eq!(cached, CachedLicense::Stale);
        }

        #[test]
        fn unparseable_validated_at_is_stale() {
            let stored = StoredLicense {
                license_key: "test-key".to_string(),
                validated_at: "garbage".to_string(),
            };
            assert_eq!(
                direct_cached_license(&stored, Utc::now()),
                CachedLicense::Stale
            );
        }

        #[test]
        fn cached_stale_maps_to_revalidation_required() {
            let now = Utc::now();
            let status =
                compute_status_pure(Some(CachedLicense::Stale), &base_prefs(), false, now);
            assert_eq!(status.tier, LicenseTier::Unlicensed);
            assert!(status.revalidation_required);
            assert!(!status.banner_visible);
        }

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

    // -- MAS-only: StoreKit entitlement mapping --

    #[cfg(feature = "mas")]
    mod mas {
        use super::*;
        use crate::commands::iap::StoredEntitlement;

        #[test]
        fn lifetime_entitlement_with_no_expiry_is_active() {
            let now = Utc::now();
            let stored = StoredEntitlement {
                product_id: "app.esploro.personal.lifetime".to_string(),
                expires_at: None,
            };
            assert_eq!(mas_cached_license(&stored, now), Some(CachedLicense::Active));
        }

        #[test]
        fn subscription_future_expiry_is_active() {
            let now = Utc::now();
            let stored = StoredEntitlement {
                product_id: "app.esploro.business.annual".to_string(),
                expires_at: Some((now + Duration::days(30)).to_rfc3339()),
            };
            assert_eq!(mas_cached_license(&stored, now), Some(CachedLicense::Active));
        }

        #[test]
        fn subscription_past_expiry_is_none() {
            let now = Utc::now();
            let stored = StoredEntitlement {
                product_id: "app.esploro.personal.annual".to_string(),
                expires_at: Some((now - Duration::days(1)).to_rfc3339()),
            };
            assert_eq!(mas_cached_license(&stored, now), None);
        }

        #[test]
        fn subscription_unparseable_expiry_is_none() {
            let now = Utc::now();
            let stored = StoredEntitlement {
                product_id: "app.esploro.personal.annual".to_string(),
                expires_at: Some("not-a-date".to_string()),
            };
            assert_eq!(mas_cached_license(&stored, now), None);
        }
    }
}
