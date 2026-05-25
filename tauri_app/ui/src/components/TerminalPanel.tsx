import React, { useState, useRef, useEffect } from "react";
import { Terminal as TerminalIcon, Search, Trash2, Cpu, Hammer, CheckCircle2, XCircle, Plus, TerminalSquare, RefreshCw, X, Copy, Download } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";

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
  const shellViewportRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);

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

  // Initialize and manage xterm.js interactive terminal
  useEffect(() => {
    if (terminalTab !== "shell" || !activeTerminalId || !shellViewportRef.current) return;

    // Clear container before re-init to avoid orphaned xterm DOM
    shellViewportRef.current.innerHTML = "";

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      theme: {
        background: "#050507",
        foreground: "#cbd5e1",
        cursor: "#528bff",
        black: "#000000",
        red: "#ef4444",
        green: "#10b981",
        yellow: "#f59e0b",
        blue: "#3b82f6",
        magenta: "#d946ef",
        cyan: "#06b6d4",
        white: "#f1f5f9",
        brightBlack: "#475569",
        brightRed: "#f87171",
        brightGreen: "#34d399",
        brightYellow: "#fbbf24",
        brightBlue: "#60a5fa",
        brightMagenta: "#e879f9",
        brightCyan: "#22d3ee",
        brightWhite: "#ffffff",
      },
      convertEol: true,
      rows: 24,
    });

    xtermRef.current = term;

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(shellViewportRef.current);

    // Fit after DOM is ready
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch (_) {}
    });

    // Populate terminal output history (or default message if new)
    if (termOutput) {
      term.write(termOutput);
    } else {
      term.write("\r\n\x1b[33m--- Sandboxed Interactive Terminal Session Attached. Active toolchain prioritizes proto environment. ---\x1b[0m\r\n\r\n");
    }

    // DEBUG: Log keyboard events to diagnose input issues
    const onKeyDisposable = term.onKey((e) => {
      console.log("[XTERM DEBUG] onKey fired:", e.key, "domEvent:", e.domEvent.key);
    });

    // Stream typed keys directly to standard input of the shell
    const onDataDisposable = term.onData((data) => {
      console.log("[XTERM DEBUG] onData fired, data:", JSON.stringify(data), "sessionId:", activeTerminalId);
      invoke("write_to_terminal_session", {
        sessionId: activeTerminalId,
        input: data,
      }).catch((err) => {
        console.warn("[XTERM DEBUG] write_to_terminal_session FAILED:", err);
      });
    });

    // Listen to new output events from backend
    const termListener = listen<any>("terminal-output", (event) => {
      if (event.payload.session_id === activeTerminalId) {
        term.write(event.payload.text);
      }
    });

    // Auto resize terminal using ResizeObserver when panel dimensions change
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch (_) {}
    });
    resizeObserver.observe(shellViewportRef.current);

    // Focus the terminal after a brief delay to ensure DOM is rendered
    term.focus();
    const focusTimer = setTimeout(() => {
      term.focus();
      console.log("[XTERM DEBUG] Delayed focus applied. textarea exists:", !!term.textarea);
    }, 300);

    return () => {
      clearTimeout(focusTimer);
      xtermRef.current = null;
      onKeyDisposable.dispose();
      onDataDisposable.dispose();
      termListener.then((unlisten) => unlisten());
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [terminalTab, activeTerminalId]);


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
            <div 
              className="interactive-terminal-container" 
              style={{ padding: "8px", cursor: "text" }}
              onClick={() => {
                if (xtermRef.current) {
                  xtermRef.current.focus();
                }
              }}
            >
              <div ref={shellViewportRef} style={{ width: "100%", height: "100%", overflow: "hidden" }} />
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
