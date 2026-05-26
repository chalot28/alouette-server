use std::path::PathBuf;
use std::process::Stdio;
use tauri::AppHandle;
use tauri::Manager;

/// Tìm Zen Browser executable.
/// Ưu tiên:
///   1. Resource bundle (production - được đóng gói theo app từ tauri.conf.json)
///   2. zen_bundle/ (development - ngay cạnh src-tauri/)
fn find_zen_exe(app_handle: &AppHandle) -> Option<PathBuf> {
    // 1. Production: resource bundle (resources/zen_browser/)
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let candidates = [
            resource_dir.join("zen_browser").join("zen").join("core").join("zen.exe"),
            resource_dir.join("zen_browser").join("zen").join("zen.exe"),
            resource_dir.join("zen_browser").join("core").join("zen.exe"),
            resource_dir.join("zen_browser").join("zen.exe"),
        ];
        for p in &candidates {
            if p.exists() {
                return Some(p.clone());
            }
        }
    }

    // 2. Development: tauri_app/zen_bundle/
    let dev_base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("zen_bundle"))?;
    let candidates = [
        dev_base.join("zen").join("core").join("zen.exe"),
        dev_base.join("zen").join("zen.exe"),
        dev_base.join("zen.exe"),
    ];
    for p in &candidates {
        if p.exists() {
            return Some(p.clone());
        }
    }

    // 3. System installed Zen Browser (Windows defaults)
    #[cfg(target_os = "windows")]
    {
        let mut system_candidates = Vec::new();
        
        if let Ok(pf) = std::env::var("ProgramFiles") {
            let path = PathBuf::from(pf);
            system_candidates.push(path.join("Zen Browser").join("zen.exe"));
            system_candidates.push(path.join("Zen").join("zen.exe"));
        }
        
        if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
            let path = PathBuf::from(pf86);
            system_candidates.push(path.join("Zen Browser").join("zen.exe"));
            system_candidates.push(path.join("Zen").join("zen.exe"));
        }

        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            let path = PathBuf::from(local_appdata);
            system_candidates.push(path.join("Programs").join("zen").join("zen.exe"));
            system_candidates.push(path.join("Programs").join("Zen").join("zen.exe"));
            system_candidates.push(path.join("Programs").join("Zen Browser").join("zen.exe"));
        }

        for p in &system_candidates {
            if p.exists() {
                return Some(p.clone());
            }
        }
    }

    None
}

/// Mở Zen Browser.
/// Zen Browser được đóng gói sẵn theo app (zen_bundle/),
/// launch trực tiếp, không cần cài đặt gì thêm.
#[tauri::command]
pub async fn open_browser_window(app_handle: AppHandle) -> Result<(), String> {
    let exe_path = find_zen_exe(&app_handle).ok_or_else(|| {
        format!(
            "⚠️  Không tìm thấy Zen Browser trong app.\n\
             \n\
             Cách cài: Tải Zen Browser portable (Windows ZIP) tại:\n\
             https://zen-browser.app/download/\n\
             \n\
             Giải nén và copy thư mục 'zen' vào:\n\
             {}/zen_bundle/\n\
             \n\
             Sau đó build lại app hoặc chạy lại.",
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "tauri_app".to_string())
        )
    })?;

    println!("[Zen Browser] Launch: {:?}", exe_path);

    let _child = std::process::Command::new(&exe_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Không thể launch Zen Browser: {}", e))?;

    Ok(())
}
