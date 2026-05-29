import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  LayoutGrid,
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
  Server,
  Cpu,
  Settings,
  SlidersHorizontal,
  Hammer,
  Database,
  Cloud
} from "lucide-react";

// Components
import Header from "./components/Header";
import CodeEditor from "./components/CodeEditor";
import ConfigSetup from "./components/ConfigSetup";
import TabList from "./components/TabList";
import TerminalPanel from "./components/TerminalPanel";
import ProcessManager from "./components/ProcessManager";
import BuildPanel from "./components/BuildPanel";
import AdminPanel from "./components/AdminPanel";
import FileExplorer from "./components/FileExplorer";
import SqliteEditor from "./components/SqliteEditor";
import MiniPostman from "./components/MiniPostman";
import AiAgent from "./components/AiAgent";
import ProjectResources from "./components/ProjectResources";
import CloudflareTunnel from "./components/CloudflareTunnel";
import { getCurrentWindow } from "@tauri-apps/api/window";

function ZenIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Vòng tròn hở nghệ thuật Zen Ensō */}
      <path d="M12 3a9 9 0 1 0 9 9c0-1.5-.4-3-1.1-4.2" />
      {/* Chữ Z cách điệu mềm mại thanh thoát ở tâm */}
      <path d="M8.5 8.5h7L10 15.5h7" />
    </svg>
  );
}

function LayoutLeftIcon({ active, size = 15 }: { active: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
      <line x1="5.5" y1="1.5" x2="5.5" y2="14.5" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
      {active && (
        <rect x="2.1" y="2.1" width="2.8" height="11.8" fill="currentColor" />
      )}
    </svg>
  );
}

function LayoutBottomIcon({ active, size = 15 }: { active: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
      <line x1="1.5" y1="10.5" x2="14.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
      {active && (
        <rect x="2.1" y="11.1" width="11.8" height="2.8" fill="currentColor" />
      )}
    </svg>
  );
}

function LayoutRightIcon({ active, size = 15 }: { active: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
      <line x1="10.5" y1="1.5" x2="10.5" y2="14.5" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
      {active && (
        <rect x="11.1" y="2.1" width="2.8" height="11.8" fill="currentColor" />
      )}
    </svg>
  );
}


// Types
import { ResourceHistory, TerminalSessionItem, ProcessState } from "./types";

// Hooks
import { useProjects } from "./hooks/useProjects";
import { useResources } from "./hooks/useResources";
import { useTerminal } from "./hooks/useTerminal";

export default function App() {
  // Theme State
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Window label state to detect multi-window views (e.g. Mini Postman ping window)
  const [windowLabel, setWindowLabel] = useState<string>("main");

  useEffect(() => {
    try {
      const win = getCurrentWindow();
      setWindowLabel(win.label);
    } catch (e) {
      console.error("Failed to get current window label:", e);
    }
  }, []);

  // Custom Toast & Confirm states
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    message: string;
    onConfirm: () => void;
    onCancel?: () => void;
  } | null>(null);

  const triggerToast = (
    message: string,
    type: "success" | "error" | "info" = "info",
  ) => {
    setToast({ message, type });
  };

  const triggerConfirm = (
    message: string,
    onConfirm: () => void,
    onCancel?: () => void,
  ) => {
    setConfirmModal({ message, onConfirm, onCancel });
  };

  // Auto dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Dynamic UI States
  const [searchQuery, setSearchQuery] = useState("");
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [settingMenuOpen, setSettingMenuOpen] = useState(false);
  const [uptimeSeconds, setUptimeSeconds] = useState(0);

  // Bottom nav tab (for right-bottom panel between manager / build)
  const [rightBottomTab, setRightBottomTab] = useState<"manager" | "build">(
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

  // Layout toggle states
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [isAiViewActive, setIsAiViewActive] = useState(false);


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

  // ── Hooks ──

  // 1. Project management
  const projectHook = useProjects({
    setResourceHistory: (action) => setResourceHistoryRef.current(action),
    projectTerminals: projectTerminalsRef.current,
    setProjectTerminals: (action) => setProjectTerminalsRef.current(action),
    setActiveTerminalIds: (action) => setActiveTerminalIdsRef.current(action),
    setTermOutputs: () => {}, // no-op: output is rendered directly in TerminalPanel via xterm.js
    triggerToast,
    triggerConfirm,
  });

  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    projectStates,
    projectLogs,
    activeProject,
    openFilePath,
    setOpenFilePath,
    setOpenFiles,
    isFileLoading,
    fileError,
    filesContent,
    setFilesContent,
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
    newProjRestart,
    setNewProjRestart,
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
  const terminalHook = useTerminal(activeProjectId, activeProject);
  const {
    terminals,
    activeTerminalId,
    setActiveTerminalId,
    activeStatus,
    activeError,
    terminalBufferRef,
    setProjectTerminalsState,
    setActiveTerminalIdsState,
    addTerminal,
    deleteTerminal,
    deleteAllTerminals,
    renameTerminal,
    respawnTerminal,
    retrySpawn,
  } = terminalHook;
  setProjectTerminalsRef.current = setProjectTerminalsState;
  setActiveTerminalIdsRef.current = setActiveTerminalIdsState;

  // ── Theme effect ──
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Split Editor Pane structures
  interface EditorPane {
    openFiles: string[];
    openFilePath: string | null;
  }

  const [panes, setPanes] = useState<EditorPane[]>([
    { openFiles: [], openFilePath: null }
  ]);
  const [activePaneIndex, setActivePaneIndex] = useState<number>(0);
  const [draggedOverPaneIndex, setDraggedOverPaneIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    targetPaneIndex: number | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    targetPaneIndex: null
  });

  // Sync back to projectHook when active pane or its selected file changes
  useEffect(() => {
    const activePane = panes[activePaneIndex];
    if (activePane) {
      setOpenFilePath(activePane.openFilePath);
      setOpenFiles(activePane.openFiles);
    }
  }, [activePaneIndex, panes]);

  // Handle opening file in the active pane
  const handleFileOpenCustom = (path: string) => {
    const normalizedPath = path.replace(/\\/g, "/");
    setPanes((prevPanes) => {
      const copy = [...prevPanes];
      const pane = { ...copy[activePaneIndex] };
      if (!pane.openFiles.includes(normalizedPath)) {
        pane.openFiles = [...pane.openFiles, normalizedPath];
      }
      pane.openFilePath = normalizedPath;
      copy[activePaneIndex] = pane;
      return copy;
    });
    setOpenFilePath(normalizedPath);
  };

  // Close tab in a specific pane
  const handleFileCloseCustom = (paneIdx: number, path: string) => {
    const normalizedPath = path.replace(/\\/g, "/");
    setPanes((prevPanes) => {
      const copy = [...prevPanes];
      const pane = { ...copy[paneIdx] };
      const newOpenFiles = pane.openFiles.filter((f) => f !== normalizedPath);
      pane.openFiles = newOpenFiles;
      if (pane.openFilePath === normalizedPath) {
        pane.openFilePath = newOpenFiles.length > 0 ? newOpenFiles[newOpenFiles.length - 1] : null;
      }
      copy[paneIdx] = pane;
      return copy;
    });
  };

  // Close all tabs across all panes
  const handleCloseAllTabsCustom = () => {
    setPanes([{ openFiles: [], openFilePath: null }]);
    setActivePaneIndex(0);
    setOpenFilePath(null);
    setOpenFiles([]);
    setFilesContent({});
    setFilesOriginalContent({});
  };

  // Tab container context menu handler
  const handleTabContainerContextMenu = (e: React.MouseEvent, paneIdx: number) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      targetPaneIndex: paneIdx
    });
  };

  // Close custom context menu on outside click
  useEffect(() => {
    const handleCloseMenu = () => {
      setContextMenu((prev) => ({ ...prev, visible: false }));
    };
    window.addEventListener("click", handleCloseMenu);
    return () => window.removeEventListener("click", handleCloseMenu);
  }, []);

  // Split active pane into another side-by-side pane
  const handleSplit = () => {
    if (panes.length >= 3) {
      triggerToast("Chỉ hỗ trợ tối đa 3 phân vùng màn hình", "info");
      return;
    }
    setPanes((prev) => {
      const currentActive = prev[activePaneIndex];
      const newPane: EditorPane = {
        openFiles: currentActive.openFilePath ? [currentActive.openFilePath] : [],
        openFilePath: currentActive.openFilePath
      };
      return [...prev, newPane];
    });
    setActivePaneIndex(panes.length);
  };

  // Close a split pane and consolidate layout
  const handleClosePane = (paneIdx: number) => {
    if (panes.length <= 1) return;
    setPanes((prev) => prev.filter((_, idx) => idx !== paneIdx));
    setActivePaneIndex(0);
  };

  // Tab HTML5 Drag & Drop handlers
  const handleDragStart = (e: React.DragEvent, sourcePaneIdx: number, path: string) => {
    e.dataTransfer.setData("text/plain", path);
    e.dataTransfer.setData("sourcePaneIndex", String(sourcePaneIdx));
  };

  const handleDrop = (e: React.DragEvent, targetPaneIdx: number) => {
    e.preventDefault();
    const path = e.dataTransfer.getData("text/plain");
    const sourcePaneIdxStr = e.dataTransfer.getData("sourcePaneIndex");
    if (!path || sourcePaneIdxStr === "") return;
    const sourcePaneIdx = parseInt(sourcePaneIdxStr, 10);

    if (sourcePaneIdx === targetPaneIdx) return;

    setPanes((prevPanes) => {
      const copy = [...prevPanes];
      const sourcePane = { ...copy[sourcePaneIdx] };
      const targetPane = { ...copy[targetPaneIdx] };

      // Remove from source
      sourcePane.openFiles = sourcePane.openFiles.filter((f) => f !== path);
      if (sourcePane.openFilePath === path) {
        sourcePane.openFilePath = sourcePane.openFiles.length > 0 ? sourcePane.openFiles[sourcePane.openFiles.length - 1] : null;
      }

      // Add to target
      if (!targetPane.openFiles.includes(path)) {
        targetPane.openFiles = [...targetPane.openFiles, path];
      }
      targetPane.openFilePath = path;

      copy[sourcePaneIdx] = sourcePane;
      copy[targetPaneIdx] = targetPane;
      return copy;
    });

    setActivePaneIndex(targetPaneIdx);
    setOpenFilePath(path);
  };



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

  // Local state for backward compat (TabList references these)
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Filter project lists based on Search input
  const filteredProjects = projects.filter((p) => {
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.command.toLowerCase().includes(q) ||
      p.args.join(" ").toLowerCase().includes(q)
    );
  });

  // ── Auto-scroll terminal ──
  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, []);

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

  if (windowLabel === "ping_window") {
    return <MiniPostman />;
  }

  if (windowLabel === "admin_window") {
    return <AdminPanel />;
  }

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
        onOpenResources={() => handleFileOpenCustom("__resources__")}
        onToggleTunnel={() => handleFileOpenCustom("__cloudflare_tunnel__")}
      />

      {/* 2. Main Workspace — Full Dashboard Grid */}
      <div
        className="workspace-grid"
        style={{
          gridTemplateColumns: `${isLeftSidebarOpen ? leftSidebarWidth : 0}px 1fr ${isRightSidebarOpen ? rightSidebarWidth : 0}px`,
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
            overflow: "hidden",
            borderRight: isLeftSidebarOpen ? "" : "none",
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
              onFileSelect={handleFileOpenCustom}
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
                  flex: isBottomPanelOpen ? `0 0 ${monitorHeight}px` : 1,
                  borderBottom: isBottomPanelOpen ? "1px solid var(--border-primary)" : "none",
                  position: "relative",
                }}
              >
                <div className="split-editor-container">
                  {panes.map((pane, paneIdx) => {
                    const isActivePane = paneIdx === activePaneIndex;
                    const paneOpenFilePath = pane.openFilePath;
                    const paneOpenFiles = pane.openFiles;
                    const paneIsSqliteFile = paneOpenFilePath ? (
                      paneOpenFilePath.toLowerCase().endsWith(".db") ||
                      paneOpenFilePath.toLowerCase().endsWith(".sqlite") ||
                      paneOpenFilePath.toLowerCase().endsWith(".sqlite3")
                    ) : false;

                    return (
                      <div
                        key={`pane-${paneIdx}`}
                        className={`editor-pane ${isActivePane ? "active" : ""} ${draggedOverPaneIndex === paneIdx ? "drag-over" : ""}`}
                        onClick={() => {
                          if (!isActivePane) {
                            setActivePaneIndex(paneIdx);
                            setOpenFilePath(paneOpenFilePath);
                          }
                        }}
                        onDragEnter={(e) => {
                          e.preventDefault();
                          setDraggedOverPaneIndex(paneIdx);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                        }}
                        onDragLeave={() => {
                          setDraggedOverPaneIndex(null);
                        }}
                        onDrop={(e) => {
                          setDraggedOverPaneIndex(null);
                          handleDrop(e, paneIdx);
                        }}
                      >
                        {paneOpenFiles.length > 0 && (
                          <div
                            className="tabs-header-container"
                            onContextMenu={(e) => handleTabContainerContextMenu(e, paneIdx)}
                          >
                            <div className="editor-tabs-bar">
                              {paneOpenFiles.map((path) => (
                                <div
                                  key={`tab-${paneIdx}-${encodeURIComponent(path)}`}
                                  className={`editor-tab ${paneOpenFilePath === path ? "active" : ""}`}
                                  draggable
                                  onDragStart={(e) => handleDragStart(e, paneIdx, path)}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActivePaneIndex(paneIdx);
                                    setPanes((prev) => {
                                      const copy = [...prev];
                                      copy[paneIdx] = { ...copy[paneIdx], openFilePath: path };
                                      return copy;
                                    });
                                    setOpenFilePath(path);
                                  }}
                                  title={path}
                                >
                                  {path === "__resources__" ? (
                                    <Database size={12} className="tab-icon" />
                                  ) : path === "__cloudflare_tunnel__" ? (
                                    <Cloud size={12} className="tab-icon" style={{ color: "#F38020" }} />
                                  ) : (
                                    <FileCode size={12} className="tab-icon" />
                                  )}
                                  <span className="tab-name">
                                    {path === "__resources__" ? "Tài nguyên" : path === "__cloudflare_tunnel__" ? "Cloudflare Tunnel" : path.split(/[\\/]/).pop()}
                                  </span>
                                  <button
                                    className="tab-close-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleFileCloseCustom(paneIdx, path);
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
                                    onClick={handleCloseAllTabsCustom}
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

                        <div className="editor-pane-body" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                          {!paneOpenFilePath ? (
                            <div
                              className="code-editor-empty"
                              onContextMenu={(e) => handleTabContainerContextMenu(e, paneIdx)}
                            >
                              <FileCode size={32} className="empty-icon" />
                              <h3>No File Selected</h3>
                              <p>Click on any file in the Project Explorer or right-click to Split screen.</p>
                              {panes.length > 1 && (
                                <button
                                  className="btn btn-secondary"
                                  style={{
                                    marginTop: "16px",
                                    padding: "6px 14px",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    borderColor: "var(--border-primary)",
                                    color: "var(--text-primary)",
                                    backgroundColor: "transparent"
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleClosePane(paneIdx);
                                  }}
                                >
                                  Đóng phân vùng này
                                </button>
                              )}
                            </div>
                          ) : paneOpenFilePath === "__resources__" ? (
                            <ProjectResources
                              activeProject={activeProject || null}
                              activeState={activeState}
                              resourceHistory={resourceHistory}
                            />
                          ) : paneOpenFilePath === "__cloudflare_tunnel__" ? (
                            <CloudflareTunnel />
                          ) : paneIsSqliteFile ? (
                            <SqliteEditor
                              filePath={paneOpenFilePath}
                              triggerConfirm={triggerConfirm}
                              triggerToast={triggerToast}
                            />
                          ) : (
                            <CodeEditor
                              theme={theme}
                              filePath={paneOpenFilePath}
                              content={
                                paneOpenFilePath ? (filesContent[paneOpenFilePath] ?? null) : null
                              }
                              isLoading={isFileLoading && openFilePath === paneOpenFilePath}
                              error={openFilePath === paneOpenFilePath ? fileError : null}
                              onChange={(newVal) => {
                                if (paneOpenFilePath) {
                                  setFilesContent((prev) => ({
                                    ...prev,
                                    [paneOpenFilePath]: newVal,
                                  }));
                                }
                              }}
                              onSave={(savedVal) => {
                                if (paneOpenFilePath) {
                                  setFilesOriginalContent((prev) => ({
                                    ...prev,
                                    [paneOpenFilePath]: savedVal,
                                  }));
                                }
                              }}
                              scrollPositionsRef={editorScrollPositionsRef}
                              cursorPositionsRef={editorCursorPositionsRef}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {isBottomPanelOpen && (
                  <div
                    className={`resizer-h ${isDraggingMonitor ? "dragging" : ""}`}
                    style={{ position: "absolute", bottom: "-2px", left: 0 }}
                    onMouseDown={handleMonitorResizeStart}
                  />
                )}
              </div>

              {/* Zone 4: Terminal */}
              {isBottomPanelOpen && (
                <div className="zone zone-4" style={{ flex: 1 }}>
                  <TerminalPanel
                    theme={theme}
                    activeProject={activeProject}
                    projectLogs={projectLogs}
                    terminals={terminals}
                    activeTerminalId={activeTerminalId}
                    setActiveTerminalId={setActiveTerminalId}
                    activeStatus={activeStatus}
                    activeError={activeError}
                    terminalBufferRef={terminalBufferRef}
                    onRespawnTerminal={respawnTerminal}
                    onRetrySpawn={retrySpawn}
                    onAddTerminal={addTerminal}
                    onDeleteTerminal={deleteTerminal}
                    onDeleteAllTerminals={deleteAllTerminals}
                    onRenameTerminal={renameTerminal}
                  />
                </div>
              )}
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
            overflow: "hidden",
          }}
        >
          <div
            className={`resizer-v ${isDraggingRight ? "dragging" : ""}`}
            style={{ left: "-2px" }}
            onMouseDown={handleRightResizeStart}
          />

          {isAiViewActive ? (
            <AiAgent 
              onBack={() => setIsAiViewActive(false)} 
              activeProjectCwd={activeProject?.cwd}
              activeProjectId={activeProject?.id}
            />
          ) : (
            <>
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
                    <span>Manager</span>
                  </button>
                  <button
                    className={`zone5-tab-btn ${rightBottomTab === "build" ? "active" : ""}`}
                    onClick={() => setRightBottomTab("build")}
                  >
                    <span>Build Setup</span>
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
                  {rightBottomTab === "build" && (
                    <BuildPanel uptimeSeconds={uptimeSeconds} />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <footer className="global-footer-navbar">
        <div className="navbar-nav-tabs">
          <button
            className={`nav-tab-btn ${!activeProjectId || activeProjectId === "__create_project__" ? "" : "active"}`}
            onClick={() => {
              if (filteredProjects.length > 0) {
                setActiveProjectId(filteredProjects[0].id);
              }
            }}
            title="Tab"
          >
            <LayoutGrid size={16} />
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
            title="Terminal"
          >
            <TerminalIcon size={16} />
          </button>

          <button
            className={`nav-tab-btn ${rightBottomTab === "manager" ? "active" : ""}`}
            onClick={() => setRightBottomTab("manager")}
            title="Manager"
          >
            <SlidersHorizontal size={16} />
          </button>

          <button
            className={`nav-tab-btn ${rightBottomTab === "build" ? "active" : ""}`}
            onClick={() => setRightBottomTab("build")}
            title="Build"
          >
            <Hammer size={16} />
          </button>

          {/* Divider line before premium layout toggles */}
          <div
            style={{
              height: "16px",
              width: "1px",
              backgroundColor: "var(--border-primary)",
              margin: "0 8px",
            }}
          />

          {/* Premium Layout Toggles */}
          <button
            className={`nav-tab-btn ${isLeftSidebarOpen ? "active" : ""}`}
            onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}
            title="Toggle Left Sidebar"
            style={{
              padding: "0 8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <LayoutLeftIcon active={isLeftSidebarOpen} size={15} />
          </button>

          <button
            className={`nav-tab-btn ${isBottomPanelOpen ? "active" : ""}`}
            onClick={() => setIsBottomPanelOpen(!isBottomPanelOpen)}
            title="Toggle Bottom Panel"
            style={{
              padding: "0 8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <LayoutBottomIcon active={isBottomPanelOpen} size={15} />
          </button>

          <button
            className={`nav-tab-btn ${isRightSidebarOpen ? "active" : ""}`}
            onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
            title="Toggle Right Sidebar"
            style={{
              padding: "0 8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <LayoutRightIcon active={isRightSidebarOpen} size={15} />
          </button>
        </div>

        <div className="navbar-tool-buttons">
          <button className="tool-btn tool-git" title="1. Git">
            <GitBranch size={14} />
          </button>
          <button
            className={`tool-btn tool-ai ${isAiViewActive && isRightSidebarOpen ? "active" : ""}`}
            title="2. AI"
            onClick={() => {
              if (!isRightSidebarOpen) {
                setIsRightSidebarOpen(true);
                setIsAiViewActive(true);
              } else {
                setIsAiViewActive(!isAiViewActive);
              }
            }}
          >
            <Sparkles size={14} />
          </button>
          <button
            className="tool-btn tool-ping"
            title="3. Ping"
            onClick={async () => {
              try {
                await invoke("open_ping_window");
              } catch (e) {
                console.error("Failed to open ping window:", e);
                triggerToast("Failed to open Ping window.", "error");
              }
            }}
          >
            <Wifi size={14} />
          </button>
          <button
            className="tool-btn tool-zen"
            title="4. Zen Browser"
            onClick={async () => {
              try {
                await invoke("open_browser_window");
              } catch (e) {
                console.error("Failed to open Zen Browser:", e);
                triggerToast("Failed to open Zen Browser.", "error");
              }
            }}
          >
            <ZenIcon size={14} />
          </button>
          <button
            className="tool-btn tool-env"
            title="5. Environment (Môi trường)"
          >
            <Server size={14} />
          </button>
          <button className="tool-btn tool-build" title="6. Build">
            <Cpu size={14} />
          </button>
          <button
            className="tool-btn tool-settings"
            title="7. Setting"
            onClick={async () => {
              try {
                await invoke("open_admin_window");
              } catch (e) {
                triggerToast("Failed to open Admin panel.", "error");
              }
            }}
          >
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
        <div
          className="app-confirm-overlay"
          onClick={() => {
            if (confirmModal.onCancel) confirmModal.onCancel();
            setConfirmModal(null);
          }}
        >
          <div
            className="app-confirm-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="app-confirm-header">
              <HelpCircle size={18} style={{ color: "var(--color-warning)" }} />
              <span className="app-confirm-title">Confirm Action</span>
            </header>
            <div className="app-confirm-body">{confirmModal.message}</div>
            <footer className="app-confirm-actions">
              <button
                className="btn-confirm-cancel"
                onClick={() => {
                  if (confirmModal.onCancel) confirmModal.onCancel();
                  setConfirmModal(null);
                }}
              >
                Cancel
              </button>
              <button
                className="btn-confirm-accept"
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
              >
                Confirm
              </button>
            </footer>
          </div>
        </div>
      )}
      {/* Custom Right-Click Context Menu for Splitting Editor Panes */}
      {contextMenu.visible && (
        <div
          className="custom-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="context-menu-item" onClick={handleSplit}>
            <span>Split (Chia đôi)</span>
          </button>
          {panes.length > 1 && (
            <button
              className="context-menu-item"
              onClick={() => handleClosePane(contextMenu.targetPaneIndex!)}
            >
              <span>Close Split Pane</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

