import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Project, TerminalSessionItem } from "../types";
import { MAX_TERM_OUTPUT_LENGTH } from "../constants";

export function useTerminal(activeProjectId: string, activeProject: Project | undefined, projects: Project[]) {
  const [termOutputs, setTermOutputs] = useState<{ [id: string]: string }>({});
  const [projectTerminals, setProjectTerminals] = useState<{ [projectId: string]: TerminalSessionItem[] }>({});
  const [activeTerminalIds, setActiveTerminalIds] = useState<{ [projectId: string]: string }>({});
  const [logFilter, setLogFilter] = useState<"all" | "stdout" | "stderr" | "system">("all");
  const [logSearchQuery, setLogSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Listen to interactive terminal output events
  useEffect(() => {
    const termListener = listen<any>("terminal-output", (event) => {
      const payload = event.payload; // { session_id, text }
      setTermOutputs((prev) => {
        const prevText = prev[payload.session_id] || "";
        let newText = prevText + payload.text;
        if (newText.length > MAX_TERM_OUTPUT_LENGTH) {
          newText = newText.slice(newText.length - MAX_TERM_OUTPUT_LENGTH);
        }
        return {
          ...prev,
          [payload.session_id]: newText,
        };
      });
    });

    return () => {
      termListener.then((unlisten) => unlisten());
    };
  }, []);

  // Interactive Sandboxed Terminal Auto-spawner
  useEffect(() => {
    if (activeProjectId && activeProjectId !== "__create_project__" && activeProject) {
      setProjectTerminals((prev) => {
        const currentTerms = prev[activeProjectId] || [];
        if (currentTerms.length === 0) {
          const defaultTermId = `${activeProjectId}-term-default`;
          const defaultTerm: TerminalSessionItem = { id: defaultTermId, name: "Terminal 1" };

          setActiveTerminalIds((activePrev) => ({
            ...activePrev,
            [activeProjectId]: defaultTermId
          }));

          invoke("spawn_terminal_session", {
            sessionId: defaultTermId,
            cwd: activeProject.cwd || null,
          }).catch((err) => {
            console.error("Failed to spawn default terminal session for " + activeProjectId, err);
          });

          return {
            ...prev,
            [activeProjectId]: [defaultTerm]
          };
        }
        return prev;
      });
    }
  }, [activeProjectId, activeProject?.cwd]);

  const handleAddTerminal = (projectId: string) => {
    const proj = projects.find((p) => p.id === projectId);
    const cwd = proj?.cwd || null;

    setProjectTerminals((prev) => {
      const currentTerms = prev[projectId] || [];
      const nextIndex = currentTerms.length + 1;
      const newTermId = `${projectId}-term-${Date.now()}`;
      const newTerm: TerminalSessionItem = {
        id: newTermId,
        name: `Terminal ${nextIndex}`
      };

      setActiveTerminalIds((activePrev) => ({
        ...activePrev,
        [projectId]: newTermId
      }));

      invoke("spawn_terminal_session", {
        sessionId: newTermId,
        cwd
      }).catch((err) => {
        console.error("Failed to spawn terminal session:", err);
      });

      return {
        ...prev,
        [projectId]: [...currentTerms, newTerm]
      };
    });
  };

  const handleDeleteTerminal = async (projectId: string, terminalId: string) => {
    try {
      await invoke("kill_terminal_session", { sessionId: terminalId });
    } catch (err) {
      console.error("Failed to kill terminal session:", err);
    }

    setTermOutputs((prev) => {
      const copy = { ...prev };
      delete copy[terminalId];
      return copy;
    });

    setProjectTerminals((prev) => {
      const currentTerms = prev[projectId] || [];
      const remainingTerms = currentTerms.filter((t) => t.id !== terminalId);

      setActiveTerminalIds((activePrev) => {
        const currentActive = activePrev[projectId];
        if (currentActive === terminalId) {
          return {
            ...activePrev,
            [projectId]: remainingTerms.length > 0 ? remainingTerms[0].id : ""
          };
        }
        return activePrev;
      });

      return {
        ...prev,
        [projectId]: remainingTerms
      };
    });
  };

  const handleDeleteAllTerminals = async (projectId: string) => {
    const currentTerms = projectTerminals[projectId] || [];

    for (const term of currentTerms) {
      try {
        await invoke("kill_terminal_session", { sessionId: term.id });
      } catch (err) {
        console.error("Failed to kill terminal session:", err);
      }

      setTermOutputs((prev) => {
        const copy = { ...prev };
        delete copy[term.id];
        return copy;
      });
    }

    // Reset with a default terminal
    const defaultTermId = `${projectId}-term-default-${Date.now()}`;
    const defaultTerm: TerminalSessionItem = { id: defaultTermId, name: "Terminal 1" };
    const proj = projects.find((p) => p.id === projectId);

    setProjectTerminals((prev) => ({
      ...prev,
      [projectId]: [defaultTerm]
    }));

    setActiveTerminalIds((prev) => ({
      ...prev,
      [projectId]: defaultTermId
    }));

    try {
      await invoke("spawn_terminal_session", {
        sessionId: defaultTermId,
        cwd: proj?.cwd || null
      });
    } catch (err) {
      console.error("Failed to spawn terminal session after trash:", err);
    }
  };

  const handleRenameTerminal = (projectId: string, terminalId: string, newName: string) => {
    if (!newName.trim()) return;
    setProjectTerminals((prev) => {
      const current = prev[projectId] || [];
      const updated = current.map((t) => {
        if (t.id === terminalId) {
          return { ...t, name: newName };
        }
        return t;
      });
      return {
        ...prev,
        [projectId]: updated
      };
    });
  };

  const handleTerminalScroll = () => {
    if (!terminalRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 30;
    setAutoScroll(isAtBottom);
  };

  return {
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
  };
}
