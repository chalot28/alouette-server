use crate::commands::rig_bridge;
use crate::state::AppState;
use chrono::Local;
use core_engine::agent_harness::{
    AgentHarness, AgentSession, AgentState, ChatMessage, HarnessMode, MessageContent, TickResult,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::sync::OnceLock;
use tauri::{Emitter, State, WebviewWindow};

/// Cờ ngắt: true = yêu cầu dừng agent loop đang chạy
static CANCEL_FLAG: AtomicBool = AtomicBool::new(false);

// Thread-safe session storage using standard library OnceLock and Mutex
static CURRENT_SESSION: OnceLock<Mutex<Option<AgentSession>>> = OnceLock::new();

fn get_session_store() -> &'static Mutex<Option<AgentSession>> {
    CURRENT_SESSION.get_or_init(|| Mutex::new(None))
}

// ─── Response Types ─────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentResponse {
    pub session_id: String,
    pub reply_type: String, // "text" | "tool_request" | "loop_result"
    pub text: Option<String>,
    pub tool_name: Option<String>,
    pub args: Option<String>,
    pub pending_id: Option<String>,
    pub iteration: Option<u32>,
    pub total_iterations: Option<u32>,
    pub tool_result: Option<String>,
}

// ─── Session & Loop State ───────────────────────────────────────────────

/// Cấu hình loop cho phiên hiện tại
#[derive(Debug, Clone)]
struct LoopState {
    pub max_iterations: u32,
    pub auto_approve_reads: bool,
    pub auto_approve_writes: bool,
    pub auto_approve_all: bool,
    pub command_timeout_secs: u64,
    pub iteration_count: u32,
}

impl Default for LoopState {
    fn default() -> Self {
        Self {
            max_iterations: 25,
            auto_approve_reads: true,
            auto_approve_writes: false,
            auto_approve_all: false,
            command_timeout_secs: 120,
            iteration_count: 0,
        }
    }
}

static LOOP_STATE: OnceLock<Mutex<Option<LoopState>>> = OnceLock::new();

fn get_loop_state() -> &'static Mutex<Option<LoopState>> {
    LOOP_STATE.get_or_init(|| Mutex::new(None))
}

// ─── Cancel / Interrupt ────────────────────────────────────────────────

/// Kiểm tra cờ ngắt và reset nếu đã được bật
fn check_and_reset_cancel() -> bool {
    let cancelled = CANCEL_FLAG.load(Ordering::SeqCst);
    if cancelled {
        CANCEL_FLAG.store(false, Ordering::SeqCst);
    }
    cancelled
}

/// Gửi tín hiệu ngắt agent loop đang chạy
#[tauri::command]
pub async fn agent_cancel() -> Result<String, String> {
    CANCEL_FLAG.store(true, Ordering::SeqCst);
    Ok("✓ Đã gửi tín hiệu ngắt. Agent sẽ dừng sau bước hiện tại.".to_string())
}

/// Trả về trạng thái hiện tại của agent (cho frontend poll)
#[tauri::command]
pub async fn agent_status() -> Result<Value, String> {
    let session_store = get_session_store();
    let guard = session_store.lock().unwrap();
    if let Some(ref session) = *guard {
        let state_str = match &session.state {
            AgentState::Idle => "idle",
            AgentState::Thinking => "thinking",
            AgentState::ExecutingTool => "executing_tool",
            AgentState::AwaitingApproval(_) => "awaiting_approval",
            AgentState::Verifying => "verifying",
            AgentState::Finished(_) => "finished",
            AgentState::Error(_) => "error",
        };
        Ok(json!({
            "session_id": session.session_id,
            "state": state_str,
            "iteration": session.iteration_count,
            "max_iterations": session.max_iterations,
            "history_len": session.history.len(),
        }))
    } else {
        Ok(json!({
            "session_id": null,
            "state": "no_session",
            "iteration": 0,
            "max_iterations": 25,
            "history_len": 0,
        }))
    }
}

// ─── Model Config ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub provider: String,
    pub api_key: String,
    pub api_url: String,
    pub context_limit: usize,
    pub supports_vision: bool,
    pub temperature: f32,
    pub top_p: f32,
    pub api_standard: Option<String>,
}

fn default_active_model() -> String {
    "gemini-1.5-flash".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDetail {
    pub context_limit: usize,
    pub supports_vision: bool,
    pub api_standard: Option<String>,
    pub api_url: Option<String>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub api_key: String,
    pub api_url: Option<String>,
    pub models: std::collections::HashMap<String, ModelDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomAiConfig {
    #[serde(default = "default_active_model")]
    pub active_model: String,
    pub providers: std::collections::HashMap<String, ProviderConfig>,
}

// ─── Core Agent Command ─────────────────────────────────────────────────

#[tauri::command]
pub async fn agent_send_message(
    message: String,
    model: String,
    mode: String,
    active_cwd: Option<String>,
    window: WebviewWindow,
    _app_state: State<'_, AppState>,
) -> Result<AgentResponse, String> {
    let workspace = active_cwd.map(std::path::PathBuf::from).unwrap_or_else(|| {
        std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
    });
    let mut harness = AgentHarness::new(&workspace);

    // Load model config
    let ai_cfg = load_custom_ai_config();
    let model_config = resolve_model_config(&ai_cfg, &model);
    let api_key = resolve_api_key(&model_config)?;

    // Determine approval policy based on mode
    let is_autonomous = mode == "autonomous";
    let is_write_mode = mode == "write" || mode == "full";
    let auto_approve_reads = true;
    let auto_approve_writes = is_write_mode || is_autonomous;
    let auto_approve_all = is_autonomous;
    let max_iterations: u32 = 25;

    // Save approval policy for later (agent_approve_tool)
    {
        let mut state = get_loop_state().lock().unwrap();
        *state = Some(LoopState {
            max_iterations,
            auto_approve_reads,
            auto_approve_writes,
            auto_approve_all,
            command_timeout_secs: 120,
            iteration_count: 0,
        });
    }

    // Initialize session
    let session_store = get_session_store();
    let mut session = {
        let mut session_guard = session_store.lock().unwrap();
        // If there's an existing session in non-terminal state, use it
        let existing = session_guard.take();
        let mut session = existing.unwrap_or_else(|| AgentSession {
            session_id: format!("sess_{}", Local::now().timestamp()),
            history: Vec::new(),
            state: AgentState::Idle,
            iteration_count: 0,
            max_iterations,
            mode: HarnessMode::Standard,
            plan: None,
            autonomous_state: None,
        });

        // Reset state to Idle for new message (unless awaiting approval)
        if !matches!(session.state, AgentState::AwaitingApproval(_)) {
            session.state = AgentState::Idle;
        }

        // Add user message to history
        session.history.push(ChatMessage {
            id: format!("usr_{}", Local::now().timestamp_millis()),
            role: "user".to_string(),
            content: MessageContent::Text(message.clone()),
            timestamp: Local::now().format("%H:%M").to_string(),
        });
        session
    };

    // Build system prompt
    let system_prompt = harness.assemble_system_prompt();

    // Clone values for LLM closure
    let api_standard = model_config
        .api_standard
        .clone()
        .unwrap_or_else(|| "gemini".to_string());
    let model_to_use = if !model.is_empty() {
        model.clone()
    } else if !ai_cfg.active_model.is_empty() {
        ai_cfg.active_model.clone()
    } else {
        "gemini-1.5-flash".to_string()
    };
    let api_key_clone = api_key.clone();
    let api_url = model_config.api_url.clone();
    let temperature = model_config.temperature;
    let top_p = model_config.top_p;

    // ─── STATE MACHINE: Tick loop ──────────────────────────────────
    // Gọi tick() liên tục cho đến khi gặp WaitForApproval, Finished, Error, hoặc Cancel
    let saved_session_id = session.session_id.clone();
    let result = loop {
        // Kiểm tra ngắt trước mỗi bước
        if check_and_reset_cancel() {
            let _ = window.emit(
                "agent-cancelled",
                serde_json::json!({
                    "reason": "user_cancelled",
                }),
            );
            let mut sg = session_store.lock().unwrap();
            *sg = Some(session);
            break Ok(AgentResponse {
                session_id: saved_session_id,
                reply_type: "cancelled".to_string(),
                text: Some("Agent đã bị ngắt bởi người dùng.".to_string()),
                tool_name: None,
                args: None,
                pending_id: None,
                iteration: None,
                total_iterations: None,
                tool_result: None,
            });
        }
        let llm_closure = {
            let api_key = api_key_clone.clone();
            let model = model_to_use.clone();
            let url = api_url.clone();
            let std = api_standard.clone();
            move |sys_prompt: String, history: Vec<ChatMessage>| {
                let api_key = api_key.clone();
                let model = model.clone();
                let url = url.clone();
                let std = std.clone();
                async move {
                    rig_bridge::call_rig(
                        &std,
                        &api_key,
                        &model,
                        &url,
                        temperature,
                        top_p,
                        &sys_prompt,
                        &history
                    )
                    .await
                }
            }
        };

        match harness
            .tick(&mut session, &system_prompt, llm_closure)
            .await
        {
            TickResult::Continue {
                thought,
                tool_name,
                tool_result,
                iteration,
            } => {
                let _ = window.emit(
                    "agent-iteration",
                    serde_json::json!({
                        "iteration": iteration,
                        "thought": thought,
                        "tool_name": tool_name,
                        "tool_result": tool_result,
                    }),
                );
                continue;
            }
            TickResult::WaitForApproval { tools, iteration } => {
                let tool = tools.first().cloned();
                let tool_name = tool.as_ref().map(|t| t.name.clone());
                let args = tool.as_ref().map(|t| t.arguments.to_string());
                let mut sg = session_store.lock().unwrap();
                *sg = Some(session);
                break Ok(AgentResponse {
                    session_id: format!("pending_{}", Local::now().timestamp()),
                    reply_type: "tool_request".to_string(),
                    text: None,
                    tool_name,
                    args,
                    pending_id: Some(format!("tool_{}", Local::now().timestamp_millis())),
                    iteration: Some(iteration),
                    total_iterations: Some(max_iterations),
                    tool_result: None,
                });
            }
            TickResult::Finished {
                text,
                total_iterations,
            } => {
                let mut sg = session_store.lock().unwrap();
                *sg = Some(session);
                break Ok(AgentResponse {
                    session_id: saved_session_id,
                    reply_type: "loop_result".to_string(),
                    text: Some(text.clone()),
                    tool_name: None,
                    args: None,
                    pending_id: None,
                    iteration: Some(total_iterations),
                    total_iterations: Some(max_iterations),
                    tool_result: None,
                });
            }
            TickResult::Error { message, iteration } => {
                break Err(format!("Agent error (iter {}): {}", iteration, message));
            }
        }
    };

    result
}

// ─── Approve / Reject Tool (tiếp tục loop) ──────────────────────────────

#[tauri::command]
pub async fn agent_approve_tool(
    approved: bool,
    model: String,
    active_cwd: Option<String>,
    window: WebviewWindow,
    _app_state: State<'_, AppState>,
) -> Result<AgentResponse, String> {
    let workspace = active_cwd.map(std::path::PathBuf::from).unwrap_or_else(|| {
        std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
    });
    let mut harness = AgentHarness::new(&workspace);

    // Lấy session — kiểm tra trạng thái hiện tại
    let session_store = get_session_store();
    let is_awaiting = {
        let session_guard = session_store.lock().unwrap();
        session_guard
            .as_ref()
            .map(|s| matches!(s.state, AgentState::AwaitingApproval(_)))
            .unwrap_or(false)
    };

    if !is_awaiting {
        return Err(
            "Agent is not waiting for approval. Current state is not AwaitingApproval.".to_string(),
        );
    }

    let mut session = {
        let mut session_guard = session_store.lock().unwrap();
        session_guard
            .take()
            .ok_or_else(|| "No active session found.".to_string())?
    };

    // ─── USER REJECTED ────────────────────────────────────────────
    if !approved {
        // Ghi rejection observation vào history
        session.history.push(ChatMessage {
            id: format!("obs_{}", Local::now().timestamp_millis()),
            role: "system".to_string(),
            content: MessageContent::Text(
                "<observation>User rejected executing this tool. Ask if they want to try a different approach.</observation>".to_string()
            ),
            timestamp: Local::now().format("%H:%M").to_string(),
        });

        // Chuyển về Thinking để AI phản hồi
        session.state = AgentState::Thinking;

        // Load model config và gọi tick tiếp
        let ai_cfg = load_custom_ai_config();
        let model_config = resolve_model_config(&ai_cfg, &model);
        let api_key = resolve_api_key(&model_config).unwrap_or_default();
        let api_standard = model_config
            .api_standard
            .unwrap_or_else(|| "gemini".to_string());
        let system_prompt = harness.assemble_system_prompt();
        let model_to_use = if !model.is_empty() {
            model.clone()
        } else if !ai_cfg.active_model.is_empty() {
            ai_cfg.active_model.clone()
        } else {
            "gemini-1.5-flash".to_string()
        };
        let api_url = model_config.api_url.clone();
        let temperature = model_config.temperature;
        let top_p = model_config.top_p;
        let saved_session_id = session.session_id.clone();

        // Một tick để phản hồi
        let llm_closure = move |sys_prompt: String, history: Vec<ChatMessage>| {
            let api_key = api_key.clone();
            let model = model_to_use.clone();
            let url = api_url.clone();
            let std = api_standard.clone();
            async move {
                rig_bridge::call_rig(
                    &std,
                    &api_key,
                    &model,
                    &url,
                    temperature,
                    top_p,
                    &sys_prompt,
                    &history
                )
                .await
            }
        };

        match harness
            .tick(&mut session, &system_prompt, llm_closure)
            .await
        {
            TickResult::Finished { text, .. } => {
                let mut session_guard = session_store.lock().unwrap();
                *session_guard = Some(session);
                return Ok(AgentResponse {
                    session_id: saved_session_id,
                    reply_type: "loop_result".to_string(),
                    text: Some(text),
                    tool_name: None,
                    args: None,
                    pending_id: None,
                    iteration: None,
                    total_iterations: None,
                    tool_result: None,
                });
            }
            TickResult::WaitForApproval { tools, iteration } => {
                // Lại cần approve nữa
                let tool = tools.first().cloned();
                let tool_name = tool.as_ref().map(|t| t.name.clone());
                let args = tool.as_ref().map(|t| t.arguments.to_string());
                let mut session_guard = session_store.lock().unwrap();
                *session_guard = Some(session);
                return Ok(AgentResponse {
                    session_id: format!("pending_{}", Local::now().timestamp()),
                    reply_type: "tool_request".to_string(),
                    text: None,
                    tool_name,
                    args,
                    pending_id: Some(format!("tool_{}", Local::now().timestamp_millis())),
                    iteration: Some(iteration),
                    total_iterations: Some(25),
                    tool_result: None,
                });
            }
            TickResult::Error { message, .. } => {
                let mut session_guard = session_store.lock().unwrap();
                *session_guard = Some(session);
                return Err(format!("Agent error after rejection: {}", message));
            }
            TickResult::Continue { .. } => {
                // Rejection shouldn't produce Continue, but handle gracefully
                let mut session_guard = session_store.lock().unwrap();
                *session_guard = Some(session);
                return Ok(AgentResponse {
                    session_id: saved_session_id,
                    reply_type: "text".to_string(),
                    text: Some("Tool rejected. What would you like to do instead?".to_string()),
                    tool_name: None,
                    args: None,
                    pending_id: None,
                    iteration: None,
                    total_iterations: None,
                    tool_result: None,
                });
            }
        }
    }

    // ─── USER APPROVED ──────────────────────────────────────────────
    // Chuyển trạng thái sang ExecutingTool → tick() sẽ tìm tool calls
    // từ history và tự động chạy
    session.state = AgentState::ExecutingTool;

    // Emit executing activity
    let _ = window.emit(
        "agent-activity",
        serde_json::json!({
            "status": "executing",
        }),
    );

    // Load model config
    let ai_cfg = load_custom_ai_config();
    let model_config = resolve_model_config(&ai_cfg, &model);
    let api_key = resolve_api_key(&model_config).unwrap_or_default();
    let api_standard = model_config
        .api_standard
        .unwrap_or_else(|| "gemini".to_string());
    let system_prompt = harness.assemble_system_prompt();
    let model_to_use = if !model.is_empty() {
        model.clone()
    } else if !ai_cfg.active_model.is_empty() {
        ai_cfg.active_model.clone()
    } else {
        "gemini-1.5-flash".to_string()
    };
    let api_url = model_config.api_url.clone();
    let temperature = model_config.temperature;
    let top_p = model_config.top_p;
    let saved_session_id = session.session_id.clone();
    let max_iterations = session.max_iterations;

    // ─── STATE MACHINE: Tick loop (tiếp tục từ ExecutingTool) ─────
    loop {
        // Kiểm tra ngắt trước mỗi bước
        if check_and_reset_cancel() {
            let _ = window.emit(
                "agent-cancelled",
                serde_json::json!({
                    "reason": "user_cancelled",
                }),
            );
            let mut sg = session_store.lock().unwrap();
            *sg = Some(session);
            return Ok(AgentResponse {
                session_id: saved_session_id,
                reply_type: "cancelled".to_string(),
                text: Some("Agent đã bị ngắt bởi người dùng.".to_string()),
                tool_name: None,
                args: None,
                pending_id: None,
                iteration: None,
                total_iterations: None,
                tool_result: None,
            });
        }
        let llm_closure = {
            let api_key = api_key.clone();
            let model = model_to_use.clone();
            let url = api_url.clone();
            let std = api_standard.clone();
            move |sys_prompt: String, history: Vec<ChatMessage>| {
                let api_key = api_key.clone();
                let model = model.clone();
                let url = url.clone();
                let std = std.clone();
                async move {
                    rig_bridge::call_rig(
                        &std,
                        &api_key,
                        &model,
                        &url,
                        temperature,
                        top_p,
                        &sys_prompt,
                        &history
                    )
                    .await
                }
            }
        };

        match harness
            .tick(&mut session, &system_prompt, llm_closure)
            .await
        {
            TickResult::Continue {
                thought,
                tool_name,
                tool_result,
                iteration,
            } => {
                let _ = window.emit(
                    "agent-iteration",
                    serde_json::json!({
                        "iteration": iteration,
                        "thought": thought,
                        "tool_name": tool_name,
                        "tool_result": tool_result,
                    }),
                );
                continue;
            }
            TickResult::WaitForApproval { tools, iteration } => {
                let tool = tools.first().cloned();
                let tool_name = tool.as_ref().map(|t| t.name.clone());
                let args = tool.as_ref().map(|t| t.arguments.to_string());
                let mut sg = session_store.lock().unwrap();
                *sg = Some(session);
                return Ok(AgentResponse {
                    session_id: format!("pending_{}", Local::now().timestamp()),
                    reply_type: "tool_request".to_string(),
                    text: None,
                    tool_name,
                    args,
                    pending_id: Some(format!("tool_{}", Local::now().timestamp_millis())),
                    iteration: Some(iteration),
                    total_iterations: Some(max_iterations),
                    tool_result: None,
                });
            }
            TickResult::Finished {
                text,
                total_iterations,
            } => {
                let _ = window.emit(
                    "agent-activity",
                    serde_json::json!({
                        "status": "idle",
                    }),
                );
                let mut sg = session_store.lock().unwrap();
                *sg = Some(session);
                return Ok(AgentResponse {
                    session_id: saved_session_id,
                    reply_type: "loop_result".to_string(),
                    text: Some(text),
                    tool_name: None,
                    args: None,
                    pending_id: None,
                    iteration: Some(total_iterations),
                    total_iterations: Some(max_iterations),
                    tool_result: None,
                });
            }
            TickResult::Error { message, iteration } => {
                let _ = window.emit(
                    "agent-activity",
                    serde_json::json!({
                        "status": "error",
                    }),
                );
                return Err(format!("Agent error (iter {}): {}", iteration, message));
            }
        }
    }
}

// ─── Session Management ─────────────────────────────────────────────────

#[tauri::command]
pub async fn agent_reset_session() -> Result<String, String> {
    let session_store = get_session_store();
    let mut session_guard = session_store.lock().unwrap();
    *session_guard = None;

    let mut loop_guard = get_loop_state().lock().unwrap();
    *loop_guard = None;

    Ok("✓ Session reset successfully.".to_string())
}

#[tauri::command]
pub fn get_custom_ai_config() -> Result<CustomAiConfig, String> {
    Ok(load_custom_ai_config())
}

fn load_dot_env() {
    let mut current = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    for _ in 0..10 {
        let check_path = current.join(".env");
        if check_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&check_path) {
                for line in content.lines() {
                    let line = line.trim();
                    if line.is_empty() || line.starts_with('#') {
                        continue;
                    }
                    if let Some((key, val)) = line.split_once('=') {
                        std::env::set_var(key.trim(), val.trim());
                    }
                }
            }
            break;
        }
        if !current.pop() {
            break;
        }
    }
}

fn get_encryption_key() -> Vec<u8> {
    load_dot_env();
    if let Ok(key) = std::env::var("ALOUETTE_ENCRYPTION_KEY") {
        key.into_bytes()
    } else {
        b"AlouetteSecretKey2026".to_vec()
    }
}

fn encrypt_key(plain: &str) -> String {
    if plain.is_empty() || plain == "none" {
        return plain.to_string();
    }
    let encryption_key = get_encryption_key();
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let mut xored = Vec::with_capacity(plain.len());
    for (i, byte) in plain.as_bytes().iter().enumerate() {
        xored.push(byte ^ encryption_key[i % encryption_key.len()]);
    }
    format!("enc:{}", STANDARD.encode(&xored))
}

fn decrypt_key(encrypted: &str) -> String {
    if !encrypted.starts_with("enc:") {
        return encrypted.to_string();
    }
    let encryption_key = get_encryption_key();
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let data_str = &encrypted[4..];
    if let Ok(decoded) = STANDARD.decode(data_str) {
        let mut plain = Vec::with_capacity(decoded.len());
        for (i, byte) in decoded.iter().enumerate() {
            plain.push(byte ^ encryption_key[i % encryption_key.len()]);
        }
        if let Ok(s) = String::from_utf8(plain) {
            return s;
        }
    }
    encrypted.to_string()
}

#[tauri::command]
pub fn save_custom_ai_config(mut config: CustomAiConfig) -> Result<(), String> {
    // Encrypt all API keys before saving
    for provider_config in config.providers.values_mut() {
        provider_config.api_key = encrypt_key(&provider_config.api_key);
    }

    let mut current = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let mut config_path = None;

    for _ in 0..10 {
        let check_path = current.join("core_engine/app_data/ai_config.yml");
        if check_path.exists() {
            config_path = Some(check_path);
            break;
        }
        if !current.pop() {
            break;
        }
    }

    let resolved_path = config_path.unwrap_or_else(|| {
        std::env::current_dir()
            .unwrap_or_default()
            .join("core_engine/app_data/ai_config.yml")
    });

    if let Some(parent) = resolved_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let yaml_str = serde_yaml::to_string(&config)
        .map_err(|e| format!("Failed to serialize custom AI config: {}", e))?;

    std::fs::write(&resolved_path, yaml_str)
        .map_err(|e| format!("Failed to write custom AI config to file: {}", e))?;

    Ok(())
}

// ─── Helpers ────────────────────────────────────────────────────────────

fn resolve_model_config(ai_cfg: &CustomAiConfig, model_hint: &str) -> ModelConfig {
    let model_key = if !model_hint.is_empty()
        && model_hint != "autonomous"
        && model_hint != "write"
        && model_hint != "full"
    {
        model_hint
    } else {
        &ai_cfg.active_model
    };

    for (provider_name, provider_cfg) in &ai_cfg.providers {
        if let Some(detail) = provider_cfg.models.get(model_key) {
            return ModelConfig {
                provider: provider_name.clone(),
                api_key: provider_cfg.api_key.clone(),
                api_url: detail
                    .api_url
                    .clone()
                    .or(provider_cfg.api_url.clone())
                    .unwrap_or_default(),
                context_limit: detail.context_limit,
                supports_vision: detail.supports_vision,
                temperature: detail.temperature.unwrap_or(0.2),
                top_p: detail.top_p.unwrap_or(0.95),
                api_standard: detail.api_standard.clone(),
            };
        }
    }

    // Fallback default config
    ModelConfig {
        provider: "gemini".to_string(),
        api_key: String::new(),
        api_url: "https://generativelanguage.googleapis.com/v1beta".to_string(),
        context_limit: 1048576,
        supports_vision: true,
        temperature: 0.2,
        top_p: 0.95,
        api_standard: Some("gemini".to_string()),
    }
}

fn resolve_api_key(model_config: &ModelConfig) -> Result<String, String> {
    // Prefer the stored (possibly encrypted) key
    let stored = model_config.api_key.trim();
    if !stored.is_empty() && stored != "none" {
        // Decrypt if needed (decrypt_key is a no-op for plain keys)
        let plain = decrypt_key(stored);
        if !plain.is_empty() && plain != "none" {
            return Ok(plain);
        }
    }
    // Provider-aware fallback to environment variables
    let env_var = match model_config.provider.as_str() {
        "claude" => "ANTHROPIC_API_KEY",
        "openai" | "gpt-chatgpt" => "OPENAI_API_KEY",
        "deepseek" => "DEEPSEEK_API_KEY",
        "qwen" => "DASHSCOPE_API_KEY",
        _ => "GEMINI_API_KEY",
    };
    std::env::var(env_var)
        .or_else(|_| std::env::var("GEMINI_API_KEY"))
        .map_err(|_| format!(
            "API Key chưa được thiết lập cho provider '{}'. Vui lòng vào phần Setting để cấu hình API Key.",
            model_config.provider
        ))
}

fn load_custom_ai_config() -> CustomAiConfig {
    let mut current = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let mut config_path = None;

    for _ in 0..10 {
        let check_path = current.join("core_engine/app_data/ai_config.yml");
        if check_path.exists() {
            config_path = Some(check_path);
            break;
        }
        if !current.pop() {
            break;
        }
    }

    let resolved_path = config_path.unwrap_or_else(|| {
        std::env::current_dir()
            .unwrap_or_default()
            .join("core_engine/app_data/ai_config.yml")
    });

    if let Ok(content) = std::fs::read_to_string(&resolved_path) {
        if let Ok(mut config) = serde_yaml::from_str::<CustomAiConfig>(&content) {
            // Decrypt all API keys after loading
            for provider_config in config.providers.values_mut() {
                provider_config.api_key = decrypt_key(&provider_config.api_key);
            }
            return config;
        }
    }

    // Fallback default config
    let mut providers = std::collections::HashMap::new();

    // DeepSeek
    let mut deepseek_models = std::collections::HashMap::new();
    deepseek_models.insert(
        "deepseek-v4-pro".to_string(),
        ModelDetail {
            context_limit: 1000000,
            supports_vision: false,
            api_standard: Some("openai".to_string()),
            api_url: Some("https://api.deepseek.com/v1".to_string()),
            temperature: Some(0.2),
            top_p: Some(0.95),
        },
    );
    deepseek_models.insert(
        "deepseek-v4-flash".to_string(),
        ModelDetail {
            context_limit: 1000000,
            supports_vision: false,
            api_standard: Some("openai".to_string()),
            api_url: Some("https://api.deepseek.com/v1".to_string()),
            temperature: Some(0.2),
            top_p: Some(0.95),
        },
    );
    deepseek_models.insert(
        "deepseek-v4".to_string(),
        ModelDetail {
            context_limit: 1000000,
            supports_vision: false,
            api_standard: Some("openai".to_string()),
            api_url: Some("https://api.deepseek.com/v1".to_string()),
            temperature: Some(0.2),
            top_p: Some(0.95),
        },
    );
    deepseek_models.insert(
        "deepseek-r1".to_string(),
        ModelDetail {
            context_limit: 1000000,
            supports_vision: false,
            api_standard: Some("openai".to_string()),
            api_url: Some("https://api.deepseek.com/v1".to_string()),
            temperature: Some(0.2),
            top_p: Some(0.95),
        },
    );
    providers.insert(
        "deepseek".to_string(),
        ProviderConfig {
            api_key: "".to_string(),
            api_url: Some("https://api.deepseek.com/v1".to_string()),
            models: deepseek_models,
        },
    );

    // Claude
    let mut claude_models = std::collections::HashMap::new();
    claude_models.insert(
        "claude-opus-4.7".to_string(),
        ModelDetail {
            context_limit: 200000,
            supports_vision: true,
            api_standard: Some("claude".to_string()),
            api_url: Some("https://api.anthropic.com/v1".to_string()),
            temperature: Some(0.2),
            top_p: Some(0.95),
        },
    );
    claude_models.insert(
        "claude-sonnet-5".to_string(),
        ModelDetail {
            context_limit: 200000,
            supports_vision: true,
            api_standard: Some("claude".to_string()),
            api_url: Some("https://api.anthropic.com/v1".to_string()),
            temperature: Some(0.2),
            top_p: Some(0.95),
        },
    );
    providers.insert(
        "claude".to_string(),
        ProviderConfig {
            api_key: "".to_string(),
            api_url: Some("https://api.anthropic.com/v1".to_string()),
            models: claude_models,
        },
    );

    // GPT
    let mut gpt_models = std::collections::HashMap::new();
    gpt_models.insert(
        "gpt-5.5".to_string(),
        ModelDetail {
            context_limit: 200000,
            supports_vision: true,
            api_standard: Some("openai".to_string()),
            api_url: Some("https://api.openai.com/v1".to_string()),
            temperature: Some(0.2),
            top_p: Some(0.95),
        },
    );
    gpt_models.insert(
        "o1-pro".to_string(),
        ModelDetail {
            context_limit: 200000,
            supports_vision: false,
            api_standard: Some("openai".to_string()),
            api_url: Some("https://api.openai.com/v1".to_string()),
            temperature: Some(0.2),
            top_p: Some(0.95),
        },
    );
    gpt_models.insert(
        "o3-mini".to_string(),
        ModelDetail {
            context_limit: 200000,
            supports_vision: false,
            api_standard: Some("openai".to_string()),
            api_url: Some("https://api.openai.com/v1".to_string()),
            temperature: Some(0.2),
            top_p: Some(0.95),
        },
    );
    gpt_models.insert(
        "gpt-4o".to_string(),
        ModelDetail {
            context_limit: 128000,
            supports_vision: true,
            api_standard: Some("openai".to_string()),
            api_url: Some("https://api.openai.com/v1".to_string()),
            temperature: Some(0.2),
            top_p: Some(0.95),
        },
    );
    providers.insert(
        "gpt-chatgpt".to_string(),
        ProviderConfig {
            api_key: "".to_string(),
            api_url: Some("https://api.openai.com/v1".to_string()),
            models: gpt_models,
        },
    );

    // Gemini
    let mut gemini_models = std::collections::HashMap::new();
    gemini_models.insert(
        "gemini-3.5-flash".to_string(),
        ModelDetail {
            context_limit: 1000000,
            supports_vision: true,
            api_standard: Some("gemini".to_string()),
            api_url: Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
            temperature: Some(0.2),
            top_p: Some(0.95),
        },
    );
    gemini_models.insert(
        "gemini-3.1-pro".to_string(),
        ModelDetail {
            context_limit: 1000000,
            supports_vision: true,
            api_standard: Some("gemini".to_string()),
            api_url: Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
            temperature: Some(0.2),
            top_p: Some(0.95),
        },
    );
    gemini_models.insert(
        "gemini-1.5-flash".to_string(),
        ModelDetail {
            context_limit: 1000000,
            supports_vision: true,
            api_standard: Some("gemini".to_string()),
            api_url: Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
            temperature: Some(0.2),
            top_p: Some(0.95),
        },
    );
    gemini_models.insert(
        "gemini-1.5-pro".to_string(),
        ModelDetail {
            context_limit: 1000000,
            supports_vision: true,
            api_standard: Some("gemini".to_string()),
            api_url: Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
            temperature: Some(0.2),
            top_p: Some(0.95),
        },
    );
    providers.insert(
        "gemini".to_string(),
        ProviderConfig {
            api_key: "".to_string(),
            api_url: Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
            models: gemini_models,
        },
    );

    // Qwen
    let mut qwen_models = std::collections::HashMap::new();
    qwen_models.insert(
        "qwen-3.7-max".to_string(),
        ModelDetail {
            context_limit: 128000,
            supports_vision: false,
            api_standard: Some("openai".to_string()),
            api_url: Some("https://dashscope.aliyuncs.com/compatible-mode/v1".to_string()),
            temperature: Some(0.2),
            top_p: Some(0.95),
        },
    );
    providers.insert(
        "qwen".to_string(),
        ProviderConfig {
            api_key: "".to_string(),
            api_url: Some("https://dashscope.aliyuncs.com/compatible-mode/v1".to_string()),
            models: qwen_models,
        },
    );

    CustomAiConfig {
        active_model: "gemini-3.5-flash".to_string(),
        providers,
    }
}

