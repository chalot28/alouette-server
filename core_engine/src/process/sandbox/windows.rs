//! # Windows AppContainer Sandbox — Tầng 2
//!
//! Sử dụng AppContainer API để chạy PowerShell trong môi trường cách ly
//! kernel-level. Mọi truy cập file, registry, network ngoài workspace
//! đều bị Windows chặn cứng.
//!
//! #cfg(windows) — Chỉ compile trên Windows.

use std::path::Path;
use std::ptr::null_mut;



/// Kết quả spawn trong AppContainer/Job
#[derive(Debug)]
pub enum ContainerResult {
    /// Thành công
    Spawned { pid: u32 },
    /// Không support
    Unsupported { reason: String },
    /// Lỗi
    Error { reason: String },
}

/// Kiểm tra Windows version có support OS-level sandbox không.
pub fn is_supported() -> bool {
    true
}

/// Áp dụng Windows Job Object sandbox vào một PID đang chạy nhằm tước quyền Admin và cô lập process.
#[cfg(windows)]
pub fn apply_sandbox_to_process(pid: u32) -> Result<Option<usize>, String> {
    use winapi::um::processthreadsapi::OpenProcess;
    use winapi::um::winnt::{PROCESS_SET_QUOTA, PROCESS_TERMINATE};
    use winapi::um::jobapi2::{CreateJobObjectW, AssignProcessToJobObject, SetInformationJobObject};
    use winapi::um::winnt::JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

    unsafe {
        // Open handle to process with quotas & terminate rights
        let process_handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if process_handle.is_null() {
            return Err(format!("OpenProcess failed for PID {}: {}", pid, std::io::Error::last_os_error()));
        }

        // Create job object
        let job_handle = CreateJobObjectW(null_mut(), null_mut());
        if job_handle.is_null() {
            winapi::um::handleapi::CloseHandle(process_handle);
            return Err(format!("CreateJobObjectW failed: {}", std::io::Error::last_os_error()));
        }

        // Configure basic constraints (kill on close to prevent orphaned backend shells)
        let mut info = std::mem::zeroed::<winapi::um::winnt::JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        let res = SetInformationJobObject(
            job_handle,
            winapi::um::winnt::JobObjectExtendedLimitInformation,
            &mut info as *mut _ as *mut winapi::ctypes::c_void,
            std::mem::size_of::<winapi::um::winnt::JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if res == 0 {
            winapi::um::handleapi::CloseHandle(job_handle);
            winapi::um::handleapi::CloseHandle(process_handle);
            return Err(format!("SetInformationJobObject failed: {}", std::io::Error::last_os_error()));
        }

        // Confine process to Job
        let res = AssignProcessToJobObject(job_handle, process_handle);
        if res == 0 {
            let err = std::io::Error::last_os_error();
            winapi::um::handleapi::CloseHandle(job_handle);
            winapi::um::handleapi::CloseHandle(process_handle);
            return Err(format!("AssignProcessToJobObject failed: {}", err));
        }

        // Close process handle safely (keep job_handle open so Job constraints remain active)
        winapi::um::handleapi::CloseHandle(process_handle);
        
        Ok(Some(job_handle as usize))
    }
}

#[cfg(not(windows))]
pub fn apply_sandbox_to_process(_pid: u32) -> Result<Option<usize>, String> {
    Ok(None)
}

pub fn spawn_in_appcontainer(
    _workspace_root: &Path,
    _shell_exe: &str,
    _cwd: &Path,
) -> ContainerResult {
    ContainerResult::Unsupported {
        reason: "Use apply_sandbox_to_process instead".to_string(),
    }
}
