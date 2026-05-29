use serde::{Deserialize, Serialize};
use serde_json::Value;

/// ─── CORE STRUCTS ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedResponse {
    pub thought: Option<String>,
    pub tool_call: Option<ToolCall>,
    pub tool_calls: Vec<ToolCall>, // Multiple parallel tool calls (OpenAI-style)
    pub plain_text: Option<String>,
    pub diagnostics: Vec<String>,
    pub plan_phase: Option<PlanPhaseDirective>,
    pub task_notification: Option<TaskNotification>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub name: String,
    pub arguments: Value,
    pub raw_arguments: String,
    pub call_id: Option<String>, // For OpenAI-style tool call IDs
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanPhaseDirective {
    pub phase: String,
    pub action: String,
    pub details: Option<String>,
}

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

/// ─── MAIN PARSER: Multi-strategy, enterprise-grade ──────────────

pub fn parse_model_response(response: &str) -> ParsedResponse {
    let mut thought = None;
    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let mut first_tool_call = None;
    let mut plain_text = None;
    let mut diagnostics = Vec::new();
    let mut plan_phase = None;
    let mut task_notification = None;

    // 1. Task notification (worker results)
    if let Some(notif) = parse_task_notification(response) {
        task_notification = Some(notif);
        diagnostics.push("Task notification detected".to_string());
        return ParsedResponse {
            thought: None,
            tool_call: None,
            tool_calls: vec![],
            plain_text: None,
            diagnostics,
            plan_phase: None,
            task_notification,
        };
    }

    // 2. Plan phase directives
    if let Some(dir) = parse_plan_directive(response) {
        plan_phase = Some(dir);
    }

    // 3. Extract <thought> block
    let raw_thought = extract_tag_content(response, "thought");
    if let Some(ref t) = raw_thought {
        thought = Some(t.trim().to_string());
    }

    // ─── STRATEGY 1: OpenAI-style native tool_calls array ─────────
    let tc = parse_openai_tool_calls(response);
    if !tc.is_empty() {
        diagnostics.push(format!("Parsed {} OpenAI-style tool calls", tc.len()));
        tool_calls = tc;
    }

    // ─── STRATEGY 2: XML <call:tool_name> format ─────────────────
    if tool_calls.is_empty() {
        let xml_tc = parse_xml_call_tags(response);
        if !xml_tc.is_empty() {
            diagnostics.push(format!("Parsed {} XML tool calls", xml_tc.len()));
            tool_calls = xml_tc;
        }
    }

    // ─── STRATEGY 2b: Raw <tool_name> tags (no call: prefix) ────
    if tool_calls.is_empty() {
        let raw_tc = parse_raw_tool_tags(response);
        if !raw_tc.is_empty() {
            diagnostics.push(format!("Parsed {} raw tool tag calls", raw_tc.len()));
            tool_calls = raw_tc;
        }
    }

    // ─── STRATEGY 3: JSON action block (ReAct/LangChain) ─────────
    if tool_calls.is_empty() {
        let json_tc = parse_json_action_block(response);
        if !json_tc.is_empty() {
            diagnostics.push(format!("Parsed {} JSON action block tool calls", json_tc.len()));
            tool_calls = json_tc;
        }
    }

    // ─── STRATEGY 4: Isolated JSON object with tool name ─────────
    if tool_calls.is_empty() {
        let iso_tc = parse_isolated_json_tool(response);
        if !iso_tc.is_empty() {
            diagnostics.push(format!("Parsed {} isolated JSON tool calls", iso_tc.len()));
            tool_calls = iso_tc;
        }
    }

    // Set first_tool_call for backward compat
    if !tool_calls.is_empty() {
        first_tool_call = Some(tool_calls[0].clone());
    }

    // 5. Extract plain text (strip all tags)
    let clean_text = strip_tags(response);
    let clean_trimmed = clean_text.trim().to_string();
    if !clean_trimmed.is_empty() {
        plain_text = Some(clean_trimmed);
    } else if tool_calls.is_empty() {
        // Fallback: if no tool calls and no plain text, use thought content
        if let Some(ref t) = thought {
            if !t.trim().is_empty() {
                plain_text = Some(t.clone());
            }
        }
    }

    ParsedResponse {
        thought,
        tool_call: first_tool_call,
        tool_calls,
        plain_text,
        diagnostics,
        plan_phase,
        task_notification,
    }
}

/// ─── STRATEGY 1: OpenAI-style tool_calls JSON array ─────────────
///
/// Format:
/// ```json
/// {
///   "tool_calls": [
///     {
///       "id": "call_1",
///       "type": "function",
///       "function": {
///         "name": "read_file",
///         "arguments": "{\"path\": \"src/main.rs\"}"
///       }
///     }
///   ]
/// }
/// ```
fn parse_openai_tool_calls(content: &str) -> Vec<ToolCall> {
    let mut results = Vec::new();

    // Try to find JSON blocks
    let json_candidates = extract_json_candidates(content);

    for candidate in &json_candidates {
        let repaired = robust_json_repair(candidate);

        if let Ok(val) = serde_json::from_str::<Value>(&repaired) {
            // Check for "tool_calls" array
            if let Some(tc_array) = val.get("tool_calls").and_then(|v| v.as_array()) {
                for (_idx, tc) in tc_array.iter().enumerate() {
                    let func = tc.get("function");
                    let name = func
                        .and_then(|f| f.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if name.is_empty() {
                        continue;
                    }

                    let args_str = func
                        .and_then(|f| f.get("arguments"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("{}");

                    let args_val = serde_json::from_str::<Value>(args_str).unwrap_or(Value::Object(Default::default()));
                    let call_id = tc.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());

                    results.push(ToolCall {
                        name: name.to_string(),
                        arguments: args_val,
                        raw_arguments: args_str.to_string(),
                        call_id,
                    });
                }
            }

            // Also check single "function" call
            if results.is_empty() {
                if let Some(name) = val.get("name").and_then(|v| v.as_str()) {
                    let args = val.get("arguments").cloned().unwrap_or(Value::Object(Default::default()));
                    results.push(ToolCall {
                        name: name.to_string(),
                        arguments: args.clone(),
                        raw_arguments: serde_json::to_string(&args).unwrap_or_default(),
                        call_id: None,
                    });
                }
            }
        }
    }

    results
}

/// ─── STRATEGY 2: XML <call:tool_name> format ────────────────────
fn parse_xml_call_tags(content: &str) -> Vec<ToolCall> {
    let mut results = Vec::new();
    let mut search_from = 0;

    while let Some(start) = content[search_from..].find("<call:") {
        let abs_start = search_from + start;
        let after = &content[abs_start + 6..];

        // Find the tool name
        if let Some(name_end) = after.find('>') {
            let tool_name = after[..name_end].trim().to_string();
            let args_start = abs_start + 6 + name_end + 1;
            let close_tag = format!("</call:{}>", tool_name);

            // Try to find closing tag
            if let Some(end_idx) = content[args_start..].find(&close_tag) {
                let raw_args = content[args_start..args_start + end_idx].to_string();
                if let Some(tc) = build_tool_call(&tool_name, &raw_args) {
                    results.push(tc);
                }
                search_from = args_start + end_idx + close_tag.len();
            } else {
                // Fallback: extract JSON by brace matching
                let candidate = &content[args_start..];
                let json_block = extract_balanced_json(candidate);
                if !json_block.is_empty() {
                    if let Some(tc) = build_tool_call(&tool_name, &json_block) {
                        results.push(tc);
                    }
                }
                search_from = args_start + json_block.len().max(1);
            }
        } else {
            search_from = abs_start + 6;
        }
    }

    results
}

/// ─── STRATEGY 2b: Raw <tool_name> tags (no call: prefix) ──────
///
/// Handles formats like:
/// ```xml
/// <execute_command>
/// <command>dir /B /S "path"</command>
/// </execute_command>
/// ```
/// or:
/// ```xml
/// <read_file>
/// <path>/path/to/file</path>
/// </read_file>
/// ```
fn parse_raw_tool_tags(content: &str) -> Vec<ToolCall> {
    // All known tool names that can appear as raw XML tags
    const KNOWN_TOOLS: &[&str] = &[
        "execute_command",
        "read_file",
        "write_file",
        "check_port",
        "get_project_files",
        "save_memory",
        "search_memory",
        "check_command_status",
        "compact_history",
        "scan_directory_tree",
        "scan_subdirectory",
        "search_files",
        "extract_symbol",
        "read_file_range",
        "search_symbol",
    ];

    let mut results = Vec::new();
    let mut search_from = 0;

    while let Some(tag_start) = content[search_from..].find('<') {
        let abs_start = search_from + tag_start;

        // Skip if it's a closing tag or self-closing or a known prefix like <call: or </
        let after_open = &content[abs_start + 1..];
        if after_open.starts_with('/') || after_open.starts_with('!') || after_open.starts_with('?') {
            search_from = abs_start + 1;
            continue;
        }

        // Find the end of the opening tag name
        let name_end = after_open.find('>').unwrap_or(after_open.len());
        let tag_name = after_open[..name_end].trim().to_string();

        // Skip if it's not a known tool or has call: prefix (handled by parse_xml_call_tags)
        if tag_name.starts_with("call:") || !KNOWN_TOOLS.contains(&tag_name.as_str()) {
            search_from = abs_start + 1 + name_end;
            continue;
        }

        let body_start = abs_start + 1 + name_end + 1; // After '>'
        let close_tag = format!("</{}>", tag_name);

        // Find the matching closing tag
        if let Some(close_idx) = content[body_start..].find(&close_tag) {
            let body = &content[body_start..body_start + close_idx];
            let body_trimmed = body.trim();

            // Try to parse as JSON first
            if let Ok(val) = serde_json::from_str::<Value>(body_trimmed) {
                if val.is_object() {
                    results.push(ToolCall {
                        name: tag_name.clone(),
                        arguments: val.clone(),
                        raw_arguments: body_trimmed.to_string(),
                        call_id: None,
                    });
                    search_from = body_start + close_idx + close_tag.len();
                    continue;
                }
            }

            // Parse sub-elements as key-value pairs
            let mut sub_args = serde_json::Map::new();
            let mut sub_search = 0;
            while let Some(sub_start) = body[sub_search..].find('<') {
                let sub_abs = sub_search + sub_start;
                let after_sub = &body[sub_abs + 1..];

                if after_sub.starts_with('/') || after_sub.starts_with('!') {
                    sub_search = sub_abs + 1;
                    continue;
                }

                let sub_name_end = after_sub.find('>').unwrap_or(after_sub.len());
                let sub_name = after_sub[..sub_name_end].trim().to_string();
                let sub_body_start = sub_abs + 1 + sub_name_end + 1;
                let sub_close = format!("</{}>", sub_name);

                if let Some(sub_close_idx) = body[sub_body_start..].find(&sub_close) {
                    let sub_value = body[sub_body_start..sub_body_start + sub_close_idx].trim().to_string();
                    sub_args.insert(sub_name.clone(), Value::String(sub_value));
                    sub_search = sub_body_start + sub_close_idx + sub_close.len();
                } else {
                    sub_search = sub_abs + 1;
                }
            }

            if !sub_args.is_empty() {
                let args = Value::Object(sub_args);
                results.push(ToolCall {
                    name: tag_name.clone(),
                    arguments: args.clone(),
                    raw_arguments: serde_json::to_string(&args).unwrap_or_default(),
                    call_id: None,
                });
            } else {
                // No sub-elements found, try to infer key from tool name and use raw text as value
                let raw_text = body.trim().to_string();
                if !raw_text.is_empty() {
                    if let Some(key) = infer_key_for_tool(&tag_name) {
                        let mut map = serde_json::Map::new();
                        map.insert(key.to_string(), Value::String(raw_text));
                        let args = Value::Object(map);
                        results.push(ToolCall {
                            name: tag_name.clone(),
                            arguments: args.clone(),
                            raw_arguments: serde_json::to_string(&args).unwrap_or_default(),
                            call_id: None,
                        });
                    }
                }
            }

            search_from = body_start + close_idx + close_tag.len();
        } else {
            search_from = abs_start + 1;
        }
    }

    results
}

/// ─── STRATEGY 3: JSON action block (ReAct/LangChain) ────────────
fn parse_json_action_block(content: &str) -> Vec<ToolCall> {
    let mut results = Vec::new();
    let json_candidates = extract_json_candidates(content);

    for candidate in &json_candidates {
        let repaired = robust_json_repair(candidate);
        if let Ok(val) = serde_json::from_str::<Value>(&repaired) {
            if let Some(action) = val.get("action").and_then(|v| v.as_str()) {
                let tool_name = action.to_string();
                let action_input = val.get("action_input");

                if let Some(input) = action_input {
                    let arguments = normalize_action_input(&tool_name, input);
                    results.push(ToolCall {
                        name: tool_name.clone(),
                        arguments: arguments.clone(),
                        raw_arguments: serde_json::to_string(&arguments).unwrap_or_default(),
                        call_id: None,
                    });
                } else {
                    // "action" alone without action_input
                    results.push(ToolCall {
                        name: tool_name,
                        arguments: Value::Object(Default::default()),
                        raw_arguments: "{}".to_string(),
                        call_id: None,
                    });
                }
            }
        }
    }

    results
}

/// ─── STRATEGY 4: Isolated JSON object with tool metadata ────────
fn parse_isolated_json_tool(content: &str) -> Vec<ToolCall> {
    let json_candidates = extract_json_candidates(content);

    for candidate in &json_candidates {
        let repaired = robust_json_repair(candidate);
        if let Ok(val) = serde_json::from_str::<Value>(&repaired) {
            // Check for "tool" field
            if let Some(tool_name) = val.get("tool").and_then(|v| v.as_str()) {
                let args = val.get("args").or(val.get("params")).or(val.get("arguments"))
                    .cloned().unwrap_or(Value::Object(Default::default()));
                return vec![ToolCall {
                    name: tool_name.to_string(),
                    arguments: args.clone(),
                    raw_arguments: serde_json::to_string(&args).unwrap_or_default(),
                    call_id: None,
                }];
            }
            // Check for "function" field
            if let Some(func_name) = val.get("function").and_then(|v| v.as_str()) {
                let args = val.get("params").or(val.get("arguments"))
                    .cloned().unwrap_or(Value::Object(Default::default()));
                return vec![ToolCall {
                    name: func_name.to_string(),
                    arguments: args.clone(),
                    raw_arguments: serde_json::to_string(&args).unwrap_or_default(),
                    call_id: None,
                }];
            }
        }
    }

    vec![]
}

/// ─── TOOL CALL CONSTRUCTOR ────────────────────────────────────────

fn build_tool_call(tool_name: &str, raw_args: &str) -> Option<ToolCall> {
    let trimmed = raw_args.trim().to_string();
    if trimmed.is_empty() {
        return Some(ToolCall {
            name: tool_name.to_string(),
            arguments: Value::Object(Default::default()),
            raw_arguments: "{}".to_string(),
            call_id: None,
        });
    }

    let repaired = robust_json_repair(&trimmed);
    match serde_json::from_str::<Value>(&repaired) {
        Ok(val) => Some(ToolCall {
            name: tool_name.to_string(),
            arguments: val.clone(),
            raw_arguments: trimmed,
            call_id: None,
        }),
        Err(e) => {
            // Last resort: wrap as a string param
            if let Some(key) = infer_key_for_tool(tool_name) {
                let wrapped = serde_json::json!({ key: trimmed });
                Some(ToolCall {
                    name: tool_name.to_string(),
                    arguments: wrapped,
                    raw_arguments: trimmed,
                    call_id: None,
                })
            } else {
                eprintln!("[PARSER] Failed to parse args for tool '{}': {}", tool_name, e);
                None
            }
        }
    }
}

fn infer_key_for_tool(tool_name: &str) -> Option<&'static str> {
    match tool_name {
        "read_file" | "write_file" | "get_project_files" | "scan_subdirectory" | "extract_symbol"
        | "read_file_range" => Some("path"),
        "execute_command" | "check_command_status" => Some("command"),
        "check_port" => Some("port"),
        "search_files" => Some("pattern"),
        "search_symbol" => Some("symbol"),
        "search_memory" => Some("query"),
        "save_memory" => Some("name"),
        _ => None,
    }
}

fn normalize_action_input(tool_name: &str, input: &Value) -> Value {
    match tool_name {
        "read_file" | "write_file" => {
            if let Some(path) = input.as_str() {
                serde_json::json!({ "path": path })
            } else {
                input.clone()
            }
        }
        "execute_command" => {
            if let Some(cmd_str) = input.as_str() {
                let parts: Vec<&str> = cmd_str.split_whitespace().collect();
                if !parts.is_empty() {
                    serde_json::json!({
                        "command": parts[0],
                        "args": &parts[1..]
                    })
                } else {
                    input.clone()
                }
            } else {
                input.clone()
            }
        }
        "get_project_files" | "scan_subdirectory" => {
            if let Some(path) = input.as_str() {
                serde_json::json!({ "path": path })
            } else if input.is_null() {
                serde_json::json!({ "path": "." })
            } else {
                input.clone()
            }
        }
        "check_port" => {
            if let Some(port) = input.as_u64() {
                serde_json::json!({ "port": port })
            } else if let Some(port_str) = input.as_str() {
                if let Ok(port) = port_str.parse::<u64>() {
                    serde_json::json!({ "port": port })
                } else {
                    input.clone()
                }
            } else {
                input.clone()
            }
        }
        _ => input.clone(),
    }
}

/// ─── ROBUST JSON REPAIR ──────────────────────────────────────────
///
/// Handles common LLM output errors:
/// - Trailing commas in objects/arrays
/// - Missing closing brackets/braces
/// - Unquoted keys (e.g., {key: "val"})
/// - Single-quoted strings
/// - Markdown code block wrappers
/// - Extra text before/after JSON
/// - Nested backtick issues
/// - Unicode escape issues
/// - Duplicate keys (take last)
fn robust_json_repair(raw: &str) -> String {
    let mut s = raw.to_string();

    // 1. Strip markdown code blocks
    s = strip_markdown_fences(&s);

    // 2. Find JSON boundaries (first { or [ to last } or ])
    s = extract_json_boundary(&s);

    // 3. Fix single-quoted strings (but not within double-quoted)
    s = fix_single_quotes(&s);

    // 4. Fix unquoted keys: {key: "val"} -> {"key": "val"}
    s = fix_unquoted_keys(&s);

    // 5. Remove trailing commas
    s = fix_trailing_commas(&s);

    // 6. Fix missing closing brackets
    s = fix_missing_brackets(&s);

    // 7. Fix common escape issues
    s = fix_escapes(&s);

    // 8. Fix duplicate keys (keep last occurrence)
    if let Ok(val) = serde_json::from_str::<Value>(&s) {
        // Already valid after repairs
        return serde_json::to_string(&val).unwrap_or(s);
    }

    // 9. Try to salvage by removing problematic characters
    s = s.chars().filter(|c| c.is_ascii() || *c == '\n' || *c == '\r' || *c == '\t').collect();

    // 10. Final attempt: if still invalid, try to find any valid JSON subset
    if let Ok(val) = serde_json::from_str::<Value>(&s) {
        return serde_json::to_string(&val).unwrap_or(s);
    }

    s
}

fn strip_markdown_fences(s: &str) -> String {
    let trimmed = s.trim();
    if trimmed.starts_with("```json") || trimmed.starts_with("```") {
        let after_open = if trimmed.starts_with("```json") {
            &trimmed[7..]
        } else {
            &trimmed[3..]
        };
        if let Some(close) = after_open.rfind("```") {
            return after_open[..close].trim().to_string();
        }
        return after_open.trim().to_string();
    }
    s.to_string()
}

fn extract_json_boundary(s: &str) -> String {
    let first_brace = s.find('{');
    let first_bracket = s.find('[');
    let last_brace = s.rfind('}');
    let last_bracket = s.rfind(']');

    let start = match (first_brace, first_bracket) {
        (Some(b), Some(br)) => b.min(br),
        (Some(b), None) => b,
        (None, Some(br)) => br,
        (None, None) => return s.to_string(),
    };

    let end = match (last_brace, last_bracket) {
        (Some(b), Some(br)) => b.max(br) + 1,
        (Some(b), None) => b + 1,
        (None, Some(br)) => br + 1,
        (None, None) => s.len(),
    };

    s[start..end].to_string()
}

fn fix_single_quotes(s: &str) -> String {
    // Replace single quotes with double quotes for key-value structures
    // Only outside of existing double-quoted strings
    let mut result = String::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    let mut in_double_quote = false;
    let mut in_single_quote = false;

    while i < chars.len() {
        let ch = chars[i];
        match ch {
            '"' if !in_single_quote => {
                // Toggle double quote only if not escaped
                if i == 0 || chars[i - 1] != '\\' {
                    in_double_quote = !in_double_quote;
                }
                result.push(ch);
            }
            '\'' if !in_double_quote => {
                // In JSON, single quotes need to become double quotes for strings
                // Check context: is this a string delimiter?
                if i == 0 || chars[i - 1] == ':' || chars[i - 1] == ' ' || chars[i - 1] == '{'
                    || chars[i - 1] == '[' || chars[i - 1] == ',' || chars[i - 1] == '\n' {
                    in_single_quote = !in_single_quote;
                    result.push('"');
                } else {
                    result.push(ch);
                }
            }
            '\'' if in_double_quote => {
                result.push(ch);
            }
            _ => result.push(ch),
        }
        i += 1;
    }

    result
}

fn fix_unquoted_keys(s: &str) -> String {
    // Pattern: unquoted word followed by : (not inside quotes)
    let mut result = String::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    let mut in_quotes = false;
    let mut in_single = false;

    while i < chars.len() {
        let ch = chars[i];

        match ch {
            '"' if !in_single => {
                if i == 0 || chars[i - 1] != '\\' {
                    in_quotes = !in_quotes;
                }
                result.push(ch);
            }
            '\'' if !in_quotes => {
                if i == 0 || chars[i - 1] != '\\' {
                    in_single = !in_single;
                }
                result.push('"');
            }
            ':' if !in_quotes && !in_single => {
                // Look back to find start of the key
                let key_start = find_key_start(&result);
                if key_start < result.len() {
                    let key = &result[key_start..];
                    if !key.starts_with('"') && !key.trim().is_empty() {
                        // Need to quote the key
                        let key_trimmed = key.trim();
                        let before_key = &result[..key_start];
                        let spaces = &key[..key.len() - key_trimmed.len()];
                        result = format!("{}\"{}\"{}", before_key, key_trimmed, spaces);
                    }
                }
                result.push(ch);
            }
            _ => result.push(ch),
        }
        i += 1;
    }

    result
}

fn find_key_start(s: &str) -> usize {
    let mut i = s.len();
    let chars: Vec<char> = s.chars().collect();
    if i == 0 {
        return 0;
    }
    i -= 1;
    // Walk backwards through whitespace
    while i > 0 && (chars[i] == ' ' || chars[i] == '\t' || chars[i] == '\n' || chars[i] == '\r') {
        i = i.saturating_sub(1);
    }
    // Walk backwards through key characters
    while i > 0 && chars[i] != ',' && chars[i] != '{' && chars[i] != '[' && chars[i] != '\n' {
        i = i.saturating_sub(1);
    }
    if i > 0 && (chars[i] == ',' || chars[i] == '{' || chars[i] == '[') {
        i += 1;
    }
    while i < s.len() && (chars.get(i) == Some(&' ') || chars.get(i) == Some(&'\t')) {
        i += 1;
    }
    i
}

fn fix_trailing_commas(s: &str) -> String {
    let mut result = s.to_string();
    // Remove trailing commas before closing braces/brackets
    result = result.replace(",\n}", "\n}");
    result = result.replace(",\n]", "\n]");
    result = result.replace(",}", "}");
    result = result.replace(",]", "]");
    result = result.replace(",  }", "}");
    result = result.replace(",  ]", "]");
    result = result.replace(",\t}", "}");
    result = result.replace(",\t]", "]");
    // Also handle multiple trailing commas
    result = result.replace(",,", ",");
    result
}

fn fix_missing_brackets(s: &str) -> String {
    let mut result = s.to_string();
    let open_braces = result.matches('{').count();
    let close_braces = result.matches('}').count();
    let open_brackets = result.matches('[').count();
    let close_brackets = result.matches(']').count();

    // Add missing closing braces
    for _ in 0..(open_braces.saturating_sub(close_braces)) {
        result.push('}');
    }
    // Add missing closing brackets
    for _ in 0..(open_brackets.saturating_sub(close_brackets)) {
        result.push(']');
    }

    result
}

fn fix_escapes(s: &str) -> String {
    s.replace("\\'", "'")
        .replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace("\\\"", "\"")
}

/// ─── JSON CANDIDATE EXTRACTION ───────────────────────────────────

fn extract_json_candidates(content: &str) -> Vec<String> {
    let mut candidates = Vec::new();

    // Extract markdown code blocks with json
    let mut search = 0;
    while let Some(start) = content[search..].find("```") {
        let abs_start = search + start + 3;
        // Find language specifier
        if let Some(newline) = content[abs_start..].find('\n') {
            let lang = content[abs_start..abs_start + newline].trim();
            let code_start = abs_start + newline + 1;
            if let Some(end) = content[code_start..].find("\n```") {
                let block = content[code_start..code_start + end].trim();
                if lang.is_empty() || lang == "json" || lang == "javascript" {
                    candidates.push(block.to_string());
                }
                search = code_start + end + 4;
            } else {
                search = abs_start;
            }
        } else {
            search = abs_start;
        }
    }

    // Extract top-level JSON objects/arrays
    let mut i = 0;
    let chars: Vec<char> = content.chars().collect();
    while i < chars.len() {
        if chars[i] == '{' || chars[i] == '[' {
            let start = i;
            let mut depth = 0;
            let mut in_str = false;
            let mut escape = false;
            let mut end = i;

            while i < chars.len() {
                let ch = chars[i];
                if escape {
                    escape = false;
                    i += 1;
                    continue;
                }
                match ch {
                    '"' => in_str = !in_str,
                    '\\' if in_str => escape = true,
                    '{' | '[' if !in_str => depth += 1,
                    '}' | ']' if !in_str => {
                        depth -= 1;
                        if depth == 0 {
                            end = i + 1;
                            i += 1;
                            break;
                        }
                    }
                    _ => {}
                }
                i += 1;
            }

            if end > start {
                let block = content[start..end].to_string();
                if !candidates.contains(&block) {
                    candidates.push(block);
                }
            }
        } else {
            i += 1;
        }
    }

    candidates
}

fn extract_balanced_json(s: &str) -> String {
    let start = match (s.find('{'), s.find('[')) {
        (Some(b), Some(br)) => b.min(br),
        (Some(b), None) => b,
        (None, Some(br)) => br,
        (None, None) => return String::new(),
    };

    let chars: Vec<char> = s[start..].chars().collect();
    let mut depth = 0;
    let mut in_str = false;
    let mut escape = false;

    for (i, ch) in chars.iter().enumerate() {
        if escape {
            escape = false;
            continue;
        }
        match ch {
            '"' => in_str = !in_str,
            '\\' if in_str => escape = true,
            '{' | '[' if !in_str => depth += 1,
            '}' | ']' if !in_str => {
                depth -= 1;
                if depth == 0 {
                    return s[start..start + i + 1].to_string();
                }
            }
            _ => {}
        }
    }

    String::new()
}

/// ─── UTILITY FUNCTIONS ───────────────────────────────────────────

fn extract_tag_content(content: &str, tag_name: &str) -> Option<String> {
    let open_tag = format!("<{}>", tag_name);
    let close_tag = format!("</{}>", tag_name);

    let start_idx = content.to_lowercase().find(&open_tag)?;
    let start_pos = start_idx + open_tag.len();
    let end_idx = content.to_lowercase()[start_pos..].find(&close_tag)?;
    Some(content[start_pos..start_pos + end_idx].to_string())
}

fn strip_tags(content: &str) -> String {
    let mut stripped = content.to_string();

    // Remove <thought>...</thought>
    while let Some(start) = stripped.to_lowercase().find("<thought>") {
        if let Some(end) = stripped.to_lowercase()[start..].find("</thought>") {
            stripped.drain(start..start + end + 11);
        } else {
            break;
        }
    }

    // Remove <call:tool>...</call:tool>
    while let Some(start) = stripped.find("<call:") {
        let after_prefix = &stripped[start + 6..];
        if let Some(tag_close) = after_prefix.find('>') {
            let tool_name = after_prefix[..tag_close].trim();
            let close_tag = format!("</call:{}>", tool_name);
            if let Some(end) = stripped[start..].find(&close_tag) {
                stripped.drain(start..start + end + close_tag.len());
            } else {
                stripped.drain(start..);
                break;
            }
        } else {
            break;
        }
    }

    // Remove <summary>...</summary>
    while let Some(start) = stripped.find("<summary>") {
        if let Some(end) = stripped[start..].find("</summary>") {
            stripped.drain(start..start + end + 10);
        } else {
            break;
        }
    }

    // Remove <task-notification>...</task-notification>
    while let Some(start) = stripped.find("<task-notification>") {
        if let Some(end) = stripped[start..].find("</task-notification>") {
            stripped.drain(start..start + end + 20);
        } else {
            break;
        }
    }

    // Remove <system-reminder> blocks
    while let Some(start) = stripped.find("<system-reminder>") {
        if let Some(end) = stripped[start..].find("</system-reminder>") {
            stripped.drain(start..start + end + 19);
        } else {
            break;
        }
    }

    stripped.trim().to_string()
}

/// ─── TASK NOTIFICATION PARSING ───────────────────────────────────

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

/// ─── PLAN DIRECTIVE PARSING ──────────────────────────────────────

fn parse_plan_directive(content: &str) -> Option<PlanPhaseDirective> {
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

fn extract_phase_action(content: &str, phase_label: &str) -> Option<String> {
    let patterns = [
        format!("## {}", phase_label),
        format!("Phase: {}", phase_label),
    ];
    for pattern in &patterns {
        if let Some(idx) = content.find(pattern.as_str()) {
            let rest = &content[idx + pattern.len()..];
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

/// ─── CROSS-SESSION MESSAGE ───────────────────────────────────────

pub fn parse_cross_session_message(content: &str) -> Option<(String, String)> {
    let open_tag = "<cross-session-message";
    if let Some(start) = content.find(open_tag) {
        let from_start = start + open_tag.len();
        if let Some(from_close) = content[from_start..].find('>') {
            let attrs = &content[from_start..from_start + from_close];
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

/// ─── TESTS ───────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_openai_tool_calls() {
        let response = r#"{"tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": "{\"path\": \"test.txt\"}"}}]}"#;
        let parsed = parse_model_response(response);
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "read_file");
        assert_eq!(parsed.tool_calls[0].arguments["path"], "test.txt");
    }

    #[test]
    fn test_parse_xml_call() {
        let response = "<thought>Need to read</thought><call:read_file>\n{\"path\": \"src/main.rs\"}\n</call:read_file>";
        let parsed = parse_model_response(response);
        assert!(parsed.thought.is_some());
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "read_file");
    }

    #[test]
    fn test_parse_json_action_block() {
        let response = r#"```json
{
  "action": "read_file",
  "action_input": {"path": "src/main.rs"}
}
```"#;
        let parsed = parse_model_response(response);
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "read_file");
    }

    #[test]
    fn test_parse_isolated_json() {
        let response = r#"{"tool": "search_files", "args": {"pattern": "mod.rs"}}"#;
        let parsed = parse_model_response(response);
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "search_files");
    }

    #[test]
    fn test_parse_task_notification() {
        let response = "<task-notification>\n<task-id>agent-abc</task-id>\n<status>completed</status>\n<summary>Fix applied</summary>\n<result>Done</result>\n</task-notification>";
        let parsed = parse_model_response(response);
        assert!(parsed.task_notification.is_some());
    }

    #[test]
    fn test_robust_json_repair_trailing_comma() {
        let input = r#"{"path": "src/main.rs",}"#;
        let repaired = robust_json_repair(input);
        assert!(serde_json::from_str::<Value>(&repaired).is_ok());
    }

    #[test]
    fn test_robust_json_repair_missing_bracket() {
        let input = r#"{"path": "src/main.rs""#;
        let repaired = robust_json_repair(input);
        assert!(serde_json::from_str::<Value>(&repaired).is_ok());
    }

    #[test]
    fn test_robust_json_repair_markdown_wrapper() {
        let input = "```json\n{\"path\": \"test.txt\"}\n```";
        let repaired = robust_json_repair(input);
        assert_eq!(repaired, "{\"path\":\"test.txt\"}");
    }

    #[test]
    fn test_empty_response() {
        let parsed = parse_model_response("");
        assert!(parsed.tool_calls.is_empty());
        assert!(parsed.thought.is_none());
    }

    #[test]
    fn test_repair_unquoted_keys() {
        let input = "{path: \"test.txt\"}";
        let repaired = robust_json_repair(input);
        assert!(serde_json::from_str::<Value>(&repaired).is_ok());
    }

    #[test]
    fn test_double_tool_calls() {
        let response = r#"<call:read_file>{"path": "a.txt"}</call:read_file>
<call:read_file>{"path": "b.txt"}</call:read_file>"#;
        let parsed = parse_model_response(response);
        assert_eq!(parsed.tool_calls.len(), 2);
    }

    #[test]
    fn test_parse_cross_session() {
        let response = "<cross-session-message from=\"subagent\">Task done</cross-session-message>";
        let result = parse_cross_session_message(response);
        assert!(result.is_some());
        assert_eq!(result.unwrap().1, "Task done");
    }

    #[test]
    fn test_repair_missing_closing_brace() {
        let input = "{\"path\": \"test.txt\", \"content\": \"hello world";
        let repaired = robust_json_repair(input);
        let val = serde_json::from_str::<Value>(&repaired);
        assert!(val.is_ok(), "Failed to repair: {}", repaired);
    }

    #[test]
    fn test_openai_multiple_calls() {
        let response = r#"{"tool_calls": [
            {"id": "1", "type": "function", "function": {"name": "read_file", "arguments": "{\"path\": \"a.rs\"}"}},
            {"id": "2", "type": "function", "function": {"name": "read_file", "arguments": "{\"path\": \"b.rs\"}"}}
        ]}"#;
        let parsed = parse_model_response(response);
        assert_eq!(parsed.tool_calls.len(), 2);
    }

    // ─── Raw tool tag tests (Strategy 2b) ──────────────────────

    #[test]
    fn test_parse_raw_execute_command_with_sub_el() {
        let response = "<execute_command>\n<command>dir /B /S \"path\"</command>\n</execute_command>";
        let parsed = parse_model_response(response);
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "execute_command");
        assert_eq!(parsed.tool_calls[0].arguments["command"], "dir /B /S \"path\"");
    }

    #[test]
    fn test_parse_raw_read_file() {
        let response = "<read_file>\n<path>/path/to/file.txt</path>\n</read_file>";
        let parsed = parse_model_response(response);
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "read_file");
        assert_eq!(parsed.tool_calls[0].arguments["path"], "/path/to/file.txt");
    }

    #[test]
    fn test_parse_raw_execute_command_with_body_text() {
        let response = "<execute_command>cargo build</execute_command>";
        let parsed = parse_model_response(response);
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "execute_command");
        assert_eq!(parsed.tool_calls[0].arguments["command"], "cargo build");
    }

    #[test]
    fn test_parse_raw_mixed_with_thought() {
        let response = "<thought>Let me read the file</thought>\n<read_file>\n<path>README.md</path>\n</read_file>";
        let parsed = parse_model_response(response);
        assert!(parsed.thought.is_some());
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "read_file");
        assert_eq!(parsed.tool_calls[0].arguments["path"], "README.md");
    }

    #[test]
    fn test_parse_raw_multiple_tools() {
        let response = "<execute_command><command>dir README*</command></execute_command>\n<read_file><path>README.md</path></read_file>";
        let parsed = parse_model_response(response);
        assert_eq!(parsed.tool_calls.len(), 2);
        assert_eq!(parsed.tool_calls[0].name, "execute_command");
        assert_eq!(parsed.tool_calls[1].name, "read_file");
    }

    #[test]
    fn test_parse_raw_unknown_tag_ignored() {
        let response = "<unknown_tag>some content</unknown_tag><read_file><path>test.txt</path></read_file>";
        let parsed = parse_model_response(response);
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "read_file");
    }
}
