use std::path::{Path, PathBuf};
use tokio::sync::broadcast;
use sysinfo::{System, Pid};

use super::models::ProcessState;

// ----------------- Shell Navigation Security Helpers -----------------
pub(crate) fn normalize_path(path: &Path) -> PathBuf {
    let components = path.components();
    let mut ret = PathBuf::new();
    for component in components {
        match component {
            std::path::Component::Prefix(..) => {
                ret.push(component.as_os_str());
            }
            std::path::Component::RootDir => {
                ret.push(component.as_os_str());
            }
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                ret.pop();
            }
            std::path::Component::Normal(c) => {
                ret.push(c);
            }
        }
    }
    ret
}

// Struct to handle background status broadcasts cleanly
pub(crate) struct StateUpdater {
    pub project_id: String,
    pub sender: broadcast::Sender<(String, ProcessState)>,
}

impl StateUpdater {
    pub fn update(&mut self, state: ProcessState) {
        let _ = self.sender.send((self.project_id.clone(), state));
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
        let _ = tokio::process::Command::new("taskkill")
            .args(&["/F", "/T", "/PID", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
    }
}
