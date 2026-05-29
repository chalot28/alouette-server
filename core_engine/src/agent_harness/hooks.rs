use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::process::Command;

/// Hook lifecycle events matching Claude Code hooks system
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Hash, Eq)]
pub enum HookEvent {
    #[serde(rename = "PermissionRequest")]
    PermissionRequest,
    #[serde(rename = "PreToolUse")]
    PreToolUse,
    #[serde(rename = "PostToolUse")]
    PostToolUse,
    #[serde(rename = "PostToolUseFailure")]
    PostToolUseFailure,
    #[serde(rename = "Notification")]
    Notification,
    #[serde(rename = "Stop")]
    Stop,
    #[serde(rename = "PreCompact")]
    PreCompact,
    #[serde(rename = "PostCompact")]
    PostCompact,
    #[serde(rename = "UserPromptSubmit")]
    UserPromptSubmit,
    #[serde(rename = "SessionStart")]
    SessionStart,
}

/// Hook type: command, prompt, or agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum HookType {
    #[serde(rename = "command")]
    Command {
        command: String,
        #[serde(default = "default_timeout")]
        timeout: u64,
        #[serde(default)]
        status_message: String,
    },
    #[serde(rename = "prompt")]
    Prompt {
        prompt: String,
    },
    #[serde(rename = "agent")]
    Agent {
        prompt: String,
    },
}

fn default_timeout() -> u64 {
    60
}

/// Hook definition with matcher and hooks list
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookDefinition {
    #[serde(default)]
    pub matcher: String,
    pub hooks: Vec<HookType>,
}

/// Complete hooks configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HooksConfig {
    #[serde(default)]
    pub hooks: HashMap<String, Vec<HookDefinition>>,
}

/// Hook execution input (stdin JSON for command hooks)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookInput {
    pub session_id: String,
    pub tool_name: String,
    pub tool_input: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_response: Option<Value>,
}

/// Hook output with control fields
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HookOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_message: Option<String>,
    #[serde(default = "default_true")]
    pub continue_: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    #[serde(default)]
    pub suppress_output: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hook_specific_output: Option<HookSpecificOutput>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookSpecificOutput {
    #[serde(rename = "hookEventName")]
    pub hook_event_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_context: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_decision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_decision_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_input: Option<Value>,
}

/// Manages hook lifecycle for agent sessions
pub struct HookManager {
    config: HooksConfig,
}

impl HookManager {
    pub fn new(config: HooksConfig) -> Self {
        Self { config }
    }

    /// Load hooks configuration from a JSON file
    pub fn from_file(path: &std::path::Path) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read hooks config: {}", e))?;
        let config: HooksConfig = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse hooks config: {}", e))?;
        Ok(Self { config })
    }

    /// Execute hooks for a specific event and tool name
    pub fn execute_hooks(
        &self,
        event: &HookEvent,
        tool_name: &str,
        input: &HookInput,
    ) -> Vec<HookOutput> {
        let event_key = serde_json::to_string(event)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();

        let mut outputs = Vec::new();

        let Some(definitions) = self.config.hooks.get(&event_key) else {
            return outputs;
        };

        for definition in definitions {
            if !definition.matcher.is_empty() && tool_name != definition.matcher {
                continue;
            }

            for hook in &definition.hooks {
                match self.execute_single_hook(hook, input) {
                    Ok(output) => {
                        outputs.push(output);
                    }
                    Err(e) => {
                        eprintln!("Hook execution error: {}", e);
                    }
                }
            }
        }

        outputs
    }

    fn execute_single_hook(&self, hook: &HookType, input: &HookInput) -> Result<HookOutput, String> {
        match hook {
            HookType::Command { command, .. } => {
                let input_json = serde_json::to_string(input)
                    .map_err(|e| format!("Failed to serialize hook input: {}", e))?;

                let cmd_with_input = format!("echo '{}' | {}", input_json.replace('\'', "'\\''"), command);

                let output = if cfg!(target_os = "windows") {
                    Command::new("powershell")
                        .args(["-Command", &cmd_with_input])
                        .output()
                } else {
                    Command::new("sh")
                        .args(["-c", &cmd_with_input])
                        .output()
                };

                match output {
                    Ok(out) => {
                        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                        if let Ok(hook_output) = serde_json::from_str::<HookOutput>(&stdout) {
                            Ok(hook_output)
                        } else {
                            Ok(HookOutput {
                                system_message: Some(stdout.trim().to_string()),
                                ..Default::default()
                            })
                        }
                    }
                    Err(e) => Err(format!("Hook command failed: {}", e)),
                }
            }
            HookType::Prompt { prompt } | HookType::Agent { prompt } => {
                Ok(HookOutput {
                    system_message: Some(format!("Hook requires LLM evaluation for: {}", prompt)),
                    ..Default::default()
                })
            }
        }
    }

    /// Check if hooks should block an action
    pub fn should_block(&self, outputs: &[HookOutput]) -> Option<String> {
        for output in outputs {
            if let Some(ref decision) = output.decision {
                if decision == "block" {
                    return output.stop_reason.clone()
                        .or_else(|| Some("Action blocked by hook".to_string()));
                }
            }
            if !output.continue_ {
                return output.stop_reason.clone()
                    .or_else(|| Some("Action stopped by hook".to_string()));
            }
        }
        None
    }

    /// Collect additional context from hook outputs
    pub fn collect_additional_context(&self, outputs: &[HookOutput]) -> Vec<String> {
        outputs
            .iter()
            .filter_map(|o| o.hook_specific_output.as_ref())
            .filter_map(|s| s.additional_context.clone())
            .collect()
    }
}
