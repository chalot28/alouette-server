import React, { useState } from "react";
import { Terminal as TerminalIcon, Search, Trash2, Cpu, Hammer, CheckCircle2, XCircle } from "lucide-react";

interface Project {
  id: string;
  name: string;
  command: string;
  args: string[];
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
  setActiveProjectId
}: TerminalPanelProps) {
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
        <div className="terminal-meta-title">
          <TerminalIcon size={13} />
          <span>LOG PIPELINE STREAM</span>
          {activeProject && <span className="active-badge">{activeProject.name}</span>}
        </div>

        <div className="terminal-filter-actions">
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
        </div>
      </header>

      {/* Split Layout Container */}
      <div className="terminal-split-layout">
        {/* Left Side: Unmarked Log Stream Viewport */}
        <div className="terminal-logs-pane">
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
        </div>

        {/* Right Side Split: Sidebar holding Sections 1 & 2 */}
        <aside className="terminal-split-sidebar">
          {/* Section 1: Active Terminal Switcher */}
          <div className="terminal-split-sidebar-1">
            <h4 className="split-sidebar-title">
              <TerminalIcon size={11} />
              <span>Active Terminals (1)</span>
            </h4>
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

