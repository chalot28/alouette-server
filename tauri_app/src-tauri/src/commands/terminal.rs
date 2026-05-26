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
) -> Result<(), String> {
    let mut pm = state.process_manager.lock().await;
    pm.spawn_terminal(&session_id, cwd.as_deref()).await?;
    Ok(())
}

#[tauri::command]
pub async fn write_to_terminal_session(
    state: State<'_, AppState>,
    session_id: String,
    input: String,
) -> Result<(), String> {
    let is_enter = input.contains('\r') || input.contains('\n');
    let mut allowed_cmd = String::new();
    let mut blocked_reason = String::new();
    let mut buf_len: usize = 0;
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
            let is_bs = input == "\u{7f}" || input == "\u{08}";
            if is_bs {
                let mut buf = pm.get_input_buf(&session_id).cloned().unwrap_or_default();
                buf.pop();
                pm.clear_input_buf(&session_id);
                if !buf.is_empty() {
                    pm.append_input_buf(&session_id, &buf);
                }
            } else {
                pm.append_input_buf(&session_id, &input);
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

    if is_enter && !allowed_cmd.is_empty() {
        {
            let mut pm = state.process_manager.lock().await;
            pm.update_cwd_for_cd(&session_id, &allowed_cmd);
        }
        let full = allowed_cmd + "\r";
        let _ = stdin_tx.send(full).await
            .map_err(|e| format!("Terminal send: {e}"))?;
        return Ok(());
    }

    // Local echo for non-Enter keystrokes
    if !is_enter {
        let echo = if input == "\u{7f}" || input == "\u{08}" {
            "\u{08} \u{08}".to_string()
        } else {
            input
        };
        let _ = out_tx.send(TerminalOutput {
            session_id: session_id.clone(),
            text: echo,
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
