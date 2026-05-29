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
    pub iteration_count: u32,
}

impl Default for LoopState {
    fn default() -> Self {
        Self {
            max_iterations: 25,
            auto_approve_reads: true,
            auto_approve_writes: false,
            auto_approve_all: false,
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
pub struct CustomAiConfig {
    #[serde(default = "default_active_model")]
    pub active_model: String,
    pub models: std::collections::HashMap<String, ModelConfig>,
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
            iteration_count: 0,
        });
    }

    let api_standard = model_config.api_standard.clone()
        .unwrap_or_else(|| "gemini".to_string());
    let model_to_use = if !ai_cfg.active_model.is_empty() {
        ai_cfg.active_model.clone()
    } else {
        model.clone()
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

    // Save session - save session_id before move
    let saved_session_id = session.session_id.clone();
    {
        let mut session_guard = session_store.lock().unwrap();
        *session_guard = Some(session);
    }

    // Build response
    let ui_result: AgentLoopResultUI = loop_result.into();
    let ui_iterations = ui_result.total_iterations;

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
        })
    }
}

// ─── Approve / Reject Tool (tiếp tục loop) ──────────────────────────────

#[tauri::command]
pub async fn agent_approve_tool(
    approved: bool,
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
        let model_config = resolve_model_config(&ai_cfg, "");
        let api_key = resolve_api_key(&model_config).unwrap_or_default();
        let api_standard = model_config.api_standard.unwrap_or_else(|| "gemini".to_string());
        let system_prompt = harness.assemble_system_prompt();

        let llm_reply = if !api_key.is_empty() {
            match api_standard.as_str() {
                "openai" => call_openai_api(&api_key, &ai_cfg.active_model, &model_config.api_url,
                    model_config.temperature, model_config.top_p, &system_prompt, &session.history).await,
                "claude" => call_claude_api(&api_key, &ai_cfg.active_model, &model_config.api_url,
                    model_config.temperature, model_config.top_p, &system_prompt, &session.history).await,
                _ => call_gemini_api(&api_key, &ai_cfg.active_model, &model_config.api_url,
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
    let model_config = resolve_model_config(&ai_cfg, "");
    let api_key = resolve_api_key(&model_config).unwrap_or_default();
    let api_standard = model_config.api_standard.unwrap_or_else(|| "gemini".to_string());
    let model_to_use = if !ai_cfg.active_model.is_empty() {
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
        session_id: session.session_id.clone(),
    };

    // If auto_approve_all is on, run full loop
    // Otherwise do one more LLM call to check if it needs another tool
    let api_key_clone = api_key.clone();
    let api_url = model_config.api_url.clone();
    let temperature = model_config.temperature;
    let top_p = model_config.top_p;

    if loop_config.auto_approve_all {
        // ─── FULL AUTONOMOUS LOOP ───────────────────────────────────
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

        // Save session
        {
            let mut session_guard = session_store.lock().unwrap();
            session_guard.replace(session);
        }

        if let Some(ref text) = ui_result.final_text {
            Ok(AgentResponse {
                session_id: String::new(),
                reply_type: "loop_result".to_string(),
                text: Some(text.clone()),
                tool_name: None,
                args: None,
                pending_id: None,
                loop_result: Some(ui_result),
                iteration: Some(ui_iter),
                total_iterations: Some(loop_cfg.max_iterations),
            })
        } else {
            Ok(AgentResponse {
                session_id: String::new(),
                reply_type: "agent_activity".to_string(),
                text: ui_result.stop_reason.clone(),
                tool_name: None,
                args: None,
                pending_id: None,
                loop_result: Some(ui_result),
                iteration: Some(ui_iter),
                total_iterations: Some(loop_cfg.max_iterations),
            })
        }
    } else {
        // ─── SINGLE STEP (chờ approve từng tool) ────────────────────
        let llm_reply = match api_standard.as_str() {
            "openai" => call_openai_api(&api_key, &model_to_use, &model_config.api_url,
                temperature, top_p, &system_prompt, &session.history).await,
            "claude" => call_claude_api(&api_key, &model_to_use, &model_config.api_url,
                temperature, top_p, &system_prompt, &session.history).await,
            _ => call_gemini_api(&api_key, &model_to_use, &model_config.api_url,
                temperature, top_p, &system_prompt, &session.history).await,
        };

        let llm_reply = llm_reply.unwrap_or_else(|e| {
            format!("<thought>Lỗi LLM: {}</thought>\nDone.", e)
        });

        let parsed = core_engine::agent_harness::parser::parse_model_response(&llm_reply);
        session.current_thought = parsed.thought.clone();

        let response = if let Some(next_tool) = parsed.tool_call {
            // AI muốn gọi tool tiếp theo → cần approve
            let pending_id = format!("tool_{}", Local::now().timestamp_millis());
            session.pending_tool = Some(next_tool.clone());

            AgentResponse {
                session_id: session.session_id.clone(),
                reply_type: "tool_request".to_string(),
                text: None,
                tool_name: Some(next_tool.name),
                args: Some(next_tool.arguments.to_string()),
                pending_id: Some(pending_id),
                loop_result: None,
                iteration: None,
                total_iterations: None,
            }
        } else {
            // AI trả về text → hoàn thành
            let final_text = parsed.plain_text.unwrap_or_else(|| "Done.".to_string());
            session.history.push(ChatMessage {
                id: format!("model_{}", Local::now().timestamp_millis()),
                role: "model".to_string(),
                content: final_text.clone(),
                timestamp: Local::now().format("%H:%M").to_string(),
            });

            AgentResponse {
                session_id: session.session_id.clone(),
                reply_type: "text".to_string(),
                text: Some(final_text),
                tool_name: None,
                args: None,
                pending_id: None,
                loop_result: None,
                iteration: None,
                total_iterations: None,
            }
        };

        // Save session
        {
            let mut session_guard = session_store.lock().unwrap();
            *session_guard = Some(session);
        }

        Ok(response)
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

#[tauri::command]
pub fn save_custom_ai_config(config: CustomAiConfig) -> Result<(), String> {
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

    ai_cfg.models.get(model_key).cloned().unwrap_or_else(|| {
        // Fallback: lấy model đầu tiên hoặc default
        ai_cfg.models.values().next().cloned().unwrap_or_else(|| ModelConfig {
            provider: "gemini".to_string(),
            api_key: String::new(),
            api_url: "https://generativelanguage.googleapis.com/v1beta".to_string(),
            context_limit: 1048576,
            supports_vision: true,
            temperature: 0.2,
            top_p: 0.95,
            api_standard: Some("gemini".to_string()),
        })
    })
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
        if let Ok(config) = serde_yaml::from_str::<CustomAiConfig>(&content) {
            return config;
        }
    }

    // Fallback default config
    let mut models = std::collections::HashMap::new();
    models.insert(
        "gemini-1.5-flash".to_string(),
        ModelConfig {
            provider: "gemini".to_string(),
            api_key: "".to_string(),
            api_url: "https://generativelanguage.googleapis.com/v1beta".to_string(),
            context_limit: 1048576,
            supports_vision: true,
            temperature: 0.2,
            top_p: 0.95,
            api_standard: Some("gemini".to_string()),
        },
    );

    CustomAiConfig {
        active_model: "gemini-1.5-flash".to_string(),
        models,
    }
}

// ─── LLM API Callers ────────────────────────────────────────────────────

/// Dynamic Gemini API caller using reqwest
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

    let mut contents: Vec<Value> = Vec::new();
    let mut last_role: Option<&str> = None;

    for msg in history {
        let role = match msg.role.as_str() {
            "user" => "user",
            "system" => "model",
            "model" | "assistant" => "model",
            _ => continue,
        };

        if last_role == Some(role) {
            if let Some(last) = contents.last_mut() {
                if let Some(parts) = last["parts"].as_array_mut() {
                    parts.push(json!({"text": msg.content}));
                }
            }
            continue;
        }

        if contents.is_empty() && role == "model" {
            continue;
        }

        contents.push(json!({
            "role": role,
            "parts": [{"text": msg.content}]
        }));
        last_role = Some(role);
    }

    let tool_declarations = json!([{
        "functionDeclarations": [
            {
                "name": "read_file",
                "description": "Read the full contents of a file within the workspace",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "path": {"type": "STRING", "description": "Relative or absolute path to the file"}
                    },
                    "required": ["path"]
                }
            },
            {
                "name": "write_file",
                "description": "Create a new file or overwrite an existing file with new content",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "path": {"type": "STRING", "description": "Path where the file should be written"},
                        "content": {"type": "STRING", "description": "The full content to write to the file"}
                    },
                    "required": ["path", "content"]
                }
            },
            {
                "name": "execute_command",
                "description": "Run a terminal command inside the sandbox execution environment",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "command": {"type": "STRING", "description": "The command to execute (e.g. cargo, npm, git)"},
                        "args": {"type": "ARRAY", "items": {"type": "STRING"}, "description": "Array of arguments"}
                    },
                    "required": ["command"]
                }
            },
            {
                "name": "check_port",
                "description": "Check whether a specific TCP port is available or already in use",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "port": {"type": "NUMBER", "description": "The port number to check (0-65535)"}
                    },
                    "required": ["port"]
                }
            },
            {
                "name": "get_project_files",
                "description": "Recursively list all files in the workspace",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "path": {"type": "STRING", "description": "Directory to start listing from, use '.' for root"}
                    },
                    "required": ["path"]
                }
            },
            {
                "name": "scan_directory_tree",
                "description": "Scan the PROJECT ROOT and return ONE LEVEL (immediate children)",
                "parameters": {"type": "OBJECT", "properties": {}}
            },
            {
                "name": "scan_subdirectory",
                "description": "Scan a specific subdirectory (one level deep)",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "path": {"type": "STRING", "description": "Relative path to the subdirectory"}
                    },
                    "required": ["path"]
                }
            },
            {
                "name": "search_files",
                "description": "Search for files by name or pattern across the project",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "pattern": {"type": "STRING", "description": "Filename pattern to search for"}
                    },
                    "required": ["pattern"]
                }
            },
            {
                "name": "extract_symbol",
                "description": "Extract a specific symbol (function, struct, variable) from a file",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "file": {"type": "STRING", "description": "Relative path to the file"},
                        "symbol": {"type": "STRING", "description": "The symbol name to find"}
                    },
                    "required": ["file", "symbol"]
                }
            },
            {
                "name": "read_file_range",
                "description": "Read a specific range of lines from a file",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "file": {"type": "STRING", "description": "Relative path to the file"},
                        "start_line": {"type": "NUMBER", "description": "First line number (1-based)"},
                        "end_line": {"type": "NUMBER", "description": "Last line number (1-based, exclusive)"}
                    },
                    "required": ["file", "start_line", "end_line"]
                }
            },
            {
                "name": "search_symbol",
                "description": "Search for a symbol across the ENTIRE project",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "symbol": {"type": "STRING", "description": "The symbol name to search for"}
                    },
                    "required": ["symbol"]
                }
            },
            {
                "name": "save_memory",
                "description": "Persist information in long-term memory system",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "name": {"type": "STRING", "description": "Kebab-case slug for the memory"},
                        "description": {"type": "STRING", "description": "One-line summary"},
                        "type": {"type": "STRING", "description": "user, feedback, project, or reference"},
                        "content": {"type": "STRING", "description": "The fact to remember"}
                    },
                    "required": ["name", "description", "type", "content"]
                }
            },
            {
                "name": "search_memory",
                "description": "Search the persistent memory system",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "query": {"type": "STRING", "description": "The search query"}
                    },
                    "required": ["query"]
                }
            }
        ]
    }]);

    let payload = json!({
        "contents": contents,
        "systemInstruction": {
            "parts": [{"text": system_prompt}]
        },
        "tools": tool_declarations,
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

    if resp.status().is_success() {
        let json_val: Value = resp.json().await.map_err(|e| e.to_string())?;

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
                    "⚠️ Gemini response was blocked. Finish reason: {}. Blocked by: {}",
                    finish_reason, blocked_msg
                ));
            }
        }

        if let Some(text) = json_val["candidates"][0]["content"]["parts"][0]["text"].as_str() {
            if !text.trim().is_empty() {
                return Ok(text.to_string());
            }
        }

        if let Some(parts) = json_val["candidates"][0]["content"]["parts"].as_array() {
            for part in parts {
                if let Some(func_call) = part["functionCall"].as_object() {
                    let func_name = func_call["name"].as_str().unwrap_or("unknown");
                    let func_args = func_call.get("args")
                        .and_then(|a| serde_json::to_string(a).ok())
                        .unwrap_or_else(|| "{}".to_string());

                    let xml = format!(
                        "<call:{}>\n{}\n</call:{}>",
                        func_name, func_args, func_name
                    );
                    return Ok(xml);
                }

                if let Some(text) = part["text"].as_str() {
                    if !text.trim().is_empty() {
                        return Ok(text.to_string());
                    }
                }
            }
        }

        if let Some(finish_msg) = json_val["candidates"][0]["finishMessage"].as_str() {
            if !finish_msg.trim().is_empty() {
                return Ok(format!("<thought>Model finished: {}</thought>", finish_msg));
            }
        }

        Err(format!(
            "Failed to parse text from Gemini response. Raw: {}",
            serde_json::to_string_pretty(&json_val).unwrap_or_default()
        ))
    } else {
        let status = resp.status();
        let error_body = resp.text().await.unwrap_or_default();
        Err(format!("Gemini API returned HTTP {}: {}", status, error_body))
    }
}

/// Dynamic OpenAI API caller using reqwest
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

    let mut messages = Vec::new();
    messages.push(json!({"role": "system", "content": system_prompt}));

    for msg in history {
        let role = if msg.role == "user" { "user" } else { "assistant" };
        messages.push(json!({"role": role, "content": msg.content}));
    }

    let payload = json!({
        "model": model_name,
        "messages": messages,
        "temperature": temperature,
        "top_p": top_p
    });

    let mut req = client.post(&url).json(&payload);
    if !api_key.is_empty() && api_key != "none" {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        let json_val: Value = resp.json().await.map_err(|e| e.to_string())?;
        let text = json_val["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| "Failed to parse text from OpenAI response".to_string())?;
        Ok(text.to_string())
    } else {
        let error_body = resp.text().await.unwrap_or_default();
        Err(format!("OpenAI API returned error: {}", error_body))
    }
}

/// Dynamic Claude API caller using reqwest
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
    let model_name = if model.is_empty() { "claude-3-5-sonnet" } else { model };

    let url = if api_url.contains("/v1/messages") {
        api_url.to_string()
    } else {
        format!("{}/v1/messages", api_url.trim_end_matches('/'))
    };

    let mut messages = Vec::new();
    for msg in history {
        let role = if msg.role == "user" { "user" } else { "assistant" };
        messages.push(json!({"role": role, "content": msg.content}));
    }

    let payload = json!({
        "model": model_name,
        "system": system_prompt,
        "messages": messages,
        "temperature": temperature,
        "top_p": top_p,
        "max_tokens": 4096
    });

    let mut req = client.post(&url).json(&payload);
    if !api_key.is_empty() && api_key != "none" {
        req = req.header("x-api-key", api_key);
    }
    req = req.header("anthropic-version", "2023-06-01");

    let resp = req.send().await.map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        let json_val: Value = resp.json().await.map_err(|e| e.to_string())?;
        let text = json_val["content"][0]["text"]
            .as_str()
            .ok_or_else(|| "Failed to parse text from Claude response".to_string())?;
        Ok(text.to_string())
    } else {
        let error_body = resp.text().await.unwrap_or_default();
        Err(format!("Claude API returned error: {}", error_body))
    }
}
