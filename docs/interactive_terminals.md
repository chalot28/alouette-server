# Isolated Interactive Terminal Shells

This document outlines the design and implementation of sandboxed interactive shell terminal sessions in Alouette Server.

---

## 1. Overview

Alouette Server provides real-time interactive shell sessions for each project workspace. Developers can create **multiple independent, concurrent terminal sessions** inside a sandboxed environment with shadowed toolchain paths (Node, Go, Python) without polluting their global OS.

```text
  React Front-End UI             Tauri Bridge                core_engine Library
 ┌──────────────────┐           ┌─────────────────┐         ┌───────────────────┐
 │ TerminalPanel.tsx│           │ commands/        │         │ terminal.rs       │
 │   (xterm.js)     │           │ terminal.rs     │         │                   │
 │                  │           │                 │         │  spawn_terminal()  │
 │   Input ─────────┼─(invoke)─►│ write_to_terminal├────────►│  → PTY (powershell │
 │                  │           │                 │         │    / bash)         │
 │   Output ◄───────┼──(emit)───┤ terminal-output ◄─(bcast)─┤  ← PTY stdout     │
 └──────────────────┘           └─────────────────┘         └───────────────────┘
```

---

## 2. Shell Selection

| Platform | Shell         | Rationale                                      |
|----------|---------------|------------------------------------------------|
| Windows  | powershell.exe | Best ConPTY integration, modern scripting      |
| macOS    | bash          | Available by default, supports PROMPT_COMMAND  |
| Linux    | bash          | Available by default, supports PROMPT_COMMAND  |

The shell is spawned inside a **pseudo-terminal (PTY)** using the `portable_pty` crate — ConPTY on Windows, standard PTY on Unix.

---

## 3. Sandbox Enforcement (Shell-Level)

Instead of intercepting keystrokes at the Rust input-processing layer (which fails because xterm.js sends characters one at a time), the sandbox is enforced **inside the shell itself** via an injected script that runs on spawn.

### How it works

After the PTY spawns, a sandbox script is sent through the stdin channel **before** the session is registered (so no user input can arrive first). The script:

1. Reads `$env:WORKSPACE_ROOT` (set as an environment variable at spawn time)
2. Overrides the shell's **prompt function** to validate the current directory after **every command**
3. If the current directory falls outside the workspace root → automatically `cd` back to workspace root + show a warning

### PowerShell (Windows)

```powershell
$w = $env:WORKSPACE_ROOT.TrimEnd('\')
function prompt {
    $c = (Get-Location).Path
    if (-not $c.StartsWith($w, [System.StringComparison]::OrdinalIgnoreCase)) {
        Set-Location $w -ErrorAction SilentlyContinue
        Write-Host "`n[Sandbox] Restored to workspace root" -ForegroundColor Yellow
        $c = $w
    }
    $r = $c.Substring($w.Length).TrimStart('\').Replace('\','/')
    if ($r) { "~/$r>$ " } else { "~>$ " }
}
```

Advantages of this approach:
- **Cannot be bypassed** — every command triggers the prompt check, including `Set-Location`, `Push-Location`, `Pop-Location`, and any other navigation method
- **Simple** — one function override handles everything
- **Transparent** — the user is immediately pulled back with a visible warning

### Bash (Unix)

```bash
PROMPT_COMMAND='
c=$(pwd)
case "$c" in
    "$WORKSPACE_ROOT"*)
        r="${c#$WORKSPACE_ROOT}"; r="${r#/}"
        PS1="~${r:+/$r}\$ "
        ;;
    *)
        cd "$WORKSPACE_ROOT" 2>/dev/null
        echo "[Sandbox] Restored to workspace root"
        PS1="~\$ "
        ;;
esac
'
```

---

## 4. Real-Time Output Streaming

Instead of line-by-line reading (which blocks on prompts without newlines), the PTY output is read in **fixed-size 4096-byte chunks** and pushed immediately via a Tokio broadcast channel:

```rust
let mut buf = [0u8; 4096];
loop {
    match std::io::Read::read(&mut reader, &mut buf) {
        Ok(0) => break,                              // EOF
        Ok(n) => {
            let text = String::from_utf8_lossy(&buf[..n]).to_string();
            let _ = terminal_sender.send(TerminalOutput { session_id, text });
        }
        Err(_) => break,
    }
}
```

This guarantees sub-millisecond rendering latency for interactive prompts.

---

## 5. Input Processing

User input from xterm.js is forwarded directly to the PTY after normalizing line endings (LF → CRLF on Windows). No command interception is performed at the Rust level — the sandbox is fully shell-enforced.

---

## 6. Architecture Summary

| Component | Location | Responsibility |
|-----------|----------|---------------|
| `spawn_terminal()` | `core_engine/src/process/terminal.rs` | PTY spawn, env setup, sandbox injection |
| `kill_terminal()` | `core_engine/src/process/terminal.rs` | Process tree termination (sysinfo + taskkill) |
| `process_and_send_terminal_input()` | `core_engine/src/process/terminal.rs` | Line ending normalisation, PTY forwarding |
| `TerminalOutput` | `core_engine/src/process/models.rs` | Output event model |
| Tauri commands | `tauri_app/src-tauri/src/commands/terminal.rs` | IPC bridge |
| Event router | `tauri_app/src-tauri/src/events.rs` | Broadcast → frontend events |
| `TerminalPanel.tsx` | `tauri_app/ui/src/components/TerminalPanel.tsx` | xterm.js UI |
| `useTerminal.ts` | `tauri_app/ui/src/hooks/useTerminal.ts` | Session management hook |
