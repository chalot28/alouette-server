use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::future::Future;
use tokio::io::AsyncBufReadExt;
use tokio::sync::Mutex;

pub mod parser;
pub mod telemetry;
pub mod self_heal;
pub mod memory;
pub mod hooks;
pub mod plan;
pub mod autonomous;
pub mod compaction;
pub mod skills;
pub mod tool_definitions;

// ─── Agent Loop Types ─────────────────────────────────────────────────

/// Kết quả của một vòng lặp agent hoàn chỉnh
#[derive(Debug, Clone, Serialize)]
pub struct AgentLoopResult {
    pub session_id: String,
    pub iterations: Vec<AgentLoopIteration>,
    pub final_text: Option<String>,
    pub total_iterations: u32,
    pub tool_calls_made: u32,
    pub stopped_early: bool,
    pub stop_reason: Option<String>,
}

/// Một lần lặp trong vòng lặp agent
#[derive(Debug, Clone, Serialize)]
pub struct AgentLoopIteration {
    pub iteration: u32,
    pub thought: Option<String>,
    pub tool_name: Option<String>,
    pub tool_args: Option<String>,
    pub tool_result: Option<String>,
    pub tool_success: bool,
    pub timestamp: String,
}

/// Dual-verification completion phases
#[derive(Debug, Clone, PartialEq)]
enum CompletionPhase {
    Active,       // Đang làm việc bình thường
    FirstCheck,   // Đã hỏi "done?" lần 1, chờ AI trả lời
    SecondCheck,  // Đã hỏi "chắc chưa?" lần 2, chờ xác nhận cuối
    FinalCheck,   // Đợi FINAL_CONFIRMATION
}

impl CompletionPhase {
    fn as_str(&self) -> &'static str {
        match self {
            CompletionPhase::Active => "active",
            CompletionPhase::FirstCheck => "first-check",
            CompletionPhase::SecondCheck => "second-check",
            CompletionPhase::FinalCheck => "final-check",
        }
    }
}

/// Cấu hình cho vòng lặp agent
#[derive(Debug, Clone)]
pub struct AgentLoopConfig {
    pub max_iterations: u32,
    pub auto_approve_reads: bool,
    pub auto_approve_writes: bool,
    pub auto_approve_all: bool,
    pub command_timeout_secs: u64,
    pub session_id: String,
}

impl Default for AgentLoopConfig {
    fn default() -> Self {
        Self {
            max_iterations: 25,
            auto_approve_reads: true,
            auto_approve_writes: false,
            auto_approve_all: false,
            command_timeout_secs: 120,
            session_id: String::new(),
        }
    }
}

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
/// Tracks a long-running terminal command that exceeded the 20s timeout
struct RunningCommand {
    child: tokio::process::Child,
    output: Arc<Mutex<String>>,
    stderr_output: Arc<Mutex<String>>,
    stdout_handle: Option<tokio::task::JoinHandle<()>>,
    stderr_handle: Option<tokio::task::JoinHandle<()>>,
    start_time: std::time::Instant,
    command: String,
}

pub struct AgentHarness {
    workspace_root: PathBuf,
    telemetry: telemetry::TelemetryManager,
    memory_manager: memory::MemoryManager,
    hook_manager: Option<hooks::HookManager>,
    skill_engine: skills::SkillEngine,
    mode: HarnessMode,
    command_timeout_secs: u64,
    subagents: HashMap<String, Subagent>,
    running_commands: HashMap<String, RunningCommand>,
}

impl AgentHarness {
    pub fn new<P: AsRef<Path>>(workspace_root: P) -> Self {
        let canonical_root = fs::canonicalize(&workspace_root)
            .unwrap_or_else(|_| workspace_root.as_ref().to_path_buf());
        let telemetry = telemetry::TelemetryManager::new(&canonical_root);
        let memory_manager = memory::MemoryManager::new(&canonical_root);

        let skill_engine = skills::SkillEngine::new(canonical_root.clone());
        Self {
            workspace_root: canonical_root,
            telemetry,
            memory_manager,
            skill_engine,
            hook_manager: None,
            mode: HarnessMode::Standard,
            command_timeout_secs: 120,
            subagents: HashMap::new(),
            running_commands: HashMap::new(),
        }
    }

    /// Set the harness operating mode
    pub fn set_mode(&mut self, mode: HarnessMode) {
        self.mode = mode;
    }

    /// Set command execution timeout (seconds)
    pub fn set_command_timeout(&mut self, timeout_secs: u64) {
        self.command_timeout_secs = timeout_secs;
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

        // 6. Tool Usage (generated from tool_definitions)
        prompt.push_str(&tool_definitions::tools_prompt_text());

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
            "execute_command" => self.execute_command(session_id, tool).await,
            "check_command_status" => self.execute_check_command_status(tool),
            "save_memory" => self.execute_save_memory(tool),
            "search_memory" => self.execute_search_memory(tool),
            "compact_history" => self.execute_compact_history(tool),
            // Skill tools
            "scan_directory_tree" => Ok(self.skill_engine.scan_directory_tree().tree_string),
            "scan_subdirectory" => self.execute_scan_subdirectory(tool),
            "search_files" => self.execute_search_files(tool),
            "extract_symbol" => self.execute_extract_symbol(tool),
            "read_file_range" => self.execute_read_file_range(tool),
            "search_symbol" => self.execute_search_symbol(tool),
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

    async fn execute_command(&mut self, session_id: &str, tool: &parser::ToolCall) -> Result<String, String> {
        let command = tool.arguments["command"]
            .as_str()
            .ok_or_else(|| "Missing 'command' argument".to_string())?;

        let args: Vec<String> = if let Some(arr) = tool.arguments["args"].as_array() {
            arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
        } else {
            Vec::new()
        };

        let cmd_str = format!("{} {}", command, args.join(" "));

        // Build async command
        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = tokio::process::Command::new("powershell");
            c.args(&["-Command"]);
            c.arg(&cmd_str);
            c
        } else {
            let mut c = tokio::process::Command::new("sh");
            c.arg("-c");
            c.arg(&cmd_str);
            c
        };

        let mut child = cmd
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn command: {}", e))?;

        let stdout = child.stdout.take()
            .ok_or_else(|| "Failed to capture stdout".to_string())?;
        let stderr = child.stderr.take()
            .ok_or_else(|| "Failed to capture stderr".to_string())?;

        let output = Arc::new(Mutex::new(String::new()));
        let stderr_output = Arc::new(Mutex::new(String::new()));

        // Background tasks to stream stdout/stderr
        let out_clone = output.clone();
        let stdout_handle = tokio::spawn(async move {
            let reader = tokio::io::BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut out = out_clone.lock().await;
                out.push_str(&line);
                out.push('\n');
            }
        });

        let err_clone = stderr_output.clone();
        let stderr_handle = tokio::spawn(async move {
            let reader = tokio::io::BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut out = err_clone.lock().await;
                out.push_str(&line);
                out.push('\n');
            }
        });

        let cmd_id = format!("cmd_{}_{}", session_id, chrono::Local::now().timestamp_millis());
        let timeout_secs = self.command_timeout_secs;

        // Wait for completion with configurable timeout
        match tokio::time::timeout(Duration::from_secs(timeout_secs), child.wait()).await {
            Ok(Ok(status)) => {
                // Command completed in time
                let _ = stdout_handle.await;
                let _ = stderr_handle.await;
                let stdout_text = output.lock().await.clone();
                let stderr_text = stderr_output.lock().await.clone();
                let code = status.code().unwrap_or(-1);
                Ok(format!("Exit Code: {}\nSTDOUT:\n{}\nSTDERR:\n{}", code, stdout_text, stderr_text))
            }
            Ok(Err(e)) => {
                let _ = child.kill().await;
                Err(format!("Command failed: {}", e))
            }
            Err(_timeout) => {
                // 20s timeout → store command for polling
                let partial = output.lock().await.clone();
                self.running_commands.insert(cmd_id.clone(), RunningCommand {
                    child,
                    output: output.clone(),
                    stderr_output: stderr_output.clone(),
                    stdout_handle: Some(stdout_handle),
                    stderr_handle: Some(stderr_handle),
                    start_time: std::time::Instant::now(),
                    command: cmd_str.clone(),
                });

                Ok(format!(
                    "COMMAND_STILL_RUNNING\nCommand ID: {}\nCommand: {}\nThe command is still running after {} seconds.\nUse `check_command_status` with the Command ID to check if it has finished.\n\nPartial output so far:\n{}",
                    cmd_id, cmd_str, timeout_secs, partial
                ))
            }
        }
    }

    /// Check the status of a long-running command that was started with execute_command
    fn execute_check_command_status(&mut self, tool: &parser::ToolCall) -> Result<String, String> {
        let cmd_id = tool.arguments["command_id"]
            .as_str()
            .ok_or_else(|| "Missing 'command_id' argument".to_string())?;

        // Helper to block_on async operations with fallback for non-tokio contexts
        fn block_fut<F: std::future::Future<Output = T>, T>(f: F) -> T {
            match tokio::runtime::Handle::try_current() {
                Ok(handle) => handle.block_on(f),
                Err(_) => {
                    // Fallback: create a temporary single-threaded runtime
                    let rt = tokio::runtime::Builder::new_current_thread()
                        .enable_time()
                        .build()
                        .expect("Failed to create fallback tokio runtime for check_command_status");
                    rt.block_on(f)
                }
            }
        }

        let running = self.running_commands.get_mut(cmd_id)
            .ok_or_else(|| format!("No running command found with ID: '{}'. It may have already completed or expired.", cmd_id))?;

        let elapsed = running.start_time.elapsed().as_secs();

        match running.child.try_wait() {
            Ok(Some(status)) => {
                // Command has finished
                if let Some(h) = running.stdout_handle.take() {
                    let _ = block_fut(h);
                }
                if let Some(h) = running.stderr_handle.take() {
                    let _ = block_fut(h);
                }
                let stdout_text = block_fut(running.output.lock()).clone();
                let stderr_text = block_fut(running.stderr_output.lock()).clone();
                let code = status.code().unwrap_or(-1);

                self.running_commands.remove(cmd_id);

                Ok(format!("COMMAND_COMPLETED\nExit Code: {}\nSTDOUT:\n{}\nSTDERR:\n{}", code, stdout_text, stderr_text))
            }
            Ok(None) => {
                // Still running
                let partial = block_fut(running.output.lock()).clone();
                let wait_time = (elapsed as f64 * 2.0).min(300.0) as u64; // exponential backoff, max 5 min
                Ok(format!(
                    "COMMAND_STILL_RUNNING\nCommand ID: {}\nCommand: {}\nElapsed: {}s\nThe command is still running. Try again in about {}s.\n\nPartial output so far:\n{}",
                    cmd_id, running.command, elapsed, wait_time, partial
                ))
            }
            Err(e) => {
                self.running_commands.remove(cmd_id);
                Err(format!("Failed to check command status: {}", e))
            }
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

    // ─── Skill Tool Executions ───────────────────────────────────────────

    fn execute_scan_subdirectory(&self, tool: &parser::ToolCall) -> Result<String, String> {
        let path = tool.arguments["path"].as_str()
            .ok_or_else(|| "Missing 'path' argument".to_string())?;
        let tree = self.skill_engine.scan_subdirectory(path)?;
        Ok(tree.tree_string)
    }

    fn execute_search_files(&self, tool: &parser::ToolCall) -> Result<String, String> {
        let pattern = tool.arguments["pattern"].as_str()
            .or_else(|| tool.arguments["query"].as_str())
            .ok_or_else(|| "Missing 'pattern' argument".to_string())?;

        let result = self.skill_engine.search_files(pattern);
        if result.matches.is_empty() {
            return Ok(format!("📁 No files found matching '{}'", pattern));
        }

        let mut output = format!("📁 Found {} file(s) matching '{}':\n\n", result.total, pattern);
        for (i, path) in result.matches.iter().enumerate() {
            output.push_str(&format!("  {}. {}\n", i + 1, path.display()));
        }
        output.push_str(&format!("\n--- {} file(s) total ---", result.total));
        Ok(output)
    }

    fn execute_extract_symbol(&self, tool: &parser::ToolCall) -> Result<String, String> {
        let file = tool.arguments["file"].as_str()
            .ok_or_else(|| "Missing 'file' argument".to_string())?;
        let symbol = tool.arguments["symbol"].as_str()
            .or_else(|| tool.arguments["name"].as_str())
            .ok_or_else(|| "Missing 'symbol' argument".to_string())?;

        let extraction = self.skill_engine.extract_symbol(file, symbol)?;

        let mut output = String::new();
        output.push_str(&format!(
            "📖 Symbol: **{}** ({}) | File: `{}` | Lines {}-{}\n\n",
            extraction.symbol,
            extraction.symbol_type.unwrap_or_else(|| "unknown".to_string()),
            extraction.file.display(),
            extraction.start_line,
            extraction.end_line
        ));

        // Context before
        if !extraction.context_before.is_empty() {
            output.push_str("Context before:\n");
            for line in extraction.context_before.lines() {
                output.push_str(&format!("  {}\n", line));
            }
            output.push('\n');
        }

        // The actual code block
        output.push_str("```\n");
        // Add line numbers
        for (i, line) in extraction.code_block.lines().enumerate() {
            let line_num = extraction.start_line + i;
            output.push_str(&format!("{:>6} | {}\n", line_num, line));
        }
        output.push_str("```\n");

        output.push_str(&format!("\n--- Extracted {} lines ({}:{}-{}) ---",
            extraction.code_block.lines().count(),
            extraction.file.display(),
            extraction.start_line,
            extraction.end_line
        ));
        Ok(output)
    }

    fn execute_read_file_range(&self, tool: &parser::ToolCall) -> Result<String, String> {
        let file = tool.arguments["file"].as_str()
            .ok_or_else(|| "Missing 'file' argument".to_string())?;
        let start = tool.arguments["start_line"].as_u64()
            .ok_or_else(|| "Missing 'start_line' argument".to_string())? as usize;
        let end = tool.arguments["end_line"].as_u64()
            .ok_or_else(|| "Missing 'end_line' argument".to_string())? as usize;

        self.skill_engine.read_file_range(file, start, end)
    }

    fn execute_search_symbol(&self, tool: &parser::ToolCall) -> Result<String, String> {
        let symbol = tool.arguments["symbol"].as_str()
            .or_else(|| tool.arguments["name"].as_str())
            .ok_or_else(|| "Missing 'symbol' argument".to_string())?;

        let results = self.skill_engine.search_symbol_across_project(symbol);
        if results.is_empty() {
            return Ok(format!("🔍 Symbol '{}' not found anywhere in project.", symbol));
        }

        let mut output = format!("🔍 Found symbol **'{}'** in {} file(s):\n\n", symbol, results.len());
        for (i, (path, line_num, line_text)) in results.iter().enumerate() {
            output.push_str(&format!("  {}. `{}:{}` → {}\n",
                i + 1,
                path.display(),
                line_num,
                line_text
            ));
        }
        output.push_str(&format!("\nUse `extract_symbol` with the file path and symbol name to see the full definition."));
        Ok(output)
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

    // ─── Agent Loop Engine (Enterprise 2026) ────────────────────────────
    //
    // Kiến trúc vòng lặp cải tiến:
    //   1. Multi-strategy parser (OpenAI JSON → XML → ReAct → Isolated JSON)
    //   2. Parallel tool call execution
    //   3. Dual-verification: sau khi AI báo "done" → hỏi lại lần 2 "chắc chưa?"
    //   4. Structured final report với verification bắt buộc
    //
    /// Chạy vòng lặp agent hoàn chỉnh: think → act → observe → repeat
    /// Cho đến khi LLM trả về text response (không phải tool call)
    /// hoặc đạt max_iterations.
    ///
    /// `llm_call_fn` là async closure nhận (system_prompt, history) và trả về LLM response string.
    /// `on_iteration_fn` là callback để emit sự kiện real-time ra UI.
    pub async fn run_agent_loop<F1, Fut1, F2>(
        &mut self,
        system_prompt: &str,
        history: &mut Vec<ChatMessage>,
        config: AgentLoopConfig,
        llm_call_fn: F1,
        on_iteration_fn: Option<F2>,
    ) -> AgentLoopResult
    where
        F1: Fn(String, Vec<ChatMessage>) -> Fut1,
        Fut1: Future<Output = Result<String, String>>,
        F2: Fn(AgentLoopIteration),
    {
        let mut iterations = Vec::new();
        let mut tool_calls_made = 0u32;
        let mut stopped_early = false;
        let mut stop_reason: Option<String> = None;
        let mut final_text: Option<String> = None;
        let mut completion_phase: CompletionPhase = CompletionPhase::Active;
        let session_id = config.session_id.clone();

        // Apply command timeout from config
        self.command_timeout_secs = config.command_timeout_secs;

        // ─── MAIN LOOP ───────────────────────────────────────────────
        for iteration in 0..config.max_iterations {
            // 1. Compact history nếu quá dài (>80 msgs → giữ 40 gần nhất)
            let max_msgs = if history.len() > 80 { 40 } else { 80 };
            Self::compact_history(history, max_msgs);

            // 2. Gọi LLM
            let llm_reply = match llm_call_fn(
                system_prompt.to_string(),
                history.clone(),
            ).await {
                Ok(reply) => reply,
                Err(e) => {
                    stop_reason = Some(format!("LLM call failed: {}", e));
                    stopped_early = true;
                    break;
                }
            };

            // 3. Parse response (multi-strategy)
            let parsed = parser::parse_model_response(&llm_reply);

            let iteration_record = AgentLoopIteration {
                iteration: (iteration + 1) as u32,
                thought: parsed.thought.clone(),
                tool_name: None,
                tool_args: None,
                tool_result: None,
                tool_success: false,
                timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
            };

            // ─── PATH A: TOOL CALL(S) ──────────────────────────────────
            // Hỗ trợ cả single tool_call (backward compat) và tool_calls (parallel)
            let all_tools = if !parsed.tool_calls.is_empty() {
                parsed.tool_calls.clone()
            } else if let Some(ref tc) = parsed.tool_call {
                vec![tc.clone()]
            } else {
                vec![]
            };

            if !all_tools.is_empty() {
                tool_calls_made += all_tools.len() as u32;
                let mut all_results = Vec::new();

                for tool in &all_tools {
                    // Auto-approve check
                    let is_read_tool = matches!(tool.name.as_str(),
                        "check_port" | "read_file" | "get_project_files"
                        | "scan_directory_tree" | "scan_subdirectory"
                        | "search_files" | "extract_symbol" | "read_file_range"
                        | "search_symbol" | "search_memory"
                    );
                    let is_write_tool = matches!(tool.name.as_str(),
                        "write_file" | "save_memory"
                    );

                    let can_execute = config.auto_approve_all
                        || (config.auto_approve_reads && is_read_tool)
                        || (config.auto_approve_writes && (is_read_tool || is_write_tool));

                    if !can_execute {
                        // Dừng vòng lặp, chờ user approve
                        iterations.push(AgentLoopIteration {
                            tool_name: Some(tool.name.clone()),
                            tool_args: Some(tool.arguments.to_string()),
                            ..iteration_record.clone()
                        });
                        stop_reason = Some(format!("Tool '{}' needs user approval", tool.name));
                        stopped_early = true;
                        // Return sớm với kết quả partial
                        return AgentLoopResult {
                            session_id,
                            iterations,
                            final_text: None,
                            total_iterations: (iteration + 1) as u32,
                            tool_calls_made,
                            stopped_early,
                            stop_reason,
                        };
                    }

                    // Execute tool
                    let tool_result = self.execute_tool(&session_id, tool).await;
                    let (result_text, success) = match tool_result {
                        Ok(r) => (r, true),
                        Err(e) => (e, false),
                    };

                    // Ghi result
                    iterations.push(AgentLoopIteration {
                        tool_name: Some(tool.name.clone()),
                        tool_args: Some(tool.arguments.to_string()),
                        tool_result: Some(result_text.clone()),
                        tool_success: success,
                        ..iteration_record.clone()
                    });

                    // Callback real-time
                    if let Some(ref cb) = on_iteration_fn {
                        cb(iterations.last().unwrap().clone());
                    }

                    all_results.push((tool.name.clone(), result_text, success, tool.call_id.clone()));
                }

                // Feed ALL results to history using proper tool role messages
                for (_tname, tresult, tsuccess, tcall_id) in &all_results {
                    let call_id = tcall_id.as_deref().unwrap_or("unknown");
                    let tool_result = json!({
                        "result": tresult,
                        "success": tsuccess,
                        "tool_call_id": call_id
                    });
                    history.push(ChatMessage {
                        id: call_id.to_string(),
                        role: "tool".to_string(),
                        content: tool_result.to_string(),
                        timestamp: chrono::Local::now().format("%H:%M").to_string(),
                    });
                }

                // ─── COMPLETION CHECK (sau MỌI tool call) ───────────
                // Sau bất kỳ tool call nào (read hay write), hỏi AI xem đã xong chưa
                let had_write_or_cmd = all_results.iter().any(|(name, _, _, _)| {
                    matches!(name.as_str(), "write_file" | "save_memory" | "execute_command")
                });

                if had_write_or_cmd {
                    // Tool write/command → hỏi completion
                    history.push(ChatMessage {
                        id: format!("sys_chk_{}", chrono::Local::now().timestamp_millis()),
                        role: "system".to_string(),
                        content: format!(
                            "<system-reminder>Task progress check (phase: {}): Have you completed ALL required steps for this task?\n\nRespond with:\n- **YES, DONE** → if the task is fully complete and verified\n- **CONTINUE** → if more work is needed, with the next tool call\n\nDo NOT say done unless every required change, test, and verification is complete.</system-reminder>",
                            completion_phase.as_str()
                        ),
                        timestamp: chrono::Local::now().format("%H:%M").to_string(),
                    });
                    completion_phase = CompletionPhase::FirstCheck;
                } else {
                    // Read-only tools → không cần check, chỉ reset phase
                    completion_phase = CompletionPhase::Active;
                }

                // Continue loop
                continue;
            }

            // ─── PATH B: TEXT RESPONSE (no tool calls) ─────────────────
            let text = parsed.plain_text.unwrap_or_else(|| {
                "Task completed.".to_string()
            });

            // Ghi text vào history
            history.push(ChatMessage {
                id: format!("model_{}", chrono::Local::now().timestamp_millis()),
                role: "model".to_string(),
                content: text.clone(),
                timestamp: chrono::Local::now().format("%H:%M").to_string(),
            });

            match completion_phase {
                CompletionPhase::FirstCheck => {
                    // ─── PHASE 1: AI vừa xác nhận "done" lần đầu ───
                    // → DUAL-VERIFICATION: Hỏi lại lần 2 "CHẮC CHƯA?"
                    let is_confirming = text.to_lowercase().contains("yes")
                        || text.to_lowercase().contains("done")
                        || text.to_lowercase().contains("complete")
                        || text.to_lowercase().contains("xong")
                        || text.to_lowercase().contains("hoàn thành");

                    if is_confirming {
                        // Inject câu hỏi xác nhận lần 2
                        history.push(ChatMessage {
                            id: format!("sys_dual_{}", chrono::Local::now().timestamp_millis()),
                            role: "system".to_string(),
                            content: "<system-reminder>CONFIRMATION REQUIRED: You indicated the task is complete. Before finalizing:\n\n1. **Re-check**: Are you ABSOLUTELY certain every required change has been made?\n2. **Missing anything?**: Are there any verification steps, edge cases, or documentation you may have overlooked?\n3. **Double-check files**: Did you actually read and verify every file you modified?\n\nIf yes — reply **FINAL_CONFIRMATION: YES** with a structured summary.\nIf no — state what's missing and make the appropriate tool call.</system-reminder>".to_string(),
                            timestamp: chrono::Local::now().format("%H:%M").to_string(),
                        });

                        // Gọi LLM để lấy xác nhận lần 2
                        let confirm_reply = match llm_call_fn(
                            system_prompt.to_string(),
                            history.clone(),
                        ).await {
                            Ok(reply) => reply,
                            Err(e) => {
                                stop_reason = Some(format!("Confirmation check failed: {}", e));
                                stopped_early = true;
                                final_text = Some(text);
                                break;
                            }
                        };

                        let confirm_parsed = parser::parse_model_response(&confirm_reply);

                        // Nếu AI trả tool call → nó thấy còn thiếu, quay lại loop
                        if !confirm_parsed.tool_calls.is_empty() || confirm_parsed.tool_call.is_some() {
                            let new_tools = if !confirm_parsed.tool_calls.is_empty() {
                                confirm_parsed.tool_calls
                            } else {
                                vec![confirm_parsed.tool_call.unwrap()]
                            };

                            history.push(ChatMessage {
                                id: format!("model_dual_{}", chrono::Local::now().timestamp_millis()),
                                role: "model".to_string(),
                                content: confirm_reply,
                                timestamp: chrono::Local::now().format("%H:%M").to_string(),
                            });

                            // Quay lại execution (dùng continue để loop xử lý tool)
                            // Inject tool calls vào parsed để loop xử lý ở iteration tiếp theo
                            // Thực tế: thêm vào history và continue loop
                            // Loop sẽ được xử lý ở iteration sau với tool call mới
                            // (Cần 1 iteration nữa để parse và execute)
                            // Đơn giản nhất: push tool call vào history dạng raw
                            // và continue để loop tự parse ở iteration sau

                            // Continue loop - iteration sau sẽ parse được tool call từ confirm_reply
                            // vì confirm_reply đã được thêm vào history
                            // Nhưng cần parse ngay để execute tool
                            // → gán lại parsed và reroute
                            // Để đơn giản: execute tool ngay ở đây
                            for tool in &new_tools {
                                let is_read = matches!(tool.name.as_str(),
                                    "check_port" | "read_file" | "get_project_files"
                                    | "scan_directory_tree" | "scan_subdirectory"
                                    | "search_files" | "extract_symbol" | "read_file_range"
                                    | "search_symbol" | "search_memory"
                                );
                                let can_exec = config.auto_approve_all
                                    || (config.auto_approve_reads && is_read);

                                if can_exec {
                                    let tresult = self.execute_tool(&session_id, tool).await;
                                    let (rtext, rsuccess) = match tresult {
                                        Ok(r) => (r, true),
                                        Err(e) => (e, false),
                                    };
                                    tool_calls_made += 1;

                                    history.push(ChatMessage {
                                        id: format!("obs_dual_{}", chrono::Local::now().timestamp_millis()),
                                        role: "system".to_string(),
                                        content: format!("<call:{}><result success={}>{}</result>", tool.name, rsuccess, rtext),
                                        timestamp: chrono::Local::now().format("%H:%M").to_string(),
                                    });

                                    iterations.push(AgentLoopIteration {
                                        iteration: (iteration + 1) as u32,
                                        thought: confirm_parsed.thought.clone(),
                                        tool_name: Some(tool.name.clone()),
                                        tool_args: Some(tool.arguments.to_string()),
                                        tool_result: Some(rtext),
                                        tool_success: rsuccess,
                                        timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
                                    });

                                    if let Some(ref cb) = on_iteration_fn {
                                        cb(iterations.last().unwrap().clone());
                                    }
                                }
                            }
                            // Sau dual-check tool → hỏi lại completion
                            history.push(ChatMessage {
                                id: format!("sys_chk2_{}", chrono::Local::now().timestamp_millis()),
                                role: "system".to_string(),
                                content: "<system-reminder>After completing the missing items above, is the task now FULLY complete? Reply FINAL_CONFIRMATION: YES if done, or CONTINUE if more is needed.</system-reminder>".to_string(),
                                timestamp: chrono::Local::now().format("%H:%M").to_string(),
                            });
                            completion_phase = CompletionPhase::FinalCheck;
                            continue;
                        }

                        // AI vẫn xác nhận done → final
                        let confirm_text = confirm_parsed.plain_text.unwrap_or_else(|| text.clone());
                        final_text = Some(confirm_text.clone());

                        history.push(ChatMessage {
                            id: format!("model_final_{}", chrono::Local::now().timestamp_millis()),
                            role: "model".to_string(),
                            content: confirm_text.clone(),
                            timestamp: chrono::Local::now().format("%H:%M").to_string(),
                        });

                        iterations.push(AgentLoopIteration {
                            tool_name: None,
                            tool_args: None,
                            tool_result: Some(confirm_text),
                            tool_success: true,
                            ..iteration_record
                        });

                        if let Some(ref cb) = on_iteration_fn {
                            cb(iterations.last().unwrap().clone());
                        }

                        break;
                    } else {
                        // AI nói "continue" hoặc không confirm → reset
                        completion_phase = CompletionPhase::Active;
                        continue;
                    }
                }
                CompletionPhase::SecondCheck | CompletionPhase::FinalCheck => {
                    // ─── PHASE 2/3: AI đã xác nhận lần 2 ────────────
                    let is_final = text.to_lowercase().contains("final_confirmation")
                        || text.to_lowercase().contains("yes")
                        || text.to_lowercase().contains("done")
                        || text.to_lowercase().contains("complete");

                    if is_final {
                        final_text = Some(text.clone());

                        iterations.push(AgentLoopIteration {
                            tool_name: None,
                            tool_args: None,
                            tool_result: Some(text.clone()),
                            tool_success: true,
                            ..iteration_record
                        });

                        if let Some(ref cb) = on_iteration_fn {
                            cb(iterations.last().unwrap().clone());
                        }

                        break;
                    } else {
                        // Còn việc → reset
                        completion_phase = CompletionPhase::Active;
                        continue;
                    }
                }
                CompletionPhase::Active => {
                    // ─── NO COMPLETION CHECK PENDING ─────────────────
                    // AI tự dừng mà không được hỏi trước → hỏi một lần
                    let is_completion_like = text.to_lowercase().contains("done")
                        || text.to_lowercase().contains("complete")
                        || text.to_lowercase().contains("finished")
                        || text.to_lowercase().contains("xong")
                        || text.to_lowercase().contains("hoàn thành");

                    if is_completion_like {
                        // Ask "are you sure?" once
                        history.push(ChatMessage {
                            id: format!("sys_sure_{}", chrono::Local::now().timestamp_millis()),
                            role: "system".to_string(),
                            content: "<system-reminder>You seem to indicate the task is done. Please confirm with a structured summary:\n\n## Summary of Changes\n- List files changed/created and what was done\n\n## Verification\n- List verification steps and results\n\n## Final Status\n- ✅ Complete / ⚠️ Partial\n- Any remaining notes</system-reminder>".to_string(),
                            timestamp: chrono::Local::now().format("%H:%M").to_string(),
                        });

                        // Gọi LLM để lấy final report
                        let report_reply = match llm_call_fn(
                            system_prompt.to_string(),
                            history.clone(),
                        ).await {
                            Ok(reply) => reply,
                            Err(e) => {
                                stop_reason = Some(format!("Report generation failed: {}", e));
                                stopped_early = true;
                                final_text = Some(text);
                                break;
                            }
                        };

                        let report_parsed = parser::parse_model_response(&report_reply);

                        // If AI makes a tool call during report → it found missing work
                        if !report_parsed.tool_calls.is_empty() || report_parsed.tool_call.is_some() {
                            history.push(ChatMessage {
                                id: format!("model_rpt_{}", chrono::Local::now().timestamp_millis()),
                                role: "model".to_string(),
                                content: report_reply,
                                timestamp: chrono::Local::now().format("%H:%M").to_string(),
                            });
                            completion_phase = CompletionPhase::Active;
                            continue;
                        }

                        let report_text = report_parsed.plain_text.unwrap_or_else(|| text);
                        final_text = Some(report_text.clone());

                        history.push(ChatMessage {
                            id: format!("model_rpt_{}", chrono::Local::now().timestamp_millis()),
                            role: "model".to_string(),
                            content: report_text.clone(),
                            timestamp: chrono::Local::now().format("%H:%M").to_string(),
                        });

                        iterations.push(AgentLoopIteration {
                            tool_name: None,
                            tool_args: None,
                            tool_result: Some(report_text),
                            tool_success: true,
                            ..iteration_record
                        });

                        if let Some(ref cb) = on_iteration_fn {
                            cb(iterations.last().unwrap().clone());
                        }

                        break;
                    } else {
                        // Plain text, không phải done signal → kết thúc
                        final_text = Some(text.clone());

                        iterations.push(AgentLoopIteration {
                            tool_name: None,
                            tool_args: None,
                            tool_result: Some(text),
                            tool_success: true,
                            ..iteration_record
                        });

                        if let Some(ref cb) = on_iteration_fn {
                            cb(iterations.last().unwrap().clone());
                        }

                        break;
                    }
                }
            }
        }

        // Kiểm tra nếu đạt max iterations
        let total_iters = iterations.len() as u32;
        if total_iters >= config.max_iterations && final_text.is_none() {
            stopped_early = true;
            stop_reason = Some(format!(
                "Reached maximum iterations ({})", config.max_iterations
            ));
        }

        AgentLoopResult {
            session_id,
            iterations,
            final_text,
            total_iterations: total_iters,
            tool_calls_made,
            stopped_early,
            stop_reason,
        }
    }

    // ─── Memory Management ───────────────────────────────────────────────

    pub fn memory_manager(&self) -> &memory::MemoryManager {
        &self.memory_manager
    }

    pub fn skill_engine(&self) -> &skills::SkillEngine {
        &self.skill_engine
    }

    pub fn telemetry_manager(&self) -> &telemetry::TelemetryManager {
        &self.telemetry
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
