use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Types of memory entries matching Claude Code's memory system
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MemoryType {
    #[serde(rename = "user")]
    User,
    #[serde(rename = "feedback")]
    Feedback,
    #[serde(rename = "project")]
    Project,
    #[serde(rename = "reference")]
    Reference,
}

/// A single memory file with frontmatter, matching the Claude Code format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub name: String,
    pub description: String,
    pub metadata: MemoryMetadata,
    pub content: String,
    pub file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryMetadata {
    #[serde(rename = "type")]
    pub mem_type: MemoryType,
}

/// Manages persistent file-based memory with consolidation and pruning
pub struct MemoryManager {
    memory_dir: PathBuf,
    team_memory_dir: PathBuf,
}

impl MemoryManager {
    pub fn new(workspace_root: &Path) -> Self {
        let memory_dir = workspace_root.join(".claude").join("memories");
        let team_memory_dir = memory_dir.join("team");

        let _ = fs::create_dir_all(&memory_dir);
        let _ = fs::create_dir_all(&team_memory_dir);

        Self {
            memory_dir,
            team_memory_dir,
        }
    }

    /// Load all personal memory files with frontmatter
    pub fn load_all_memories(&self) -> Vec<MemoryEntry> {
        let mut entries = self.load_from_dir(&self.memory_dir);
        // Also load team memories
        if self.team_memory_dir.exists() {
            let team_entries = self.load_from_dir(&self.team_memory_dir);
            entries.extend(team_entries);
        }
        entries
    }

    fn load_from_dir(&self, dir: &Path) -> Vec<MemoryEntry> {
        let mut entries = Vec::new();
        if !dir.is_dir() {
            return entries;
        }

        for entry in fs::read_dir(dir).ok().into_iter().flatten() {
            let entry = entry.ok().map(|e| e.path());
            if let Some(path) = entry {
                if path.extension().map_or(true, |e| e != "md") {
                    continue;
                }
                if let Some(mem) = self.parse_memory_file(&path) {
                    entries.push(mem);
                }
            }
        }

        // Sort by name for deterministic ordering
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        entries
    }

    /// Parse a memory file with frontmatter (YAML-like)
    fn parse_memory_file(&self, path: &Path) -> Option<MemoryEntry> {
        let content = fs::read_to_string(path).ok()?;

        // Parse frontmatter between --- markers
        if !content.starts_with("---") {
            return None;
        }

        let end_frontmatter = content[3..].find("---")?;
        let frontmatter_text = &content[3..3 + end_frontmatter];

        let body = content[3 + end_frontmatter + 3..].trim().to_string();

        // Simple YAML-like frontmatter parser
        let mut name = String::new();
        let mut description = String::new();
        let mut mem_type = MemoryType::Reference;

        for line in frontmatter_text.lines() {
            let line = line.trim();
            if let Some(val) = line.strip_prefix("name:") {
                name = val.trim().trim_matches('"').to_string();
            } else if let Some(val) = line.strip_prefix("description:") {
                description = val.trim().trim_matches('"').to_string();
            } else if let Some(val) = line.strip_prefix("type:") {
                mem_type = match val.trim() {
                    "user" => MemoryType::User,
                    "feedback" => MemoryType::Feedback,
                    "project" => MemoryType::Project,
                    _ => MemoryType::Reference,
                };
            }
        }

        Some(MemoryEntry {
            name,
            description,
            metadata: MemoryMetadata { mem_type },
            content: body,
            file_path: path.to_path_buf(),
        })
    }

    /// Save a new memory entry or update an existing one
    pub fn save_memory(&self, name: &str, description: &str, mem_type: MemoryType, content: &str) -> Result<PathBuf, String> {
        let slug_name = name.to_lowercase().replace(' ', "-").replace(|c: char| !c.is_alphanumeric() && c != '-', "");
        let file_path = self.memory_dir.join(format!("{}.md", slug_name));

        let mem_content = format!(
            "---\nname: {}\ndescription: {}\nmetadata:\n  type: {}\n---\n\n{}",
            name, description,
            match mem_type {
                MemoryType::User => "user",
                MemoryType::Feedback => "feedback",
                MemoryType::Project => "project",
                MemoryType::Reference => "reference",
            },
            content
        );

        fs::write(&file_path, mem_content)
            .map(|_| file_path)
            .map_err(|e| format!("Failed to save memory: {}", e))
    }

    /// Delete a memory entry by name
    pub fn delete_memory(&self, name: &str) -> Result<(), String> {
        let slug_name = name.to_lowercase().replace(' ', "-");
        let file_path = self.memory_dir.join(format!("{}.md", slug_name));

        if file_path.exists() {
            fs::remove_file(&file_path).map_err(|e| format!("Failed to delete memory: {}", e))
        } else {
            Err(format!("Memory '{}' not found", name))
        }
    }

    /// Perform dream memory consolidation: merge near-duplicates
    pub fn consolidate_memories(&self) -> Result<ConsolidationReport, String> {
        let memories = self.load_all_memories();
        let mut report = ConsolidationReport::default();

        // Group by similar descriptions and merge
        let mut seen: HashMap<String, Vec<MemoryEntry>> = HashMap::new();
        for mem in &memories {
            let key = mem.description.split('.').next().unwrap_or(&mem.description).to_string();
            seen.entry(key).or_default().push(mem.clone());
        }

        for (_key, group) in seen.iter() {
            if group.len() > 1 {
                // Merge into first entry, delete rest
                let keep = &group[0];
                for duplicate in &group[1..] {
                    // Append content
                    let mut merged_content = fs::read_to_string(&keep.file_path).unwrap_or_default();
                    let dup_content = fs::read_to_string(&duplicate.file_path).unwrap_or_default();
                    if !dup_content.is_empty() {
                        merged_content.push_str("\n\n---\n\n");
                        merged_content.push_str(&dup_content);
                    }
                    let _ = fs::write(&keep.file_path, merged_content);
                    let _ = fs::remove_file(&duplicate.file_path);
                    report.merged += 1;
                }
            }
        }

        report.total = memories.len();
        Ok(report)
    }

    /// Prune stale memories: remove memories that reference non-existent code
    pub fn prune_stale_memories(&self, codebase_files: &[String]) -> Result<PruneReport, String> {
        let memories = self.load_all_memories();
        let mut report = PruneReport::default();

        for mem in &memories {
            // Check if memory references files that no longer exist
            for line in mem.content.lines() {
                for code_file in codebase_files {
                    if line.contains(code_file) {
                        // Check if the referenced file still exists
                        if !Path::new(code_file).exists() {
                            let _ = fs::remove_file(&mem.file_path);
                            report.deleted += 1;
                            break;
                        }
                    }
                }
            }
        }

        report.total = memories.len();
        Ok(report)
    }

    /// Search memories by keyword across name, description, and content
    pub fn search_memories(&self, query: &str) -> Vec<MemoryEntry> {
        let memories = self.load_all_memories();
        let query_lower = query.to_lowercase();

        memories
            .into_iter()
            .filter(|m| {
                m.name.to_lowercase().contains(&query_lower)
                    || m.description.to_lowercase().contains(&query_lower)
                    || m.content.to_lowercase().contains(&query_lower)
            })
            .collect()
    }
}

#[derive(Debug, Clone, Default)]
pub struct ConsolidationReport {
    pub total: usize,
    pub merged: usize,
}

#[derive(Debug, Clone, Default)]
pub struct PruneReport {
    pub total: usize,
    pub deleted: usize,
}
