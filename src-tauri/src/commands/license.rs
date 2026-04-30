use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
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

const DEFAULT_UI_THEME: &str = "tairiki-light";
const DEFAULT_UI_FONT_FAMILY: &str =
    "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Helvetica Neue\", sans-serif";
const DEFAULT_UI_FONT_SIZE: u8 = 13;
const DEFAULT_EDITOR_FONT_FAMILY: &str =
    "ui-monospace, \"SF Mono\", Menlo, Monaco, \"Courier New\", monospace";
const DEFAULT_EDITOR_FONT_SIZE: u8 = 13;
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
}

impl Default for UiGridConfig {
    fn default() -> Self {
        UiGridConfig {
            row_density: default_grid_row_density(),
            page_size: default_grid_page_size(),
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
        "tairiki-light" | "tairiki-dark" | "system" | "macos-light" | "macos-dark" => {
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

    let mut mac = HmacSha256::new_from_slice(SIGNING_KEY).expect("HMAC accepts any key length");
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
                    chrono::DateTime::parse_from_rfc3339(e)
                        .ok()
                        .map(|exp| (exp.with_timezone(&Utc) - Utc::now()).num_days())
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
            let grace_end = detected.with_timezone(&Utc) + chrono::Duration::days(14);
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
