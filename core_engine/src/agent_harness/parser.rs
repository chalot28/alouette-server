use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedResponse {
    pub thought: Option<String>,
    pub tool_call: Option<ToolCall>,
    pub plain_text: Option<String>,
    pub diagnostics: Vec<String>,
    /// Plan mode specific parsing
    pub plan_phase: Option<PlanPhaseDirective>,
    /// Task notification (worker results)
    pub task_notification: Option<TaskNotification>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub name: String,
    pub arguments: Value,
    pub raw_arguments: String,
}

/// Plan phase directive from coordinator messages
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanPhaseDirective {
    pub phase: String,
    pub action: String,
    pub details: Option<String>,
}

/// Task notification from subagent results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskNotification {
    pub task_id: String,
    pub status: String,
    pub summary: String,
    pub result: Option<String>,
    pub subagent_tokens: Option<u64>,
    pub tool_uses: Option<u64>,
    pub duration_ms: Option<u64>,
}

/// Parses the model response with enhanced support for:
/// - `<thought>` blocks
/// - `<call:tool_name>` blocks
/// - `<summary>` blocks (compaction)
/// - `<task-notification>` blocks (worker results)
/// - Plan mode directives
pub fn parse_model_response(response: &str) -> ParsedResponse {
    let mut thought = None;
    let mut tool_call = None;
    let mut plain_text = None;
    let mut diagnostics = Vec::new();
    let mut plan_phase = None;
    let mut task_notification = None;

    // 1. Check for task notification (worker results)
    if let Some(notification) = parse_task_notification(response) {
        task_notification = Some(notification);
        diagnostics.push("Task notification detected - worker result received".to_string());
        return ParsedResponse {
            thought: None,
            tool_call: None,
            plain_text: None,
            diagnostics,
            plan_phase: None,
            task_notification,
        };
    }

    // 2. Check for plan mode directives
    if let Some(directive) = parse_plan_directive(response) {
        plan_phase = Some(directive);
    }

    // 3. Robust state-machine to extract XML tags
    let raw_thought = extract_tag_content(response, "thought");
    if let Some(ref t) = raw_thought {
        thought = Some(t.trim().to_string());
    }

    // 4. Parse tool call with dynamic tag detection
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

    // 5. Extract plain text
    let clean_text = strip_tags(response);
    let clean_text_trimmed = clean_text.trim().to_string();
    if !clean_text_trimmed.is_empty() {
        plain_text = Some(clean_text_trimmed);
    }

    ParsedResponse {
        thought,
        tool_call,
        plain_text,
        diagnostics,
        plan_phase,
        task_notification,
    }
}

/// Parse a task notification from subagent results
fn parse_task_notification(content: &str) -> Option<TaskNotification> {
    if !content.contains("<task-notification>") {
        return None;
    }

    let task_id = extract_tag_content(content, "task-id")?;
    let status = extract_tag_content(content, "status")?;
    let summary = extract_tag_content(content, "summary")?;
    let result = extract_tag_content(content, "result");
    let subagent_tokens = extract_tag_content(content, "subagent_tokens")
        .and_then(|s| s.trim().parse::<u64>().ok());
    let tool_uses = extract_tag_content(content, "tool_uses")
        .and_then(|s| s.trim().parse::<u64>().ok());
    let duration_ms = extract_tag_content(content, "duration_ms")
        .and_then(|s| s.trim().parse::<u64>().ok());

    Some(TaskNotification {
        task_id: task_id.trim().to_string(),
        status: status.trim().to_string(),
        summary: summary.trim().to_string(),
        result,
        subagent_tokens,
        tool_uses,
        duration_ms,
    })
}

/// Parse plan mode directives from coordinator messages
fn parse_plan_directive(content: &str) -> Option<PlanPhaseDirective> {
    // Look for phase directives like "## Phase: Research" or [Phase: Implementation]
    let content_lower = content.to_lowercase();

    let phase_keywords = [
        ("research", "Research"),
        ("synthesis", "Synthesis"),
        ("planning", "Planning"),
        ("implementation", "Implementation"),
        ("verification", "Verification"),
    ];

    for (key, label) in &phase_keywords {
        let patterns = [
            format!("phase: {}", key),
            format!("## {}", label),
            format!("[phase: {}]", key),
        ];

        for pattern in &patterns {
            if content_lower.contains(&pattern.to_lowercase()) {
                // Extract the action text after the phase header
                if let Some(action) = extract_phase_action(content, label) {
                    return Some(PlanPhaseDirective {
                        phase: label.to_string(),
                        action,
                        details: None,
                    });
                }
            }
        }
    }

    None
}

/// Extract action text following a phase header
fn extract_phase_action(content: &str, phase_label: &str) -> Option<String> {
    // Try to find content after the phase header
    let patterns = [
        format!("## {}", phase_label),
        format!("Phase: {}", phase_label),
    ];

    for pattern in &patterns {
        if let Some(idx) = content.find(pattern.as_str()) {
            let rest = &content[idx + pattern.len()..];
            // Get the next paragraph or bullet points
            let mut action = String::new();
            for line in rest.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    if !action.is_empty() {
                        break;
                    }
                    continue;
                }
                if trimmed.starts_with("##") || trimmed.starts_with("Phase:") {
                    break;
                }
                action.push_str(trimmed);
                action.push(' ');
            }
            let action = action.trim().to_string();
            if !action.is_empty() {
                return Some(action);
            }
        }
    }

    None
}

/// Parse cross-session message format
pub fn parse_cross_session_message(content: &str) -> Option<(String, String)> {
    let open_tag = "<cross-session-message";
    if let Some(start) = content.find(open_tag) {
        let from_start = start + open_tag.len();
        if let Some(from_close) = content[from_start..].find('>') {
            let attrs = &content[from_start..from_start + from_close];
            // Extract 'from' attribute
            if let Some(from_val) = attrs.split_whitespace()
                .find(|a| a.starts_with("from="))
                .and_then(|a| a.split('"').nth(1))
            {
                let msg_start = from_start + from_close + 1;
                let close_tag = "</cross-session-message>";
                if let Some(msg_end) = content[msg_start..].find(close_tag) {
                    let message = &content[msg_start..msg_start + msg_end];
                    return Some((from_val.to_string(), message.trim().to_string()));
                }
            }
        }
    }
    None
}

/// Extracts content inside a specific XML tag
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

/// Dynamic scanner to detect <call:tool_name> blocks
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

/// Intelligent JSON Auto-repairer
fn repair_json_content(raw: &str) -> String {
    let mut cleaned = raw.trim().to_string();

    // Remove markdown code block markers
    if cleaned.starts_with("```") {
        if let Some(first_newline) = cleaned.find('\n') {
            cleaned = cleaned[first_newline + 1..].to_string();
        }
        if cleaned.ends_with("```") {
            cleaned = cleaned[..cleaned.len() - 3].to_string();
        }
    }

    cleaned = cleaned.trim().to_string();

    // Repair trailing commas
    cleaned = cleaned.replace(",\n}", "\n}");
    cleaned = cleaned.replace(",}", "}");
    cleaned = cleaned.replace(",\n]", "\n]");
    cleaned = cleaned.replace(",]", "]");

    cleaned
}

/// Strips all <thought>, <call>, <summary>, and <task-notification> tags
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
        let after_prefix = &stripped[start + 6..].to_string();
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

    // Remove <summary>...</summary>
    while let Some(start) = stripped.find("<summary>") {
        if let Some(end) = stripped[start..].find("</summary>") {
            let actual_end = start + end + 10;
            stripped.drain(start..actual_end);
        } else {
            break;
        }
    }

    // Remove <task-notification>...</task-notification>
    while let Some(start) = stripped.find("<task-notification>") {
        if let Some(end) = stripped[start..].find("</task-notification>") {
            let actual_end = start + end + 19;
            stripped.drain(start..actual_end);
        } else {
            break;
        }
    }

    stripped.trim().to_string()
}

/// Fallback scanner for ReAct/LangChain JSON action blocks
fn parse_json_action_block(content: &str) -> Option<ToolCall> {
    let cleaned = content.trim();
    let mut json_candidates = Vec::new();
    let mut start = 0;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_thought() {
        let response = "<thought>I need to read the file first</thought><call:read_file>\n{\"path\": \"test.txt\"}\n</call:read_file>";
        let parsed = parse_model_response(response);
        assert!(parsed.thought.is_some());
        assert_eq!(parsed.thought.as_deref(), Some("I need to read the file first"));
        assert!(parsed.tool_call.is_some());
        assert_eq!(parsed.tool_call.as_ref().unwrap().name, "read_file");
    }

    #[test]
    fn test_parse_task_notification() {
        let response = "<task-notification>\n<task-id>agent-abc</task-id>\n<status>completed</status>\n<summary>Fix applied</summary>\n<result>Done</result>\n<usage>\n<subagent_tokens>500</subagent_tokens>\n<tool_uses>3</tool_uses>\n<duration_ms>12000</duration_ms>\n</usage>\n</task-notification>";
        let parsed = parse_model_response(response);
        assert!(parsed.task_notification.is_some());
        let notif = parsed.task_notification.unwrap();
        assert_eq!(notif.task_id, "agent-abc");
        assert_eq!(notif.status, "completed");
        assert_eq!(notif.subagent_tokens, Some(500));
    }

    #[test]
    fn test_parse_cross_session() {
        let response = "<cross-session-message from=\"uds:other-session\">Hello from peer</cross-session-message>";
        let result = parse_cross_session_message(response);
        assert!(result.is_some());
        let (from, msg) = result.unwrap();
        assert_eq!(from, "uds:other-session");
        assert_eq!(msg, "Hello from peer");
    }
}
