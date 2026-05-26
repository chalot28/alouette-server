use std::path::{Path, PathBuf};
use rusqlite::{params, Connection};
use crate::config::{ProjectConfig, SandboxConfig, LanguageRuntime, LanguageTool};
use crate::process::ProcessLog;

/// A high-performance, thread-safe manager for the SQLite persistence layer.
/// Handles SQLite operations inside dedicated or on-demand connection contexts,
/// optimized for multi-threaded access using WAL journal mode.
#[derive(Debug, Clone)]
pub struct DbManager {
    db_path: PathBuf,
}

impl DbManager {
    /// Instantiates a new database manager targeting the specified path.
    pub fn new<P: AsRef<Path>>(db_path: P) -> Self {
        DbManager {
            db_path: db_path.as_ref().to_path_buf(),
        }
    }

    /// Initializes tables, sets WAL mode for concurrent execution safety,
    /// and establishes standard indices.
    pub fn init(&self) -> Result<(), String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        // Enable Write-Ahead Logging (WAL) for safe concurrent reads/writes
        let _: String = conn
            .query_row("PRAGMA journal_mode=WAL;", [], |row| row.get(0))
            .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

        // Enable foreign key cascading constraints
        conn.execute("PRAGMA foreign_keys = ON;", [])
            .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;

        // 1. Create Server Configurations Table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                command TEXT NOT NULL,
                args TEXT NOT NULL,
                cwd TEXT,
                setup_command TEXT,
                setup_args TEXT,
                auto_restart INTEGER,
                env TEXT,
                max_cpu_percent INTEGER,
                max_ram_mb INTEGER,
                port INTEGER,
                source TEXT,
                terminal_mode TEXT,
                toolchain TEXT,
                toolchain_version TEXT,
                enable_tunnel INTEGER,
                max_log_lines INTEGER
            );",
            [],
        )
        .map_err(|e| format!("Failed to create projects table: {}", e))?;

        // Dynamic column migration for backward compatibility
        let _ = conn.execute("ALTER TABLE projects ADD COLUMN max_log_lines INTEGER;", []);

        // 2. Create Process/Server Execution Logs Table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                stream TEXT NOT NULL,
                text TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );",
            [],
        )
        .map_err(|e| format!("Failed to create logs table: {}", e))?;

        // Create composite index for ultra-fast historical log queries
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_logs_project_timestamp ON logs(project_id, timestamp);",
            [],
        )
        .map_err(|e| format!("Failed to create logs index: {}", e))?;

        // 3. Create Sandbox Configurations Table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sandbox_configs (
                project_id TEXT PRIMARY KEY,
                config TEXT NOT NULL
            );",
            [],
        )
        .map_err(|e| format!("Failed to create sandbox_configs table: {}", e))?;

        // 4. Create Language Runtimes Table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS language_runtimes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                install_command TEXT NOT NULL,
                versions TEXT NOT NULL DEFAULT '[]',
                tools TEXT NOT NULL DEFAULT '[]'
            );",
            [],
        )
        .map_err(|e| format!("Failed to create language_runtimes table: {}", e))?;

        Ok(())
    }

    /// Persists or updates a server/project configuration in SQLite.
    pub fn save_project(&self, config: &ProjectConfig) -> Result<(), String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        let args_json = serde_json::to_string(&config.args)
            .map_err(|e| format!("Failed to serialize args: {}", e))?;

        let setup_args_json = config
            .setup_args
            .as_ref()
            .map(|sa| serde_json::to_string(sa))
            .transpose()
            .map_err(|e| format!("Failed to serialize setup_args: {}", e))?;

        let env_json = config
            .env
            .as_ref()
            .map(|env| serde_json::to_string(env))
            .transpose()
            .map_err(|e| format!("Failed to serialize env: {}", e))?;

        let auto_restart_int = config.auto_restart.map(|b| if b { 1 } else { 0 });
        let enable_tunnel_int = config.enable_tunnel.map(|b| if b { 1 } else { 0 });

        conn.execute(
            "INSERT OR REPLACE INTO projects (
                id, name, command, args, cwd, setup_command, setup_args,
                auto_restart, env, max_cpu_percent, max_ram_mb, port,
                source, terminal_mode, toolchain, toolchain_version, enable_tunnel, max_log_lines
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18);",
            params![
                config.id,
                config.name,
                config.command,
                args_json,
                config.cwd,
                config.setup_command,
                setup_args_json,
                auto_restart_int,
                env_json,
                config.max_cpu_percent,
                config.max_ram_mb,
                config.port,
                config.source,
                config.terminal_mode,
                config.toolchain,
                config.toolchain_version,
                enable_tunnel_int,
                config.max_log_lines
            ],
        )
        .map_err(|e| format!("Failed to save project config: {}", e))?;

        Ok(())
    }

    /// Deregisters a server/project configuration, cascading deletion to all related logs.
    pub fn delete_project(&self, project_id: &str) -> Result<(), String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        conn.execute("PRAGMA foreign_keys = ON;", [])
            .map_err(|e| format!("Failed to enforce foreign keys: {}", e))?;

        conn.execute("DELETE FROM projects WHERE id = ?1;", params![project_id])
            .map_err(|e| format!("Failed to delete project: {}", e))?;

        Ok(())
    }

    /// Loads all saved server/project configurations from SQLite.
    pub fn load_projects(&self) -> Result<Vec<ProjectConfig>, String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        let mut stmt = conn
            .prepare(
                "SELECT id, name, command, args, cwd, setup_command, setup_args,
                        auto_restart, env, max_cpu_percent, max_ram_mb, port,
                        source, terminal_mode, toolchain, toolchain_version, enable_tunnel, max_log_lines
                 FROM projects;",
            )
            .map_err(|e| format!("Failed to prepare select query: {}", e))?;

        let project_iter = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let name: String = row.get(1)?;
                let command: String = row.get(2)?;
                let args_raw: String = row.get(3)?;
                let cwd: Option<String> = row.get(4)?;
                let setup_command: Option<String> = row.get(5)?;
                let setup_args_raw: Option<String> = row.get(6)?;
                let auto_restart_int: Option<i32> = row.get(7)?;
                let env_raw: Option<String> = row.get(8)?;
                let max_cpu_percent: Option<u32> = row.get(9)?;
                let max_ram_mb: Option<u64> = row.get(10)?;
                let port: Option<u16> = row.get(11)?;
                let source: Option<String> = row.get(12)?;
                let terminal_mode: Option<String> = row.get(13)?;
                let toolchain: Option<String> = row.get(14)?;
                let toolchain_version: Option<String> = row.get(15)?;
                let enable_tunnel_int: Option<i32> = row.get(16)?;
                let max_log_lines: Option<u32> = row.get(17)?;

                let args: Vec<String> = serde_json::from_str(&args_raw).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        3,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })?;

                let setup_args: Option<Vec<String>> = setup_args_raw
                    .map(|s| serde_json::from_str(&s))
                    .transpose()
                    .map_err(|e| {
                        rusqlite::Error::FromSqlConversionFailure(
                            6,
                            rusqlite::types::Type::Text,
                            Box::new(e),
                        )
                    })?;

                let env: Option<std::collections::HashMap<String, String>> = env_raw
                    .map(|s| serde_json::from_str(&s))
                    .transpose()
                    .map_err(|e| {
                        rusqlite::Error::FromSqlConversionFailure(
                            8,
                            rusqlite::types::Type::Text,
                            Box::new(e),
                        )
                    })?;

                let auto_restart = auto_restart_int.map(|i| i != 0);
                let enable_tunnel = enable_tunnel_int.map(|i| i != 0);

                Ok(ProjectConfig {
                    id,
                    name,
                    command,
                    args,
                    cwd,
                    setup_command,
                    setup_args,
                    auto_restart,
                    env,
                    max_cpu_percent,
                    max_ram_mb,
                    port,
                    source,
                    terminal_mode,
                    toolchain,
                    toolchain_version,
                    enable_tunnel,
                    max_log_lines,
                })
            })
            .map_err(|e| format!("Failed to query projects: {}", e))?;

        let mut projects = Vec::new();
        for proj in project_iter {
            projects.push(proj.map_err(|e| format!("Failed to read project row: {}", e))?);
        }

        Ok(projects)
    }

    /// Inserts a new execution log line into SQLite.
    pub fn insert_log(
        &self,
        project_id: &str,
        stream: &str,
        text: &str,
        timestamp: u64,
    ) -> Result<(), String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        conn.execute(
            "INSERT INTO logs (project_id, stream, text, timestamp) VALUES (?1, ?2, ?3, ?4);",
            params![project_id, stream, text, timestamp as i64],
        )
        .map_err(|e| format!("Failed to insert log: {}", e))?;

        Ok(())
    }

    /// Fetches the configured max log lines retention limit for a project.
    pub fn get_project_max_log_lines(&self, project_id: &str) -> Result<Option<u32>, String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        let mut stmt = conn
            .prepare("SELECT max_log_lines FROM projects WHERE id = ?1;")
            .map_err(|e| format!("Failed to prepare select query: {}", e))?;

        let mut rows = stmt
            .query(params![project_id])
            .map_err(|e| format!("Failed to query project max_log_lines: {}", e))?;

        if let Some(row) = rows.next().map_err(|e| format!("Failed to read next row: {}", e))? {
            let max_lines: Option<u32> = row.get(0).map_err(|e| format!("Failed to convert field: {}", e))?;
            Ok(max_lines)
        } else {
            Ok(None)
        }
    }

    /// Prunes database logs, preserving only the most recent N lines for a specific project.
    pub fn prune_logs(&self, project_id: &str, keep_limit: usize) -> Result<(), String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        conn.execute(
            "DELETE FROM logs
             WHERE project_id = ?1
               AND id NOT IN (
                   SELECT id FROM logs
                   WHERE project_id = ?1
                   ORDER BY timestamp DESC, id DESC
                   LIMIT ?2
               );",
            params![project_id, keep_limit as i64],
        )
        .map_err(|e| format!("Failed to prune logs: {}", e))?;

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════
    // Sandbox Config CRUD
    // ═══════════════════════════════════════════════════════════════

    /// Save a sandbox configuration for a project.
    pub fn save_sandbox_config(&self, config: &SandboxConfig) -> Result<(), String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        let config_json = serde_json::to_string(config)
            .map_err(|e| format!("Failed to serialize sandbox config: {}", e))?;

        conn.execute(
            "INSERT OR REPLACE INTO sandbox_configs (project_id, config) VALUES (?1, ?2);",
            params![config.project_id, config_json],
        )
        .map_err(|e| format!("Failed to save sandbox config: {}", e))?;

        Ok(())
    }

    /// Load a sandbox config for a specific project.
    pub fn load_sandbox_config(&self, project_id: &str) -> Result<Option<SandboxConfig>, String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        let mut stmt = conn
            .prepare("SELECT config FROM sandbox_configs WHERE project_id = ?1;")
            .map_err(|e| format!("Failed to prepare select: {}", e))?;

        let mut rows = stmt
            .query(params![project_id])
            .map_err(|e| format!("Failed to query sandbox config: {}", e))?;

        if let Some(row) = rows.next().map_err(|e| format!("Failed to read row: {}", e))? {
            let config_json: String = row.get(0).map_err(|e| format!("Failed to get config: {}", e))?;
            let config: SandboxConfig = serde_json::from_str(&config_json)
                .map_err(|e| format!("Failed to parse sandbox config: {}", e))?;
            Ok(Some(config))
        } else {
            Ok(None)
        }
    }

    /// Load all sandbox configs.
    pub fn load_all_sandbox_configs(&self) -> Result<Vec<SandboxConfig>, String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        let mut stmt = conn
            .prepare("SELECT config FROM sandbox_configs;")
            .map_err(|e| format!("Failed to prepare select all: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                let config_json: String = row.get(0)?;
                Ok(config_json)
            })
            .map_err(|e| format!("Failed to query all sandbox configs: {}", e))?;

        let mut configs = Vec::new();
        for row in rows {
            let json = row.map_err(|e| format!("Failed to read row: {}", e))?;
            let config: SandboxConfig = serde_json::from_str(&json)
                .map_err(|e| format!("Failed to parse sandbox config: {}", e))?;
            configs.push(config);
        }

        Ok(configs)
    }

    /// Delete a sandbox configuration for a project.
    pub fn delete_sandbox_config(&self, project_id: &str) -> Result<(), String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        conn.execute(
            "DELETE FROM sandbox_configs WHERE project_id = ?1;",
            params![project_id],
        )
        .map_err(|e| format!("Failed to delete sandbox config: {}", e))?;

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════
    // Language Runtime CRUD
    // ═══════════════════════════════════════════════════════════════

    pub fn save_language_runtime(&self, runtime: &LanguageRuntime) -> Result<(), String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        let versions_json = serde_json::to_string(&runtime.versions)
            .map_err(|e| format!("Failed to serialize versions: {}", e))?;
        let tools_json = serde_json::to_string(&runtime.tools)
            .map_err(|e| format!("Failed to serialize tools: {}", e))?;

        conn.execute(
            "INSERT OR REPLACE INTO language_runtimes (id, name, install_command, versions, tools) VALUES (?1, ?2, ?3, ?4, ?5);",
            rusqlite::params![runtime.id, runtime.name, runtime.install_command, versions_json, tools_json],
        )
        .map_err(|e| format!("Failed to save language runtime: {}", e))?;

        Ok(())
    }

    pub fn load_all_language_runtimes(&self) -> Result<Vec<LanguageRuntime>, String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        let mut stmt = conn
            .prepare("SELECT id, name, install_command, versions, tools FROM language_runtimes;")
            .map_err(|e| format!("Failed to prepare select: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let name: String = row.get(1)?;
                let install_command: String = row.get(2)?;
                let versions_json: String = row.get(3)?;
                let tools_json: String = row.get(4)?;
                Ok((id, name, install_command, versions_json, tools_json))
            })
            .map_err(|e| format!("Failed to query: {}", e))?;

        let mut runtimes = Vec::new();
        for row in rows {
            let (id, name, install_command, versions_json, tools_json) = row
                .map_err(|e| format!("Failed to read row: {}", e))?;
            let versions: Vec<String> = serde_json::from_str(&versions_json)
                .map_err(|e| format!("Failed to parse versions: {}", e))?;
            let tools: Vec<LanguageTool> = serde_json::from_str(&tools_json)
                .map_err(|e| format!("Failed to parse tools: {}", e))?;
            runtimes.push(LanguageRuntime { id, name, install_command, versions, tools });
        }
        Ok(runtimes)
    }

    pub fn delete_language_runtime(&self, runtime_id: &str) -> Result<(), String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;
        conn.execute(
            "DELETE FROM language_runtimes WHERE id = ?1;",
            rusqlite::params![runtime_id],
        )
        .map_err(|e| format!("Failed to delete language runtime: {}", e))?;
        Ok(())
    }

    /// Retrieves the last N logs chronologically for a project.
    pub fn get_logs(&self, project_id: &str, limit: usize) -> Result<Vec<ProcessLog>, String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        let mut stmt = conn
            .prepare(
                "SELECT project_id, stream, text, timestamp
                 FROM logs
                 WHERE project_id = ?1
                 ORDER BY timestamp DESC, id DESC
                 LIMIT ?2;",
            )
            .map_err(|e| format!("Failed to prepare logs query: {}", e))?;

        let log_iter = stmt
            .query_map(params![project_id, limit as i64], |row| {
                let project_id: String = row.get(0)?;
                let stream: String = row.get(1)?;
                let text: String = row.get(2)?;
                let timestamp_i64: i64 = row.get(3)?;

                Ok(ProcessLog {
                    project_id,
                    stream,
                    text,
                    timestamp: timestamp_i64 as u64,
                })
            })
            .map_err(|e| format!("Failed to query logs: {}", e))?;

        let mut logs = Vec::new();
        for log in log_iter {
            logs.push(log.map_err(|e| format!("Failed to read log: {}", e))?);
        }

        // Since we queried with DESC to get latest, reverse it to return chronologically
        logs.reverse();

        Ok(logs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_sqlite_persistence_flow() {
        let temp_dir = std::env::temp_dir();
        let db_file = temp_dir.join("alouette_test_db.db");
        let _ = fs::remove_file(&db_file); // Clean up if any left

        let db = DbManager::new(&db_file);
        assert!(db.init().is_ok());

        // Test configuration insertion
        let project = ProjectConfig {
            id: "test-db-id".to_string(),
            name: "Test DB Project".to_string(),
            command: "echo".to_string(),
            args: vec!["hello".to_string(), "world".to_string()],
            cwd: Some("/test/path".to_string()),
            setup_command: None,
            setup_args: None,
            auto_restart: Some(true),
            env: Some({
                let mut map = std::collections::HashMap::new();
                map.insert("KEY".to_string(), "VAL".to_string());
                map
            }),
            max_cpu_percent: Some(90),
            max_ram_mb: Some(1024),
            port: Some(8080),
            source: None,
            terminal_mode: None,
            toolchain: None,
            toolchain_version: None,
            enable_tunnel: None,
            max_log_lines: Some(100),
        };

        assert!(db.save_project(&project).is_ok());

        // Load & verify configurations
        let loaded = db.load_projects().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "test-db-id");
        assert_eq!(loaded[0].name, "Test DB Project");
        assert_eq!(loaded[0].args, vec!["hello".to_string(), "world".to_string()]);
        assert_eq!(loaded[0].port, Some(8080));
        assert_eq!(loaded[0].auto_restart, Some(true));
        assert_eq!(loaded[0].max_log_lines, Some(100));

        // Verify get_project_max_log_lines helper
        assert_eq!(db.get_project_max_log_lines("test-db-id").unwrap(), Some(100));
        assert_eq!(db.get_project_max_log_lines("non-existent-id").unwrap(), None);

        // Test log insertion & retrieval
        assert!(db.insert_log("test-db-id", "stdout", "log line 1", 1000).is_ok());
        assert!(db.insert_log("test-db-id", "stderr", "log line 2", 2000).is_ok());
        assert!(db.insert_log("test-db-id", "stdout", "log line 3", 3000).is_ok());

        let logs = db.get_logs("test-db-id", 2).unwrap();
        assert_eq!(logs.len(), 2);
        // Reversed chronologically
        assert_eq!(logs[0].text, "log line 2");
        assert_eq!(logs[1].text, "log line 3");

        // Test pruning (keep only 2 logs)
        assert!(db.prune_logs("test-db-id", 2).is_ok());
        let logs_after_prune = db.get_logs("test-db-id", 10).unwrap();
        assert_eq!(logs_after_prune.len(), 2);
        assert_eq!(logs_after_prune[0].text, "log line 2");
        assert_eq!(logs_after_prune[1].text, "log line 3");

        // Test deletion cascading
        assert!(db.delete_project("test-db-id").is_ok());
        let loaded_empty = db.load_projects().unwrap();
        assert_eq!(loaded_empty.len(), 0);

        // Logs should be deleted as well due to cascading
        let logs_empty = db.get_logs("test-db-id", 10).unwrap();
        assert_eq!(logs_empty.len(), 0);

        let _ = fs::remove_file(&db_file);
    }
}
