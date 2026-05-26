import React, { useState, useRef, useEffect, useCallback } from "react";
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

const XTERM_THEME = {
  background: "#050507",
  foreground: "#cbd5e1",
  cursor: "#528bff",
  cursorAccent: "#050507",
  selectionBackground: "rgba(82, 139, 255, 0.35)",
  selectionInactiveBackground: "rgba(82, 139, 255, 0.15)",
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

/** Each terminal session gets its own persistent xterm instance. */
interface XtermInstance {
  term: Terminal;
  fit: FitAddon;
  disposers: (() => void)[];
}

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
  // ── Map of xterm instances, one per session ─────────────────────────
  const instancesRef = useRef<{ [sessionId: string]: XtermInstance }>({});
  // Container refs: sessionId → HTMLDivElement
  const containerRefs = useRef<{ [sessionId: string]: HTMLDivElement | null }>(
    {},
  );

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

  // ── Helper to mount xterm into a container div ──────────────────────
  const mountXterm = useCallback(
    (sessionId: string, container: HTMLDivElement) => {
      // Already mounted
      if (instancesRef.current[sessionId]) return;

      console.log("[term] MOUNT xterm for session:", sessionId);
      container.innerHTML = "";

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        cursorWidth: 2,
        fontSize: 13,
        fontFamily:
          "'JetBrains Mono', Consolas, 'Courier New', monospace",
        theme: XTERM_THEME,
        convertEol: true,
        rows: 24,
        allowTransparency: false,
        disableStdin: false,
        screenReaderMode: false,
        smoothScrollDuration: 0,
      });

      const fit = new FitAddon();
      const inst: XtermInstance = {
        term,
        fit,
        disposers: [],
      };
      instancesRef.current[sessionId] = inst;

      term.loadAddon(fit);
      term.open(container);

      const doFit = () => {
        try {
          fit.fit();
          term.refresh(0, term.rows - 1);
        } catch {}
      };

      doFit();
      requestAnimationFrame(doFit);
      setTimeout(doFit, 80);

      // Replay buffered output
      const buf = terminalBufferRef.current[sessionId];
      if (buf) {
        term.write(buf);
      }

      // Keyboard input → PTY
      const dataDisposer = term.onData((data) => {
        invoke("write_to_terminal_session", { sessionId, input: data }).catch(
          (err) => console.warn("[term] write FAILED:", err),
        );
      });
      inst.disposers.push(() => {
        try {
          dataDisposer.dispose();
        } catch {}
      });

      // Listen for terminal-output events for THIS session
      let unlistenTerm: (() => void) | null = null;
      listen<any>("terminal-output", (event) => {
        if (event.payload.session_id === sessionId) {
          const text = event.payload.text;
          if (text) {
            term.write(text);
          }
        }
      }).then((u) => {
        unlistenTerm = u;
      });
      inst.disposers.push(() => {
        if (unlistenTerm) {
          try {
            unlistenTerm();
          } catch {}
        }
      });

      // Sync frontend terminal resize to backend PTY
      const resizeDisposer = term.onResize((size) => {
        invoke("resize_terminal_session", {
          sessionId,
          rows: size.rows,
          cols: size.cols,
        }).catch((err) => console.warn("[term] resize FAILED:", err));
      });
      inst.disposers.push(() => {
        try {
          resizeDisposer.dispose();
        } catch {}
      });

      // ResizeObserver for fit
      const ro = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {}
      });
      ro.observe(container);
      inst.disposers.push(() => ro.disconnect());

      // Focus on mount
      term.focus();

      // Key handler: copy/paste
      term.attachCustomKeyEventHandler((e) => {
        if (e.key === "Backspace") {
          const activeBuffer = term.buffer.active;
          const lineIndex = activeBuffer.baseY + activeBuffer.cursorY;
          const line =
            activeBuffer.getLine(lineIndex)?.translateToString(true) || "";
          const firstGreater = line.indexOf(">");

          // Guard: If the line doesn't contain '>' yet (e.g. still replaying/loading),
          // or if the cursor is at or before the prompt boundary (CWD> ), block Backspace!
          if (firstGreater === -1 || activeBuffer.cursorX <= firstGreater + 2) {
            return false;
          }
        }
        if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "v") {
          navigator.clipboard
            .readText()
            .then((text) => {
              if (text) {
                invoke("write_to_terminal_session", {
                  sessionId,
                  input: text,
                }).catch(() => {});
              }
            })
            .catch(() => {});
          return false;
        }
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "v") {
          navigator.clipboard
            .readText()
            .then((text) => {
              if (text) {
                invoke("write_to_terminal_session", {
                  sessionId,
                  input: text,
                }).catch(() => {});
              }
            })
            .catch(() => {});
          return false;
        }
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") {
          const sel = term.getSelection();
          if (sel) {
            navigator.clipboard.writeText(sel).catch(() => {});
            return false;
          }
        }
        if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "c") {
          const sel = term.getSelection();
          if (sel) {
            navigator.clipboard.writeText(sel).catch(() => {});
            return false;
          }
        }
        return true;
      });
    },
    [terminalBufferRef],
  );

  // ── Mount/unmount xterm instances when terminals list changes ─────
  useEffect(() => {
    const ids = new Set(terminals.map((t) => t.id));

    // Mount any new terminals that don't have xterm yet
    terminals.forEach((t) => {
      const container = containerRefs.current[t.id];
      if (container && !instancesRef.current[t.id]) {
        mountXterm(t.id, container);
      }
    });

    // Destroy xterm for removed terminals
    Object.keys(instancesRef.current).forEach((sid) => {
      if (!ids.has(sid)) {
        console.log("[term] DESTROY xterm for session:", sid);
        const inst = instancesRef.current[sid];
        inst.disposers.forEach((d) => {
          try {
            d();
          } catch {}
        });
        inst.term.dispose();
        delete instancesRef.current[sid];
        delete containerRefs.current[sid];
      }
    });
  }, [terminals, mountXterm]);

  // ── When activeTerminalId changes, focus the active one ────────────
  useEffect(() => {
    if (activeTerminalId && instancesRef.current[activeTerminalId]) {
      const inst = instancesRef.current[activeTerminalId];
      inst.term.focus();

      // Multi-stage fitting to guarantee correct dimensions as the active layout settles
      const doFit = () => {
        try {
          inst.fit.fit();
          inst.term.refresh(0, inst.term.rows - 1);
        } catch {}
      };

      doFit();
      requestAnimationFrame(doFit);
      const timer = setTimeout(doFit, 80);
      return () => clearTimeout(timer);
    }
  }, [activeTerminalId]);

  // ── Refit all when fonts are loaded to avoid overlapping characters ──
  useEffect(() => {
    if (typeof document !== "undefined" && "fonts" in document) {
      const handleFontsLoaded = () => {
        Object.keys(instancesRef.current).forEach((sid) => {
          try {
            instancesRef.current[sid].fit.fit();
            instancesRef.current[sid].term.refresh(0, instancesRef.current[sid].term.rows - 1);
          } catch {}
        });
      };
      document.fonts.ready.then(handleFontsLoaded);
    }
  }, [terminals]);

  // ── Debug: log status changes ──────────────────────────────────────
  useEffect(() => {
    console.log(
      "[term] STATUS: id=%s status=%s error=%s",
      activeTerminalId,
      activeStatus,
      activeError || "",
    );
  }, [activeTerminalId, activeStatus, activeError]);

  // ── Clear screen ──────────────────────────────────────────────────
  const clearScreen = () => {
    const inst = activeTerminalId
      ? instancesRef.current[activeTerminalId]
      : undefined;
    inst?.term.clear();
    invoke("write_to_terminal_session", {
      sessionId: activeTerminalId,
      input: "\x1b[2J\x1b[H",
    }).catch((err) => console.warn("[term] clear PTY FAILED:", err));
  };

  console.log(
    "[term] RENDER: status=%s id=%s terminals=%d",
    activeStatus,
    activeTerminalId,
    terminals.length,
  );
  const workspacePath = activeProject?.cwd || "workspace";

  return (
    <div className="sandbox-terminal">
      <header className="sandbox-terminal-header">
        <div className="sandbox-terminal-header-left">
          <span className="sandbox-badge">
            <ShieldCheck size={11} /> SANDBOX
          </span>
          {activeProject && (
            <span className="sandbox-project-name">{activeProject.name}</span>
          )}
          <span className="sandbox-workspace-path" title={workspacePath}>
            <FolderRoot size={10} /> {workspacePath}
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

      <div className="sandbox-terminal-body">
        <div className="sandbox-terminal-main">
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

          {/* Render a separate xterm container for each terminal session.
              Only the active one is visible; others are hidden offscreen/via opacity to preserve layout measurements. */}
          <div className="sandbox-xterm-wrapper">
            {terminals.map((t) => (
              <div
                key={t.id}
                ref={(el) => {
                  containerRefs.current[t.id] = el;
                }}
                className={`sandbox-xterm-viewport ${t.id === activeTerminalId ? "active" : ""}`}
              />
            ))}
          </div>
        </div>

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
              <span className="sandbox-status-value mono">&mdash;</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
