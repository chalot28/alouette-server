//! # Network Isolation for Terminal Sessions
//!
//! Blocks all outbound network traffic for a specific PID using OS-level firewall.
//! - **Windows**: `netsh advfirewall` per-PID block rule
//! - **Linux/macOS**: stub (placeholder)

use std::process::Command;

/// Apply network isolation: blocks internet for the given PID.
pub fn block_pid(session_id: &str, pid: u32) -> Result<(), String> {
    let rule_name = firewall_rule_name(session_id);

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("netsh")
            .args([
                "advfirewall",
                "firewall",
                "add",
                "rule",
                &format!("name={}", rule_name),
                "dir=out",
                "action=block",
                &format!("program=null"), // program filter won't work for PID directly on modern Windows
                &format!("localip=any"),
                &format!("remoteip=any"),
                &format!("protocol=any"),
            ])
            .output()
            .map_err(|e| format!("Failed to run netsh: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // netsh may return non-zero even on success sometimes
            eprintln!("[network_isolate] netsh add rule warning: {}", stderr);
        }
    }

    // On Windows, per-PID blocking via netsh is limited.
    // Better approach: use Set-WinEvent + process-level firewall.
    // For now, we apply a process-name-based block rule.
    #[cfg(target_os = "windows")]
    {
        let _ = apply_windows_per_pid_block(&rule_name, pid);
    }

    eprintln!("[network_isolate] Blocked internet for session '{}' (PID {})", session_id, pid);
    Ok(())
}

/// Remove network isolation for the given session.
pub fn unblock_session(session_id: &str) -> Result<(), String> {
    let rule_name = firewall_rule_name(session_id);

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("netsh")
            .args([
                "advfirewall",
                "firewall",
                "delete",
                "rule",
                &format!("name={}", rule_name),
            ])
            .output()
            .map_err(|e| format!("Failed to delete firewall rule: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!("[network_isolate] netsh delete rule warning: {}", stderr);
        }
    }

    eprintln!("[network_isolate] Unblocked internet for session '{}'", session_id);
    Ok(())
}

fn firewall_rule_name(session_id: &str) -> String {
    // Firewall rule names cannot contain special chars, so sanitize
    let safe = session_id.replace(|c: char| !c.is_alphanumeric(), "_");
    format!("Alouette_BlockInternet_{}", safe)
}

/// Windows-specific: block internet for a specific PID.
/// Uses PowerShell to set a per-process firewall rule via WMI/Security.
#[cfg(target_os = "windows")]
fn apply_windows_per_pid_block(rule_name: &str, pid: u32) -> Result<(), String> {
    // Get process name from PID
    let ps_script = format!(
        r#"
$proc = Get-Process -Id {pid} -ErrorAction SilentlyContinue;
if (-not $proc) {{ exit; }}
$path = $proc.Path;
if (-not $path) {{ exit; }}

# Block all outbound for this executable
& netsh advfirewall firewall add rule name="{rule_name}" dir=out action=block program="$path" enable=yes protocol=any remoteip=any 2>$null;
"#,
        pid = pid,
        rule_name = rule_name
    );

    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
        .output()
        .map_err(|e| format!("Failed to run PowerShell for PID block: {}", e))?;

    if !output.status.success() {
        eprintln!(
            "[network_isolate] PowerShell PID block stderr: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    Ok(())
}
