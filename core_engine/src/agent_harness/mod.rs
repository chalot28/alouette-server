use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};


pub mod parser;
pub mod telemetry;
pub mod self_heal;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub role: String, // "user" | "model" | "system"
    pub content: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub session_id: String,
    pub history: Vec<ChatMessage>,
    pub current_thought: Option<String>,
    pub pending_tool: Option<parser::ToolCall>,
}

pub struct AgentHarness {
    workspace_root: PathBuf,
    telemetry: telemetry::TelemetryManager,
}

impl AgentHarness {
    pub fn new<P: AsRef<Path>>(workspace_root: P) -> Self {
        let canonical_root = fs::canonicalize(&workspace_root)
            .unwrap_or_else(|_| workspace_root.as_ref().to_path_buf());
        let telemetry = telemetry::TelemetryManager::new(&canonical_root);
        Self {
            workspace_root: canonical_root,
            telemetry,
        }
    }

    /// Load the modular prompts, CLAUDE.md, and high-fidelity Git context.
    pub fn assemble_system_prompt(&self) -> String {
        let identity_path = self.workspace_root.join("core_engine/src/agent_harness/prompts/identity.txt");
        let tools_path = self.workspace_root.join("core_engine/src/agent_harness/prompts/tools.txt");

        let identity = fs::read_to_string(&identity_path).unwrap_or_else(|_| {
            "You are a helpful AI assistant. Always think in a <thought> block before acting.".to_string()
        });

        let tools_guidelines = fs::read_to_string(&tools_path).unwrap_or_else(|_| {
            "Available tools: check_port, execute_command, read_file, write_file.".to_string()
        });

        // Scan for CLAUDE.md in workspace root
        let claude_md_path = self.workspace_root.join("CLAUDE.md");
        let claude_context = if claude_md_path.exists() {
            fs::read_to_string(&claude_md_path).unwrap_or_default()
        } else {
            "".to_string()
        };

        // High-Fidelity Git Workspace State Integration
        let git_status = self.get_git_status();
        let git_branch = self.get_git_branch();

        let mut prompt = String::new();
        prompt.push_str(&identity);
        prompt.push_str("\n\n");
        prompt.push_str(&tools_guidelines);

        if !claude_context.is_empty() {
            prompt.push_str("\n\n## Project Specific Guidelines (CLAUDE.md):\n");
            prompt.push_str(&claude_context);
        }

        prompt.push_str(&format!(
            "\n\n## Current Environment:\n- Operating System: {}\n- Workspace Path: {}\n",
            std::env::consts::OS,
            self.workspace_root.display()
        ));

        if !git_branch.is_empty() {
            prompt.push_str(&format!("- Active Git Branch: {}\n", git_branch));
        }
        if !git_status.is_empty() {
            prompt.push_str(&format!("\n## Git Status Context:\n```\n{}\n```\n", git_status));
        }

        prompt
    }

    /// Highly secure path validation with canonicalization.
    pub fn validate_path(&self, target_path: &Path) -> Result<PathBuf, String> {
        let absolute_target = if target_path.is_absolute() {
            target_path.to_path_buf()
        } else {
            self.workspace_root.join(target_path)
        };

        let canonical_target = match fs::canonicalize(&absolute_target) {
            Ok(path) => path,
            Err(_) => {
                let mut path = PathBuf::new();
                for component in absolute_target.components() {
                    match component {
                        std::path::Component::ParentDir => {
                            path.pop();
                        }
                        std::path::Component::Normal(c) => {
                            path.push(c);
                        }
                        std::path::Component::CurDir => {}
                        other => {
                            path.push(other.as_os_str());
                        }
                    }
                }
                path
            }
        };

        let ws_str = self.workspace_root.to_string_lossy().replace("\\\\?\\", "").to_lowercase();
        let target_str = canonical_target.to_string_lossy().replace("\\\\?\\", "").to_lowercase();

        if target_str.starts_with(&ws_str) {
            Ok(canonical_target)
        } else {
            Err(format!(
                "Security Boundary Error: Access to '{}' is forbidden. It is outside the workspace root '{}'.",
                target_str, ws_str
            ))
        }
    }

    /// Automatically compacts chat history.
    pub fn compact_history(history: &mut Vec<ChatMessage>, max_messages: usize) {
        if history.len() <= max_messages {
            return;
        }

        let mut compacted = Vec::new();
        if !history.is_empty() {
            compacted.push(history[0].clone());
        }

        let keep_start = history.len() - (max_messages - 1);
        compacted.extend(history[keep_start..].iter().cloned());
        
        *history = compacted;
    }

    /// Execute a tool call safely with telemetry and self-healing analysis.
    pub async fn execute_tool(&self, session_id: &str, tool: &parser::ToolCall) -> Result<String, String> {
        let start_time = std::time::Instant::now();
        let mut exit_status = "Success";
        
        let result = match tool.name.as_str() {
            "check_port" => {
                let port = tool.arguments["port"]
                    .as_u64()
                    .ok_or_else(|| "Missing 'port' argument".to_string())? as u16;

                let is_available = std::net::TcpListener::bind(("127.0.0.1", port)).is_ok();
                if is_available {
                    Ok(format!("✓ Port {} is currently FREE and available.", port))
                } else {
                    Ok(format!("✕ Port {} is currently IN USE by another process.", port))
                }
            }
            "read_file" => {
                let path_str = tool.arguments["path"]
                    .as_str()
                    .ok_or_else(|| "Missing 'path' argument".to_string())?;
                
                let target_path = Path::new(path_str);
                let verified_path = self.validate_path(target_path)?;

                fs::read_to_string(&verified_path)
                    .map_err(|e| format!("Failed to read file: {}", e))
            }
            "write_file" => {
                let path_str = tool.arguments["path"]
                    .as_str()
                    .ok_or_else(|| "Missing 'path' argument".to_string())?;
                
                let content = tool.arguments["content"]
                    .as_str()
                    .ok_or_else(|| "Missing 'content' argument".to_string())?;

                let target_path = Path::new(path_str);
                let verified_path = self.validate_path(target_path)?;

                if let Some(parent) = verified_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }

                fs::write(&verified_path, content)
                    .map(|_| format!("✓ Successfully wrote {} bytes to file: {}", content.len(), path_str))
                    .map_err(|e| format!("Failed to write file: {}", e))
            }
            "get_project_files" => {
                let mut files = Vec::new();
                self.list_dir_recursive(&self.workspace_root, &mut files)?;
                Ok(files.join("\n"))
            }
            "execute_command" => {
                let command = tool.arguments["command"]
                    .as_str()
                    .ok_or_else(|| "Missing 'command' argument".to_string())?;

                let args: Vec<String> = if let Some(arr) = tool.arguments["args"].as_array() {
                    arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
                } else {
                    Vec::new()
                };

                let output = if cfg!(target_os = "windows") {
                    std::process::Command::new("powershell")
                        .args(&["-Command"])
                        .arg(format!("{} {}", command, args.join(" ")))
                        .output()
                } else {
                    std::process::Command::new("sh")
                        .arg("-c")
                        .arg(format!("{} {}", command, args.join(" ")))
                        .output()
                };

                match output {
                    Ok(out) => {
                        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                        let code = out.status.code().unwrap_or(-1);
                        Ok(format!("Exit Code: {}\nSTDOUT:\n{}\nSTDERR:\n{}", code, stdout, stderr))
                    }
                    Err(e) => Err(format!("Failed to execute command: {}", e)),
                }
            }
            _ => Err(format!("Unknown tool: {}", tool.name)),
        };

        let duration = start_time.elapsed().as_millis() as u64;
        let audit_res = match &result {
            Ok(val) => {
                if val.starts_with("✕") {
                    exit_status = "Failure";
                }
                val.clone()
            }
            Err(e) => {
                exit_status = "Failure";
                e.clone()
            }
        };

        // Telemetry Logging
        self.telemetry.log_audit(&telemetry::AuditEntry {
            timestamp: chrono::Local::now().to_rfc3339(),
            session_id: session_id.to_string(),
            action: tool.name.clone(),
            target: tool.arguments.to_string(),
            parameters: tool.arguments.clone(),
            sandbox_verdict: "Approved".to_string(),
            execution_duration_ms: duration,
            exit_status: exit_status.to_string(),
        });

        // Intercept and Self-Heal if failed
        if exit_status == "Failure" {
            let healed_feedback = self_heal::SelfHealAnalyzer::analyze_failure(&tool.name, &tool.arguments, &audit_res);
            Err(healed_feedback)
        } else {
            result
        }
    }

    /// Access active performance metrics
    pub fn get_performance_metrics(&self, session_id: &str) -> telemetry::PerformanceMetrics {
        self.telemetry.get_metrics(session_id)
    }

    fn get_git_branch(&self) -> String {
        let output = std::process::Command::new("git")
            .args(&["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&self.workspace_root)
            .output();

        if let Ok(out) = output {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            "".to_string()
        }
    }

    fn get_git_status(&self) -> String {
        let output = std::process::Command::new("git")
            .args(&["status", "--short"])
            .current_dir(&self.workspace_root)
            .output();

        if let Ok(out) = output {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            "".to_string()
        }
    }

    fn list_dir_recursive(&self, dir: &Path, files: &mut Vec<String>) -> Result<(), String> {
        if dir.is_dir() {
            for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                
                if let Some(name) = path.file_name() {
                    let name_str = name.to_string_lossy();
                    if name_str == ".git" || name_str == ".idea" || name_str == "target" || name_str == "node_modules" {
                        continue;
                    }
                }

                if path.is_dir() {
                    self.list_dir_recursive(&path, files)?;
                } else {
                    if let Ok(rel) = path.strip_prefix(&self.workspace_root) {
                        files.push(rel.display().to_string());
                    }
                }
            }
        }
        Ok(())
    }
}
