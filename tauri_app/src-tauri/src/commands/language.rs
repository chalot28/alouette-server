use crate::state::AppState;
use core_engine::{LanguageRuntime, LanguageTool};
use std::collections::HashSet;
use tauri::State;

/// Default known languages supported by Proto
const PROTO_KNOWN_LANGUAGES: &[(&str, &str, &[(&str, &str)])] = &[
    ("node", "Node.js", &[("npm", "npm install -g"), ("npx", "")]),
    ("python", "Python", &[("pip", ""), ("pip3", "")]),
    ("go", "Go", &[]),
];

#[tauri::command]
pub async fn get_language_runtimes(
    state: State<'_, AppState>,
) -> Result<Vec<LanguageRuntime>, String> {
    let pm = state.process_manager.lock().await;
    let db = &pm.db_manager;

    let mut runtimes = db.load_all_language_runtimes()?;
    let existing_ids: HashSet<String> =
        runtimes.iter().map(|r| r.id.to_lowercase()).collect();

    // 1. Scan Proto installed tools (file system)
    let proto_installed = pm.proto_manager.list_installed_tools();
    let installed_set: HashSet<String> =
        proto_installed.iter().map(|t| t.to_lowercase()).collect();

    // 2. Add known languages not yet in DB
    for (id, display_name, pkg_managers) in PROTO_KNOWN_LANGUAGES {
        if existing_ids.contains(*id) {
            continue;
        }

        let is_installed = installed_set.contains(*id);
        let tools: Vec<LanguageTool> = pkg_managers
            .iter()
            .map(|(name, cmd)| LanguageTool {
                name: name.to_string(),
                command: cmd.to_string(),
                version: "latest".into(),
            })
            .collect();

        let default = LanguageRuntime {
            id: id.to_string(),
            name: display_name.to_string(),
            install_command: format!("proto install {}", id),
            versions: if is_installed {
                vec!["latest (installed)".to_string()]
            } else {
                vec!["latest".to_string()]
            },
            tools,
        };
        let _ = db.save_language_runtime(&default);
        runtimes.push(default);
    }

    // 3. Also add any filesystem-installed tools that aren't in known list
    for tool in &proto_installed {
        if !existing_ids.contains(&tool.to_lowercase())
            && !PROTO_KNOWN_LANGUAGES.iter().any(|(id, _, _)| *id == tool)
        {
            let default = LanguageRuntime {
                id: tool.clone(),
                name: tool.clone(),
                install_command: format!("proto install {}", tool),
                versions: vec!["latest (installed)".to_string()],
                tools: Vec::new(),
            };
            let _ = db.save_language_runtime(&default);
            runtimes.push(default);
        }
    }

    Ok(runtimes)
}

#[tauri::command]
pub async fn save_language_runtime(
    state: State<'_, AppState>,
    runtime: LanguageRuntime,
) -> Result<(), String> {
    let pm = state.process_manager.lock().await;
    let db = &pm.db_manager;
    db.save_language_runtime(&runtime)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_language_runtime(
    state: State<'_, AppState>,
    runtime_id: String,
) -> Result<(), String> {
    let pm = state.process_manager.lock().await;
    let db = &pm.db_manager;
    db.delete_language_runtime(&runtime_id)?;
    Ok(())
}

#[tauri::command]
pub async fn install_proto_tool(
    state: State<'_, AppState>,
    tool_name: String,
    version: String,
) -> Result<(), String> {
    let pm = state.process_manager.lock().await;
    let app_data_dir = std::env::current_dir().unwrap_or_default().join("app_data");
    let bin_dir = app_data_dir.join("bin");
    let proto_exe_name = if cfg!(target_os = "windows") { "proto.exe" } else { "proto" };
    let proto_bin = bin_dir.join(proto_exe_name);

    if !proto_bin.exists() {
        return Err("Proto CLI binary is not installed yet".to_string());
    }

    pm.proto_manager.install_tool(&proto_bin, &tool_name, &version).await?;
    Ok(())
}
