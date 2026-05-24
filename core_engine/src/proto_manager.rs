use std::path::{Path, PathBuf};
use tokio::process::Command;
use std::env;

pub struct ProtoManager {
    pub proto_home: PathBuf,
}

impl ProtoManager {
    pub fn new<P: AsRef<Path>>(proto_home: P) -> Self {
        let home = proto_home.as_ref().to_path_buf();
        std::fs::create_dir_all(&home).unwrap_or_default();
        Self { proto_home: home }
    }

    /// Checks if proto CLI is installed in bin_dir, downloads and extracts the latest zip if missing on Windows,
    /// or runs shell install script on Unix.
    pub async fn ensure_proto_cli(&self, bin_dir: &Path) -> Result<PathBuf, String> {
        let proto_exe_name = if cfg!(target_os = "windows") { "proto.exe" } else { "proto" };
        let proto_path = bin_dir.join(proto_exe_name);

        let proto_shim_name = if cfg!(target_os = "windows") { "proto-shim.exe" } else { "proto-shim" };
        let proto_shim_path = bin_dir.join(proto_shim_name);

        // Ensure the proto-shim is copied to PROTO_HOME/bin/ directory even if files already exist
        let proto_home_bin_dir = self.proto_home.join("bin");
        std::fs::create_dir_all(&proto_home_bin_dir).unwrap_or_default();
        let proto_home_shim_path = proto_home_bin_dir.join(proto_shim_name);

        if proto_path.exists() && proto_shim_path.exists() {
            if !proto_home_shim_path.exists() {
                println!("Copying proto-shim to PROTO_HOME/bin...");
                let _ = std::fs::copy(&proto_shim_path, &proto_home_shim_path);
            }
            return Ok(proto_path);
        }

        std::fs::create_dir_all(bin_dir).map_err(|e| format!("Failed to create bin dir: {}", e))?;

        if cfg!(target_os = "windows") {
            let url = "https://github.com/moonrepo/proto/releases/latest/download/proto_cli-x86_64-pc-windows-msvc.zip";
            println!("Downloading proto CLI for Windows from {}...", url);

            let response = reqwest::get(url)
                .await
                .map_err(|e| format!("Failed to fetch proto CLI: {}", e))?;

            if !response.status().is_success() {
                return Err(format!("Failed to download proto CLI: HTTP status {}", response.status()));
            }

            let bytes = response
                .bytes()
                .await
                .map_err(|e| format!("Failed to read proto bytes: {}", e))?;

            let reader = std::io::Cursor::new(bytes);
            let mut archive = zip::ZipArchive::new(reader)
                .map_err(|e| format!("Failed to parse zip archive: {}", e))?;

            let mut extracted_proto = false;
            for i in 0..archive.len() {
                let mut file = archive.by_index(i).map_err(|e| format!("Zip entry read failed: {}", e))?;
                let outpath = match file.enclosed_name() {
                    Some(path) => path.to_owned(),
                    None => continue,
                };

                let name = outpath.to_string_lossy();
                if name.contains("proto.exe") || name == "proto" {
                    if !proto_path.exists() {
                        let mut outfile = std::fs::File::create(&proto_path)
                            .map_err(|e| format!("Failed to create output file: {}", e))?;
                        std::io::copy(&mut file, &mut outfile)
                            .map_err(|e| format!("Failed to extract file: {}", e))?;
                    }
                    extracted_proto = true;
                } else if name.contains("proto-shim.exe") || name == "proto-shim" {
                    if !proto_shim_path.exists() {
                        let mut outfile = std::fs::File::create(&proto_shim_path)
                            .map_err(|e| format!("Failed to create output file: {}", e))?;
                        std::io::copy(&mut file, &mut outfile)
                            .map_err(|e| format!("Failed to extract file: {}", e))?;
                    }
                }
            }

            if !extracted_proto {
                return Err("proto.exe was not found inside the downloaded zip package.".to_string());
            }
        } else {
            // For macOS / Linux, run the official installer script, then copy it to bin_dir if needed
            println!("Installing proto CLI via official moonrepo shell script...");
            let install_script = Command::new("sh")
                .arg("-c")
                .arg("curl -fsSL https://moonrepo.dev/install/proto.sh | sh")
                .status()
                .await
                .map_err(|e| format!("Failed to execute proto install script: {}", e))?;

            if !install_script.success() {
                return Err("Failed to install proto via shell script.".to_string());
            }

            // The script installs proto into ~/.proto/bin/proto. Let's find it.
            let home_dir = directories::BaseDirs::new()
                .ok_or_else(|| "Failed to find user home directory".to_string())?
                .home_dir()
                .to_path_buf();
            let source_path = home_dir.join(".proto").join("bin").join("proto");
            let source_shim_path = home_dir.join(".proto").join("bin").join("proto-shim");

            if source_path.exists() {
                std::fs::copy(&source_path, &proto_path)
                    .map_err(|e| format!("Failed to copy installed proto to private bin dir: {}", e))?;
                if source_shim_path.exists() {
                    let _ = std::fs::copy(&source_shim_path, &proto_shim_path);
                }
            } else {
                return Err("Failed to locate proto installation after running shell script.".to_string());
            }
        }

        // Copy proto-shim to PROTO_HOME/bin/
        if proto_shim_path.exists() && !proto_home_shim_path.exists() {
            println!("Copying proto-shim to PROTO_HOME/bin...");
            let _ = std::fs::copy(&proto_shim_path, &proto_home_shim_path);
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for path in &[&proto_path, &proto_shim_path, &proto_home_shim_path] {
                if path.exists() {
                    let mut perms = std::fs::metadata(path).map_err(|e| e.to_string())?.permissions();
                    perms.set_mode(0o755);
                    std::fs::set_permissions(path, perms).map_err(|e| e.to_string())?;
                }
            }
        }

        Ok(proto_path)
    }

    /// Pre-installs stable version of Node.js, Go, and Python to make them available out-of-the-box.
    pub async fn ensure_stable_toolchains(&self, proto_bin: &Path) -> Result<(), String> {
        let tools = vec!["node", "go", "python"];
        for tool in tools {
            // Check if tool is already installed (has directory, is not empty, and shim exists)
            let tool_dir = self.proto_home.join("tools").join(tool);
            let shim_name = if cfg!(target_os = "windows") { format!("{}.exe", tool) } else { tool.to_string() };
            let shim_file = self.proto_home.join("shims").join(shim_name);
            if tool_dir.exists() && shim_file.exists() {
                if let Ok(mut entries) = std::fs::read_dir(&tool_dir) {
                    if entries.next().is_some() {
                        println!("Tool '{}' is already installed and shim exists, skipping install.", tool);
                        continue;
                    }
                }
            }

            let version = if tool == "go" || tool == "python" { "latest" } else { "latest" };
            println!("Ensuring stable version of tool '{}' is installed in proto...", tool);
            // proto install <tool> latest/stable --pin
            let status = Command::new(proto_bin)
                .env("PROTO_HOME", &self.proto_home)
                .args(["install", tool, version, "--pin"])
                .status()
                .await
                .map_err(|e| format!("Failed to spawn proto install for {}: {}", tool, e))?;

            if !status.success() {
                return Err(format!("Failed to install tool '{}' inside proto.", tool));
            }
        }
        Ok(())
    }

    /// Generates a spoofed PATH environment variable that prioritizes proto's bins.
    /// It effectively isolates the process from system-wide tools.
    pub fn get_spoofed_env(&self) -> Vec<(String, String)> {
        let mut envs = Vec::new();
        
        // Ensure PROTO_HOME is set for the process so proto works in isolated mode
        envs.push(("PROTO_HOME".to_string(), self.proto_home.to_string_lossy().to_string()));

        // We build the PATH string.
        let bin_dir = self.proto_home.join("bin");
        let shims_dir = self.proto_home.join("shims");
        
        let mut paths = vec![
            shims_dir,
            bin_dir,
        ];

        // Also add system critical paths so things like basic commands (ls, mkdir, cmd) still work
        if let Ok(system_path) = env::var("PATH") {
            for p in std::env::split_paths(&system_path) {
                let p_str = p.to_string_lossy().to_lowercase();
                // Filter out existing node, python, go, rust, or nvm paths for complete isolation
                if p_str.contains("node")
                    || p_str.contains("python")
                    || p_str.contains("go")
                    || p_str.contains("nvm")
                    || p_str.contains("rust")
                    || p_str.contains("cargo")
                {
                    continue;
                }
                paths.push(p);
            }
        }

        let new_path = std::env::join_paths(paths).unwrap_or_default();
        envs.push(("PATH".to_string(), new_path.to_string_lossy().to_string()));

        envs
    }

    /// Install a specific tool via proto (e.g., "node", "go", "python") with "stable" version
    pub async fn install_tool(&self, proto_bin: &Path, tool_name: &str, version: &str) -> Result<(), String> {
        let resolved_version = if version == "stable" && (tool_name == "go" || tool_name == "python") {
            "latest"
        } else {
            version
        };
        let status = Command::new(proto_bin)
            .env("PROTO_HOME", &self.proto_home)
            .args(["install", tool_name, resolved_version, "--pin"])
            .status()
            .await
            .map_err(|e| format!("Failed to spawn proto install: {}", e))?;

        if !status.success() {
            return Err(format!("Proto install failed for {} {}", tool_name, resolved_version));
        }
        Ok(())
    }
}
