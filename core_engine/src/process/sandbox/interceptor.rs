//! # Smart Interceptor — Thuật toán nội suy thông minh
//!
//! ## Nguyên lý
//! Thay vì dùng blocklist (dễ bypass), interceptor phân tích **ngữ nghĩa** câu lệnh:
//! 1. Parse command tree (pipe, chain, subexpr)
//! 2. Classify từng lệnh theo rủi ro
//! 3. Nội suy tất cả path arguments về dạng absolute chuẩn
//! 4. Kiểm tra boundary so với workspace
//!
//! ## Xử lý bypass
//! - `cd ~cd` → resolve `~` thành $HOME, phát hiện out-of-workspace
//! - `cd $HOME/../../Windows` → resolve env var + relative path
//! - `Set-Location ~` → alias mapping
//! - `[System.IO.File]::ReadAllText('C:\\...')` → .NET call detection

use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::sync::OnceLock;

/// Mức độ rủi ro của command
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RiskLevel {
    /// Navigation thuần túy (cd, pushd) — cập nhật CWD, luôn allow
    Safe = 0,
    /// Read-only trong workspace (ls, dir, echo, pwd)
    Low = 1,
    /// Read file (cat, type, Get-Content) — cần check path
    Medium = 2,
    /// Write file (echo >, Set-Content, copy, mv) — cần check path chặt
    High = 3,
    /// Execute script (./script, &, Start-Process) — cần check kỹ
    Critical = 4,
    /// System/network (reg, net, curl, Invoke-WebRequest, iex) — block cứng
    Blocked = 5,
}

/// Mô tả command đã phân tích
#[derive(Debug, Clone)]
pub struct AnalyzedCommand {
    pub risk: RiskLevel,
    pub command_name: String,
    pub resolved_paths: Vec<PathBuf>,
    pub reason: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════
// Mapping command → risk level (alias-aware)
// ═══════════════════════════════════════════════════════════════════

fn command_risk_map() -> &'static HashMap<&'static str, RiskLevel> {
    static MAP: OnceLock<HashMap<&'static str, RiskLevel>> = OnceLock::new();
    MAP.get_or_init(|| {
        let mut m = HashMap::new();

        // ── NAVIGATION (Safe) ──
        for cmd in &["cd", "sl", "pushd", "popd", "set-location"] {
            m.insert(*cmd, RiskLevel::Safe);
        }

        // ── READ-ONLY (Low) ──
        for cmd in &[
            "ls", "dir", "ll", "gci", "get-childitem",
            "echo", "write-output", "write-host",
            "pwd", "gl", "get-location",
            "whoami", "hostname",
            "get-date", "date",
            "get-help", "help", "man",
            "clear", "cls",
            "get-history", "history",
            "get-psdrive",
            "get-alias",
            "get-command",
        ] {
            m.insert(*cmd, RiskLevel::Low);
        }

        // ── READ FILE (Medium) ──
        for cmd in &[
            "cat", "type", "gc", "get-content",
            "head", "tail",
            "more", "less",
            "findstr", "select-string", "sls",
            "get-acl",
            "get-item", "gi",
        ] {
            m.insert(*cmd, RiskLevel::Medium);
        }

        // ── WRITE FILE (High) ──
        for cmd in &[
            "set-content", "sc",
            "add-content", "ac",
            "copy", "cp", "cpy",
            "move", "mv", "ren", "rename-item",
            "mkdir", "md", "new-item", "ni",
            "remove-item", "ri", "del", "rm", "rd", "rmdir",
            "out-file", "of",
            "set-acl",
        ] {
            m.insert(*cmd, RiskLevel::High);
        }

        // ── EXECUTE (Critical) ──
        for cmd in &[
            "start-process", "start",
            "invoke-item", "ii",
            "cmd", "powershell", "wsl", "bash",
            "msiexec", "mshta",
        ] {
            m.insert(*cmd, RiskLevel::Critical);
        }

        // ── NETWORK (Blocked) ──
        for cmd in &[
            "curl", "wget",
            "iwr", "invoke-webrequest",
            "invoke-restmethod", "irm",
            "netstat",
            "test-netconnection", "tnc",
        ] {
            m.insert(*cmd, RiskLevel::Blocked);
        }

        // ── SYSTEM / DANGEROUS (Blocked) ──
        for cmd in &[
            "invoke-expression", "iex",
            "invoke-command", "icm",
            "invoke-wmimethod", "iwm",
            "get-wmiobject", "gwmi",
            "get-ciminstance", "gcim",
            "reg", "regedit",
            "schtasks",
            "net", "net1",
            "wmic",
            "mountvol",
            "diskpart",
            "bcdedit",
            "takeown",
            "icacls", "cacls",
            "attrib",
            "subst",
            "new-psdrive", "remove-psdrive",
            "new-object",
            "add-type",
            "register-objectevent",
        ] {
            m.insert(*cmd, RiskLevel::Blocked);
        }

        m
    })
}

// ═══════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════

/// Entry point: phân tích câu lệnh và đưa ra phán quyết
pub fn intercept(input: &str, cwd: &Path, workspace_root: &Path) -> super::Verdict {
    if input.trim().is_empty() {
        return super::Verdict::Allow;
    }

    // Bước 1: Chuẩn hóa input (trim, normalize whitespace)
    let normalized = normalize_input(input);
    let normalized_str = normalized.as_str();

    // Bước 2: Kiểm tra .NET method call pattern trước
    if let Some(reason) = detect_dotnet_call(normalized_str) {
        return super::Verdict::Block { reason };
    }

    // Bước 3: Kiểm tra dangerous pattern
    if let Some(reason) = detect_dangerous_pattern(normalized_str) {
        return super::Verdict::Block { reason };
    }

    // Bước 4: Tách pipeline chunks và phân tích từng cái
    let chunks = split_pipeline(normalized_str);
    for chunk in &chunks {
        let analyzed = analyze_single_command(chunk, cwd, workspace_root);
        match analyzed.risk {
            RiskLevel::Blocked => {
                return super::Verdict::Block {
                    reason: analyzed.reason.unwrap_or_else(|| {
                        format!("Command '{}' is blocked", analyzed.command_name)
                    }),
                };
            }
            RiskLevel::Critical | RiskLevel::High => {
                // Kiểm tra paths có nằm trong workspace không
                if let Some(reason) = check_paths_outside_workspace(&analyzed.resolved_paths, workspace_root) {
                    return super::Verdict::Block { reason };
                }
            }
            RiskLevel::Medium => {
                // Kiểm tra path đọc có out-of-workspace không
                if let Some(reason) = check_paths_outside_workspace(&analyzed.resolved_paths, workspace_root) {
                    return super::Verdict::Block { reason };
                }
            }
            RiskLevel::Safe => {
                // Navigation: vẫn phải resolve path và check boundary!
                // `cd ~cd`, `cd $HOME\..\Windows` bypass detection
                if let Some(reason) = check_paths_outside_workspace(&analyzed.resolved_paths, workspace_root) {
                    return super::Verdict::Block { reason };
                }
            }
            RiskLevel::Low => {
                // Read-only: không cần check path
            }
        }
    }

    super::Verdict::Allow
}

// ═══════════════════════════════════════════════════════════════════
// Step 1: Chuẩn hóa input
// ═══════════════════════════════════════════════════════════════════

fn normalize_input(input: &str) -> String {
    let mut s = input.trim().to_string();

    // Chuẩn hóa unicode homoglyphs (chữ giống nhau nhưng mã khác)
    s = normalize_homoglyphs(&s);

    // Xóa BOM và ký tự điều khiển (trừ newline, tab)
    s = s.chars()
        .filter(|c| *c != '\u{feff}' && (!c.is_control() || *c == '\n' || *c == '\t' || *c == '\r'))
        .collect();

    // Chuẩn hóa khoảng trắng: `\t`, `\r` → space
    s = s.replace('\t', " ").replace('\r', " ");

    // Chuẩn hóa cd shortcuts: cd.. -> cd .., cd/ -> cd /, cd\ -> cd \
    let lower = s.to_lowercase();
    if lower.starts_with("cd..") {
        s = format!("cd ..{}", &s[4..]);
    } else if lower.starts_with("cd/") {
        s = format!("cd /{}", &s[3..]);
    } else if lower.starts_with("cd\\") {
        s = format!("cd \\{}", &s[3..]);
    }

    // Chuẩn hóa backslash → forward slash (dễ xử lý path)
    // Giữ nguyên cho Windows paths (C:\...) nhưng chuẩn hóa phần còn lại
    s = s.replace("\\\\", "\\"); // unescape double backslash
    s
}

/// Unicode homoglyph normalization map
fn normalize_homoglyphs(s: &str) -> String {
    s.chars().map(|c| {
        match c {
            // Latin-simulating Cyrillic
            'а' => 'a', // Cyrillic 'а' → Latin 'a'
            'е' => 'e', // Cyrillic 'е' → Latin 'e'
            'о' => 'o', // Cyrillic 'о' → Latin 'o'
            'р' => 'p', // Cyrillic 'р' → Latin 'p'
            'с' => 'c', // Cyrillic 'с' → Latin 'c'
            'у' => 'y', // Cyrillic 'у' → Latin 'y'
            'х' => 'x', // Cyrillic 'х' → Latin 'x'
            'і' => 'i', // Cyrillic 'і' → Latin 'i'
            // Full-width ASCII
            'Ａ' => 'A', 'Ｂ' => 'B', 'Ｃ' => 'C', 'Ｄ' => 'D', 'Ｅ' => 'E',
            'Ｆ' => 'F', 'Ｇ' => 'G', 'Ｈ' => 'H', 'Ｉ' => 'I', 'Ｊ' => 'J',
            'Ｋ' => 'K', 'Ｌ' => 'L', 'Ｍ' => 'M', 'Ｎ' => 'N', 'Ｏ' => 'O',
            'Ｐ' => 'P', 'Ｑ' => 'Q', 'Ｒ' => 'R', 'Ｓ' => 'S', 'Ｔ' => 'T',
            'Ｕ' => 'U', 'Ｖ' => 'V', 'Ｗ' => 'W', 'Ｘ' => 'X', 'Ｙ' => 'Y',
            'Ｚ' => 'Z',
            'ａ' => 'a', 'ｂ' => 'b', 'ｃ' => 'c', 'ｄ' => 'd', 'ｅ' => 'e',
            'ｆ' => 'f', 'ｇ' => 'g', 'ｈ' => 'h', 'ｉ' => 'i', 'ｊ' => 'j',
            'ｋ' => 'k', 'ｌ' => 'l', 'ｍ' => 'm', 'ｎ' => 'n', 'ｏ' => 'o',
            'ｐ' => 'p', 'ｑ' => 'q', 'ｒ' => 'r', 'ｓ' => 's', 'ｔ' => 't',
            'ｕ' => 'u', 'ｖ' => 'v', 'ｗ' => 'w', 'ｘ' => 'x', 'ｙ' => 'y',
            'ｚ' => 'z',
            '０' => '0', '１' => '1', '２' => '2', '３' => '3', '４' => '4',
            '５' => '5', '６' => '6', '７' => '7', '８' => '8', '９' => '9',
            _ => c,
        }
    }).collect()
}

// ═══════════════════════════════════════════════════════════════════
// Step 2: Phát hiện .NET method call pattern
// ═══════════════════════════════════════════════════════════════════

fn detect_dotnet_call(input: &str) -> Option<String> {
    // Pattern: [System.IO.File]::ReadAllText, [System.IO.Directory]::...
    // Pattern: [System.Net.WebClient]::new()
    let dotnet_patterns = [
        "[System.IO",
        "[System.Net",
        "[System.Diagnostics",
        "[System.Management",
        "[System.Environment",
        "[System.Reflection",
        "[Microsoft",
        "[System.Security",
        "[System.Text",
        "[System.Web",
        "[System.Windows",
    ];
    for pat in &dotnet_patterns {
        if input.contains(pat) {
            return Some(format!(".NET method call detected: '{}' is blocked", pat));
        }
    }
    None
}

// ═══════════════════════════════════════════════════════════════════
// Step 3: Phát hiện dangerous patterns
// ═══════════════════════════════════════════════════════════════════

fn detect_dangerous_pattern(input: &str) -> Option<String> {
    let lower = input.to_lowercase();

    // PowerShell script block execution
    if lower.contains("& {") || lower.contains("&{") {
        return Some("Inline script block execution '& { ... }' is blocked".into());
    }

    // PowerShell module import dangerous
    if lower.contains("import-module") && (
        lower.contains("psexec") ||
        lower.contains("invoke") && !lower.contains("invoke-item")
    ) {
        return Some("Import-Module with potentially dangerous module is blocked".into());
    }

    // COM object creation
    if lower.contains("new-object") && (
        lower.contains("comobject") ||
        lower.contains("wscript.shell") ||
        lower.contains("shell.application") ||
        lower.contains("scripting.filesystemobject") ||
        lower.contains("internetexplorer")
    ) {
        return Some("COM object creation blocked".into());
    }

    // WinRM / PSRemoting
    if lower.contains("enter-pssession") || lower.contains("new-pssession") {
        return Some("PowerShell remote session execution blocked".into());
    }

    None
}

// ═══════════════════════════════════════════════════════════════════
// Step 4: Parse command chunks (pipeline-aware)
// ═══════════════════════════════════════════════════════════════════

/// Chia câu lệnh thành các chunk riêng biệt dựa trên pipe, chain operators
fn split_pipeline(input: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut in_subexpr = 0u32; // $(...)
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '\'' if !in_double => {
                in_single = !in_single;
                current.push(c);
            }
            '"' if !in_single => {
                in_double = !in_double;
                current.push(c);
            }
            '$' if !in_single && !in_double => {
                if chars.peek() == Some(&'(') {
                    in_subexpr += 1;
                    current.push(c);
                    current.push(chars.next().unwrap());
                } else {
                    current.push(c);
                }
            }
            '(' if !in_single && !in_double && in_subexpr > 0 => {
                in_subexpr += 1;
                current.push(c);
            }
            ')' if !in_single && !in_double && in_subexpr > 0 => {
                in_subexpr -= 1;
                current.push(c);
            }
            '|' if !in_single && !in_double && in_subexpr == 0 => {
                // Pipe: |
                if chars.peek() == Some(&'|') {
                    // || operator
                    chars.next();
                }
                if !current.trim().is_empty() {
                    chunks.push(current.trim().to_string());
                }
                current.clear();
            }
            '&' if !in_single && !in_double && in_subexpr == 0 => {
                if chars.peek() == Some(&'&') {
                    // && operator
                    chars.next();
                    if !current.trim().is_empty() {
                        chunks.push(current.trim().to_string());
                    }
                    current.clear();
                } else {
                    current.push(c);
                }
            }
            ';' if !in_single && !in_double && in_subexpr == 0 => {
                if !current.trim().is_empty() {
                    chunks.push(current.trim().to_string());
                }
                current.clear();
            }
            _ => { current.push(c); }
        }
    }
    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }

    chunks
}

// ═══════════════════════════════════════════════════════════════════
// Step 5: Phân tích từng command đơn lẻ
// ═══════════════════════════════════════════════════════════════════

fn analyze_single_command(input: &str, cwd: &Path, _workspace_root: &Path) -> AnalyzedCommand {
    let tokens = tokenize_smart(input);

    if tokens.is_empty() {
        return AnalyzedCommand {
            risk: RiskLevel::Safe,
            command_name: String::new(),
            resolved_paths: vec![],
            reason: None,
        };
    }

    let raw_cmd = &tokens[0];
    let cmd_lower = raw_cmd.to_lowercase();

    // Xác định tên command (handle path prefix: ./script, C:\path\to\program, ..\tool.exe)
    let command_name = extract_command_name(raw_cmd);

    // Xác định risk level
    let risk = classify_command(&command_name, &cmd_lower, &tokens, cwd);

    // Trích xuất paths từ arguments
    // Navigation (cd, sl, pushd) cũng cần extract paths để check boundary
    let resolved_paths = if risk >= RiskLevel::Medium || risk == RiskLevel::Safe {
        extract_and_resolve_paths(&tokens, &command_name, cwd)
    } else {
        vec![]
    };

    let reason = if risk == RiskLevel::Blocked {
        Some(format!("Command '{}' is not allowed in sandbox", command_name))
    } else {
        None
    };

    AnalyzedCommand {
        risk,
        command_name,
        resolved_paths,
        reason,
    }
}

/// Tokenize thông minh: tôn trọng quote, handle PowerShell syntax
fn tokenize_smart(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut in_subexpr = 0u32;
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '\'' if !in_double => {
                in_single = !in_single;
                current.push(c);
            }
            '"' if !in_single => {
                in_double = !in_double;
                current.push(c);
            }
            '$' if !in_single && !in_double => {
                if chars.peek() == Some(&'(') {
                    in_subexpr += 1;
                    current.push(c);
                    current.push(chars.next().unwrap());
                } else {
                    current.push(c);
                }
            }
            '(' if !in_single && !in_double && in_subexpr > 0 => {
                in_subexpr += 1;
                current.push(c);
            }
            ')' if !in_single && !in_double && in_subexpr > 0 => {
                in_subexpr -= 1;
                current.push(c);
            }
            ' ' | '\t' if !in_single && !in_double && in_subexpr == 0 => {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
            }
            _ => { current.push(c); }
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

/// Trích xuất tên command từ token, bỏ qua path prefix
fn extract_command_name(raw: &str) -> String {
    let clean = raw.trim_matches(|c| c == '\'' || c == '"');

    // Bỏ path prefix: ./script → script, ..\tool.exe → tool.exe
    if let Some(base) = clean.rsplit(|c| c == '/' || c == '\\').next() {
        // Bỏ extension .exe, .ps1, .cmd, .bat
        if let Some(dot) = base.rfind('.') {
            let ext = &base[dot..].to_lowercase();
            if ext == ".exe" || ext == ".ps1" || ext == ".cmd" || ext == ".bat" || ext == ".com" || ext == ".dll" {
                base[..dot].to_string()
            } else {
                base.to_string()
            }
        } else {
            base.to_string()
        }
    } else {
        clean.to_string()
    }
}

/// Xác định risk level dựa trên command name + context
fn classify_command(command_name: &str, cmd_lower: &str, tokens: &[String], _cwd: &Path) -> RiskLevel {
    // Kiểm tra command map trước
    if let Some(&risk) = command_risk_map().get(cmd_lower) {
        return risk;
    }

    // Handle alias: nếu tokens[1] là command thật
    if cmd_lower == "alias" && tokens.len() > 2 {
        // `alias name command` — check command thật
        let alias_target = tokens[2].to_lowercase();
        if let Some(&risk) = command_risk_map().get(alias_target.as_str()) {
            return risk;
        }
    }

    // Handle PowerShell function definition
    if cmd_lower == "function" && tokens.len() > 2 {
        // Check nội dung function có gọi dangerous command không
        // Block để an toàn
        return RiskLevel::Blocked;
    }

    // Script execution: `.\script.ps1`, `./tool.exe`, `C:\path\to\script.bat`
    if command_name != cmd_lower && !command_name.is_empty() {
        // Nếu là script execution, resolve path và check
        return RiskLevel::Critical;
    }

    // Unknown command → allow nhưng watch paths
    if contains_known_path_command(cmd_lower) {
        return RiskLevel::Medium;
    }

    RiskLevel::Low
}

/// Kiểm tra nếu argument chứa lệnh xử lý path
fn contains_known_path_command(input: &str) -> bool {
    let path_cmds = [
        "get-", "set-", "remove-", "new-", "copy-", "move-",
        "read-", "write-", "out-", "select-", "where-", "foreach-",
        "format-", "sort-", "group-", "measure-", "compare-",
        "join-", "split-", "test-",
    ];
    for prefix in &path_cmds {
        if input.starts_with(prefix) {
            return true;
        }
    }
    false
}

// ═══════════════════════════════════════════════════════════════════
// Step 6: Trích xuất và resolve paths
// ═══════════════════════════════════════════════════════════════════

fn extract_and_resolve_paths(tokens: &[String], command_name: &str, cwd: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let cmd_lower = command_name.to_lowercase();

    // Với cd, pushd, set-location: argument đầu tiên là path đích
    if matches!(cmd_lower.as_str(), "cd" | "sl" | "pushd" | "set-location") {
        if tokens.len() > 1 {
            let raw = tokens[1].trim_matches(|c| c == '\'' || c == '"');
            // Interpolate all ~ and $HOME references
            let resolved = interpolate_path(raw, cwd);
            paths.push(PathBuf::from(resolved));
        }
        return paths;
    }

    // Với các lệnh file operation: các arguments là paths
    for token in tokens.iter().skip(1) {
        let clean = token.trim_matches(|c| c == '\'' || c == '"');
        if is_path_like(clean) {
            let resolved = interpolate_path(clean, cwd);
            paths.push(PathBuf::from(resolved));
        }
    }

    paths
}

/// Nội suy path: resolve ~, $HOME, $env:VAR, relative paths
fn interpolate_path(raw: &str, cwd: &Path) -> String {
    let s = raw.trim();

    // Trường hợp đặc biệt: `~` hoặc `~...`
    if s.starts_with('~') {
        if let Some(home) = get_home_dir() {
            if s.len() == 1 {
                // `~` → $HOME
                return home;
            } else if s.as_bytes().get(1) == Some(&b'/') || s.as_bytes().get(1) == Some(&b'\\') {
                // `~/path` hoặc `~\path`
                return format!("{}{}", home, &s[1..]);
            } else {
                // `~cd`, `~something` — vẫn resolve về $HOME + phần còn lại
                // Trên Windows, `~cd` sẽ resolve thành $HOME\cd (nếu cd là folder con)
                return format!("{}\\{}", home, &s[1..]);
            }
        }
        // Fallback: nếu không lấy được home, trả về raw
        return s.to_string();
    }

    // Environment variables: $HOME, $env:USERPROFILE, ${env:SYSTEMROOT}
    let resolved = resolve_env_vars(s);

    let p = PathBuf::from(&resolved);

    // Resolve path: canonicalize nếu được, fallback về raw path
    let final_path = if p.is_relative() {
        let combined = cwd.join(&p);
        std::fs::canonicalize(&combined).unwrap_or(combined)
    } else {
        std::fs::canonicalize(&p).unwrap_or(p)
    };

    final_path.to_string_lossy().to_string()
}

fn get_home_dir() -> Option<String> {
    // Windows: USERPROFILE
    #[cfg(target_os = "windows")]
    {
        if let Ok(val) = std::env::var("USERPROFILE") {
            return Some(val);
        }
    }
    // Unix: HOME
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(val) = std::env::var("HOME") {
            return Some(val);
        }
    }
    None
}

fn resolve_env_vars(s: &str) -> String {
    let mut result = String::new();
    let mut chars = s.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '$' {
            if chars.peek() == Some(&'(') {
                // $(...) subexpression — skip
                result.push('$');
                result.push('(');
                let mut depth = 1u32;
                while let Some(&next) = chars.peek() {
                    if next == '(' { depth += 1; }
                    else if next == ')' {
                        depth -= 1;
                        if depth == 0 {
                            chars.next();
                            break;
                        }
                    }
                    result.push(chars.next().unwrap());
                }
                result.push(')');
            } else if chars.peek() == Some(&'{') {
                // ${env:VAR} hoặc ${VAR}
                chars.next(); // consume {
                let mut var_name = String::new();
                while let Some(&next) = chars.peek() {
                    if next == '}' { chars.next(); break; }
                    var_name.push(chars.next().unwrap());
                }
                result.push_str(&resolve_single_env(&var_name));
            } else {
                // $HOME, $env:USERPROFILE
                let mut var_name = String::new();
                while let Some(&next) = chars.peek() {
                    if next.is_alphanumeric() || next == '_' || next == ':' {
                        var_name.push(chars.next().unwrap());
                    } else { break; }
                }
                result.push_str(&resolve_single_env(&var_name));
            }
        } else {
            result.push(c);
        }
    }

    result
}

fn resolve_single_env(var: &str) -> String {
    // Handle $env:VAR pattern
    if let Some(val) = var.strip_prefix("env:") {
        return std::env::var(val).unwrap_or_else(|_| format!("$env:{}", val));
    }
    // Handle common PowerShell variables
    match var.to_uppercase().as_str() {
        "HOME" | "HOMEPATH" => {
            get_home_dir().unwrap_or_else(|| format!("${}", var))
        }
        "PWD" => {
            std::env::current_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| format!("${}", var))
        }
        "NULL" => "\\\\.\\NUL".to_string(),
        _ => std::env::var(var).unwrap_or_else(|_| format!("${}", var)),
    }
}

fn is_path_like(token: &str) -> bool {
    let t = token.trim_matches(|c| c == '\'' || c == '"');
    if t.is_empty() { return false; }

    // Windows absolute: C:\...
    if t.len() >= 3
        && t.as_bytes()[0].is_ascii_alphabetic()
        && t.as_bytes()[1] == b':'
        && (t.as_bytes()[2] == b'\\' || t.as_bytes()[2] == b'/')
    {
        return true;
    }

    // UNC path: \\server\share
    if t.starts_with("\\\\") || t.starts_with("//") { return true; }

    // Unix absolute: /...
    if t.starts_with('/') { return true; }

    // Relative: chứa separator
    if t.contains('\\') || t.contains('/') { return true; }

    // Starts with ~, $HOME, $env:
    if t.starts_with('~') || t.starts_with("$HOME") || t.starts_with("$env:") { return true; }

    // Starts with ../
    if t.starts_with("..") { return true; }

    // PowerShell drive: variable: (e.g., env:SYSTEMROOT, function:Get-ChildItem)
    if t.contains(':') && !t.contains("://") {
        let parts: Vec<&str> = t.splitn(2, ':').collect();
        if parts.len() == 2 {
            let drive = parts[0].to_lowercase();
            // C: is a drive letter, not a PS drive
            if drive.len() == 1 && drive.as_bytes()[0].is_ascii_alphabetic() {
                return false; // Already handled above
            }
            // PS provider drives
            match drive.as_str() {
                "env" | "cert" | "function" | "variable" | "alias" |
                "hkcu" | "hklm" | "wsman" => return true,
                _ => {}
            }
        }
    }

    false
}

// ═══════════════════════════════════════════════════════════════════
// Boundary check
// ═══════════════════════════════════════════════════════════════════

fn check_paths_outside_workspace(paths: &[PathBuf], workspace_root: &Path) -> Option<String> {
    for p in paths {
        if p.as_os_str().is_empty() {
            continue;
        }

        let resolved = std::fs::canonicalize(p).unwrap_or_else(|_| p.clone());
        let rp = resolved.to_string_lossy();
        let ws = workspace_root.to_string_lossy();

        // Strip Windows long path prefix (\\\\?\ or \\\?\UNC\) for comparison
        let rp_clean = strip_win_prefix(&rp);
        let ws_clean = strip_win_prefix(&ws);

        if rp_clean.to_lowercase().starts_with(&ws_clean.to_lowercase()) {
            continue;
        }

        return Some(format!(
            "Path '{}' resolves outside workspace boundary",
            p.display()
        ));
    }
    None
}

/// Strip Windows \\\?\ prefix using simple byte check:
/// - \\\?\ → removes first 4 chars (2 backslashes + ? + 1 backslash)
/// - \\\?\UNC\ → converts to \\\\server\share format
fn strip_win_prefix(s: &str) -> String {
    let bytes = s.as_bytes();
    if bytes.len() >= 4 && bytes[0] == b'\\' && bytes[1] == b'\\'
        && bytes[2] == b'?' && bytes[3] == b'\\'
    {
        if bytes.len() >= 8 && bytes[4] == b'U' && bytes[5] == b'N'
            && bytes[6] == b'C' && bytes[7] == b'\\'
        {
            // \\\?\UNC\server\share → \\\\server\share
            let rest = &s[8..];
            return format!("\\{}", rest);
        }
        // \\\?\C:\... → C:\...
        return s[4..].to_string();
    }
    s.to_string()
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    fn ws() -> PathBuf { PathBuf::from(r"C:\workspace") }
    fn cwd() -> PathBuf { PathBuf::from("C:\\workspace\\project") }

    #[test]
    fn test_safe_commands() {
        assert_eq!(intercept("echo hello", &cwd(), &ws()), super::super::Verdict::Allow);
        assert_eq!(intercept("ls", &cwd(), &ws()), super::super::Verdict::Allow);
        assert_eq!(intercept("pwd", &cwd(), &ws()), super::super::Verdict::Allow);
        assert_eq!(intercept("clear", &cwd(), &ws()), super::super::Verdict::Allow);
    }

    #[test]
    fn test_blocked_commands() {
        assert!(matches!(
            intercept("Invoke-Expression 'Get-Content C:\\Windows\\win.ini'", &cwd(), &ws()),
            super::super::Verdict::Block { .. }
        ));
        assert!(matches!(
            intercept("reg query HKLM", &cwd(), &ws()),
            super::super::Verdict::Block { .. }
        ));
    }

    #[test]
    fn test_dotnet_detection() {
        assert!(matches!(
            intercept("[System.IO.File]::ReadAllText('C:\\test.txt')", &cwd(), &ws()),
            super::super::Verdict::Block { .. }
        ));
    }

    #[test]
    fn test_cd_workspace_allowed() {
        // Không dùng temp dir thực tế (Windows canonicalize thêm \\?\ prefix gây rắc rối)
        // Dùng path đơn giản không cần tồn tại trên disk
        let ws = PathBuf::from("C:\\workspace");
        let cwd = PathBuf::from("C:\\workspace\\project");

        // cd . — path ở current dir, trong workspace → Allow
        assert_eq!(intercept("cd .", &cwd, &ws), super::super::Verdict::Allow);

        // cd alone → workspace root
        assert_eq!(intercept("cd", &cwd, &ws), super::super::Verdict::Allow);
    }

    #[test]
    fn test_cd_with_tilde_bypass() {
        // cd ~cd → resolves to $HOME/cd
        // Nếu $HOME nằm ngoài workspace → Block, nếu không → Allow
        // Quan trọng: interceptor phải resolve ~ đúng cách
        let home = get_home_dir().unwrap_or_else(|| "C:\\Users\\test".to_string());
        let cmd = format!("cd ~cd");
        let v = intercept(&cmd, &cwd(), &ws());
        if home.starts_with("C:\\workspace") {
            // Home is inside workspace → allow
            assert_eq!(v, super::super::Verdict::Allow);
        } else {
            // Home is outside workspace → block
            assert!(matches!(v, super::super::Verdict::Block { .. }));
        }
    }

    #[test]
    fn test_env_var_resolution() {
        let r = resolve_env_vars("$env:USERPROFILE\\test");
        assert!(r.contains("\\test"));
    }

    #[test]
    fn test_tilde_resolution() {
        let r = interpolate_path("~/subdir", &cwd());
        assert!(r.contains("subdir"));
    }

    #[test]
    fn test_split_pipeline() {
        let chunks = split_pipeline("cd src && dir | findstr test");
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0], "cd src");
        assert!(chunks[1].contains("dir"));
    }

    #[test]
    fn test_dangerous_script_block() {
        assert!(matches!(
            detect_dangerous_pattern("& { Get-Content C:\\test.txt }"),
            Some(_)
        ));
    }
}
