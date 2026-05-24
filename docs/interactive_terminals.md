# Isolated Interactive Terminal Shells

This document outlines the design and implementation of sandboxed interactive shell terminal sessions in Alouette Server.

---

## 1. Overview of Interactive Shell Session Architecture

In addition to piped logging pipelines, Alouette Server incorporates active, real-time command shell sessions for each active project. Rather than limiting each project to a single terminal, developers can create **multiple independent, concurrent terminal sessions** inside the project's isolated workspace.

This lets developers run different build tasks, tests, or interactive tools side-by-side inside the sandboxed environment with shadowed paths (Node, Go, Python toolchains) without polluting their global OS.

```text
  React Front-End UI             Tauri App Wrapper           core_engine Library
 ┌──────────────────┐           ┌─────────────────┐         ┌───────────────────┐
 │ TerminalPanel.tsx│           │    main.rs      │         │    process.rs     │
 │                  │           │                 │         │                   │
 │   Inputs to      ├─(invoke)─►│ write_terminal  ├────────►│  write stdin pipe │
 │   Active Session │           │ (session_id)    │         │ (session_id)      │
 │                  │           │                 │         │         │         │
 │   Render Output  │◄──(emit)──┤ emit stdout/err ◄─(bcast)─┤  read stdout/err  │
 └──────────────────┘           └─────────────────┘         └─────────┬─────────┘
                                                                      ▼
                                                              [Spawned cmd/sh]
                                                              (PATH shadowed!)
```

---

## 2. Shell Spawning & Environmental Shadowing

When a user selects a project, the backend spawns a platform-appropriate interactive sub-shell:
- **Windows**: `cmd.exe` with quiet args (`/Q`, `/K`).
- **macOS & Linux**: `sh` (or `bash` fallback).

The sub-process is spawned with the **spoofed environment** mapped from `ProtoManager`. Since the private toolchain shims are prepended to `PATH`, typing `node` or `go` inside the terminal executes the isolated sandboxed binary.

```rust
let shell_cmd = if cfg!(target_os = "windows") { "cmd.exe" } else { "sh" };
let mut cmd = Command::new(shell_cmd);
cmd.envs(spoofed_envs);
cmd.stdin(std::process::Stdio::piped());
cmd.stdout(std::process::Stdio::piped());
cmd.stderr(std::process::Stdio::piped());
```

---

## 3. Real-Time Buffer Reading

Traditional line-by-line stream readers (such as `AsyncBufReadExt::read_line`) block until they encounter a newline character (`\n`). 
In interactive command lines, shell prompts (e.g. `C:\Users\Username> ` or `$ `) **do not** end with a newline. Using a line reader would cause the terminal UI to hang and fail to show the prompt until the user submits a command.

Alouette Server resolves this by reading from `stdout` and `stderr` streams using **fixed-size buffer chunks** (up to 4096 bytes) and pushing them immediately:

```rust
tokio::spawn(async move {
    let mut reader = stdout;
    let mut buffer = [0; 4096];
    loop {
        match tokio::io::AsyncReadExt::read(&mut reader, &mut buffer).await {
            Ok(0) => break, // EOF
            Ok(n) => {
                let text = String::from_utf8_lossy(&buffer[..n]).to_string();
                let _ = terminal_sender.send(TerminalOutput { session_id, text });
            }
            Err(_) => break,
        }
    }
});
```

This guarantees sub-millisecond rendering latency and mirrors a fully-interactive native terminal experience.
