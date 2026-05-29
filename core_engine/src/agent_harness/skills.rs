use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

/// Core skills for AI agent to interact with the codebase
///
/// ## Skill 1: scan_directory_tree
/// Scans the entire project and returns full directory structure (tree only, NO file contents).
///
/// ## Skill 2: search_files
/// Searches for files by name/glob pattern.
///
/// ## Skill 3: extract_symbol
/// AI describes a symbol (function, struct, variable, type) it needs to see.
/// The tool auto-searches that symbol in the file and extracts ONLY its definition block.
/// AI never needs to know exact line numbers.
///
/// ## Skill 4: read_file_range
/// Read specific line ranges from a file. AI uses this when it knows the range
/// (e.g., after extract_symbol told it the line numbers).

/// Result from scanning directory tree
#[derive(Debug, Clone)]
pub struct DirectoryTree {
    pub root: String,
    pub tree_string: String,
    pub total_dirs: usize,
    pub total_files: usize,
}

/// Result from searching files
#[derive(Debug, Clone)]
pub struct FileSearchResult {
    pub query: String,
    pub matches: Vec<PathBuf>,
    pub total: usize,
}

/// Extracted symbol information
#[derive(Debug, Clone)]
pub struct SymbolExtraction {
    pub file: PathBuf,
    pub symbol: String,
    pub symbol_type: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
    pub code_block: String,
    pub context_before: String,
    pub context_after: String,
}

/// Implementations for all skills
pub struct SkillEngine {
    workspace_root: PathBuf,
}

impl SkillEngine {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }

    // ─── Skill 1: Scan Directory Tree ────────────────────────────────────

    /// Scan the project root and return ONLY ONE LEVEL (immediate children).
    /// This is the FIRST thing AI should call to understand project layout.
    /// Depth is limited to 1 by default to avoid overwhelming the LLM.
    /// AI can then drill into specific subdirectories with `scan_subdirectory`.
    pub fn scan_directory_tree(&self) -> DirectoryTree {
        self.scan_path_with_depth(&self.workspace_root, 1)
    }

    /// Scan a SPECIFIC subdirectory path (one level deep).
    /// AI uses this to explore deeper into folders of interest.
    pub fn scan_subdirectory(&self, rel_path: &str) -> Result<DirectoryTree, String> {
        let target = self.workspace_root.join(rel_path);
        let canonical = fs::canonicalize(&target)
            .map_err(|_| format!("Directory not found: {}", rel_path))?;

        if !canonical.is_dir() {
            return Err(format!("'{}' is not a directory", rel_path));
        }

        // Security: ensure it's within workspace
        let ws = self.workspace_root.to_string_lossy().to_lowercase();
        let can = canonical.to_string_lossy().to_lowercase();
        if !can.starts_with(&ws) {
            return Err("Security: path outside workspace".to_string());
        }

        Ok(self.scan_path_with_depth(&canonical, 1))
    }

    /// Internal: scan a directory path with specified depth.
    fn scan_path_with_depth(&self, dir: &Path, max_depth: usize) -> DirectoryTree {
        let mut lines = Vec::new();

        let display_name = if dir == self.workspace_root {
            self.workspace_root
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "workspace".to_string())
        } else {
            dir.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "(root)".to_string())
        };

        lines.push(format!("{}/", display_name));

        let mut total_dirs = 0usize;
        let mut total_files = 0usize;
        let mut exclude = HashSet::new();
        exclude.insert(".git");
        exclude.insert("node_modules");
        exclude.insert("target");
        exclude.insert("logs");
        exclude.insert(".idea");

        self.build_tree(dir, "", 0, max_depth, &mut lines, &exclude, &mut total_dirs, &mut total_files);

        lines.push(String::new());
        lines.push(format!("{} directories, {} files (showing {} level(s))", total_dirs, total_files, max_depth));

        DirectoryTree {
            root: display_name,
            tree_string: lines.join("\n"),
            total_dirs,
            total_files,
        }
    }

    fn build_tree(
        &self,
        dir: &Path,
        prefix: &str,
        depth: usize,
        max_depth: usize,
        lines: &mut Vec<String>,
        exclude: &HashSet<&str>,
        total_dirs: &mut usize,
        total_files: &mut usize,
    ) {
        if depth >= max_depth {
            return;
        }

        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        let mut dirs = Vec::new();
        let mut files = Vec::new();

        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || exclude.contains(name.as_str()) {
                continue;
            }
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                dirs.push(name);
            } else {
                files.push(name);
            }
        }

        dirs.sort();
        files.sort();

        *total_dirs += dirs.len();
        *total_files += files.len();

        let all_items: Vec<String> = dirs.iter().map(|d| format!("{}/", d)).chain(files.iter().cloned()).collect();

        for (i, item) in all_items.iter().enumerate() {
            let is_last = i == all_items.len() - 1;
            let connector = if is_last { "└── " } else { "├── " };
            lines.push(format!("{}{}{}", prefix, connector, item));

            // If this is a directory, recurse
            if let Some(dir_name) = item.strip_suffix('/') {
                let new_prefix = if is_last { "    " } else { "│   " };
                let dir_path = dir.join(dir_name);
                self.build_tree(&dir_path, &format!("{}{}", prefix, new_prefix), depth + 1, max_depth, lines, exclude, total_dirs, total_files);
            }
        }
    }

    // ─── Skill 2: Search Files ───────────────────────────────────────────

    /// Search for files matching a name pattern or glob.
    /// Returns paths relative to workspace root.
    pub fn search_files(&self, pattern: &str) -> FileSearchResult {
        let mut matches = Vec::new();
        let pattern_lower = pattern.to_lowercase();

        self.walk_and_search(&self.workspace_root, &pattern_lower, &mut matches);

        matches.sort();
        let total = matches.len();

        FileSearchResult {
            query: pattern.to_string(),
            matches,
            total,
        }
    }

    fn walk_and_search(&self, dir: &Path, pattern_lower: &str, results: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(dir) else { return };

        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "logs" {
                continue;
            }

            if path.is_dir() {
                self.walk_and_search(&path, pattern_lower, results);
            } else if name.to_lowercase().contains(pattern_lower) {
                if let Ok(rel) = path.strip_prefix(&self.workspace_root) {
                    results.push(rel.to_path_buf());
                }
            }
        }
    }

    // ─── Skill 3: Extract Symbol ─────────────────────────────────────────

    /// Extract a symbol (function, struct, trait, impl, variable, type, module)
    /// from a file. AI just specifies the file and what symbol it needs to see.
    /// The tool automatically finds the symbol and extracts its definition block.
    ///
    /// This is the SMART skill - AI never needs line numbers.
    /// AI says: "Show me the `handle_request` function in `mod.rs`"
    /// Tool: finds the function, extracts its body, returns clean code block.
    pub fn extract_symbol(&self, file_rel_path: &str, symbol: &str) -> Result<SymbolExtraction, String> {
        let target = self.workspace_root.join(file_rel_path);
        let canonical = fs::canonicalize(&target)
            .map_err(|_| format!("File not found: {}", file_rel_path))?;

        let content = fs::read_to_string(&canonical)
            .map_err(|e| format!("Cannot read file: {}", e))?;

        let lines: Vec<&str> = content.lines().collect();

        // Step 1: Find all lines matching the symbol (as a word boundary)
        let lower_symbol = symbol.to_lowercase();
        let symbol_matches: Vec<usize> = lines.iter().enumerate()
            .filter(|(_, line)| {
                let l = line.to_lowercase();
                // Match: fn symbol, struct symbol, enum symbol, trait symbol,
                // impl symbol, const symbol, let symbol, pub symbol,
                // or word boundary matches (use regex-like approach)
                l.contains(&lower_symbol) && (
                    l.trim().starts_with("fn ") || l.trim().starts_with("pub fn ")
                    || l.trim().starts_with("struct ") || l.trim().starts_with("pub struct ")
                    || l.trim().starts_with("enum ") || l.trim().starts_with("pub enum ")
                    || l.trim().starts_with("trait ") || l.trim().starts_with("pub trait ")
                    || l.trim().starts_with("impl ") || l.trim().starts_with("pub impl ")
                    || l.trim().starts_with("type ") || l.trim().starts_with("pub type ")
                    || l.trim().starts_with("const ") || l.trim().starts_with("pub const ")
                    || l.trim().starts_with("fn ") || l.trim().starts_with("pub fn ")
                    || l.trim().starts_with("mod ") || l.trim().starts_with("pub mod ")
                    || l.trim().starts_with("use ") || l.trim().starts_with("pub use ")
                    // Also match #[derive(...)] patterns
                    || l.trim().starts_with("#[")
                    // Match "let" variable binding
                    || l.contains(&format!("let {}", lower_symbol))
                    || l.contains(&format!("mut {}:", lower_symbol))
                    || l.contains(&format!("{}:", lower_symbol))
                )
            })
            .map(|(idx, _)| idx)
            .collect();

        // Step 2: If no definition found, try broader match (any line containing the symbol)
        let match_lines = if symbol_matches.is_empty() {
            lines.iter().enumerate()
                .filter(|(_, line)| {
                    line.to_lowercase().contains(&lower_symbol)
                })
                .map(|(idx, _)| idx)
                .collect::<Vec<usize>>()
        } else {
            symbol_matches
        };

        if match_lines.is_empty() {
            return Err(format!("Symbol '{}' not found in file '{}'", symbol, file_rel_path));
        }

        // Step 3: For each match, extract the block with proper brace matching
        let mut blocks = Vec::new();

        for &start_ln in &match_lines {
            let (end_ln, extracted) = self.extract_code_block(&lines, start_ln);
            // Determine symbol type
            let symbol_type = self.detect_symbol_type(lines[start_ln]);

            // Get context (2 lines before, 1 line after)
            let ctx_before_start = if start_ln >= 2 { start_ln - 2 } else { 0 };
            let ctx_before = lines[ctx_before_start..start_ln].join("\n");
            let ctx_after_end = std::cmp::min(end_ln + 1, lines.len());
            let ctx_after = if ctx_after_end > end_ln {
                lines[end_ln..ctx_after_end].join("\n")
            } else {
                String::new()
            };

            blocks.push(SymbolExtraction {
                file: file_rel_path.into(),
                symbol: symbol.to_string(),
                symbol_type,
                start_line: start_ln + 1, // 1-based for display
                end_line: end_ln,          // 1-based
                code_block: extracted,
                context_before: ctx_before,
                context_after: ctx_after,
            });
        }

        // Return the first match (most relevant)
        Ok(blocks.swap_remove(0))
    }

    /// Extract a code block starting from a line, with proper brace matching.
    /// Handles: functions { }, structs { }, impl blocks, enums, etc.
    fn extract_code_block(&self, lines: &[&str], start_line: usize) -> (usize, String) {
        let line = lines[start_line];

        // If the line has no opening brace, it might be a one-liner or the brace is on the next line
        let has_open_brace = line.contains('{');
        let has_semicolon = line.trim().ends_with(';');

        // Simple declaration (use statement, mod declaration, const, etc.)
        if has_semicolon || (!has_open_brace && (line.trim().starts_with("use ") || line.trim().starts_with("pub use ")
            || line.trim().starts_with("mod ") || line.trim().starts_with("pub mod ")
            || line.trim().starts_with("type ") || line.trim().starts_with("pub type ")))
        {
            return (start_line + 1, line.to_string());
        }

        // Attribute line (#[derive(...)]), skip it and look at next line
        if line.trim().starts_with('#') && !has_open_brace {
            if start_line + 1 < lines.len() {
                return self.extract_code_block(lines, start_line + 1);
            }
            return (start_line + 1, line.to_string());
        }

        // Block with braces
        let mut brace_count = 0i32;
        let mut in_block = false;
        let mut block_lines = Vec::new();
        let mut end_line = start_line;

        for i in start_line..lines.len() {
            let current = lines[i];
            block_lines.push(current);

            for ch in current.chars() {
                match ch {
                    '{' => {
                        brace_count += 1;
                        in_block = true;
                    }
                    '}' => {
                        brace_count -= 1;
                    }
                    _ => {}
                }
            }

            if in_block && brace_count == 0 {
                end_line = i + 1; // 1-based exclusive end
                break;
            }

            // Safety: prevent infinite loop for very large blocks
            if i - start_line > 1000 {
                end_line = i + 1;
                break;
            }
        }

        (end_line, block_lines.join("\n"))
    }

    /// Detect what type of symbol a line declares
    fn detect_symbol_type(&self, line: &str) -> Option<String> {
        let trimmed = line.trim();

        if trimmed.starts_with("fn ") || trimmed.starts_with("pub fn ") {
            Some("function".to_string())
        } else if trimmed.starts_with("struct ") || trimmed.starts_with("pub struct ") {
            Some("struct".to_string())
        } else if trimmed.starts_with("enum ") || trimmed.starts_with("pub enum ") {
            Some("enum".to_string())
        } else if trimmed.starts_with("trait ") || trimmed.starts_with("pub trait ") {
            Some("trait".to_string())
        } else if trimmed.starts_with("impl ") || trimmed.starts_with("pub impl ") {
            Some("impl".to_string())
        } else if trimmed.starts_with("type ") || trimmed.starts_with("pub type ") {
            Some("type alias".to_string())
        } else if trimmed.starts_with("const ") || trimmed.starts_with("pub const ") {
            Some("const".to_string())
        } else if trimmed.starts_with("mod ") || trimmed.starts_with("pub mod ") {
            Some("module".to_string())
        } else if trimmed.starts_with("use ") || trimmed.starts_with("pub use ") {
            Some("import".to_string())
        } else if trimmed.starts_with('#') {
            Some("attribute".to_string())
        } else if trimmed.contains("let ") || trimmed.contains("mut ") {
            Some("variable".to_string())
        } else {
            None
        }
    }

    // ─── Skill 4: Read File Range ────────────────────────────────────────

    /// Read a specific range of lines from a file.
    /// AI would typically use this AFTER extract_symbol told it the line numbers.
    pub fn read_file_range(&self, file_rel_path: &str, start_line: usize, end_line: usize) -> Result<String, String> {
        let target = self.workspace_root.join(file_rel_path);
        let canonical = fs::canonicalize(&target)
            .map_err(|_| format!("File not found: {}", file_rel_path))?;

        let content = fs::read_to_string(&canonical)
            .map_err(|e| format!("Cannot read file: {}", e))?;

        let lines: Vec<&str> = content.lines().collect();
        let total_lines = lines.len();

        // Validate range
        let start = if start_line > 0 { start_line - 1 } else { 0 }; // Convert to 0-based
        let end = std::cmp::min(end_line, total_lines);

        if start >= total_lines {
            return Err(format!(
                "Invalid range: file has {} lines, requested start at {}",
                total_lines, start_line
            ));
        }

        let selected = &lines[start..end];
        let mut result = String::new();

        // Add line numbers for reference
        for (i, line) in selected.iter().enumerate() {
            let line_num = start + i + 1;
            result.push_str(&format!("{:>6} | {}\n", line_num, line));
        }

        result.push_str(&format!("\n--- Lines {}-{} of {} ---", start_line, end, total_lines));
        Ok(result)
    }

    // ─── Utility: Search For Symbol Across Project ───────────────────────

    /// Search for a symbol across the entire project.
    /// Returns file paths and line numbers where the symbol appears.
    pub fn search_symbol_across_project(&self, symbol: &str) -> Vec<(PathBuf, usize, String)> {
        let mut results = Vec::new();
        let lower_symbol = symbol.to_lowercase();

        self.walk_and_search_symbol(&self.workspace_root, &lower_symbol, &mut results);

        results.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
        results
    }

    fn walk_and_search_symbol(
        &self,
        dir: &Path,
        lower_symbol: &str,
        results: &mut Vec<(PathBuf, usize, String)>,
    ) {
        let Ok(entries) = fs::read_dir(dir) else { return };

        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "logs" {
                continue;
            }

            if path.is_dir() {
                self.walk_and_search_symbol(&path, lower_symbol, results);
            } else if path.extension().map_or(false, |e| e == "rs" || e == "ts" || e == "js" || e == "tsx" || e == "jsx") {
                if let Ok(content) = fs::read_to_string(&path) {
                    for (i, line) in content.lines().enumerate() {
                        if line.to_lowercase().contains(lower_symbol) {
                            if let Ok(rel) = path.strip_prefix(&self.workspace_root) {
                                results.push((rel.to_path_buf(), i + 1, line.trim().to_string()));
                            }
                            // Only record first match per symbol per file
                            break;
                        }
                    }
                }
            }
        }
    }
}
