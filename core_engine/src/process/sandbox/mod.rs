//! # Sandbox Module — 2 tầng bảo vệ
//!
//! ## Tầng 1 — interceptor (thuật toán nội suy)
//! Phân tích câu lệnh ở mức ngữ nghĩa, trích xuất paths đích.
//!
//! ## Tầng 1b — engine (cross-platform fallback)
//! Tokenize + path checking cơ bản.
//!
//! ## Tầng 2 — OS-specific
//! - `windows.rs`: AppContainer kernel-level sandbox
//! - `linux.rs`: (placeholder)
//! - `macos.rs`: (placeholder)

pub mod engine;
pub mod interceptor;
pub mod linux;
pub mod macos;

pub mod windows;

pub use engine::Verdict;

/// Kiểm tra toàn bộ câu lệnh trước khi gửi đến shell.
///
/// Sử dụng interceptor (thuật toán nội suy) trước,
/// fallback về engine nếu interceptor không phát hiện.
pub fn check_command(input: &str, cwd: &std::path::Path, workspace_root: &std::path::Path) -> Verdict {
    // Tầng 1a: Interceptor — nội suy ngữ nghĩa
    let v = interceptor::intercept(input, cwd, workspace_root);
    if v != Verdict::Allow {
        return v;
    }

    // Tầng 1b: Engine — tokenize + path checking
    let v = engine::check(input, cwd, workspace_root);
    if v != Verdict::Allow {
        return v;
    }

    Verdict::Allow
}

/// Kiểm tra OS có support OS-level sandbox không.
pub fn is_os_sandbox_supported() -> bool {
    #[cfg(target_os = "windows")]
    {
        windows::is_supported()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}
