import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Layers, Activity, User, Terminal as TerminalIcon, Plus } from "lucide-react";

// Components
import Header from "./components/Header";
import ProcessMonitor from "./components/ProcessMonitor";
import ConfigSetup from "./components/ConfigSetup";
import TabList from "./components/TabList";
import TerminalPanel from "./components/TerminalPanel";
import ProcessManager from "./components/ProcessManager";
import DiagnosticsPanel from "./components/DiagnosticsPanel";
import FileExplorer from "./components/FileExplorer";

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

  // Bottom nav tab (for right-bottom panel between manager / user)
  const [rightBottomTab, setRightBottomTab] = useState<"manager" | "user">("manager");

  // Dynamic UI States
  const [searchQuery, setSearchQuery] = useState("");
  const [logFilter, setLogFilter] = useState<"all" | "stdout" | "stderr" | "system">("all");
  const [logSearchQuery, setLogSearchQuery] = useState("");
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [settingMenuOpen, setSettingMenuOpen] = useState(false);
  const [uptimeSeconds, setUptimeSeconds] = useState(0);

  // Form State
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

  // System Uptime Counter
  useEffect(() => {
    const timer = setInterval(() => {
      setUptimeSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Window click listener to automatically close dropdowns
  useEffect(() => {
    const handleWindowClick = () => {
      setFileMenuOpen(false);
      setSettingMenuOpen(false);
    };
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

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

  // Populate configuration fields when active project changes
  useEffect(() => {
    if (activeProjectId && activeProjectId !== "__create_project__") {
      const activeProj = projects.find((p) => p.id === activeProjectId);
      if (activeProj) {
        setNewProjName(activeProj.name);
        setNewProjCmd(activeProj.command);
        setNewProjArgs(activeProj.args.join(" "));
        setNewProjCwd(activeProj.cwd || "");
        setNewProjSetup(activeProj.setup_command || "");
        setNewProjSetupArgs(activeProj.setup_args ? activeProj.setup_args.join(" ") : "");
        setNewProjRestart(activeProj.auto_restart !== false);
        setNewProjCpu(activeProj.max_cpu_percent ? String(activeProj.max_cpu_percent) : "");
        setNewProjRam(activeProj.max_ram_mb ? String(activeProj.max_ram_mb) : "");
        setNewProjPort(activeProj.port ? String(activeProj.port) : "");
        if (activeProj.env) {
          setNewProjEnv(Object.entries(activeProj.env).map(([key, value]) => ({ key, value })));
        } else {
          setNewProjEnv([]);
        }
      }
    }
  }, [activeProjectId, projects]);

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

  const handleStartProject = async (id: string) => {
    try {
      const proj = projects.find((p) => p.id === id);
      if (!proj) return;
      
      const occupiedPid = proj.port ? await invoke<number | null>("check_port_status", { port: proj.port }) : null;
      if (occupiedPid) {
        setPortConflict({ port: proj.port!, pid: occupiedPid });
        return;
      }

      setProjectLogs((prev) => ({ ...prev, [id]: [] }));
      setResourceHistory((prev) => ({
        ...prev,
        [id]: { cpu: [], ram: [] }
      }));
      await invoke("start_project_process", { projectId: id });
    } catch (e: any) {
      alert(`Execution failed: ${e}`);
    }
  };

  const handleStopProject = async (id: string) => {
    try {
      await invoke("stop_project_process", { projectId: id });
    } catch (e: any) {
      alert(`Teardown failed: ${e}`);
    }
  };

  const forceKillProcess = async (pid: number) => {
    try {
      await invoke("force_kill_process", { pid });
    } catch (e: any) {
      alert(`Force kill failed: ${e}`);
    }
  };

  const handleForceKillAndStart = async () => {
    if (!portConflict || !activeProjectId) return;
    try {
      await invoke("force_kill_process", { pid: portConflict.pid });
      setPortConflict(null);
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
      id: activeProjectId && activeProjectId !== "__create_project__" ? activeProjectId : id,
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
      port: portVal
    };

    try {
      await invoke("register_project", { config: newConfig });
      await loadProjects();
      alert("Configuration saved successfully!");
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
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 30;
    setAutoScroll(isAtBottom);
  };

  const handleResetSetupForm = () => {
    setActiveProjectId("__create_project__");
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
  };

  // Export / Import Mock Helpers
  const handleExportConfig = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(projects, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "alouette_configurations.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setFileMenuOpen(false);
  };

  const handleImportMockConfig = async () => {
    const mockProjects: Project[] = [
      {
        id: "ping-diagnostics",
        name: "Local Connection diagnostics",
        command: "ping",
        args: ["127.0.0.1", "-n", "20"],
        auto_restart: false
      },
      {
        id: "mock-backend",
        name: "Node API Server",
        command: "node",
        args: ["server.js"],
        auto_restart: true,
        port: 8080,
        max_cpu_percent: 50,
        max_ram_mb: 256
      }
    ];

    try {
      for (const p of mockProjects) {
        await invoke("register_project", { config: p });
      }
      await loadProjects();
      alert("Loaded mock templates successfully!");
    } catch (e: any) {
      alert(`Demo import failed: ${e}`);
    }
    setFileMenuOpen(false);
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

    const maxVal = isPercent ? 100 : Math.max(16, ...data) * 1.1;

    ctx.beginPath();
    data.forEach((val, idx) => {
      const x = (w * idx) / 29;
      const y = h - (h * val) / maxVal;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    const fillCtx = ctx;
    fillCtx.lineTo((w * (data.length - 1)) / 29, h);
    fillCtx.lineTo(0, h);
    fillCtx.closePath();

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, strokeColor.replace("1)", "0.15)"));
    gradient.addColorStop(1, strokeColor.replace("1)", "0.0)"));
    ctx.fillStyle = gradient;
    ctx.fill();

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

  const wipeConfig = () => {
    setProjects([]);
    setProjectStates({});
    setProjectLogs({});
    setResourceHistory({});
    setActiveProjectId("");
  };

  // Filter project lists based on Search input
  const filteredProjects = projects.filter((p) => {
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.command.toLowerCase().includes(q) ||
      p.args.join(" ").toLowerCase().includes(q)
    );
  });

  // Filter logs inside Terminal
  const filteredLogs = activeLogs.filter((log) => {
    if (logFilter !== "all" && log.stream !== logFilter) return false;
    if (logSearchQuery.trim()) {
      return log.text.toLowerCase().includes(logSearchQuery.toLowerCase());
    }
    return true;
  });

  return (
    <div className="app-container">
      {/* 1. Global Header Bar */}
      <Header
        theme={theme}
        setTheme={setTheme}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        fileMenuOpen={fileMenuOpen}
        setFileMenuOpen={setFileMenuOpen}
        settingMenuOpen={settingMenuOpen}
        setSettingMenuOpen={setSettingMenuOpen}
        handleExportConfig={handleExportConfig}
        handleImportMockConfig={handleImportMockConfig}
        wipeConfig={wipeConfig}
      />

      {/* 2. Main Workspace — Full Dashboard Grid */}
      <div className="workspace-grid">

        {/* ── LEFT COLUMN: Zone 1 (Tab list) + Zone 3 (File Explorer) + Zone 6 (New project btn) ── */}
        <div className="col-left">
          {/* Zone 1: Tab List */}
          <div className="zone zone-1" style={{ flex: '1 1 50%', borderBottom: '1px solid var(--border-primary)' }}>
            <TabList
              filteredProjects={filteredProjects}
              activeProjectId={activeProjectId}
              setActiveProjectId={setActiveProjectId}
              projectStates={projectStates}
              resourceHistory={resourceHistory}
              setAutoScroll={setAutoScroll}
              handleStartProject={handleStartProject}
              handleStopProject={handleStopProject}
              handleDeleteProject={handleDeleteProject}
            />
          </div>

          {/* Zone 3: Project File Explorer */}
          <div className="zone zone-file-explorer" style={{ flex: '1 1 50%', overflow: 'hidden' }}>
            <FileExplorer activeCwd={activeProject?.cwd} />
          </div>

          {/* Zone 6: New Project Button */}
          <div className="zone zone-6">
            <button
              className="btn-new-project"
              onClick={handleResetSetupForm}
            >
              <Plus size={14} />
              <span>New Project</span>
            </button>
          </div>
        </div>

        {/* ── CENTER COLUMN: Zone 2 (Monitor) + Zone 4 (Terminal) ── */}
        <div className="col-center">
          {/* Zone 2: Resource Monitor */}
          <div className="zone zone-2">
            <ProcessMonitor
              activeProject={activeProject}
              activeState={activeState}
              activeCpuVal={activeCpuVal}
              activeRamVal={activeRamVal}
              cpuCanvasRef={cpuCanvasRef}
              ramCanvasRef={ramCanvasRef}
              handleStart={handleStart}
              handleStop={handleStop}
            />
          </div>

          {/* Zone 4: Terminal */}
          <div className="zone zone-4">
            <TerminalPanel
              activeProject={activeProject}
              activeProjectId={activeProjectId}
              filteredLogs={filteredLogs}
              logFilter={logFilter}
              setLogFilter={setLogFilter}
              logSearchQuery={logSearchQuery}
              setLogSearchQuery={setLogSearchQuery}
              clearLogs={(id) => setProjectLogs((prev) => ({ ...prev, [id]: [] }))}
              terminalRef={terminalRef}
              handleTerminalScroll={handleTerminalScroll}
              projects={projects}
              projectStates={projectStates}
              setActiveProjectId={setActiveProjectId}
            />
          </div>
        </div>

        {/* ── RIGHT COLUMN: Zone 3 (Config) + Zone 5 (Process Manager) ── */}
        <div className="col-right">
          {/* Zone 3: Configuration & Watchdog Setup */}
          <div className="zone zone-3">
            <ConfigSetup
              newProjName={newProjName}
              setNewProjName={setNewProjName}
              newProjRestart={newProjRestart}
              setNewProjRestart={setNewProjRestart}
              newProjCmd={newProjCmd}
              setNewProjCmd={setNewProjCmd}
              newProjArgs={newProjArgs}
              setNewProjArgs={setNewProjArgs}
              newProjCwd={newProjCwd}
              setNewProjCwd={setNewProjCwd}
              newProjPort={newProjPort}
              setNewProjPort={setNewProjPort}
              newProjCpu={newProjCpu}
              setNewProjCpu={setNewProjCpu}
              newProjRam={newProjRam}
              setNewProjRam={setNewProjRam}
              handleResetSetupForm={handleResetSetupForm}
              handleAddProject={handleAddProject}
            />
          </div>

          {/* Zone 5: Running Processes / Diagnostics — with tab switcher */}
          <div className="zone zone-5">
            <div className="zone5-tab-bar">
              <button
                className={`zone5-tab-btn ${rightBottomTab === "manager" ? "active" : ""}`}
                onClick={() => setRightBottomTab("manager")}
              >
                <Activity size={11} />
                <span>Manager</span>
              </button>
              <button
                className={`zone5-tab-btn ${rightBottomTab === "user" ? "active" : ""}`}
                onClick={() => setRightBottomTab("user")}
              >
                <User size={11} />
                <span>Diagnostics</span>
              </button>
            </div>
            <div className="zone5-content">
              {rightBottomTab === "manager" && (
                <ProcessManager
                  projects={projects}
                  activeProjectId={activeProjectId}
                  setActiveProjectId={setActiveProjectId}
                  projectStates={projectStates}
                  resourceHistory={resourceHistory}
                  handleStartProject={handleStartProject}
                  handleStopProject={handleStopProject}
                  forceKillProcess={forceKillProcess}
                />
              )}
              {rightBottomTab === "user" && (
                <DiagnosticsPanel uptimeSeconds={uptimeSeconds} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Bottom Navigation Bar */}
      <footer className="global-footer-navbar">
        <div className="navbar-nav-tabs">
          <button
            className={`nav-tab-btn ${!activeProjectId || activeProjectId === "__create_project__" ? "" : "active"}`}
            onClick={() => {
              // Switch to first project if any
              if (filteredProjects.length > 0) {
                setActiveProjectId(filteredProjects[0].id);
              }
            }}
          >
            <Layers size={13} />
            <span>Tab</span>
          </button>

          <button
            className={`nav-tab-btn`}
            onClick={() => {
              // Open terminal: scroll to bottom and set active
              setAutoScroll(true);
              if (terminalRef.current) {
                terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
              }
            }}
          >
            <TerminalIcon size={13} />
            <span>Terminal</span>
          </button>

          <button
            className={`nav-tab-btn ${rightBottomTab === "manager" ? "active" : ""}`}
            onClick={() => setRightBottomTab("manager")}
          >
            <Activity size={13} />
            <span>Manager</span>
          </button>

          <button
            className={`nav-tab-btn ${rightBottomTab === "user" ? "active" : ""}`}
            onClick={() => setRightBottomTab("user")}
          >
            <User size={13} />
            <span>User</span>
          </button>
        </div>
      </footer>

      {/* Port Conflict Resolver Modal */}
      {portConflict && (
        <div className="modal-overlay" style={{ zIndex: 110 }}>
          <div className="modal-content" style={{ borderColor: "var(--color-danger)" }}>
            <header className="modal-header" style={{ borderBottomColor: "rgba(239, 68, 68, 0.2)" }}>
              <h3
                className="modal-title"
                style={{
                  color: "var(--color-danger)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px"
                }}
              >
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
                The configured port{" "}
                <strong style={{ color: "var(--color-accent)", fontSize: "15px" }}>
                  {portConflict.port}
                </strong>{" "}
                is currently being occupied by another process on your system:
              </p>
              <div
                style={{
                  backgroundColor: "rgba(239, 68, 68, 0.05)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  padding: "12px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "4px"
                }}
              >
                <div>
                  <span style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block" }}>
                    Process Identifier
                  </span>
                  <strong style={{ fontFamily: "var(--font-mono)", fontSize: "16px" }}>
                    PID {portConflict.pid}
                  </strong>
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-danger)", fontWeight: 600 }}>
                  SOCKET BLOCKED
                </div>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.5" }}>
                Would you like to forcefully terminate the occupying PID {portConflict.pid} to reclaim the
                port and launch this tab process?
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
