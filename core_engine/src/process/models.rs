use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::sync::{broadcast, mpsc};

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
    pub block_internet: bool,
    /// MUST keep child alive or portable-pty kills the process on drop.
    pub _child: Option<Box<dyn portable_pty::Child + Send>>,
    pub _job_handle: Option<usize>,
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        #[cfg(target_os = "windows")]
        if let Some(handle) = self._job_handle {
            unsafe {
                winapi::um::handleapi::CloseHandle(handle as *mut winapi::ctypes::c_void);
            }
        }
    }
}

/// Lightweight context cloned from a TerminalSession, used to process
/// terminal writes entirely outside the ProcessManager mutex lock.
pub struct TerminalWriteContext {
    pub stdin_sender: mpsc::Sender<String>,
    pub terminal_sender: broadcast::Sender<TerminalOutput>,
}

pub struct ProjectInstance {
    pub config: crate::config::ProjectConfig,
    pub state: ProcessState,
    pub stop_sender: Option<tokio::sync::oneshot::Sender<()>>,
}
