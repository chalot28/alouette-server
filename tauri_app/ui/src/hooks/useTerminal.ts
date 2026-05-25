import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Project,
  TerminalSessionItem,
  TerminalConnectionStatus,
} from "../types";

/**
 * useTerminal — manages sandbox terminal sessions for the active project.
 *
 * Features:
 * - Auto-spawns one terminal when a project becomes active
 * - Manages multiple named terminal sessions per project
 * - Tracks connection status (connecting → connected → error)
 * - Buffers output in a ref so xterm.js can replay on mount
 * - Clean up all sessions on unmount / project switch
 */
export function useTerminal(
  activeProjectId: string,
  activeProject: Project | undefined,
) {
  const [projectTerminals, setProjectTerminals] = useState<{
    [projectId: string]: TerminalSessionItem[];
  }>({});
  const [activeTerminalIds, setActiveTerminalIds] = useState<{
    [projectId: string]: string;
  }>({});
  const [terminalStatuses, setTerminalStatuses] = useState<{
    [sessionId: string]: TerminalConnectionStatus;
  }>({});
  const [terminalErrors, setTerminalErrors] = useState<{
    [sessionId: string]: string;
  }>({});

  // Buffer accumulates ALL terminal-output events so xterm.js can replay
  // them on mount (solves race: output arrives before xterm is ready).
  const terminalBufferRef = useRef<{ [sessionId: string]: string }>({});

  // ── Global listener: buffers output from ALL sessions ────────────────
  useEffect(() => {
    const unlisten = listen<any>("terminal-output", (event) => {
      const sid: string = event.payload.session_id;
      const text: string = event.payload.text;
      if (text) {
        terminalBufferRef.current = {
          ...terminalBufferRef.current,
          [sid]: (terminalBufferRef.current[sid] || "") + text,
        };
      }
    });
    return () => {
      unlisten.then((u) => u());
    };
  }, []);

  // ── Spawn ────────────────────────────────────────────────────────────
  const spawnTerminal = async (
    sessionId: string,
    cwd: string | null | undefined,
  ) => {
    console.log("[term-hook] spawn START:", sessionId, "cwd:", cwd);
    setTerminalStatuses((prev) => ({ ...prev, [sessionId]: "connecting" }));
    setTerminalErrors((prev) => {
      const c = { ...prev };
      delete c[sessionId];
      return c;
    });

    try {
      await invoke("spawn_terminal_session", { sessionId, cwd: cwd || null });
      console.log("[term-hook] spawn OK, checking:", sessionId);
      const info = await invoke<{ exists: boolean; pid: number | null }>(
        "check_terminal_session",
        { sessionId },
      );
      console.log("[term-hook] check result:", sessionId, info);
      if (info.exists) {
        console.log("[term-hook] CONNECTED:", sessionId, "PID:", info.pid);
        setTerminalStatuses((prev) => ({ ...prev, [sessionId]: "connected" }));
      } else {
        throw new Error("Session not found after spawn");
      }
    } catch (err) {
      console.error("[term-hook] spawn ERROR:", sessionId, err);
      setTerminalStatuses((prev) => ({ ...prev, [sessionId]: "error" }));
      setTerminalErrors((prev) => ({
        ...prev,
        [sessionId]: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  // ── Auto-spawn default terminal on project activation ────────────────
  useEffect(() => {
    if (
      !activeProjectId ||
      activeProjectId === "__create_project__" ||
      !activeProject
    )
      return;
    const existing = projectTerminals[activeProjectId];
    console.log(
      "[term-hook] auto-spawn check:",
      activeProjectId,
      "existing:",
      existing?.length,
    );
    if (existing && existing.length > 0) return;

    const defaultId = `${activeProjectId}-term-default`;
    const defaultTerm: TerminalSessionItem = {
      id: defaultId,
      name: "Terminal 1",
    };

    setProjectTerminals((prev) => ({
      ...prev,
      [activeProjectId]: [defaultTerm],
    }));
    setActiveTerminalIds((prev) => ({ ...prev, [activeProjectId]: defaultId }));
    spawnTerminal(defaultId, activeProject.cwd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, activeProject?.cwd]);

  // ── Add terminal ─────────────────────────────────────────────────────
  const addTerminal = () => {
    const cwd = activeProject?.cwd || null;
    setProjectTerminals((prev) => {
      const list = prev[activeProjectId] || [];
      const nid = `${activeProjectId}-term-${Date.now()}`;
      setActiveTerminalIds((a) => ({ ...a, [activeProjectId]: nid }));
      spawnTerminal(nid, cwd);
      return {
        ...prev,
        [activeProjectId]: [
          ...list,
          { id: nid, name: `Terminal ${list.length + 1}` },
        ],
      };
    });
  };

  // ── Delete terminal ──────────────────────────────────────────────────
  const deleteTerminal = async (terminalId: string) => {
    await invoke("kill_terminal_session", { sessionId: terminalId }).catch(
      () => {},
    );
    setTerminalStatuses((p) => {
      const c = { ...p };
      delete c[terminalId];
      return c;
    });
    setTerminalErrors((p) => {
      const c = { ...p };
      delete c[terminalId];
      return c;
    });
    setProjectTerminals((prev) => {
      const list = (prev[activeProjectId] || []).filter(
        (t) => t.id !== terminalId,
      );
      setActiveTerminalIds((a) => {
        if (a[activeProjectId] === terminalId) {
          return { ...a, [activeProjectId]: list[0]?.id || "" };
        }
        return a;
      });
      return { ...prev, [activeProjectId]: list };
    });
  };

  // ── Delete all terminals → respawn one ──────────────────────────────
  const deleteAllTerminals = async () => {
    const list = projectTerminals[activeProjectId] || [];
    for (const t of list) {
      await invoke("kill_terminal_session", { sessionId: t.id }).catch(
        () => {},
      );
      setTerminalStatuses((p) => {
        const c = { ...p };
        delete c[t.id];
        return c;
      });
      setTerminalErrors((p) => {
        const c = { ...p };
        delete c[t.id];
        return c;
      });
    }
    const nid = `${activeProjectId}-term-${Date.now()}`;
    setProjectTerminals((prev) => ({
      ...prev,
      [activeProjectId]: [{ id: nid, name: "Terminal 1" }],
    }));
    setActiveTerminalIds((prev) => ({ ...prev, [activeProjectId]: nid }));
    await spawnTerminal(nid, activeProject?.cwd);
  };

  // ── Rename terminal ─────────────────────────────────────────────────
  const renameTerminal = (terminalId: string, name: string) => {
    if (!name.trim()) return;
    setProjectTerminals((prev) => ({
      ...prev,
      [activeProjectId]: (prev[activeProjectId] || []).map((t) =>
        t.id === terminalId ? { ...t, name } : t,
      ),
    }));
  };

  const setProjectTerminalsState = setProjectTerminals;
  const setActiveTerminalIdsState = setActiveTerminalIds;

  // ── Respawn (kill + spawn) ──────────────────────────────────────────
  const respawnTerminal = async (sessionId: string) => {
    await invoke("kill_terminal_session", { sessionId }).catch(() => {});
    await spawnTerminal(sessionId, activeProject?.cwd);
  };

  // ── Retry spawn for errored sessions ────────────────────────────────
  const retrySpawn = async (sessionId: string) => {
    await spawnTerminal(sessionId, activeProject?.cwd);
  };

  // ── Derived values ──────────────────────────────────────────────────
  const terminals = projectTerminals[activeProjectId] || [];
  const activeTerminalId = activeTerminalIds[activeProjectId] || "";
  const activeStatus: TerminalConnectionStatus = activeTerminalId
    ? terminalStatuses[activeTerminalId] || "connecting"
    : "disconnected";
  const activeError = activeTerminalId
    ? terminalErrors[activeTerminalId]
    : undefined;

  return {
    terminals,
    activeTerminalId,
    setActiveTerminalId: (id: string) =>
      setActiveTerminalIds((prev) => ({ ...prev, [activeProjectId]: id })),
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
  };
}
