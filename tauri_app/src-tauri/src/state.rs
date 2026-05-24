use core_engine::{ProcessManager, ResourceMonitor};
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct AppState {
    pub process_manager: Arc<Mutex<ProcessManager>>,
    pub resource_monitor: Arc<ResourceMonitor>,
}

pub fn log_to_app_file(msg: &str) {
    let log_dir = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_file = log_dir.join("app.log");

    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file)
    {
        use std::io::Write;
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let _ = writeln!(file, "[{}] {}", timestamp, msg);
    }
}
