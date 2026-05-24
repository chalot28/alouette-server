use crate::state::{AppState, log_to_app_file};
use core_engine::{ProcessLog, ProcessState, ProjectConfig};
use tauri::State;

#[tauri::command]
pub async fn start_project_process(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<(), String> {
    log_to_app_file(&format!("Tauri command received: start_project_process for project_id: {}", project_id));
    let mut pm = state.process_manager.lock().await;
    match pm.start_process(&project_id).await {
        Ok(_) => {
            log_to_app_file(&format!("Process successfully started for project_id: {}", project_id));
            Ok(())
        }
        Err(e) => {
            log_to_app_file(&format!("Failed to start process for project_id: {}. Error: {}", project_id, e));
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn stop_project_process(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<(), String> {
    log_to_app_file(&format!("Tauri command received: stop_project_process for project_id: {}", project_id));
    let mut pm = state.process_manager.lock().await;
    match pm.stop_process(&project_id).await {
        Ok(_) => {
            log_to_app_file(&format!("Process successfully stopped for project_id: {}", project_id));
            Ok(())
        }
        Err(e) => {
            log_to_app_file(&format!("Failed to stop process for project_id: {}. Error: {}", project_id, e));
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn get_projects(state: State<'_, AppState>) -> Result<Vec<ProjectConfig>, String> {
    let pm = state.process_manager.lock().await;
    Ok(pm.get_configs())
}

#[tauri::command]
pub async fn get_project_logs(
    state: State<'_, AppState>,
    project_id: String,
    limit: Option<usize>,
) -> Result<Vec<ProcessLog>, String> {
    let pm = state.process_manager.lock().await;
    let limit_val = limit.unwrap_or(1000);
    let db = pm.db_manager.clone();

    let logs = tokio::task::spawn_blocking(move || {
        db.get_logs(&project_id, limit_val)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    Ok(logs)
}


#[tauri::command]
pub async fn get_project_state(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Option<ProcessState>, String> {
    let pm = state.process_manager.lock().await;
    Ok(pm.get_state(&project_id))
}

#[tauri::command]
pub async fn register_project(
    state: State<'_, AppState>,
    config: ProjectConfig,
) -> Result<(), String> {
    let mut pm = state.process_manager.lock().await;
    pm.register_project(config).await?;
    Ok(())
}

#[tauri::command]
pub async fn deregister_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<(), String> {
    let mut pm = state.process_manager.lock().await;
    pm.deregister_project(&project_id).await?;
    Ok(())
}
