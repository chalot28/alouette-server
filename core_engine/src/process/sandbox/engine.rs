//! # Sandbox Engine — Cross-platform path analysis (Fallback Layer)
//!
//! Hoạt động khi interceptor không đưa ra phán quyết rõ ràng.
//! Tokenize + resolve paths + boundary check mở rộng.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    Block { reason: String },
}

/// Tokenize câu lệnh, tôn trọng quote và subexpression.
pub fn tokenize(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut in_subexpr = 0u32;
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '\'' if !in_double => { in_single = !in_single; current.push(c); }
            '"' if !in_single => { in_double = !in_double; current.push(c); }
            '$' if !in_single && !in_double => {
                if chars.peek() == Some(&'(') {
                    in_subexpr += 1;
                    current.push(c);
                    current.push(chars.next().unwrap());
                } else { current.push(c); }
            }
            '(' if !in_single && !in_double && in_subexpr > 0 => { in_subexpr += 1; current.push(c); }
            ')' if !in_single && !in_double && in_subexpr > 0 => { in_subexpr -= 1; current.push(c); }
            ' ' | '\t' if !in_single && !in_double && in_subexpr == 0 => {
                if !current.is_empty() { tokens.push(current.clone()); current.clear(); }
            }
            _ => { current.push(c); }
        }
    }
    if !current.is_empty() { tokens.push(current); }
    tokens
}

/// Kiểm tra token có phải path reference không (mở rộng)
fn is_path_like(token: &str) -> bool {
    let t = token.trim_matches(|c| c == '\'' || c == '"');
    if t.is_empty() { return false; }

    // Windows absolute: C:\... hoặc C:/...
    if t.len() >= 3
        && t.as_bytes()[0].is_ascii_alphabetic()
        && t.as_bytes()[1] == b':'
        && (t.as_bytes()[2] == b'\\' || t.as_bytes()[2] == b'/')
    { return true; }

    // UNC path
    if t.starts_with("\\\\") || t.starts_with("//") { return true; }

    // Unix absolute
    if t.starts_with('/') { return true; }

    // Chứa path separator
    if t.contains('\\') || t.contains('/') { return true; }

    // Bắt đầu với ~, $HOME, $env:
    if t.starts_with('~') || t.starts_with("$HOME") || t.starts_with("$env:") { return true; }

    // Bắt đầu với ..
    if t.starts_with("..") { return true; }

    // Có dấu : nhưng không phải URL (vd: env:SYSTEMROOT, HKCU:\Software)
    if t.contains(':') && !t.contains("://") {
        let parts: Vec<&str> = t.splitn(2, ':').collect();
        if parts.len() == 2 {
            let drive = parts[0].to_lowercase();
            // Nếu là 1 chữ cái + : thì là drive letter (C:), không phải path nếu không có slash
            if drive.len() == 1 && drive.as_bytes()[0].is_ascii_alphabetic() {
                // C:test → relative path trên ổ C, vẫn là path
                return true;
            }
            // PowerShell provider drives
            match drive.as_str() {
                "env" | "cert" | "function" | "variable" | "alias" |
                "hkcu" | "hklm" | "wsman" => return true,
                _ => {}
            }
        }
    }

    false
}

/// Resolve path mở rộng: handle ~, env vars, relative paths
fn resolve_path_extended(raw: &str, cwd: &Path) -> PathBuf {
    let s = raw.trim_matches(|c| c == '\'' || c == '"');

    // Handle ~ expansion
    if s.starts_with('~') {
        if let Some(home) = get_home_dir() {
            if s.len() == 1 {
                return PathBuf::from(home);
            } else if s.as_bytes().get(1) == Some(&b'/') || s.as_bytes().get(1) == Some(&b'\\') {
                return PathBuf::from(format!("{}{}", home, &s[1..]));
            } else {
                return PathBuf::from(format!("{}\\{}", home, &s[1..]));
            }
        }
    }

    // Handle env vars: $HOME, $env:VAR
    let expanded = resolve_env_vars(s);

    let p = PathBuf::from(&expanded);
    if p.is_relative() {
        let combined = cwd.join(&p);
        if let Ok(canon) = std::fs::canonicalize(&combined) {
            return canon;
        }
        return combined;
    }

    if let Ok(canon) = std::fs::canonicalize(&p) {
        return canon;
    }
    p
}

fn get_home_dir() -> Option<String> {
    #[cfg(target_os = "windows")]
    { std::env::var("USERPROFILE").ok() }
    #[cfg(not(target_os = "windows"))]
    { std::env::var("HOME").ok() }
}

fn resolve_env_vars(s: &str) -> String {
    let mut result = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '$' {
            if chars.peek() == Some(&'{') {
                chars.next();
                let mut var_name = String::new();
                while let Some(&next) = chars.peek() {
                    if next == '}' { chars.next(); break; }
                    var_name.push(chars.next().unwrap());
                }
                let val = if let Some(e) = var_name.strip_prefix("env:") {
                    std::env::var(e).unwrap_or_default()
                } else {
                    std::env::var(&var_name).unwrap_or_default()
                };
                result.push_str(&val);
            } else if chars.peek() == Some(&'(') {
                chars.next();
                let mut depth = 1u32;
                while let Some(&next) = chars.peek() {
                    if next == '(' { depth += 1; }
                    else if next == ')' { depth -= 1; if depth == 0 { chars.next(); break; } }
                    chars.next();
                }
            } else {
                let mut var_name = String::new();
                while let Some(&next) = chars.peek() {
                    if next.is_alphanumeric() || next == '_' || next == ':' {
                        var_name.push(chars.next().unwrap());
                    } else { break; }
                }
                let val = if let Some(e) = var_name.strip_prefix("env:") {
                    std::env::var(e).unwrap_or_default()
                } else {
                    std::env::var(&var_name).unwrap_or_default()
                };
                result.push_str(&val);
            }
        } else {
            result.push(c);
        }
    }
    result
}

/// Kiểm tra chính: tìm path tokens, resolve, so sánh với workspace boundary
pub fn check(input: &str, cwd: &Path, workspace_root: &Path) -> Verdict {
    if input.trim().is_empty() { return Verdict::Allow; }

    // Chuẩn hóa input trước khi phân tích
    let normalized: String = input.chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect();

    let tokens = tokenize(&normalized);
    for token in &tokens {
        if !is_path_like(token) { continue; }

        let resolved = resolve_path_extended(token, cwd);
        if resolved.as_os_str().is_empty() { continue; }

        // Dùng canonicalize để detect symlink/junction escapes
        let final_path = if let Ok(canon) = std::fs::canonicalize(&resolved) {
            canon
        } else {
            resolved
        };

        // Boundary check (case-insensitive trên Windows)
        let ws_str = workspace_root.to_string_lossy();
        let fp_str = final_path.to_string_lossy();

        #[cfg(target_os = "windows")]
        {
            if !fp_str.to_lowercase().starts_with(&ws_str.to_lowercase()) {
                return Verdict::Block {
                    reason: format!("Path '{}' resolves to '{}', outside workspace", token, fp_str),
                };
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            if !fp_str.starts_with(ws_str.as_ref()) {
                return Verdict::Block {
                    reason: format!("Path '{}' resolves to '{}', outside workspace", token, fp_str),
                };
            }
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
        let v = check("echo C:\\Windows", Path::new("C:\\ws"), Path::new("C:\\ws"));
        assert!(matches!(v, Verdict::Block { .. }));
    }

    #[test]
    fn test_check_block_tilde_outside() {
        let home = get_home_dir().unwrap_or_else(|| "C:\\Users\\test".to_string());
        let cmd = format!("cd {}\\Windows", home);
        let v = check(&cmd, Path::new("C:\\ws"), Path::new("C:\\ws"));
        assert!(matches!(v, Verdict::Block { .. }));
    }

    #[test]
    fn test_tokenize_edge_cases() {
        let t = tokenize("cd $HOME\\test");
        assert_eq!(t.len(), 2);
        let t2 = tokenize("echo \"hello world\"");
        assert_eq!(t2.len(), 2);
    }
}
