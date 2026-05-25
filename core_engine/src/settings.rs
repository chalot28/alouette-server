use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Global application settings persisted as JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    // ── General ──
    pub theme: String, // "dark" | "light"
    pub language: String,

    // ── Logs ──
    pub max_log_lines: u32,
    pub auto_scroll: bool,
    pub active_log_filter: String,

    // ── Performance ──
    pub max_history_points: u32,
    pub max_term_output_length: u32,
    pub monitor_interval_ms: u64,

    // ── Appearance ──
    pub font_size: u32,
    pub default_left_sidebar_width: u32,
    pub default_right_sidebar_width: u32,
    pub default_tab_list_height: u32,
    pub default_monitor_height: u32,
    pub default_config_height: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            language: "en".to_string(),
            max_log_lines: 2000,
            auto_scroll: true,
            active_log_filter: "all".to_string(),
            max_history_points: 30,
            max_term_output_length: 100000,
            monitor_interval_ms: 2000,
            font_size: 13,
            default_left_sidebar_width: 220,
            default_right_sidebar_width: 320,
            default_tab_list_height: 250,
            default_monitor_height: 250,
            default_config_height: 300,
        }
    }
}

impl AppSettings {
    /// Load settings from a JSON file. Returns defaults if file doesn't exist.
    pub fn load_from_file<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        if !path.as_ref().exists() {
            return Ok(AppSettings::default());
        }
        let content =
            fs::read_to_string(path).map_err(|e| format!("Failed to read settings file: {}", e))?;
        let settings: AppSettings =
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse settings: {}", e))?;
        Ok(settings)
    }

    /// Save settings to a JSON file.
    pub fn save_to_file<P: AsRef<Path>>(&self, path: P) -> Result<(), String> {
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
        if let Some(parent) = path.as_ref().parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directories: {}", e))?;
        }
        fs::write(path, content)
            .map_err(|e| format!("Failed to write settings file: {}", e))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let settings = AppSettings::default();
        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.max_log_lines, 2000);
        assert_eq!(settings.monitor_interval_ms, 2000);
    }

    #[test]
    fn test_save_and_load() {
        let temp = std::env::temp_dir().join("alouette_test_settings.json");
        let settings = AppSettings::default();
        assert!(settings.save_to_file(&temp).is_ok());
        let loaded = AppSettings::load_from_file(&temp).unwrap();
        assert_eq!(loaded.theme, settings.theme);
        assert_eq!(loaded.max_log_lines, settings.max_log_lines);
        let _ = std::fs::remove_file(&temp);
    }

    #[test]
    fn test_load_non_existent() {
        let path = Path::new("non_existent_settings_xyz.json");
        let loaded = AppSettings::load_from_file(path).unwrap();
        assert_eq!(loaded.theme, "dark");
    }
}
