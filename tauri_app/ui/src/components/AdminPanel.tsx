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
        <div className="admin-content">
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
  return (
    <div className="admin-panel animate-fade-in">
      <h2 className="admin-panel-title">Sandbox</h2>
      <p className="admin-panel-desc">
        Isolated runtime environment for testing.
      </p>
      <div className="admin-card-grid">
        <div className="admin-card">
          <div className="admin-card-header">Sandbox Mode</div>
          <select className="admin-select">
            <option>Disabled</option>
            <option>Docker</option>
            <option>Firecracker</option>
            <option>gVisor</option>
          </select>
        </div>
        <div className="admin-card">
          <div className="admin-card-header">Memory Limit</div>
          <input className="admin-input" type="text" defaultValue="512MB" />
        </div>
        <div className="admin-card">
          <div className="admin-card-header">Timeout</div>
          <input className="admin-input" type="text" defaultValue="30s" />
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
