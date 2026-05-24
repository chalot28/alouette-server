import { useEffect, useState, useRef } from "react";
import {
  Layers,
  Activity,
  User,
  Terminal as TerminalIcon,
  Plus,
  X,
  FileCode,
  MoreHorizontal,
  CheckCircle2,
  AlertTriangle,
  Info,
  HelpCircle,
  GitBranch,
  Sparkles,
  Wifi,
  Chrome,
  Server,
  Cpu,
  Settings
} from "lucide-react";

// Components
import Header from "./components/Header";
import CodeEditor from "./components/CodeEditor";
import ConfigSetup from "./components/ConfigSetup";
import TabList from "./components/TabList";
import TerminalPanel from "./components/TerminalPanel";
import ProcessManager from "./components/ProcessManager";
import DiagnosticsPanel from "./components/DiagnosticsPanel";
import FileExplorer from "./components/FileExplorer";
import SqliteEditor from "./components/SqliteEditor";

// Types
import {
  ResourceHistory,
  TerminalSessionItem,
  ProcessState,
  LogLine,
} from "./types";

// Hooks
import { useProjects } from "./hooks/useProjects";
import { useResources } from "./hooks/useResources";
import { useTerminal } from "./hooks/useTerminal";

export default function App() {
  // Theme State
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Custom Toast & Confirm states
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    message: string;
    onConfirm: () => void;
    onCancel?: () => void;
  } | null>(null);

  const triggerToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
  };

  const triggerConfirm = (message: string, onConfirm: () => void, onCancel?: () => void) => {
    setConfirmModal({ message, onConfirm, onCancel });
  };

  // Auto dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Dynamic UI States
  const [searchQuery, setSearchQuery] = useState("");
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [settingMenuOpen, setSettingMenuOpen] = useState(false);
  const [uptimeSeconds, setUptimeSeconds] = useState(0);

  // Bottom nav tab (for right-bottom panel between manager / user)
  const [rightBottomTab, setRightBottomTab] = useState<"manager" | "user">(
    "manager",
  );

  // Canvas Refs for CPU/RAM Charts
  const cpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const ramCanvasRef = useRef<HTMLCanvasElement>(null);

  // Persistent refs for scroll and cursor positions of files in CodeEditor
  const editorScrollPositionsRef = useRef<{ [path: string]: number }>({});
  const editorCursorPositionsRef = useRef<{
    [path: string]: { start: number; end: number };
  }>({});

  // Resizable Panel States
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(220);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(320);
  const [tabListHeight, setTabListHeight] = useState(250);
  const [monitorHeight, setMonitorHeight] = useState(250);
  const [configHeight, setConfigHeight] = useState(300);

  // Refs for dragging math
  const tabListRef = useRef<HTMLDivElement>(null);
  const monitorRef = useRef<HTMLDivElement>(null);
  const configRef = useRef<HTMLDivElement>(null);

  // Drag state trackers for class highlights
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const [isDraggingTabList, setIsDraggingTabList] = useState(false);
  const [isDraggingMonitor, setIsDraggingMonitor] = useState(false);
  const [isDraggingConfig, setIsDraggingConfig] = useState(false);

  // ── Cross-hook dependency holders (useRef pattern to break circular deps) ──
  const setResourceHistoryRef = useRef<
    React.Dispatch<React.SetStateAction<ResourceHistory>>
  >(() => {});
  const projectTerminalsRef = useRef<{
    [projectId: string]: TerminalSessionItem[];
  }>({});
  const setProjectTerminalsRef = useRef<
    React.Dispatch<
      React.SetStateAction<{ [projectId: string]: TerminalSessionItem[] }>
    >
  >(() => {});
  const setActiveTerminalIdsRef = useRef<
    React.Dispatch<React.SetStateAction<{ [projectId: string]: string }>>
  >(() => {});
  const setTermOutputsRef = useRef<
    React.Dispatch<React.SetStateAction<{ [id: string]: string }>>
  >(() => {});

  // ── Hooks ──

  // 1. Project management
  const projectHook = useProjects({
    setResourceHistory: (action) => setResourceHistoryRef.current(action),
    projectTerminals: projectTerminalsRef.current,
    setProjectTerminals: (action) => setProjectTerminalsRef.current(action),
    setActiveTerminalIds: (action) => setActiveTerminalIdsRef.current(action),
    setTermOutputs: (action) => setTermOutputsRef.current(action),
    triggerToast,
    triggerConfirm,
  });

  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    projectStates,
    projectLogs,
    setProjectLogs,
    activeProject,
    openFilePath,
    setOpenFilePath,
    openFiles,
    setOpenFiles,
    openFileContent,
    isFileLoading,
    fileError,
    isSqliteFile,
    filesContent,
    setFilesContent,
    filesOriginalContent,
    setFilesOriginalContent,
    showTabsMenu,
    setShowTabsMenu,
    newProjName,
    setNewProjName,
    newProjCmd,
    setNewProjCmd,
    newProjArgs,
    setNewProjArgs,
    newProjCwd,
    setNewProjCwd,
    newProjSetup,
    setNewProjSetup,
    newProjSetupArgs,
    setNewProjSetupArgs,
    newProjRestart,
    setNewProjRestart,
    newProjEnv,
    setNewProjEnv,
    newProjCpu,
    setNewProjCpu,
    newProjRam,
    setNewProjRam,
    newProjPort,
    setNewProjPort,
    newProjSource,
    setNewProjSource,
    newProjTerminalMode,
    setNewProjTerminalMode,
    newProjToolchain,
    setNewProjToolchain,
    newProjToolchainVersion,
    setNewProjToolchainVersion,
    newProjEnableTunnel,
    setNewProjEnableTunnel,
    newProjMaxLogLines,
    setNewProjMaxLogLines,
    portConflict,
    setPortConflict,
    handleStart,
    handleStartProject,
    handleStopProject,
    handleStop,
    handleAddProject,
    handleDeleteProject,
    handleExportConfig,
    handleImportMockConfig,
    wipeConfig,
    handleResetSetupForm,
    handleForceKillAndStart,
    handleFileOpen,
    handleFileClose,
    handleCloseAllTabs,
    handleSaveAndCloseAllTabs,
  } = projectHook;

  // 2. Resource monitoring
  const resourceHook = useResources(
    activeProjectId,
    theme,
    cpuCanvasRef,
    ramCanvasRef,
  );
  const { resourceHistory, forceKillProcess } = resourceHook;

  // Update cross-hook refs after useResources is called
  setResourceHistoryRef.current = resourceHook.setResourceHistory;

  // 3. Terminal management
  const terminalHook = useTerminal(activeProjectId, activeProject, projects);
  const {
    termOutputs,
    setTermOutputs,
    projectTerminals,
    setProjectTerminals,
    activeTerminalIds,
    setActiveTerminalIds,
    logFilter,
    setLogFilter,
    logSearchQuery,
    setLogSearchQuery,
    autoScroll,
    setAutoScroll,
    terminalRef,
    handleAddTerminal,
    handleDeleteTerminal,
    handleDeleteAllTerminals,
    handleRenameTerminal,
    handleTerminalScroll,
  } = terminalHook;

  // Update cross-hook refs after useTerminal is called
  projectTerminalsRef.current = projectTerminals;
  setProjectTerminalsRef.current = setProjectTerminals;
  setActiveTerminalIdsRef.current = setActiveTerminalIds;
  setTermOutputsRef.current = setTermOutputs;

  // ── Theme effect ──
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // ── System Uptime Counter ──
  useEffect(() => {
    const timer = setInterval(() => {
      setUptimeSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Window click listener to close dropdowns ──
  useEffect(() => {
    const handleWindowClick = () => {
      setFileMenuOpen(false);
      setSettingMenuOpen(false);
      setShowTabsMenu(false);
    };
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  // ── Derived state ──
  const activeState: ProcessState = projectStates[activeProjectId] || {
    type: "Stopped",
  };
  const activeLogs: LogLine[] = projectLogs[activeProjectId] || [];
  const activeHistory = resourceHistory[activeProjectId] || {
    cpu: [],
    ram: [],
  };
  const activeCpuVal = activeHistory.cpu[activeHistory.cpu.length - 1] || 0.0;
  const activeRamVal = activeHistory.ram[activeHistory.ram.length - 1] || 0.0;

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

  // ── Auto-scroll terminal ──
  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [activeLogs, autoScroll]);

  // ── Resize Handlers ──

  // 1. Left Sidebar Width Resize Handler
  const handleLeftResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingLeft(true);
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(160, Math.min(450, moveEvent.clientX));
      setLeftSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsDraggingLeft(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // 2. Right Sidebar Width Resize Handler
  const handleRightResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingRight(true);
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(
        200,
        Math.min(500, window.innerWidth - moveEvent.clientX),
      );
      setRightSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsDraggingRight(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // 3. Tab List Horizontal Height Resize Handler
  const handleTabListResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!tabListRef.current) return;
    setIsDraggingTabList(true);
    const tabListRect = tabListRef.current.getBoundingClientRect();
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newHeight = Math.max(
        80,
        Math.min(400, moveEvent.clientY - tabListRect.top),
      );
      setTabListHeight(newHeight);
    };
    const handleMouseUp = () => {
      setIsDraggingTabList(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // 4. Resource Monitor Horizontal Height Resize Handler
  const handleMonitorResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!monitorRef.current) return;
    setIsDraggingMonitor(true);
    const monitorRect = monitorRef.current.getBoundingClientRect();
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newHeight = Math.max(
        100,
        Math.min(500, moveEvent.clientY - monitorRect.top),
      );
      setMonitorHeight(newHeight);
    };
    const handleMouseUp = () => {
      setIsDraggingMonitor(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // 5. Config Setup Horizontal Height Resize Handler
  const handleConfigResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!configRef.current) return;
    setIsDraggingConfig(true);
    const configRect = configRef.current.getBoundingClientRect();
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newHeight = Math.max(
        120,
        Math.min(450, moveEvent.clientY - configRect.top),
      );
      setConfigHeight(newHeight);
    };
    const handleMouseUp = () => {
      setIsDraggingConfig(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // ── Render ──
  return (
    <div className="app-container">
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
        activeProject={activeProject}
        activeState={activeState}
        handleStart={handleStart}
        handleStop={handleStop}
        triggerConfirm={triggerConfirm}
        triggerToast={triggerToast}
      />

      {/* 2. Main Workspace — Full Dashboard Grid */}
      <div
        className="workspace-grid"
        style={{
          gridTemplateColumns: `${leftSidebarWidth}px 1fr ${rightSidebarWidth}px`,
          position: "relative",
        }}
      >
        {/* ── LEFT COLUMN: Zone 1 (Tab list) + Zone 3 (File Explorer) + Zone 6 (New project btn) ── */}
        <div
          className="col-left"
          style={{
            position: "relative",
            height: "100%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Zone 1: Tab List */}
          <div
            ref={tabListRef}
            className="zone zone-1"
            style={{
              flex: `0 0 ${tabListHeight}px`,
              borderBottom: "1px solid var(--border-primary)",
              position: "relative",
            }}
          >
            <TabList
              filteredProjects={
                activeProjectId === "__create_project__"
                  ? [
                      ...filteredProjects,
                      {
                        id: "__create_project__",
                        name: "New Project",
                        command: "",
                        args: [],
                      },
                    ]
                  : filteredProjects
              }
              activeProjectId={activeProjectId}
              setActiveProjectId={setActiveProjectId}
              projectStates={projectStates}
              setAutoScroll={setAutoScroll}
              handleDeleteProject={handleDeleteProject}
            />
            <div
              className={`resizer-h ${isDraggingTabList ? "dragging" : ""}`}
              style={{ position: "absolute", bottom: "-2px", left: 0 }}
              onMouseDown={handleTabListResizeStart}
            />
          </div>

          {/* Zone 3: Project File Explorer */}
          <div
            className="zone zone-file-explorer"
            style={{ flex: 1, overflow: "hidden" }}
          >
            <FileExplorer
              activeCwd={activeProject?.cwd}
              onFileSelect={handleFileOpen}
            />
          </div>

          {/* Zone 6: New Project Button */}
          <div className="zone zone-6">
            <button className="btn-new-project" onClick={handleResetSetupForm}>
              <Plus size={14} />
              <span>New Project</span>
            </button>
          </div>

          <div
            className={`resizer-v ${isDraggingLeft ? "dragging" : ""}`}
            style={{ right: "-2px" }}
            onMouseDown={handleLeftResizeStart}
          />
        </div>

        {/* ── CENTER COLUMN: Zone 2 (Monitor) + Zone 4 (Terminal) ── */}
        <div
          className="col-center"
          style={{ height: "100%", display: "flex", flexDirection: "column" }}
        >
          {activeProjectId === "__create_project__" ? (
            <div
              className="zone zone-center-config"
              style={{ flex: 1, padding: "24px", overflowY: "auto" }}
            >
              <div style={{ maxWidth: "800px", margin: "0 auto" }}>
                <h2
                  style={{
                    fontSize: "16px",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    marginBottom: "20px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <Plus size={18} style={{ color: "var(--color-accent)" }} />
                  <span>Configure New Project Tab</span>
                </h2>
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
                  newProjSource={newProjSource}
                  setNewProjSource={setNewProjSource}
                  newProjTerminalMode={newProjTerminalMode}
                  setNewProjTerminalMode={setNewProjTerminalMode}
                  newProjToolchain={newProjToolchain}
                  setNewProjToolchain={setNewProjToolchain}
                  newProjToolchainVersion={newProjToolchainVersion}
                  setNewProjToolchainVersion={setNewProjToolchainVersion}
                  newProjEnableTunnel={newProjEnableTunnel}
                  setNewProjEnableTunnel={setNewProjEnableTunnel}
                  newProjMaxLogLines={newProjMaxLogLines}
                  setNewProjMaxLogLines={setNewProjMaxLogLines}
                  handleResetSetupForm={handleResetSetupForm}
                  handleAddProject={handleAddProject}
                />
              </div>
            </div>
          ) : (
            <>
              {/* Zone 2: Code Editor */}
              <div
                ref={monitorRef}
                className="zone zone-2"
                style={{
                  flex: `0 0 ${monitorHeight}px`,
                  borderBottom: "1px solid var(--border-primary)",
                  position: "relative",
                }}
              >
                {openFiles.length > 0 && (
                  <div className="tabs-header-container">
                    <div className="editor-tabs-bar">
                      {openFiles.map((path) => (
                        <div
                          key={`tab-${encodeURIComponent(path)}`}
                          className={`editor-tab ${openFilePath === path ? "active" : ""}`}
                          onClick={() => setOpenFilePath(path)}
                          title={path}
                        >
                          <FileCode size={12} className="tab-icon" />
                          <span className="tab-name">
                            {path.split(/[\\/]/).pop()}
                          </span>
                          <button
                            className="tab-close-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleFileClose(path);
                            }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="tabs-actions-container">
                      <button
                        className={`btn-tabs-actions ${showTabsMenu ? "active" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowTabsMenu(!showTabsMenu);
                        }}
                        title="Tab actions"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      {showTabsMenu && (
                        <div className="tabs-dropdown-menu">
                          <button
                            className="tabs-dropdown-item"
                            onClick={handleCloseAllTabs}
                          >
                            Delete All
                          </button>
                          <button
                            className="tabs-dropdown-item font-semibold"
                            onClick={handleSaveAndCloseAllTabs}
                          >
                            Save and Delete All
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {isSqliteFile && openFilePath ? (
                  <SqliteEditor filePath={openFilePath} triggerConfirm={triggerConfirm} triggerToast={triggerToast} />
                ) : (
                  <CodeEditor
                    theme={theme}
                    filePath={openFilePath}
                    content={
                      openFilePath ? (filesContent[openFilePath] ?? null) : null
                    }
                    isLoading={isFileLoading}
                    error={fileError}
                    onChange={(newVal) => {
                      if (openFilePath) {
                        setFilesContent((prev) => ({
                          ...prev,
                          [openFilePath]: newVal,
                        }));
                      }
                    }}
                    onSave={(savedVal) => {
                      if (openFilePath) {
                        setFilesOriginalContent((prev) => ({
                          ...prev,
                          [openFilePath]: savedVal,
                        }));
                      }
                    }}
                    scrollPositionsRef={editorScrollPositionsRef}
                    cursorPositionsRef={editorCursorPositionsRef}
                  />
                )}
                <div
                  className={`resizer-h ${isDraggingMonitor ? "dragging" : ""}`}
                  style={{ position: "absolute", bottom: "-2px", left: 0 }}
                  onMouseDown={handleMonitorResizeStart}
                />
              </div>

              {/* Zone 4: Terminal */}
              <div className="zone zone-4" style={{ flex: 1 }}>
                <TerminalPanel
                  activeProject={activeProject}
                  activeProjectId={activeProjectId}
                  filteredLogs={filteredLogs}
                  triggerToast={triggerToast}
                  logFilter={logFilter}
                  setLogFilter={setLogFilter}
                  logSearchQuery={logSearchQuery}
                  setLogSearchQuery={setLogSearchQuery}
                  clearLogs={(id) =>
                    setProjectLogs((prev) => ({ ...prev, [id]: [] }))
                  }
                  terminalRef={terminalRef}
                  handleTerminalScroll={handleTerminalScroll}
                  termOutput={
                    termOutputs[activeTerminalIds[activeProjectId] || ""] || ""
                  }
                  clearTermOutput={(id) =>
                    setTermOutputs((prev) => ({ ...prev, [id]: "" }))
                  }
                  terminals={projectTerminals[activeProjectId] || []}
                  activeTerminalId={activeTerminalIds[activeProjectId] || ""}
                  setActiveTerminalId={(termId) =>
                    setActiveTerminalIds((prev) => ({
                      ...prev,
                      [activeProjectId]: termId,
                    }))
                  }
                  onAddTerminal={() => handleAddTerminal(activeProjectId)}
                  onDeleteTerminal={(termId) =>
                    handleDeleteTerminal(activeProjectId, termId)
                  }
                  onDeleteAllTerminals={() =>
                    handleDeleteAllTerminals(activeProjectId)
                  }
                  onRenameTerminal={(termId, name) =>
                    handleRenameTerminal(activeProjectId, termId, name)
                  }
                />
              </div>
            </>
          )}
        </div>

        {/* ── RIGHT COLUMN: Zone 3 (Config) + Zone 5 (Process Manager) ── */}
        <div
          className="col-right"
          style={{
            position: "relative",
            height: "100%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            className={`resizer-v ${isDraggingRight ? "dragging" : ""}`}
            style={{ left: "-2px" }}
            onMouseDown={handleRightResizeStart}
          />

          {/* Zone 3: Configuration & Watchdog Setup */}
          {activeProjectId && activeProjectId !== "__create_project__" && (
            <div
              ref={configRef}
              className="zone zone-3"
              style={{
                flex: `0 0 ${configHeight}px`,
                borderBottom: "1px solid var(--border-primary)",
                position: "relative",
              }}
            >
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
                newProjSource={newProjSource}
                setNewProjSource={setNewProjSource}
                newProjTerminalMode={newProjTerminalMode}
                setNewProjTerminalMode={setNewProjTerminalMode}
                newProjToolchain={newProjToolchain}
                setNewProjToolchain={setNewProjToolchain}
                newProjToolchainVersion={newProjToolchainVersion}
                setNewProjToolchainVersion={setNewProjToolchainVersion}
                newProjEnableTunnel={newProjEnableTunnel}
                setNewProjEnableTunnel={setNewProjEnableTunnel}
                newProjMaxLogLines={newProjMaxLogLines}
                setNewProjMaxLogLines={setNewProjMaxLogLines}
                handleResetSetupForm={handleResetSetupForm}
                handleAddProject={handleAddProject}
              />
              <div
                className={`resizer-h ${isDraggingConfig ? "dragging" : ""}`}
                style={{ position: "absolute", bottom: "-2px", left: 0 }}
                onMouseDown={handleConfigResizeStart}
              />
            </div>
          )}

          {/* Zone 5: Running Processes / Diagnostics — with tab switcher */}
          <div className="zone zone-5" style={{ flex: 1 }}>
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
                  triggerConfirm={triggerConfirm}
                  triggerToast={triggerToast}
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
              setAutoScroll(true);
              if (terminalRef.current) {
                terminalRef.current.scrollTop =
                  terminalRef.current.scrollHeight;
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

        <div className="navbar-tool-buttons">
          <button className="tool-btn tool-git" title="1. Git">
            <GitBranch size={14} />
          </button>
          <button className="tool-btn tool-ai" title="2. AI">
            <Sparkles size={14} />
          </button>
          <button className="tool-btn tool-ping" title="3. Ping">
            <Wifi size={14} />
          </button>
          <button className="tool-btn tool-chrome" title="4. Chrome">
            <Chrome size={14} />
          </button>
          <button className="tool-btn tool-env" title="5. Environment (Môi trường)">
            <Server size={14} />
          </button>
          <button className="tool-btn tool-build" title="6. Build">
            <Cpu size={14} />
          </button>
          <button className="tool-btn tool-settings" title="7. Setting">
            <Settings size={14} />
          </button>
          <button className="tool-btn tool-help" title="8. Help">
            <HelpCircle size={14} />
          </button>
        </div>
      </footer>

      {/* Port Conflict Resolver Modal */}
      {portConflict && (
        <div className="modal-overlay" style={{ zIndex: 110 }}>
          <div
            className="modal-content"
            style={{ borderColor: "var(--color-danger)" }}
          >
            <header
              className="modal-header"
              style={{ borderBottomColor: "rgba(239, 68, 68, 0.2)" }}
            >
              <h3
                className="modal-title"
                style={{
                  color: "var(--color-danger)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
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
                <strong
                  style={{ color: "var(--color-accent)", fontSize: "15px" }}
                >
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
                  marginTop: "4px",
                }}
              >
                <div>
                  <span
                    style={{
                      fontSize: "12px",
                      color: "var(--text-secondary)",
                      display: "block",
                    }}
                  >
                    Process Identifier
                  </span>
                  <strong
                    style={{ fontFamily: "var(--font-mono)", fontSize: "16px" }}
                  >
                    PID {portConflict.pid}
                  </strong>
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--color-danger)",
                    fontWeight: 600,
                  }}
                >
                  SOCKET BLOCKED
                </div>
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  lineHeight: "1.5",
                }}
              >
                Would you like to forcefully terminate the occupying PID{" "}
                {portConflict.pid} to reclaim the port and launch this tab
                process?
              </p>
            </div>

            <footer
              className="modal-footer"
              style={{ borderTopColor: "rgba(239, 68, 68, 0.1)" }}
            >
              <button
                className="btn btn-secondary"
                onClick={() => setPortConflict(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleForceKillAndStart}
              >
                Force Kill & Start
              </button>
            </footer>
          </div>
        </div>
      )}
      {/* Custom Toast Notification System */}
      {toast && (
        <div className="app-toast-container">
          <div className={`app-toast ${toast.type}`}>
            <span className={`app-toast-icon ${toast.type}`}>
              {toast.type === "success" && <CheckCircle2 size={16} />}
              {toast.type === "error" && <AlertTriangle size={16} />}
              {toast.type === "info" && <Info size={16} />}
            </span>
            <div className="app-toast-message">{toast.message}</div>
            <button className="app-toast-close" onClick={() => setToast(null)}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Custom Confirm Modal Dialog */}
      {confirmModal && (
        <div className="app-confirm-overlay" onClick={() => {
          if (confirmModal.onCancel) confirmModal.onCancel();
          setConfirmModal(null);
        }}>
          <div className="app-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <header className="app-confirm-header">
              <HelpCircle size={18} style={{ color: "var(--color-warning)" }} />
              <span className="app-confirm-title">Confirm Action</span>
            </header>
            <div className="app-confirm-body">{confirmModal.message}</div>
            <footer className="app-confirm-actions">
              <button className="btn-confirm-cancel" onClick={() => {
                if (confirmModal.onCancel) confirmModal.onCancel();
                setConfirmModal(null);
              }}>
                Cancel
              </button>
              <button className="btn-confirm-accept" onClick={() => {
                confirmModal.onConfirm();
                setConfirmModal(null);
              }}>
                Confirm
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
