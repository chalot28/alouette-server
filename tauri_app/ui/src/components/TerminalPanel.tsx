import React, { useState, useRef, useEffect } from "react";
import {
  Plus,
  Trash2,
  RefreshCw,
  X,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  FolderRoot,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";
import {
  TerminalSessionItem,
  TerminalConnectionStatus,
  Project,
} from "../types";

/* ─── Props ────────────────────────────────────────────────────────── */

interface TerminalPanelProps {
  activeProject: Project | undefined | null;
  terminals: TerminalSessionItem[];
  activeTerminalId: string;
  setActiveTerminalId: (id: string) => void;
  activeStatus: TerminalConnectionStatus;
  activeError?: string;
  terminalBufferRef: React.MutableRefObject<{ [sessionId: string]: string }>;
  onRespawnTerminal: (sessionId: string) => void;
  onRetrySpawn: (sessionId: string) => void;
  onAddTerminal: () => void;
  onDeleteTerminal: (id: string) => void;
  onDeleteAllTerminals: () => void;
  onRenameTerminal: (id: string, name: string) => void;
}

/* ─── Theme colors for xterm.js ────────────────────────────────────── */

const XTERM_THEME = {
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
};

/* ─── Component ────────────────────────────────────────────────────── */

export default function TerminalPanel({
  activeProject,
  terminals,
  activeTerminalId,
  setActiveTerminalId,
  activeStatus,
  activeError,
  terminalBufferRef,
  onRespawnTerminal,
  onRetrySpawn,
  onAddTerminal,
  onDeleteTerminal,
  onDeleteAllTerminals,
  onRenameTerminal,
}: TerminalPanelProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [hasContent, setHasContent] = useState(false);

  // ── Rename state ───────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setRenameValue(name);
    setTimeout(() => renameRef.current?.select(), 50);
  };
  const submitRename = () => {
    if (editingId && renameValue.trim())
      onRenameTerminal(editingId, renameValue.trim());
    setEditingId(null);
  };

  // ── xterm.js lifecycle ─────────────────────────────────────────────
  useEffect(() => {
    if (!activeTerminalId || !shellRef.current) {
      console.log(
        "[term] skip xterm create: id=%s shell=%o",
        activeTerminalId,
        !!shellRef.current,
      );
      return;
    }

    console.log("[term] CREATING xterm for session:", activeTerminalId);

    // Clear stale DOM
    shellRef.current.innerHTML = "";
    setHasContent(false);

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        "ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      theme: XTERM_THEME,
      convertEol: true,
      rows: 24,
    });
    xtermRef.current = term;

    const fit = new FitAddon();
    fitAddonRef.current = fit;
    term.loadAddon(fit);
    term.open(shellRef.current);
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {}
    });

    // ── Input: forward keystrokes to backend ─────────────────────
    const dataDisposer = term.onData((data) => {
      console.log(
        "[term] onData session=%s char=%j code=%d",
        activeTerminalId,
        data,
        data.charCodeAt(0),
      );
      invoke("write_to_terminal_session", {
        sessionId: activeTerminalId,
        input: data,
      }).catch((err) => console.warn("[term] write FAILED:", err));
    });

    // ── Replay buffered output ──────────────────────────────────
    const buf = terminalBufferRef.current[activeTerminalId];
    if (buf) {
      term.write(buf);
      setHasContent(true);
    }

    // ── Output: listen to Tauri events ─────────────────────────
    const termListener = listen<any>("terminal-output", (event) => {
      if (event.payload.session_id === activeTerminalId) {
        const text = event.payload.text;
        console.log("[term] output len=%d", text ? text.length : 0);
        if (text) {
          term.write(text);
          if (!hasContent) setHasContent(true);
        }
      }
    });

    // ── Resize observer ────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {}
    });
    ro.observe(shellRef.current);

    // ── Focus helper ───────────────────────────────────────────
    const focusTerm = () => {
      term.focus();
      const ta = shellRef.current?.querySelector<HTMLTextAreaElement>(
        ".xterm-helper-textarea",
      );
      if (ta && document.activeElement !== ta) ta.focus();
    };
    requestAnimationFrame(focusTerm);
    const t1 = setTimeout(focusTerm, 200);
    const t2 = setTimeout(focusTerm, 800);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      dataDisposer.dispose();
      termListener.then((u) => u());
      ro.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTerminalId]);

  // ── Clear screen ──────────────────────────────────────────────────
  const clearScreen = () => {
    setHasContent(false);
    xtermRef.current?.clear();
  };

  console.log("[term] RENDER: status=%s id=%s", activeStatus, activeTerminalId);

  const workspacePath = activeProject?.cwd || "workspace";

  return (
    <div className="sandbox-terminal">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="sandbox-terminal-header">
        <div className="sandbox-terminal-header-left">
          <span className="sandbox-badge">
            <ShieldCheck size={11} />
            SANDBOX
          </span>
          {activeProject && (
            <span className="sandbox-project-name">{activeProject.name}</span>
          )}
          <span className="sandbox-workspace-path" title={workspacePath}>
            <FolderRoot size={10} />
            {workspacePath}
          </span>
        </div>

        <div className="sandbox-terminal-header-right">
          <button
            className="sandbox-btn"
            onClick={() => onRespawnTerminal(activeTerminalId)}
            title="Respawn shell"
          >
            <RefreshCw size={11} /> Respawn
          </button>
          <button
            className="sandbox-btn"
            onClick={clearScreen}
            title="Clear screen"
          >
            <Trash2 size={11} /> Clear
          </button>
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────────── */}
      <div className="sandbox-terminal-body">
        {/* Terminal area */}
        <div className="sandbox-terminal-main">
          {/* Status overlay */}
          {activeStatus !== "connected" && (
            <div className="sandbox-overlay">
              {activeStatus === "connecting" && (
                <>
                  <Loader2 size={32} className="sandbox-spinner" />
                  <span className="sandbox-overlay-title">
                    Connecting sandbox shell...
                  </span>
                  <span className="sandbox-overlay-sub">
                    Spawning PowerShell PTY at <code>{workspacePath}</code>
                  </span>
                </>
              )}
              {activeStatus === "error" && (
                <>
                  <AlertTriangle size={32} className="sandbox-error-icon" />
                  <span className="sandbox-overlay-title sandbox-error-text">
                    Connection failed
                  </span>
                  <span className="sandbox-overlay-sub sandbox-error-detail">
                    {activeError || "Unknown error"}
                  </span>
                  <button
                    className="sandbox-retry-btn"
                    onClick={() => onRetrySpawn(activeTerminalId)}
                  >
                    <RefreshCw size={12} /> Retry
                  </button>
                </>
              )}
              {activeStatus === "disconnected" && (
                <span className="sandbox-overlay-sub">
                  No active terminal session
                </span>
              )}
            </div>
          )}
          {/* xterm container */}
          <div
            className="sandbox-xterm-wrapper"
            onClick={() => {
              xtermRef.current?.focus();
              const ta = shellRef.current?.querySelector<HTMLTextAreaElement>(
                ".xterm-helper-textarea",
              );
              if (ta && document.activeElement !== ta) ta.focus();
            }}
          >
            <div ref={shellRef} className="sandbox-xterm-viewport" />
          </div>
        </div>

        {/* ── Sidebar ─────────────────────────────────────────── */}
        <aside className="sandbox-sidebar">
          <div className="sandbox-sidebar-section">
            <div className="sandbox-sidebar-actions">
              <button
                className="sandbox-sidebar-btn"
                onClick={onAddTerminal}
                title="New terminal"
              >
                <Plus size={13} />
              </button>
              <button
                className="sandbox-sidebar-btn"
                onClick={onDeleteAllTerminals}
                title="Kill all terminals"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="sandbox-terminal-list">
              {terminals.map((t) => {
                const isActive = t.id === activeTerminalId;
                return (
                  <div
                    key={t.id}
                    className={`sandbox-terminal-item ${isActive ? "active" : ""}`}
                    onClick={() => setActiveTerminalId(t.id)}
                    onDoubleClick={() => startRename(t.id, t.name)}
                  >
                    {editingId === t.id ? (
                      <input
                        ref={renameRef}
                        className="sandbox-rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={submitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <div className="sandbox-terminal-item-left">
                          <span className="sandbox-terminal-dot" />
                          <span className="sandbox-terminal-name">
                            {t.name}
                          </span>
                        </div>
                        <button
                          className="sandbox-terminal-close"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteTerminal(t.id);
                          }}
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

          <div className="sandbox-sidebar-footer">
            <div className="sandbox-status-row">
              <span className="sandbox-status-label">Shell</span>
              <span className={`sandbox-status-value ${activeStatus}`}>
                {activeStatus === "connected" && "Active"}
                {activeStatus === "connecting" && "Spawning..."}
                {activeStatus === "error" && "Error"}
                {activeStatus === "disconnected" && "Off"}
              </span>
            </div>
            <div className="sandbox-status-row">
              <span className="sandbox-status-label">PID</span>
              <span className="sandbox-status-value mono">—</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
