use core_engine::agent_harness::{ChatMessage, MessageContent};
use rig_core::{agent::AgentBuilder, client::CompletionClient, completion::Prompt, providers};

/// Gọi LLM qua Rig — tự động chọn provider dựa vào api_standard + api_url
pub async fn call_rig(
    api_standard: &str,
    api_key: &str,
    model: &str,
    api_url: &str,
    _temperature: f32,
    _top_p: f32,
    system_prompt: &str,
    history: &[ChatMessage],
) -> Result<String, String> {
    let model_name = if model.is_empty() {
        match api_standard {
            "claude" => "claude-sonnet-5",
            "gemini" => "gemini-1.5-flash",
            _ if api_url.contains("deepseek") => "deepseek-v4-flash",
            _ => "gpt-4o",
        }
    } else {
        model
    };

    // Build conversation text
    let mut conversation = String::from(system_prompt);
    conversation.push_str("\n\n=== Conversation ===\n");
    for msg in history {
        let prefix = match msg.role.as_str() {
            "user" => "User",
            "assistant" | "model" => "Assistant",
            "tool" => "[Tool Result]",
            _ => "[System]",
        };
        match &msg.content {
            MessageContent::Text(t) => {
                conversation.push_str(&format!("\n{}: {}", prefix, t));
            }
            MessageContent::ToolResult { tool_name, result, .. } => {
                conversation.push_str(&format!("\n{} ({})\n{}", prefix, tool_name, result));
            }
            MessageContent::ToolCalls(tcs) => {
                for tc in tcs {
                    conversation.push_str(&format!(
                        "\nAssistant calls: {}({})",
                        tc.name, tc.raw_arguments
                    ));
                }
            }
        }
    }
    conversation.push_str("\n\n=== Continue ===\nAssistant:");

    match api_standard {
        "openai" => {
            if api_url.contains("deepseek") {
                let client = providers::deepseek::Client::new(api_key)
                    .map_err(|e| format!("DeepSeek client: {}", e))?;
                let m = client.completion_model(model_name);
                let agent = AgentBuilder::new(m).preamble("").build();
                agent.prompt(&conversation).await
                    .map_err(|e| format!("Rig DeepSeek: {}", e))
            } else {
                let client = providers::openai::Client::new(api_key)
                    .map_err(|e| format!("OpenAI client: {}", e))?;
                let m = client.completion_model(model_name);
                let agent = AgentBuilder::new(m).preamble("").build();
                agent.prompt(&conversation).await
                    .map_err(|e| format!("Rig OpenAI: {}", e))
            }
        }
        "claude" => {
            let client = providers::anthropic::Client::new(api_key)
                .map_err(|e| format!("Anthropic client: {}", e))?;
            let m = client.completion_model(model_name);
            let agent = AgentBuilder::new(m).preamble("").build();
            agent.prompt(&conversation).await
                .map_err(|e| format!("Rig Claude: {}", e))
        }
        "gemini" => {
            let client = providers::gemini::Client::new(api_key)
                .map_err(|e| format!("Gemini client: {}", e))?;
            let m = client.completion_model(model_name);
            let agent = AgentBuilder::new(m).preamble("").build();
            agent.prompt(&conversation).await
                .map_err(|e| format!("Rig Gemini: {}", e))
        }
        _ => Err(format!("Unsupported provider: {}", api_standard)),
    }
}
