use std::path::{Path, PathBuf};
use tokio::process::Command;
use fs_extra::dir::{copy, CopyOptions};

pub struct WorkspaceManager {
    pub workspaces_dir: PathBuf,
}

impl WorkspaceManager {
    pub fn new<P: AsRef<Path>>(workspaces_dir: P) -> Self {
        let path = workspaces_dir.as_ref().to_path_buf();
        std::fs::create_dir_all(&path).unwrap_or_default();
        Self { workspaces_dir: path }
    }

    /// Prepares a workspace for a project by either cloning from Git or copying locally.
    pub async fn prepare_workspace(&self, project_id: &str, source: &str) -> Result<PathBuf, String> {
        let dest = self.workspaces_dir.join(project_id);
        
        // If workspace already exists, we might want to clean it or just return it.
        // For strict isolation/freshness, we remove it if requested, but for now let's just return if exists.
        if dest.exists() {
            let _ = std::fs::remove_dir_all(&dest);
        }

        if source.starts_with("http://") || source.starts_with("https://") || source.starts_with("git@") {
            // It's a Git repository
            let status = Command::new("git")
                .args(["clone", source, dest.to_str().unwrap()])
                .status()
                .await
                .map_err(|e| format!("Failed to spawn git clone: {}", e))?;

            if !status.success() {
                return Err(format!("Git clone failed with status: {}", status));
            }
        } else {
            // It's a local directory
            let source_path = Path::new(source);
            if !source_path.exists() || !source_path.is_dir() {
                return Err(format!("Local source directory does not exist: {}", source));
            }            
            // fs_extra copies synchronously. We can wrap it in spawn_blocking for async environment.
            let source_owned = source.to_string();
            let dest_owned = dest.clone();
            
            tokio::task::spawn_blocking(move || {
                std::fs::create_dir_all(&dest_owned).unwrap_or_default();
                // fs_extra::dir::copy copies the folder itself into the target if copy_inside is false,
                // but we want contents. Let's just copy the folder to dest.
                let mut options = CopyOptions::new();
                options.content_only = true;
                copy(source_owned, dest_owned, &options)
            }).await.map_err(|e| e.to_string())?.map_err(|e| format!("Failed to copy directory: {}", e))?;
        }

        Ok(dest)
    }
}
