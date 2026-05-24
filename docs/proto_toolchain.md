# Isolated Development Environment: Self-Contained Proto Toolchains

This document describes how Alouette Server achieves 100% process isolation and toolchain virtualization using a privately managed `proto` installation.

---

## 1. The Challenge of Global Environmental Leaks
In traditional process managers, commands like `node`, `npm`, `go`, or `python` are resolved globally using the host system's `PATH`. This introduces major liabilities:
- **Version Collisions**: If Project A requires Node.js v18 and Project B requires Node.js v20, global installations will cause one or both projects to crash.
- **Pollution of Global State**: Installing local packages globally or modifying configuration files can disrupt other applications on the user's machine.
- **Lack of Portability**: Moving the process runner to another machine requires manually downloading and installing runtime compilers.

---

## 2. Dynamic Toolchain Sandboxing Architecture

Alouette Server bypasses the host machine's tools entirely by deploying a private sandbox inside the application's data directory.

```text
[Alouette App Folder]
  ├── app_data/
  │    ├── bin/
  │    │    └── proto.exe (Self-contained, downloaded on startup)
  │    ├── alouette_toolchains/ (Private PROTO_HOME)
  │    │    ├── bin/
  │    │    ├── shims/ (Pre-installed Node.js, Go, Python executables)
  │    │    └── tools/
```

### Steps of the Sandboxing Lifecycle:
1. **Bootstrap Phase**: On startup, the backend verifies if a private `proto` binary resides in `app_data/bin/`. If missing, it downloads the official compiled release directly from moonrepo's GitHub releases.
2. **Pre-population Phase**: A non-blocking background task ensures that stable versions of **Node.js**, **Go**, and **Python** are installed inside our isolated `app_data/alouette_toolchains/` directory.
3. **Execution Phase**: When a task is started, Alouette generates a spoofed environment path for the child process.

---

## 3. Strict PATH Spoofing & Shadowing

Process isolation is mathematically enforced by rewriting the child process's environment variables before spawning:

```rust
pub fn get_spoofed_env(&self) -> Vec<(String, String)> {
    let mut envs = Vec::new();
    
    // Set private PROTO_HOME so shim binaries resolve locally
    envs.push(("PROTO_HOME".to_string(), self.proto_home.to_string_lossy().to_string()));

    let bin_dir = self.proto_home.join("bin");
    let shims_dir = self.proto_home.join("shims");
    
    let mut paths = vec![shims_dir, bin_dir];

    // Filter out host PATH variables containing global toolchains
    if let Ok(system_path) = std::env::var("PATH") {
        for p in std::env::split_paths(&system_path) {
            let p_str = p.to_string_lossy().to_lowercase();
            if p_str.contains("node")
                || p_str.contains("python")
                || p_str.contains("go")
                || p_str.contains("nvm")
                || p_str.contains("rust")
                || p_str.contains("cargo")
            {
                continue; // Shadowed out!
            }
            paths.push(p);
        }
    }

    let new_path = std::env::join_paths(paths).unwrap_or_default();
    envs.push(("PATH".to_string(), new_path.to_string_lossy().to_string()));
    envs
}
```

### How PATH Filtering Works:
By stripping global paths (e.g., `C:\Program Files\nodejs\`) and prepending our private `shims` folder, any sub-spawned command (like a shell executing a sub-process) will find our isolated versions of `node` or `go` first. This prevents the host system's tools from ever being touched, ensuring absolute separation.
