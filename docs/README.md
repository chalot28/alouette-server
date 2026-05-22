# Monolithic Architecture Blueprint: Process Runner & Resource Monitor

This document outlines the system architecture and communication boundary between the Tauri v2 Desktop Wrapper (`tauri_app`) and the asynchronous Rust logic core (`core_engine`).

## 1. System Topology & Layers

The application is structured into three clean, decoupled architectural layers:

```text
+-------------------------------------------------------------+
|                     TypeScript / React UI                   |
|   (Component Shell, virtual terminals, state context, charts)|
+-------------------------------------------------------------+
                              |
                     IPC Command / Events (JSON)
                              |
+-------------------------------------------------------------+
|                     Tauri v2 Desktop App                    |
|   (IPC Handlers, AppState hydration, Window Event Router)   |
+-------------------------------------------------------------+
                              |
                     Rust API / Native Calls
                              |
+-------------------------------------------------------------+
|                     core_engine Rust Library                |
|   (Config watch, Tokio Process spawner, PID tree monitor)   |
+-------------------------------------------------------------+
```

---

## 2. IPC Communication Boundary

Communication between the Frontend UI and the Rust Backend uses Tauri's IPC boundary (Commands and Events):

1. **Commands (Frontend -> Backend):** High-level requests to invoke actions or retrieve snapshots.
   - `start_project(project_id)`: Spawn the tokio task for the selected tab.
   - `stop_project(project_id)`: Perform graceful shutdown, followed by recursive tree teardown.
   - `get_projects_config()`: Read the system's registered tabs configurations.
2. **Events (Backend -> Frontend):** Real-time, decoupled streams triggered asynchronously.
   - `process-log`: Streamed line-by-line `{ project_id: String, stream: "stdout" | "stderr", text: String, timestamp: u64 }`.
   - `process-status`: Dispatched on lifecycle changes `{ project_id: String, status: ProjectStatus }`.
   - `resource-update`: Aggregated CPU and RAM values `{ project_id: String, cpu_percentage: f32, ram_bytes: u64 }`.

---

## 3. Process Execution Sequence Diagram

The following sequence diagram outlines the entire lifecycle of a registered tab instance from the UI trigger to its graceful or forced teardown:

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React UI (Tab View)
    participant Tauri as Tauri IPC Core
    participant Engine as core_engine::ProcessManager
    participant Subproc as OS Process Tree (npm/node)
    participant Monitor as core_engine::ResourceMonitor

    User->>UI: Click "Start Process"
    UI->>Tauri: invoke("start_project_process", { projectId })
    Tauri->>Engine: spawn_process(projectId)
    activate Engine
    Engine->>Subproc: Command::spawn() (piped stdout/stderr)
    Engine->>Monitor: register_pid(ParentPID)
    Engine-->>Tauri: Ok(ParentPID)
    Tauri-->>UI: Update Status to RUNNING
    deactivate Engine

    loop Every 1000ms
        Monitor->>Subproc: Query Child Processes (sysinfo)
        Subproc-->>Monitor: Return active PIDs, CPU & RAM
        Monitor->>Tauri: emit("resource-update", { cpu, ram })
        Tauri->>UI: Render charts & status metrics
    end

    loop Stdout/Stderr Pipes
        Subproc->>Engine: Stream chunk
        Engine->>Engine: Write line to log file
        Engine->>Tauri: emit("process-log", { text, stream })
        Tauri->>UI: Append log to terminal viewport
    end

    User->>UI: Click "Stop Process"
    UI->>Tauri: invoke("stop_project_process", { projectId })
    Tauri->>Engine: terminate_process_tree(projectId)
    activate Engine
    Engine->>Monitor: deregister_pid(ParentPID)
    Engine->>Subproc: Terminate recursively (leaves to root)
    alt Graceful termination fails
        Engine->>Subproc: taskkill /F /T /PID ParentPID (Windows backup)
    end
    Subproc-->>Engine: Process Tree Dead
    Engine-->>Tauri: Ok()
    Tauri-->>UI: Update Status to STOPPED
    deactivate Engine
```

---

## 4. Multi-Thread State Safety

Global state is hydrated in Tauri using a thread-safe `AppState` managed pointer:
```rust
pub struct AppState {
    pub process_manager: Arc<Mutex<ProcessManager>>,
    pub resource_monitor: Arc<ResourceMonitorController>,
}
```
Access to process commands is synchronized via non-blocking async lock guards or thread-safe channels (`tokio::sync::mpsc`), ensuring that even under severe system stress or rapid user tab-switching, race conditions are mathematically impossible.
