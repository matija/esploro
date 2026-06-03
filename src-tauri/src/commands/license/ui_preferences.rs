use serde::{Deserialize, Serialize};
use serde_json::Value;

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

fn default_show_total_count() -> bool {
    true
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

impl Default for UiGridConfig {
    fn default() -> Self {
        UiGridConfig {
            row_density: default_grid_row_density(),
            page_size: default_grid_page_size(),
            show_total_count: default_show_total_count(),
        }
    }
}

pub(super) fn default_ui_preferences() -> UiPreferences {
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
        "tairiki-light"
        | "tairiki-dark"
        | "system"
        | "macos-light"
        | "macos-dark"
        | "tokyo-night"
        | "tokyo-night-day"
        | "github-dark"
        | "github-light"
        | "catppuccin-mocha"
        | "catppuccin-macchiato"
        | "catppuccin-frappe"
        | "catppuccin-latte"
        | "rose-pine"
        | "rose-pine-moon"
        | "rose-pine-dawn" => theme.to_string(),
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

pub(super) fn normalize_ui_preferences(preferences: UiPreferences) -> UiPreferences {
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

pub(super) fn preferences_from_json(root: &Value) -> UiPreferences {
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn legacy_theme_values_are_normalized() {
        let prefs = preferences_from_json(&json!({
            "uiTheme": "dark",
        }));

        assert_eq!(prefs.ui.theme, "tairiki-dark");
    }

    #[test]
    fn invalid_preference_values_fall_back_to_defaults() {
        let prefs = preferences_from_json(&json!({
            "ui": {
                "theme": "unknown-theme",
                "fontFamily": "",
                "fontSize": 99
            },
            "editor": {
                "fontFamily": "",
                "fontSize": 10,
                "lineHeight": 2.0,
                "tabSize": 3,
                "wordWrap": true
            },
            "grid": {
                "rowDensity": "loose",
                "pageSize": 123,
                "showTotalCount": false
            }
        }));

        assert_eq!(prefs.ui.theme, DEFAULT_UI_THEME);
        assert_eq!(prefs.ui.font_family, DEFAULT_UI_FONT_FAMILY);
        assert_eq!(prefs.ui.font_size, DEFAULT_UI_FONT_SIZE);
        assert_eq!(prefs.editor.font_family, DEFAULT_EDITOR_FONT_FAMILY);
        assert_eq!(prefs.editor.font_size, DEFAULT_EDITOR_FONT_SIZE);
        assert_eq!(prefs.editor.line_height, DEFAULT_EDITOR_LINE_HEIGHT);
        assert_eq!(prefs.editor.tab_size, default_editor_tab_size());
        assert!(prefs.editor.word_wrap);
        assert_eq!(prefs.grid.row_density, default_grid_row_density());
        assert_eq!(prefs.grid.page_size, default_grid_page_size());
        assert!(!prefs.grid.show_total_count);
    }
}
