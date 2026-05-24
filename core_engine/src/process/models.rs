use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::sync::mpsc;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOutput {
    pub session_id: String,
    pub text: String,
}

pub struct TerminalSession {
    pub stdin_sender: mpsc::Sender<String>,
    pub pid: u32,
    pub workspace_root: PathBuf,
    pub current_dir: std::sync::Mutex<PathBuf>,
}

pub struct ProjectInstance {
    pub config: crate::config::ProjectConfig,
    pub state: ProcessState,
    pub stop_sender: Option<tokio::sync::oneshot::Sender<()>>,
}
