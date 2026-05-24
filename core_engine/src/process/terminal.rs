use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;
use tokio::sync::{broadcast, mpsc};

use super::models::{TerminalOutput, TerminalSession};
use super::manager::ProcessManager;
use super::tree::{terminate_process_tree, normalize_path, is_subpath, get_relative_path};

impl ProcessManager {
    /// Subscribes to the global terminal output broadcast channel.
    pub fn subscribe_terminal(&self) -> broadcast::Receiver<TerminalOutput> {
        self.terminal_sender.subscribe()
    }

    /// Spawns a sandboxed interactive terminal session inside the private proto environment.
    pub async fn spawn_terminal(&mut self, session_id: &str, cwd: Option<&str>) -> Result<(), String> {
        // Kill existing if any
        let _ = self.kill_terminal(session_id).await;

        let mut spoofed_envs = self.proto_manager.get_spoofed_env();

        let workspace_root = cwd.unwrap_or(".");
        let abs_workspace_root = std::fs::canonicalize(workspace_root)
            .unwrap_or_else(|_| std::path::PathBuf::from(workspace_root));
        let abs_workspace_root_str = abs_workspace_root.to_string_lossy().to_string();

        let clean_workspace_root = if abs_workspace_root_str.starts_with(r"\\?\") {
            abs_workspace_root_str[4..].to_string()
        } else {
            abs_workspace_root_str
        };

        spoofed_envs.push(("WORKSPACE_ROOT".to_string(), clean_workspace_root.clone()));

        let shell_cmd = if cfg!(target_os = "windows") { "cmd.exe" } else { "sh" };
        let mut cmd = tokio::process::Command::new(shell_cmd);

        #[cfg(target_os = "windows")]
        {
            cmd.arg("/K").arg("@prompt ~$$: ");
        }

        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        cmd.envs(spoofed_envs);
        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn shell: {}", e))?;
        let pid = child.id().unwrap_or(0);

        let mut stdin = child.stdin.take().expect("Failed to capture stdin");
        let stdout = child.stdout.take().expect("Failed to capture stdout");
        let stderr = child.stderr.take().expect("Failed to capture stderr");

        let (stdin_sender, mut stdin_rx) = mpsc::channel::<String>(100);

        // Pipe stdin
        tokio::spawn(async move {
            while let Some(input) = stdin_rx.recv().await {
                let _ = stdin.write_all(input.as_bytes()).await;
                let _ = stdin.flush().await;
            }
        });

        // Silently push initial premium aliases to the Windows command shell
        #[cfg(target_os = "windows")]
        {
            let _ = stdin_sender.send("@doskey ls=dir $*\r\n".to_string()).await;
            let _ = stdin_sender.send("@doskey clear=cls\r\n".to_string()).await;
        }

        let terminal_sender = self.terminal_sender.clone();
        let session_id_str = session_id.to_string();

        // Pipe stdout (read by buffers to support shell prompts)
        let terminal_sender_stdout = terminal_sender.clone();
        let session_id_stdout = session_id_str.clone();
        tokio::spawn(async move {
            let mut reader = stdout;
            let mut buffer = [0; 4096];
            loop {
                match tokio::io::AsyncReadExt::read(&mut reader, &mut buffer).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buffer[..n]).to_string();
                        let _ = terminal_sender_stdout.send(TerminalOutput {
                            session_id: session_id_stdout.clone(),
                            text,
                        });
                    }
                    Err(_) => break,
                }
            }
        });

        // Pipe stderr (read by buffers to support shell prompts)
        let terminal_sender_stderr = terminal_sender.clone();
        let session_id_stderr = session_id_str.clone();
        tokio::spawn(async move {
            let mut reader = stderr;
            let mut buffer = [0; 4096];
            loop {
                match tokio::io::AsyncReadExt::read(&mut reader, &mut buffer).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buffer[..n]).to_string();
                        let _ = terminal_sender_stderr.send(TerminalOutput {
                            session_id: session_id_stderr.clone(),
                            text,
                        });
                    }
                    Err(_) => break,
                }
            }
        });

        // Child wait loop
        tokio::spawn(async move {
            let _ = child.wait().await;
        });

        self.terminal_sessions.insert(session_id_str, TerminalSession {
            stdin_sender,
            pid,
            workspace_root: std::path::PathBuf::from(clean_workspace_root.clone()),
            current_dir: std::sync::Mutex::new(std::path::PathBuf::from(clean_workspace_root)),
        });

        Ok(())
    }

    /// Writes raw input text to the interactive terminal session's stdin.
    pub async fn write_terminal(&self, session_id: &str, mut text: String) -> Result<(), String> {
        if let Some(session) = self.terminal_sessions.get(session_id) {
            #[cfg(target_os = "windows")]
            {
                let trimmed = text.trim();
                let is_cd = trimmed == "cd" || trimmed.starts_with("cd ") || trimmed == "chdir" || trimmed.starts_with("chdir ");

                if is_cd {
                    let args = if trimmed.starts_with("cd ") {
                        trimmed[3..].trim()
                    } else if trimmed.starts_with("chdir ") {
                        trimmed[6..].trim()
                    } else {
                        ""
                    };

                    if !args.is_empty() {
                        let mut target_str = args;
                        if target_str.starts_with('"') && target_str.ends_with('"') && target_str.len() >= 2 {
                            target_str = &target_str[1..target_str.len()-1];
                        }

                        let mut target_clean = target_str.trim();
                        if target_clean.to_lowercase().starts_with("/d ") {
                            target_clean = target_clean[3..].trim();
                        } else if target_clean.to_lowercase().starts_with("/d") {
                            target_clean = target_clean[2..].trim();
                        }

                        let current_dir = session.current_dir.lock().unwrap().clone();
                        let target_path = if Path::new(target_clean).is_absolute() {
                            PathBuf::from(target_clean)
                        } else {
                            current_dir.join(target_clean)
                        };

                        let normalized = normalize_path(&target_path);

                        if is_subpath(&normalized, &session.workspace_root) {
                            // Authorized -> Update active CWD
                            {
                                let mut curr = session.current_dir.lock().unwrap();
                                *curr = normalized.clone();
                            }

                            let rel_path = get_relative_path(&normalized, &session.workspace_root);
                            let display_prompt = if rel_path.is_empty() {
                                "~".to_string()
                            } else if rel_path.contains('/') {
                                format!("~/{}", rel_path)
                            } else {
                                format!("~{}", rel_path)
                            };

                            // Echo the original command to stdout so user sees it in their viewport
                            let echo_text = format!("{}\r\n", trimmed);
                            let _ = self.terminal_sender.send(TerminalOutput {
                                session_id: session_id.to_string(),
                                text: echo_text,
                            });

                            // Execute silent cd and prompt update
                            text = format!("@cd /d \"{}\" && @prompt {}$$: \r\n", normalized.to_string_lossy(), display_prompt);
                        } else {
                            // Unauthorized -> Block, report, restore prompt
                            let echo_text = format!("{}\r\n", trimmed);
                            let _ = self.terminal_sender.send(TerminalOutput {
                                session_id: session_id.to_string(),
                                text: echo_text,
                            });

                            let warning_text = format!(
                                "[Restricted Shell] Access denied: Cannot navigate outside the workspace root ({})\r\n",
                                session.workspace_root.to_string_lossy()
                            );
                            let _ = self.terminal_sender.send(TerminalOutput {
                                session_id: session_id.to_string(),
                                text: warning_text,
                            });

                            let current_curr = session.current_dir.lock().unwrap().clone();
                            let rel_path = get_relative_path(&current_curr, &session.workspace_root);
                            let display_prompt = if rel_path.is_empty() {
                                "~".to_string()
                            } else if rel_path.contains('/') {
                                format!("~/{}", rel_path)
                            } else {
                                format!("~{}", rel_path)
                            };

                            let restore_prompt_text = format!("{}$: ", display_prompt);
                            let _ = self.terminal_sender.send(TerminalOutput {
                                session_id: session_id.to_string(),
                                text: restore_prompt_text,
                            });

                            return Ok(());
                        }
                    } else {
                        // Empty cd print dir
                        if text.ends_with('\n') && !text.ends_with("\r\n") {
                            text.pop();
                            text.push_str("\r\n");
                        }
                    }
                } else {
                    if text.ends_with('\n') && !text.ends_with("\r\n") {
                        text.pop();
                        text.push_str("\r\n");
                    }
                }
            }
            session.stdin_sender.send(text).await
                .map_err(|e| format!("Failed to send input to terminal session: {}", e))?;
            Ok(())
        } else {
            Err(format!("Terminal session '{}' not found", session_id))
        }
    }

    /// Forcefully terminates an active interactive terminal session process tree.
    pub async fn kill_terminal(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.terminal_sessions.remove(session_id) {
            terminate_process_tree(session.pid).await;
        }
        Ok(())
    }
}
