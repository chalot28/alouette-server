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

export type TerminalConnectionStatus =
  | "connecting"
  | "connected"
  | "error"
  | "disconnected";

export interface TerminalState {
  id: string;
  status: TerminalConnectionStatus;
  errorMessage?: string;
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

/// Mirrors core_engine::settings::AppSettings
export interface AppSettings {
  theme: "dark" | "light";
  language: string;
  max_log_lines: number;
  auto_scroll: boolean;
  active_log_filter: string;
  max_history_points: number;
  max_term_output_length: number;
  monitor_interval_ms: number;
  font_size: number;
  default_left_sidebar_width: number;
  default_right_sidebar_width: number;
  default_tab_list_height: number;
  default_monitor_height: number;
  default_config_height: number;
}
