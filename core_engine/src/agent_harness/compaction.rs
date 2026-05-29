use serde::{Deserialize, Serialize};

/// Context compaction summary for continuation across sessions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactionSummary {
    pub task_overview: TaskOverview,
    pub current_state: CurrentState,
    pub discoveries: Vec<Discovery>,
    pub next_steps: Vec<String>,
    pub context_to_preserve: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskOverview {
    pub core_request: String,
    pub success_criteria: String,
    pub constraints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrentState {
    pub completed_items: Vec<String>,
    pub files_modified: Vec<String>,
    pub files_created: Vec<String>,
    pub key_outputs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Discovery {
    pub finding: String,
    pub resolution: Option<String>,
}

/// Manages context compaction and continuation summaries
pub struct CompactionManager;

impl CompactionManager {
    /// Generate a structured continuation summary
    pub fn generate_summary(
        core_request: &str,
        success_criteria: &str,
        completed: Vec<String>,
        files_modified: Vec<String>,
        files_created: Vec<String>,
        discoveries: Vec<(String, Option<String>)>,
        next_steps: Vec<String>,
        context: Vec<String>,
        constraints: Vec<String>,
    ) -> CompactionSummary {
        CompactionSummary {
            task_overview: TaskOverview {
                core_request: core_request.to_string(),
                success_criteria: success_criteria.to_string(),
                constraints,
            },
            current_state: CurrentState {
                completed_items: completed,
                files_modified,
                files_created,
                key_outputs: Vec::new(),
            },
            discoveries: discoveries
                .into_iter()
                .map(|(finding, resolution)| Discovery { finding, resolution })
                .collect(),
            next_steps,
            context_to_preserve: context,
        }
    }

    /// Serialize summary to the XML format Claude Code uses
    pub fn to_xml(summary: &CompactionSummary) -> String {
        let mut xml = String::from("<summary>\n");

        xml.push_str("  <task-overview>\n");
        xml.push_str(&format!("    <core-request>{}</core-request>\n", Self::escape_xml(&summary.task_overview.core_request)));
        xml.push_str(&format!("    <success-criteria>{}</success-criteria>\n", Self::escape_xml(&summary.task_overview.success_criteria)));
        if !summary.task_overview.constraints.is_empty() {
            xml.push_str("    <constraints>\n");
            for c in &summary.task_overview.constraints {
                xml.push_str(&format!("      <constraint>{}</constraint>\n", Self::escape_xml(c)));
            }
            xml.push_str("    </constraints>\n");
        }
        xml.push_str("  </task-overview>\n");

        xml.push_str("  <current-state>\n");
        for item in &summary.current_state.completed_items {
            xml.push_str(&format!("    <completed>{}</completed>\n", Self::escape_xml(item)));
        }
        for f in &summary.current_state.files_modified {
            xml.push_str(&format!("    <file-modified>{}</file-modified>\n", Self::escape_xml(f)));
        }
        for f in &summary.current_state.files_created {
            xml.push_str(&format!("    <file-created>{}</file-created>\n", Self::escape_xml(f)));
        }
        xml.push_str("  </current-state>\n");

        xml.push_str("  <discoveries>\n");
        for d in &summary.discoveries {
            xml.push_str(&format!("    <finding resolution=\"{}\">{}</finding>\n",
                if d.resolution.is_some() { "resolved" } else { "unresolved" },
                Self::escape_xml(&d.finding)));
        }
        xml.push_str("  </discoveries>\n");

        xml.push_str("  <next-steps>\n");
        for ns in &summary.next_steps {
            xml.push_str(&format!("    <step>{}</step>\n", Self::escape_xml(ns)));
        }
        xml.push_str("  </next-steps>\n");

        xml.push_str("  <context-to-preserve>\n");
        for ctx in &summary.context_to_preserve {
            xml.push_str(&format!("    <context>{}</context>\n", Self::escape_xml(ctx)));
        }
        xml.push_str("  </context-to-preserve>\n");

        xml.push_str("</summary>");
        xml
    }

    /// Parse an XML compaction summary back into structured data
    pub fn from_xml(xml: &str) -> Option<CompactionSummary> {
        if !xml.starts_with("<summary>") {
            return None;
        }

        let core_request = Self::extract_tag(xml, "core-request").unwrap_or_default();
        let success_criteria = Self::extract_tag(xml, "success-criteria").unwrap_or_default();

        let completed: Vec<String> = Self::extract_tag_multi(xml, "completed");
        let files_modified: Vec<String> = Self::extract_tag_multi(xml, "file-modified");
        let files_created: Vec<String> = Self::extract_tag_multi(xml, "file-created");
        let next_steps: Vec<String> = Self::extract_tag_multi(xml, "step");
        let context: Vec<String> = Self::extract_tag_multi(xml, "context");
        let constraints: Vec<String> = Self::extract_tag_multi(xml, "constraint");

        Some(CompactionSummary {
            task_overview: TaskOverview {
                core_request,
                success_criteria,
                constraints,
            },
            current_state: CurrentState {
                completed_items: completed,
                files_modified,
                files_created,
                key_outputs: Vec::new(),
            },
            discoveries: Vec::new(),
            next_steps,
            context_to_preserve: context,
        })
    }

    fn extract_tag(content: &str, tag: &str) -> Option<String> {
        let open = format!("<{}>", tag);
        let close = format!("</{}>", tag);
        let start = content.find(&open)?;
        let value_start = start + open.len();
        let end = content[value_start..].find(&close)?;
        Some(content[value_start..value_start + end].to_string())
    }

    fn extract_tag_multi(content: &str, tag: &str) -> Vec<String> {
        let open = format!("<{}>", tag);
        let close = format!("</{}>", tag);
        let mut results = Vec::new();
        let mut search_start = 0;

        while let Some(start) = content[search_start..].find(&open) {
            let abs_start = search_start + start + open.len();
            if let Some(end) = content[abs_start..].find(&close) {
                results.push(content[abs_start..abs_start + end].to_string());
                search_start = abs_start + end + close.len();
            } else {
                break;
            }
        }

        results
    }

    fn escape_xml(s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    }
}
