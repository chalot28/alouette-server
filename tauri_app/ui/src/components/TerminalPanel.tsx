import React, { useState, useRef, useEffect } from "react";
import { Terminal as TerminalIcon, Search, Trash2, Cpu, Hammer, CheckCircle2, XCircle, Plus, TerminalSquare, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface Project {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd?: string;
}

interface ProcessState {
  type: "Stopped" | "Setup" | "Running" | "Crashing" | "Terminated" | "Fatal";
  data?: any;
}

interface LogLine {
  text: string;
  stream: "stdout" | "stderr" | "system";
  timestamp: number;
}

interface TerminalPanelProps {
  activeProject: Project | undefined;
  activeProjectId: string;
  filteredLogs: LogLine[];
  logFilter: "all" | "stdout" | "stderr" | "system";
  setLogFilter: (f: "all" | "stdout" | "stderr" | "system") => void;
  logSearchQuery: string;
  setLogSearchQuery: (q: string) => void;
  clearLogs: (id: string) => void;
  terminalRef: React.RefObject<HTMLDivElement>;
  handleTerminalScroll: () => void;
  projects: Project[];
  projectStates: { [id: string]: ProcessState };
  setActiveProjectId: (id: string) => void;
  handleResetSetupForm: () => void;
  termOutput: string;
  clearTermOutput: (id: string) => void;
}

export default function TerminalPanel({
  activeProject,
  activeProjectId,
  filteredLogs,
  logFilter,
  setLogFilter,
  logSearchQuery,
  setLogSearchQuery,
  clearLogs,
  terminalRef,
  handleTerminalScroll,
  projects,
  projectStates,
  setActiveProjectId,
  handleResetSetupForm,
  termOutput,
  clearTermOutput
}: TerminalPanelProps) {
  // Tab selector between Piped Logs (Mode B) and Isolated Interactive Terminal (Mode A)
  const [terminalTab, setTerminalTab] = useState<"logs" | "shell">("shell");
  const [cmdInput, setCmdInput] = useState("");
  const shellViewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll interactive terminal to the bottom whenever text is appended
  useEffect(() => {
    if (shellViewportRef.current) {
      shellViewportRef.current.scrollTop = shellViewportRef.current.scrollHeight;
    }
  }, [termOutput, terminalTab]);

  const handleSendCmd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmdInput.trim() || !activeProjectId) return;

    try {
      // Send key line feed to isolated shell process stdin
      await invoke("write_to_terminal_session", {
        sessionId: activeProjectId,
        input: cmdInput + "\n"
      });
      setCmdInput("");
    } catch (err) {
      console.error("Failed to write to terminal session:", err);
    }
  };

  const handleRespawnTerminal = async () => {
    if (!activeProjectId) return;
    try {
      await invoke("spawn_terminal_session", {
        sessionId: activeProjectId,
        cwd: activeProject?.cwd || null
      });
      clearTermOutput(activeProjectId);
    } catch (err) {
      alert(`Failed to respawn terminal: ${err}`);
    }
  };

  // Mock build statistics that represent a high-end compiler/process builder
  const [buildStats] = useState({
    total: 16,
    success: 12,
    failed: 4,
    lastStatus: "Success"
  });

  return (
    <div className="lower-panel-terminal">
      <header className="terminal-controls-header">
        <div className="terminal-meta-title" style={{ gap: "12px" }}>
          {/* Dual Tab Switcher */}
          <nav className="terminal-tabs-nav">
            <button
              className={`terminal-tab-button ${terminalTab === "shell" ? "active" : ""}`}
              onClick={() => setTerminalTab("shell")}
            >
              <TerminalSquare size={11} />
              <span>ISOLATED SHELL (PROTO)</span>
            </button>
            <button
              className={`terminal-tab-button ${terminalTab === "logs" ? "active" : ""}`}
              onClick={() => setTerminalTab("logs")}
            >
              <TerminalIcon size={11} />
              <span>PIPED SYSTEM LOGS</span>
            </button>
          </nav>
          {activeProject && <span className="active-badge">{activeProject.name}</span>}
        </div>

        <div className="terminal-filter-actions">
          {terminalTab === "logs" ? (
            <>
              <div className="filter-pill-group">
                {(["all", "stdout", "stderr", "system"] as const).map((stream) => (
                  <button
                    key={stream}
                    className={`filter-pill ${logFilter === stream ? "active" : ""}`}
                    onClick={() => setLogFilter(stream)}
                  >
                    {stream.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="log-search-wrapper">
                <Search size={11} />
                <input
                  type="text"
                  placeholder="Filter logs..."
                  value={logSearchQuery}
                  onChange={(e) => setLogSearchQuery(e.target.value)}
                />
                {logSearchQuery && (
                  <button onClick={() => setLogSearchQuery("")}>✕</button>
                )}
              </div>

              <button
                className="terminal-btn-clear"
                onClick={() => clearLogs(activeProjectId)}
              >
                <Trash2 size={11} />
                <span>Clear Logs</span>
              </button>
            </>
          ) : (
            <>
              <button
                className="terminal-btn-clear"
                onClick={handleRespawnTerminal}
                style={{ borderColor: "rgba(58, 134, 255, 0.2)", color: "var(--color-accent)" }}
              >
                <RefreshCw size={11} />
                <span>Respawn Shell</span>
              </button>
              <button
                className="terminal-btn-clear"
                onClick={() => clearTermOutput(activeProjectId)}
              >
                <Trash2 size={11} />
                <span>Clear Screen</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Split Layout Container */}
      <div className="terminal-split-layout">
        {/* Left Side Viewport */}
        <div className="terminal-logs-pane">
          {terminalTab === "logs" ? (
            <div
              ref={terminalRef}
              className="terminal-scroll-viewport"
              onScroll={handleTerminalScroll}
            >
              {filteredLogs.length === 0 ? (
                <div className="terminal-empty-log">
                  --- Ready. Start the process or search filters to capture stderr/stdout log pipelines ---
                </div>
              ) : (
                filteredLogs.map((log, index) => (
                  <div key={index} className={`terminal-log-line ${log.stream}`}>
                    <span className="log-timestamp">
                      [{new Date(log.timestamp).toLocaleTimeString()}]
                    </span>
                    <span className="log-stream-indicator">[{log.stream.toUpperCase()}]</span>
                    <span className="log-text">{log.text}</span>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="interactive-terminal-container" onClick={() => inputRef.current?.focus()}>
              <div ref={shellViewportRef} className="interactive-terminal-viewport">
                {termOutput ? (
                  termOutput
                ) : (
                  <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                    --- Sandboxed Interactive Terminal Session Attached. Active toolchain prioritizes proto environment. type commands below (e.g. node -v, go version) ---{"\n\n"}
                  </span>
                )}
              </div>
              <form onSubmit={handleSendCmd} className="terminal-prompt-bar" onClick={(e) => e.stopPropagation()}>
                <span className="terminal-prompt-prefix">$</span>
                <input
                  ref={inputRef}
                  type="text"
                  className="terminal-prompt-field"
                  value={cmdInput}
                  onChange={(e) => setCmdInput(e.target.value)}
                  placeholder="Execute commands inside the sandboxed workspace folder..."
                  disabled={!activeProjectId}
                />
              </form>
            </div>
          )}
        </div>

        {/* Right Side Split: Sidebar holding Sections 1 & 2 */}
        <aside className="terminal-split-sidebar">
          {/* Section 1: Active Terminal Switcher */}
          <div className="terminal-split-sidebar-1">
            <div className="split-sidebar-action-header">
              <button 
                className="terminal-action-btn" 
                onClick={handleResetSetupForm}
                title="Add new terminal"
              >
                <Plus size={13} />
              </button>
              <button 
                className="terminal-action-btn trash" 
                onClick={() => {
                  if (terminalTab === "logs") {
                    clearLogs(activeProjectId);
                  } else {
                    clearTermOutput(activeProjectId);
                  }
                }}
                title="Clear active terminal logs"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="active-terminals-list">
              {projects.map((p) => {
                const state = projectStates[p.id] || { type: "Stopped" };
                const isRunning = state.type === "Running";
                return (
                  <div
                    key={p.id}
                    className={`active-terminal-item ${p.id === activeProjectId ? "active" : ""}`}
                    onClick={() => setActiveProjectId(p.id)}
                  >
                    <div className="terminal-item-left">
                      <span className={`terminal-item-dot ${isRunning ? "running" : "stopped"}`} />
                      <span className="terminal-item-name">{p.name}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: Build Tracker / Statistics */}
          <div className="terminal-split-sidebar-2">
            <h4 className="split-sidebar-title">
              <Hammer size={11} />
              <span>Build counts (2)</span>
            </h4>
            <div className="build-counters-container">
              <div className="build-stat-row">
                <span className="build-stat-label">
                  <CheckCircle2 size={11} style={{ color: "var(--color-success)" }} />
                  Successful:
                </span>
                <span className="build-stat-value success">{buildStats.success}</span>
              </div>
              <div className="build-stat-row">
                <span className="build-stat-label">
                  <XCircle size={11} style={{ color: "var(--color-danger)" }} />
                  Failed:
                </span>
                <span className="build-stat-value fail">{buildStats.failed}</span>
              </div>
              <div className="build-stat-row">
                <span className="build-stat-label">
                  <Cpu size={11} />
                  Total Builds:
                </span>
                <span className="build-stat-value total">{buildStats.total}</span>
              </div>
              <div style={{ marginTop: "4px" }}>
                <span className="build-stat-label" style={{ fontSize: "10.5px" }}>Success Rate (75%)</span>
                <div className="build-progress-bar-bg">
                  <div className="build-progress-bar-fill" />
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
