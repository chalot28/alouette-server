use serde_json::Value;

pub struct SelfHealAnalyzer;

impl SelfHealAnalyzer {
    /// Analyzes an execution error or failure and returns semantic repair guidelines.
    pub fn analyze_failure(tool_name: &str, arguments: &Value, error_msg: &str) -> String {
        let mut diagnosis = format!("Error executing tool '{}': {}\n", tool_name, error_msg);

        // Analyze specific failure categories and provide helpful tips
        if error_msg.to_lowercase().contains("permission denied") || error_msg.to_lowercase().contains("access") {
            diagnosis.push_str("💡 Suggestion: The path is outside the workspace sandbox or requires elevated permissions. Please use a path starting with the workspace root.\n");
        } else if error_msg.to_lowercase().contains("not found") || error_msg.to_lowercase().contains("no such file") {
            if tool_name == "read_file" {
                if let Some(path) = arguments["path"].as_str() {
                    diagnosis.push_str(&format!(
                        "💡 Suggestion: The file '{}' does not exist. Please run 'get_project_files' to check valid paths.\n",
                        path
                    ));
                }
            }
        } else if error_msg.to_lowercase().contains("port") || error_msg.to_lowercase().contains("address already in use") {
            if let Some(port) = arguments["port"].as_u64() {
                diagnosis.push_str(&format!(
                    "💡 Suggestion: Port {} is busy. Use another port or kill the blocking process.\n",
                    port
                ));
            }
        }

        diagnosis
    }
}
