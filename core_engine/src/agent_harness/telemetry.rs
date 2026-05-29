use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub timestamp: String,
    pub session_id: String,
    pub action: String,
    pub target: String,
    pub parameters: serde_json::Value,
    pub sandbox_verdict: String,
    pub execution_duration_ms: u64,
    pub exit_status: String,
    pub token_usage: Option<TokenUsage>,
    pub hook_triggered: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PerformanceMetrics {
    pub total_tool_calls: u32,
    pub successful_tool_calls: u32,
    pub failed_tool_calls: u32,
    pub total_execution_time_ms: u64,
    pub average_execution_time_ms: f64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMetrics {
    pub session_id: String,
    pub started_at: String,
    pub tool_calls_by_type: HashMap<String, u32>,
    pub failures_by_type: HashMap<String, u32>,
    pub total_duration_ms: u64,
    pub metrics: PerformanceMetrics,
}

pub struct TelemetryManager {
    audit_file_path: PathBuf,
    session_metrics: HashMap<String, SessionMetrics>,
}

impl TelemetryManager {
    pub fn new<P: AsRef<Path>>(workspace_root: P) -> Self {
        let audit_dir = workspace_root.as_ref().join("logs/agent_audit");
        let _ = fs::create_dir_all(&audit_dir);
        Self {
            audit_file_path: audit_dir.join("telemetry.jsonl"),
            session_metrics: HashMap::new(),
        }
    }

    /// Logs a structured audit trail with enhanced tracking
    pub fn log_audit(&self, entry: &AuditEntry) {
        if let Ok(serialized) = serde_json::to_string(entry) {
            let mut file_content = serialized;
            file_content.push('\n');
            let _ = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.audit_file_path)
                .map(|mut f| {
                    let _ = f.write_all(file_content.as_bytes());
                });
        }
    }

    /// Track tool usage per session (in-memory)
    pub fn track_tool_call(&mut self, session_id: &str, tool_name: &str, success: bool, duration_ms: u64, tokens: Option<TokenUsage>) {
        let metrics = self.session_metrics.entry(session_id.to_string())
            .or_insert_with(|| SessionMetrics {
                session_id: session_id.to_string(),
                started_at: chrono::Local::now().to_rfc3339(),
                tool_calls_by_type: HashMap::new(),
                failures_by_type: HashMap::new(),
                total_duration_ms: 0,
                metrics: PerformanceMetrics::default(),
            });

        metrics.total_duration_ms += duration_ms;
        metrics.metrics.total_tool_calls += 1;
        *metrics.tool_calls_by_type.entry(tool_name.to_string()).or_insert(0) += 1;

        if success {
            metrics.metrics.successful_tool_calls += 1;
        } else {
            metrics.metrics.failed_tool_calls += 1;
            *metrics.failures_by_type.entry(tool_name.to_string()).or_insert(0) += 1;
        }

        metrics.metrics.total_execution_time_ms += duration_ms;
        metrics.metrics.average_execution_time_ms =
            metrics.metrics.total_execution_time_ms as f64 / metrics.metrics.total_tool_calls.max(1) as f64;

        if let Some(ref tracked_tokens) = tokens {
            metrics.metrics.total_input_tokens += tracked_tokens.input_tokens;
            metrics.metrics.total_output_tokens += tracked_tokens.output_tokens;
            metrics.metrics.total_tokens += tracked_tokens.total_tokens;
        }

        // Also persist to audit log
        self.log_audit(&AuditEntry {
            timestamp: chrono::Local::now().to_rfc3339(),
            session_id: session_id.to_string(),
            action: tool_name.to_string(),
            target: String::new(),
            parameters: serde_json::json!({}),
            sandbox_verdict: "Approved".to_string(),
            execution_duration_ms: duration_ms,
            exit_status: if success { "Success".to_string() } else { "Failure".to_string() },
            token_usage: tokens,
            hook_triggered: false,
        });
    }

    /// Get comprehensive metrics for a session
    pub fn get_metrics(&self, session_id: &str) -> PerformanceMetrics {
        // First check in-memory
        if let Some(session) = self.session_metrics.get(session_id) {
            return session.metrics.clone();
        }

        // Fallback: scan the audit log
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
                        if let Some(ref tokens) = entry.token_usage {
                            metrics.total_input_tokens += tokens.input_tokens;
                            metrics.total_output_tokens += tokens.output_tokens;
                            metrics.total_tokens += tokens.total_tokens;
                        }
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

    /// Get session metrics summary
    pub fn get_session_metrics(&self, session_id: &str) -> Option<SessionMetrics> {
        self.session_metrics.get(session_id).cloned()
    }

    /// Compute aggregate metrics across all sessions
    pub fn get_aggregate_metrics(&self) -> PerformanceMetrics {
        let mut aggregate = PerformanceMetrics::default();

        for (_id, session) in &self.session_metrics {
            aggregate.total_tool_calls += session.metrics.total_tool_calls;
            aggregate.successful_tool_calls += session.metrics.successful_tool_calls;
            aggregate.failed_tool_calls += session.metrics.failed_tool_calls;
            aggregate.total_execution_time_ms += session.metrics.total_execution_time_ms;
            aggregate.total_input_tokens += session.metrics.total_input_tokens;
            aggregate.total_output_tokens += session.metrics.total_output_tokens;
            aggregate.total_tokens += session.metrics.total_tokens;
        }

        if aggregate.total_tool_calls > 0 {
            aggregate.average_execution_time_ms =
                aggregate.total_execution_time_ms as f64 / aggregate.total_tool_calls as f64;
        }

        aggregate
    }
}
