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

    // Fallback: Parse ReAct/LangChain JSON action block if no XML tool call was found
    if tool_call.is_none() {
        if let Some(json_tool) = parse_json_action_block(response) {
            tool_call = Some(json_tool);
        }
    }

    // 3. Extract plain text (any conversational content outside <thought> and <call> blocks)
    let mut clean_text = strip_tags(response);
    if let Some(ref tc) = tool_call {
        // If the tool call was parsed as a JSON fallback block, strip it from the conversational response
        if let Some(idx) = clean_text.find(&tc.raw_arguments) {
            clean_text.drain(idx..(idx + tc.raw_arguments.len()));
        }
        // Remove markdown block backticks if they are leaking
        clean_text = clean_text.replace("```json", "").replace("```", "");
    }
    
    let clean_text_trimmed = clean_text.trim().to_string();
    if !clean_text_trimmed.is_empty() {
        plain_text = Some(clean_text_trimmed);
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

/// Defensive fallback scanner to parse ReAct/LangChain style JSON action blocks
fn parse_json_action_block(content: &str) -> Option<ToolCall> {
    let cleaned = content.trim();
    let mut json_candidates = Vec::new();
    let mut start = 0;
    
    // Scan for markdown code blocks
    while let Some(block_start) = cleaned[start..].find("```") {
        let abs_start = start + block_start + 3;
        let actual_start = if let Some(newline_idx) = cleaned[abs_start..].find('\n') {
            abs_start + newline_idx + 1
        } else {
            abs_start
        };
        if let Some(block_end) = cleaned[actual_start..].find("```") {
            let abs_end = actual_start + block_end;
            json_candidates.push(cleaned[actual_start..abs_end].trim().to_string());
            start = abs_end + 3;
        } else {
            break;
        }
    }
    
    // If no markdown blocks, try finding matching curly braces
    if json_candidates.is_empty() {
        if let Some(first_brace) = cleaned.find('{') {
            if let Some(last_brace) = cleaned.rfind('}') {
                if last_brace > first_brace {
                    json_candidates.push(cleaned[first_brace..=last_brace].trim().to_string());
                }
            }
        }
    }

    for candidate in json_candidates {
        let repaired = repair_json_content(&candidate);
        if let Ok(parsed_json) = serde_json::from_str::<Value>(&repaired) {
            if let Some(action) = parsed_json.get("action").and_then(|v| v.as_str()) {
                if let Some(action_input) = parsed_json.get("action_input") {
                    let tool_name = action.to_string();
                    let mut arguments = action_input.clone();
                    
                    // Translate arguments structure from LangChain/ReAct string inputs to system specs
                    if tool_name == "read_file" || tool_name == "write_file" {
                        if let Some(path_str) = action_input.as_str() {
                            arguments = serde_json::json!({ "path": path_str });
                        }
                    } else if tool_name == "execute_command" {
                        if let Some(cmd_str) = action_input.as_str() {
                            let parts: Vec<&str> = cmd_str.split_whitespace().collect();
                            if !parts.is_empty() {
                                let command = parts[0].to_string();
                                let args: Vec<String> = parts[1..].iter().map(|s| s.to_string()).collect();
                                arguments = serde_json::json!({
                                    "command": command,
                                    "args": args
                                });
                            }
                        }
                    } else if tool_name == "get_project_files" {
                        if let Some(path_str) = action_input.as_str() {
                            arguments = serde_json::json!({ "path": path_str });
                        } else if action_input.is_null() {
                            arguments = serde_json::json!({ "path": "." });
                        }
                    }
                    
                    return Some(ToolCall {
                        name: tool_name,
                        arguments,
                        raw_arguments: candidate,
                    });
                }
            }
        }
    }
    None
}
