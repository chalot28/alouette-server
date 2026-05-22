import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Play,
  Square,
  Plus,
  Trash2,
  Terminal as TerminalIcon,
  Cpu,
  Database,
  Layers,
  Settings,
  Sun,
  Moon,
  Info,
  Monitor
} from "lucide-react";

// Interfaces
interface Project {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  setup_command?: string;
  setup_args?: string[];
  auto_restart?: boolean;
  env?: { [key: string]: string };
  max_cpu_percent?: number;
  max_ram_mb?: number;
  port?: number;
}

interface ProcessState {
  type: "Stopped" | "Setup" | "Running" | "Crashing" | "Terminated" | "Fatal";
  data?: any; // PID or error reasons
}

interface LogLine {
  text: string;
  stream: "stdout" | "stderr" | "system";
  timestamp: number;
}

interface ResourceHistory {
  [projectId: string]: {
    cpu: number[];
    ram: number[];
  };
}

export default function App() {
  // Theme State
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Project Lists & Active Tabs
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [projectStates, setProjectStates] = useState<{ [id: string]: ProcessState }>({});
  const [projectLogs, setProjectLogs] = useState<{ [id: string]: LogLine[] }>({});
  const [resourceHistory, setResourceHistory] = useState<ResourceHistory>({});

  // Previous Project ID for full-page config tab memory
  const [prevProjectId, setPrevProjectId] = useState<string>("");
  const [newProjName, setNewProjName] = useState("");
  const [newProjCmd, setNewProjCmd] = useState("");
  const [newProjArgs, setNewProjArgs] = useState("");
  const [newProjCwd, setNewProjCwd] = useState("");
  const [newProjSetup, setNewProjSetup] = useState("");
  const [newProjSetupArgs, setNewProjSetupArgs] = useState("");
  const [newProjRestart, setNewProjRestart] = useState(true);
  const [newProjEnv, setNewProjEnv] = useState<{ key: string; value: string }[]>([]);
  const [newProjCpu, setNewProjCpu] = useState<string>("");
  const [newProjRam, setNewProjRam] = useState<string>("");
  const [newProjPort, setNewProjPort] = useState<string>("");
  const [envKeyInput, setEnvKeyInput] = useState("");
  const [envValInput, setEnvValInput] = useState("");
  
  // Port conflict state
  const [portConflict, setPortConflict] = useState<{ port: number; pid: number } | null>(null);

  // Terminal Auto Scroll Refs
  const terminalRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Canvas Refs for CPU/RAM Charts
  const cpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const ramCanvasRef = useRef<HTMLCanvasElement>(null);

  // 1. Initial State Hydration & App Lifecycle Listeners
  useEffect(() => {
    // Set theme class on document element
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    // Load initial project list config from backend
    loadProjects();

    // Listen to incoming piped stdout/stderr log events
    const logListener = listen<any>("process-log", (event) => {
      const payload = event.payload; // { project_id, stream, text, timestamp }
      setProjectLogs((prev) => {
        const lines = prev[payload.project_id] || [];
        const newLines = [
          ...lines,
          {
            text: payload.text,
            stream: payload.stream,
            timestamp: payload.timestamp
          }
        ];
        // Capped at 2000 lines
        if (newLines.length > 2000) newLines.shift();
        return {
          ...prev,
          [payload.project_id]: newLines
        };
      });
    });

    // Listen to process state transitions
    const statusListener = listen<any>("process-status", (event) => {
      const payload = event.payload; // { project_id, state }
      setProjectStates((prev) => ({
        ...prev,
        [payload.project_id]: payload.state
      }));
    });

    // Listen to real-time process tree resource updates
    const resourceListener = listen<any>("resource-update", (event) => {
      const payload = event.payload; // { project_id, cpu_percentage, ram_bytes }
      const ramMb = payload.ram_bytes / (1024 * 1024);

      setResourceHistory((prev) => {
        const pHistory = prev[payload.project_id] || { cpu: [], ram: [] };
        const newCpu = [...pHistory.cpu, payload.cpu_percentage].slice(-30);
        const newRam = [...pHistory.ram, ramMb].slice(-30);
        return {
          ...prev,
          [payload.project_id]: {
            cpu: newCpu,
            ram: newRam
          }
        };
      });
    });

    return () => {
      logListener.then((unlisten) => unlisten());
      statusListener.then((unlisten) => unlisten());
      resourceListener.then((unlisten) => unlisten());
    };
  }, []);

  // Sync state parameters when clicking around tabs
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const activeState = projectStates[activeProjectId] || { type: "Stopped" };
  const activeLogs = projectLogs[activeProjectId] || [];
  const activeHistory = resourceHistory[activeProjectId] || { cpu: [], ram: [] };
  const activeCpuVal = activeHistory.cpu[activeHistory.cpu.length - 1] || 0.0;
  const activeRamVal = activeHistory.ram[activeHistory.ram.length - 1] || 0.0;

  // 2. Render CPU & RAM charts dynamically onto Canvas viewports
  useEffect(() => {
    drawCanvasChart(
      cpuCanvasRef.current,
      activeHistory.cpu,
      theme === "dark" ? "rgba(58, 134, 255, 1)" : "rgba(0, 86, 224, 1)",
      true
    );
  }, [activeHistory.cpu, theme]);

  useEffect(() => {
    drawCanvasChart(
      ramCanvasRef.current,
      activeHistory.ram,
      "rgba(16, 185, 129, 1)",
      false
    );
  }, [activeHistory.ram, theme]);

  // Scroll terminal automatically
  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [activeLogs, autoScroll]);

  // Load project config helper
  const loadProjects = async () => {
    try {
      const list = await invoke<Project[]>("get_projects");
      setProjects(list);
      
      // Hydrate state for each loaded project
      for (const p of list) {
        const state = await invoke<ProcessState>("get_project_state", { projectId: p.id });
        if (state) {
          setProjectStates((prev) => ({ ...prev, [p.id]: state }));
        }
      }

      if (list.length > 0 && !activeProjectId) {
        setActiveProjectId(list[0].id);
      }
    } catch (e) {
      console.error("Failed to load projects:", e);
    }
  };

  // 3. Command API Invocation Hooks
  const handleStart = async (forceStart = false) => {
    if (!activeProjectId || !activeProject) return;
    try {
      if (!forceStart && activeProject.port) {
        const occupiedPid = await invoke<number | null>("check_port_status", { port: activeProject.port });
        if (occupiedPid) {
          setPortConflict({ port: activeProject.port, pid: occupiedPid });
          return;
        }
      }

      // Clear logs before launching
      setProjectLogs((prev) => ({ ...prev, [activeProjectId]: [] }));
      setResourceHistory((prev) => ({
        ...prev,
        [activeProjectId]: { cpu: [], ram: [] }
      }));
      await invoke("start_project_process", { projectId: activeProjectId });
    } catch (e: any) {
      alert(`Execution failed: ${e}`);
    }
  };

  const handleForceKillAndStart = async () => {
    if (!portConflict || !activeProjectId) return;
    try {
      await invoke("force_kill_process", { pid: portConflict.pid });
      setPortConflict(null);
      // Wait 500ms for OS to release the socket
      setTimeout(async () => {
        await handleStart(true);
      }, 500);
    } catch (e: any) {
      alert(`Force kill failed: ${e}`);
    }
  };

  const handleStop = async () => {
    if (!activeProjectId) return;
    try {
      await invoke("stop_project_process", { projectId: activeProjectId });
    } catch (e: any) {
      alert(`Teardown failed: ${e}`);
    }
  };

  const handleAddProject = async () => {
    if (!newProjName || !newProjCmd) {
      alert("Name and command fields are mandatory.");
      return;
    }

    const id = newProjName.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const argsArray = newProjArgs
      .split(" ")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const setupCommand = newProjSetup.trim() || undefined;
    const setupArgs = newProjSetupArgs.trim()
      ? newProjSetupArgs.split(" ").map((s) => s.trim()).filter((s) => s.length > 0)
      : undefined;

    // Convert env array to object dictionary
    const envObj: { [key: string]: string } = {};
    newProjEnv.forEach((item) => {
      if (item.key.trim()) {
        envObj[item.key.trim()] = item.value;
      }
    });

    const maxCpuVal = newProjCpu ? parseInt(newProjCpu, 10) : undefined;
    const maxRamVal = newProjRam ? parseInt(newProjRam, 10) : undefined;
    const portVal = newProjPort ? parseInt(newProjPort, 10) : undefined;

    const newConfig: Project = {
      id,
      name: newProjName,
      command: newProjCmd,
      args: argsArray,
      cwd: newProjCwd.trim() || undefined,
      setup_command: setupCommand,
      setup_args: setupArgs,
      auto_restart: newProjRestart,
      env: Object.keys(envObj).length > 0 ? envObj : undefined,
      max_cpu_percent: maxCpuVal,
      max_ram_mb: maxRamVal,
      port: portVal,
    };

    try {
      await invoke("register_project", { config: newConfig });
      
      // Clear configuration input buffers
      setNewProjName("");
      setNewProjCmd("");
      setNewProjArgs("");
      setNewProjCwd("");
      setNewProjSetup("");
      setNewProjSetupArgs("");
      setNewProjRestart(true);
      setNewProjEnv([]);
      setNewProjCpu("");
      setNewProjRam("");
      setNewProjPort("");
      setEnvKeyInput("");
      setEnvValInput("");
      setPrevProjectId("");

      // Reload lists
      await loadProjects();
      setActiveProjectId(id);
    } catch (e: any) {
      alert(`Failed to save project: ${e}`);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm("Are you sure you want to delete this tab/project?")) return;
    try {
      await invoke("deregister_project", { projectId: id });
      await loadProjects();
      if (activeProjectId === id) {
        setActiveProjectId("");
      }
    } catch (e: any) {
      alert(`Failed to delete: ${e}`);
    }
  };

  const handleTerminalScroll = () => {
    if (!terminalRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
    // User is within 30px of bottom, autoScroll remains true
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 30;
    setAutoScroll(isAtBottom);
  };

  // 4. Drawing high-density Canvas Graph Engine
  const drawCanvasChart = (
    canvas: HTMLCanvasElement | null,
    data: number[],
    strokeColor: string,
    isPercent: boolean
  ) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    // Draw Grid Overlay
    const gridStyle =
      document.documentElement.getAttribute("data-theme") === "light"
        ? "rgba(0, 0, 0, 0.05)"
        : "rgba(255, 255, 255, 0.05)";
    ctx.strokeStyle = gridStyle;
    ctx.lineWidth = 1;

    for (let i = 0; i <= 3; i++) {
      const y = (h * i) / 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (data.length === 0) return;

    // Draw graph line
    const maxVal = isPercent ? 100 : Math.max(16, ...data) * 1.1;

    ctx.beginPath();
    data.forEach((val, idx) => {
      const x = (w * idx) / 29;
      const y = h - (h * val) / maxVal;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    // Fill area under line
    const fillCtx = ctx;
    fillCtx.lineTo((w * (data.length - 1)) / 29, h);
    fillCtx.lineTo(0, h);
    fillCtx.closePath();

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, strokeColor.replace("1)", "0.2)"));
    gradient.addColorStop(1, strokeColor.replace("1)", "0.0)"));
    ctx.fillStyle = gradient;
    ctx.fill();

    // Outline stroke path
    ctx.beginPath();
    data.forEach((val, idx) => {
      const x = (w * idx) / 29;
      const y = h - (h * val) / maxVal;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  return (
    <div className="app-container">
      {/* Sidebar Section */}
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="brand">
            <Layers className="brand-icon" size={20} />
            <span>Alouette Engine</span>
          </div>
          <button
            className="btn btn-secondary"
            style={{ padding: "6px 8px" }}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </header>

        {/* Dynamic Project/Tab Picker List */}
        <div className="project-list-container">
          {projects.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "12px", textAlign: "center", marginTop: "20px" }}>
              No active project tabs. Create one below to begin.
            </div>
          ) : (
            projects.map((p) => {
              const state = projectStates[p.id] || { type: "Stopped" };
              const isActive = p.id === activeProjectId;
              return (
                <div
                  key={p.id}
                  className={`project-item ${isActive ? "active" : ""}`}
                  onClick={() => {
                    setActiveProjectId(p.id);
                    setAutoScroll(true);
                  }}
                >
                  <div className="project-info">
                    <span className="project-name">{p.name}</span>
                    <span className="project-command">
                      $ {p.command} {p.args.join(" ")}
                    </span>
                  </div>

                  {/* Dynamic Status Badge */}
                  <div className={`status-badge status-${state.type.toLowerCase()}`}>
                    <span className="status-dot"></span>
                    <span style={{ fontSize: "9px" }}>{state.type}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Sidebar Controls Footer */}
        <footer className="sidebar-footer">
          <button className="btn btn-primary" onClick={() => {
            setPrevProjectId(activeProjectId);
            setActiveProjectId("__create_project__");
          }}>
            <Plus size={16} />
            <span>Add Project Tab</span>
          </button>
        </footer>
      </aside>

      {/* Main Panel Viewport */}
      <main className="main-content">
        {activeProjectId === "__create_project__" ? (
          <div className="config-dashboard">
            <header className="config-header">
              <h1 className="config-title">Configure Native Tab Process</h1>
              <p className="config-subtitle">Establish a new isolated runtime script and register active resource watchdog limits.</p>
            </header>

            <div className="config-container">
              {/* Left Column: Command & Paths */}
              <div className="config-card">
                <h3 className="config-card-title">
                  <TerminalIcon size={16} />
                  <span>Execution Command Configuration</span>
                </h3>

                <div className="form-group">
                  <label className="form-label">Tab / Project Identifier</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. NextJS Backend, API Service"
                    value={newProjName}
                    onChange={(e) => setNewProjName(e.target.value)}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <div className="form-group">
                    <label className="form-label">Primary Executor</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. npm, node, ping"
                      value={newProjCmd}
                      onChange={(e) => setNewProjCmd(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Command Arguments</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. run dev, 127.0.0.1"
                      value={newProjArgs}
                      onChange={(e) => setNewProjArgs(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Custom Working Directory (Optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. d:\alouette-server"
                    value={newProjCwd}
                    onChange={(e) => setNewProjCwd(e.target.value)}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <div className="form-group">
                    <label className="form-label">Pre-Start Setup Command</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. npm"
                      value={newProjSetup}
                      onChange={(e) => setNewProjSetup(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Pre-Start Arguments</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. install"
                      value={newProjSetupArgs}
                      onChange={(e) => setNewProjSetupArgs(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Right Column: Environment & Limits */}
              <div className="config-card">
                <h3 className="config-card-title">
                  <Settings size={16} />
                  <span>Environment & Watchdog Settings</span>
                </h3>

                {/* Env Var section */}
                <div className="env-manager-grid">
                  <label className="form-label">Environment Variables</label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="KEY (e.g. PORT)"
                      style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "12px" }}
                      value={envKeyInput}
                      onChange={(e) => setEnvKeyInput(e.target.value)}
                    />
                    <input
                      type="text"
                      className="form-input"
                      placeholder="VALUE (e.g. 5000)"
                      style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "12px" }}
                      value={envValInput}
                      onChange={(e) => setEnvValInput(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: "10px 16px" }}
                      onClick={() => {
                        if (envKeyInput.trim()) {
                          setNewProjEnv([...newProjEnv, { key: envKeyInput.trim().toUpperCase(), value: envValInput }]);
                          setEnvKeyInput("");
                          setEnvValInput("");
                        }
                      }}
                    >
                      Add
                    </button>
                  </div>
                  
                  {newProjEnv.length > 0 && (
                    <div className="env-list-container">
                      {newProjEnv.map((item, idx) => (
                        <div key={idx} className="env-list-item">
                          <span className="env-list-item-key">{item.key}</span>
                          <span className="env-list-item-val">{item.value}</span>
                          <button
                            type="button"
                            className="env-remove-btn"
                            onClick={() => setNewProjEnv(newProjEnv.filter((_, i) => i !== idx))}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Threshold limits grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                  <div className="form-group">
                    <label className="form-label">Port Scanner</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="e.g. 3000"
                      value={newProjPort}
                      onChange={(e) => setNewProjPort(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Max CPU (%)</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="No limit"
                      value={newProjCpu}
                      onChange={(e) => setNewProjCpu(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Max RAM (MB)</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="No limit"
                      value={newProjRam}
                      onChange={(e) => setNewProjRam(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ flexDirection: "row", gap: "10px", alignItems: "center", marginTop: "10px" }}>
                  <input
                    type="checkbox"
                    id="auto_restart"
                    style={{ width: "16px", height: "16px", cursor: "pointer" }}
                    checked={newProjRestart}
                    onChange={(e) => setNewProjRestart(e.target.checked)}
                  />
                  <label htmlFor="auto_restart" className="form-label" style={{ cursor: "pointer", userSelect: "none" }}>
                    Enable automatic crash-loop recovery (exponential backoff)
                  </label>
                </div>
              </div>

              {/* Actions Row */}
              <div className="config-actions-row">
                <button 
                  className="btn btn-secondary" 
                  onClick={() => {
                    // Clear inputs
                    setNewProjName("");
                    setNewProjCmd("");
                    setNewProjArgs("");
                    setNewProjCwd("");
                    setNewProjSetup("");
                    setNewProjSetupArgs("");
                    setNewProjRestart(true);
                    setNewProjEnv([]);
                    setNewProjCpu("");
                    setNewProjRam("");
                    setNewProjPort("");
                    setEnvKeyInput("");
                    setEnvValInput("");
                    // Navigate back
                    setActiveProjectId(prevProjectId);
                  }}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleAddProject}>
                  Save Project Tab
                </button>
              </div>
            </div>
          </div>
        ) : activeProject ? (
          <>
            {/* Top Control Bar */}
            <header className="control-bar">
              <div className="control-info">
                <div className="control-title-group">
                  <h1 className="control-title">{activeProject.name}</h1>
                  <p style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
                    CWD: {activeProject.cwd || "System Root"} | Cmd: {activeProject.command} {activeProject.args.join(" ")}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="control-actions">
                {activeState.type === "Running" || activeState.type === "Setup" ? (
                  <button className="btn btn-danger" onClick={handleStop}>
                    <Square size={14} fill="currentColor" />
                    <span>Stop Process</span>
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={() => handleStart()}>
                    <Play size={14} fill="currentColor" fillRule="evenodd" />
                    <span>Start Process</span>
                  </button>
                )}
                
                <button
                  className="btn btn-secondary"
                  onClick={() => handleDeleteProject(activeProject.id)}
                  title="Remove Project Tab"
                >
                  <Trash2 size={14} />
                  <span>Delete Tab</span>
                </button>
              </div>
            </header>

            {/* Split Grid: Metrics (Top) & Terminal (Bottom) */}
            <div className="dashboard-grid">
              {/* Aggregate metrics panel */}
              <section className="metrics-panel">
                {/* CPU usage aggregate */}
                <div className="chart-card">
                  <div className="card-title">
                    <span>CPU LOAD</span>
                    <Cpu size={14} />
                  </div>
                  <div className="card-value">
                    {activeState.type === "Running" ? `${activeCpuVal.toFixed(1)}%` : "0.0%"}
                  </div>
                  {activeProject.max_cpu_percent && (
                    <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "-6px" }}>
                      Watchdog Limit: {activeProject.max_cpu_percent}%
                    </div>
                  )}
                  <div className="canvas-container">
                    <canvas ref={cpuCanvasRef} />
                  </div>
                </div>

                {/* RAM RSS aggregate */}
                <div className="chart-card">
                  <div className="card-title">
                    <span>RAM RSS FOOTPRINT</span>
                    <Database size={14} />
                  </div>
                  <div className="card-value">
                    {activeState.type === "Running" ? `${activeRamVal.toFixed(1)} MB` : "0.0 MB"}
                  </div>
                  {activeProject.max_ram_mb && (
                    <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "-6px" }}>
                      Watchdog Limit: {activeProject.max_ram_mb} MB
                    </div>
                  )}
                  <div className="canvas-container">
                    <canvas ref={ramCanvasRef} />
                  </div>
                </div>

                {/* Process state and PID tracking */}
                <div className="chart-card">
                  <div className="card-title">
                    <span>PROCESS HEALTH STATE</span>
                    <Info size={14} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "2px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Process State:</span>
                      <span style={{ fontWeight: 600, color: "var(--color-accent)" }}>{activeState.type}</span>
                    </div>

                    {activeState.type === "Running" && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Parent PID:</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{activeState.data}</span>
                      </div>
                    )}

                    {activeProject.port && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Port Binding:</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--color-success)" }}>{activeProject.port}</span>
                      </div>
                    )}

                    {activeState.type === "Fatal" && (
                      <div style={{ fontSize: "11px", color: "var(--color-danger)", lineHeight: "1.4" }}>
                        Error: {activeState.data || "Unknown fatal error encountered."}
                      </div>
                    )}

                    {activeState.type === "Crashing" && (
                      <div style={{ fontSize: "11px", color: "var(--color-warning)", lineHeight: "1.4" }}>
                        Immediate Crash Loop. Retrying backoff in {activeState.data?.backoff_seconds || 2}s (Count: {activeState.data?.retry_count}/5).
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Terminal Panel */}
              <section className="terminal-panel">
                <header className="terminal-header">
                  <div className="terminal-title">
                    <TerminalIcon size={12} />
                    <span>LOG STREAM PIPELINE</span>
                  </div>
                  <div className="terminal-actions">
                    <button
                      className="terminal-action-btn"
                      onClick={() => setProjectLogs((prev) => ({ ...prev, [activeProjectId]: [] }))}
                    >
                      <Trash2 size={12} />
                      <span>Clear log console</span>
                    </button>
                  </div>
                </header>

                {/* Virtual Viewport container */}
                <div
                  ref={terminalRef}
                  className="terminal-viewport"
                  onScroll={handleTerminalScroll}
                >
                  {activeLogs.length === 0 ? (
                    <div style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "11px" }}>
                      --- Ready. Click "Start Process" to pipe logs dynamically ---
                    </div>
                  ) : (
                    activeLogs.map((log, index) => (
                      <div
                        key={index}
                        className={`terminal-line ${log.stream}`}
                      >
                        {log.text}
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </>
        ) : (
          /* Empty / Welcome Viewport */
          <div className="empty-state">
            <Monitor size={48} className="empty-icon" />
            <h2 className="empty-title">Native Process Controller Shell</h2>
            <p className="empty-description">
              Welcome to Alouette Runner. Manage multiple isolated developer process tabs, track nested Windows PID trees, and stream real-time resource allocations within a high-density, low-latency slate interface.
            </p>
            <button className="btn btn-primary" onClick={() => {
              setPrevProjectId(activeProjectId);
              setActiveProjectId("__create_project__");
            }}>
              <Plus size={16} />
              <span>Create your first tab</span>
            </button>
          </div>
        )}
      </main>

      {/* Port Conflict Resolver Modal */}
      {portConflict && (
        <div className="modal-overlay" style={{ zIndex: 110 }}>
          <div className="modal-content" style={{ borderColor: "var(--color-danger)" }}>
            <header className="modal-header" style={{ borderBottomColor: "rgba(239, 68, 68, 0.2)" }}>
              <h3 className="modal-title" style={{ color: "var(--color-danger)", display: "flex", alignItems: "center", gap: "8px" }}>
                <span>⚠️ Port Conflict Detected</span>
              </h3>
              <button
                className="btn btn-secondary"
                style={{ padding: "4px 8px" }}
                onClick={() => setPortConflict(null)}
              >
                ✕
              </button>
            </header>

            <div className="modal-body">
              <p style={{ lineHeight: "1.6", color: "var(--text-primary)" }}>
                The configured port <strong style={{ color: "var(--color-accent)", fontSize: "15px" }}>{portConflict.port}</strong> is currently being occupied by another process on your system:
              </p>
              <div style={{
                backgroundColor: "rgba(239, 68, 68, 0.05)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                borderRadius: "var(--radius-md)",
                padding: "12px 16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "4px"
              }}>
                <div>
                  <span style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block" }}>Process Identifier</span>
                  <strong style={{ fontFamily: "var(--font-mono)", fontSize: "16px" }}>PID {portConflict.pid}</strong>
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-danger)", fontWeight: 600 }}>
                  SOCKET BLOCKED
                </div>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.5" }}>
                Would you like to forcefully terminate the occupying PID {portConflict.pid} to reclaim the port and launch this tab process?
              </p>
            </div>

            <footer className="modal-footer" style={{ borderTopColor: "rgba(239, 68, 68, 0.1)" }}>
              <button className="btn btn-secondary" onClick={() => setPortConflict(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleForceKillAndStart}>
                Force Kill & Start
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

// Trigger hot reload to clear any cached transform errors in the active dev server.
