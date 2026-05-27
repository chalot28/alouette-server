use crate::state::AppState;
use serde::Serialize;
use tauri::State;
use core_engine::TerminalOutput;

#[derive(Serialize)]
pub struct TerminalSessionInfo {
    pub exists: bool,
    pub pid: Option<u32>,
}

#[tauri::command]
pub async fn spawn_terminal_session(
    state: State<'_, AppState>,
    session_id: String,
    cwd: Option<String>,
    block_internet: Option<bool>,
) -> Result<(), String> {
    let mut pm = state.process_manager.lock().await;
    pm.spawn_terminal(&session_id, cwd.as_deref(), block_internet.unwrap_or(false))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn write_to_terminal_session(
    state: State<'_, AppState>,
    session_id: String,
    input: String,
) -> Result<(), String> {
    // 1. Immediately handle Ctrl+C to interrupt executing commands safely
    if input.contains('\x03') {
        let mut pm = state.process_manager.lock().await;
        pm.clear_input_buf(&session_id);
        if let Ok(ctx) = pm.get_terminal_write_context(&session_id) {
            let stdin_tx = ctx.stdin_sender.clone();
            drop(pm);
            let _ = stdin_tx.send("\x03".to_string()).await;
        }
        return Ok(());
    }

    // 2. Handle Up/Down arrow keys for command history navigation
    if input == "\x1b[A" || input == "\x1b[B" {
        let mut pm = state.process_manager.lock().await;
        if let Ok(ctx) = pm.get_terminal_write_context(&session_id) {
            let out_tx = ctx.terminal_sender.clone();
            let history = pm.terminal_history.entry(session_id.clone()).or_default().clone();
            let mut idx = *pm.terminal_history_index.entry(session_id.clone()).or_insert(history.len());

            if !history.is_empty() {
                if input == "\x1b[A" {
                    // Up Arrow
                    if idx > 0 {
                        idx -= 1;
                    }
                } else {
                    // Down Arrow
                    if idx < history.len() {
                        idx += 1;
                    }
                }
                pm.terminal_history_index.insert(session_id.clone(), idx);

                let new_cmd = if idx < history.len() {
                    history[idx].clone()
                } else {
                    String::new()
                };

                let cur_len = pm.input_buf.get(&session_id).map(|s| s.len()).unwrap_or(0);
                let erase = "\x08 \x08".repeat(cur_len);

                pm.input_buf.insert(session_id.clone(), new_cmd.clone());

                let _ = out_tx.send(core_engine::TerminalOutput {
                    session_id,
                    text: format!("{}{}", erase, new_cmd),
                });
            }
        }
        return Ok(());
    }

    let is_enter = input.contains('\r') || input.contains('\n');
    let mut allowed_cmd = String::new();
    let mut blocked_reason = String::new();
    let mut buf_len: usize = 0;
    let mut echo_string = String::new();
    let out_tx;
    let stdin_tx;

    {
        let mut pm = state.process_manager.lock().await;

        if is_enter {
            // Normalize cd shortcuts in the input buffer first
            if let Some(buf) = pm.input_buf.get_mut(&session_id) {
                let trimmed = buf.trim();
                let lower = trimmed.to_lowercase();
                if lower.starts_with("cd..") {
                    *buf = format!("cd ..{}", &trimmed[4..]);
                } else if lower.starts_with("cd/") {
                    *buf = format!("cd /{}", &trimmed[3..]);
                } else if lower.starts_with("cd\\") {
                    *buf = format!("cd \\{}", &trimmed[3..]);
                }
            }

            match pm.check_input_sandbox(&session_id) {
                Ok(None) => {
                    allowed_cmd = pm.get_input_buf(&session_id).cloned().unwrap_or_default();
                    pm.clear_input_buf(&session_id);

                    // Add command to history on successful enter
                    if !allowed_cmd.trim().is_empty() {
                        let len = {
                            let hist = pm.terminal_history.entry(session_id.clone()).or_default();
                            if hist.last() != Some(&allowed_cmd) {
                                hist.push(allowed_cmd.clone());
                            }
                            hist.len()
                        };
                        pm.terminal_history_index.insert(session_id.clone(), len);
                    }
                }
                Ok(Some(reason)) => {
                    blocked_reason = reason;
                    buf_len = pm.get_input_buf(&session_id).map(|s| s.len()).unwrap_or(0);
                    pm.clear_input_buf(&session_id);
                }
                Err(e) => {
                    eprintln!("[sandbox] error: {e}");
                    pm.clear_input_buf(&session_id);
                }
            }
        } else {
            for c in input.chars() {
                let is_bs = c == '\u{7f}' || c == '\u{08}';
                if is_bs {
                    let mut buf = pm.get_input_buf(&session_id).cloned().unwrap_or_default();
                    if !buf.is_empty() {
                        buf.pop();
                        pm.clear_input_buf(&session_id);
                        if !buf.is_empty() {
                            pm.append_input_buf(&session_id, &buf);
                        }
                        echo_string.push_str("\u{08} \u{08}");
                    }
                } else {
                    let mut temp = String::new();
                    temp.push(c);
                    pm.append_input_buf(&session_id, &temp);
                    echo_string.push(c);
                }
            }
        }

        let ctx = match pm.get_terminal_write_context(&session_id) {
            Ok(c) => c,
            Err(_) => return Ok(()), // Return gracefully if session no longer exists
        };
        out_tx = ctx.terminal_sender.clone();
        stdin_tx = ctx.stdin_sender.clone();
    }

    if !blocked_reason.is_empty() {
        let erase: String = (0..buf_len).map(|_| '\u{08}')
            .chain(" ".repeat(buf_len).chars())
            .chain((0..buf_len).map(|_| '\u{08}'))
            .collect();
        // Send Ctrl+C to PowerShell to cancel input line + show fresh prompt
        let _ = stdin_tx.send("\x03".to_string()).await;
        // Send erase + warning to display
        let warning = format!("\r{}[Sandbox] Blocked: {}\r\n", erase, blocked_reason);
        let _ = out_tx.send(TerminalOutput {
            session_id: session_id.clone(),
            text: warning,
        });
        return Ok(());
    }

    if is_enter {
        {
            let mut pm = state.process_manager.lock().await;
            if !allowed_cmd.is_empty() {
                pm.update_cwd_for_cd(&session_id, &allowed_cmd);
            }
        }
        let full = allowed_cmd + "\r";
        let _ = stdin_tx.send(full).await;
        return Ok(());
    }

    // Local echo for non-Enter keystrokes
    if !is_enter && !echo_string.is_empty() {
        let _ = out_tx.send(TerminalOutput {
            session_id: session_id.clone(),
            text: echo_string,
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn kill_terminal_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let mut pm = state.process_manager.lock().await;
    pm.kill_terminal(&session_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn check_terminal_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<TerminalSessionInfo, String> {
    let pm = state.process_manager.lock().await;
    if let Some(session) = pm.terminal_sessions.get(&session_id) {
        Ok(TerminalSessionInfo {
            exists: true,
            pid: Some(session.pid),
        })
    } else {
        Ok(TerminalSessionInfo {
            exists: false,
            pid: None,
        })
    }
}

#[tauri::command]
pub async fn resize_terminal_session(
    state: State<'_, AppState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let pm = state.process_manager.lock().await;
    pm.resize_terminal(&session_id, rows, cols)?;
    Ok(())
}
