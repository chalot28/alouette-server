use serde_json::{json, Value};

/// Central tool definitions for all AI agent tools.
/// Used by both prompt assembly and API tool calling.
#[derive(Debug, Clone)]
pub struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    pub parameters: Value, // JSON Schema
}

pub fn all_tools() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "read_file",
            description: "Read the full contents of a file within the workspace. For large files, use read_file_range to read specific sections.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative or absolute path to the file. If relative, resolved against workspace root."
                    }
                },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "write_file",
            description: "Create a new file or overwrite an existing file with new content. Parent directories are created automatically.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative or absolute path where the file should be written."
                    },
                    "content": {
                        "type": "string",
                        "description": "The full content to write to the file."
                    }
                },
                "required": ["path", "content"]
            }),
        },
        ToolDef {
            name: "execute_command",
            description: "Run a terminal command inside a sandboxed execution environment with path and resource restrictions. On Windows runs through PowerShell, on Unix through sh -c.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The command to execute (e.g. cargo, npm, python, git)."
                    },
                    "args": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Array of arguments to pass to the command."
                    }
                },
                "required": ["command"]
            }),
        },
        ToolDef {
            name: "check_port",
            description: "Check whether a specific TCP port is available or already in use.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "port": {
                        "type": "integer",
                        "description": "The port number to check (0-65535)."
                    }
                },
                "required": ["port"]
            }),
        },
        ToolDef {
            name: "get_project_files",
            description: "Recursively list all files in the workspace, excluding build artifacts (.git, target, node_modules, .idea, logs).",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The directory path to start listing from. Use '.' for workspace root."
                    }
                },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "save_memory",
            description: "Persist information in the agent's long-term memory system. Memories survive across sessions. Use for user preferences, project context, feedback.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Short kebab-case slug identifying the memory."
                    },
                    "description": {
                        "type": "string",
                        "description": "One-line summary used to decide relevance during recall."
                    },
                    "type": {
                        "type": "string",
                        "enum": ["user", "feedback", "project", "reference"],
                        "description": "Type of memory: user, feedback, project, or reference."
                    },
                    "content": {
                        "type": "string",
                        "description": "The fact to remember. Include Why and How to apply lines for feedback/project types."
                    }
                },
                "required": ["name", "description", "type", "content"]
            }),
        },
        ToolDef {
            name: "search_memory",
            description: "Search the persistent memory system for relevant information using keyword matching against name, description, and content fields.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query string."
                    }
                },
                "required": ["query"]
            }),
        },
        ToolDef {
            name: "check_command_status",
            description: "Check the status of a long-running command that timed out. Returns output if completed, or tells you how long to wait before checking again.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "command_id": {
                        "type": "string",
                        "description": "The Command ID returned by execute_command when it timed out."
                    }
                },
                "required": ["command_id"]
            }),
        },
        ToolDef {
            name: "scan_directory_tree",
            description: "Scan the PROJECT ROOT and return only ONE LEVEL (immediate children). Returns ONLY structure, NO file contents. Use this FIRST to understand the top-level project layout.",
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDef {
            name: "scan_subdirectory",
            description: "Scan a specific subdirectory (one level deep) to explore its contents. Use after scan_directory_tree to drill into folders of interest.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to the subdirectory to scan."
                    }
                },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "search_files",
            description: "Search for files by name or pattern across the project. Case-insensitive, matches any part of the filename.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Filename pattern to search for."
                    }
                },
                "required": ["pattern"]
            }),
        },
        ToolDef {
            name: "extract_symbol",
            description: "Extract a specific symbol (function, struct, trait, impl, variable) from a file. You do NOT need to know line numbers. Automatically finds the symbol definition.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "file": {
                        "type": "string",
                        "description": "Relative path to the file containing the symbol."
                    },
                    "symbol": {
                        "type": "string",
                        "description": "The symbol name to find and extract."
                    }
                },
                "required": ["file", "symbol"]
            }),
        },
        ToolDef {
            name: "read_file_range",
            description: "Read a specific range of lines from a file. Typically used AFTER extract_symbol told you the exact line numbers.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "file": {
                        "type": "string",
                        "description": "Relative path to the file."
                    },
                    "start_line": {
                        "type": "integer",
                        "description": "First line number (1-based) to read."
                    },
                    "end_line": {
                        "type": "integer",
                        "description": "Last line number (1-based, exclusive) to read."
                    }
                },
                "required": ["file", "start_line", "end_line"]
            }),
        },
        ToolDef {
            name: "search_symbol",
            description: "Search for a symbol (function, struct, variable name) across the ENTIRE project. Returns which files reference or define that symbol.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "symbol": {
                        "type": "string",
                        "description": "The symbol name to search for across all source files."
                    }
                },
                "required": ["symbol"]
            }),
        },
        ToolDef {
            name: "compact_history",
            description: "Compress the conversation history to save tokens. Call this when the conversation is getting too long.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "Brief summary of the conversation so far to preserve context."
                    }
                },
                "required": ["summary"]
            }),
        },
    ]
}

/// Build the OpenAI-compatible `tools` array for native tool calling.
pub fn tools_json_for_api() -> Value {
    let tools: Vec<Value> = all_tools().into_iter().map(|t| {
        json!({
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters
            }
        })
    }).collect();
    json!(tools)
}

/// Build Claude-compatible `tools` array.
pub fn tools_json_for_claude() -> Value {
    let tools: Vec<Value> = all_tools().into_iter().map(|t| {
        json!({
            "name": t.name,
            "description": t.description,
            "input_schema": t.parameters
        })
    }).collect();
    json!(tools)
}

/// Build Gemini-compatible `tools` array with functionDeclarations.
pub fn tools_json_for_gemini() -> Value {
    let funcs: Vec<Value> = all_tools().into_iter().map(|t| {
        // Gemini uses UPPER_CASE for JSON Schema types
        let params = gemini_normalize_schema(&t.parameters);
        json!({
            "name": t.name,
            "description": t.description,
            "parameters": params
        })
    }).collect();
    json!([{ "functionDeclarations": funcs }])
}

/// Convert JSON Schema string types to Gemini's uppercase convention.
fn gemini_normalize_schema(schema: &Value) -> Value {
    match schema {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                let val = if k == "type" {
                    if let Some(s) = v.as_str() {
                        json!(s.to_uppercase())
                    } else {
                        gemini_normalize_schema(v)
                    }
                } else {
                    gemini_normalize_schema(v)
                };
                out.insert(k.clone(), val);
            }
            Value::Object(out)
        }
        Value::Array(arr) => {
            Value::Array(arr.iter().map(gemini_normalize_schema).collect())
        }
        other => other.clone(),
    }
}

/// Generate the tool usage text for the system prompt.
pub fn tools_prompt_text() -> String {
    let mut text = String::new();
    text.push_str("## Available Tools\n\n");
    text.push_str("You have access to the following tools. Use them via NATIVE FUNCTION CALLING ");
    text.push_str("(your platform's native tool_calls/functionCall interface).\n\n");
    text.push_str("Your platform will handle the tool call format automatically. ");
    text.push_str("You do NOT need to manually write XML or JSON tool call syntax.\n\n");

    for tool in all_tools() {
        text.push_str(&format!("### {}\n{}\n\n", tool.name, tool.description));
        // Show parameters
        text.push_str("Parameters:\n```\n");
        if let Some(props) = tool.parameters.get("properties").and_then(|p| p.as_object()) {
            for (pname, pinfo) in props {
                let desc = pinfo.get("description").and_then(|d| d.as_str()).unwrap_or("");
                if let Some(required) = tool.parameters.get("required").and_then(|r| r.as_array()) {
                    let is_req = required.iter().any(|r| r.as_str() == Some(pname));
                    let req_mark = if is_req { " (required)" } else { " (optional)" };
                    text.push_str(&format!("  {}{}: {}\n", pname, req_mark, desc));
                }
            }
        }
        text.push_str("```\n\n");
    }

    // Tool usage rules
    text.push_str("## Tool Usage Rules\n\n");
    text.push_str("1. **Never guess files.** Use get_project_files or scan_directory_tree first.\n");
    text.push_str("2. **Parallel when independent.** Multiple tools with no dependencies can be called together.\n");
    text.push_str("3. **One at a time when dependent.** If tool B needs tool A's result, wait for A.\n");
    text.push_str("4. **Handle denial gracefully.** If a tool is denied, adjust your approach.\n");
    text.push_str("5. **Prefer dedicated tools.** Use read_file over cat, write_file over echo >.\n");
    text.push_str("6. **Report faithfully.** If tests fail, say so. If something doesn't work, say that.\n");

    text
}
