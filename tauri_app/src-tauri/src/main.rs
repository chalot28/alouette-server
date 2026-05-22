// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use core_engine::{ProcessManager, ProcessState, ProjectConfig, ResourceMonitor};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex;

struct AppState {
    process_manager: Arc<Mutex<ProcessManager>>,
    resource_monitor: Arc<ResourceMonitor>,
}

#[tauri::command]
async fn start_project_process(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<(), String> {
    let mut pm = state.process_manager.lock().await;
    pm.start_process(&project_id).await?;
    Ok(())
}

#[tauri::command]
async fn stop_project_process(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<(), String> {
    let mut pm = state.process_manager.lock().await;
    pm.stop_process(&project_id).await?;
    Ok(())
}

#[tauri::command]
async fn get_projects(state: State<'_, AppState>) -> Result<Vec<ProjectConfig>, String> {
    let pm = state.process_manager.lock().await;
    Ok(pm.get_configs())
}

#[tauri::command]
async fn get_project_state(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Option<ProcessState>, String> {
    let pm = state.process_manager.lock().await;
    Ok(pm.get_state(&project_id))
}

#[tauri::command]
async fn register_project(
    state: State<'_, AppState>,
    config: ProjectConfig,
) -> Result<(), String> {
    let mut pm = state.process_manager.lock().await;
    pm.register_project(config);
    Ok(())
}

#[tauri::command]
async fn deregister_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<(), String> {
    let mut pm = state.process_manager.lock().await;
    pm.deregister_project(&project_id).await?;
    Ok(())
}

#[tauri::command]
async fn check_port_status(port: u16) -> Option<u32> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("netstat")
            .args(&["-ano", "-p", "tcp"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let port_suffix_colon = format!(":{}", port);
            
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 5 {
                    let local_addr = parts[1];
                    let state = parts[3];
                    let pid_str = parts[4];
                    
                    if (local_addr.ends_with(&port_suffix_colon) || local_addr.ends_with(&format!("]{}", port_suffix_colon)))
                        && state == "LISTENING"
                    {
                        if let Ok(pid) = pid_str.parse::<u32>() {
                            if pid > 0 {
                                return Some(pid);
                            }
                        }
                    }
                }
            }
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("lsof")
            .args(&["-t", &format!("-i:{}", port)])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(first_line) = stdout.lines().next() {
                if let Ok(pid) = first_line.trim().parse::<u32>() {
                    return Some(pid);
                }
            }
        }
    }

    None
}

#[tauri::command]
async fn force_kill_process(pid: u32) -> Result<(), String> {
    core_engine::terminate_process_tree(pid).await;
    Ok(())
}

fn main() {
    let log_dir = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("logs");
    let mut pm = ProcessManager::new(&log_dir);

    // Pre-populate a standard System Connection diagnostics task for ease of testing
    pm.register_project(ProjectConfig {
        id: "sys-ping".to_string(),
        name: "Local Connection diagnostics".to_string(),
        command: "ping".to_string(),
        args: vec!["127.0.0.1".to_string(), "-n".to_string(), "20".to_string()],
        cwd: None,
        setup_command: None,
        setup_args: None,
        auto_restart: Some(false),
        env: None,
        max_cpu_percent: None,
        max_ram_mb: None,
        port: None,
    });

    let process_manager = Arc::new(Mutex::new(pm));
    let resource_monitor = Arc::new(ResourceMonitor::new());

    let pm_clone = process_manager.clone();
    let rm_clone = resource_monitor.clone();

    tauri::Builder::default()
        .manage(AppState {
            process_manager,
            resource_monitor,
        })
        .setup(move |app| {
            // Get the main webview window. Standard API in Tauri v2.
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| tauri::Error::WindowNotFound)?;

            // 1. Spawn Log Event Router Task
            let pm_for_logs = pm_clone.clone();
            let window_for_logs = window.clone();
            tauri::async_runtime::spawn(async move {
                let mut log_rx = {
                    let pm_lock = pm_for_logs.lock().await;
                    pm_lock.subscribe_logs()
                };
                while let Ok(log) = log_rx.recv().await {
                    let _ = window_for_logs.emit("process-log", log);
                }
            });

            // 2. Spawn Status Event Router Task
            let pm_for_status = pm_clone.clone();
            let rm_for_status = rm_clone.clone();
            let window_for_status = window.clone();
            tauri::async_runtime::spawn(async move {
                let mut status_rx = {
                    let pm_lock = pm_for_status.lock().await;
                    pm_lock.subscribe_status()
                };
                while let Ok((project_id, state)) = status_rx.recv().await {
                    // Update state inside ProcessManager
                    {
                        let mut pm = pm_for_status.lock().await;
                        if let Some(inst) = pm.instances.get_mut(&project_id) {
                            inst.state = state.clone();
                        }
                    }

                    // Manage registration in ResourceMonitor
                    match state {
                        ProcessState::Running { pid } => {
                            rm_for_status.register(project_id.clone(), pid);
                        }
                        ProcessState::Stopped | ProcessState::Fatal { .. } | ProcessState::Terminated => {
                            rm_for_status.deregister(project_id.clone());
                        }
                        _ => {}
                    }

                    #[derive(Clone, serde::Serialize)]
                    struct StatusPayload {
                        project_id: String,
                        state: ProcessState,
                    }
                    let _ = window_for_status.emit(
                        "process-status",
                        StatusPayload {
                            project_id,
                            state,
                        },
                    );
                }
            });

            // 3. Spawn Resource Stats Router Task with Watchdog enforcement
            let rm_for_stats = rm_clone.clone();
            let pm_for_watchdog = pm_clone.clone();
            let window_for_stats = window.clone();
            tauri::async_runtime::spawn(async move {
                let mut stats_rx = rm_for_stats.subscribe();
                let mut exceeded_since: std::collections::HashMap<String, std::time::Instant> = std::collections::HashMap::new();

                while let Ok(stats) = stats_rx.recv().await {
                    // Always broadcast stats to frontend
                    let _ = window_for_stats.emit("resource-update", stats.clone());

                    // Read thresholds from project config
                    let limits = {
                        let pm = pm_for_watchdog.lock().await;
                        pm.get_config(&stats.project_id)
                    };

                    if let Some(config) = limits {
                        let cpu_limit = config.max_cpu_percent;
                        let ram_limit_mb = config.max_ram_mb;

                        let cpu_exceeded = cpu_limit.map(|limit| stats.cpu_percentage > limit as f32).unwrap_or(false);
                        let ram_exceeded = ram_limit_mb.map(|limit| stats.ram_bytes > limit * 1024 * 1024).unwrap_or(false);

                        if cpu_exceeded || ram_exceeded {
                            let entry_time = *exceeded_since.entry(stats.project_id.clone()).or_insert_with(std::time::Instant::now);
                            if entry_time.elapsed() >= std::time::Duration::from_secs(30) {
                                // Breach persisted for 30s -> Force kill & fatal state
                                let mut pm = pm_for_watchdog.lock().await;
                                let reason = if cpu_exceeded && ram_exceeded {
                                    format!("CPU limit ({}%) and RAM limit ({}MB) exceeded continuously for 30 seconds", cpu_limit.unwrap(), ram_limit_mb.unwrap())
                                } else if cpu_exceeded {
                                    format!("CPU limit ({}%) exceeded continuously for 30 seconds", cpu_limit.unwrap())
                                } else {
                                    format!("RAM limit ({}MB) exceeded continuously for 30 seconds", ram_limit_mb.unwrap())
                                };

                                let _ = pm.force_fatal_stop(&stats.project_id, reason).await;
                                exceeded_since.remove(&stats.project_id);
                            }
                        } else {
                            exceeded_since.remove(&stats.project_id);
                        }
                    } else {
                        exceeded_since.remove(&stats.project_id);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_project_process,
            stop_project_process,
            get_projects,
            get_project_state,
            register_project,
            deregister_project,
            check_port_status,
            force_kill_process
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();

                let state = app_handle.state::<AppState>();
                let pm_clone = state.process_manager.clone();
                let rm_clone = state.resource_monitor.clone();
                let app_handle_clone = app_handle.clone();

                tauri::async_runtime::spawn(async move {
                    let mut pids: Vec<(String, u32)> = Vec::new();
                    {
                        let mut pm = pm_clone.lock().await;
                        for (id, inst) in pm.instances.iter_mut() {
                            if let ProcessState::Running { pid } = inst.state {
                                pids.push((id.clone(), pid));
                                if let Some(stop_tx) = inst.stop_sender.take() {
                                    let _ = stop_tx.send(());
                                }
                            }
                        }
                    }

                    for (project_id, pid) in pids {
                        core_engine::terminate_process_tree(pid).await;
                        rm_clone.deregister(project_id);
                    }

                    app_handle_clone.exit(0);
                });
            }
        });
}
