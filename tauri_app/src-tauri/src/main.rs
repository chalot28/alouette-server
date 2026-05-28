// Prevents additional console window on Windows in release (Trigger recompile: 2026-05-24 11:02)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod events;
mod state;
mod system_manager;
mod alouette_open;

use core_engine::{ProcessManager, ProcessState, ProjectConfig, ResourceMonitor};
use state::AppState;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

fn main() {
    let log_dir = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("logs");
    let mut pm = ProcessManager::new(&log_dir);

    // Pre-populate a standard System Connection diagnostics task for ease of testing
    let _ = tauri::async_runtime::block_on(pm.register_project(ProjectConfig {
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
        source: None,
        terminal_mode: None,
        toolchain: None,
        toolchain_version: None,
        enable_tunnel: None,
        max_log_lines: None,
    }));

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

            // Initialize all isolated system actions (keep alive, run in background, auto restart)
            crate::system_manager::init_system(&window);

            // Initialize System Tray (Tauri v2 API)
            let toggle = tauri::menu::MenuItem::with_id(app, "toggle", "Show/Hide Window", true, None::<&str>)?;
            let quit = tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&toggle, &quit])?;

            let icon = match app.default_window_icon() {
                Some(icon) => icon.clone(),
                None => {
                    tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
                        .expect("failed to load default tray icon")
                }
            };

            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id == "toggle" {
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    } else if event.id == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Spawn SQLite background log persister task inside active Tokio runtime
            let pm_for_persister = pm_clone.clone();
            tauri::async_runtime::spawn(async move {
                let pm = pm_for_persister.lock().await;
                pm.spawn_log_persister();
            });

            // 0. Spawn environment preloader task (non-blocking ngầm)
            events::spawn_environment_init(pm_clone.clone());

            let window_clone = window.clone();

            // 1. Spawn Log Event Router Task
            events::spawn_log_router(pm_clone.clone(), window_clone.clone());

            // 2. Spawn Status Event Router Task
            events::spawn_status_router(pm_clone.clone(), rm_clone.clone(), window_clone.clone());

            // 3. Spawn Resource Stats Router Task with Watchdog enforcement
            events::spawn_resource_stats_router(rm_clone.clone(), pm_clone.clone(), window_clone.clone());

            // 4. Spawn Terminal Event Router Task
            events::spawn_terminal_router(pm_clone.clone(), window_clone.clone());

            // 5. Spawn Alouette Open log monitor task
            alouette_open::spawn_alouette_open_monitor(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::process::start_project_process,
            commands::process::stop_project_process,
            commands::process::get_projects,
            commands::process::get_project_logs,
            commands::process::get_project_state,
            commands::process::register_project,
            commands::process::deregister_project,
            commands::terminal::spawn_terminal_session,
            commands::terminal::write_to_terminal_session,
            commands::terminal::kill_terminal_session,
            commands::terminal::check_terminal_session,
            commands::terminal::resize_terminal_session,
            commands::files::get_project_files,
            commands::files::read_file_content,
            commands::files::write_file_content,
            commands::files::create_file,
            commands::files::create_folder,
            commands::files::get_directory_contents,
            commands::network::check_port_status,
            commands::network::force_kill_process,
            commands::network::open_ping_window,
            commands::network::open_admin_window,
            commands::browser::open_browser_window,
            commands::network::send_http_request,
            commands::network::dns_lookup,
            commands::network::ping_host,
            commands::network::ssl_certificate_info,
            commands::network::validate_json_schema,
            commands::network::json_format_tool,
            commands::network::base64_tool,
            commands::network::generate_curl_command,
            commands::network::http_status_info,
            commands::network::hash_tool,
            commands::network::jwt_decode,
            commands::network::timestamp_convert,
            commands::network::response_diff,
            commands::network::prettify_xml,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::reset_settings,
            commands::settings::hide_or_close_window,
            commands::sqlite::get_sqlite_tables,
            commands::sqlite::get_sqlite_table_data,
            commands::sqlite::update_sqlite_cell,
            commands::sqlite::insert_sqlite_row,
            commands::sqlite::delete_sqlite_row,
            commands::sqlite::add_sqlite_column,
            commands::sandbox::load_sandbox_configs,
            commands::sandbox::save_sandbox_config,
            commands::sandbox::save_all_sandbox_configs,
            commands::sandbox::delete_sandbox_config,
            commands::language::get_language_runtimes,
            commands::language::save_language_runtime,
            commands::language::delete_language_runtime,
            commands::language::install_proto_tool,
            commands::agent::agent_send_message,
            commands::agent::agent_approve_tool,
            commands::agent::agent_reset_session,
            commands::agent::get_custom_ai_config,
            commands::agent::save_custom_ai_config,
            toggle_alouette_open,
            is_alouette_open_active,
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
                    let mut term_pids: Vec<u32> = Vec::new();
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
                        for (_, session) in pm.terminal_sessions.iter() {
                            term_pids.push(session.pid);
                        }
                    }

                    for (project_id, pid) in pids {
                        core_engine::terminate_process_tree(pid).await;
                        rm_clone.deregister(project_id);
                    }

                    for pid in term_pids {
                        core_engine::terminate_process_tree(pid).await;
                    }

                    app_handle_clone.exit(0);
                });
            }
        });
}

#[tauri::command]
fn toggle_alouette_open(enabled: bool) {
    alouette_open::set_alouette_open_enabled(enabled);
}

#[tauri::command]
fn is_alouette_open_active() -> bool {
    alouette_open::is_alouette_open_enabled()
}
