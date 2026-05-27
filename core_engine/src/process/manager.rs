use crate::config::ProjectConfig;
use crate::workspace_manager::WorkspaceManager;
use crate::proto_manager::ProtoManager;
use crate::cloudflared_manager::CloudflaredManager;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::sync::broadcast;

use super::models::{ProcessState, ProcessLog, TerminalOutput, TerminalSession, ProjectInstance};

pub struct ProcessManager {
    pub instances: HashMap<String, ProjectInstance>,
    pub(crate) log_sender: broadcast::Sender<ProcessLog>,
    pub(crate) status_sender: broadcast::Sender<(String, ProcessState)>,
    pub terminal_sender: broadcast::Sender<TerminalOutput>,
    pub terminal_sessions: HashMap<String, TerminalSession>,
    pub(crate) log_dir: PathBuf,
    pub max_log_size: Option<u64>,
    pub workspace_manager: WorkspaceManager,
    pub proto_manager: ProtoManager,
    pub cloudflared_manager: CloudflaredManager,
    pub db_manager: crate::db::DbManager,
    pub(crate) _pty_pairs: HashMap<String, usize>,
    pub(crate) _prompt_files: HashMap<String, PathBuf>,
    pub input_buf: HashMap<String, String>,
    pub sessions_cwd: HashMap<String, PathBuf>,
    pub terminal_history: HashMap<String, Vec<String>>,
    pub terminal_history_index: HashMap<String, usize>,
}

impl ProcessManager {
    pub fn new<P: AsRef<Path>>(log_dir: P) -> Self {
        let (log_sender, _) = broadcast::channel(1000);
        let (status_sender, _) = broadcast::channel(100);
        let (terminal_sender, _) = broadcast::channel(1000);

        let log_dir_buf = log_dir.as_ref().to_path_buf();
        let _ = std::fs::create_dir_all(&log_dir_buf);

        let is_test = log_dir_buf.to_string_lossy().contains("test");
        let app_data_dir = if is_test {
            log_dir_buf.clone()
        } else {
            std::env::current_dir().unwrap_or_default().join("app_data")
        };
        let _ = std::fs::create_dir_all(&app_data_dir);
        let db_path = app_data_dir.join("alouette.db");
        if is_test {
            let _ = std::fs::remove_file(&db_path);
            let _ = std::fs::remove_file(db_path.with_extension("db-journal"));
            let _ = std::fs::remove_file(db_path.with_extension("db-shm"));
            let _ = std::fs::remove_file(db_path.with_extension("db-wal"));
        }

        let workspaces_dir = app_data_dir.join("workspaces");
        let proto_home = app_data_dir.join("alouette_toolchains");
        let cloudflared_exe = app_data_dir.join("bin").join(
            if cfg!(target_os = "windows") { "cloudflared.exe" } else { "cloudflared" }
        );

        let db_manager = crate::db::DbManager::new(&db_path);
        if let Err(e) = db_manager.init() {
            eprintln!("CRITICAL ERROR: Failed to initialize SQLite database: {}", e);
        }

        let mut instances = HashMap::new();
        match db_manager.load_projects() {
            Ok(projects) => {
                for config in projects {
                    instances.insert(
                        config.id.clone(),
                        ProjectInstance {
                            config,
                            state: ProcessState::Stopped,
                            stop_sender: None,
                        },
                    );
                }
            }
            Err(e) => {
                eprintln!("ERROR: Failed to load project configurations from database: {}", e);
            }
        }

        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            let log_rx: broadcast::Receiver<ProcessLog> = log_sender.subscribe();
            let db_clone = db_manager.clone();
            handle.spawn(async move {
                let mut log_rx = log_rx;
                while let Ok(log) = log_rx.recv().await {
                    let db = db_clone.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        if let Err(e) = db.insert_log(&log.project_id, &log.stream, &log.text, log.timestamp) {
                            eprintln!("SQLite log insert error: {}", e);
                        }
                        let limit = match db.get_project_max_log_lines(&log.project_id) {
                            Ok(Some(limit)) if limit > 0 => limit as usize,
                            _ => 5000,
                        };
                        if let Err(e) = db.prune_logs(&log.project_id, limit) {
                            eprintln!("SQLite log pruning error: {}", e);
                        }
                    }).await;
                }
            });
        }

        ProcessManager {
            instances,
            log_sender,
            status_sender,
            terminal_sender,
            terminal_sessions: HashMap::new(),
            log_dir: log_dir_buf,
            max_log_size: None,
            workspace_manager: WorkspaceManager::new(workspaces_dir),
            proto_manager: ProtoManager::new(proto_home),
            cloudflared_manager: CloudflaredManager::new(cloudflared_exe),
            db_manager,
            _pty_pairs: HashMap::new(),
            _prompt_files: HashMap::new(),
            input_buf: HashMap::new(),
            sessions_cwd: HashMap::new(),
            terminal_history: HashMap::new(),
            terminal_history_index: HashMap::new(),
        }
    }

    pub async fn initialize_environment(&mut self) -> Result<(), String> {
        let app_data_dir = std::env::current_dir().unwrap_or_default().join("app_data");
        let bin_dir = app_data_dir.join("bin");
        let proto_bin = self.proto_manager.ensure_proto_cli(&bin_dir).await?;
        println!("Private proto CLI resides at: {:?}", proto_bin);
        self.proto_manager.ensure_stable_toolchains(&proto_bin).await?;
        let cloudflared_bin = CloudflaredManager::update_tunnel_binary(&bin_dir).await?;
        self.cloudflared_manager.executable_path = cloudflared_bin;
        Ok(())
    }

    pub async fn register_project(&mut self, config: ProjectConfig) -> Result<(), String> {
        let id = config.id.clone();
        let mut updated_config = config;
        if let Some(ref source) = updated_config.source {
            if !source.trim().is_empty() {
                let dest = self.workspace_manager.prepare_workspace(&id, source).await?;
                updated_config.cwd = Some(dest.to_string_lossy().to_string());
            }
        }
        self.db_manager.save_project(&updated_config)?;
        self.instances.insert(
            id,
            ProjectInstance {
                config: updated_config,
                state: ProcessState::Stopped,
                stop_sender: None,
            },
        );
        Ok(())
    }

    pub async fn deregister_project(&mut self, project_id: &str) -> Result<(), String> {
        let _ = self.stop_process(project_id).await;
        self.db_manager.delete_project(project_id)?;
        self.instances.remove(project_id);
        Ok(())
    }

    pub fn get_configs(&self) -> Vec<ProjectConfig> {
        self.instances.values().map(|inst| inst.config.clone()).collect()
    }

    pub fn get_config(&self, project_id: &str) -> Option<ProjectConfig> {
        self.instances.get(project_id).map(|inst| inst.config.clone())
    }

    pub fn get_state(&self, project_id: &str) -> Option<ProcessState> {
        self.instances.get(project_id).map(|inst| inst.state.clone())
    }

    pub fn subscribe_logs(&self) -> broadcast::Receiver<ProcessLog> {
        self.log_sender.subscribe()
    }

    pub fn subscribe_status(&self) -> broadcast::Receiver<(String, ProcessState)> {
        self.status_sender.subscribe()
    }

    pub fn spawn_log_persister(&self) {
        let log_rx = self.subscribe_logs();
        let db_clone = self.db_manager.clone();
        tokio::spawn(async move {
            let mut log_rx = log_rx;
            while let Ok(log) = log_rx.recv().await {
                let db = db_clone.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    if let Err(e) = db.insert_log(&log.project_id, &log.stream, &log.text, log.timestamp) {
                        eprintln!("SQLite log insert error: {}", e);
                    }
                    let limit = match db.get_project_max_log_lines(&log.project_id) {
                        Ok(Some(limit)) if limit > 0 => limit as usize,
                        _ => 5000,
                    };
                    if let Err(e) = db.prune_logs(&log.project_id, limit) {
                        eprintln!("SQLite log pruning error: {}", e);
                    }
                }).await;
            }
        });
    }

    pub(crate) fn update_state(&mut self, project_id: &str, new_state: ProcessState) {
        if let Some(inst) = self.instances.get_mut(project_id) {
            inst.state = new_state.clone();
            let _ = self.status_sender.send((project_id.to_string(), new_state));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ProjectConfig;

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
            source: None,
            terminal_mode: None,
            toolchain: None,
            toolchain_version: None,
            enable_tunnel: None,
            max_log_lines: None,
        };
        pm.register_project(config.clone()).await.unwrap();
        assert_eq!(pm.get_configs().len(), 1);
        assert_eq!(pm.get_state("test-id"), Some(ProcessState::Stopped));
        let _ = std::fs::remove_dir_all(log_dir);
    }
}
