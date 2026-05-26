//! # Windows AppContainer Sandbox — Tầng 2
//!
//! Sử dụng AppContainer API để chạy PowerShell trong môi trường cách ly
//! kernel-level. Mọi truy cập file, registry, network ngoài workspace
//! đều bị Windows chặn cứng.
//!
//! #cfg(windows) — Chỉ compile trên Windows.

use std::path::Path;

/// Kết quả spawn trong AppContainer
#[derive(Debug)]
pub enum ContainerResult {
    /// Thành công, trả về process ID
    Spawned { pid: u32 },
    /// Không support (Windows version quá cũ)
    Unsupported { reason: String },
    /// Lỗi
    Error { reason: String },
}

/// Kiểm tra Windows version có support AppContainer không.
/// AppContainer có từ Windows 8 (6.2).
pub fn is_supported() -> bool {
    // Cách đơn giản: thử tạo AppContainer profile, nếu lỗi thì unsupported
    // Ở phase này, return false để fallback về engine-only sandbox
    // TODO: Implement properly with windows crate
    false
}

/// Tạo AppContainer profile và spawn process trong đó.
///
/// - `workspace_root`: Thư mục được grant full access
/// - `shell_exe`: Path đến powershell.exe
/// - `cwd`: Working directory cho process
///
/// Trả về process ID nếu thành công.
pub fn spawn_in_appcontainer(
    _workspace_root: &Path,
    _shell_exe: &str,
    _cwd: &Path,
) -> ContainerResult {
    // TODO: Implement with windows crate
    // Steps:
    // 1. CreateAppContainerProfile("AlouetteSandbox", ...)
    // 2. DeriveAppContainerSidFromAppContainerName → get SID
    // 3. Grant SID access to workspace_root via SetFileSecurity
    // 4. Grant SID read/execute to System32 (for PowerShell)
    // 5. InitializeProcThreadAttributeList
    // 6. UpdateProcThreadAttribute with SECURITY_CAPABILITIES
    // 7. CreateProcessAsUser or CreateProcess with EXTENDED_STARTUPINFO
    // 8. Return PID

    ContainerResult::Unsupported {
        reason: "AppContainer not yet implemented. Windows support pending.".to_string(),
    }
}
