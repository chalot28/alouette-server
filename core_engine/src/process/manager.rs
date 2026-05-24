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
}

impl ProcessManager {
    pub fn new<P: AsRef<Path>>(log_dir: P) -> Self {
        let (log_sender, _) = broadcast::channel(1000);
        let (status_sender, _) = broadcast::channel(100);
        let (terminal_sender, _) = broadcast::channel(1000);

        // Ensure log directory exists
        let log_dir_buf = log_dir.as_ref().to_path_buf();
        let _ = std::fs::create_dir_all(&log_dir_buf);

        // Initialize managers (in production these paths would be configurable)
        let is_test = log_dir_buf.to_string_lossy().contains("test");
        let app_data_dir = if is_test {
            log_dir_buf.clone()
        } else {
            std::env::current_dir().unwrap_or_default().join("app_data")
        };
        let _ = std::fs::create_dir_all(&app_data_dir);
        let db_path = app_data_dir.join("alouette.db");

        // Centralized test cleanup: remove old database files on test start to ensure complete state isolation
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

        // Hydrate configurations from SQLite database
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



        // Spawn async background subscriber task to log process outputs to SQLite if tokio runtime is active (e.g. in tests)
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
                        if let Err(e) = db.prune_logs(&log.project_id, 5000) {
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
        }
    }

    /// Performs environment initialization: ensures the private proto binary, fetches stable node/go/python toolchains,
    /// and checks/updates the latest cloudflared binary in the background.
    pub async fn initialize_environment(&mut self) -> Result<(), String> {
        let app_data_dir = std::env::current_dir().unwrap_or_default().join("app_data");
        let bin_dir = app_data_dir.join("bin");

        // 1. Ensure private proto CLI is ready
        let proto_bin = self.proto_manager.ensure_proto_cli(&bin_dir).await?;
        println!("Private proto CLI resides at: {:?}", proto_bin);

        // 2. Ensure stable toolchains are downloaded and installed
        self.proto_manager.ensure_stable_toolchains(&proto_bin).await?;

        // 3. Ensure latest cloudflared is downloaded
        let cloudflared_bin = CloudflaredManager::update_tunnel_binary(&bin_dir).await?;
        self.cloudflared_manager.executable_path = cloudflared_bin;

        Ok(())
    }

    /// Registers a new project tab instance, preparing its workspace immediately if source is specified.
    pub async fn register_project(&mut self, config: ProjectConfig) -> Result<(), String> {
        let id = config.id.clone();
        let mut updated_config = config;

        // If source is provided, clone/copy it immediately into workspaces
        if let Some(ref source) = updated_config.source {
            if !source.trim().is_empty() {
                // Prepare workspace immediately on registration (saving tab settings)
                let dest = self.workspace_manager.prepare_workspace(&id, source).await?;
                updated_config.cwd = Some(dest.to_string_lossy().to_string());
            }
        }

        // Save server configuration to SQLite database
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

    /// Deregisters a project tab instance, terminating it first if running.
    pub async fn deregister_project(&mut self, project_id: &str) -> Result<(), String> {
        let _ = self.stop_process(project_id).await;
        // Delete server configuration (and its logs via ON DELETE CASCADE) from SQLite
        self.db_manager.delete_project(project_id)?;
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

    /// Spawns the background SQLite log writer task. Must be called from inside a Tokio runtime context (e.g. Tauri setup hook).
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
                    if let Err(e) = db.prune_logs(&log.project_id, 5000) {
                        eprintln!("SQLite log pruning error: {}", e);
                    }
                }).await;
            }
        });
    }

    /// Internal helper to update process state and broadcast changes.
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
        };

        pm.register_project(config.clone()).await.unwrap();

        assert_eq!(pm.get_configs().len(), 1);
        assert_eq!(pm.get_state("test-id"), Some(ProcessState::Stopped));

        let _ = std::fs::remove_dir_all(log_dir);
    }
}
