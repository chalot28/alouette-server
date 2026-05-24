# Self-Updating Cloudflare Tunnels (cloudflared)

This document describes how Alouette Server integrates self-contained and self-updating Cloudflare Tunnels to safely expose local process ports to the web.

---

## 1. Automated Binary Delivery & Headless Preloader

Unlike conventional systems that require developers to manually install and manage the `cloudflared` CLI globally, Alouette Server handles binary maintenance fully programmatically:

```text
[Startup Event]
       │
       ▼
[Check app_data/bin/cloudflared.exe]
       │
       ├─► [Yes] ── HEAD Request to GitHub Releases ──► [Up to Date?]
       │                                                      │
       │                                                      ├─► [Yes] ─► Proceed
       │                                                      └─► [No]  ─► Download Latest
       │
       └─► [No]  ───────────────────────────────────────────────► Download Latest
```

### Self-Healing Fallback:
If the user's computer is completely offline or GitHub is experiencing downtime during startup, Alouette Server will gracefully log a warning and fallback to the existing local `cloudflared` binary. This ensures that network instabilities never prevent the application from starting.

---

## 2. Windows and Cross-Platform Target Resolution

The manager dynamically resolves URLs based on compilation target:

```rust
let url = if cfg!(target_os = "windows") {
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
} else if cfg!(target_os = "macos") {
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64"
} else {
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
};
```

On Unix targets, Alouette Server automatically mutates file permissions to `0o755` (Read/Write/Execute) after downloading to bypass executable permission locks.

---

## 3. Tunnel Spawning & Regex URL Extraction

When a project is flagged with `enable_tunnel = true`, Alouette spawns a headless tunnel process:
```rust
let mut cmd = Command::new(&self.executable_path);
cmd.args(["tunnel", "--url", &format!("http://localhost:{}", port)]);
```

### Dynamic URL Capturing:
Cloudflared prints the dynamically allocated public tunnel URL to its `stderr` channel. Alouette intercepts this stream byte-by-byte using an asynchronous buffer reader:

```rust
let mut reader = BufReader::new(stderr).lines();
while let Ok(Some(line)) = reader.next_line().await {
    if line.contains("https://") && line.contains(".trycloudflare.com") {
        if let Some(start) = line.find("https://") {
            let url_part = &line[start..];
            let url = url_part.split_whitespace().next().unwrap_or(url_part);
            let _ = url_tx.send(url.to_string());
        }
    }
}
```

Once the URL is successfully captured, it is dispatched via a broadcast channel to Tauri, which displays the live public hyperlink on the frontend dashboard.
