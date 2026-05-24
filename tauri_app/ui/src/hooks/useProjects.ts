import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Project,
  ProcessState,
  LogLine,
  ResourceHistory,
  TerminalSessionItem,
} from "../types";
import { MOCK_PROJECTS, MAX_LOG_LINES, TOOLCHAIN_DEFAULTS } from "../constants";

interface UseProjectsDeps {
  setResourceHistory: React.Dispatch<React.SetStateAction<ResourceHistory>>;
  projectTerminals: { [projectId: string]: TerminalSessionItem[] };
  setProjectTerminals: React.Dispatch<
    React.SetStateAction<{ [projectId: string]: TerminalSessionItem[] }>
  >;
  setActiveTerminalIds: React.Dispatch<
    React.SetStateAction<{ [projectId: string]: string }>
  >;
  setTermOutputs: React.Dispatch<
    React.SetStateAction<{ [id: string]: string }>
  >;
}

export function useProjects(deps: UseProjectsDeps) {
  const {
    setResourceHistory,
    projectTerminals,
    setProjectTerminals,
    setActiveTerminalIds,
    setTermOutputs,
  } = deps;

  // Project Lists & Active Tabs
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [projectStates, setProjectStates] = useState<{
    [id: string]: ProcessState;
  }>({});
  const [projectLogs, setProjectLogs] = useState<{ [id: string]: LogLine[] }>(
    {},
  );

  // File Editing State
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [openFileContent, setOpenFileContent] = useState<string | null>(null);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isSqliteFile, setIsSqliteFile] = useState(false);
  const [filesContent, setFilesContent] = useState<{ [path: string]: string }>(
    {},
  );
  const [filesOriginalContent, setFilesOriginalContent] = useState<{
    [path: string]: string;
  }>({});
  const [showTabsMenu, setShowTabsMenu] = useState(false);

  // Form State
  const [newProjName, setNewProjName] = useState("");
  const [newProjCmd, setNewProjCmd] = useState("");
  const [newProjArgs, setNewProjArgs] = useState("");
  const [newProjCwd, setNewProjCwd] = useState("");
  const [newProjSetup, setNewProjSetup] = useState("");
  const [newProjSetupArgs, setNewProjSetupArgs] = useState("");
  const [newProjRestart, setNewProjRestart] = useState(true);
  const [newProjEnv, setNewProjEnv] = useState<
    { key: string; value: string }[]
  >([]);
  const [newProjCpu, setNewProjCpu] = useState<string>("");
  const [newProjRam, setNewProjRam] = useState<string>("");
  const [newProjPort, setNewProjPort] = useState<string>("");
  const [newProjSource, setNewProjSource] = useState("");
  const [newProjTerminalMode, setNewProjTerminalMode] = useState("log");
  const [newProjToolchain, setNewProjToolchain] = useState("");
  const [newProjToolchainVersion, setNewProjToolchainVersion] =
    useState("stable");
  const [newProjEnableTunnel, setNewProjEnableTunnel] = useState(false);

  // Port conflict state
  const [portConflict, setPortConflict] = useState<{
    port: number;
    pid: number;
  } | null>(null);

  // Reset transient UI states when activeProjectId changes
  useEffect(() => {
    setFileError(null);
    setShowTabsMenu(false);
  }, [activeProjectId]);

  // Effect to load file content when a file path is selected
  useEffect(() => {
    if (openFilePath) {
      const lowerPath = openFilePath.toLowerCase();
      const isSql =
        lowerPath.endsWith(".db") ||
        lowerPath.endsWith(".sqlite") ||
        lowerPath.endsWith(".sqlite3");
      setIsSqliteFile(isSql);

      if (isSql) {
        setIsFileLoading(false);
        setFileError(null);
        return;
      }

      // If already loaded in memory, do not re-fetch from disk (preserves unsaved session edits!)
      if (filesContent[openFilePath] !== undefined) {
        setIsFileLoading(false);
        setFileError(null);
        return;
      }

      const loadFileContent = async (path: string) => {
        setIsFileLoading(true);
        setFileError(null);
        try {
          const base64Data = await invoke<string>("read_file_content", {
            path,
          });

          const binaryString = window.atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          let decodedText = "";
          if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
            const decoder = new TextDecoder("utf-16le");
            decodedText = decoder.decode(bytes.slice(2));
          } else if (
            bytes.length >= 2 &&
            bytes[0] === 0xfe &&
            bytes[1] === 0xff
          ) {
            const decoder = new TextDecoder("utf-16be");
            decodedText = decoder.decode(bytes.slice(2));
          } else if (
            bytes.length >= 3 &&
            bytes[0] === 0xef &&
            bytes[1] === 0xbb &&
            bytes[2] === 0xbf
          ) {
            const decoder = new TextDecoder("utf-8");
            decodedText = decoder.decode(bytes.slice(3));
          } else {
            try {
              const decoder = new TextDecoder("utf-8", { fatal: true });
              decodedText = decoder.decode(bytes);
            } catch (e) {
              let nullCount = 0;
              for (let i = 0; i < Math.min(bytes.length, 100); i++) {
                if (bytes[i] === 0) nullCount++;
              }
              if (nullCount > 10) {
                const decoder = new TextDecoder("utf-16le");
                decodedText = decoder.decode(bytes);
              } else {
                console.warn(
                  "UTF-8 fail, falling back to Windows-1258 (Vietnamese)",
                );
                const fallbackDecoder = new TextDecoder("windows-1258");
                decodedText = fallbackDecoder.decode(bytes);
              }
            }
          }

          setFilesContent((prev) => ({ ...prev, [path]: decodedText }));
          setFilesOriginalContent((prev) => ({ ...prev, [path]: decodedText }));
        } catch (err: any) {
          setFileError(`Failed to read file: ${err.message || err}`);
        } finally {
          setIsFileLoading(false);
        }
      };
      loadFileContent(openFilePath);
    } else {
      setFileError(null);
      setIsFileLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFilePath]);

  // Sync state parameters when clicking around tabs
  const activeProject = projects.find((p) => p.id === activeProjectId);

  // Populate configuration fields when active project changes
  useEffect(() => {
    if (activeProjectId && activeProjectId !== "__create_project__") {
      const activeProj = projects.find((p) => p.id === activeProjectId);
      if (activeProj) {
        setNewProjName(activeProj.name);
        setNewProjCmd(activeProj.command);
        setNewProjArgs(activeProj.args.join(" "));
        setNewProjCwd(activeProj.cwd || "");
        setNewProjSetup(activeProj.setup_command || "");
        setNewProjSetupArgs(
          activeProj.setup_args ? activeProj.setup_args.join(" ") : "",
        );
        setNewProjRestart(activeProj.auto_restart !== false);
        setNewProjCpu(
          activeProj.max_cpu_percent ? String(activeProj.max_cpu_percent) : "",
        );
        setNewProjRam(
          activeProj.max_ram_mb ? String(activeProj.max_ram_mb) : "",
        );
        setNewProjPort(activeProj.port ? String(activeProj.port) : "");
        if (activeProj.env) {
          setNewProjEnv(
            Object.entries(activeProj.env).map(([key, value]) => ({
              key,
              value,
            })),
          );
        } else {
          setNewProjEnv([]);
        }
      }
    }
  }, [activeProjectId, projects]);

  // Load SQLite historical logs when activeProjectId changes
  useEffect(() => {
    if (activeProjectId && activeProjectId !== "__create_project__") {
      invoke<LogLine[]>("get_project_logs", {
        projectId: activeProjectId,
        limit: 1000,
      })
        .then((logs) => {
          setProjectLogs((prev) => ({
            ...prev,
            [activeProjectId]: logs,
          }));
        })
        .catch((err) => {
          console.error("Failed to load historical logs from SQLite: ", err);
        });
    }
  }, [activeProjectId]);

  // Project source auto-fill name helper
  useEffect(() => {
    if (!newProjSource.trim()) return;

    if (!newProjName) {
      let extractedName = "";
      const source = newProjSource.trim();
      if (
        source.startsWith("http://") ||
        source.startsWith("https://") ||
        source.startsWith("git@")
      ) {
        const parts = source.split("/");
        let lastPart = parts[parts.length - 1];
        if (lastPart.endsWith(".git")) {
          lastPart = lastPart.slice(0, -4);
        }
        extractedName = lastPart;
      } else {
        const parts = source.split(/[\\/]/);
        extractedName = parts[parts.length - 1] || "my-project";
      }
      if (extractedName) {
        setNewProjName(extractedName);
      }
    }
  }, [newProjSource]);

  // Toolchain auto-fill executor helper
  useEffect(() => {
    const defaults = TOOLCHAIN_DEFAULTS[newProjToolchain];
    if (defaults) {
      if (!newProjCmd) setNewProjCmd(defaults.cmd);
      if (!newProjArgs) setNewProjArgs(defaults.args);
    }
  }, [newProjToolchain]);

  // Listen to incoming piped stdout/stderr log events
  useEffect(() => {
    const logListener = listen<any>("process-log", (event) => {
      const payload = event.payload; // { project_id, stream, text, timestamp }
      setProjectLogs((prev) => {
        const lines = prev[payload.project_id] || [];
        const newLines = [
          ...lines,
          {
            text: payload.text,
            stream: payload.stream,
            timestamp: payload.timestamp,
          },
        ];
        if (newLines.length > MAX_LOG_LINES) newLines.shift();
        return {
          ...prev,
          [payload.project_id]: newLines,
        };
      });
    });

    const statusListener = listen<any>("process-status", (event) => {
      const payload = event.payload; // { project_id, state }
      setProjectStates((prev) => ({
        ...prev,
        [payload.project_id]: payload.state,
      }));
    });

    return () => {
      logListener.then((unlisten) => unlisten());
      statusListener.then((unlisten) => unlisten());
    };
  }, []);

  // Load project config helper
  const loadProjects = async () => {
    try {
      const list = await invoke<Project[]>("get_projects");
      setProjects(list);

      for (const p of list) {
        const state = await invoke<ProcessState>("get_project_state", {
          projectId: p.id,
        });
        if (state) {
          setProjectStates((prev) => ({ ...prev, [p.id]: state }));
        }
      }

      if (list.length > 0 && !activeProjectId) {
        setActiveProjectId(list[0].id);
      }
    } catch (e) {
      console.error("Failed to load projects:", e);
    }
  };

  // Initial load
  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = async (forceStart = false) => {
    if (!activeProjectId || !activeProject) return;
    try {
      if (!forceStart && activeProject.port) {
        const occupiedPid = await invoke<number | null>("check_port_status", {
          port: activeProject.port,
        });
        if (occupiedPid) {
          setPortConflict({ port: activeProject.port, pid: occupiedPid });
          return;
        }
      }

      setProjectLogs((prev) => ({ ...prev, [activeProjectId]: [] }));
      setResourceHistory((prev) => ({
        ...prev,
        [activeProjectId]: { cpu: [], ram: [] },
      }));
      await invoke("start_project_process", { projectId: activeProjectId });
    } catch (e: any) {
      alert(`Execution failed: ${e}`);
    }
  };

  const handleStartProject = async (id: string) => {
    try {
      const proj = projects.find((p) => p.id === id);
      if (!proj) return;

      const occupiedPid = proj.port
        ? await invoke<number | null>("check_port_status", { port: proj.port })
        : null;
      if (occupiedPid) {
        setPortConflict({ port: proj.port!, pid: occupiedPid });
        return;
      }

      setProjectLogs((prev) => ({ ...prev, [id]: [] }));
      setResourceHistory((prev) => ({
        ...prev,
        [id]: { cpu: [], ram: [] },
      }));
      await invoke("start_project_process", { projectId: id });
    } catch (e: any) {
      alert(`Execution failed: ${e}`);
    }
  };

  const handleStopProject = async (id: string) => {
    try {
      await invoke("stop_project_process", { projectId: id });
    } catch (e: any) {
      alert(`Teardown failed: ${e}`);
    }
  };

  const handleForceKillAndStart = async () => {
    if (!portConflict || !activeProjectId) return;
    try {
      await invoke("force_kill_process", { pid: portConflict.pid });
      setPortConflict(null);
      setTimeout(async () => {
        await handleStart(true);
      }, 500);
    } catch (e: any) {
      alert(`Force kill failed: ${e}`);
    }
  };

  const handleStop = async () => {
    if (!activeProjectId) return;
    try {
      await invoke("stop_project_process", { projectId: activeProjectId });
    } catch (e: any) {
      alert(`Teardown failed: ${e}`);
    }
  };

  const handleAddProject = async () => {
    if (!newProjName || !newProjCmd) {
      alert("Name and command fields are mandatory.");
      return;
    }

    const id = newProjName.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const argsArray = newProjArgs
      .split(" ")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const setupCommand = newProjSetup.trim() || undefined;
    const setupArgs = newProjSetupArgs.trim()
      ? newProjSetupArgs
          .split(" ")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : undefined;

    const envObj: { [key: string]: string } = {};
    newProjEnv.forEach((item) => {
      if (item.key.trim()) {
        envObj[item.key.trim()] = item.value;
      }
    });

    const maxCpuVal = newProjCpu ? parseInt(newProjCpu, 10) : undefined;
    const maxRamVal = newProjRam ? parseInt(newProjRam, 10) : undefined;
    const portVal = newProjPort ? parseInt(newProjPort, 10) : undefined;

    const newConfig: Project = {
      id:
        activeProjectId && activeProjectId !== "__create_project__"
          ? activeProjectId
          : id,
      name: newProjName,
      command: newProjCmd,
      args: argsArray,
      cwd: newProjCwd.trim() || undefined,
      setup_command: setupCommand,
      setup_args: setupArgs,
      auto_restart: newProjRestart,
      env: Object.keys(envObj).length > 0 ? envObj : undefined,
      max_cpu_percent: maxCpuVal,
      max_ram_mb: maxRamVal,
      port: portVal,
      source: newProjSource.trim() || undefined,
      terminal_mode: newProjTerminalMode,
      toolchain: newProjToolchain.trim() || undefined,
      toolchain_version: newProjToolchainVersion.trim() || undefined,
      enable_tunnel: newProjEnableTunnel,
    };

    try {
      await invoke("register_project", { config: newConfig });
      await loadProjects();
      alert("Configuration saved successfully!");
      setActiveProjectId(newConfig.id);
    } catch (e: any) {
      alert(`Failed to save project: ${e}`);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (id === "__create_project__") {
      setActiveProjectId("");
      return;
    }
    if (!confirm("Are you sure you want to delete this tab/project?")) return;
    try {
      const terms = projectTerminals[id] || [];
      for (const t of terms) {
        await invoke("kill_terminal_session", { sessionId: t.id }).catch(
          () => {},
        );
        setTermOutputs((prev) => {
          const copy = { ...prev };
          delete copy[t.id];
          return copy;
        });
      }

      await invoke("deregister_project", { projectId: id });
      await loadProjects();
      if (activeProjectId === id) {
        setActiveProjectId("");
      }

      setProjectTerminals((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      setActiveTerminalIds((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
    } catch (e: any) {
      alert(`Failed to delete: ${e}`);
    }
  };

  const handleFileOpen = (path: string) => {
    const normalizedPath = path.replace(/\\/g, "/");

    if (!openFiles.includes(normalizedPath)) {
      setOpenFiles((prev) => [...prev, normalizedPath]);
    }
    setOpenFilePath(normalizedPath);
  };

  const handleFileClose = (path: string) => {
    const normalizedPath = path.replace(/\\/g, "/");
    const newOpenFiles = openFiles.filter((f) => f !== normalizedPath);
    setOpenFiles(newOpenFiles);

    setFilesContent((prev) => {
      const copy = { ...prev };
      delete copy[normalizedPath];
      return copy;
    });
    setFilesOriginalContent((prev) => {
      const copy = { ...prev };
      delete copy[normalizedPath];
      return copy;
    });

    if (openFilePath === normalizedPath) {
      setOpenFilePath(
        newOpenFiles.length > 0 ? newOpenFiles[newOpenFiles.length - 1] : null,
      );
    }
  };

  const handleCloseAllTabs = () => {
    setOpenFiles([]);
    setOpenFilePath(null);
    setFilesContent({});
    setFilesOriginalContent({});
    setIsSqliteFile(false);
    setShowTabsMenu(false);
  };

  const handleSaveAndCloseAllTabs = async () => {
    setShowTabsMenu(false);

    const savePromises = Object.entries(filesContent).map(
      async ([path, content]) => {
        const original = filesOriginalContent[path] || "";
        if (content !== original) {
          try {
            await invoke("write_file_content", { path, content });
          } catch (err) {
            console.error(
              "Failed to auto-save file during close all: " + path,
              err,
            );
          }
        }
      },
    );

    await Promise.all(savePromises);

    setOpenFiles([]);
    setOpenFilePath(null);
    setFilesContent({});
    setFilesOriginalContent({});
    setIsSqliteFile(false);
  };

  const handleResetSetupForm = () => {
    setActiveProjectId("__create_project__");
    setNewProjName("");
    setNewProjCmd("");
    setNewProjArgs("");
    setNewProjCwd("");
    setNewProjSetup("");
    setNewProjSetupArgs("");
    setNewProjRestart(true);
    setNewProjEnv([]);
    setNewProjCpu("");
    setNewProjRam("");
    setNewProjPort("");
    setNewProjSource("");
    setNewProjTerminalMode("log");
    setNewProjToolchain("");
    setNewProjToolchainVersion("stable");
    setNewProjEnableTunnel(false);
  };

  const handleExportConfig = () => {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(projects, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "alouette_configurations.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportMockConfig = async () => {
    try {
      for (const p of MOCK_PROJECTS) {
        await invoke("register_project", { config: p });
      }
      await loadProjects();
      alert("Loaded mock templates successfully!");
    } catch (e: any) {
      alert(`Demo import failed: ${e}`);
    }
  };

  const wipeConfig = () => {
    setProjects([]);
    setProjectStates({});
    setProjectLogs({});
    setResourceHistory({});
    setActiveProjectId("");
  };

  return {
    // State
    projects,
    setProjects,
    activeProjectId,
    setActiveProjectId,
    projectStates,
    setProjectStates,
    projectLogs,
    setProjectLogs,
    activeProject,

    // File state
    openFilePath,
    setOpenFilePath,
    openFiles,
    setOpenFiles,
    openFileContent,
    isFileLoading,
    fileError,
    isSqliteFile,
    filesContent,
    setFilesContent,
    filesOriginalContent,
    setFilesOriginalContent,
    showTabsMenu,
    setShowTabsMenu,

    // Form state
    newProjName,
    setNewProjName,
    newProjCmd,
    setNewProjCmd,
    newProjArgs,
    setNewProjArgs,
    newProjCwd,
    setNewProjCwd,
    newProjSetup,
    setNewProjSetup,
    newProjSetupArgs,
    setNewProjSetupArgs,
    newProjRestart,
    setNewProjRestart,
    newProjEnv,
    setNewProjEnv,
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
    newProjEnableTunnel,
    setNewProjEnableTunnel,
    portConflict,
    setPortConflict,

    // Handlers
    loadProjects,
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
    handleFileOpen,
    handleFileClose,
    handleCloseAllTabs,
    handleSaveAndCloseAllTabs,
  };
}
