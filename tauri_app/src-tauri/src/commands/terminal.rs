use crate::state::AppState;
use tauri::State;

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
    // Extract a lightweight write context from the session, then immediately
    // drop the ProcessManager lock. All subsequent input processing and sending
    // happens outside the lock, preventing deadlocks with other tasks that
    // also need the ProcessManager (e.g. terminal router, status router).
    let ctx = {
        let pm = state.process_manager.lock().await;
        pm.get_terminal_write_context(&session_id)?
        // pm lock is dropped here at the end of this block
    };

    core_engine::process_and_send_terminal_input(&session_id, input, &ctx).await
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
