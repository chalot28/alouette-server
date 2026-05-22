use crate::config::ProjectConfig;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{broadcast, oneshot};
use sysinfo::{System, Pid};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "data")]
pub enum ProcessState {
    Stopped,
    Setup,
    Running { pid: u32 },
    Crashing { retry_count: u32, backoff_seconds: u64 },
    Terminated,
    Fatal { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessLog {
    pub project_id: String,
    pub stream: String, // "stdout" or "stderr"
    pub text: String,
    pub timestamp: u64,
}

pub struct ProjectInstance {
    pub config: ProjectConfig,
    pub state: ProcessState,
    pub stop_sender: Option<oneshot::Sender<()>>,
}

pub struct ProcessManager {
    pub instances: HashMap<String, ProjectInstance>,
    log_sender: broadcast::Sender<ProcessLog>,
    status_sender: broadcast::Sender<(String, ProcessState)>,
    log_dir: PathBuf,
    pub max_log_size: Option<u64>,
}

impl ProcessManager {
    pub fn new<P: AsRef<Path>>(log_dir: P) -> Self {
        let (log_sender, _) = broadcast::channel(1000);
        let (status_sender, _) = broadcast::channel(100);
        
        // Ensure log directory exists
        let log_dir_buf = log_dir.as_ref().to_path_buf();
        let _ = std::fs::create_dir_all(&log_dir_buf);

        ProcessManager {
            instances: HashMap::new(),
            log_sender,
            status_sender,
            log_dir: log_dir_buf,
            max_log_size: None,
        }
    }

    /// Registers a new project tab instance.
    pub fn register_project(&mut self, config: ProjectConfig) {
        let id = config.id.clone();
        self.instances.insert(
            id,
            ProjectInstance {
                config,
                state: ProcessState::Stopped,
                stop_sender: None,
            },
        );
    }

    /// Deregisters a project tab instance, terminating it first if running.
    pub async fn deregister_project(&mut self, project_id: &str) -> Result<(), String> {
        let _ = self.stop_process(project_id).await;
        self.instances.remove(project_id);
        Ok(())
    }

    /// Gets the list of registered project configs.
    pub fn get_configs(&self) -> Vec<ProjectConfig> {
        self.instances.values().map(|inst| inst.config.clone()).collect()
    }

    /// Gets a single project configuration by ID.
    pub fn get_config(&self, project_id: &str) -> Option<ProjectConfig> {
        self.instances.get(project_id).map(|inst| inst.config.clone())
    }

    /// Returns the current state of a project.
    pub fn get_state(&self, project_id: &str) -> Option<ProcessState> {
        self.instances.get(project_id).map(|inst| inst.state.clone())
    }

    /// Subscribes to the global log stream.
    pub fn subscribe_logs(&self) -> broadcast::Receiver<ProcessLog> {
        self.log_sender.subscribe()
    }

    /// Subscribes to global process status updates.
    pub fn subscribe_status(&self) -> broadcast::Receiver<(String, ProcessState)> {
        self.status_sender.subscribe()
    }

    /// Internal helper to update process state and broadcast changes.
    fn update_state(&mut self, project_id: &str, new_state: ProcessState) {
        if let Some(inst) = self.instances.get_mut(project_id) {
            inst.state = new_state.clone();
            let _ = self.status_sender.send((project_id.to_string(), new_state));
        }
    }

    /// Starts a project lifecycle: running setup if configured, followed by the main command.
    pub async fn start_process(&mut self, project_id: &str) -> Result<(), String> {
        let inst = self.instances.get_mut(project_id)
            .ok_or_else(|| format!("Project '{}' not found", project_id))?;

        if let ProcessState::Running { .. } | ProcessState::Setup = inst.state {
            return Err("Process is already running or in setup".to_string());
        }

        let config = inst.config.clone();
        let (stop_sender, stop_receiver) = oneshot::channel::<()>();
        inst.stop_sender = Some(stop_sender);

        let log_sender = self.log_sender.clone();
        let status_sender = self.status_sender.clone();
        let log_dir = self.log_dir.clone();
        let project_id_str = project_id.to_string();
        let max_log_size = self.max_log_size.unwrap_or(20 * 1024 * 1024);

        // Spin up the async execution loop
        tokio::spawn(async move {
            let mut state_updater = StateUpdater {
                project_id: project_id_str.clone(),
                sender: status_sender,
            };

            let log_file = log_dir.join(format!("{}.log", config.name));
            let mut stop_rx = stop_receiver;

            state_updater.update(ProcessState::Setup);

            // 1. Run Setup Command if defined
            if let Some(ref setup_cmd) = config.setup_command {
                let setup_args = config.setup_args.clone().unwrap_or_default();
                let mut cmd = Command::new(setup_cmd);
                cmd.args(&setup_args);
                if let Some(ref dir) = config.cwd {
                    cmd.current_dir(dir);
                }
                if let Some(ref envs) = config.env {
                    cmd.envs(envs);
                }
                
                let _ = append_log_line(&log_file, "--- Spawning Setup Script ---", max_log_size).await;

                match cmd.status().await {
                    Ok(status) if status.success() => {
                        let _ = append_log_line(&log_file, "--- Setup Script Completed Successfully ---", max_log_size).await;
                    }
                    Ok(status) => {
                        let reason = format!("Setup failed with exit code: {:?}", status.code());
                        let _ = append_log_line(&log_file, &format!("--- ERROR: {} ---", reason), max_log_size).await;
                        state_updater.update(ProcessState::Fatal { reason });
                        return;
                    }
                    Err(e) => {
                        let reason = format!("Failed to spawn setup command: {}", e);
                        let _ = append_log_line(&log_file, &format!("--- ERROR: {} ---", reason), max_log_size).await;
                        state_updater.update(ProcessState::Fatal { reason });
                        return;
                    }
                }
            }

            // 2. Main Process Execution Loop with Backoff
            let mut retry_count = 0;
            let max_retries = 5;
            let mut last_start_time;

            loop {
                // Check if user has stopped the process in the meantime
                if stop_rx.try_recv().is_ok() {
                    let _ = append_log_line(&log_file, "--- Process Cancelled by User ---", max_log_size).await;
                    state_updater.update(ProcessState::Stopped);
                    return;
                }

                let mut cmd = Command::new(&config.command);
                cmd.args(&config.args);
                if let Some(ref dir) = config.cwd {
                    cmd.current_dir(dir);
                }
                if let Some(ref envs) = config.env {
                    cmd.envs(envs);
                }
                cmd.stdout(std::process::Stdio::piped());
                cmd.stderr(std::process::Stdio::piped());

                let _ = append_log_line(&log_file, "--- Spawning Primary Command ---", max_log_size).await;
                last_start_time = Utc::now();

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

                        // Wait for process exit or manual stop command
                        tokio::select! {
                            exit_status = child.wait() => {
                                let _ = stdout_task.await;
                                let _ = stderr_task.await;
                                
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
                                let _ = append_log_line(&log_file, &log_msg, max_log_size).await;

                                if exit_code == Some(0) {
                                    state_updater.update(ProcessState::Stopped);
                                    return;
                                } else {
                                    // Process crashed
                                    if config.auto_restart.unwrap_or(true) && retry_count < max_retries {
                                        retry_count += 1;
                                        let backoff = 1u64 << retry_count; // 2s, 4s, 8s, 16s, 32s
                                        let backoff_msg = format!("--- Process crashed. Retrying in {} seconds (Attempt {}/{}) ---", backoff, retry_count, max_retries);
                                        let _ = append_log_line(&log_file, &backoff_msg, max_log_size).await;
                                        
                                        state_updater.update(ProcessState::Crashing {
                                            retry_count,
                                            backoff_seconds: backoff,
                                        });

                                        tokio::select! {
                                            _ = tokio::time::sleep(tokio::time::Duration::from_secs(backoff)) => {}
                                            _ = &mut stop_rx => {
                                                let _ = append_log_line(&log_file, "--- Process Terminated During Backoff ---", max_log_size).await;
                                                state_updater.update(ProcessState::Stopped);
                                                return;
                                            }
                                        }
                                    } else {
                                        let fail_msg = "--- Process exceeded maximum crash retries. Entering FATAL state. ---";
                                        let _ = append_log_line(&log_file, fail_msg, max_log_size).await;
                                        state_updater.update(ProcessState::Fatal {
                                            reason: format!("Process exited with code {:?}", exit_code),
                                        });
                                        return;
                                    }
                                }
                            }
                            _ = &mut stop_rx => {
                                // Terminate active process tree recursively
                                let _ = append_log_line(&log_file, "--- Stopping Process Tree... ---", max_log_size).await;
                                terminate_process_tree(pid).await;
                                let _ = child.kill().await;
                                let _ = stdout_task.await;
                                let _ = stderr_task.await;
                                let _ = append_log_line(&log_file, "--- Process Tree Terminated Successfully ---", max_log_size).await;
                                state_updater.update(ProcessState::Stopped);
                                return;
                            }
                        }
                    }
                    Err(e) => {
                        let reason = format!("Failed to spawn process: {}", e);
                        let _ = append_log_line(&log_file, &format!("--- ERROR: {} ---", reason), max_log_size).await;
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

// Struct to handle background status broadcasts cleanly
struct StateUpdater {
    project_id: String,
    sender: broadcast::Sender<(String, ProcessState)>,
}

impl StateUpdater {
    fn update(&mut self, state: ProcessState) {
        let _ = self.sender.send((self.project_id.clone(), state));
    }
}

fn rotate_log_file(path: &Path, max_bytes: u64) -> std::io::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let metadata = std::fs::metadata(path)?;
    if metadata.len() < max_bytes {
        return Ok(());
    }

    // Rotate .log.4 -> .log.5, .log.3 -> .log.4 etc.
    for i in (1..5).rev() {
        let old_path = path.with_extension(format!("log.{}", i));
        let new_path = path.with_extension(format!("log.{}", i + 1));
        if old_path.exists() {
            let _ = std::fs::rename(&old_path, &new_path);
        }
    }
    let first_backup = path.with_extension("log.1");
    let _ = std::fs::rename(path, &first_backup);

    // Purge files older than 7 days
    if let Some(parent) = path.parent() {
        if let Ok(entries) = std::fs::read_dir(parent) {
            let now = std::time::SystemTime::now();
            let seven_days = std::time::Duration::from_secs(7 * 24 * 60 * 60);
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if entry_path.is_file() {
                    let extension = entry_path.extension().and_then(|s| s.to_str()).unwrap_or("");
                    if extension.starts_with("log.") {
                        if let Ok(meta) = entry.metadata() {
                            if let Ok(modified) = meta.modified() {
                                if let Ok(age) = now.duration_since(modified) {
                                    if age > seven_days {
                                        let _ = std::fs::remove_file(entry_path);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

async fn write_log_with_rotation(
    file: &mut Option<fs::File>,
    path: &Path,
    data: &[u8],
    max_bytes: u64,
) -> std::io::Result<()> {
    let mut check_rotation = false;
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() >= max_bytes {
            check_rotation = true;
        }
    }
    
    if check_rotation {
        *file = None; // Release lock on Windows
        let _ = rotate_log_file(path, max_bytes);
        *file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .await
            .ok();
    }

    if let Some(ref mut f) = file {
        f.write_all(data).await?;
        f.flush().await?;
    }
    Ok(())
}

/// Helper function to asynchronously append tracking message lines to the partition log file.
async fn append_log_line(path: &Path, text: &str, max_bytes: u64) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
        .ok();
    let timestamp = Utc::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let log_line = format!("[{}] SYSTEM: {}\n", timestamp, text);
    write_log_with_rotation(&mut file, path, log_line.as_bytes(), max_bytes).await?;
    Ok(())
}

/// Helper to pipe tokio stdout/stderr lines to file and emit events.
async fn pipe_stream<R>(
    stream: R,
    project_id: String,
    stream_name: String,
    log_path: PathBuf,
    sender: broadcast::Sender<ProcessLog>,
    max_bytes: u64,
) where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut reader = BufReader::new(stream).lines();
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .await
        .ok();

    while let Ok(Some(line)) = reader.next_line().await {
        let timestamp = Utc::now().timestamp_millis() as u64;
        
        // Write dynamically to partition log
        let log_prefix = format!("[{}] [{}] {}\n", Utc::now().format("%H:%M:%S%.3f"), stream_name, line);
        let _ = write_log_with_rotation(&mut file, &log_path, log_prefix.as_bytes(), max_bytes).await;

        // Broadcast to channels
        let log = ProcessLog {
            project_id: project_id.clone(),
            stream: stream_name.clone(),
            text: line,
            timestamp,
        };
        let _ = sender.send(log);
    }
}

/// Recursive Rust-native process tree termination using `sysinfo`.
fn kill_tree_sysinfo(root_pid: u32) -> Result<(), String> {
    let mut sys = System::new();
    sys.refresh_processes();

    let target_pid = Pid::from(root_pid as usize);
    let mut pids_to_kill = Vec::new();

    // Perform BFS to aggregate all grandchild processes
    let mut queue = vec![target_pid];
    let mut index = 0;

    while index < queue.len() {
        let parent = queue[index];
        index += 1;
        pids_to_kill.push(parent);

        for (&pid, process) in sys.processes() {
            if let Some(ppid) = process.parent() {
                if ppid == parent && !queue.contains(&pid) {
                    queue.push(pid);
                }
            }
        }
    }

    // Kill processes bottom-up (reverse order: leaves first, then wrapper, then parent)
    for pid in pids_to_kill.into_iter().rev() {
        if let Some(process) = sys.process(pid) {
            process.kill();
        }
    }

    Ok(())
}

/// Dynamic Process Tree Teardown Entry point.
pub async fn terminate_process_tree(pid: u32) {
    // First try the native Rust recursive system-crawling teardown
    if let Err(e) = kill_tree_sysinfo(pid) {
        eprintln!("Failed to kill tree natively: {}, trying taskkill", e);
    }

    // On Windows, also run `taskkill` to guarantee that nested shell child wrapper environments are fully purged.
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(&["/F", "/T", "/PID", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ProjectConfig;
    use std::time::Duration;

    #[tokio::test]
    async fn test_process_manager_registration() {
        let temp_dir = std::env::temp_dir();
        let log_dir = temp_dir.join("alouette_test_logs_reg");
        let mut pm = ProcessManager::new(&log_dir);

        let config = ProjectConfig {
            id: "test-id".to_string(),
            name: "Test Process".to_string(),
            command: "echo".to_string(),
            args: vec!["hello".to_string()],
            cwd: None,
            setup_command: None,
            setup_args: None,
            auto_restart: Some(false),
            env: None,
            max_cpu_percent: None,
            max_ram_mb: None,
            port: None,
        };

        pm.register_project(config.clone());

        assert_eq!(pm.get_configs().len(), 1);
        assert_eq!(pm.get_state("test-id"), Some(ProcessState::Stopped));

        let _ = std::fs::remove_dir_all(log_dir);
    }

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
        };

        pm.register_project(config);

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
        };

        pm.register_project(config);
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
        };

        pm.register_project(config);
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
        };

        pm.register_project(config);
        
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
    async fn test_log_rotation() {
        let temp_dir = std::env::temp_dir();
        let log_dir = temp_dir.join("alouette_test_logs_rotation");
        let _ = std::fs::create_dir_all(&log_dir);

        let log_file = log_dir.join("rotation_test.log");
        let max_bytes = 10; // small limit to trigger quickly

        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file)
            .await
            .ok();
        
        let res1 = write_log_with_rotation(&mut file, &log_file, b"Line 1: very long line exceeding 10 bytes\n", max_bytes).await;
        assert!(res1.is_ok());

        let res2 = write_log_with_rotation(&mut file, &log_file, b"Line 2: very long line exceeding 10 bytes\n", max_bytes).await;
        assert!(res2.is_ok());

        let res3 = write_log_with_rotation(&mut file, &log_file, b"Line 3: very long line exceeding 10 bytes\n", max_bytes).await;
        assert!(res3.is_ok());

        assert!(log_file.exists());
        let backup1 = log_file.with_extension("log.1");
        let backup2 = log_file.with_extension("log.2");
        assert!(backup1.exists());
        assert!(backup2.exists());

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
        };

        pm.register_project(config);

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
