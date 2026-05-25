use core_engine::AppSettings;
use std::path::PathBuf;

/// Resolve the settings.json path (app_data dir next to the binary).
fn settings_path() -> PathBuf {
    let data_dir = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("app_data");
    data_dir.join("settings.json")
}

#[tauri::command]
pub fn get_settings() -> Result<AppSettings, String> {
    let path = settings_path();
    AppSettings::load_from_file(&path)
}

#[tauri::command]
pub fn save_settings(settings: AppSettings) -> Result<(), String> {
    let path = settings_path();
    settings.save_to_file(&path)
}

#[tauri::command]
pub fn reset_settings() -> Result<AppSettings, String> {
    let defaults = AppSettings::default();
    let path = settings_path();
    defaults.save_to_file(&path)?;
    Ok(defaults)
}
