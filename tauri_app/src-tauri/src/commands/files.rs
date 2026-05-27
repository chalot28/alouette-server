use crate::state::log_to_app_file;
use base64::{Engine as _, engine::general_purpose};
use std::fs;
use std::path::Path;

#[derive(serde::Serialize, Clone)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
}

#[tauri::command]
pub fn get_project_files(dir_path: Option<String>) -> Result<Vec<FileNode>, String> {
    let path_str = dir_path.unwrap_or_else(|| {
        std::env::current_dir()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    });

    get_directory_contents(path_str)
}

#[tauri::command]
pub async fn read_file_content(path: String) -> Result<String, String> {
    log_to_app_file(&format!("Reading file: {}", path));
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;

    if bytes.len() > 10 * 1024 * 1024 {
        return Err("File quá lớn để mở trong trình soạn thảo. Vui lòng sử dụng terminal.".to_string());
    }

    Ok(general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub async fn write_file_content(path: String, content: String) -> Result<(), String> {
    log_to_app_file(&format!("Writing file: {}", path));
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_file(path: String) -> Result<(), String> {
    log_to_app_file(&format!("Creating file: {}", path));
    let path = Path::new(&path);
    if path.exists() {
        return Err("File already exists".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, "").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn create_folder(path: String) -> Result<(), String> {
    log_to_app_file(&format!("Creating folder: {}", path));
    let path = Path::new(&path);
    if path.exists() {
        return Err("Folder already exists".to_string());
    }
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_directory_contents(dir_path: String) -> Result<Vec<FileNode>, String> {
    let path = Path::new(&dir_path);
    if !path.exists() {
        return Err("Directory does not exist".to_string());
    }

    let mut entries = Vec::new();
    let read_entries = fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry_result in read_entries {
        if let Ok(entry) = entry_result {
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if name == ".git" {
                continue;
            }

            let is_dir = entry_path.is_dir();
            entries.push(FileNode {
                name,
                path: entry_path.to_string_lossy().to_string(),
                is_dir,
                children: None,
            });
        }
    }

    entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(entries)
}


