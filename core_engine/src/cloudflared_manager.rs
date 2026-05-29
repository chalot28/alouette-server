use std::path::{Path, PathBuf};
use tokio::process::Command;
use tokio::sync::broadcast;
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Clone)]
pub struct CloudflaredManager {
    // Path to the cloudflared executable.
    pub executable_path: PathBuf,
}

impl CloudflaredManager {
    pub fn new(executable_path: PathBuf) -> Self {
        Self { executable_path }
    }

    /// Tries to download/update the latest cloudflared executable. If offline/fails, falls back to existing binary.
    pub async fn update_tunnel_binary(bin_dir: &Path) -> Result<PathBuf, String> {
        let exe_name = if cfg!(target_os = "windows") { "cloudflared.exe" } else { "cloudflared" };
        let path = bin_dir.join(exe_name);

        std::fs::create_dir_all(bin_dir).map_err(|e| format!("Failed to create bin dir: {}", e))?;

        let url = if cfg!(target_os = "windows") {
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
        } else if cfg!(target_os = "macos") {
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64"
        } else {
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
        };

        println!("Checking / downloading latest cloudflared binary...");
        match reqwest::get(url).await {
            Ok(response) => {
                if response.status().is_success() {
                    if let Ok(bytes) = response.bytes().await {
                        if tokio::fs::write(&path, bytes).await.is_ok() {
                            #[cfg(unix)]
                            {
                                use std::os::unix::fs::PermissionsExt;
                                if let Ok(meta) = std::fs::metadata(&path) {
                                    let mut perms = meta.permissions();
                                    perms.set_mode(0o755);
                                    let _ = std::fs::set_permissions(&path, perms);
                                }
                            }
                            println!("Successfully updated cloudflared to latest version.");
                            return Ok(path);
                        }
                    }
                }
            }
            Err(e) => {
                println!("Warning: Failed to update cloudflared binary ({}), checking local fallback...", e);
            }
        }

        if path.exists() {
            println!("Local cloudflared binary fallback found. Proceeding.");
            Ok(path)
        } else {
            Err("Failed to download cloudflared binary and no local fallback exists.".to_string())
        }
    }

    /// Spawns a tunnel and returns the PID and a receiver for the tunnel URL
    pub async fn spawn_tunnel(&self, port: u16, token: Option<String>, _project_id: &str) -> Result<(u32, broadcast::Receiver<String>), String> {
        let mut cmd = Command::new(&self.executable_path);
        
        if let Some(ref t) = token {
            let trimmed_token = t.trim();
            if !trimmed_token.is_empty() {
                cmd.args(["tunnel", "run", "--token", trimmed_token]);
            } else {
                cmd.args(["tunnel", "--url", &format!("http://localhost:{}", port)]);
            }
        } else {
            cmd.args(["tunnel", "--url", &format!("http://localhost:{}", port)]);
        }

        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn cloudflared: {}", e))?;
        let tunnel_pid = child.id().unwrap_or(0);
        
        let stderr = child.stderr.take().expect("Failed to capture cloudflared stderr");
        let (url_tx, url_rx) = broadcast::channel(10);
        let url_tx_clone = url_tx.clone();

        let token_mode = token.is_some() && !token.unwrap().trim().is_empty();

        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            
            if token_mode {
                let _ = url_tx_clone.send("Named Tunnel Active (Configured with Token)".to_string());
            }

            // Cloudflared prints the tunnel URL to stderr
            while let Ok(Some(line)) = reader.next_line().await {
                // Look for: "https://some-random-words.trycloudflare.com"
                if line.contains("https://") && line.contains(".trycloudflare.com") {
                    if let Some(start) = line.find("https://") {
                        let url_part = &line[start..];
                        let url = url_part.split_whitespace().next().unwrap_or(url_part);
                        let _ = url_tx_clone.send(url.to_string());
                    }
                }
            }
            let _ = child.wait().await;
        });

        Ok((tunnel_pid, url_rx))
    }
}
