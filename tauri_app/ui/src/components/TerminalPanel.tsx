import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  RefreshCw,
  X,
  Loader2,
  AlertTriangle,
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
  LogLine,
} from "../types";

interface TerminalPanelProps {
  theme?: "dark" | "light";
  activeProject: Project | undefined | null;
  projectLogs?: { [id: string]: LogLine[] };
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

const XTERM_DARK_THEME = {
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

const XTERM_LIGHT_THEME = {
  background: "#f5f5f7",
  foreground: "#1e293b",
  cursor: "#0056e0",
  cursorAccent: "#f5f5f7",
  selectionBackground: "rgba(0, 86, 224, 0.2)",
  selectionInactiveBackground: "rgba(0, 86, 224, 0.08)",
  black: "#0f172a",
  red: "#dc2626",
  green: "#15803d",
  yellow: "#b45309",
  blue: "#1d4ed8",
  magenta: "#a21caf",
  cyan: "#0369a1",
  white: "#334155",
  brightBlack: "#475569",
  brightRed: "#b91c1c",
  brightGreen: "#166534",
  brightYellow: "#9a3412",
  brightBlue: "#1e40af",
  brightMagenta: "#86198f",
  brightCyan: "#075985",
  brightWhite: "#0f172a",
};

/** Each terminal session gets its own persistent xterm instance. */
interface XtermInstance {
  term: Terminal;
  fit: FitAddon;
  disposers: (() => void)[];
}

function LogViewer({ logs }: { logs: LogLine[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div 
      ref={containerRef}
      style={{
        flex: 1,
        background: "var(--terminal-bg)",
        color: "var(--text-primary)",
        fontFamily: "'JetBrains Mono', Consolas, monospace",
        fontSize: "12px",
        padding: "16px",
        overflowY: "auto",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "6px"
      }}
    >
      {logs && logs.length > 0 ? (
        logs.map((log, idx) => {
          const isErr = log.stream === "stderr";
          const isSys = log.stream === "system";
          let color = "var(--text-primary)";
          if (isErr) color = "var(--color-danger)";
          else if (isSys) color = "var(--color-setup)";

          return (
            <div key={idx} style={{ display: "flex", gap: "8px", lineBreak: "anywhere" }}>
              <span style={{ color: "var(--text-muted)", flexShrink: 0, userSelect: "none" }}>[{log.timestamp}]</span>
              <span style={{ color, whiteSpace: "pre-wrap" }}>{log.text}</span>
            </div>
          );
        })
      ) : (
        <div style={{ color: "var(--text-muted)", fontStyle: "italic", textAlign: "center", marginTop: "40px" }}>
          No active system logs. Click "Start" in the header to execute the application.
        </div>
      )}
    </div>
  );
}

function SimplePing() {
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("http://localhost:3000");
  const [reqBody, setReqBody] = useState("{\n  \"key\": \"value\"\n}");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePing = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResponse(null);

    let parsedBody = null;
    let bodyType = "none";
    let headers: any = {};

    if (method !== "GET" && method !== "DELETE" && reqBody.trim()) {
      parsedBody = reqBody.trim();
      bodyType = "json";
      headers["Content-Type"] = "application/json";
    }

    try {
      const res = await invoke<any>("send_http_request", {
        req: {
          url: url.trim(),
          method,
          headers,
          body: parsedBody,
          body_type: bodyType,
          timeout_ms: 10000,
        }
      });
      setResponse(res);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      width: "100%",
      background: "var(--bg-primary)",
      color: "var(--text-primary)",
      padding: "16px",
      gap: "12px",
      boxSizing: "border-box"
    }}>
      <div style={{ display: "flex", gap: "8px" }}>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          style={{
            background: "var(--bg-tertiary)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-primary)",
            borderRadius: "4px",
            padding: "8px 12px",
            fontSize: "13px",
            outline: "none"
          }}
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>

        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:3000/api/endpoint"
          style={{
            flex: 1,
            background: "var(--bg-tertiary)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-primary)",
            borderRadius: "4px",
            padding: "8px 12px",
            fontSize: "13px",
            outline: "none"
          }}
        />

        <button
          onClick={handlePing}
          disabled={loading}
          style={{
            background: loading ? "var(--bg-tertiary)" : "var(--color-accent)",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            padding: "8px 16px",
            fontSize: "13px",
            fontWeight: "bold",
            cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          {loading ? "Sending..." : "Send Request"}
        </button>
      </div>

      {(method === "POST" || method === "PUT" || method === "PATCH") && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ color: "var(--text-secondary)", fontSize: "12px" }}>Request Body (JSON):</div>
          <textarea
            value={reqBody}
            onChange={(e) => setReqBody(e.target.value)}
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-primary)",
              borderRadius: "4px",
              padding: "8px 12px",
              fontSize: "12px",
              fontFamily: "'JetBrains Mono', Consolas, monospace",
              outline: "none",
              resize: "vertical",
              minHeight: "80px"
            }}
            placeholder='{ "key": "value" }'
          />
        </div>
      )}

      <div style={{
        flex: 1,
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-primary)",
        borderRadius: "6px",
        padding: "12px",
        fontFamily: "'JetBrains Mono', Consolas, monospace",
        fontSize: "12px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "10px"
      }}>
        {error && (
          <div style={{ color: "var(--color-danger)" }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {response && (
          <>
            <div style={{ display: "flex", gap: "16px", borderBottom: "1px solid var(--border-primary)", paddingBottom: "8px", flexShrink: 0 }}>
              <div>
                <span style={{ color: "var(--text-secondary)" }}>Status:</span>{" "}
                <strong style={{ color: response.status >= 200 && response.status < 300 ? "var(--color-success)" : "var(--color-danger)" }}>
                  {response.status} {response.status_text}
                </strong>
              </div>
              <div>
                <span style={{ color: "var(--text-secondary)" }}>Time:</span>{" "}
                <strong style={{ color: "var(--text-primary)" }}>{response.elapsed_ms} ms</strong>
              </div>
              <div>
                <span style={{ color: "var(--text-secondary)" }}>Size:</span>{" "}
                <strong style={{ color: "var(--color-warning)" }}>{response.size_bytes} B</strong>
              </div>
            </div>

            <div style={{ flex: 1, overflow: "auto" }}>
              <div style={{ color: "var(--text-secondary)", marginBottom: "4px" }}>Response Body:</div>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: "var(--text-primary)" }}>
                {response.body}
              </pre>
            </div>
          </>
        )}

        {!response && !error && !loading && (
          <div style={{ color: "var(--text-muted)", textAlign: "center", marginTop: "40px", fontStyle: "italic" }}>
            Enter a URL and send request to view API response.
          </div>
        )}
      </div>
    </div>
  );
}

export default function TerminalPanel({
  theme,
  activeProject,
  projectLogs,
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
  const [viewMode, setViewMode] = useState<"terminal" | "post" | "log">("terminal");
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

      const activeTheme = theme === "light" ? XTERM_LIGHT_THEME : XTERM_DARK_THEME;

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        cursorWidth: 2,
        fontSize: 13,
        lineHeight: 1.2,
        letterSpacing: 0.5,
        fontFamily:
          "'JetBrains Mono', Consolas, 'Courier New', monospace",
        theme: activeTheme,
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
        // Ignore focus tracking sequences and null/empty signals that could leak during tab focus changes
        if (!data || data === "\x1b[I" || data === "\x1b[O" || data === "\x00") return;

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

      // Sync frontend terminal resize to backend PTY with debouncing to prevent Windows ConPTY duplicate redraw spaces
      let resizeTimeout: any = null;
      const resizeDisposer = term.onResize((size) => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          invoke("resize_terminal_session", {
            sessionId,
            rows: size.rows,
            cols: size.cols,
          }).catch((err) => console.warn("[term] resize FAILED:", err));
        }, 100);
      });
      inst.disposers.push(() => {
        if (resizeTimeout) {
          try {
            clearTimeout(resizeTimeout);
          } catch {}
        }
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
        if (e.key === "ArrowUp" && e.type === "keydown") {
          invoke("write_to_terminal_session", {
            sessionId,
            input: "\x1b[A",
          }).catch(() => {});
          return false;
        }
        if (e.key === "ArrowDown" && e.type === "keydown") {
          invoke("write_to_terminal_session", {
            sessionId,
            input: "\x1b[B",
          }).catch(() => {});
          return false;
        }
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
    [terminalBufferRef, theme],
  );

  // ── Sync terminal theme dynamically when light/dark theme changes ──
  useEffect(() => {
    const activeTheme = theme === "light" ? XTERM_LIGHT_THEME : XTERM_DARK_THEME;
    Object.keys(instancesRef.current).forEach((sid) => {
      try {
        instancesRef.current[sid].term.options.set("theme", activeTheme);
      } catch (err) {
        console.warn("[term] update theme FAILED:", err);
      }
    });
  }, [theme]);

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
      try {
        // Redraw terminal grid without triggering a PTY resize
        inst.term.refresh(0, inst.term.rows - 1);
      } catch {}
    }
  }, [activeTerminalId]);

  // ── Refit and focus when switching back to terminal view ──────────
  useEffect(() => {
    if (viewMode === "terminal" && activeTerminalId && instancesRef.current[activeTerminalId]) {
      const inst = instancesRef.current[activeTerminalId];
      setTimeout(() => {
        try {
          inst.fit.fit();
          inst.term.refresh(0, inst.term.rows - 1);
          inst.term.focus();
        } catch {}
      }, 50);
    }
  }, [viewMode, activeTerminalId]);

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
        <div className="sandbox-terminal-header-left" style={{ display: "flex", gap: "4px" }}>
          <button
            className={`sandbox-btn ${viewMode === "terminal" ? "active" : ""}`}
            onClick={() => setViewMode("terminal")}
          >
            Terminal
          </button>
          <button
            className={`sandbox-btn ${viewMode === "post" ? "active" : ""}`}
            onClick={() => setViewMode("post")}
          >
            Post
          </button>
          <button
            className={`sandbox-btn ${viewMode === "log" ? "active" : ""}`}
            onClick={() => setViewMode("log")}
          >
            Log System
          </button>
        </div>
        {viewMode === "terminal" && (
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
        )}
      </header>

      <div className="sandbox-terminal-body">
        <div style={{ display: viewMode === "terminal" ? "flex" : "none", flex: 1, width: "100%", height: "100%" }}>
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
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setActiveTerminalId(t.id);
                      }}
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

        {viewMode === "log" && (
          <div style={{ flex: 1, height: "100%", display: "flex" }}>
            <LogViewer logs={activeProject ? (projectLogs?.[activeProject.id] || []) : []} />
          </div>
        )}
        {viewMode === "post" && (
          <div style={{ flex: 1, height: "100%", display: "flex" }}>
            <SimplePing />
          </div>
        )}
      </div>
    </div>
  );
}
