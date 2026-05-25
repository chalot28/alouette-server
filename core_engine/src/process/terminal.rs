//! # Terminal

use std::path::PathBuf;
use tokio::sync::{broadcast, mpsc};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};

use super::models::{TerminalOutput, TerminalSession, TerminalWriteContext};
use super::manager::ProcessManager;

impl ProcessManager {
    pub fn subscribe_terminal(&self) -> broadcast::Receiver<TerminalOutput> {
        self.terminal_sender.subscribe()
    }

    pub fn get_terminal_write_context(
        &self,
        session_id: &str,
    ) -> Result<TerminalWriteContext, String> {
        let session = self
            .terminal_sessions
            .get(session_id)
            .ok_or_else(|| format!("Terminal session '{session_id}' not found"))?;
        Ok(TerminalWriteContext {
            stdin_sender: session.stdin_sender.clone(),
            terminal_sender: self.terminal_sender.clone(),
        })
    }

    pub async fn spawn_terminal(
        &mut self,
        session_id: &str,
        cwd: Option<&str>,
    ) -> Result<(), String> {
        let sid = session_id.to_string();
        let _ = self.kill_terminal(&sid).await;

        let abs_root = cwd.unwrap_or(".");
        let abs_root = std::fs::canonicalize(abs_root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| abs_root.to_string());

        let proto_home = &self.proto_manager.proto_home;
        let mut envs: Vec<(String, String)> = vec![
            ("PROTO_HOME".into(), proto_home.to_string_lossy().to_string()),
            ("WORKSPACE_ROOT".into(), abs_root.clone()),
        ];
        if let Ok(existing_path) = std::env::var("PATH") {
            let full = std::env::join_paths(
                std::iter::once(proto_home.join("bin"))
                    .chain(std::iter::once(proto_home.join("shims")))
                    .chain(std::env::split_paths(&existing_path)),
            )
            .unwrap_or_else(|_| existing_path.into());
            envs.push(("PATH".into(), full.to_string_lossy().to_string()));
        }

        // DEBUG: prompt shows full current path
        let prompt = r#"function global:prompt { "$((Get-Location).Path)> " }"#.to_string();

        let tmp_dir = std::env::temp_dir().join("alouette_term");
        let _ = std::fs::create_dir_all(&tmp_dir);
        let profile_path = tmp_dir.join(format!("prompt_{sid}.ps1"));
        let _ = std::fs::write(&profile_path, prompt.replace('\n', "\r\n"));
        self._prompt_files.insert(sid.clone(), profile_path.clone());

        let pty_system = native_pty_system();
        let pty = pty_system
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("PTY open: {e}"))?;

        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.arg("-NoLogo");
        cmd.arg("-NoExit");
        cmd.arg("-File");
        cmd.arg(profile_path.to_string_lossy().to_string());
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }
        for (k, v) in &envs {
            cmd.env(k, v);
        }

        let child: Box<dyn portable_pty::Child + Send + Sync> = pty.slave.spawn_command(cmd)
            .map_err(|e| format!("Spawn powershell.exe: {e}"))?;
        let pid = child.process_id().unwrap_or(0);
        eprintln!("[terminal] Spawned '{sid}' PID {pid}");

        let writer = pty.master.take_writer()
            .map_err(|e| format!("PTY writer: {e}"))?;
        let reader = pty.master.try_clone_reader()
            .map_err(|e| format!("PTY reader: {e}"))?;

        let (tx, mut rx) = mpsc::channel::<String>(256);
        let sid_w = sid.clone();
        let sid_r = sid.clone();

        std::thread::spawn(move || {
            let mut w = writer;
            while let Some(input) = rx.blocking_recv() {
                if std::io::Write::write_all(&mut w, input.as_bytes()).is_err() {
                    eprintln!("[terminal] '{sid_w}' writer closed");
                    break;
                }
                let _ = std::io::Write::flush(&mut w);
            }
        });

        let out_tx = self.terminal_sender.clone();
        std::thread::spawn(move || {
            let mut r = reader;
            let mut buf = [0u8; 4096];
            loop {
                match std::io::Read::read(&mut r, &mut buf) {
                    Ok(0) => { eprintln!("[terminal] '{sid_r}' EOF"); break; }
                    Ok(n) => { let _ = out_tx.send(TerminalOutput {
                        session_id: sid_r.clone(),
                        text: String::from_utf8_lossy(&buf[..n]).into_owned(),
                    }); }
                    Err(e) => { eprintln!("[terminal] '{sid_r}' read: {e}"); break; }
                }
            }
        });

        let pty_ptr = Box::into_raw(Box::new(pty));
        self._pty_pairs.insert(sid.clone(), pty_ptr as usize);

        self.terminal_sessions.insert(sid.clone(), TerminalSession {
            stdin_sender: tx,
            pid,
            workspace_root: PathBuf::from(&abs_root),
            _child: Some(child),
        });

        let hb_tx = self.terminal_sender.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
            let _ = hb_tx.send(TerminalOutput { session_id: sid, text: String::new() });
        });

        Ok(())
    }

    pub async fn kill_terminal(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(s) = self.terminal_sessions.remove(session_id) {
            eprintln!("[terminal] Kill '{session_id}' PID {}", s.pid);
            super::tree::terminate_process_tree(s.pid).await;
        }
        if let Some(ptr) = self._pty_pairs.remove(session_id) {
            let _ = unsafe { Box::from_raw(ptr as *mut portable_pty::PtyPair) };
        }
        if let Some(path) = self._prompt_files.remove(session_id) {
            let _ = std::fs::remove_file(&path);
        }
        Ok(())
    }
}

pub async fn process_and_send_terminal_input(
    _session_id: &str,
    mut text: String,
    ctx: &TerminalWriteContext,
) -> Result<(), String> {
    if text.ends_with('\n') && !text.ends_with("\r\n") {
        text.pop();
        text.push_str("\r\n");
    }
    ctx.stdin_sender.send(text).await
        .map_err(|e| format!("Terminal send: {e}"))
}
