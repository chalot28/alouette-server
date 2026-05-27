use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedResponse {
    pub thought: Option<String>,
    pub tool_call: Option<ToolCall>,
    pub plain_text: Option<String>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub name: String,
    pub arguments: Value,
    pub raw_arguments: String,
}

/// Parses the model response to extract the <thought> block and any <call:tool_name> blocks using a robust state-machine.
pub fn parse_model_response(response: &str) -> ParsedResponse {
    let mut thought = None;
    let mut tool_call = None;
    let mut plain_text = None;
    let mut diagnostics = Vec::new();

    // 1. Robust state-machine to extract XML tags
    let raw_thought = extract_tag_content(response, "thought");
    if let Some(ref t) = raw_thought {
        thought = Some(t.trim().to_string());
    } else {
        diagnostics.push("Warning: No valid <thought> tag found in LLM response.".to_string());
    }

    // 2. Parse tool call with dynamic tag detection
    if let Some((tool_name, raw_args)) = extract_dynamic_call_tag(response) {
        let cleaned_args = repair_json_content(&raw_args);
        
        match serde_json::from_str::<Value>(&cleaned_args) {
            Ok(parsed_json) => {
                tool_call = Some(ToolCall {
                    name: tool_name,
                    arguments: parsed_json,
                    raw_arguments: raw_args,
                });
            }
            Err(e) => {
                let err_msg = format!("Error: Failed to parse arguments for tool '{}' even after auto-repair. Error: {}. Raw: {}", tool_name, e, raw_args);
                diagnostics.push(err_msg);
            }
        }
    }

    // 3. Extract plain text (any conversational content outside <thought> and <call> blocks)
    let clean_text = strip_tags(response);
    if !clean_text.is_empty() {
        plain_text = Some(clean_text);
    }

    ParsedResponse {
        thought,
        tool_call,
        plain_text,
        diagnostics,
    }
}

/// Extracts content inside a specific XML tag, ignoring casing and handling nested structures.
fn extract_tag_content(content: &str, tag_name: &str) -> Option<String> {
    let open_tag = format!("<{}>", tag_name);
    let close_tag = format!("</{}>", tag_name);

    if let Some(start_idx) = content.to_lowercase().find(&open_tag) {
        let start_pos = start_idx + open_tag.len();
        if let Some(end_idx) = content.to_lowercase()[start_pos..].find(&close_tag) {
            let actual_end = start_pos + end_idx;
            return Some(content[start_pos..actual_end].to_string());
        }
    }
    None
}

/// Dynamic scanner to detect <call:tool_name>...</call:tool_name> even with arbitrary tool names and trailing arguments.
fn extract_dynamic_call_tag(content: &str) -> Option<(String, String)> {
    let call_prefix = "<call:";
    if let Some(start_idx) = content.find(call_prefix) {
        let after_prefix = &content[start_idx + call_prefix.len()..];
        if let Some(tag_close_idx) = after_prefix.find('>') {
            let tool_name = after_prefix[..tag_close_idx].trim().to_string();
            let close_tag = format!("</call:{}>", tool_name);
            
            let args_start = start_idx + call_prefix.len() + tool_name.len() + 1;
            if let Some(end_tag_idx) = content[args_start..].find(&close_tag) {
                let actual_args_end = args_start + end_tag_idx;
                let raw_args = content[args_start..actual_args_end].to_string();
                return Some((tool_name, raw_args));
            }
        }
    }
    None
}

/// Intelligent JSON Auto-repairer. Handles markdown block wraps, dangling commas, and extra quotes.
fn repair_json_content(raw: &str) -> String {
    let mut cleaned = raw.trim().to_string();

    // Remove markdown code block markers like ```json ... ``` or ``` ... ```
    if cleaned.starts_with("```") {
        if let Some(first_newline) = cleaned.find('\n') {
            cleaned = cleaned[first_newline + 1..].to_string();
        }
        if cleaned.ends_with("```") {
            cleaned = cleaned[..cleaned.len() - 3].to_string();
        }
    }

    cleaned = cleaned.trim().to_string();

    // Repair trailing commas inside JSON objects/arrays (e.g. { "a": 1, } -> { "a": 1 })
    // Basic regex-like pass: replace ", \n}" or ",}" with "\n}" or "}"
    cleaned = cleaned.replace(",\n}", "\n}");
    cleaned = cleaned.replace(",}", "}");
    cleaned = cleaned.replace(",\n]", "\n]");
    cleaned = cleaned.replace(",]", "]");

    cleaned
}

/// Strips all <thought> and <call> tags and their contents, returning only pure conversational text.
fn strip_tags(content: &str) -> String {
    let mut stripped = content.to_string();

    // Remove <thought>...</thought>
    while let Some(start) = stripped.to_lowercase().find("<thought>") {
        if let Some(end) = stripped.to_lowercase()[start..].find("</thought>") {
            let actual_end = start + end + 10;
            stripped.drain(start..actual_end);
        } else {
            break;
        }
    }

    // Remove <call:tool>...</call:tool>
    while let Some(start) = stripped.find("<call:") {
        let after_prefix = &stripped[start + 6..];
        if let Some(tag_close) = after_prefix.find('>') {
            let tool_name = &after_prefix[..tag_close].trim();
            let close_tag = format!("</call:{}>", tool_name);
            if let Some(end) = stripped[start..].find(&close_tag) {
                let actual_end = start + end + close_tag.len();
                stripped.drain(start..actual_end);
            } else {
                break;
            }
        } else {
            break;
        }
    }

    stripped.trim().to_string()
}
