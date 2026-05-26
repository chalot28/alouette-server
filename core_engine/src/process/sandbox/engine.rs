//! # Sandbox Engine — Cross-platform path analysis

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    Block { reason: String },
}

/// Tokenize câu lệnh, tôn trọng quote.
pub fn tokenize(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '\'' if !in_double_quote => { in_single_quote = !in_single_quote; current.push(c); }
            '"' if !in_single_quote => { in_double_quote = !in_double_quote; current.push(c); }
            ' ' | '\t' if !in_single_quote && !in_double_quote => {
                if !current.is_empty() { tokens.push(current.clone()); current.clear(); }
            }
            _ => { current.push(c); }
        }
    }
    if !current.is_empty() { tokens.push(current); }
    tokens
}

fn is_path_like(token: &str) -> bool {
    let t = token.trim_matches(|c| c == '\'' || c == '"');
    if t.len() >= 3 && t.as_bytes()[0].is_ascii_alphabetic() && t.as_bytes()[1] == b':'
        && (t.as_bytes()[2] == b'\\' || t.as_bytes()[2] == b'/') { return true; }
    if t.starts_with("\\\\") || t.starts_with("//") { return true; }
    if t.contains('\\') || t.contains('/') { return true; }
    if t.starts_with("..") { return true; }
    if t.starts_with('/') { return true; }
    if t.starts_with('~') || t.starts_with("$HOME") || t.starts_with("$env:") { return true; }
    false
}

/// Kiểm tra câu lệnh, phát hiện paths ra ngoài workspace.
pub fn check(input: &str, cwd: &Path, workspace_root: &Path) -> Verdict {
    if input.trim().is_empty() { return Verdict::Allow; }
    let tokens = tokenize(input);
    for token in &tokens {
        if !is_path_like(token) { continue; }
        let clean = token.trim_matches(|c| c == '\'' || c == '"');
        let p = PathBuf::from(clean);
        let resolved = if p.is_absolute() {
            std::fs::canonicalize(&p).unwrap_or(p)
        } else {
            let combined = cwd.join(&p);
            std::fs::canonicalize(&combined).unwrap_or(combined)
        };
        if !resolved.starts_with(workspace_root) {
            return Verdict::Block {
                reason: format!("Path '{}' resolves to '{}', outside workspace", token, resolved.display()),
            };
        }
    }
    Verdict::Allow
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_check_allow_simple() {
        assert_eq!(check("echo hello", Path::new("/tmp/ws"), Path::new("/tmp/ws")), Verdict::Allow);
    }
    #[test]
    fn test_check_block_abs_path() {
        let v = check("echo C:\\Windows", Path::new("/tmp/ws"), Path::new("/tmp/ws"));
        assert!(matches!(v, Verdict::Block { .. }));
    }
}
