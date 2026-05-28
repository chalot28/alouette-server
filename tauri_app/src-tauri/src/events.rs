use crate::state::log_to_app_file;
use core_engine::ProcessState;
use std::sync::Arc;
use tauri::{Emitter, WebviewWindow};
use tokio::sync::Mutex;

/// Spawn the environment preloader task (proto init, toolchains, cloudflared).
pub fn spawn_environment_init(pm_clone: Arc<Mutex<core_engine::ProcessManager>>) {
    tauri::async_runtime::spawn(async move {
        let init_msg = "Initializing isolated proto toolchains and latest cloudflared tunnel binary in background...";
        println!("{}", init_msg);
        log_to_app_file(init_msg);

        // 1. Brief lock to extract the config paths
        let (proto_home, bin_dir) = {
            let pm = pm_clone.lock().await;
            let app_data_dir = std::env::current_dir().unwrap_or_default().join("app_data");
            let bin_dir = app_data_dir.join("bin");
            (pm.proto_manager.proto_home.clone(), bin_dir)
        };

        // 2. Heavy operations outside the mutex lock
        let proto_manager = core_engine::proto_manager::ProtoManager::new(proto_home);
        let proto_bin = match proto_manager.ensure_proto_cli(&bin_dir).await {
            Ok(bin) => bin,
            Err(e) => {
                let err_msg = format!("ENVIRONMENT INIT ERROR (ensure_proto_cli): {}", e);
                eprintln!("{}", err_msg);
                log_to_app_file(&err_msg);
                return;
            }
        };

        log_to_app_file("Proto CLI verified and active.");

        if let Err(e) = proto_manager.ensure_stable_toolchains(&proto_bin).await {
            let err_msg = format!("ENVIRONMENT INIT ERROR (ensure_stable_toolchains): {}", e);
            eprintln!("{}", err_msg);
            log_to_app_file(&err_msg);
            return;
        }

        log_to_app_file("Toolchains checked / verified stable.");

        let cloudflared_bin = match core_engine::cloudflared_manager::CloudflaredManager::update_tunnel_binary(&bin_dir).await {
            Ok(bin) => bin,
            Err(e) => {
                let err_msg = format!("ENVIRONMENT INIT ERROR (update_tunnel_binary): {}", e);
                eprintln!("{}", err_msg);
                log_to_app_file(&err_msg);
                return;
            }
        };

        log_to_app_file("Cloudflared binary verified / updated successfully.");

        // 3. Lock briefly again to write the computed cloudflared binary path back
        {
            let mut pm = pm_clone.lock().await;
            pm.cloudflared_manager.executable_path = cloudflared_bin;
        }

        let success_msg = "Isolated environment initialized successfully!";
        println!("{}", success_msg);
        log_to_app_file(success_msg);
    });
}

/// Spawn the Log Event Router Task.
pub fn spawn_log_router(pm_clone: Arc<Mutex<core_engine::ProcessManager>>, window: WebviewWindow) {
    tauri::async_runtime::spawn(async move {
        let mut log_rx = {
            let pm_lock = pm_clone.lock().await;
            pm_lock.subscribe_logs()
        };
        while let Ok(log) = log_rx.recv().await {
            let _ = window.emit("process-log", log);
        }
    });
}

/// Spawn the Status Event Router Task.
pub fn spawn_status_router(
    pm_clone: Arc<Mutex<core_engine::ProcessManager>>,
    rm_clone: Arc<core_engine::ResourceMonitor>,
    window: WebviewWindow,
) {
    tauri::async_runtime::spawn(async move {
        let mut status_rx = {
            let pm_lock = pm_clone.lock().await;
            pm_lock.subscribe_status()
        };
        while let Ok((project_id, state)) = status_rx.recv().await {
            // Update state inside ProcessManager
            {
                let mut pm = pm_clone.lock().await;
                if let Some(inst) = pm.instances.get_mut(&project_id) {
                    inst.state = state.clone();
                }
            }

            // Manage registration in ResourceMonitor
            match state {
                ProcessState::Running { pid } => {
                    rm_clone.register(project_id.clone(), pid);
                }
                ProcessState::Stopped | ProcessState::Fatal { .. } | ProcessState::Terminated => {
                    rm_clone.deregister(project_id.clone());
                }
                _ => {}
            }

            #[derive(Clone, serde::Serialize)]
            struct StatusPayload {
                project_id: String,
                state: ProcessState,
            }
            let _ = window.emit(
                "process-status",
                StatusPayload {
                    project_id,
                    state,
                },
            );
        }
    });
}

/// Spawn Resource Stats Router Task with Watchdog enforcement.
pub fn spawn_resource_stats_router(
    rm_clone: Arc<core_engine::ResourceMonitor>,
    pm_clone: Arc<Mutex<core_engine::ProcessManager>>,
    window: WebviewWindow,
) {
    tauri::async_runtime::spawn(async move {
        let mut stats_rx = rm_clone.subscribe();
        let mut exceeded_since: std::collections::HashMap<String, std::time::Instant> = std::collections::HashMap::new();

        while let Ok(stats) = stats_rx.recv().await {
            // Always broadcast stats to frontend
            let _ = window.emit("resource-update", stats.clone());

            // Read thresholds from project config and global settings
            let settings = core_engine::AppSettings::load_from_file(
                std::env::current_dir()
                    .unwrap_or_default()
                    .join("app_data")
                    .join("settings.json")
            ).unwrap_or_default();

            let limits = {
                let pm = pm_clone.lock().await;
                pm.get_config(&stats.project_id)
            };

            let mut cpu_limit = limits.as_ref().and_then(|c| c.max_cpu_percent);
            let mut ram_limit_mb = limits.as_ref().and_then(|c| c.max_ram_mb);

            if settings.enable_limit {
                if cpu_limit.is_none() {
                    cpu_limit = Some(settings.max_cpu_percent);
                }
                if ram_limit_mb.is_none() {
                    ram_limit_mb = Some(settings.max_ram_mb as u64);
                }
            }

            if cpu_limit.is_some() || ram_limit_mb.is_some() {
                let cpu_exceeded = cpu_limit.map(|limit| stats.cpu_percentage > limit as f32).unwrap_or(false);
                let ram_exceeded = ram_limit_mb.map(|limit| stats.ram_bytes > limit * 1024 * 1024).unwrap_or(false);

                if cpu_exceeded || ram_exceeded {
                    let entry_time = *exceeded_since.entry(stats.project_id.clone()).or_insert_with(std::time::Instant::now);
                    if entry_time.elapsed() >= std::time::Duration::from_secs(30) {
                        // Breach persisted for 30s -> Force kill & fatal state
                        let mut pm = pm_clone.lock().await;
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
}

/// Spawn the Terminal Event Router Task.
pub fn spawn_terminal_router(pm_clone: Arc<Mutex<core_engine::ProcessManager>>, window: WebviewWindow) {
    tauri::async_runtime::spawn(async move {
        let mut term_rx = {
            let pm_lock = pm_clone.lock().await;
            pm_lock.subscribe_terminal()
        };
        while let Ok(output) = term_rx.recv().await {
            let _ = window.emit("terminal-output", output);
        }
    });
}
