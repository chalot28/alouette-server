use chrono::Utc;
use tokio::sync::oneshot;

use super::models::{ProcessState, ProcessLog};
use super::manager::ProcessManager;
use super::logging::{append_log_line, pipe_stream};
use super::tree::{StateUpdater, terminate_process_tree};

impl ProcessManager {
    /// Starts a project lifecycle: running setup if configured, followed by the main command.
    pub async fn start_process(&mut self, project_id: &str) -> Result<(), String> {
        let inst = self.instances.get_mut(project_id)
            .ok_or_else(|| format!("Project '{}' not found", project_id))?;

        if let ProcessState::Running { .. } | ProcessState::Setup = inst.state {
            return Err("Process is already running or in setup".to_string());
        }

        let mut config = inst.config.clone();

        // 1. Prepare Workspace (Clone or Copy) if CWD does not exist yet (fallback)
        if let Some(ref source) = config.source {
            if !source.is_empty() {
                let dest = self.workspace_manager.workspaces_dir.join(project_id);
                if !dest.exists() {
                    let dest = self.workspace_manager.prepare_workspace(project_id, source).await?;
                    config.cwd = Some(dest.to_string_lossy().to_string());
                } else {
                    config.cwd = Some(dest.to_string_lossy().to_string());
                }
            }
        }

        // Update local config in instance since cwd might have changed
        inst.config = config.clone();

        let (stop_sender, stop_receiver) = oneshot::channel::<()>();
        inst.stop_sender = Some(stop_sender);

        let log_sender = self.log_sender.clone();
        let status_sender = self.status_sender.clone();
        let log_dir = self.log_dir.clone();
        let project_id_str = project_id.to_string();
        let max_log_size = self.max_log_size.unwrap_or(20 * 1024 * 1024);
        let cloudflared_manager = self.cloudflared_manager.clone();

        // Generate Spoofed ENV
        let spoofed_envs = self.proto_manager.get_spoofed_env();

        // Optional: Pre-install toolchain
        let toolchain = config.toolchain.clone();
        let mut toolchain_version = config.toolchain_version.clone().unwrap_or_else(|| "stable".to_string());
        if toolchain_version == "stable" {
            if let Some(ref tool) = toolchain {
                if tool == "go" || tool == "python" {
                    toolchain_version = "latest".to_string();
                }
            }
        }
        let proto_home = self.proto_manager.proto_home.clone();

        // Spin up the async execution loop
        tokio::spawn(async move {
            let mut state_updater = StateUpdater {
                project_id: project_id_str.clone(),
                sender: status_sender,
            };

            let log_file = log_dir.join(format!("{}.log", config.name));
            let mut stop_rx = stop_receiver;

            macro_rules! log_system {
                ($msg:expr) => {
                    let text = $msg.to_string();
                    let _ = append_log_line(&log_file, &text, max_log_size).await;
                    let _ = log_sender.send(ProcessLog {
                        project_id: project_id_str.clone(),
                        stream: "system".to_string(),
                        text,
                        timestamp: chrono::Utc::now().timestamp_millis() as u64,
                    });
                };
            }

            state_updater.update(ProcessState::Setup);

            // Install toolchain if requested using private proto binary
            if let Some(ref tool) = toolchain {
                if !tool.is_empty() {
                    log_system!(format!("--- Installing Toolchain {}@{} ---", tool, toolchain_version));
                    let app_data_dir = std::env::current_dir().unwrap_or_default().join("app_data");
                    let proto_bin = app_data_dir.join("bin").join(if cfg!(target_os = "windows") { "proto.exe" } else { "proto" });

                    let status = tokio::process::Command::new(&proto_bin)
                        .env("PROTO_HOME", &proto_home)
                        .args(["install", tool, &toolchain_version, "--pin"])
                        .status()
                        .await;
                    if let Ok(st) = status {
                        if !st.success() {
                            let reason = format!("Failed to install toolchain {}@{}", tool, toolchain_version);
                            log_system!(format!("--- ERROR: {} ---", reason));
                            state_updater.update(ProcessState::Fatal { reason });
                            return;
                        }
                    } else {
                         log_system!("--- WARNING: Private proto executable not found. Proceeding without strict toolchain installation. ---");
                    }
                }
            }

            // Run Setup Command if defined
            if let Some(ref setup_cmd) = config.setup_command {
                let setup_args = config.setup_args.clone().unwrap_or_default();
                
                #[cfg(target_os = "windows")]
                let mut cmd = {
                    let mut c = tokio::process::Command::new("cmd.exe");
                    c.arg("/C").arg(setup_cmd).args(&setup_args);
                    c
                };
                #[cfg(not(target_os = "windows"))]
                let mut cmd = {
                    let mut c = tokio::process::Command::new(setup_cmd);
                    c.args(&setup_args);
                    c
                };

                if let Some(ref dir) = config.cwd {
                    cmd.current_dir(dir);
                }

                cmd.envs(spoofed_envs.clone());

                if let Some(ref envs) = config.env {
                    cmd.envs(envs);
                }

                log_system!("--- Spawning Setup Script ---");

                match cmd.status().await {
                    Ok(status) if status.success() => {
                        log_system!("--- Setup Script Completed Successfully ---");
                    }
                    Ok(status) => {
                        let reason = format!("Setup failed with exit code: {:?}", status.code());
                        log_system!(format!("--- ERROR: {} ---", reason));
                        state_updater.update(ProcessState::Fatal { reason });
                        return;
                    }
                    Err(e) => {
                        let reason = format!("Failed to spawn setup command: {}", e);
                        log_system!(format!("--- ERROR: {} ---", reason));
                        state_updater.update(ProcessState::Fatal { reason });
                        return;
                    }
                }
            }

            // Main Process Execution Loop with Backoff
            let mut retry_count = 0;
            let max_retries = 5;

            loop {
                // Check if user has stopped the process in the meantime
                if stop_rx.try_recv().is_ok() {
                    log_system!("--- Process Cancelled by User ---");
                    state_updater.update(ProcessState::Stopped);
                    return;
                }

                #[cfg(target_os = "windows")]
                let mut cmd = {
                    let mut c = tokio::process::Command::new("cmd.exe");
                    c.arg("/C").arg(&config.command).args(&config.args);
                    c
                };
                #[cfg(not(target_os = "windows"))]
                let mut cmd = {
                    let mut c = tokio::process::Command::new(&config.command);
                    c.args(&config.args);
                    c
                };

                if let Some(ref dir) = config.cwd {
                    cmd.current_dir(dir);
                }

                cmd.envs(spoofed_envs.clone());

                if let Some(ref envs) = config.env {
                    cmd.envs(envs);
                }
                cmd.stdout(std::process::Stdio::piped());
                cmd.stderr(std::process::Stdio::piped());

                log_system!("--- Spawning Primary Command ---");
                let last_start_time = Utc::now();

                match cmd.spawn() {
                    Ok(mut child) => {
                        let pid = child.id().unwrap_or(0);
                        state_updater.update(ProcessState::Running { pid });

                        let stdout = child.stdout.take().expect("Failed to capture stdout");
                        let stderr = child.stderr.take().expect("Failed to capture stderr");

                        // Spawn async IO reading tasks
                        let stdout_task = tokio::spawn(pipe_stream(
                            stdout,
                            config.id.clone(),
                            "stdout".to_string(),
                            log_file.clone(),
                            log_sender.clone(),
                            max_log_size,
                        ));

                        let stderr_task = tokio::spawn(pipe_stream(
                            stderr,
                            config.id.clone(),
                            "stderr".to_string(),
                            log_file.clone(),
                            log_sender.clone(),
                            max_log_size,
                        ));

                        // Check if Cloudflare Tunnel is enabled
                        let mut tunnel_pid: Option<u32> = None;
                        if config.enable_tunnel == Some(true) {
                            let (mode, token, active_port) = {
                                let path = std::path::Path::new("d:/alouette-server/core_engine/app_data/cloudflare_config.yml");
                                if path.exists() {
                                    let mut mode = "default".to_string();
                                    let mut global_token = None;
                                    let mut active_token = None;
                                    let mut active_port = None;
                                    if let Ok(content) = std::fs::read_to_string(path) {
                                        let mut current_id = String::new();
                                        let mut current_project_id = String::new();
                                        let mut current_port = None;
                                        let mut current_token = None;
                                        let mut current_active = false;
                                        for line in content.lines() {
                                            let trimmed = line.trim();
                                            if trimmed.starts_with("mode:") {
                                                mode = trimmed.replace("mode:", "").replace('"', "").replace('\'', "").trim().to_string();
                                            } else if trimmed.starts_with("tunnel_token:") || trimmed.starts_with("api_key:") {
                                                let val = trimmed.replace("tunnel_token:", "").replace("api_key:", "").replace('"', "").replace('\'', "").trim().to_string();
                                                if !val.is_empty() {
                                                    global_token = Some(val);
                                                }
                                            } else if trimmed.starts_with("- id:") || trimmed.starts_with("id:") {
                                                if !current_id.is_empty() && current_project_id == project_id_str && current_active {
                                                    active_port = current_port;
                                                    active_token = current_token.clone();
                                                }
                                                current_id = trimmed.replace("- id:", "").replace("id:", "").replace('"', "").replace('\'', "").trim().to_string();
                                                current_project_id.clear();
                                                current_port = None;
                                                current_token = None;
                                                current_active = false;
                                            } else if trimmed.starts_with("project_id:") {
                                                current_project_id = trimmed.replace("project_id:", "").replace('"', "").replace('\'', "").trim().to_string();
                                            } else if trimmed.starts_with("port:") {
                                                current_port = trimmed.replace("port:", "").trim().parse::<u16>().ok();
                                            } else if trimmed.starts_with("token:") {
                                                let val = trimmed.replace("token:", "").replace('"', "").replace('\'', "").trim().to_string();
                                                if !val.is_empty() {
                                                    current_token = Some(val);
                                                }
                                            } else if trimmed.starts_with("active:") {
                                                current_active = trimmed.replace("active:", "").trim() == "true";
                                            }
                                        }
                                        if !current_id.is_empty() && current_project_id == project_id_str && current_active {
                                            active_port = current_port;
                                            active_token = current_token;
                                        }
                                    }
                                    (mode, active_token.or(global_token), active_port)
                                } else {
                                    ("default".to_string(), None, None)
                                }
                            };

                            let port = active_port.unwrap_or(config.port.unwrap_or(3000));
                            log_system!(format!("Watchdog: Khởi động Cloudflare Tunnel (Chế độ: {}) trên cổng: {}...", mode, port));
                            
                            let pass_token = if mode == "token" || mode == "api" { token } else { None };
                            match cloudflared_manager.spawn_tunnel(port, pass_token, &project_id_str).await {
                                Ok((t_pid, mut url_rx)) => {
                                    tunnel_pid = Some(t_pid);
                                    let log_sender_c = log_sender.clone();
                                    let project_id_c = project_id_str.clone();
                                    let log_file_c = log_file.clone();
                                    // Spawn a background task to listen to the url broadcast and print it
                                    tokio::spawn(async move {
                                        if let Ok(url) = url_rx.recv().await {
                                            let text = format!("Watchdog: Cloudflare Tunnel hoạt động thành công! Đường truyền công khai của bạn: \n👉 {} 👈", url);
                                            let _ = append_log_line(&log_file_c, &text, max_log_size).await;
                                            let _ = log_sender_c.send(ProcessLog {
                                                project_id: project_id_c,
                                                stream: "system".to_string(),
                                                text,
                                                timestamp: chrono::Utc::now().timestamp_millis() as u64,
                                            });
                                        }
                                    });
                                }
                                Err(e) => {
                                    log_system!(format!("Watchdog ERROR: Khởi động Cloudflare Tunnel thất bại: {}", e));
                                }
                            }
                        }

                        // Wait for process exit or manual stop command
                        tokio::select! {
                            exit_status = child.wait() => {
                                let _ = stdout_task.await;
                                let _ = stderr_task.await;

                                if let Some(t_pid) = tunnel_pid {
                                    log_system!("Watchdog: Đang dừng Cloudflare Tunnel...");
                                    terminate_process_tree(t_pid).await;
                                }

                                let exit_code = match exit_status {
                                    Ok(status) => status.code(),
                                    Err(_) => None,
                                };

                                let running_duration = Utc::now().signed_duration_since(last_start_time);

                                // Reset retries if the process ran stably for > 30 seconds
                                if running_duration.num_seconds() > 30 {
                                    retry_count = 0;
                                }

                                let log_msg = format!("--- Primary Command Exited with Code: {:?} ---", exit_code);
                                log_system!(log_msg);

                                if exit_code == Some(0) {
                                    state_updater.update(ProcessState::Stopped);
                                    return;
                                } else {
                                    // Process crashed
                                    if config.auto_restart.unwrap_or(true) && retry_count < max_retries {
                                        retry_count += 1;
                                        let backoff = 1u64 << retry_count; // 2s, 4s, 8s, 16s, 32s
                                        let backoff_msg = format!("--- Process crashed. Retrying in {} seconds (Attempt {}/{}) ---", backoff, retry_count, max_retries);
                                        log_system!(backoff_msg);

                                        state_updater.update(ProcessState::Crashing {
                                            retry_count,
                                            backoff_seconds: backoff,
                                        });

                                        tokio::select! {
                                            _ = tokio::time::sleep(tokio::time::Duration::from_secs(backoff)) => {}
                                            _ = &mut stop_rx => {
                                                log_system!("--- Process Terminated During Backoff ---");
                                                state_updater.update(ProcessState::Stopped);
                                                return;
                                            }
                                        }
                                    } else {
                                        let fail_msg = "--- Process exceeded maximum crash retries. Entering FATAL state. ---";
                                        log_system!(fail_msg);
                                        state_updater.update(ProcessState::Fatal {
                                            reason: format!("Process exited with code {:?}", exit_code),
                                        });
                                        return;
                                    }
                                }
                            }
                            _ = &mut stop_rx => {
                                // Terminate active process tree recursively
                                log_system!("--- Stopping Process Tree... ---");
                                if let Some(t_pid) = tunnel_pid {
                                    log_system!("Watchdog: Đang dừng Cloudflare Tunnel...");
                                    terminate_process_tree(t_pid).await;
                                }
                                terminate_process_tree(pid).await;
                                let _ = child.kill().await;
                                let _ = stdout_task.await;
                                let _ = stderr_task.await;
                                log_system!("--- Process Tree Terminated Successfully ---");
                                state_updater.update(ProcessState::Stopped);
                                return;
                            }
                        }
                    }
                    Err(e) => {
                        let reason = format!("Failed to spawn process: {}", e);
                        log_system!(format!("--- ERROR: {} ---", reason));
                        state_updater.update(ProcessState::Fatal { reason });
                        return;
                    }
                }
            }
        });

        Ok(())
    }

    /// Stops a running project process instance and tears down its child tree.
    pub async fn stop_process(&mut self, project_id: &str) -> Result<(), String> {
        let inst = self.instances.get_mut(project_id)
            .ok_or_else(|| format!("Project '{}' not found", project_id))?;

        if let Some(stop_tx) = inst.stop_sender.take() {
            let _ = stop_tx.send(());
            // Update state locally first. The background loop will set final "Stopped" state
            self.update_state(project_id, ProcessState::Stopped);
            Ok(())
        } else {
            // Process is already stopped, or in error
            if let ProcessState::Fatal { .. } = inst.state {
                // Allow resetting fatal states to stopped
                self.update_state(project_id, ProcessState::Stopped);
            }
            Ok(())
        }
    }

    /// Forcefully terminates a running project and puts it into a Fatal state.
    pub async fn force_fatal_stop(&mut self, project_id: &str, reason: String) -> Result<(), String> {
        let inst = self.instances.get_mut(project_id)
            .ok_or_else(|| format!("Project '{}' not found", project_id))?;

        let log_file = self.log_dir.join(format!("{}.log", inst.config.name));
        let max_log_size = self.max_log_size.unwrap_or(20 * 1024 * 1024);

        if let Some(stop_tx) = inst.stop_sender.take() {
            let _ = stop_tx.send(());
        }

        // Write Fatal status into the log file
        let _ = append_log_line(
            &log_file,
            &format!("Watchdog: Process terminated because it exceeded resource limits: {}", reason),
            max_log_size,
        ).await;

        // Force transition to Fatal
        self.update_state(project_id, ProcessState::Fatal { reason });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ProjectConfig;
    use std::time::Duration;
    use std::collections::HashMap;

    #[tokio::test]
    async fn test_process_execution_flow() {
        let temp_dir = std::env::temp_dir();
        let log_dir = temp_dir.join("alouette_test_logs_exec");
        let mut pm = ProcessManager::new(&log_dir);

        // Cross-platform echo command
        #[cfg(target_os = "windows")]
        let (cmd, args) = ("cmd", vec!["/c".to_string(), "echo test_logs_pipeline".to_string()]);
        #[cfg(not(target_os = "windows"))]
        let (cmd, args) = ("echo", vec!["test_logs_pipeline".to_string()]);

        let config = ProjectConfig {
            id: "test-echo".to_string(),
            name: "Test Echo".to_string(),
            command: cmd.to_string(),
            args,
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
        };

        pm.register_project(config).await.unwrap();

        let mut log_rx = pm.subscribe_logs();
        let mut status_rx = pm.subscribe_status();

        // Start Execution Pipeline
        let start_res = pm.start_process("test-echo").await;
        assert!(start_res.is_ok());

        // Read status transitions
        let mut states_seen = Vec::new();
        for _ in 0..3 {
            if let Ok(Ok((id, state))) = tokio::time::timeout(Duration::from_millis(2000), status_rx.recv()).await {
                if id == "test-echo" {
                    states_seen.push(state);
                }
            } else {
                break;
            }
        }

        // Verify that we transitioned to Setup at some point
        assert!(states_seen.contains(&ProcessState::Setup));

        // Read logs to make sure output captures and pipes correctly
        let mut log_received = false;
        for _ in 0..5 {
            if let Ok(Ok(log)) = tokio::time::timeout(Duration::from_millis(2000), log_rx.recv()).await {
                if log.project_id == "test-echo" {
                    log_received = true;
                    break;
                }
            } else {
                break;
            }
        }

        assert!(log_received);

        // Stop the process (Graceful/Clean termination check)
        let stop_res = pm.stop_process("test-echo").await;
        assert!(stop_res.is_ok());

        let _ = std::fs::remove_dir_all(log_dir);
    }

    #[tokio::test]
    async fn test_process_nonexistent_command() {
        let temp_dir = std::env::temp_dir();
        let log_dir = temp_dir.join("alouette_test_logs_nonexistent");
        let mut pm = ProcessManager::new(&log_dir);

        let config = ProjectConfig {
            id: "nonexistent".to_string(),
            name: "Nonexistent".to_string(),
            command: "nonexistent_command_xyz_123_abc".to_string(),
            args: vec![],
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
        };

        pm.register_project(config).await.unwrap();
        let mut status_rx = pm.subscribe_status();

        let start_res = pm.start_process("nonexistent").await;
        assert!(start_res.is_ok());

        let mut states = Vec::new();
        for _ in 0..5 {
            if let Ok(Ok((id, state))) = tokio::time::timeout(Duration::from_millis(1500), status_rx.recv()).await {
                if id == "nonexistent" {
                    states.push(state);
                }
            } else {
                break;
            }
        }

        assert!(states.contains(&ProcessState::Setup));
        let has_fatal = states.iter().any(|s| matches!(s, ProcessState::Fatal { .. }));
        assert!(has_fatal, "Process should have entered Fatal state, but got: {:?}", states);

        let _ = std::fs::remove_dir_all(log_dir);
    }

    #[tokio::test]
    async fn test_process_setup_failure() {
        let temp_dir = std::env::temp_dir();
        let log_dir = temp_dir.join("alouette_test_logs_setup_fail");
        let mut pm = ProcessManager::new(&log_dir);

        #[cfg(target_os = "windows")]
        let (setup_cmd, setup_args) = ("cmd", vec!["/c".to_string(), "exit 1".to_string()]);
        #[cfg(not(target_os = "windows"))]
        let (setup_cmd, setup_args) = ("false", vec![]);

        let config = ProjectConfig {
            id: "setup-fail".to_string(),
            name: "Setup Fail".to_string(),
            command: "echo".to_string(),
            args: vec!["should not run".to_string()],
            cwd: None,
            setup_command: Some(setup_cmd.to_string()),
            setup_args: Some(setup_args),
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
        };

        pm.register_project(config).await.unwrap();
        let mut status_rx = pm.subscribe_status();

        let start_res = pm.start_process("setup-fail").await;
        assert!(start_res.is_ok());

        let mut states = Vec::new();
        for _ in 0..5 {
            if let Ok(Ok((id, state))) = tokio::time::timeout(Duration::from_millis(1500), status_rx.recv()).await {
                if id == "setup-fail" {
                    states.push(state);
                }
            } else {
                break;
            }
        }

        assert!(states.contains(&ProcessState::Setup));
        let has_fatal = states.iter().any(|s| matches!(s, ProcessState::Fatal { .. }));
        assert!(has_fatal, "Process should have entered Fatal state due to setup failure, but got: {:?}", states);

        let _ = std::fs::remove_dir_all(log_dir);
    }

    #[tokio::test]
    async fn test_stop_process_already_stopped() {
        let temp_dir = std::env::temp_dir();
        let log_dir = temp_dir.join("alouette_test_logs_stop_stopped");
        let mut pm = ProcessManager::new(&log_dir);

        let config = ProjectConfig {
            id: "test-stopped".to_string(),
            name: "Test Stopped".to_string(),
            command: "echo".to_string(),
            args: vec![],
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
        };

        pm.register_project(config).await.unwrap();

        let stop_res = pm.stop_process("test-stopped").await;
        assert!(stop_res.is_ok());

        let dereg_res = pm.deregister_project("test-stopped").await;
        assert!(dereg_res.is_ok());

        let _ = std::fs::remove_dir_all(log_dir);
    }

    #[tokio::test]
    async fn test_stop_nonexistent_project() {
        let temp_dir = std::env::temp_dir();
        let log_dir = temp_dir.join("alouette_test_logs_stop_nonexistent");
        let mut pm = ProcessManager::new(&log_dir);

        let res = pm.stop_process("ghost-project").await;
        assert!(res.is_err());
        assert_eq!(res.unwrap_err(), "Project 'ghost-project' not found");

        let _ = std::fs::remove_dir_all(log_dir);
    }

    #[tokio::test]
    async fn test_env_variables_injection() {
        let temp_dir = std::env::temp_dir();
        let log_dir = temp_dir.join("alouette_test_logs_env");
        let mut pm = ProcessManager::new(&log_dir);

        #[cfg(target_os = "windows")]
        let (cmd, args) = ("cmd", vec!["/c".to_string(), "echo %MY_TEST_VAR%".to_string()]);
        #[cfg(not(target_os = "windows"))]
        let (cmd, args) = ("sh", vec!["-c".to_string(), "echo $MY_TEST_VAR".to_string()]);

        let mut env_map = HashMap::new();
        env_map.insert("MY_TEST_VAR".to_string(), "ALOUETTE_ENV_OK".to_string());

        let config = ProjectConfig {
            id: "test-env".to_string(),
            name: "Test Env".to_string(),
            command: cmd.to_string(),
            args,
            cwd: None,
            setup_command: None,
            setup_args: None,
            auto_restart: Some(false),
            env: Some(env_map),
            max_cpu_percent: None,
            max_ram_mb: None,
            port: None,
            source: None,
            terminal_mode: None,
            toolchain: None,
            toolchain_version: None,
            enable_tunnel: None,
            max_log_lines: None,
        };

        pm.register_project(config).await.unwrap();

        let mut log_rx = pm.subscribe_logs();
        let start_res = pm.start_process("test-env").await;
        assert!(start_res.is_ok());

        let mut found_env_output = false;
        for _ in 0..10 {
            if let Ok(Ok(log)) = tokio::time::timeout(Duration::from_millis(2000), log_rx.recv()).await {
                if log.project_id == "test-env" && log.text.contains("ALOUETTE_ENV_OK") {
                    found_env_output = true;
                    break;
                }
            } else {
                break;
            }
        }

        assert!(found_env_output, "Environment variables were not successfully injected and captured");
        let _ = std::fs::remove_dir_all(log_dir);
    }
}
