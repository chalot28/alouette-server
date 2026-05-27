use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub timestamp: String,
    pub session_id: String,
    pub action: String,
    pub target: String,
    pub parameters: serde_json::Value,
    pub sandbox_verdict: String, // "Approved" | "Rejected" | "Bypassed"
    pub execution_duration_ms: u64,
    pub exit_status: String, // "Success" | "Failure"
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PerformanceMetrics {
    pub total_tool_calls: u32,
    pub successful_tool_calls: u32,
    pub failed_tool_calls: u32,
    pub total_execution_time_ms: u64,
    pub average_execution_time_ms: f64,
}

pub struct TelemetryManager {
    audit_file_path: PathBuf,
}

impl TelemetryManager {
    pub fn new<P: AsRef<Path>>(workspace_root: P) -> Self {
        let audit_dir = workspace_root.as_ref().join("logs/agent_audit");
        let _ = fs::create_dir_all(&audit_dir);
        Self {
            audit_file_path: audit_dir.join("telemetry.jsonl"),
        }
    }

    /// Logs a structured audit trail of the agent's tool execution.
    pub fn log_audit(&self, entry: &AuditEntry) {
        if let Ok(serialized) = serde_json::to_string(entry) {
            let mut file_content = serialized;
            file_content.push('\n');
            let _ = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.audit_file_path)
                .map(|mut f| {
                    use std::io::Write;
                    let _ = f.write_all(file_content.as_bytes());
                });
        }
    }

    /// Computes performance metrics for the current session by scanning logs.
    pub fn get_metrics(&self, session_id: &str) -> PerformanceMetrics {
        let mut metrics = PerformanceMetrics::default();
        if let Ok(content) = fs::read_to_string(&self.audit_file_path) {
            for line in content.lines() {
                if let Ok(entry) = serde_json::from_str::<AuditEntry>(line) {
                    if entry.session_id == session_id {
                        metrics.total_tool_calls += 1;
                        if entry.exit_status == "Success" {
                            metrics.successful_tool_calls += 1;
                        } else {
                            metrics.failed_tool_calls += 1;
                        }
                        metrics.total_execution_time_ms += entry.execution_duration_ms;
                    }
                }
            }
        }

        if metrics.total_tool_calls > 0 {
            metrics.average_execution_time_ms =
                metrics.total_execution_time_ms as f64 / metrics.total_tool_calls as f64;
        }

        metrics
    }
}
