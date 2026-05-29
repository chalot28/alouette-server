use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

pub mod parser;
pub mod telemetry;
pub mod self_heal;
pub mod memory;
pub mod hooks;
pub mod plan;
pub mod autonomous;
pub mod compaction;

/// Operating modes for the agent harness
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HarnessMode {
    /// Standard interactive agent mode
    Standard,
    /// Plan mode with 5-phase workflow
    Plan,
    /// Coordinator mode for subagent delegation
    Coordinator,
    /// Worker mode executing coordinator tasks
    Worker,
    /// Autonomous loop mode (timer-based)
    Autonomous,
    /// Minimal mode (no hooks, LSP, auto-memory)
    Minimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub session_id: String,
    pub history: Vec<ChatMessage>,
    pub current_thought: Option<String>,
    pub pending_tool: Option<parser::ToolCall>,
    pub mode: HarnessMode,
    pub plan: Option<plan::Plan>,
    pub autonomous_state: Option<autonomous::AutonomousManager>,
}

/// Subagent tracking for coordinator mode
#[derive(Debug, Clone)]
pub struct Subagent {
    pub id: String,
    pub name: String,
    pub description: String,
    pub subagent_type: Option<String>,
    pub status: SubagentStatus,
    pub prompt: String,
    pub result: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SubagentStatus {
    Running,
    Completed,
    Failed(String),
    Stopped,
}

/// Blast radius assessment for action safety
#[derive(Debug, Clone, PartialEq)]
pub enum BlastRadius {
    /// Local, reversible actions (editing files, running tests)
    Local,
    /// Hard to reverse (force push, delete branches, publish)
    Significant,
    /// Outward-facing, affects shared state (PR, Slack, external API)
    Outward,
}

/// The core agent harness - orchestrates AI agent execution
pub struct AgentHarness {
    workspace_root: PathBuf,
    telemetry: telemetry::TelemetryManager,
    memory_manager: memory::MemoryManager,
    hook_manager: Option<hooks::HookManager>,
    mode: HarnessMode,
    subagents: HashMap<String, Subagent>,
}

impl AgentHarness {
    pub fn new<P: AsRef<Path>>(workspace_root: P) -> Self {
        let canonical_root = fs::canonicalize(&workspace_root)
            .unwrap_or_else(|_| workspace_root.as_ref().to_path_buf());
        let telemetry = telemetry::TelemetryManager::new(&canonical_root);
        let memory_manager = memory::MemoryManager::new(&canonical_root);

        Self {
            workspace_root: canonical_root,
            telemetry,
            memory_manager,
            hook_manager: None,
            mode: HarnessMode::Standard,
            subagents: HashMap::new(),
        }
    }

    /// Set the harness operating mode
    pub fn set_mode(&mut self, mode: HarnessMode) {
        self.mode = mode;
    }

    /// Get the current operating mode
    pub fn mode(&self) -> &HarnessMode {
        &self.mode
    }

    /// Initialize hooks from a configuration file
    pub fn init_hooks(&mut self, config_path: &Path) -> Result<(), String> {
        self.hook_manager = Some(hooks::HookManager::from_file(config_path)?);
        Ok(())
    }

    // ─── System Prompt Assembly ───────────────────────────────────────────

    /// Assemble the full system prompt based on the current mode
    pub fn assemble_system_prompt(&self) -> String {
        let mut prompt = String::new();

        // 1. Identity
        prompt.push_str(&self.load_or_default(
            "identity.txt",
            "You are an autonomous AI coding assistant. Always think in a <thought> block before acting."
        ));
        prompt.push_str("\n\n");

        // 2. Software Engineering Focus
        prompt.push_str(&self.get_se_focus_prompt());

        // 3. Communication Style
        prompt.push_str(&self.get_communication_style_prompt());

        // 4. Action Safety
        prompt.push_str(&self.get_action_safety_prompt());

        // 5. Security Guidelines
        prompt.push_str(&self.get_security_prompt());

        // 6. Tool Usage
        prompt.push_str(&self.load_or_default(
            "tools.txt",
            "Available tools: check_port, execute_command, read_file, write_file, get_project_files."
        ));

        // 7. Parallel Tool Calls
        prompt.push_str("\n\n## Parallel Tool Calls\n");
        prompt.push_str("You can call multiple tools in a single response. If there are no dependencies between tool calls, make all independent calls in parallel.");

        // 8. Mode-specific prompts
        match self.mode {
            HarnessMode::Plan => prompt.push_str(&self.get_plan_mode_prompt()),
            HarnessMode::Coordinator => prompt.push_str(&self.get_coordinator_prompt()),
            HarnessMode::Worker => prompt.push_str(&self.get_worker_prompt()),
            HarnessMode::Autonomous => prompt.push_str(&self.get_autonomous_prompt()),
            HarnessMode::Minimal => {
                prompt.push_str("\n\n## Minimal Mode\n");
                prompt.push_str("Running in minimal mode: hooks, LSP, auto-memory, and background features are disabled.");
            }
            HarnessMode::Standard => {}
        }

        // 9. Memory instructions (if not minimal mode)
        if self.mode != HarnessMode::Minimal {
            prompt.push_str(&self.get_memory_prompt());
        }

        // 10. Project context (CLAUDE.md)
        let claude_md_path = self.workspace_root.join("CLAUDE.md");
        if claude_md_path.exists() {
            if let Ok(claude_context) = fs::read_to_string(&claude_md_path) {
                prompt.push_str("\n\n## Project-Specific Guidelines (CLAUDE.md)\n");
                prompt.push_str(&claude_context);
            }
        }

        // 11. Current environment
        let git_branch = self.get_git_branch();
        let git_status = self.get_git_status();

        prompt.push_str(&format!(
            "\n\n## Current Environment\n- OS: {}\n- Workspace: {}\n",
            std::env::consts::OS,
            self.workspace_root.display()
        ));

        if !git_branch.is_empty() {
            prompt.push_str(&format!("- Branch: {}\n", git_branch));
        }
        if !git_status.is_empty() {
            prompt.push_str(&format!("\n## Git Status\n```\n{}\n```\n", git_status));
        }

        // 12. Harness Instructions
        prompt.push_str("\n\n## Harness\n");
        prompt.push_str("- Text outside tool use is displayed as markdown.\n");
        prompt.push_str("- Tools run behind permission checks; a denied call means adjust, don't retry verbatim.\n");
        prompt.push_str("- `<system-reminder>` tags are injected by the harness, not the user.\n");
        prompt.push_str("- Reference code as `file_path:line_number` — it's clickable.\n");

        prompt
    }

    // ─── Mode-Specific Prompts ────────────────────────────────────────────

    fn get_se_focus_prompt(&self) -> String {
        "\n## Software Engineering Focus\nThe user primarily requests software engineering tasks: solving bugs, adding functionality, refactoring, explaining code.\nWhen given unclear instructions, interpret them in code context.\n".to_string()
    }

    fn get_communication_style_prompt(&self) -> String {
        "\n## Communication Style\n- Before your first tool call, state in one sentence what you're about to do.\n- Give short updates at key moments: findings, direction changes, blockers.\n- End-of-turn: one or two sentences. What changed and what's next.\n- Match response format to task complexity — simple questions get direct answers.\n- Default to writing no comments in code. Never write multi-paragraph docstrings.\n".to_string()
    }

    fn get_action_safety_prompt(&self) -> String {
        "\n## Action Safety\n- For hard-to-reverse or outward-facing actions, confirm first unless durably authorized.\n- Before deleting/overwriting, check the target — if it contradicts expectations, surface that.\n- Report outcomes faithfully: if tests fail, say so; if skipped, say that.\n- Destructive operations (rm -rf, force push, git reset --hard) warrant user confirmation.\n- Actions visible to others (push, PR, Slack) affect shared state — confirm first.\n".to_string()
    }

    fn get_security_prompt(&self) -> String {
        "\n## Security\n- Do not introduce security vulnerabilities: command injection, XSS, SQL injection, OWASP top 10.\n- If you notice insecure code, immediately fix it.\n- Prioritize safe, secure, and correct code.\n".to_string()
    }

    fn get_plan_mode_prompt(&self) -> String {
        "\n## Plan Mode (5-Phase)\n\
         You are in plan mode with five phases:\n\
         1. **Research** — Understand the problem, gather requirements, investigate codebase\n\
         2. **Synthesis** — Design solution approach, identify files to change\n\
         3. **Planning** — Write implementation plan with specific steps\n\
         4. **Implementation** — Execute the plan, make changes\n\
         5. **Verification** — Verify changes work (tests, typecheck, manual)\n\n\
         Track progress with clear phase transitions. Only advance when all current phase steps are complete.\n"
        .to_string()
    }

    fn get_coordinator_prompt(&self) -> String {
        "\n## Coordinator Mode\n\
         You orchestrate work across multiple subagents.\n\n\
         **Your Role:**\n\
         - Direct workers to research, implement, and verify\n\
         - Synthesize results and communicate with the user\n\
         - Answer questions directly when possible\n\n\
         **Parallelism is your superpower.** Launch independent workers concurrently.\n\n\
         **Worker Prompts:** Be self-contained. Workers can't see your conversation.\n\
         Always synthesize research findings yourself before directing follow-up work.\n\n\
         **Worker Results** arrive as `<task-notification>` user-role messages.\n\n\
         **Decision: continue vs spawn fresh:**\n\
         - Research explored exactly the files to edit → **Continue** the worker\n\
         - Research was broad but implementation narrow → **Spawn fresh**\n\
         - Correcting failure → **Continue** (worker has error context)\n\
         - Verifying different worker's code → **Spawn fresh** (fresh eyes)\n"
        .to_string()
    }

    fn get_worker_prompt(&self) -> String {
        "\n## Worker Instructions\n\
         You are executing a task assigned by the coordinator.\n\n\
         **Scope:** Complete exactly what was asked. Don't fix unrelated issues.\n\
         - Commit changes with clear messages when done. Only stage files you changed.\n\
         - Do not spawn sub-agents.\n\
         - Limit changes to what your task requires.\n\n\
         **When stuck:**\n\
         - Tool denied? Stop and report what you needed.\n\
         - Task impossible? Stop and explain why.\n\
         - Ambiguous? Pick the most likely interpretation and note your assumption.\n\n\
         **Output structure:**\n\
         1. What you did/found — specific file paths, code snippets\n\
         2. Summary: One sentence the coordinator can relay\n"
        .to_string()
    }

    fn get_autonomous_prompt(&self) -> String {
        "\n## Autonomous Mode\n\
         You are being invoked on a timer while the user is away.\n\n\
         **What to act on:**\n\
         1. In-progress PR: review comments, failing CI, merge conflicts\n\
         2. Unfinished implementation from conversation\n\
         3. Dangling questions or verification steps\n\n\
         **Action Safety:**\n\
         - Reversible actions (local edits, tests): proceed freely\n\
         - Irreversible actions (push, delete): require authorization\n\n\
         **Idle handling:** After 3 consecutive idle ticks, scale back to quick CI check.\n"
        .to_string()
    }

    fn get_memory_prompt(&self) -> String {
        r#"

## Memory

You have a persistent file-based memory system. Each memory is one file holding one fact, with frontmatter:

```markdown
---
name: <short-kebab-case-slug>
description: <one-line summary — used to decide relevance during recall>
metadata:
  type: user | feedback | project | reference
---

<the fact; for feedback/project, follow with **Why:** and **How to apply:** lines>
```

Memory types:
- `user` — who the user is (role, expertise, preferences, working style)
- `feedback` — guidance the user has given on how you should work (corrections and confirmed approaches); include the why
- `project` — ongoing work, goals, or constraints not derivable from the code or git history; convert relative dates to absolute
- `reference` — pointers to external resources (URLs, dashboards, tickets, API docs)

Before saving, check for an existing file that already covers it — update that file rather than creating a duplicate; delete memories that turn out to be wrong.

Do NOT save what the repo already records (code structure, past fixes, git history, CLAUDE.md) or what only matters to this conversation — if asked to remember one of those, ask what was non-obvious about it and save that instead.
"#.to_string()
    }

    // ─── Secure Path Validation ──────────────────────────────────────────

    /// Validate that a path is within the workspace boundary
    pub fn validate_path(&self, target_path: &Path) -> Result<PathBuf, String> {
        let absolute_target = if target_path.is_absolute() {
            target_path.to_path_buf()
        } else {
            self.workspace_root.join(target_path)
        };

        let canonical_target = match fs::canonicalize(&absolute_target) {
            Ok(path) => path,
            Err(_) => {
                // Manual canonicalization fallback
                let mut path = PathBuf::new();
                for component in absolute_target.components() {
                    match component {
                        std::path::Component::ParentDir => { path.pop(); }
                        std::path::Component::Normal(c) => { path.push(c); }
                        std::path::Component::CurDir => {}
                        other => { path.push(other.as_os_str()); }
                    }
                }
                path
            }
        };

        let ws_str = self.workspace_root.to_string_lossy()
            .replace("\\\\?\\", "").to_lowercase();
        let target_str = canonical_target.to_string_lossy()
            .replace("\\\\?\\", "").to_lowercase();

        if target_str.starts_with(&ws_str) {
            Ok(canonical_target)
        } else {
            Err(format!(
                "Security Boundary Error: Access to '{}' is forbidden. Outside workspace '{}'.",
                target_str, ws_str
            ))
        }
    }

    /// Assess blast radius of an action
    pub fn assess_blast_radius(&self, tool_name: &str, arguments: &serde_json::Value) -> BlastRadius {
        match tool_name {
            "write_file" | "edit_file" | "execute_command" | "check_port" => BlastRadius::Local,
            "get_project_files" | "read_file" => BlastRadius::Local,
            "delete_file" | "force_push" | "git_reset" => {
                // Check if arguments indicate destructive operation
                let is_destructive = arguments.get("force").and_then(|v| v.as_bool()).unwrap_or(false)
                    || arguments.get("hard").and_then(|v| v.as_bool()).unwrap_or(false);
                if is_destructive {
                    BlastRadius::Significant
                } else {
                    BlastRadius::Local
                }
            }
            "create_pr" | "post_message" | "push_code" | "deploy" => BlastRadius::Outward,
            _ => BlastRadius::Local,
        }
    }

    // ─── Tool Execution ──────────────────────────────────────────────────

    /// Execute a tool call safely with hook lifecycle and telemetry
    pub async fn execute_tool(
        &mut self,
        session_id: &str,
        tool: &parser::ToolCall,
    ) -> Result<String, String> {
        let start_time = std::time::Instant::now();
        let mut exit_status = "Success";

        // 1. Execute PreToolUse hooks
        if let Some(ref hook_manager) = self.hook_manager {
            let hook_input = hooks::HookInput {
                session_id: session_id.to_string(),
                tool_name: tool.name.clone(),
                tool_input: tool.arguments.clone(),
                tool_response: None,
            };
            let hook_outputs = hook_manager.execute_hooks(
                &hooks::HookEvent::PreToolUse,
                &tool.name,
                &hook_input,
            );
            if let Some(block_reason) = hook_manager.should_block(&hook_outputs) {
                return Err(format!("PreToolUse hook blocked: {}", block_reason));
            }
        }

        // 2. Assess blast radius
        let radius = self.assess_blast_radius(&tool.name, &tool.arguments);

        // 3. Execute the tool
        let result = match tool.name.as_str() {
            "check_port" => self.execute_check_port(tool),
            "read_file" => self.execute_read_file(tool),
            "write_file" => self.execute_write_file(tool),
            "get_project_files" => self.execute_get_project_files(),
            "execute_command" => self.execute_command(tool),
            "save_memory" => self.execute_save_memory(tool),
            "search_memory" => self.execute_search_memory(tool),
            "compact_history" => self.execute_compact_history(tool),
            _ => Err(format!("Unknown tool: {}", tool.name)),
        };

        let duration = start_time.elapsed().as_millis() as u64;
        let result_str = match &result {
            Ok(val) => val.clone(),
            Err(e) => {
                exit_status = "Failure";
                e.clone()
            }
        };

        // 4. Track telemetry
        self.telemetry.track_tool_call(
            session_id,
            &tool.name,
            exit_status == "Success",
            duration,
            None,
        );

        // 5. Execute PostToolUse hooks
        if let Some(ref hook_manager) = self.hook_manager {
            let hook_input = hooks::HookInput {
                session_id: session_id.to_string(),
                tool_name: tool.name.clone(),
                tool_input: tool.arguments.clone(),
                tool_response: Some(serde_json::json!({
                    "success": exit_status == "Success",
                    "result": result_str,
                    "duration_ms": duration,
                    "blast_radius": format!("{:?}", radius),
                })),
            };
            let event = if exit_status == "Success" {
                hooks::HookEvent::PostToolUse
            } else {
                hooks::HookEvent::PostToolUseFailure
            };
            let hook_outputs = hook_manager.execute_hooks(&event, &tool.name, &hook_input);
            if let Some(block_reason) = hook_manager.should_block(&hook_outputs) {
                return Err(format!("PostToolUse hook blocked: {}", block_reason));
            }
        }

        // 6. Self-heal if failed
        if exit_status == "Failure" {
            let healed = self_heal::SelfHealAnalyzer::analyze_failure(
                &tool.name, &tool.arguments, &result_str,
            );
            Err(healed)
        } else {
            result
        }
    }

    fn execute_check_port(&self, tool: &parser::ToolCall) -> Result<String, String> {
        let port = tool.arguments["port"]
            .as_u64()
            .ok_or_else(|| "Missing 'port' argument".to_string())? as u16;

        let is_available = std::net::TcpListener::bind(("127.0.0.1", port)).is_ok();
        if is_available {
            Ok(format!("✓ Port {} is FREE and available.", port))
        } else {
            Ok(format!("✕ Port {} is IN USE.", port))
        }
    }

    fn execute_read_file(&self, tool: &parser::ToolCall) -> Result<String, String> {
        let path_str = tool.arguments["path"]
            .as_str()
            .ok_or_else(|| "Missing 'path' argument".to_string())?;

        let target_path = Path::new(path_str);
        let verified_path = self.validate_path(target_path)?;

        fs::read_to_string(&verified_path)
            .map_err(|e| format!("Failed to read file: {}", e))
    }

    fn execute_write_file(&self, tool: &parser::ToolCall) -> Result<String, String> {
        let path_str = tool.arguments["path"]
            .as_str()
            .ok_or_else(|| "Missing 'path' argument".to_string())?;
        let content = tool.arguments["content"]
            .as_str()
            .ok_or_else(|| "Missing 'content' argument".to_string())?;

        let target_path = Path::new(path_str);
        let verified_path = self.validate_path(target_path)?;

        if let Some(parent) = verified_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        fs::write(&verified_path, content)
            .map(|_| format!("✓ Wrote {} bytes to: {}", content.len(), path_str))
            .map_err(|e| format!("Failed to write file: {}", e))
    }

    fn execute_get_project_files(&self) -> Result<String, String> {
        let mut files = Vec::new();
        self.list_dir_recursive(&self.workspace_root, &mut files)?;
        Ok(files.join("\n"))
    }

    fn execute_command(&self, tool: &parser::ToolCall) -> Result<String, String> {
        let command = tool.arguments["command"]
            .as_str()
            .ok_or_else(|| "Missing 'command' argument".to_string())?;

        let args: Vec<String> = if let Some(arr) = tool.arguments["args"].as_array() {
            arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
        } else {
            Vec::new()
        };

        let output = if cfg!(target_os = "windows") {
            std::process::Command::new("powershell")
                .args(&["-Command"])
                .arg(format!("{} {}", command, args.join(" ")))
                .output()
        } else {
            std::process::Command::new("sh")
                .arg("-c")
                .arg(format!("{} {}", command, args.join(" ")))
                .output()
        };

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                let code = out.status.code().unwrap_or(-1);
                Ok(format!("Exit Code: {}\nSTDOUT:\n{}\nSTDERR:\n{}", code, stdout, stderr))
            }
            Err(e) => Err(format!("Failed to execute command: {}", e)),
        }
    }

    fn execute_save_memory(&self, tool: &parser::ToolCall) -> Result<String, String> {
        let name = tool.arguments["name"].as_str()
            .ok_or_else(|| "Missing 'name' argument".to_string())?;
        let description = tool.arguments["description"].as_str()
            .unwrap_or("Memory entry");
        let mem_type = match tool.arguments["type"].as_str().unwrap_or("reference") {
            "user" => memory::MemoryType::User,
            "feedback" => memory::MemoryType::Feedback,
            "project" => memory::MemoryType::Project,
            _ => memory::MemoryType::Reference,
        };
        let content = tool.arguments["content"].as_str()
            .ok_or_else(|| "Missing 'content' argument".to_string())?;

        let path = self.memory_manager.save_memory(name, description, mem_type, content)?;
        Ok(format!("✓ Memory saved: {}", path.display()))
    }

    fn execute_search_memory(&self, tool: &parser::ToolCall) -> Result<String, String> {
        let query = tool.arguments["query"].as_str()
            .ok_or_else(|| "Missing 'query' argument".to_string())?;

        let results = self.memory_manager.search_memories(query);
        if results.is_empty() {
            return Ok("No memories found matching query.".to_string());
        }

        let mut output = format!("Found {} memory results for '{}':\n", results.len(), query);
        for mem in &results {
            output.push_str(&format!("\n---\n**{}** ({:?})\n", mem.name, mem.metadata.mem_type));
            output.push_str(&format!("_{}_\n", mem.description));
            output.push_str(&format!("{}\n", mem.content.lines().take(3).collect::<Vec<_>>().join("\n")));
        }
        Ok(output)
    }

    fn execute_compact_history(&self, _tool: &parser::ToolCall) -> Result<String, String> {
        Ok("History compaction requested. Use compaction::CompactionManager for structured summaries.".to_string())
    }

    // ─── Subagent Management ─────────────────────────────────────────────

    /// Spawn a subagent for coordinator mode
    pub fn spawn_subagent(
        &mut self,
        id: &str,
        name: &str,
        description: &str,
        subagent_type: Option<String>,
        prompt: &str,
    ) {
        self.subagents.insert(id.to_string(), Subagent {
            id: id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            subagent_type,
            status: SubagentStatus::Running,
            prompt: prompt.to_string(),
            result: None,
        });
    }

    /// Mark a subagent as completed with result
    pub fn complete_subagent(&mut self, id: &str, result: String) -> Result<(), String> {
        if let Some(agent) = self.subagents.get_mut(id) {
            agent.status = SubagentStatus::Completed;
            agent.result = Some(result);
            Ok(())
        } else {
            Err(format!("Subagent '{}' not found", id))
        }
    }

    /// Mark a subagent as failed
    pub fn fail_subagent(&mut self, id: &str, error: String) -> Result<(), String> {
        if let Some(agent) = self.subagents.get_mut(id) {
            agent.status = SubagentStatus::Failed(error);
            Ok(())
        } else {
            Err(format!("Subagent '{}' not found", id))
        }
    }

    /// Get status of all subagents
    pub fn subagent_statuses(&self) -> Vec<&Subagent> {
        self.subagents.values().collect()
    }

    // ─── Plan Mode ───────────────────────────────────────────────────────

    /// Create a new plan
    pub fn create_plan(&mut self, title: &str) -> plan::Plan {
        plan::Plan::new(title)
    }

    // ─── Memory Management ───────────────────────────────────────────────

    pub fn memory_manager(&self) -> &memory::MemoryManager {
        &self.memory_manager
    }

    // ─── Telemetry ───────────────────────────────────────────────────────

    pub fn get_performance_metrics(&self, session_id: &str) -> telemetry::PerformanceMetrics {
        self.telemetry.get_metrics(session_id)
    }

    pub fn get_aggregate_metrics(&self) -> telemetry::PerformanceMetrics {
        self.telemetry.get_aggregate_metrics()
    }

    // ─── History Compaction ──────────────────────────────────────────────

    pub fn compact_history(history: &mut Vec<ChatMessage>, max_messages: usize) {
        if history.len() <= max_messages {
            return;
        }
        let mut compacted = Vec::new();
        if !history.is_empty() {
            compacted.push(history[0].clone());
        }
        let keep_start = history.len() - (max_messages - 1);
        compacted.extend(history[keep_start..].iter().cloned());
        *history = compacted;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    fn load_or_default(&self, filename: &str, default: &str) -> String {
        let path = self.workspace_root
            .join("core_engine/src/agent_harness/prompts")
            .join(filename);
        fs::read_to_string(&path).unwrap_or_else(|_| default.to_string())
    }

    fn get_git_branch(&self) -> String {
        let output = std::process::Command::new("git")
            .args(&["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&self.workspace_root)
            .output();
        if let Ok(out) = output {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            String::new()
        }
    }

    fn get_git_status(&self) -> String {
        let output = std::process::Command::new("git")
            .args(&["status", "--short"])
            .current_dir(&self.workspace_root)
            .output();
        if let Ok(out) = output {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            String::new()
        }
    }

    fn list_dir_recursive(&self, dir: &Path, files: &mut Vec<String>) -> Result<(), String> {
        if dir.is_dir() {
            for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();

                if let Some(name) = path.file_name() {
                    let name_str = name.to_string_lossy();
                    if name_str == ".git" || name_str == ".idea" || name_str == "target"
                        || name_str == "node_modules" || name_str == "logs"
                    {
                        continue;
                    }
                }

                if path.is_dir() {
                    self.list_dir_recursive(&path, files)?;
                } else {
                    if let Ok(rel) = path.strip_prefix(&self.workspace_root) {
                        files.push(rel.display().to_string());
                    }
                }
            }
        }
        Ok(())
    }
}
