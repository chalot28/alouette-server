use std::path::{Path, PathBuf};
use super::engine::{self, Verdict};

fn get_home_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    { std::env::var("USERPROFILE").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("C:\\")) }
    #[cfg(not(target_os = "windows"))]
    { std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/")) }
}

fn extract_cd_target(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if !trimmed.starts_with("cd") { return None; }
    let rest = trimmed[2..].trim();
    if rest.is_empty() { return Some("~".to_string()); }
    let target = rest.trim_matches('"').trim_matches('\'').trim();
    if target.is_empty() { return Some("~".to_string()); }
    Some(target.to_string())
}

fn resolve_extracted(target: &str, cwd: &Path) -> PathBuf {
    if target == "~" || target == "~/" { return get_home_dir(); }
    if let Some(rest) = target.strip_prefix("~/").or_else(|| target.strip_prefix("~\\")) {
        return get_home_dir().join(rest);
    }
    let p = PathBuf::from(target);
    if p.is_absolute() { norm(&p) } else { norm(&cwd.join(&p)) }
}

fn norm(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| {
        let mut r = PathBuf::new();
        for comp in p.components() {
            match comp {
                std::path::Component::ParentDir => { r.pop(); }
                std::path::Component::CurDir => {}
                other => { r.push(other); }
            }
        }
        r
    })
}

pub fn intercept(input: &str, cwd: &Path, workspace_root: &Path) -> Verdict {
    let trimmed = input.trim();
    if trimmed.is_empty() { return Verdict::Allow; }

    if let Some(target) = extract_cd_target(trimmed) {
        let resolved = resolve_extracted(&target, cwd);
        if !resolved.starts_with(workspace_root) {
            return Verdict::Block {
                reason: format!("cd target '{}' resolves to '{}', outside workspace", target, resolved.display()),
            };
        }
        return Verdict::Allow;
    }

    if let Some(pos) = trimmed.find('>') {
        let after = trimmed[pos+1..].trim();
        if !after.is_empty() {
            let file = after.splitn(2, |c| c == ' ' || c == '>').next().unwrap_or("")
                .trim().trim_matches('"').trim_matches('\'');
            if !file.is_empty() {
                let resolved = resolve_extracted(file, cwd);
                if !resolved.starts_with(workspace_root) {
                    return Verdict::Block {
                        reason: format!("redirect target '{}' resolves to '{}', outside workspace", file, resolved.display()),
                    };
                }
            }
        }
    }

    engine::check(input, cwd, workspace_root)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_intercept_cd_dotdot_blocked() {
        assert!(matches!(intercept("cd..", Path::new("/tmp/ws"), Path::new("/tmp/ws")), Verdict::Block { .. }));
    }
    #[test]
    fn test_intercept_cd_subdir_allowed() {
        assert_eq!(intercept("cd subdir", Path::new("/tmp/ws"), Path::new("/tmp/ws")), Verdict::Allow);
    }
    #[test]
    fn test_extract_cd_target_no_space() {
        assert_eq!(extract_cd_target("cd.."), Some("..".to_string()));
    }
    #[test]
    fn test_extract_cd_target_tilde() {
        assert_eq!(extract_cd_target("cd ~"), Some("~".to_string()));
        assert_eq!(extract_cd_target("cd"), Some("~".to_string()));
    }
}
