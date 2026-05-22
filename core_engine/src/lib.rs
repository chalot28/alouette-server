pub mod config;
pub mod monitor;
pub mod process;

// Re-export key structs for convenience
pub use config::{ProjectConfig, ProjectsConfig};
pub use monitor::{ResourceMonitor, ResourceStats};
pub use process::{ProcessManager, ProcessState, ProcessLog, terminate_process_tree};
