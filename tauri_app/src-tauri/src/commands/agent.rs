use std::sync::Mutex;
use tauri::State;
use serde::{Serialize, Deserialize};
use serde_json::{json, Value};
use core_engine::{AgentHarness, ChatMessage, AgentSession};
use crate::state::AppState;
use std::sync::Arc;
use std::sync::OnceLock;
use chrono::Local;

// Thread-safe session storage using standard library OnceLock and Mutex
static CURRENT_SESSION: OnceLock<Arc<Mutex<Option<AgentSession>>>> = OnceLock::new();

fn get_session_store() -> &'static Arc<Mutex<Option<AgentSession>>> {
    CURRENT_SESSION.get_or_init(|| Arc::new(Mutex::new(None)))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentResponse {
    pub session_id: String,
    pub reply_type: String, // "text" | "tool_request" | "agent_activity"
    pub text: Option<String>,
    pub tool_name: Option<String>,
    pub args: Option<String>,
    pub pending_id: Option<String>,
}

#[tauri::command]
pub async fn agent_send_message(
    message: String,
    model: String,
    mode: String,
    _app_state: State<'_, AppState>,
) -> Result<AgentResponse, String> {
    let workspace = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let harness = AgentHarness::new(&workspace);

    // Initialize or load session (in a short scope to release MutexGuard before async awaits)
    let session_store = get_session_store();
    let mut session = {
        let mut session_guard = session_store.lock().unwrap();
        let mut session = session_guard.take().unwrap_or_else(|| AgentSession {
            session_id: format!("sess_{}", Local::now().timestamp()),
            history: Vec::new(),
            current_thought: None,
            pending_tool: None,
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

    // Load configuration for Custom AI
    let ai_cfg = load_custom_ai_config();
    
    // Get the config for the active model or fallback to standard parameters
    let active_model_name = ai_cfg.active_model.clone();
    let model_config = ai_cfg.models.get(&active_model_name).cloned().unwrap_or_else(|| ModelConfig {
        provider: "gemini".to_string(),
        api_key: "".to_string(),
        api_url: "https://generativelanguage.googleapis.com/v1beta".to_string(),
        context_limit: 1048576,
        supports_vision: true,
        temperature: 0.2,
        top_p: 0.95,
    });

    // Apply context limit to compact history if needed
    let max_msgs = if model_config.context_limit < 10000 { 10 } else { 50 };
    AgentHarness::compact_history(&mut session.history, max_msgs);

    // Construct the full prompt (System prompt + History)
    let system_prompt = harness.assemble_system_prompt();
    
    // Call LLM (Gemini or fallback simulator)
    let api_key = if !model_config.api_key.is_empty() && model_config.api_key != "none" {
        Some(model_config.api_key.clone())
    } else {
        std::env::var("GEMINI_API_KEY").ok()
    };

    let model_to_use = if !active_model_name.is_empty() {
        active_model_name
    } else {
        model.clone()
    };

    let llm_reply = match api_key {
        Some(key) => {
            call_gemini_api(
                &key,
                &model_to_use,
                &model_config.api_url,
                model_config.temperature,
                model_config.top_p,
                &system_prompt,
                &session.history,
            ).await
            .unwrap_or_else(|e| format!("<thought>API Error occurred: {}. Falling back to Harness simulation.</thought>\n<call:check_port>{{\"port\": 3000}}</call:check_port>", e))
        }
        None => {
            // Intelligent Harness Simulator if no API key is specified
            simulate_harness_response(&message)
        }
    };

    // Parse the response
    let parsed = core_engine::agent_harness::parser::parse_model_response(&llm_reply);
    session.current_thought = parsed.thought.clone();

    let mut response = AgentResponse {
        session_id: session.session_id.clone(),
        reply_type: "text".to_string(),
        text: None,
        tool_name: None,
        args: None,
        pending_id: None,
    };

    if let Some(tool) = parsed.tool_call {
        // If it's a safe tool and in autonomous mode, run it immediately!
        let is_safe = tool.name == "check_port" || tool.name == "get_project_files" || tool.name == "read_file";
        let is_autonomous = mode == "autonomous";

        if is_safe && is_autonomous {
            // Autonomous execute and continue
            let activity_text = format!("🔍 Harness executing tool [自主运行]: {} with arguments: {}", tool.name, tool.arguments);
            
            // Execute tool (Awaiting here is safe since MutexGuard is released)
            let result = harness.execute_tool(&session.session_id, &tool).await.unwrap_or_else(|e| e);
            
            // Push observation to history and save
            session.history.push(ChatMessage {
                id: format!("obs_{}", Local::now().timestamp_millis()),
                role: "system".to_string(),
                content: format!("<observation>\n{}\n</observation>", result),
                timestamp: Local::now().format("%H:%M").to_string(),
            });

            response.reply_type = "agent_activity".to_string();
            response.text = Some(format!("{}\nKết quả:\n{}", activity_text, result));
        } else {
            // Interactive approval is required or requested
            let pending_id = format!("tool_{}", Local::now().timestamp_millis());
            session.pending_tool = Some(tool.clone());

            response.reply_type = "tool_request".to_string();
            response.tool_name = Some(tool.name);
            response.args = Some(tool.arguments.to_string());
            response.pending_id = Some(pending_id);
        }
    } else {
        // Plain text response
        let final_text = parsed.plain_text.unwrap_or_else(|| "Tôi đã ghi nhận yêu cầu của bạn.".to_string());
        session.history.push(ChatMessage {
            id: format!("model_{}", Local::now().timestamp_millis()),
            role: "model".to_string(),
            content: final_text.clone(),
            timestamp: Local::now().format("%H:%M").to_string(),
        });
        response.reply_type = "text".to_string();
        response.text = Some(final_text);
    }

    // Save session state back
    {
        let mut session_guard = session_store.lock().unwrap();
        *session_guard = Some(session);
    }
    
    Ok(response)
}

#[tauri::command]
pub async fn agent_approve_tool(
    approved: bool,
    _app_state: State<'_, AppState>,
) -> Result<AgentResponse, String> {
    let workspace = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let harness = AgentHarness::new(&workspace);

    let session_store = get_session_store();
    let (mut session, tool) = {
        let mut session_guard = session_store.lock().unwrap();
        let mut session = session_guard.take().ok_or_else(|| "No active session found".to_string())?;
        let tool = session.pending_tool.take().ok_or_else(|| "No pending tool call found".to_string())?;
        (session, tool)
    };

    let mut response = AgentResponse {
        session_id: session.session_id.clone(),
        reply_type: "agent_activity".to_string(),
        text: None,
        tool_name: None,
        args: None,
        pending_id: None,
    };

    if approved {
        // Execute tool (Awaiting here is safe since MutexGuard is released)
        let result = harness.execute_tool(&session.session_id, &tool).await.unwrap_or_else(|e| e);

        // Add to history as observation
        session.history.push(ChatMessage {
            id: format!("obs_{}", Local::now().timestamp_millis()),
            role: "system".to_string(),
            content: format!("<observation>\n{}\n</observation>", result),
            timestamp: Local::now().format("%H:%M").to_string(),
        });

        response.text = Some(format!("✓ Đã chạy thành công công cụ: {}\nKết quả:\n{}", tool.name, result));
    } else {
        // Rejected
        session.history.push(ChatMessage {
            id: format!("obs_{}", Local::now().timestamp_millis()),
            role: "system".to_string(),
            content: "<observation>\nUser rejected executing this tool.\n</observation>".to_string(),
            timestamp: Local::now().format("%H:%M").to_string(),
        });

        response.text = Some(format!("✕ Người dùng đã từ chối chạy công cụ: {}", tool.name));
    }

    // Save session state back
    {
        let mut session_guard = session_store.lock().unwrap();
        *session_guard = Some(session);
    }
    
    Ok(response)
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

#[tauri::command]
pub async fn agent_reset_session() -> Result<String, String> {
    let session_store = get_session_store();
    let mut session_guard = session_store.lock().unwrap();
    *session_guard = None;
    Ok("✓ Session reset successfully.".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub provider: String,
    pub api_key: String,
    pub api_url: String,
    pub context_limit: usize,
    pub supports_vision: bool,
    pub temperature: f32,
    pub top_p: f32,
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

    // Fallback default config if file is missing or parsing fails
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
        },
    );

    CustomAiConfig {
        active_model: "gemini-1.5-flash".to_string(),
        models,
    }
}

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
    
    // Support either clean base url or direct model url
    let url = if api_url.contains("generateContent") {
        format!("{}?key={}", api_url, api_key)
    } else {
        format!(
            "{}/models/{}:generateContent?key={}",
            api_url.trim_end_matches('/'), model_name, api_key
        )
    };

    // Build the request contents structure matching Google Gemini API spec
    let mut contents = Vec::new();
    
    // Add history
    for msg in history {
        let role = if msg.role == "user" { "user" } else { "model" };
        contents.push(json!({
            "role": role,
            "parts": [{"text": msg.content}]
        }));
    }

    let payload = json!({
        "contents": contents,
        "systemInstruction": {
            "parts": [{"text": system_prompt}]
        },
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
        let text = json_val["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .ok_or_else(|| "Failed to parse text from Gemini response".to_string())?;
        Ok(text.to_string())
    } else {
        let error_body = resp.text().await.unwrap_or_default();
        Err(format!("Gemini API returned error: {}", error_body))
    }
}

/// Simulated response generator for a premium local agent loop walkthrough
fn simulate_harness_response(message: &str) -> String {
    let lower = message.to_lowercase();
    if lower.contains("port") || lower.contains("cổng") {
        r#"
<thought>
Người dùng đang hỏi về thông tin hoặc trạng thái các cổng (ports).
Tôi nên sử dụng công cụ check_port để xem cổng 3000 có đang bị chiếm dụng hay không.
</thought>
<call:check_port>
{
  "port": 3000
}
</call:check_port>
"#.to_string()
    } else if lower.contains("file") || lower.contains("tập tin") || lower.contains("read") {
        r#"
<thought>
Người dùng muốn xem danh sách các tập tin hoặc nội dung thư mục.
Tôi nên gọi công cụ get_project_files để liệt kê toàn bộ cấu trúc thư mục của dự án hiện tại.
</thought>
<call:get_project_files>
{
  "path": "."
}
</call:get_project_files>
"#.to_string()
    } else {
        format!(
r#"
<thought>
Đây là một câu hỏi thông thường. Tôi sẽ giải thích trực tiếp cách bộ Harness Core này vận hành dựa trên các nguyên tắc thiết kế được lấy cảm hứng từ cấu trúc prompt nâng cao của Claude Code.
</thought>
Xin chào! Tôi là AI Agent hoạt động trên nền tảng **Harness Core** tùy biến của bạn. 

Tôi hiện đang đọc trực tiếp cấu hình từ các file System Prompt tĩnh (`identity.txt`, `tools.txt`) cùng với bối cảnh của tệp `CLAUDE.md` trong dự án của bạn để đưa ra những quyết định tối ưu nhất. 

Bộ lõi Harness này hỗ trợ các công cụ như:
1. `check_port` (Kiểm tra cổng mạng)
2. `read_file` & `write_file` (Đọc ghi file an toàn)
3. `get_project_files` (Xem danh sách file dự án)
4. `execute_command` (Chạy lệnh shell qua Sandbox)

Hãy thử yêu cầu tôi: *"Hãy kiểm tra xem cổng 3000 có đang chạy không?"* hoặc *"Quét danh sách các file trong dự án"* để xem quy trình phản hồi qua Thought -> Action -> Observation hoạt động nhé!
"#
        )
    }
}
