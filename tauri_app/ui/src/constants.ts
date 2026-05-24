import { Project } from "./types";

export const MOCK_PROJECTS: Project[] = [
  {
    id: "ping-diagnostics",
    name: "Local Connection diagnostics",
    command: "ping",
    args: ["127.0.0.1", "-n", "20"],
    auto_restart: false
  },
  {
    id: "mock-backend",
    name: "Node API Server",
    command: "node",
    args: ["server.js"],
    auto_restart: true,
    port: 8080,
    max_cpu_percent: 50,
    max_ram_mb: 256
  }
];

export const DEFAULT_NEW_PROJECT_VALUES = {
  newProjName: "",
  newProjCmd: "",
  newProjArgs: "",
  newProjCwd: "",
  newProjSetup: "",
  newProjSetupArgs: "",
  newProjRestart: true,
  newProjEnv: [] as { key: string; value: string }[],
  newProjCpu: "",
  newProjRam: "",
  newProjPort: "",
  newProjSource: "",
  newProjTerminalMode: "log",
  newProjToolchain: "",
  newProjToolchainVersion: "stable",
  newProjEnableTunnel: false,
};

export const DEFAULT_SIDEBAR_WIDTHS = {
  left: 220,
  right: 320,
};

export const DEFAULT_PANEL_HEIGHTS = {
  tabList: 250,
  monitor: 250,
  config: 300,
};

export const MAX_LOG_LINES = 2000;
export const MAX_HISTORY_POINTS = 30;
export const MAX_TERM_OUTPUT_LENGTH = 100000;

export const TOOLCHAIN_DEFAULTS: Record<string, { cmd: string; args: string }> = {
  node: { cmd: "npm", args: "run dev" },
  go: { cmd: "go", args: "run main.go" },
  python: { cmd: "python", args: "main.py" },
};
