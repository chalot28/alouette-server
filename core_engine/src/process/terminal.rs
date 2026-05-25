use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};

use super::models::{TerminalOutput, TerminalSession, TerminalWriteContext};
use super::manager::ProcessManager;
use super::tree::{terminate_process_tree, normalize_path, is_subpath, get_relative_path};

impl ProcessManager {
    /// Subscribes to the global terminal output broadcast channel.
    pub fn subscribe_terminal(&self) -> broadcast::Receiver<TerminalOutput> {
        self.terminal_sender.subscribe()
    }

    /// Returns a lightweight write context for a terminal session, allowing
    /// callers to process and send input entirely outside the ProcessManager mutex lock.
    pub fn get_terminal_write_context(&self, session_id: &str) -> Result<TerminalWriteContext, String> {
        let session = self.terminal_sessions.get(session_id)
            .ok_or_else(|| format!("Terminal session '{}' not found", session_id))?;
        Ok(TerminalWriteContext {
            stdin_sender: session.stdin_sender.clone(),
            terminal_sender: self.terminal_sender.clone(),
            workspace_root: session.workspace_root.clone(),
            current_dir: session.current_dir.clone(),
        })
    }

    /// Spawns a sandboxed interactive terminal session inside the private proto environment using a pseudo-terminal (PTY).
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

        let pty_system = native_pty_system();
        let pty_pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd_builder = CommandBuilder::new(shell_cmd);
        
        #[cfg(target_os = "windows")]
        {
            cmd_builder.arg("/K");
            cmd_builder.arg("@prompt ~$$: ");
        }

        if let Some(dir) = cwd {
            cmd_builder.cwd(dir);
        }

        for (k, v) in spoofed_envs {
            cmd_builder.env(k, v);
        }

        let child = pty_pair.slave.spawn_command(cmd_builder)
            .map_err(|e| format!("Failed to spawn shell in PTY: {}", e))?;
        let pid = child.process_id().unwrap_or(0);

        let writer = pty_pair.master.take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {}", e))?;
        let reader = pty_pair.master.try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let (stdin_sender, mut stdin_rx) = mpsc::channel::<String>(256);

        // Pipe stdin inside a dedicated OS thread
        std::thread::spawn(move || {
            let mut writer = writer;
            while let Some(input) = stdin_rx.blocking_recv() {
                if std::io::Write::write_all(&mut writer, input.as_bytes()).is_err() {
                    break;
                }
                let _ = std::io::Write::flush(&mut writer);
            }
        });

        let terminal_sender = self.terminal_sender.clone();
        let session_id_str = session_id.to_string();

        // Pipe stdout/stderr (PTY output) inside a dedicated thread
        let terminal_sender_stdout = terminal_sender.clone();
        let session_id_stdout = session_id_str.clone();
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buffer = [0; 4096];
            loop {
                match std::io::Read::read(&mut reader, &mut buffer) {
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

        self.terminal_sessions.insert(session_id_str, TerminalSession {
            stdin_sender: stdin_sender.clone(),
            pid,
            workspace_root: std::path::PathBuf::from(clean_workspace_root.clone()),
            current_dir: Arc::new(std::sync::Mutex::new(std::path::PathBuf::from(clean_workspace_root))),
        });

        // Silently push doskey aliases after a brief delay so cmd.exe is fully initialized
        #[cfg(target_os = "windows")]
        {
            let init_sender = stdin_sender.clone();
            tokio::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                let _ = init_sender.send("@doskey ls=dir $*\r\n".to_string()).await;
                let _ = init_sender.send("@doskey clear=cls\r\n".to_string()).await;
            });
        }


        Ok(())
    }

    /// Forcefully terminates an active interactive terminal session process tree.
    pub async fn kill_terminal(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.terminal_sessions.remove(session_id) {
            terminate_process_tree(session.pid).await;
        }
        Ok(())
    }
}

/// Processes terminal input text (handling cd sandboxing, line endings)
/// and sends it to the PTY stdin — entirely outside any ProcessManager lock.
pub async fn process_and_send_terminal_input(
    session_id: &str,
    mut text: String,
    ctx: &TerminalWriteContext,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let trimmed = text.trim().to_string();
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
                let mut target_str: &str = args;
                if target_str.starts_with('"') && target_str.ends_with('"') && target_str.len() >= 2 {
                    target_str = &target_str[1..target_str.len()-1];
                }

                let mut target_clean = target_str.trim();
                if target_clean.to_lowercase().starts_with("/d ") {
                    target_clean = target_clean[3..].trim();
                } else if target_clean.to_lowercase().starts_with("/d") {
                    target_clean = target_clean[2..].trim();
                }

                let current_dir = ctx.current_dir.lock().unwrap().clone();
                let target_path = if Path::new(target_clean).is_absolute() {
                    PathBuf::from(target_clean)
                } else {
                    current_dir.join(target_clean)
                };

                let normalized = normalize_path(&target_path);

                if is_subpath(&normalized, &ctx.workspace_root) {
                    // Authorized -> Update active CWD
                    {
                        let mut curr = ctx.current_dir.lock().unwrap();
                        *curr = normalized.clone();
                    }

                    let rel_path = get_relative_path(&normalized, &ctx.workspace_root);
                    let display_prompt = if rel_path.is_empty() {
                        "~".to_string()
                    } else if rel_path.contains('/') {
                        format!("~/{}", rel_path)
                    } else {
                        format!("~{}", rel_path)
                    };

                    // Echo the original command to stdout so user sees it in their viewport
                    let echo_text = format!("{}\r\n", trimmed);
                    let _ = ctx.terminal_sender.send(TerminalOutput {
                        session_id: session_id.to_string(),
                        text: echo_text,
                    });

                    // Execute silent cd and prompt update
                    text = format!("@cd /d \"{}\" && @prompt {}$$: \r\n", normalized.to_string_lossy(), display_prompt);
                } else {
                    // Unauthorized -> Block, report, restore prompt
                    let echo_text = format!("{}\r\n", trimmed);
                    let _ = ctx.terminal_sender.send(TerminalOutput {
                        session_id: session_id.to_string(),
                        text: echo_text,
                    });

                    let warning_text = format!(
                        "[Restricted Shell] Access denied: Cannot navigate outside the workspace root ({})\r\n",
                        ctx.workspace_root.to_string_lossy()
                    );
                    let _ = ctx.terminal_sender.send(TerminalOutput {
                        session_id: session_id.to_string(),
                        text: warning_text,
                    });

                    let current_curr = ctx.current_dir.lock().unwrap().clone();
                    let rel_path = get_relative_path(&current_curr, &ctx.workspace_root);
                    let display_prompt = if rel_path.is_empty() {
                        "~".to_string()
                    } else if rel_path.contains('/') {
                        format!("~/{}", rel_path)
                    } else {
                        format!("~{}", rel_path)
                    };

                    let restore_prompt_text = format!("{}$: ", display_prompt);
                    let _ = ctx.terminal_sender.send(TerminalOutput {
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

    ctx.stdin_sender.send(text).await
        .map_err(|e| format!("Failed to send input to terminal session: {}", e))?;
    Ok(())
}
