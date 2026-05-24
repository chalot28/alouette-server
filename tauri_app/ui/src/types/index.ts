export interface Project {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  setup_command?: string;
  setup_args?: string[];
  auto_restart?: boolean;
  env?: { [key: string]: string };
  max_cpu_percent?: number;
  max_ram_mb?: number;
  port?: number;
  source?: string;
  terminal_mode?: string;
  toolchain?: string;
  toolchain_version?: string;
  enable_tunnel?: boolean;
  max_log_lines?: number;
}

export interface TerminalSessionItem {
  id: string;
  name: string;
}

export interface ProcessState {
  type: "Stopped" | "Setup" | "Running" | "Crashing" | "Terminated" | "Fatal";
  data?: any; // PID or error reasons
}

export interface LogLine {
  text: string;
  stream: "stdout" | "stderr" | "system";
  timestamp: number;
}

export interface ResourceHistory {
  [projectId: string]: {
    cpu: number[];
    ram: number[];
  };
}
