use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub setup_command: Option<String>,
    pub setup_args: Option<Vec<String>>,
    pub auto_restart: Option<bool>,
    pub env: Option<std::collections::HashMap<String, String>>,
    pub max_cpu_percent: Option<u32>,
    pub max_ram_mb: Option<u64>,
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectsConfig {
    pub projects: Vec<ProjectConfig>,
}

impl ProjectsConfig {
    /// Loads a project list configuration from a TOML file.
    pub fn load_from_file<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        if !path.as_ref().exists() {
            // Return empty config if file doesn't exist yet
            return Ok(ProjectsConfig { projects: Vec::new() });
        }
        let content = fs::read_to_string(path)
            .map_err(|e| format!("Failed to read config file: {}", e))?;
        let config: ProjectsConfig = toml::from_str(&content)
            .map_err(|e| format!("Failed to parse TOML config: {}", e))?;
        Ok(config)
    }

    /// Saves the active project list configuration back to a TOML file.
    pub fn save_to_file<P: AsRef<Path>>(&self, path: P) -> Result<(), String> {
        let content = toml::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize TOML config: {}", e))?;
        if let Some(parent) = path.as_ref().parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directories: {}", e))?;
        }
        fs::write(path, content)
            .map_err(|e| format!("Failed to write config file: {}", e))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_config_serialization_deserialization() {
        let project = ProjectConfig {
            id: "test-id".to_string(),
            name: "Test Project".to_string(),
            command: "npm".to_string(),
            args: vec!["run".to_string(), "dev".to_string()],
            cwd: Some("/test/cwd".to_string()),
            setup_command: Some("npm".to_string()),
            setup_args: Some(vec!["install".to_string()]),
            auto_restart: Some(true),
            env: Some({
                let mut map = std::collections::HashMap::new();
                map.insert("NODE_ENV".to_string(), "development".to_string());
                map
            }),
            max_cpu_percent: Some(80),
            max_ram_mb: Some(512),
            port: Some(3000),
        };

        let config = ProjectsConfig {
            projects: vec![project.clone()],
        };

        let serialized = toml::to_string(&config).unwrap();
        let deserialized: ProjectsConfig = toml::from_str(&serialized).unwrap();

        assert_eq!(deserialized.projects.len(), 1);
        assert_eq!(deserialized.projects[0], project);
    }

    #[test]
    fn test_load_save_file() {
        let temp_dir = std::env::temp_dir();
        let test_file_path = temp_dir.join("alouette_test_config.toml");

        let project = ProjectConfig {
            id: "ping-test".to_string(),
            name: "Ping Diagnostics".to_string(),
            command: "ping".to_string(),
            args: vec!["127.0.0.1".to_string()],
            cwd: None,
            setup_command: None,
            setup_args: None,
            auto_restart: Some(false),
            env: None,
            max_cpu_percent: None,
            max_ram_mb: None,
            port: None,
        };

        let config = ProjectsConfig {
            projects: vec![project],
        };

        // Save
        let save_res = config.save_to_file(&test_file_path);
        assert!(save_res.is_ok());

        // Load
        let load_res = ProjectsConfig::load_from_file(&test_file_path);
        assert!(load_res.is_ok());
        let loaded_config = load_res.unwrap();

        assert_eq!(loaded_config.projects.len(), 1);
        assert_eq!(loaded_config.projects[0].id, "ping-test");
        assert_eq!(loaded_config.projects[0].command, "ping");

        // Clean up temp file
        let _ = fs::remove_file(&test_file_path);
    }

    #[test]
    fn test_load_non_existent_file() {
        let non_existent_path = Path::new("non_existent_config_file_xyz_123.toml");
        let load_res = ProjectsConfig::load_from_file(non_existent_path);
        assert!(load_res.is_ok());
        let config = load_res.unwrap();
        assert_eq!(config.projects.len(), 0);
    }

    #[test]
    fn test_malformed_toml() {
        let temp_dir = std::env::temp_dir();
        let malformed_file = temp_dir.join("alouette_malformed.toml");
        let _ = fs::write(&malformed_file, "this is not valid toml = = {");
        
        let res = ProjectsConfig::load_from_file(&malformed_file);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Failed to parse TOML config"));
        
        let _ = fs::remove_file(&malformed_file);
    }

    #[test]
    fn test_project_config_optional_fields() {
        let toml_str = r#"
            [[projects]]
            id = "min-project"
            name = "Minimal Project"
            command = "echo"
            args = []
        "#;
        
        let config_res: Result<ProjectsConfig, _> = toml::from_str(toml_str);
        assert!(config_res.is_ok());
        let config = config_res.unwrap();
        assert_eq!(config.projects.len(), 1);
        let proj = &config.projects[0];
        assert_eq!(proj.id, "min-project");
        assert_eq!(proj.cwd, None);
        assert_eq!(proj.setup_command, None);
        assert_eq!(proj.setup_args, None);
        assert_eq!(proj.auto_restart, None);
    }
}
