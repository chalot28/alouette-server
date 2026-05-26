import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, WebviewWindow } from "@tauri-apps/api/window";
function ZenIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Vòng tròn hở nghệ thuật Zen Ensō */}
      <path d="M12 3a9 9 0 1 0 9 9c0-1.5-.4-3-1.1-4.2" />
      {/* Chữ Z cách điệu mềm mại thanh thoát ở tâm */}
      <path d="M8.5 8.5h7L10 15.5h7" />
    </svg>
  );
}

import {
  // Dock icons
  Fingerprint,
  User,
  GitBranch,
  Sparkles,
  Wifi,
  Server,
  Cpu,
  Box,
  Palette,
  Code,
  X,
  Minus,
  Square,
  Save,
  RotateCcw,
  Sun,
  Moon,
  CheckCircle2,
  AlertTriangle,
  Info,
  ExternalLink,
  Settings,
  Search,
  Check,
} from "lucide-react";
import type { AppSettings } from "../types";

// ── Dock item definitions ──
interface DockItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const DOCK_ITEMS: DockItem[] = [
  {
    id: "project",
    label: "Project Identifier",
    icon: <Fingerprint size={16} />,
  },
  { id: "user", label: "User", icon: <User size={16} /> },
  { id: "git", label: "Git", icon: <GitBranch size={16} /> },
  { id: "ai", label: "Model AI", icon: <Sparkles size={16} /> },
  { id: "postman", label: "Post Mini", icon: <Wifi size={16} /> },
  { id: "browser", label: "Zen Browser", icon: <ZenIcon size={16} /> },
  { id: "environment", label: "Environment", icon: <Server size={16} /> },
  { id: "build", label: "Build", icon: <Cpu size={16} /> },
  { id: "sandbox", label: "Sandbox", icon: <Box size={16} /> },
  { id: "theme", label: "Theme", icon: <Palette size={16} /> },
  { id: "language", label: "Programming Language", icon: <Code size={16} /> },
];

// ── Toast state ──
interface ToastState {
  message: string;
  type: "success" | "error" | "info";
}

export default function AdminPanel() {
  const appWindowRef = useRef<WebviewWindow | null>(null);
  const [winReady, setWinReady] = useState(false);
  const [activeDock, setActiveDock] = useState("project");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [toast, setToast] = useState<ToastState | null>(null);

  // ── Lấy window handle an toàn ──
  useEffect(() => {
    try {
      appWindowRef.current = getCurrentWindow();
      setWinReady(true);
    } catch (e) {
      console.error("AdminPanel: getCurrentWindow() failed", e);
    }
  }, []);

  // ── Theme effect ──
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // ── Toast dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Window controls ──
  const handleMinimize = async () => {
    const w = appWindowRef.current;
    if (!w) return;
    try {
      await w.minimize();
    } catch (e) {
      console.error("minimize error", e);
    }
  };
  const handleMaximize = async () => {
    const w = appWindowRef.current;
    if (!w) return;
    try {
      await w.toggleMaximize();
    } catch (e) {
      console.error("maximize error", e);
    }
  };
  const handleClose = async () => {
    const w = appWindowRef.current;
    if (!w) return;
    try {
      await w.close();
    } catch (e) {
      console.error("close error", e);
    }
  };

  // ── Open external sub-windows ──
  const openPingWindow = async () => {
    try {
      await invoke("open_ping_window");
    } catch (e) {
      setToast({ message: "Failed to open Post Mini", type: "error" });
    }
  };

  const openBrowserWindow = async () => {
    try {
      await invoke("open_browser_window");
    } catch (e) {
      setToast({ message: "Failed to open Zen Browser", type: "error" });
    }
  };

  // ── Render dock item click handler ──
  const handleDockClick = (id: string) => {
    if (id === "postman") {
      openPingWindow();
      return;
    }
    if (id === "browser") {
      openBrowserWindow();
      return;
    }
    setActiveDock(id);
  };

  // ── Theme toggle ──
  const toggleTheme = () => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  };

  // ═══════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════

  return (
    <div className="admin-container">
      {/* ── Left Dock ── */}
      <nav className="admin-dock">
        <div className="admin-dock-header">
          <Settings size={18} className="admin-dock-logo" />
          <span className="admin-dock-title">Admin</span>
        </div>

        <div className="admin-dock-items">
          {DOCK_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`admin-dock-item ${activeDock === item.id ? "active" : ""}`}
              onClick={() => handleDockClick(item.id)}
              title={item.label}
            >
              <span className="admin-dock-icon">{item.icon}</span>
              <span className="admin-dock-label">{item.label}</span>
              {(item.id === "postman" || item.id === "browser") && (
                <ExternalLink size={10} className="admin-dock-external" />
              )}
            </button>
          ))}
        </div>

        <div className="admin-dock-footer">
          <button
            className="admin-dock-theme-btn"
            onClick={toggleTheme}
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            <span>{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
        </div>
      </nav>

      {/* ── Main Content Area ── */}
      <div className="admin-main">
        {/* Titlebar — có drag region để kéo cửa sổ */}
        <header className="admin-titlebar" data-tauri-drag-region>
          <span className="admin-titlebar-label">
            {DOCK_ITEMS.find((d) => d.id === activeDock)?.label || "Admin"}
          </span>
          <div className="admin-titlebar-actions">
            <button className="admin-win-btn" onClick={handleMinimize}>
              <Minus size={12} />
            </button>
            <button className="admin-win-btn" onClick={handleMaximize}>
              <Square size={10} />
            </button>
            <button
              className="admin-win-btn admin-win-close"
              onClick={handleClose}
            >
              <X size={12} />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="admin-content" style={activeDock === "sandbox" ? { padding: 0 } : {}}>
          {activeDock === "project" && <ProjectIdentifierSection />}
          {activeDock === "user" && <UserSection />}
          {activeDock === "git" && <GitSection />}
          {activeDock === "ai" && <AISection />}
          {activeDock === "environment" && <EnvironmentSection />}
          {activeDock === "build" && <BuildSection />}
          {activeDock === "sandbox" && <SandboxSection />}
          {activeDock === "theme" && (
            <ThemeSection
              theme={theme}
              onThemeChange={setTheme}
              setToast={setToast}
            />
          )}
          {activeDock === "language" && <LanguageSection />}
        </div>
      </div>

      {/* Inline toast */}
      {toast && (
        <div className={`admin-toast admin-toast-${toast.type}`}>
          {toast.type === "success" && <CheckCircle2 size={14} />}
          {toast.type === "error" && <AlertTriangle size={14} />}
          {toast.type === "info" && <Info size={14} />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// Section Components
// ═══════════════════════════════════════════

function ProjectIdentifierSection() {
  return (
    <div className="admin-panel animate-fade-in">
      <h2 className="admin-panel-title">Project Identifier</h2>
      <p className="admin-panel-desc">
        Configure project identity, naming conventions, and workspace metadata.
      </p>
      <div className="admin-card-grid">
        <div className="admin-card">
          <div className="admin-card-header">Workspace Name</div>
          <input
            className="admin-input"
            type="text"
            placeholder="My Workspace"
            defaultValue="Alouette Dev"
          />
        </div>
        <div className="admin-card">
          <div className="admin-card-header">Default Project Prefix</div>
          <input
            className="admin-input"
            type="text"
            placeholder="al-..."
            defaultValue="al-"
          />
        </div>
        <div className="admin-card">
          <div className="admin-card-header">Auto-generate IDs</div>
          <label className="admin-toggle">
            <input type="checkbox" defaultChecked />
            <span>Enable auto ID generation</span>
          </label>
        </div>
      </div>
    </div>
  );
}

function UserSection() {
  return (
    <div className="admin-panel animate-fade-in">
      <h2 className="admin-panel-title">User</h2>
      <p className="admin-panel-desc">
        Manage user profiles and access credentials.
      </p>
      <div className="admin-card-grid">
        <div className="admin-card">
          <div className="admin-card-header">Display Name</div>
          <input
            className="admin-input"
            type="text"
            placeholder="Your name"
            defaultValue="Developer"
          />
        </div>
        <div className="admin-card">
          <div className="admin-card-header">Email</div>
          <input
            className="admin-input"
            type="email"
            placeholder="email@example.com"
          />
        </div>
        <div className="admin-card">
          <div className="admin-card-header">Avatar</div>
          <div className="admin-avatar-placeholder">👤</div>
        </div>
      </div>
    </div>
  );
}

function GitSection() {
  return (
    <div className="admin-panel animate-fade-in">
      <h2 className="admin-panel-title">Git</h2>
      <p className="admin-panel-desc">
        Configure Git integration for version control.
      </p>
      <div className="admin-card-grid">
        <div className="admin-card">
          <div className="admin-card-header">Default Branch</div>
          <input className="admin-input" type="text" defaultValue="main" />
        </div>
        <div className="admin-card">
          <div className="admin-card-header">Remote URL</div>
          <input
            className="admin-input"
            type="text"
            placeholder="https://github.com/user/repo.git"
          />
        </div>
        <div className="admin-card">
          <div className="admin-card-header">Auto-commit on stop</div>
          <label className="admin-toggle">
            <input type="checkbox" />
            <span>Enable auto commit</span>
          </label>
        </div>
      </div>
    </div>
  );
}

function AISection() {
  return (
    <div className="admin-panel animate-fade-in">
      <h2 className="admin-panel-title">Model AI</h2>
      <p className="admin-panel-desc">
        Configure AI model endpoints and API keys.
      </p>
      <div className="admin-card-grid">
        <div className="admin-card">
          <div className="admin-card-header">Provider</div>
          <select className="admin-select">
            <option>OpenAI</option>
            <option>Anthropic</option>
            <option>Google Gemini</option>
            <option>Local (Ollama)</option>
          </select>
        </div>
        <div className="admin-card">
          <div className="admin-card-header">API Key</div>
          <input className="admin-input" type="password" placeholder="sk-..." />
        </div>
        <div className="admin-card">
          <div className="admin-card-header">Model</div>
          <select className="admin-select">
            <option>gpt-4o</option>
            <option>gpt-4o-mini</option>
            <option>claude-3-opus</option>
            <option>gemini-pro</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function EnvironmentSection() {
  return (
    <div className="admin-panel animate-fade-in">
      <h2 className="admin-panel-title">Environment</h2>
      <p className="admin-panel-desc">
        Manage global environment variables shared across projects.
      </p>
      <div className="admin-card">
        <div className="admin-card-header">Global Variables</div>
        <div className="admin-env-rows">
          {["NODE_ENV", "API_HOST", "LOG_LEVEL"].map((key) => (
            <div className="admin-env-row" key={key}>
              <input
                className="admin-input admin-input-sm"
                defaultValue={key}
                placeholder="KEY"
              />
              <span className="admin-eq">=</span>
              <input
                className="admin-input admin-input-sm"
                defaultValue=""
                placeholder="value"
              />
            </div>
          ))}
        </div>
        <button className="admin-btn admin-btn-sm" style={{ marginTop: 8 }}>
          + Add Variable
        </button>
      </div>
    </div>
  );
}

function BuildSection() {
  return (
    <div className="admin-panel animate-fade-in">
      <h2 className="admin-panel-title">Build</h2>
      <p className="admin-panel-desc">Build and compilation settings.</p>
      <div className="admin-card-grid">
        <div className="admin-card">
          <div className="admin-card-header">Build Command</div>
          <input
            className="admin-input"
            type="text"
            defaultValue="npm run build"
          />
        </div>
        <div className="admin-card">
          <div className="admin-card-header">Output Directory</div>
          <input className="admin-input" type="text" defaultValue="dist" />
        </div>
        <div className="admin-card">
          <div className="admin-card-header">Auto-build on save</div>
          <label className="admin-toggle">
            <input type="checkbox" />
            <span>Enable auto build</span>
          </label>
        </div>
      </div>
    </div>
  );
}

function SandboxSection() {
  const [activeSubTab, setActiveSubTab] = useState("terminal");
  const [searchProject, setSearchProject] = useState("");
  const [applyToAll, setApplyToAll] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  // Projects Configurations State Store
  interface ProjectSandboxConfig {
    termBuffer: string;
    blockSystemCommands: boolean;
    allowPipeOperators: boolean;
    terminalShell: string;

    cookieIsolation: boolean;
    isolateWebview: boolean;
    bypassCors: boolean;
    browserMode: string;

    semanticEnabled: boolean;
    riskLevel: string;
    strictBoundary: boolean;
    psParsing: boolean;
    homoglyphNorm: boolean;
    blockIex: boolean;

    sandboxMode: string;
    memoryLimit: string;
    timeout: string;
    cpuLimit: string;
    maxFileSize: string;
  }

  const DEFAULT_CONFIG: ProjectSandboxConfig = {
    termBuffer: "1000",
    blockSystemCommands: true,
    allowPipeOperators: false,
    terminalShell: "PowerShell",

    cookieIsolation: true,
    isolateWebview: true,
    bypassCors: false,
    browserMode: "Isolated",

    semanticEnabled: true,
    riskLevel: "Medium",
    strictBoundary: true,
    psParsing: true,
    homoglyphNorm: true,
    blockIex: true,

    sandboxMode: "Docker",
    memoryLimit: "512MB",
    timeout: "30s",
    cpuLimit: "1.0 Core",
    maxFileSize: "50MB",
  };

  const [projectConfigs, setProjectConfigs] = useState<{ [id: string]: ProjectSandboxConfig }>({});

  // Dynamic Imported Projects List loaded from Backend (Part 4)
  interface SandboxProjectItem {
    id: string;
    name: string;
    type: string;
    status: string;
    active: boolean;
  }
  const [projectsList, setProjectsList] = useState<SandboxProjectItem[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const list = await invoke<any[]>("get_projects");
        const formatted = list.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.toolchain ? `${p.toolchain}` : (p.command ? `Cmd: ${p.command}` : "Custom"),
          status: "Sandboxed",
          active: false, // by default, all inherit global default config
        }));
        setProjectsList(formatted);

        // Initialize default configs including __global_default__
        const initialConfigs: { [id: string]: ProjectSandboxConfig } = {
          "__global_default__": { ...DEFAULT_CONFIG }
        };
        formatted.forEach(p => {
          initialConfigs[p.id] = { ...DEFAULT_CONFIG };
        });
        setProjectConfigs(initialConfigs);
        setSelectedProjectId("__global_default__");
      } catch (e) {
        console.error("Failed to load real projects in Sandbox:", e);
      }
    })();
  }, []);

  const filteredProjectsList = projectsList.filter(p => 
    p.name.toLowerCase().includes(searchProject.toLowerCase()) ||
    p.type.toLowerCase().includes(searchProject.toLowerCase())
  );

  // Helper getters/setters for currently selected project configuration
  const isInheriting = selectedProjectId !== "__global_default__" && !projectsList.find(p => p.id === selectedProjectId)?.active;
  
  const currentConfig = isInheriting 
    ? (projectConfigs["__global_default__"] || DEFAULT_CONFIG)
    : (projectConfigs[selectedProjectId] || DEFAULT_CONFIG);

  const updateCurrentConfig = <K extends keyof ProjectSandboxConfig>(key: K, value: ProjectSandboxConfig[K]) => {
    if (!selectedProjectId) return;
    
    // If real project is inheriting, breaking inheritance on edit and clone default settings
    if (selectedProjectId !== "__global_default__" && isInheriting) {
      setProjectsList(prev => prev.map(p => 
        p.id === selectedProjectId ? { ...p, active: true } : p
      ));
      setProjectConfigs(prev => ({
        ...prev,
        [selectedProjectId]: {
          ...(prev["__global_default__"] || DEFAULT_CONFIG),
          [key]: value
        }
      }));
    } else {
      setProjectConfigs(prev => ({
        ...prev,
        [selectedProjectId]: {
          ...(prev[selectedProjectId] || DEFAULT_CONFIG),
          [key]: value
        }
      }));
    }
  };

  // Sleek Monochromatic Custom Checkbox
  function CustomCheckbox({ checked, onChange, disabled }: { checked: boolean, onChange: (val: boolean) => void, disabled?: boolean }) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onChange(!checked);
        }}
        disabled={disabled}
        style={{
          width: "16px",
          height: "16px",
          borderRadius: "4px",
          border: `1px solid ${checked ? "var(--text-primary)" : "var(--border-primary)"}`,
          background: checked ? "rgba(255, 255, 255, 0.08)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: disabled ? "not-allowed" : "pointer",
          padding: 0,
          opacity: disabled ? 0.5 : 1,
          outline: "none"
        }}
      >
        {checked && <Check size={11} style={{ strokeWidth: 3, color: "var(--text-primary)" }} />}
      </button>
    );
  }

  return (
    <div className="admin-panel" style={{ display: "flex", height: "100%", width: "100%", maxWidth: "none", padding: 0, margin: 0, overflow: "hidden" }}>
      
      {/* ── LEFT CONTAINER: Part 5 (Tabs) & Part 2 (Setup Area) ── */}
      <div style={{ flex: "7 7 0%", display: "flex", flexDirection: "column", height: "100%", padding: "20px", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h2 className="admin-panel-title">Sandbox Controller</h2>
            <p className="admin-panel-desc" style={{ margin: 0 }}>
              Configuring project: <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-primary)" }}>{projectsList.find(p => p.id === selectedProjectId)?.name || "None Selected"}</span>
            </p>
          </div>
          {selectedProjectId && (
            <span style={{ fontSize: "11px", padding: "4px 8px", background: "rgba(255, 255, 255, 0.05)", border: "1px solid var(--border-primary)", borderRadius: "4px", opacity: 0.8 }}>
              Individual Setup Mode
            </span>
          )}
        </div>

        {/* ── Part 5: Tab Selector (Terminal, Browser, Engine, Setup) ── */}
        <div 
          className="admin-sub-tabs" 
          style={{ 
            display: "flex", 
            gap: "8px", 
            borderBottom: "1px solid var(--border-primary)", 
            marginBottom: "20px", 
            paddingBottom: "4px" 
          }}
        >
          {["terminal", "browser", "engine", "setup"].map((tab) => (
            <button 
              key={tab}
              className={`admin-tab-btn`}
              onClick={() => setActiveSubTab(tab)}
              style={{
                background: activeSubTab === tab ? "var(--bg-active)" : "none",
                border: "none",
                color: activeSubTab === tab ? "var(--text-primary)" : "var(--text-muted, #71717a)",
                fontWeight: activeSubTab === tab ? "600" : "400",
                cursor: "pointer",
                padding: "8px 16px",
                borderRadius: "4px",
                fontSize: "13px",
                textTransform: "capitalize"
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* ── Part 2: Setup Details ── */}
        <div style={{ flex: 1 }}>
          {!selectedProjectId ? (
            <div style={{ display: "flex", height: "60%", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: "13px" }}>
              Vui lòng chọn một dự án ở danh sách bên phải để thiết lập cấu hình.
            </div>
          ) : (
            <>
              {activeSubTab === "terminal" && (
                <div className="admin-card-grid">
                  <div className="admin-card">
                    <div className="admin-card-header">Terminal Command Interceptor</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px" }}>
                      <CustomCheckbox 
                        checked={currentConfig.blockSystemCommands} 
                        onChange={(val) => updateCurrentConfig("blockSystemCommands", val)} 
                      />
                      <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>Block System Execution Hooks</span>
                    </div>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Pipelining & Operators</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px" }}>
                      <CustomCheckbox 
                        checked={currentConfig.allowPipeOperators} 
                        onChange={(val) => updateCurrentConfig("allowPipeOperators", val)} 
                      />
                      <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>Allow Chained Commands (|, &&, ||)</span>
                    </div>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Buffer Limit (Lines)</div>
                    <input 
                      className="admin-input" 
                      type="number" 
                      value={currentConfig.termBuffer} 
                      onChange={(e) => updateCurrentConfig("termBuffer", e.target.value)} 
                    />
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Default Shell Environment</div>
                    <select 
                      className="admin-select" 
                      value={currentConfig.terminalShell} 
                      onChange={(e) => updateCurrentConfig("terminalShell", e.target.value)}
                    >
                      <option value="PowerShell">PowerShell Core</option>
                      <option value="CMD">Windows Command Prompt</option>
                      <option value="Bash">WSL Bash Shell</option>
                    </select>
                  </div>
                </div>
              )}

              {activeSubTab === "browser" && (
                <div className="admin-card-grid">
                  <div className="admin-card">
                    <div className="admin-card-header">Cookie Isolation</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px" }}>
                      <CustomCheckbox 
                        checked={currentConfig.cookieIsolation} 
                        onChange={(val) => updateCurrentConfig("cookieIsolation", val)} 
                      />
                      <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>Strict Cookie & Session Separation</span>
                    </div>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Webview Process Isolation</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px" }}>
                      <CustomCheckbox 
                        checked={currentConfig.isolateWebview} 
                        onChange={(val) => updateCurrentConfig("isolateWebview", val)} 
                      />
                      <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>Run Webviews in separate processes</span>
                    </div>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">CORS Bypass Mode</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px" }}>
                      <CustomCheckbox 
                        checked={currentConfig.bypassCors} 
                        onChange={(val) => updateCurrentConfig("bypassCors", val)} 
                      />
                      <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>Enable CORS Bypass for testing</span>
                    </div>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Zen Browser Mode</div>
                    <select 
                      className="admin-select" 
                      value={currentConfig.browserMode} 
                      onChange={(e) => updateCurrentConfig("browserMode", e.target.value)}
                    >
                      <option value="Isolated">Isolated Sandbox Mode</option>
                      <option value="Shared">Shared Context Mode</option>
                      <option value="Incognito">Strict Incognito Mode</option>
                    </select>
                  </div>
                </div>
              )}

              {activeSubTab === "engine" && (
                <div className="admin-card-grid">
                  <div className="admin-card" style={{ gridColumn: "span 2" }}>
                    <div className="admin-card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>Tier 1 Semantic Interceptor</span>
                      <CustomCheckbox 
                        checked={currentConfig.semanticEnabled} 
                        onChange={(val) => updateCurrentConfig("semanticEnabled", val)} 
                      />
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
                      Analyses command semantics (~, $env, homoglyphs) to intercept system breaches.
                    </p>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Risk Threshold Level</div>
                    <select 
                      className="admin-select" 
                      value={currentConfig.riskLevel} 
                      disabled={!currentConfig.semanticEnabled}
                      onChange={(e) => updateCurrentConfig("riskLevel", e.target.value)}
                    >
                      <option value="Low">Low (Permissive)</option>
                      <option value="Medium">Medium (Balanced)</option>
                      <option value="High">High (Strict)</option>
                      <option value="Extreme">Extreme (Paranoid)</option>
                    </select>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Boundary Control</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px" }}>
                      <CustomCheckbox 
                        checked={currentConfig.strictBoundary} 
                        disabled={!currentConfig.semanticEnabled}
                        onChange={(val) => updateCurrentConfig("strictBoundary", val)} 
                      />
                      <span style={{ fontSize: "13px", color: "var(--text-primary)", opacity: !currentConfig.semanticEnabled ? 0.5 : 1 }}>Prevent workspace escapes</span>
                    </div>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Path Enforcement Details</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <CustomCheckbox 
                          checked={currentConfig.psParsing} 
                          disabled={!currentConfig.semanticEnabled}
                          onChange={(val) => updateCurrentConfig("psParsing", val)} 
                        />
                        <span style={{ fontSize: "13px", color: "var(--text-primary)", opacity: !currentConfig.semanticEnabled ? 0.5 : 1 }}>Parse PowerShell $subexpressions</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <CustomCheckbox 
                          checked={currentConfig.homoglyphNorm} 
                          disabled={!currentConfig.semanticEnabled}
                          onChange={(val) => updateCurrentConfig("homoglyphNorm", val)} 
                        />
                        <span style={{ fontSize: "13px", color: "var(--text-primary)", opacity: !currentConfig.semanticEnabled ? 0.5 : 1 }}>Normalize Unicode homoglyphs</span>
                      </div>
                    </div>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Danger Blocking Policies</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px" }}>
                      <CustomCheckbox 
                        checked={currentConfig.blockIex} 
                        disabled={!currentConfig.semanticEnabled}
                        onChange={(val) => updateCurrentConfig("blockIex", val)} 
                      />
                      <span style={{ fontSize: "13px", color: "var(--text-primary)", opacity: !currentConfig.semanticEnabled ? 0.5 : 1 }}>Block iex & Invoke-Expression</span>
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === "setup" && (
                <div className="admin-card-grid">
                  <div className="admin-card">
                    <div className="admin-card-header">Sandbox Mode</div>
                    <select 
                      className="admin-select" 
                      value={currentConfig.sandboxMode} 
                      onChange={(e) => updateCurrentConfig("sandboxMode", e.target.value)}
                    >
                      <option value="Disabled">Disabled</option>
                      <option value="Docker">Docker (Containerized)</option>
                      <option value="Firecracker">Firecracker (MicroVM)</option>
                      <option value="gVisor">gVisor (Sandboxed Kernel)</option>
                    </select>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Memory Limit</div>
                    <select 
                      className="admin-select" 
                      value={currentConfig.memoryLimit} 
                      onChange={(e) => updateCurrentConfig("memoryLimit", e.target.value)}
                    >
                      <option value="128MB">128 MB</option>
                      <option value="256MB">256 MB</option>
                      <option value="512MB">512 MB</option>
                      <option value="1GB">1 GB</option>
                      <option value="2GB">2 GB</option>
                    </select>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">CPU Limit</div>
                    <select 
                      className="admin-select" 
                      value={currentConfig.cpuLimit} 
                      onChange={(e) => updateCurrentConfig("cpuLimit", e.target.value)}
                    >
                      <option value="0.5 Core">0.5 Core</option>
                      <option value="1.0 Core">1.0 Core</option>
                      <option value="2.0 Core">2.0 Core</option>
                      <option value="Unlimited">Unlimited</option>
                    </select>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Timeout</div>
                    <input 
                      className="admin-input" 
                      type="text" 
                      value={currentConfig.timeout} 
                      onChange={(e) => updateCurrentConfig("timeout", e.target.value)} 
                    />
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Max Write File Size</div>
                    <select 
                      className="admin-select" 
                      value={currentConfig.maxFileSize} 
                      onChange={(e) => updateCurrentConfig("maxFileSize", e.target.value)}
                    >
                      <option value="10MB">10 MB</option>
                      <option value="50MB">50 MB</option>
                      <option value="100MB">100 MB</option>
                      <option value="Unlimited">Unlimited</option>
                    </select>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── RIGHT CONTAINER: Sidebar for Scope, Search, and Imported Projects ── */}
      <div 
        style={{ 
          flex: "3 3 0%", 
          display: "flex", 
          flexDirection: "column", 
          height: "100%", 
          borderLeft: "1px solid var(--border-primary)",
          background: "var(--bg-admin-sidebar, rgba(15, 23, 42, 0.25))"
        }}
      >
        {/* ── Part 1: Global Default Settings Profile Selector (Tab All) ── */}
        <div 
          onClick={() => setSelectedProjectId("__global_default__")}
          style={{ 
            padding: "16px", 
            borderBottom: "1px solid var(--border-primary)", 
            background: selectedProjectId === "__global_default__" ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.02)",
            border: selectedProjectId === "__global_default__" ? "1px solid var(--text-primary)" : "none",
            cursor: "pointer"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-primary)" }}>Tab All (Cấu hình mặc định)</span>
            <span style={{ fontSize: "10px", padding: "2px 6px", background: "rgba(255,255,255,0.05)", borderRadius: "3px", color: "var(--text-secondary)" }}>Template</span>
          </div>
          <p style={{ fontSize: "11px", color: "var(--text-secondary)", margin: 0 }}>
            Mẫu cấu hình cơ sở áp dụng cho các dự án mới hoặc dự án kế thừa.
          </p>
        </div>

        {/* ── Part 3: Search Bar ── */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-primary)" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <input 
              className="admin-input" 
              style={{ paddingLeft: "32px", fontSize: "12px", width: "100%" }}
              placeholder="Tìm kiếm dự án..." 
              value={searchProject}
              onChange={(e) => setSearchProject(e.target.value)}
            />
            <span style={{ position: "absolute", left: "10px", opacity: 0.5, pointerEvents: "none", display: "flex", alignItems: "center" }}>
              <Search size={14} style={{ color: "var(--text-primary)" }} />
            </span>
          </div>
        </div>

        {/* ── Part 4: Imported Projects ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, color: "var(--text-secondary)" }}>
              Dự án được import ({filteredProjectsList.length})
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {filteredProjectsList.map((proj) => {
              const isSelected = proj.id === selectedProjectId;
              return (
                <div 
                  key={proj.id}
                  onClick={() => setSelectedProjectId(proj.id)}
                  style={{ 
                    padding: "10px", 
                    borderRadius: "6px", 
                    border: isSelected ? "1px solid var(--text-primary)" : "1px solid var(--border-primary)", 
                    background: isSelected ? "rgba(255, 255, 255, 0.08)" : (proj.active ? "rgba(255, 255, 255, 0.04)" : "rgba(255,255,255,0.01)"),
                    opacity: isSelected || proj.active ? 1 : 0.6,
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                    cursor: "pointer"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--text-primary)" }}>
                      {proj.name}
                    </span>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "9px", color: "var(--text-secondary)" }}>Cấu hình riêng</span>
                      <CustomCheckbox 
                        checked={proj.active}
                        onChange={(val) => {
                          setProjectsList(prev => prev.map(p => 
                            p.id === proj.id ? { ...p, active: val } : p
                          ));
                        }}
                      />
                    </div>
                  </div>
                  
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--text-secondary)" }}>
                    <span>{proj.type}</span>
                    <span style={{ 
                      fontWeight: 600, 
                      color: "var(--text-secondary)",
                      fontSize: "9px",
                      padding: "1px 4px",
                      background: "rgba(255,255,255,0.05)",
                      borderRadius: "2px"
                    }}>
                      {proj.active ? "Tùy chỉnh (Custom)" : "Mặc định (Inherited)"}
                    </span>
                  </div>
                </div>
              );
            })}

            {filteredProjectsList.length === 0 && (
              <div style={{ textAlign: "center", padding: "20px", color: "var(--text-secondary)", fontSize: "12px" }}>
                Không tìm thấy dự án phù hợp
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ThemeSection({
  theme,
  onThemeChange,
  setToast,
}: {
  theme: "dark" | "light";
  onThemeChange: (t: "dark" | "light") => void;
  setToast: (t: ToastState) => void;
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await invoke<AppSettings>("get_settings");
        setSettings(s);
      } catch {
        // ignore
      }
    })();
  }, []);

  const update = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!settings) return;
    try {
      await invoke("save_settings", { settings });
      onThemeChange(settings.theme as "dark" | "light");
      setToast({ message: "Theme settings saved.", type: "success" });
    } catch (e) {
      setToast({ message: `Save failed: ${e}`, type: "error" });
    }
  };

  const handleReset = async () => {
    try {
      const defaults = await invoke<AppSettings>("reset_settings");
      setSettings(defaults);
      onThemeChange(defaults.theme as "dark" | "light");
      setToast({ message: "Reset to defaults.", type: "info" });
    } catch (e) {
      setToast({ message: `Reset failed: ${e}`, type: "error" });
    }
  };

  return (
    <div className="admin-panel animate-fade-in">
      <h2 className="admin-panel-title">Theme</h2>
      <p className="admin-panel-desc">
        Customize the application look and feel.
      </p>

      <div className="admin-card-grid">
        <div className="admin-card">
          <div className="admin-card-header">Color Scheme</div>
          <div className="admin-theme-btns">
            <button
              className={`admin-theme-btn ${theme === "dark" ? "active" : ""}`}
              onClick={() => {
                onThemeChange("dark");
                setSettings((s) => (s ? { ...s, theme: "dark" } : s));
              }}
            >
              <Moon size={16} />
              <span>Dark</span>
            </button>
            <button
              className={`admin-theme-btn ${theme === "light" ? "active" : ""}`}
              onClick={() => {
                onThemeChange("light");
                setSettings((s) => (s ? { ...s, theme: "light" } : s));
              }}
            >
              <Sun size={16} />
              <span>Light</span>
            </button>
          </div>
        </div>

        {settings && (
          <>
            <div className="admin-card">
              <div className="admin-card-header">Font Size</div>
              <input
                className="admin-input"
                type="number"
                min={10}
                max={24}
                value={settings.font_size}
                onChange={(e) => update("font_size", Number(e.target.value))}
              />
            </div>
            <div className="admin-card">
              <div className="admin-card-header">Max Log Lines</div>
              <input
                className="admin-input"
                type="number"
                min={100}
                max={50000}
                step={100}
                value={settings.max_log_lines}
                onChange={(e) =>
                  update("max_log_lines", Number(e.target.value))
                }
              />
            </div>
            <div className="admin-card">
              <div className="admin-card-header">Monitor Interval (ms)</div>
              <input
                className="admin-input"
                type="number"
                min={200}
                max={10000}
                step={100}
                value={settings.monitor_interval_ms}
                onChange={(e) =>
                  update("monitor_interval_ms", Number(e.target.value))
                }
              />
            </div>
          </>
        )}
      </div>

      <div className="admin-actions-bar" style={{ marginTop: 20 }}>
        <button className="admin-btn admin-btn-secondary" onClick={handleReset}>
          <RotateCcw size={13} />
          <span>Reset Defaults</span>
        </button>
        <button className="admin-btn admin-btn-primary" onClick={handleSave}>
          <Save size={13} />
          <span>Save Theme</span>
        </button>
      </div>
    </div>
  );
}

function LanguageSection() {
  return (
    <div className="admin-panel animate-fade-in">
      <h2 className="admin-panel-title">Programming Language</h2>
      <p className="admin-panel-desc">
        Configure default language runtimes and toolchains.
      </p>
      <div className="admin-card-grid">
        <div className="admin-card">
          <div className="admin-card-header">Default Toolchain</div>
          <select className="admin-select">
            <option>Node.js</option>
            <option>Go</option>
            <option>Python</option>
            <option>Rust</option>
            <option>Java</option>
          </select>
        </div>
        <div className="admin-card">
          <div className="admin-card-header">Version</div>
          <input
            className="admin-input"
            type="text"
            placeholder="18.x"
            defaultValue="20.11.0"
          />
        </div>
        <div className="admin-card">
          <div className="admin-card-header">Package Manager</div>
          <select className="admin-select">
            <option>npm</option>
            <option>yarn</option>
            <option>pnpm</option>
          </select>
        </div>
      </div>
    </div>
  );
}
