use serde_json::Value;

/// Categories of failures for targeted recovery strategies
#[derive(Debug, Clone, PartialEq)]
pub enum FailureCategory {
    PermissionDenied,
    FileNotFound,
    PortInUse,
    NetworkError,
    ParseError,
    Timeout,
    ResourceExhausted,
    SecurityViolation,
    Unknown(String),
}

/// Recovery strategy suggestion
#[derive(Debug, Clone)]
pub struct RecoveryStrategy {
    pub category: FailureCategory,
    pub suggestion: String,
    pub retry_allowed: bool,
    pub alternative_approach: Option<String>,
}

pub struct SelfHealAnalyzer;

impl SelfHealAnalyzer {
    /// Analyze a failure and return structured recovery guidance
    pub fn analyze_failure(tool_name: &str, arguments: &Value, error_msg: &str) -> String {
        let category = Self::categorize(error_msg);
        let strategy = Self::generate_recovery(&category, tool_name, arguments, error_msg);
        Self::format_diagnosis(tool_name, error_msg, &strategy)
    }

    /// Categorize the failure type
    fn categorize(error_msg: &str) -> FailureCategory {
        let lower = error_msg.to_lowercase();

        if lower.contains("permission denied") || lower.contains("access is denied") || lower.contains("eacces") {
            FailureCategory::PermissionDenied
        } else if lower.contains("not found") || lower.contains("no such file") || lower.contains("enoent") {
            FailureCategory::FileNotFound
        } else if lower.contains("port") || lower.contains("address already in use") || lower.contains("eaddrinuse") {
            FailureCategory::PortInUse
        } else if lower.contains("network") || lower.contains("connection refused") || lower.contains("econnrefused")
            || lower.contains("timeout") || lower.contains("timed out") {
            FailureCategory::NetworkError
        } else if lower.contains("parse") || lower.contains("syntax") || lower.contains("unexpected token") {
            FailureCategory::ParseError
        } else if lower.contains("timeout") || lower.contains("timed out") {
            FailureCategory::Timeout
        } else if lower.contains("out of memory") || lower.contains("no space") || lower.contains("disk quota") {
            FailureCategory::ResourceExhausted
        } else if lower.contains("security boundary") || lower.contains("forbidden") || lower.contains("outside workspace") {
            FailureCategory::SecurityViolation
        } else {
            FailureCategory::Unknown(error_msg.chars().take(60).collect())
        }
    }

    /// Generate recovery strategy based on failure category
    fn generate_recovery(
        category: &FailureCategory,
        tool_name: &str,
        arguments: &Value,
        error_msg: &str,
    ) -> RecoveryStrategy {
        match category {
            FailureCategory::PermissionDenied => RecoveryStrategy {
                category: category.clone(),
                suggestion: "The path is outside the workspace sandbox or requires elevated permissions. Use a path starting with the workspace root.".to_string(),
                retry_allowed: false,
                alternative_approach: Some("Use get_project_files to discover valid paths within the workspace.".to_string()),
            },
            FailureCategory::FileNotFound => {
                let mut suggestion = "The specified file or path does not exist.".to_string();
                if tool_name == "read_file" {
                    if let Some(path) = arguments["path"].as_str() {
                        suggestion = format!("The file '{}' does not exist. Verify the path is correct and try again.", path);
                    }
                }
                RecoveryStrategy {
                    category: category.clone(),
                    suggestion,
                    retry_allowed: true,
                    alternative_approach: Some("Use get_project_files to list available files and directories.".to_string()),
                }
            }
            FailureCategory::PortInUse => {
                let port = arguments["port"].as_u64().unwrap_or(0);
                RecoveryStrategy {
                    category: category.clone(),
                    suggestion: format!("Port {} is busy. Use another port or kill the blocking process.", port),
                    retry_allowed: true,
                    alternative_approach: Some(format!("Try port {} or check which process is using the port.", port + 1)),
                }
            }
            FailureCategory::NetworkError => RecoveryStrategy {
                category: category.clone(),
                suggestion: "Network operation failed. Check connectivity and ensure the target service is reachable.".to_string(),
                retry_allowed: true,
                alternative_approach: None,
            },
            FailureCategory::ParseError => RecoveryStrategy {
                category: category.clone(),
                suggestion: "Failed to parse the response. The model output may contain malformed JSON or XML.".to_string(),
                retry_allowed: true,
                alternative_approach: Some("Try regenerating the response with simpler formatting.".to_string()),
            },
            FailureCategory::Timeout => RecoveryStrategy {
                category: category.clone(),
                suggestion: "The operation timed out. The command may be too slow or hanging.".to_string(),
                retry_allowed: true,
                alternative_approach: Some("Add a timeout flag or simplify the operation.".to_string()),
            },
            FailureCategory::ResourceExhausted => RecoveryStrategy {
                category: category.clone(),
                suggestion: "System resources are exhausted. Free up resources and try again.".to_string(),
                retry_allowed: false,
                alternative_approach: Some("Close other applications or processes to free memory/disk space.".to_string()),
            },
            FailureCategory::SecurityViolation => RecoveryStrategy {
                category: category.clone(),
                suggestion: format!("Security boundary violation: {}", error_msg),
                retry_allowed: false,
                alternative_approach: Some("This operation cannot be performed within the current sandbox constraints.".to_string()),
            },
            FailureCategory::Unknown(_) => RecoveryStrategy {
                category: category.clone(),
                suggestion: "An unexpected error occurred. Review the error message and adjust the approach.".to_string(),
                retry_allowed: true,
                alternative_approach: None,
            },
        }
    }

    /// Format the full diagnosis with recovery guidance
    fn format_diagnosis(tool_name: &str, error_msg: &str, strategy: &RecoveryStrategy) -> String {
        let mut diagnosis = format!("[SELF-HEAL] Error executing tool '{}': {}\n", tool_name, error_msg);

        diagnosis.push_str(&format!("🔍 Category: {:?}\n", strategy.category));
        diagnosis.push_str(&format!("💡 Suggestion: {}\n", strategy.suggestion));

        if let Some(ref alt) = strategy.alternative_approach {
            diagnosis.push_str(&format!("🔄 Alternative: {}\n", alt));
        }

        if !strategy.retry_allowed {
            diagnosis.push_str("⚠️  Do NOT retry this operation with the same parameters.\n");
        }

        diagnosis
    }

    /// Check if a failure is recoverable and should be retried
    pub fn should_retry(_tool_name: &str, error_msg: &str, retry_count: u32) -> bool {
        if retry_count >= 3 {
            return false; // Max retries reached
        }

        let category = Self::categorize(error_msg);
        match category {
            FailureCategory::PermissionDenied => false,
            FailureCategory::SecurityViolation => false,
            FailureCategory::ResourceExhausted => false,
            FailureCategory::Unknown(_) => retry_count < 2,
            _ => true, // Retryable categories
        }
    }
}
