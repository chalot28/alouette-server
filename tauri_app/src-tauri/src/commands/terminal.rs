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
    // 1. Immediately handle Ctrl+C to interrupt executing commands
    if input.contains('\x03') {
        let mut pm = state.process_manager.lock().await;
        pm.clear_input_buf(&session_id);
        let ctx = pm.get_terminal_write_context(&session_id)?;
        let stdin_tx = ctx.stdin_sender.clone();
        drop(pm);

        let _ = stdin_tx.send("\x03".to_string()).await
            .map_err(|e| format!("Terminal send Ctrl+C: {e}"))?;
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
            match pm.check_input_sandbox(&session_id) {
                Ok(None) => {
                    allowed_cmd = pm.get_input_buf(&session_id).cloned().unwrap_or_default();
                    pm.clear_input_buf(&session_id);
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

        let ctx = pm.get_terminal_write_context(&session_id)?;
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
        let _ = stdin_tx.send(full).await
            .map_err(|e| format!("Terminal send: {e}"))?;
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
