use std::sync::Mutex;
use std::sync::OnceLock;
use tauri::{State, WebviewWindow, Emitter};
use serde::{Serialize, Deserialize};
use serde_json::{json, Value};
use core_engine::agent_harness::{
    HarnessMode, AgentHarness, ChatMessage, AgentSession,
    AgentLoopConfig, AgentLoopResult, AgentLoopIteration,
};
use crate::state::AppState;
use chrono::Local;

// Thread-safe session storage using standard library OnceLock and Mutex
static CURRENT_SESSION: OnceLock<Mutex<Option<AgentSession>>> = OnceLock::new();

fn get_session_store() -> &'static Mutex<Option<AgentSession>> {
    CURRENT_SESSION.get_or_init(|| Mutex::new(None))
}

// ─── Response Types ─────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentResponse {
    pub session_id: String,
    pub reply_type: String, // "text" | "tool_request" | "agent_activity" | "loop_result"
    pub text: Option<String>,
    pub tool_name: Option<String>,
    pub args: Option<String>,
    pub pending_id: Option<String>,
    pub loop_result: Option<AgentLoopResultUI>,
    pub iteration: Option<u32>,
    pub total_iterations: Option<u32>,
    pub tool_result: Option<String>,
}

/// UI-friendly version of AgentLoopResult
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentLoopResultUI {
    pub iterations: Vec<AgentLoopIterationUI>,
    pub final_text: Option<String>,
    pub total_iterations: u32,
    pub tool_calls_made: u32,
    pub stopped_early: bool,
    pub stop_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentLoopIterationUI {
    pub iteration: u32,
    pub thought: Option<String>,
    pub tool_name: Option<String>,
    pub tool_args: Option<String>,
    pub tool_result: Option<String>,
    pub tool_success: bool,
    pub timestamp: String,
}

impl From<AgentLoopResult> for AgentLoopResultUI {
    fn from(r: AgentLoopResult) -> Self {
        Self {
            iterations: r.iterations.into_iter().map(|i| AgentLoopIterationUI {
                iteration: i.iteration,
                thought: i.thought,
                tool_name: i.tool_name,
                tool_args: i.tool_args,
                tool_result: i.tool_result,
                tool_success: i.tool_success,
                timestamp: i.timestamp,
            }).collect(),
            final_text: r.final_text,
            total_iterations: r.total_iterations,
            tool_calls_made: r.tool_calls_made,
            stopped_early: r.stopped_early,
            stop_reason: r.stop_reason,
        }
    }
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
    let workspace = active_cwd
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")));
    let mut harness = AgentHarness::new(&workspace);

    // Load model config
    let ai_cfg = load_custom_ai_config();
    let model_config = resolve_model_config(&ai_cfg, &model);
    let api_key = resolve_api_key(&model_config)?;

    // Initialize or load session
    let session_store = get_session_store();
    let mut session = {
        let mut session_guard = session_store.lock().unwrap();
        let mut session = session_guard.take().unwrap_or_else(|| AgentSession {
            session_id: format!("sess_{}", Local::now().timestamp()),
            history: Vec::new(),
            current_thought: None,
            pending_tool: None,
            mode: HarnessMode::Standard,
            plan: None,
            autonomous_state: None,
        });

        // Add user message to history
        session.history.push(ChatMessage {
            id: format!("usr_{}", Local::now().timestamp_millis()),
            role: "user".to_string(),
            content: message.clone(),
            timestamp: Local::now().format("%H:%M").to_string(),
        });
        session
    };

    // Build system prompt
    let system_prompt = harness.assemble_system_prompt();

    // Determine loop config based on mode
    let is_autonomous = mode == "autonomous";
    let is_write_mode = mode == "write" || mode == "full";

    let loop_config = AgentLoopConfig {
        max_iterations: 25,
        auto_approve_reads: true,
        auto_approve_writes: is_write_mode || is_autonomous,
        auto_approve_all: is_autonomous,
        command_timeout_secs: 120,
        session_id: session.session_id.clone(),
    };

    // Save loop state for approval continuation
    {
        let mut state = get_loop_state().lock().unwrap();
        *state = Some(LoopState {
            max_iterations: loop_config.max_iterations,
            auto_approve_reads: loop_config.auto_approve_reads,
            auto_approve_writes: loop_config.auto_approve_writes,
            auto_approve_all: loop_config.auto_approve_all,
            command_timeout_secs: loop_config.command_timeout_secs,
            iteration_count: 0,
        });
    }

    let api_standard = model_config.api_standard.clone()
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

    // ─── Run Agent Loop ──────────────────────────────────────────────
    let loop_result = harness.run_agent_loop(
        &system_prompt,
        &mut session.history,
        loop_config,
        // LLM call closure
        move |sys_prompt: String, history: Vec<ChatMessage>| {
            let api_key = api_key_clone.clone();
            let model = model_to_use.clone();
            let url = api_url.clone();
            let std = api_standard.clone();
            async move {
                match std.as_str() {
                    "openai" => call_openai_api(&api_key, &model, &url, temperature, top_p, &sys_prompt, &history).await,
                    "claude" => call_claude_api(&api_key, &model, &url, temperature, top_p, &sys_prompt, &history).await,
                    _ => call_gemini_api(&api_key, &model, &url, temperature, top_p, &sys_prompt, &history).await,
                }
            }
        },
        // Real-time iteration callback → emit to UI
        Some({
            let win = window.clone();
            move |iteration: AgentLoopIteration| {
                let _ = win.emit("agent-iteration", serde_json::json!({
                    "iteration": iteration.iteration,
                    "thought": iteration.thought,
                    "tool_name": iteration.tool_name,
                    "tool_args": iteration.tool_args,
                    "tool_result": iteration.tool_result,
                    "tool_success": iteration.tool_success,
                    "timestamp": iteration.timestamp,
                }));
            }
        }),
    ).await;

    // Update iteration count
    {
        let mut state = get_loop_state().lock().unwrap();
        if let Some(ref mut s) = *state {
            s.iteration_count = loop_result.tool_calls_made;
        }
    }

    // Build response and set pending_tool if stopped early
    let ui_result: AgentLoopResultUI = loop_result.into();
    let ui_iterations = ui_result.total_iterations;

    if ui_result.stopped_early {
        if let Some(last_iter) = ui_result.iterations.last() {
            if let (Some(ref name), Some(ref args_str)) = (&last_iter.tool_name, &last_iter.tool_args) {
                if let Ok(args_json) = serde_json::from_str::<serde_json::Value>(args_str) {
                    session.pending_tool = Some(core_engine::agent_harness::parser::ToolCall {
                        name: name.clone(),
                        arguments: args_json,
                        raw_arguments: args_str.clone(),
                        call_id: None,
                    });
                }
            }
        }
    }

    // Save session - save session_id before move
    let saved_session_id = session.session_id.clone();
    {
        let mut session_guard = session_store.lock().unwrap();
        *session_guard = Some(session);
    }

    if ui_result.stopped_early && ui_result.iterations.last()
        .and_then(|i| i.tool_name.as_ref())
        .is_some()
    {
        // Cần user approval cho tool cuối
        let last_iter = ui_result.iterations.last().unwrap();
        Ok(AgentResponse {
            session_id: format!("pending_{}", Local::now().timestamp()),
            reply_type: "tool_request".to_string(),
            text: None,
            tool_name: last_iter.tool_name.clone(),
            args: last_iter.tool_args.clone(),
            pending_id: Some(format!("tool_{}", Local::now().timestamp_millis())),
            loop_result: Some(ui_result),
            iteration: Some(ui_iterations),
            total_iterations: Some(25),
            tool_result: None,
        })
    } else if let Some(ref text) = ui_result.final_text {
        Ok(AgentResponse {
            session_id: saved_session_id,
            reply_type: "loop_result".to_string(),
            text: Some(text.clone()),
            tool_name: None,
            args: None,
            pending_id: None,
            loop_result: Some(ui_result),
            iteration: Some(ui_iterations),
            total_iterations: Some(25),
            tool_result: None,
        })
    } else {
        Ok(AgentResponse {
            session_id: saved_session_id,
            reply_type: "agent_activity".to_string(),
            text: ui_result.stop_reason.clone().or_else(|| Some("Hoàn thành.".to_string())),
            tool_name: None,
            args: None,
            pending_id: None,
            loop_result: Some(ui_result),
            iteration: Some(ui_iterations),
            total_iterations: Some(25),
            tool_result: None,
        })
    }
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
    let workspace = active_cwd
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")));
    let mut harness = AgentHarness::new(&workspace);

    let session_store = get_session_store();
    let (mut session, pending_tool) = {
        let mut session_guard = session_store.lock().unwrap();
        let mut session = session_guard.take().ok_or_else(|| "No active session found".to_string())?;
        let tool = session.pending_tool.take().ok_or_else(|| "No pending tool call found".to_string())?;
        (session, tool)
    };

    if !approved {
        // User từ chối → ghi observation và trả về
        session.history.push(ChatMessage {
            id: format!("obs_{}", Local::now().timestamp_millis()),
            role: "system".to_string(),
            content: "<observation>User rejected executing this tool. Ask if they want to try a different approach.</observation>".to_string(),
            timestamp: Local::now().format("%H:%M").to_string(),
        });

        // Lưu session và gọi LLM 1 lần để phản hồi
        let ai_cfg = load_custom_ai_config();
        let model_config = resolve_model_config(&ai_cfg, &model);
        let api_key = resolve_api_key(&model_config).unwrap_or_default();
        let api_standard = model_config.api_standard.unwrap_or_else(|| "gemini".to_string());
        let system_prompt = harness.assemble_system_prompt();

        let model_to_use = if !model.is_empty() {
            model.clone()
        } else if !ai_cfg.active_model.is_empty() {
            ai_cfg.active_model.clone()
        } else {
            "gemini-1.5-flash".to_string()
        };

        let llm_reply = if !api_key.is_empty() {
            match api_standard.as_str() {
                "openai" => call_openai_api(&api_key, &model_to_use, &model_config.api_url,
                    model_config.temperature, model_config.top_p, &system_prompt, &session.history).await,
                "claude" => call_claude_api(&api_key, &model_to_use, &model_config.api_url,
                    model_config.temperature, model_config.top_p, &system_prompt, &session.history).await,
                _ => call_gemini_api(&api_key, &model_to_use, &model_config.api_url,
                    model_config.temperature, model_config.top_p, &system_prompt, &session.history).await,
            }
        } else {
            Ok("Understood. Let me know what you'd like to do instead.".to_string())
        };

        let text = llm_reply.unwrap_or_else(|_| "Công cụ đã bị từ chối.".to_string());
        session.history.push(ChatMessage {
            id: format!("model_{}", Local::now().timestamp_millis()),
            role: "model".to_string(),
            content: text.clone(),
            timestamp: Local::now().format("%H:%M").to_string(),
        });

        {
            let mut session_guard = session_store.lock().unwrap();
            *session_guard = Some(session);
        }

        return Ok(AgentResponse {
            session_id: String::new(),
            reply_type: "text".to_string(),
            text: Some(text),
            tool_name: None,
            args: None,
            pending_id: None,
            loop_result: None,
            iteration: None,
            total_iterations: None,
            tool_result: None,
        });
    }

    // ─── USER APPROVED ──────────────────────────────────────────────
    // Emit executing activity
    let _ = window.emit("agent-activity", serde_json::json!({
        "status": "executing",
        "tool_name": pending_tool.name.clone(),
        "args": pending_tool.arguments.to_string(),
    }));

    // Execute the approved tool
    let result = harness.execute_tool(&session.session_id, &pending_tool).await
        .unwrap_or_else(|e| e);

    let _ = window.emit("agent-activity", serde_json::json!({
        "status": "idle",
    }));

    // Add observation to history
    session.history.push(ChatMessage {
        id: format!("obs_{}", Local::now().timestamp_millis()),
        role: "system".to_string(),
        content: format!("<observation>\n{}\n</observation>", result),
        timestamp: Local::now().format("%H:%M").to_string(),
    });

    // ─── TIẾP TỤC VÒNG LẶP ─────────────────────────────────────────
    // Sau khi user approve, tự động gọi LLM và tiếp tục loop
    let ai_cfg = load_custom_ai_config();
    let model_config = resolve_model_config(&ai_cfg, &model);
    let api_key = resolve_api_key(&model_config).unwrap_or_default();
    let api_standard = model_config.api_standard.unwrap_or_else(|| "gemini".to_string());
    let model_to_use = if !model.is_empty() {
        model.clone()
    } else if !ai_cfg.active_model.is_empty() {
        ai_cfg.active_model.clone()
    } else {
        "gemini-1.5-flash".to_string()
    };
    let system_prompt = harness.assemble_system_prompt();

    // Get loop config from stored state
    let loop_cfg = {
        let state = get_loop_state().lock().unwrap();
        state.clone().unwrap_or_default()
    };

    let loop_config = AgentLoopConfig {
        max_iterations: loop_cfg.max_iterations,
        auto_approve_reads: loop_cfg.auto_approve_reads,
        auto_approve_writes: loop_cfg.auto_approve_writes,
        auto_approve_all: loop_cfg.auto_approve_all,
        command_timeout_secs: loop_cfg.command_timeout_secs,
        session_id: session.session_id.clone(),
    };

    // If auto_approve_all is on, run full loop
    // Otherwise do one more LLM call to check if it needs another tool
    let api_key_clone = api_key.clone();
    let api_url = model_config.api_url.clone();
    let temperature = model_config.temperature;
    let top_p = model_config.top_p;

    let saved_session_id = session.session_id.clone();

    // ─── CHẠY TIẾP VÒNG LẶP CHO ĐẾN KHI CẦN DUYỆT HOẶC HOÀN THÀNH ────────────────
    let loop_result = harness.run_agent_loop(
        &system_prompt,
        &mut session.history,
        loop_config,
        move |sys_prompt: String, history: Vec<ChatMessage>| {
            let api_key = api_key_clone.clone();
            let model = model_to_use.clone();
            let url = api_url.clone();
            let std = api_standard.clone();
            async move {
                match std.as_str() {
                    "openai" => call_openai_api(&api_key, &model, &url, temperature, top_p, &sys_prompt, &history).await,
                    "claude" => call_claude_api(&api_key, &model, &url, temperature, top_p, &sys_prompt, &history).await,
                    _ => call_gemini_api(&api_key, &model, &url, temperature, top_p, &sys_prompt, &history).await,
                }
            }
        },
        Some({
            let win = window.clone();
            move |iteration: AgentLoopIteration| {
                let _ = win.emit("agent-iteration", serde_json::json!({
                    "iteration": iteration.iteration,
                    "thought": iteration.thought,
                    "tool_name": iteration.tool_name,
                    "tool_args": iteration.tool_args,
                    "tool_result": iteration.tool_result,
                    "tool_success": iteration.tool_success,
                    "timestamp": iteration.timestamp,
                }));
            }
        }),
    ).await;

    let ui_result: AgentLoopResultUI = loop_result.into();
    let ui_iter = ui_result.total_iterations;

    // Check if loop was suspended because it needs user approval for next tool
    if ui_result.stopped_early && ui_result.iterations.last()
        .and_then(|i| i.tool_name.as_ref())
        .is_some()
    {
        let last_iter = ui_result.iterations.last().unwrap();
        let pending_id = format!("tool_{}", Local::now().timestamp_millis());

        // Save the pending tool for next approval
        if let (Some(ref name), Some(ref args_str)) = (&last_iter.tool_name, &last_iter.tool_args) {
            if let Ok(args_json) = serde_json::from_str::<serde_json::Value>(args_str) {
                session.pending_tool = Some(core_engine::agent_harness::parser::ToolCall {
                    name: name.clone(),
                    arguments: args_json,
                    raw_arguments: args_str.clone(),
                    call_id: None,
                });
            }
        }

        // Save session
        {
            let mut session_guard = session_store.lock().unwrap();
            *session_guard = Some(session);
        }

        Ok(AgentResponse {
            session_id: saved_session_id,
            reply_type: "tool_request".to_string(),
            text: None,
            tool_name: last_iter.tool_name.clone(),
            args: last_iter.tool_args.clone(),
            pending_id: Some(pending_id),
            loop_result: Some(ui_result),
            iteration: Some(ui_iter),
            total_iterations: Some(loop_cfg.max_iterations),
            tool_result: Some(result.clone()),
        })
    } else if let Some(ref text) = ui_result.final_text {
        // Save session
        {
            let mut session_guard = session_store.lock().unwrap();
            *session_guard = Some(session);
        }

        Ok(AgentResponse {
            session_id: saved_session_id,
            reply_type: "loop_result".to_string(),
            text: Some(text.clone()),
            tool_name: None,
            args: None,
            pending_id: None,
            loop_result: Some(ui_result),
            iteration: Some(ui_iter),
            total_iterations: Some(loop_cfg.max_iterations),
            tool_result: Some(result.clone()),
        })
    } else {
        // Save session
        {
            let mut session_guard = session_store.lock().unwrap();
            *session_guard = Some(session);
        }

        Ok(AgentResponse {
            session_id: saved_session_id,
            reply_type: "agent_activity".to_string(),
            text: ui_result.stop_reason.clone().or_else(|| Some("Hoàn thành.".to_string())),
            tool_name: None,
            args: None,
            pending_id: None,
            loop_result: Some(ui_result),
            iteration: Some(ui_iter),
            total_iterations: Some(loop_cfg.max_iterations),
            tool_result: Some(result.clone()),
        })
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
    use base64::{Engine as _, engine::general_purpose::STANDARD};
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
    use base64::{Engine as _, engine::general_purpose::STANDARD};
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
        std::env::current_dir().unwrap_or_default().join("core_engine/app_data/ai_config.yml")
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
    let model_key = if !model_hint.is_empty() && model_hint != "autonomous" && model_hint != "write" && model_hint != "full" {
        model_hint
    } else {
        &ai_cfg.active_model
    };

    for (provider_name, provider_cfg) in &ai_cfg.providers {
        if let Some(detail) = provider_cfg.models.get(model_key) {
            return ModelConfig {
                provider: provider_name.clone(),
                api_key: provider_cfg.api_key.clone(),
                api_url: detail.api_url.clone().or(provider_cfg.api_url.clone()).unwrap_or_default(),
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
    if !model_config.api_key.is_empty() && model_config.api_key != "none" {
        Ok(model_config.api_key.clone())
    } else if let Ok(env_key) = std::env::var("GEMINI_API_KEY") {
        Ok(env_key)
    } else {
        Err("API Key chưa được thiết lập. Vui lòng vào phần Setting (Cài đặt) để cấu hình API Key trước khi sử dụng AI Agent.".to_string())
    }
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
        std::env::current_dir().unwrap_or_default().join("core_engine/app_data/ai_config.yml")
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
    deepseek_models.insert("deepseek-v4-pro".to_string(), ModelDetail {
        context_limit: 1000000,
        supports_vision: false,
        api_standard: Some("openai".to_string()),
        api_url: Some("https://api.deepseek.com/v1".to_string()),
        temperature: Some(0.2),
        top_p: Some(0.95),
    });
    deepseek_models.insert("deepseek-v4-flash".to_string(), ModelDetail {
        context_limit: 1000000,
        supports_vision: false,
        api_standard: Some("openai".to_string()),
        api_url: Some("https://api.deepseek.com/v1".to_string()),
        temperature: Some(0.2),
        top_p: Some(0.95),
    });
    deepseek_models.insert("deepseek-v4".to_string(), ModelDetail {
        context_limit: 1000000,
        supports_vision: false,
        api_standard: Some("openai".to_string()),
        api_url: Some("https://api.deepseek.com/v1".to_string()),
        temperature: Some(0.2),
        top_p: Some(0.95),
    });
    deepseek_models.insert("deepseek-r1".to_string(), ModelDetail {
        context_limit: 1000000,
        supports_vision: false,
        api_standard: Some("openai".to_string()),
        api_url: Some("https://api.deepseek.com/v1".to_string()),
        temperature: Some(0.2),
        top_p: Some(0.95),
    });
    providers.insert("deepseek".to_string(), ProviderConfig {
        api_key: "".to_string(),
        api_url: Some("https://api.deepseek.com/v1".to_string()),
        models: deepseek_models,
    });

    // Claude
    let mut claude_models = std::collections::HashMap::new();
    claude_models.insert("claude-opus-4.7".to_string(), ModelDetail {
        context_limit: 200000,
        supports_vision: true,
        api_standard: Some("claude".to_string()),
        api_url: Some("https://api.anthropic.com/v1".to_string()),
        temperature: Some(0.2),
        top_p: Some(0.95),
    });
    claude_models.insert("claude-sonnet-5".to_string(), ModelDetail {
        context_limit: 200000,
        supports_vision: true,
        api_standard: Some("claude".to_string()),
        api_url: Some("https://api.anthropic.com/v1".to_string()),
        temperature: Some(0.2),
        top_p: Some(0.95),
    });
    providers.insert("claude".to_string(), ProviderConfig {
        api_key: "".to_string(),
        api_url: Some("https://api.anthropic.com/v1".to_string()),
        models: claude_models,
    });

    // GPT
    let mut gpt_models = std::collections::HashMap::new();
    gpt_models.insert("gpt-5.5".to_string(), ModelDetail {
        context_limit: 200000,
        supports_vision: true,
        api_standard: Some("openai".to_string()),
        api_url: Some("https://api.openai.com/v1".to_string()),
        temperature: Some(0.2),
        top_p: Some(0.95),
    });
    gpt_models.insert("o1-pro".to_string(), ModelDetail {
        context_limit: 200000,
        supports_vision: false,
        api_standard: Some("openai".to_string()),
        api_url: Some("https://api.openai.com/v1".to_string()),
        temperature: Some(0.2),
        top_p: Some(0.95),
    });
    gpt_models.insert("o3-mini".to_string(), ModelDetail {
        context_limit: 200000,
        supports_vision: false,
        api_standard: Some("openai".to_string()),
        api_url: Some("https://api.openai.com/v1".to_string()),
        temperature: Some(0.2),
        top_p: Some(0.95),
    });
    gpt_models.insert("gpt-4o".to_string(), ModelDetail {
        context_limit: 128000,
        supports_vision: true,
        api_standard: Some("openai".to_string()),
        api_url: Some("https://api.openai.com/v1".to_string()),
        temperature: Some(0.2),
        top_p: Some(0.95),
    });
    providers.insert("gpt-chatgpt".to_string(), ProviderConfig {
        api_key: "".to_string(),
        api_url: Some("https://api.openai.com/v1".to_string()),
        models: gpt_models,
    });

    // Gemini
    let mut gemini_models = std::collections::HashMap::new();
    gemini_models.insert("gemini-3.5-flash".to_string(), ModelDetail {
        context_limit: 1000000,
        supports_vision: true,
        api_standard: Some("gemini".to_string()),
        api_url: Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
        temperature: Some(0.2),
        top_p: Some(0.95),
    });
    gemini_models.insert("gemini-3.1-pro".to_string(), ModelDetail {
        context_limit: 1000000,
        supports_vision: true,
        api_standard: Some("gemini".to_string()),
        api_url: Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
        temperature: Some(0.2),
        top_p: Some(0.95),
    });
    gemini_models.insert("gemini-1.5-flash".to_string(), ModelDetail {
        context_limit: 1000000,
        supports_vision: true,
        api_standard: Some("gemini".to_string()),
        api_url: Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
        temperature: Some(0.2),
        top_p: Some(0.95),
    });
    gemini_models.insert("gemini-1.5-pro".to_string(), ModelDetail {
        context_limit: 1000000,
        supports_vision: true,
        api_standard: Some("gemini".to_string()),
        api_url: Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
        temperature: Some(0.2),
        top_p: Some(0.95),
    });
    providers.insert("gemini".to_string(), ProviderConfig {
        api_key: "".to_string(),
        api_url: Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
        models: gemini_models,
    });

    // Qwen
    let mut qwen_models = std::collections::HashMap::new();
    qwen_models.insert("qwen-3.7-max".to_string(), ModelDetail {
        context_limit: 128000,
        supports_vision: false,
        api_standard: Some("openai".to_string()),
        api_url: Some("https://dashscope.aliyuncs.com/compatible-mode/v1".to_string()),
        temperature: Some(0.2),
        top_p: Some(0.95),
    });
    providers.insert("qwen".to_string(), ProviderConfig {
        api_key: "".to_string(),
        api_url: Some("https://dashscope.aliyuncs.com/compatible-mode/v1".to_string()),
        models: qwen_models,
    });

    CustomAiConfig {
        active_model: "gemini-3.5-flash".to_string(),
        providers,
    }
}

// ─── LLM API Callers ────────────────────────────────────────────────────

/// Native Tool Calling: Gemini API
async fn call_gemini_api(
    api_key: &str,
    model: &str,
    api_url: &str,
    temperature: f32,
    top_p: f32,
    system_prompt: &str,
    history: &[ChatMessage],
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let model_name = if model.is_empty() { "gemini-1.5-flash" } else { model };

    let url = if api_url.contains("generateContent") {
        format!("{}?key={}", api_url, api_key)
    } else {
        format!(
            "{}/models/{}:generateContent?key={}",
            api_url.trim_end_matches('/'), model_name, api_key
        )
    };

    // ─── Build Gemini contents with role merging ────────────────────
    // Gemini doesn't support consecutive same-role messages, so we merge them
    let mut contents: Vec<Value> = Vec::new();

    for msg in history {
        let (gemini_role, parts) = match msg.role.as_str() {
            "user" => {
                ("user", vec![json!({"text": msg.content})])
            }
            "model" | "assistant" => {
                // Check if content contains JSON tool_calls (from previous turns)
                if let Ok(val) = serde_json::from_str::<Value>(&msg.content) {
                    if let Some(tcs) = val.get("tool_calls").and_then(|t| t.as_array()) {
                        let mut model_parts: Vec<Value> = Vec::new();
                        // Text content
                        if let Some(text) = val.get("content").and_then(|c| c.as_str()) {
                            if !text.is_empty() {
                                model_parts.push(json!({"text": text}));
                            }
                        }
                        // Convert tool_calls back to functionCall
                        for tc in tcs {
                            if let Some(name) = tc["function"]["name"].as_str() {
                                let args_str = tc["function"]["arguments"].as_str().unwrap_or("{}");
                                let args: Value = serde_json::from_str(args_str).unwrap_or_default();
                                model_parts.push(json!({
                                    "functionCall": {
                                        "name": name,
                                        "args": args
                                    }
                                }));
                            }
                        }
                        ("model", model_parts)
                    } else {
                        ("model", vec![json!({"text": msg.content})])
                    }
                } else {
                    ("model", vec![json!({"text": msg.content})])
                }
            }
            "tool" => {
                // Parse tool result JSON: {"result": "...", "success": true}
                let tool_data = serde_json::from_str::<Value>(&msg.content)
                    .unwrap_or_else(|_| json!({"result": msg.content, "success": true}));
                let result_text = tool_data.get("result").and_then(|r| r.as_str())
                    .unwrap_or(&msg.content)
                    .to_string();

                // Gemini's function response format: role "function" with functionResponse
                ("function", vec![json!({
                    "functionResponse": {
                        "name": msg.id,  // Using msg.id as function name reference
                        "response": {
                            "result": result_text
                        }
                    }
                })])
            }
            _ => continue,
        };

        // Merge with last message if same role
        if let Some(last) = contents.last_mut() {
            if last["role"] == gemini_role {
                if let Some(parts_arr) = last["parts"].as_array_mut() {
                    parts_arr.extend(parts);
                }
                continue;
            }
        }

        // Skip leading model messages (Gemini requires first message to be user)
        if contents.is_empty() && gemini_role == "model" {
            continue;
        }

        contents.push(json!({
            "role": gemini_role,
            "parts": parts
        }));
    }

    // ─── Build payload with shared tool definitions ────────────────
    let tools = core_engine::agent_harness::tool_definitions::tools_json_for_gemini();

    let payload = json!({
        "contents": contents,
        "systemInstruction": {
            "parts": [{"text": system_prompt}]
        },
        "tools": tools,
        "safetySettings": [
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"}
        ],
        "generationConfig": {
            "temperature": temperature,
            "topP": top_p
        }
    });

    let resp = client.post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let error_body = resp.text().await.unwrap_or_default();
        return Err(format!("Gemini API returned HTTP {}: {}", status, error_body));
    }

    let json_val: Value = resp.json().await.map_err(|e| e.to_string())?;

    // Check for blocked/finish reasons
    if let Some(finish_reason) = json_val["candidates"][0]["finishReason"].as_str() {
        if finish_reason != "STOP" && finish_reason != "MAX_TOKENS" {
            let blocked_msg = json_val["candidates"][0]["safetyRatings"]
                .as_array()
                .map(|ratings| {
                    ratings.iter()
                        .filter(|r| r["blocked"].as_bool().unwrap_or(false))
                        .map(|r| format!("{:?} (probability: {:?})", r["category"], r["probability"]))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_else(|| "unknown".to_string());

            return Err(format!(
                "Gemini response blocked. Finish reason: {}. Blocked by: {}",
                finish_reason, blocked_msg
            ));
        }
    }

    let mut content_text = String::new();
    let mut tool_calls: Vec<Value> = Vec::new();

    if let Some(parts) = json_val["candidates"][0]["content"]["parts"].as_array() {
        for part in parts {
            if let Some(func_call) = part["functionCall"].as_object() {
                let func_name = func_call["name"].as_str().unwrap_or("unknown");
                let args_json = func_call.get("args")
                    .and_then(|a| serde_json::to_string(a).ok())
                    .unwrap_or_else(|| "{}".to_string());

                tool_calls.push(json!({
                    "id": format!("fc_{}", func_name),
                    "function": {
                        "name": func_name,
                        "arguments": args_json
                    }
                }));
            } else if let Some(text) = part["text"].as_str() {
                if !text.trim().is_empty() {
                    content_text.push_str(text);
                }
            }
        }
    }

    // ─── Serialize as OpenAI-compatible JSON for parser Strategy 1 ──
    if !tool_calls.is_empty() {
        let tc_json = json!({"tool_calls": tool_calls}).to_string();
        if content_text.trim().is_empty() {
            return Ok(tc_json);
        } else {
            return Ok(format!("{}\n\n{}", content_text, tc_json));
        }
    }

    if content_text.trim().is_empty() {
        return Err(format!(
            "Failed to parse Gemini response. Raw: {}",
            serde_json::to_string_pretty(&json_val).unwrap_or_default()
        ));
    }

    Ok(content_text)
}

/// Native Tool Calling: OpenAI API
async fn call_openai_api(
    api_key: &str,
    model: &str,
    api_url: &str,
    temperature: f32,
    top_p: f32,
    system_prompt: &str,
    history: &[ChatMessage],
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let model_name = if model.is_empty() { "gpt-4o" } else { model };

    let url = if api_url.contains("/chat/completions") {
        api_url.to_string()
    } else {
        format!("{}/chat/completions", api_url.trim_end_matches('/'))
    };

    // ─── Build messages ────────────────────────────────────────────
    let mut messages: Vec<Value> = Vec::new();
    messages.push(json!({"role": "system", "content": system_prompt}));

    for msg in history {
        match msg.role.as_str() {
            "user" => {
                messages.push(json!({"role": "user", "content": msg.content}));
            }
            "model" | "assistant" => {
                messages.push(json!({"role": "assistant", "content": msg.content}));
            }
            "tool" => {
                // Parse JSON content to extract result
                let tool_result = serde_json::from_str::<Value>(&msg.content)
                    .ok()
                    .and_then(|v| v.get("result").and_then(|r| r.as_str()).map(|s| s.to_string()))
                    .unwrap_or_else(|| msg.content.clone());

                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": msg.id,
                    "content": tool_result
                }));
            }
            _ => {}
        }
    }

    // ─── Build payload with tool definitions ───────────────────────
    let tools = core_engine::agent_harness::tool_definitions::tools_json_for_api();

    let payload = json!({
        "model": model_name,
        "messages": messages,
        "temperature": temperature,
        "top_p": top_p,
        "tools": tools,
        "tool_choice": "auto"
    });

    let mut req = client.post(&url).json(&payload);
    if !api_key.is_empty() && api_key != "none" {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let error_body = resp.text().await.unwrap_or_default();
        return Err(format!("OpenAI API returned error: {}", error_body));
    }

    let json_val: Value = resp.json().await.map_err(|e| e.to_string())?;
    let msg = &json_val["choices"][0]["message"];

    let content_text = msg["content"].as_str().unwrap_or("").to_string();

    // ─── Extract native tool_calls ─────────────────────────────────
    if let Some(tc_array) = msg["tool_calls"].as_array() {
        if !tc_array.is_empty() {
            let mut tc_list = Vec::new();
            for tc in tc_array {
                let func = &tc["function"];
                if let (Some(name), Some(args)) = (
                    func["name"].as_str(),
                    func["arguments"].as_str(),
                ) {
                    let call_id = tc["id"].as_str().unwrap_or("call_unknown");
                    tc_list.push(json!({
                        "id": call_id,
                        "function": {
                            "name": name,
                            "arguments": args
                        }
                    }));
                }
            }

            if !tc_list.is_empty() {
                // Format as serialized JSON for the parser's Strategy 1
                let tool_calls_json = json!({"tool_calls": tc_list}).to_string();
                if content_text.trim().is_empty() {
                    return Ok(tool_calls_json);
                } else {
                    return Ok(format!("{}\n\n{}", content_text, tool_calls_json));
                }
            }
        }
    }

    // No tool calls — plain text response
    Ok(content_text)
}

/// Native Tool Calling: Claude API
async fn call_claude_api(
    api_key: &str,
    model: &str,
    api_url: &str,
    temperature: f32,
    top_p: f32,
    system_prompt: &str,
    history: &[ChatMessage],
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let model_name = if model.is_empty() { "claude-sonnet-5" } else { model };

    let url = if api_url.contains("/v1/messages") {
        api_url.to_string()
    } else {
        format!("{}/v1/messages", api_url.trim_end_matches('/'))
    };

    // ─── Build Claude messages (content is always an array of blocks) ─
    let mut messages: Vec<Value> = Vec::new();

    for msg in history {
        match msg.role.as_str() {
            "user" => {
                messages.push(json!({
                    "role": "user",
                    "content": [{"type": "text", "text": msg.content}]
                }));
            }
            "model" | "assistant" => {
                // Check if content contains JSON tool_calls (from previous turns)
                if let Ok(val) = serde_json::from_str::<Value>(&msg.content) {
                    if val.get("tool_calls").is_some() {
                        // This was a tool-calling response — reconstruct content blocks
                        let text = val.get("content").and_then(|c| c.as_str()).unwrap_or("");
                        let mut content_blocks: Vec<Value> = Vec::new();
                        if !text.is_empty() {
                            content_blocks.push(json!({"type": "text", "text": text}));
                        }
                        if let Some(tcs) = val["tool_calls"].as_array() {
                            for tc in tcs {
                                if let Some(name) = tc["function"]["name"].as_str() {
                                    let args_str = tc["function"]["arguments"].as_str().unwrap_or("{}");
                                    let args = serde_json::from_str::<Value>(args_str).unwrap_or_default();
                                    let tool_id = tc["id"].as_str().unwrap_or("toolu_unknown");
                                    content_blocks.push(json!({
                                        "type": "tool_use",
                                        "id": tool_id,
                                        "name": name,
                                        "input": args
                                    }));
                                }
                            }
                        }
                        messages.push(json!({
                            "role": "assistant",
                            "content": content_blocks
                        }));
                        continue;
                    }
                }
                messages.push(json!({
                    "role": "assistant",
                    "content": [{"type": "text", "text": msg.content}]
                }));
            }
            "tool" => {
                // Parse JSON content: {"result": "...", "success": true}
                let tool_data = serde_json::from_str::<Value>(&msg.content)
                    .unwrap_or_else(|_| json!({"result": msg.content, "success": true}));
                let result = tool_data.get("result").and_then(|r| r.as_str())
                    .unwrap_or(&msg.content)
                    .to_string();

                messages.push(json!({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": msg.id,
                        "content": result
                    }]
                }));
            }
            _ => {}
        }
    }

    // ─── Build payload with tool definitions ───────────────────────
    let tools = core_engine::agent_harness::tool_definitions::tools_json_for_claude();

    let payload = json!({
        "model": model_name,
        "system": system_prompt,
        "messages": messages,
        "temperature": temperature,
        "top_p": top_p,
        "max_tokens": 8192,
        "tools": tools
    });

    let mut req = client.post(&url).json(&payload);
    if !api_key.is_empty() && api_key != "none" {
        req = req.header("x-api-key", api_key);
    }
    req = req.header("anthropic-version", "2023-06-01");

    let resp = req.send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let error_body = resp.text().await.unwrap_or_default();
        return Err(format!("Claude API returned error: {}", error_body));
    }

    let json_val: Value = resp.json().await.map_err(|e| e.to_string())?;

    let mut content_text = String::new();
    let mut tool_uses: Vec<Value> = Vec::new();

    if let Some(arr) = json_val["content"].as_array() {
        for item in arr {
            match item["type"].as_str() {
                Some("text") => {
                    if let Some(txt) = item["text"].as_str() {
                        content_text.push_str(txt);
                    }
                }
                Some("tool_use") => {
                    if let (Some(name), Some(_input)) = (
                        item["name"].as_str(),
                        item["input"].as_object(),
                    ) {
                        let id = item["id"].as_str().unwrap_or("toolu_unknown");
                        let args_json = serde_json::to_string(&item["input"])
                            .unwrap_or_else(|_| "{}".to_string());
                        tool_uses.push(json!({
                            "id": id,
                            "function": {
                                "name": name,
                                "arguments": args_json
                            }
                        }));
                    }
                }
                _ => {}
            }
        }
    }

    // ─── Serialize tool_use blocks as OpenAI-compatible JSON ────────
    if !tool_uses.is_empty() {
        let tool_calls_json = json!({"tool_calls": tool_uses}).to_string();
        if content_text.trim().is_empty() {
            return Ok(tool_calls_json);
        } else {
            return Ok(format!("{}\n\n{}", content_text, tool_calls_json));
        }
    }

    if content_text.is_empty() {
        return Err(format!(
            "Failed to parse Claude response. Raw: {}",
            serde_json::to_string_pretty(&json_val).unwrap_or_default()
        ));
    }

    Ok(content_text)
}
