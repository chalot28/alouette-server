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

    let path = Path::new(&path_str);
    if !path.exists() {
        return Err("Directory does not exist".to_string());
    }

    read_dir_recursive(path, 0)
}

#[tauri::command]
pub async fn read_file_content(path: String) -> Result<String, String> {
    log_to_app_file(&format!("Reading file: {}", path));
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;

    // Tăng giới hạn lên 10MB vì Base64 xử lý rất tốt dữ liệu lớn
    if bytes.len() > 10 * 1024 * 1024 {
        return Err("File quá lớn để mở trong trình soạn thảo. Vui lòng sử dụng terminal.".to_string());
    }

    // Chuyển sang Base64 để truyền tải qua IPC cực nhanh và an toàn
    Ok(general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub async fn write_file_content(path: String, content: String) -> Result<(), String> {
    log_to_app_file(&format!("Writing file: {}", path));
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

pub fn read_dir_recursive(path: &Path, depth: usize) -> Result<Vec<FileNode>, String> {
    if depth > 4 {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let read_entries = fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry_result in read_entries {
        if let Ok(entry) = entry_result {
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if name == ".git" || name == "node_modules" || name == "target" || name == "gen" {
                continue;
            }

            let is_dir = entry_path.is_dir();
            let children = if is_dir {
                Some(read_dir_recursive(&entry_path, depth + 1)?)
            } else {
                None
            };

            entries.push(FileNode {
                name,
                path: entry_path.to_string_lossy().to_string(),
                is_dir,
                children,
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
