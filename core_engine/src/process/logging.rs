use chrono::Utc;
use std::path::Path;
use tokio::fs;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use super::models::ProcessLog;

fn rotate_log_file(path: &Path, max_bytes: u64) -> std::io::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let metadata = std::fs::metadata(path)?;
    if metadata.len() < max_bytes {
        return Ok(());
    }

    // Rotate .log.4 -> .log.5, .log.3 -> .log.4 etc.
    for i in (1..5).rev() {
        let old_path = path.with_extension(format!("log.{}", i));
        let new_path = path.with_extension(format!("log.{}", i + 1));
        if old_path.exists() {
            let _ = std::fs::rename(&old_path, &new_path);
        }
    }
    let first_backup = path.with_extension("log.1");
    let _ = std::fs::rename(path, &first_backup);

    // Purge files older than 7 days
    if let Some(parent) = path.parent() {
        if let Ok(entries) = std::fs::read_dir(parent) {
            let now = std::time::SystemTime::now();
            let seven_days = std::time::Duration::from_secs(7 * 24 * 60 * 60);
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if entry_path.is_file() {
                    let extension = entry_path.extension().and_then(|s| s.to_str()).unwrap_or("");
                    if extension.starts_with("log.") {
                        if let Ok(meta) = entry.metadata() {
                            if let Ok(modified) = meta.modified() {
                                if let Ok(age) = now.duration_since(modified) {
                                    if age > seven_days {
                                        let _ = std::fs::remove_file(entry_path);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

pub(crate) async fn write_log_with_rotation(
    file: &mut Option<fs::File>,
    path: &Path,
    data: &[u8],
    max_bytes: u64,
) -> std::io::Result<()> {
    let mut check_rotation = false;
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() >= max_bytes {
            check_rotation = true;
        }
    }

    if check_rotation {
        *file = None; // Release lock on Windows
        let _ = rotate_log_file(path, max_bytes);
        *file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .await
            .ok();
    }

    if let Some(ref mut f) = file {
        f.write_all(data).await?;
        f.flush().await?;
    }
    Ok(())
}

/// Helper function to asynchronously append tracking message lines to the partition log file.
pub(crate) async fn append_log_line(path: &Path, text: &str, max_bytes: u64) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
        .ok();
    let timestamp = Utc::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let log_line = format!("[{}] SYSTEM: {}\n", timestamp, text);
    write_log_with_rotation(&mut file, path, log_line.as_bytes(), max_bytes).await?;
    Ok(())
}

/// Helper to pipe tokio stdout/stderr lines to file and emit events.
pub(crate) async fn pipe_stream<R>(
    stream: R,
    project_id: String,
    stream_name: String,
    log_path: std::path::PathBuf,
    sender: tokio::sync::broadcast::Sender<ProcessLog>,
    max_bytes: u64,
) where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut reader = BufReader::new(stream).lines();
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .await
        .ok();

    while let Ok(Some(line)) = reader.next_line().await {
        let timestamp = Utc::now().timestamp_millis() as u64;

        // Write dynamically to partition log
        let log_prefix = format!("[{}] [{}] {}\n", Utc::now().format("%H:%M:%S%.3f"), stream_name, line);
        let _ = write_log_with_rotation(&mut file, &log_path, log_prefix.as_bytes(), max_bytes).await;

        // Broadcast to channels
        let log = ProcessLog {
            project_id: project_id.clone(),
            stream: stream_name.clone(),
            text: line,
            timestamp,
        };
        let _ = sender.send(log);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_log_rotation() {
        let temp_dir = std::env::temp_dir();
        let log_dir = temp_dir.join("alouette_test_logs_rotation");
        let _ = std::fs::create_dir_all(&log_dir);

        let log_file = log_dir.join("rotation_test.log");
        let max_bytes = 10; // small limit to trigger quickly

        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file)
            .await
            .ok();

        let res1 = write_log_with_rotation(&mut file, &log_file, b"Line 1: very long line exceeding 10 bytes\n", max_bytes).await;
        assert!(res1.is_ok());

        let res2 = write_log_with_rotation(&mut file, &log_file, b"Line 2: very long line exceeding 10 bytes\n", max_bytes).await;
        assert!(res2.is_ok());

        let res3 = write_log_with_rotation(&mut file, &log_file, b"Line 3: very long line exceeding 10 bytes\n", max_bytes).await;
        assert!(res3.is_ok());

        assert!(log_file.exists());
        let backup1 = log_file.with_extension("log.1");
        let backup2 = log_file.with_extension("log.2");
        assert!(backup1.exists());
        assert!(backup2.exists());

        let _ = std::fs::remove_dir_all(log_dir);
    }
}
