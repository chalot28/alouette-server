import React, { useState, useRef, useEffect } from "react";
import { Terminal as TerminalIcon, Search, Trash2, Cpu, Hammer, CheckCircle2, XCircle, Plus, TerminalSquare, RefreshCw, X, Copy, Download } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface TerminalSessionItem {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd?: string;
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
  termOutput: string;
  clearTermOutput: (id: string) => void;
  triggerToast?: (message: string, type: "success" | "error" | "info") => void;

  // Multi-terminal props
  terminals: TerminalSessionItem[];
  activeTerminalId: string;
  setActiveTerminalId: (id: string) => void;
  onAddTerminal: () => void;
  onDeleteTerminal: (id: string) => void;
  onDeleteAllTerminals: () => void;
  onRenameTerminal: (id: string, name: string) => void;
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
  termOutput,
  clearTermOutput,
  terminals,
  activeTerminalId,
  setActiveTerminalId,
  onAddTerminal,
  onDeleteTerminal,
  onDeleteAllTerminals,
  onRenameTerminal,
  triggerToast
}: TerminalPanelProps) {
  // Tab selector between Piped Logs (Mode B) and Isolated Interactive Terminal (Mode A)
  const [terminalTab, setTerminalTab] = useState<"logs" | "shell">("shell");
  const [cmdInput, setCmdInput] = useState("");
  const shellViewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCopyAllLogs = () => {
    if (filteredLogs.length === 0) {
      if (triggerToast) triggerToast("No logs to copy", "info");
      return;
    }
    const rawText = filteredLogs
      .map((log) => `[${new Date(log.timestamp).toLocaleTimeString()}] [${log.stream.toUpperCase()}] ${log.text}`)
      .join("\n");
    navigator.clipboard.writeText(rawText)
      .then(() => {
        if (triggerToast) triggerToast("Logs copied to clipboard!", "success");
      })
      .catch((err) => {
        console.error("Failed to copy logs:", err);
        if (triggerToast) triggerToast("Failed to copy logs", "error");
      });
  };

  const handleExportLogs = () => {
    if (filteredLogs.length === 0) {
      if (triggerToast) triggerToast("No logs to export", "info");
      return;
    }
    const rawText = filteredLogs
      .map((log) => `[${new Date(log.timestamp).toLocaleTimeString()}] [${log.stream.toUpperCase()}] ${log.text}`)
      .join("\n");

    const blob = new Blob([rawText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let randomName = "";
    for (let i = 0; i < 12; i++) {
      randomName += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const filename = `${randomName}.log`;

    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", url);
    downloadAnchor.setAttribute("download", filename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);

    if (triggerToast) triggerToast(`Logs exported as ${filename}!`, "success");
  };

  // Renaming state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Scroll interactive terminal to the bottom whenever text is appended
  useEffect(() => {
    if (shellViewportRef.current) {
      shellViewportRef.current.scrollTop = shellViewportRef.current.scrollHeight;
    }
  }, [termOutput, terminalTab]);

  const handleSendCmd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmdInput.trim() || !activeTerminalId) return;

    try {
      // Send key line feed to isolated shell process stdin
      await invoke("write_to_terminal_session", {
        sessionId: activeTerminalId,
        input: cmdInput + "\n"
      });
      setCmdInput("");
    } catch (err) {
      console.error("Failed to write to terminal session:", err);
    }
  };

  const handleRespawnTerminal = async () => {
    if (!activeTerminalId) return;
    try {
      await invoke("spawn_terminal_session", {
        sessionId: activeTerminalId,
        cwd: activeProject?.cwd || null
      });
      clearTermOutput(activeTerminalId);
    } catch (err) {
      alert(`Failed to respawn terminal: ${err}`);
    }
  };

  const handleStartRename = (id: string, name: string) => {
    setEditingId(id);
    setRenameValue(name);
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 50);
  };

  const handleRenameSubmit = () => {
    if (editingId && renameValue.trim()) {
      onRenameTerminal(editingId, renameValue.trim());
    }
    setEditingId(null);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRenameSubmit();
    } else if (e.key === "Escape") {
      setEditingId(null);
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
                onClick={handleCopyAllLogs}
                style={{ borderColor: "rgba(58, 134, 255, 0.2)", color: "var(--color-accent)" }}
              >
                <Copy size={11} />
                <span>Copy All</span>
              </button>

              <button
                className="terminal-btn-clear"
                onClick={handleExportLogs}
                style={{ borderColor: "rgba(16, 185, 129, 0.2)", color: "var(--color-success)" }}
              >
                <Download size={11} />
                <span>Export Logs</span>
              </button>

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
                onClick={() => {
                  if (activeTerminalId) {
                    clearTermOutput(activeTerminalId);
                  }
                }}
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
                  disabled={!activeTerminalId}
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
                onClick={onAddTerminal}
                title="Add new terminal"
              >
                <Plus size={13} />
              </button>
              <button 
                className="terminal-action-btn trash" 
                onClick={onDeleteAllTerminals}
                title="Clear all terminals in active project"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="active-terminals-list">
              {terminals.map((term) => {
                const isSelected = term.id === activeTerminalId;
                return (
                  <div
                    key={term.id}
                    className={`active-terminal-item ${isSelected ? "active" : ""}`}
                    onClick={() => setActiveTerminalId(term.id)}
                    onDoubleClick={() => handleStartRename(term.id, term.name)}
                  >
                    {editingId === term.id ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        className="terminal-rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={handleRenameSubmit}
                        onKeyDown={handleRenameKeyDown}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <div className="terminal-item-left">
                          <span className="terminal-item-dot running" />
                          <span className="terminal-item-name" title="Double click to rename">{term.name}</span>
                        </div>
                        <button
                          className="terminal-item-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteTerminal(term.id);
                          }}
                          title="Delete terminal"
                        >
                          <X size={11} />
                        </button>
                      </>
                    )}
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
