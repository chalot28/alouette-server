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
  Monitor,
  Smartphone,
  ChevronDown,
  ChevronRight,
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

// Sleek Monochromatic Custom Checkbox
export function CustomCheckbox({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
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
        outline: "none",
      }}
    >
      {checked && (
        <Check
          size={11}
          style={{ strokeWidth: 3, color: "var(--text-primary)" }}
        />
      )}
    </button>
  );
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
        <div
          className="admin-content"
          style={activeDock === "sandbox" ? { padding: 0 } : {}}
        >
          {activeDock === "project" && <ProjectIdentifierSection />}
          {activeDock === "user" && <UserSection />}
          {activeDock === "git" && <GitSection />}
          {activeDock === "ai" && <AISection setToast={setToast} />}
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

interface PredefinedModel {
  provider: string;
  id: string;
  models: {
    id: string;
    name: string;
    context: string;
    vision?: boolean;
    desc: string;
  }[];
}

const PREDEFINED_MODELS: PredefinedModel[] = [
  {
    provider: "DeepSeek",
    id: "deepseek",
    models: [
      { id: "deepseek-v4-pro", name: "DeepSeek-V4 Pro", context: "1000k", desc: "Mô hình nguồn mở hàng đầu năm 2026, tối ưu hóa suy luận logic vượt bậc." },
      { id: "deepseek-v4", name: "DeepSeek-V4", context: "1000k", desc: "Mô hình suy luận tốc độ nhanh và tối ưu hóa chi phí." },
      { id: "deepseek-r1", name: "DeepSeek-R1 (Reasoning)", context: "1000k", desc: "Mô hình suy luận sâu chuyên biệt cho toán học và code." }
    ]
  },
  {
    provider: "Claude",
    id: "claude",
    models: [
      { id: "claude-opus-4.7", name: "Claude Opus 4.7", context: "200k", vision: true, desc: "Flagship tối tân nhất của Anthropic năm 2026, lập trình tự trị và lập luận đỉnh cao." },
      { id: "claude-sonnet-5", name: "Claude Sonnet 5", context: "200k", vision: true, desc: "Mô hình cân bằng hoàn hảo giữa tốc độ và trí tuệ." }
    ]
  },
  {
    provider: "ChatGPT",
    id: "gpt-chatgpt",
    models: [
      { id: "gpt-5.5", name: "GPT-5.5", context: "200k", vision: true, desc: "Thế hệ siêu trí tuệ mới của OpenAI năm 2026, suy luận đa phương thức chính xác tuyệt đối." },
      { id: "o1-pro", name: "o1-Pro (Reasoning)", context: "200k", desc: "Mô hình suy luận chuỗi ý nghĩ chuyên sâu cho toán học và lý thuyết." },
      { id: "o3-mini", name: "o3-Mini (Coding)", context: "200k", desc: "Mô hình suy luận nhanh tối ưu cho lập trình phần mềm." },
      { id: "gpt-4o", name: "GPT-4o (Vision)", context: "128k", vision: true, desc: "Mô hình đa phương thức linh hoạt cho các tác vụ tổng quát." }
    ]
  },
  {
    provider: "Gemini",
    id: "gemini",
    models: [
      { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", context: "1000k", vision: true, desc: "Mô hình tốc độ ánh sáng năm 2026 của Google, context cực rộng và tối ưu DEV agent." },
      { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", context: "1000k", vision: true, desc: "Mô hình thông minh cao cấp của Google cho phân tích phức tạp." }
    ]
  },
  {
    provider: "Qwen",
    id: "qwen",
    models: [
      { id: "qwen-3.7-max", name: "Qwen 3.7 Max", context: "128k", desc: "Siêu mô hình thế hệ mới từ Alibaba, vô địch về toán học và suy luận logic." }
    ]
  }
];

interface CustomModel {
  id: string;
  provider: string;
  name: string;
  endpoint: string;
  apiKey: string;
  contextLimit: string;
  supportsVision: boolean;
  apiStandard: string; // "openai" | "claude"
}

function AISection({ setToast }: { setToast: (t: ToastState | null) => void }) {
  const [activeModels, setActiveModels] = useState<string[]>(["deepseek-v4-pro", "claude-opus-4.7", "gemini-3.5-flash"]);
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [expandedProviders, setExpandedProviders] = useState<string[]>([]);

  const toggleExpandProvider = (provId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedProviders((prev) =>
      prev.includes(provId) ? prev.filter((id) => id !== provId) : [...prev, provId]
    );
  };

  const handleToggleProvider = (providerId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const provider = PREDEFINED_MODELS.find(p => p.id === providerId);
    if (!provider) return;

    const modelIds = provider.models.map(m => m.id);
    const anyActive = modelIds.some(id => activeModels.includes(id));

    let updatedActive: string[];
    if (anyActive) {
      // Turn off all models for this provider
      updatedActive = activeModels.filter(id => !modelIds.includes(id));
    } else {
      // Turn on all models for this provider
      updatedActive = [...activeModels, ...modelIds];
    }

    setActiveModels(updatedActive);
    autoSave(updatedActive, customModels);
  };

  const handleToggleModel = (modelId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const updatedActive = activeModels.includes(modelId)
      ? activeModels.filter((id) => id !== modelId)
      : [...activeModels, modelId];
    
    setActiveModels(updatedActive);
    autoSave(updatedActive, customModels);
  };

  // Custom model form fields
  const [custProvider, setCustProvider] = useState("");
  const [custName, setCustName] = useState("");
  const [custEndpoint, setCustEndpoint] = useState("");
  const [custApiKey, setCustApiKey] = useState("");
  const [custLimit, setCustLimit] = useState("128k");
  const [custVision, setCustVision] = useState(false);
  const [custStandard, setCustStandard] = useState("openai");
  const [showAddForm, setShowAddForm] = useState(false);

  // Load configurations
  useEffect(() => {
    const savedActive = localStorage.getItem("alouette_active_models");
    if (savedActive) setActiveModels(JSON.parse(savedActive));

    // Fetch from backend ai_config.yml
    (async () => {
      try {
        interface RustModelConfig {
          provider: string;
          api_key: string;
          api_url: string;
          context_limit: number;
          supports_vision: boolean;
          temperature: number;
          top_p: number;
          api_standard?: string;
        }
        interface RustCustomAiConfig {
          active_model: string;
          models: { [key: string]: RustModelConfig };
        }
        
        const config = await invoke<RustCustomAiConfig>("get_custom_ai_config");
        if (config && config.models) {
          const loadedCustoms: CustomModel[] = Object.entries(config.models).map(([name, item]) => ({
            id: name,
            provider: item.provider,
            name: name,
            endpoint: item.api_url,
            apiKey: item.api_key,
            contextLimit: `${Math.round(item.context_limit / 1000)}k`,
            supportsVision: item.supports_vision,
            apiStandard: item.api_standard || "openai"
          }));
          setCustomModels(loadedCustoms);
          
          // Also dynamically set active model if active_model is specified in yml
          if (config.active_model && !savedActive) {
            setActiveModels([config.active_model]);
          }
        }
      } catch (err) {
        console.error("Failed to load YAML config:", err);
        // Fallback to localStorage if invoke fails
        const savedCustom = localStorage.getItem("alouette_custom_models");
        if (savedCustom) setCustomModels(JSON.parse(savedCustom));
      }
    })();
  }, []);

  // Instant Auto-Save Helper
  const autoSave = async (newActive: string[], newCustoms: CustomModel[]) => {
    localStorage.setItem("alouette_active_models", JSON.stringify(newActive));
    localStorage.setItem("alouette_custom_models", JSON.stringify(newCustoms));
    
    // Trigger dynamic storage event for current window
    window.dispatchEvent(new Event("storage"));

    // Save to backend YAML
    try {
      interface RustModelConfig {
        provider: string;
        api_key: string;
        api_url: string;
        context_limit: number;
        supports_vision: boolean;
        temperature: number;
        top_p: number;
        api_standard: string;
      }
      const modelsMap: { [key: string]: RustModelConfig } = {};
      newCustoms.forEach(m => {
        let limit = 128000;
        if (m.contextLimit) {
          const val = parseInt(m.contextLimit.replace(/[^0-9]/g, ""), 10);
          if (!isNaN(val)) {
            limit = val * 1000;
          }
        }
        const key = m.name || m.id;
        modelsMap[key] = {
          provider: m.provider,
          api_key: m.apiKey || "",
          api_url: m.endpoint || "",
          context_limit: limit,
          supports_vision: !!m.supportsVision,
          temperature: 0.2,
          top_p: 0.95,
          api_standard: m.apiStandard || "openai"
        };
      });

      let activeModel = "gemini-1.5-flash";
      if (newActive.length > 0) {
        const activeCustom = newCustoms.find(m => newActive.includes(m.id));
        if (activeCustom) {
          activeModel = activeCustom.name || activeCustom.id;
        } else {
          activeModel = newActive[0];
        }
      }

      await invoke("save_custom_ai_config", {
        config: {
          active_model: activeModel,
          models: modelsMap
        }
      });
    } catch (err) {
      console.error("Failed to save custom AI config to backend:", err);
    }
  };



  const handleAddCustomModel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!custProvider || !custName || !custEndpoint) {
      alert("Vui lòng nhập đầy đủ Tên nhà cung cấp, Tên model và Endpoint.");
      return;
    }

    const newModel: CustomModel = {
      id: `custom-${Date.now()}`,
      provider: custProvider,
      name: custName,
      endpoint: custEndpoint,
      apiKey: custApiKey,
      contextLimit: custLimit,
      supportsVision: custVision,
      apiStandard: custStandard,
    };

    const updatedCustoms = [...customModels, newModel];
    const updatedActive = [...activeModels, newModel.id];

    setCustomModels(updatedCustoms);
    setActiveModels(updatedActive);
    autoSave(updatedActive, updatedCustoms);

    // Reset form
    setCustProvider("");
    setCustName("");
    setCustEndpoint("");
    setCustApiKey("");
    setCustLimit("128k");
    setCustVision(false);
    setCustStandard("openai");
    setShowAddForm(false);

    setToast({
      message: "✓ Đã tự động lưu & cập nhật Model tùy chỉnh!",
      type: "success"
    });
  };

  const handleDeleteCustomModel = (id: string) => {
    const updatedCustoms = customModels.filter((m) => m.id !== id);
    const updatedActive = activeModels.filter((mid) => mid !== id);

    setCustomModels(updatedCustoms);
    setActiveModels(updatedActive);
    autoSave(updatedActive, updatedCustoms);

    setToast({
      message: "✕ Đã xóa & cập nhật thay đổi.",
      type: "info"
    });
  };

  return (
    <div className="admin-panel animate-fade-in" style={{ paddingBottom: "60px", display: "flex", flexDirection: "column", gap: "28px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-primary)", paddingBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Sparkles size={20} style={{ color: "var(--text-primary)" }} />
          <div>
            <h2 className="admin-panel-title" style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>Model AI</h2>
            <p className="admin-panel-desc" style={{ margin: "2px 0 0 0", fontSize: "12px" }}>
              Quản lý và kích hoạt các nhà cung cấp mô hình AI mặc định và tùy chỉnh độc lập.
            </p>
          </div>
        </div>
      </div>

      {/* ── PART 2: CUSTOM MODELS ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "4px" }}>
              Custom AI Provider Models
            </h3>
            <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", margin: 0, lineHeight: "1.5" }}>
              Tự cấu hình mô hình độc lập qua API của riêng bạn. Cuộc gọi kết nối trực tiếp đến Endpoint của nhà sản xuất (Hiện có <strong style={{ color: "var(--text-primary)" }}>{customModels.length} custom model</strong> nạp từ ai_config.yml).
            </p>
          </div>

          <button
            onClick={() => setShowAddForm(!showAddForm)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              backgroundColor: "transparent",
              border: "1px solid var(--border-primary)",
              color: "var(--text-primary)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              borderRadius: "4px",
              transition: "all 0.15s ease"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-primary)";
            }}
          >
            <span>{showAddForm ? "✕ Hủy nhập" : "＋ Thêm Model Tự Nhập"}</span>
          </button>
        </div>

        {/* Form to add a new Custom Model (Smooth Dropdown Expand) */}
        {showAddForm && (
          <form
            onSubmit={handleAddCustomModel}
            className="admin-card animate-fade-in"
            style={{
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              border: "1px solid var(--border-primary)",
              borderRadius: "4px",
              background: "var(--bg-secondary)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid var(--border-primary)", paddingBottom: "10px", marginBottom: "4px" }}>
              <Sparkles size={14} style={{ color: "var(--text-primary)" }} />
              <span style={{ fontSize: "12.5px", fontWeight: 700, textTransform: "uppercase", color: "var(--text-primary)", letterSpacing: "0.5px" }}>
                Cấu hình nhà cung cấp AI mới
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 600 }}>Tên nhà cung cấp (Vendor)</label>
                <input
                  className="admin-input"
                  type="text"
                  placeholder="Ví dụ: OpenRouter, Gemini, Anthropic..."
                  value={custProvider}
                  onChange={(e) => setCustProvider(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 600 }}>Tên model</label>
                <input
                  className="admin-input"
                  type="text"
                  placeholder="Ví dụ: gemini-1.5-pro, local-ollama..."
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 600 }}>Giới hạn Context (Tokens)</label>
                <input
                  className="admin-input"
                  type="text"
                  placeholder="Ví dụ: 128k, 2000k, 8k..."
                  value={custLimit}
                  onChange={(e) => setCustLimit(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 600 }}>Chuẩn hóa API (API Standard)</label>
                <select
                  value={custStandard}
                  onChange={(e) => setCustStandard(e.target.value)}
                  style={{
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-primary)",
                    color: "var(--text-primary)",
                    fontSize: "12px",
                    padding: "6px 10px",
                    height: "32px",
                    outline: "none",
                    cursor: "pointer"
                  }}
                >
                  <option value="openai">OpenAI Standard (deepseek, ollama, groq...)</option>
                  <option value="claude">Claude Standard (anthropic, bedrock...)</option>
                  <option value="gemini">Gemini Standard (Google AI Studio)</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 600 }}>Đường gọi API (API Endpoint URL)</label>
              <input
                className="admin-input"
                type="text"
                placeholder="https://api.openai.com/v1"
                value={custEndpoint}
                onChange={(e) => setCustEndpoint(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 600 }}>ApiKey của nhà sản xuất</label>
                <input
                  className="admin-input"
                  type="password"
                  placeholder="sk-... hoặc none"
                  value={custApiKey}
                  onChange={(e) => setCustApiKey(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", height: "100%", paddingTop: "14px" }}>
                <CustomCheckbox
                  checked={custVision}
                  onChange={(val) => setCustVision(val)}
                />
                <span style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: 500 }}>
                  Hỗ trợ xem ảnh (Vision capability)
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
              <button
                type="submit"
                className="admin-btn admin-btn-primary"
                style={{
                  padding: "8px 16px",
                  borderRadius: "4px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontWeight: 600
                }}
              >
                <span>✓ Lưu & Kích Hoạt</span>
              </button>
              <button
                type="button"
                className="admin-btn"
                onClick={() => setShowAddForm(false)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "4px",
                  backgroundColor: "transparent",
                  border: "1px solid var(--border-primary)",
                  color: "var(--text-secondary)"
                }}
              >
                Hủy bỏ
              </button>
            </div>
          </form>
        )}

        {/* Stored Custom Models List */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {customModels.length > 0 ? (
            customModels.map((model) => {
              const isActive = activeModels.includes(model.id);
              return (
                <div
                  key={model.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "14px 18px",
                    backgroundColor: "var(--bg-secondary)",
                    border: `1px solid ${isActive ? "var(--text-primary)" : "var(--border-primary)"}`,
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxWidth: "70%" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--text-primary)" }}>
                        {model.name}
                      </span>
                      
                      <span style={{
                        fontSize: "9px",
                        padding: "1px 5px",
                        backgroundColor: "var(--bg-tertiary)",
                        color: "var(--text-secondary)",
                        border: "1px solid var(--border-primary)",
                        fontWeight: 600
                      }}>
                        Standard: {model.apiStandard === "claude" ? "Claude" : model.apiStandard === "gemini" ? "Gemini" : "OpenAI"}
                      </span>

                      <span style={{
                        fontSize: "9px",
                        padding: "1px 5px",
                        backgroundColor: "var(--bg-tertiary)",
                        color: "var(--text-secondary)",
                        border: "1px solid var(--border-primary)",
                        fontWeight: 600
                      }}>
                        Vendor: {model.provider}
                      </span>
                      
                      <span style={{
                        fontSize: "9px",
                        padding: "1px 5px",
                        backgroundColor: "var(--bg-tertiary)",
                        color: "var(--text-secondary)",
                        border: "1px solid var(--border-primary)"
                      }}>
                        Context: {model.contextLimit}
                      </span>

                      {model.supportsVision && (
                        <span style={{
                          fontSize: "9px",
                          padding: "1px 5px",
                          backgroundColor: "var(--bg-tertiary)",
                          color: "var(--text-secondary)",
                          border: "1px solid var(--border-primary)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px"
                        }}>
                          👁️ Vision
                        </span>
                      )}
                    </div>
                    
                    <span style={{ fontSize: "11px", color: "var(--text-secondary)", wordBreak: "break-all" }}>
                      Endpoint: {model.endpoint}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <div
                      onClick={() => handleToggleModel(model.id)}
                      style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}
                    >
                      <span style={{ fontSize: "11px", color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {isActive ? "Đang bật" : "Đang tắt"}
                      </span>
                      <CustomCheckbox
                        checked={isActive}
                        onChange={() => handleToggleModel(model.id)}
                      />
                    </div>

                    <button
                      onClick={() => handleDeleteCustomModel(model.id)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--text-secondary)",
                        cursor: "pointer",
                        fontSize: "11px",
                        padding: "4px"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-primary)"}
                      onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "30px 20px",
              backgroundColor: "rgba(255, 255, 255, 0.01)",
              border: "1px dashed var(--border-primary)",
              borderRadius: "4px",
              textAlign: "center",
              gap: "8px"
            }}>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                Chưa có mô hình tùy chỉnh nào được nhập.
              </span>
              <button
                onClick={() => setShowAddForm(true)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  textDecoration: "underline"
                }}
              >
                Nhấp để thêm ngay
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ height: "1px", backgroundColor: "var(--border-primary)", margin: "8px 0" }} />

      {/* ── PART 1: ALOUETTE AGENT PREDEFINED MODELS ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div>
          <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "4px" }}>
            Alouette Agent Default Models
          </h3>
          <p style={{ fontSize: "11.5px", color: "var(--text-secondary)" }}>
            Các nhà cung cấp AI kết nối trực tiếp qua Alouette Server trung tâm. Không cần cấu hình API Key cá nhân.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px" }}>
          {PREDEFINED_MODELS.map((model) => {
            const providerModels = model.models.map(m => m.id);
            const activeProviderModels = providerModels.filter(id => activeModels.includes(id));
            const isProviderActive = activeProviderModels.length > 0;
            const isExpanded = expandedProviders.includes(model.id);

            return (
              <div key={model.id} style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                {/* Provider Row */}
                <div
                  onClick={(e) => handleToggleProvider(model.id, e)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "14px 18px",
                    backgroundColor: "var(--bg-secondary)",
                    border: `1px solid ${isProviderActive ? "var(--text-primary)" : "var(--border-primary)"}`,
                    cursor: "pointer",
                    transition: "all var(--transition-fast)"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "14px", maxWidth: "80%" }}>
                    {/* Expand/Collapse Trigger */}
                    <div 
                      onClick={(e) => toggleExpandProvider(model.id, e)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "24px",
                        height: "24px",
                        cursor: "pointer",
                        color: "var(--text-secondary)",
                        borderRadius: "4px",
                        backgroundColor: "var(--bg-tertiary)",
                        border: "1px solid var(--border-primary)",
                        transition: "all var(--transition-fast)"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-primary)"}
                      onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                      <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
                        {model.provider}
                      </span>
                      <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                        {activeProviderModels.length}/{model.models.length} model đang bật
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }} onClick={(e) => e.stopPropagation()}>
                    <span style={{ fontSize: "11.5px", color: isProviderActive ? "var(--text-primary)" : "var(--text-secondary)" }}>
                      {isProviderActive ? "Đang bật" : "Đã tắt"}
                    </span>
                    <CustomCheckbox
                      checked={isProviderActive}
                      onChange={() => {
                        const eventMock = { stopPropagation: () => {} } as React.MouseEvent;
                        handleToggleProvider(model.id, eventMock);
                      }}
                    />
                  </div>
                </div>

                {/* Sub-models list (Expanded) */}
                {isExpanded && (
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    padding: "12px 18px 16px 56px",
                    backgroundColor: "rgba(255, 255, 255, 0.01)",
                    borderLeft: "2px solid var(--border-primary)",
                    borderRight: "1px solid var(--border-primary)",
                    borderBottom: "1px solid var(--border-primary)",
                    marginTop: "-1px",
                    marginBottom: "8px",
                    transition: "all var(--transition-fast)"
                  }}>
                    {model.models.map((subModel) => {
                      const isSubModelActive = activeModels.includes(subModel.id);
                      return (
                        <div 
                          key={subModel.id}
                          onClick={(e) => handleToggleModel(subModel.id, e)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "14px",
                            padding: "10px 14px",
                            backgroundColor: "var(--bg-tertiary)",
                            border: `1px solid ${isSubModelActive ? "var(--text-primary)" : "var(--border-primary)"}`,
                            cursor: "pointer",
                            transition: "all var(--transition-fast)"
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxWidth: "80%" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                              <span style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--text-primary)" }}>
                                {subModel.name}
                              </span>
                              <span style={{
                                fontSize: "9px",
                                padding: "1px 5px",
                                backgroundColor: "var(--bg-secondary)",
                                color: "var(--text-secondary)",
                                border: "1px solid var(--border-primary)",
                                fontWeight: 600
                              }}>
                                Vendor: {model.provider}
                              </span>
                              <span style={{
                                fontSize: "9px",
                                padding: "1px 5px",
                                backgroundColor: "var(--bg-secondary)",
                                color: "var(--text-secondary)",
                                border: "1px solid var(--border-primary)"
                              }}>
                                Context: {subModel.context}
                              </span>
                            </div>
                            <p style={{ fontSize: "11px", color: "var(--text-secondary)", margin: 0, lineHeight: "1.4" }}>
                              {subModel.desc}
                            </p>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "12px" }} onClick={(e) => e.stopPropagation()}>
                            <span style={{ fontSize: "11.5px", color: isSubModelActive ? "var(--text-primary)" : "var(--text-secondary)" }}>
                              {isSubModelActive ? "Đang bật" : "Đã tắt"}
                            </span>
                            <CustomCheckbox
                              checked={isSubModelActive}
                              onChange={() => {
                                const eventMock = { stopPropagation: () => {} } as React.MouseEvent;
                                handleToggleModel(subModel.id, eventMock);
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await invoke<AppSettings>("get_settings");
        setSettings(s);
      } catch {}
    })();
  }, []);

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSave() {
    if (!settings) return;
    try {
      await invoke("save_settings", { settings });
    } catch (e) {
      console.error("Save failed:", e);
    }
  }

  return (
    <div className="admin-panel animate-fade-in">
      <h2 className="admin-panel-title">Build</h2>
      <p className="admin-panel-desc">Configure compile pipeline, compression, and platform-specific build tooling.</p>

      {settings && (
        <>
          <div className="admin-card-grid">
            {/* ── Desktop ── */}
            <div className="admin-card">
              <div className="admin-card-header" style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid var(--border-primary)", paddingBottom: "10px", marginBottom: "14px" }}>
                <Monitor size={15} style={{ color: "var(--color-accent)" }} />
                <span style={{ fontWeight: 600, letterSpacing: "0.5px" }}>Desktop Build</span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    <CustomCheckbox
                      checked={settings.desktop_single_exe}
                      onChange={(val) => update("desktop_single_exe", val)}
                    />
                    <span
                      style={{
                        fontSize: "13px",
                        color: "var(--text-primary)",
                        fontWeight: 500,
                      }}
                    >
                      Single Executable
                    </span>
                  </div>
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)", paddingLeft: "26px", lineHeight: "1.4" }}>
                    Compile and package all resources into a single standalone binary.
                  </span>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    <CustomCheckbox
                      checked={settings.desktop_upx}
                      onChange={(val) => update("desktop_upx", val)}
                    />
                    <span
                      style={{
                        fontSize: "13px",
                        color: "var(--text-primary)",
                        fontWeight: 500,
                      }}
                    >
                      UPX Compression
                    </span>
                  </div>
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)", paddingLeft: "26px", lineHeight: "1.4" }}>
                    Compress the executable payload (default active) to minimize file size.
                  </span>
                </div>
              </div>
            </div>

            {/* ── Android ── */}
            <div className="admin-card">
              <div className="admin-card-header" style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid var(--border-primary)", paddingBottom: "10px", marginBottom: "14px" }}>
                <Smartphone size={15} style={{ color: "var(--color-accent)" }} />
                <span style={{ fontWeight: 600, letterSpacing: "0.5px" }}>Android Build</span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    Build Toolchain
                  </span>
                  <select
                    className="admin-select"
                    style={{ width: "100%" }}
                    value={settings.android_build_tool}
                    onChange={(e) =>
                      update("android_build_tool", e.target.value)
                    }
                  >
                    <option value="Gradle">Gradle (bin)</option>
                    <option value="Bazel">Bazel</option>
                  </select>
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "4px" }}>
                    Select build system to compile, run tests, and package Android binaries.
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="admin-actions-bar" style={{ marginTop: 24 }}>
            <button
              className="admin-btn admin-btn-primary"
              onClick={handleSave}
              style={{ padding: "8px 18px", display: "flex", alignItems: "center", gap: "8px" }}
            >
              <Save size={14} />
              <span>Save Build Settings</span>
            </button>
          </div>
        </>
      )}
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
    blockInternet: boolean;
    skillAgentEnabled: boolean;

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

    // ── Setup tab ──
    memoryLimit: string;
    timeout: string;
    cpuLimit: string;
    maxFileSize: string;
  }

  const DEFAULT_CONFIG: ProjectSandboxConfig = {
    termBuffer: "1000",
    blockSystemCommands: true,
    allowPipeOperators: false,
    blockInternet: false,
    skillAgentEnabled: false,

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

    memoryLimit: "512MB",
    timeout: "30s",
    cpuLimit: "1.0 Core",
    maxFileSize: "50MB",
  };

  const [projectConfigs, setProjectConfigs] = useState<{
    [id: string]: ProjectSandboxConfig;
  }>({});

  // Refs for debounced auto-save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{ [id: string]: ProjectSandboxConfig }>({});

  // Helper: convert Rust snake_case SandboxConfig -> TS camelCase ProjectSandboxConfig
  function fromRustConfig(rc: any): ProjectSandboxConfig {
    return {
      termBuffer: rc.term_buffer ?? "1000",
      blockSystemCommands: rc.block_system_commands ?? true,
      allowPipeOperators: rc.allow_pipe_operators ?? false,
      blockInternet: rc.block_internet ?? false,
      skillAgentEnabled: rc.skill_agent_enabled ?? false,
      cookieIsolation: rc.cookie_isolation ?? true,
      isolateWebview: rc.isolate_webview ?? true,
      bypassCors: rc.bypass_cors ?? false,
      browserMode: rc.browser_mode ?? "Isolated",
      semanticEnabled: rc.semantic_enabled ?? true,
      riskLevel: rc.risk_level ?? "Medium",
      strictBoundary: rc.strict_boundary ?? true,
      psParsing: rc.ps_parsing ?? true,
      homoglyphNorm: rc.homoglyph_norm ?? true,
      blockIex: rc.block_iex ?? true,
      memoryLimit: rc.memory_limit ?? "512MB",
      timeout: rc.timeout ?? "30s",
      cpuLimit: rc.cpu_limit ?? "1.0 Core",
      maxFileSize: rc.max_file_size ?? "50MB",
    };
  }

  // Helper: convert TS camelCase ProjectSandboxConfig -> Rust snake_case
  function toRustConfig(projectId: string, cfg: ProjectSandboxConfig): any {
    return {
      project_id: projectId,
      term_buffer: cfg.termBuffer,
      block_system_commands: cfg.blockSystemCommands,
      allow_pipe_operators: cfg.allowPipeOperators,
      block_internet: cfg.blockInternet,
      skill_agent_enabled: cfg.skillAgentEnabled,
      cookie_isolation: cfg.cookieIsolation,
      isolate_webview: cfg.isolateWebview,
      bypass_cors: cfg.bypassCors,
      browser_mode: cfg.browserMode,
      semantic_enabled: cfg.semanticEnabled,
      risk_level: cfg.riskLevel,
      strict_boundary: cfg.strictBoundary,
      ps_parsing: cfg.psParsing,
      homoglyph_norm: cfg.homoglyphNorm,
      block_iex: cfg.blockIex,
      memory_limit: cfg.memoryLimit,
      timeout: cfg.timeout,
      cpu_limit: cfg.cpuLimit,
      max_file_size: cfg.maxFileSize,
    };
  }

  // Debounced save to backend
  function scheduleSave(projectId: string, cfg: ProjectSandboxConfig) {
    pendingSaveRef.current[projectId] = cfg;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const batch = { ...pendingSaveRef.current };
      pendingSaveRef.current = {};
      const configs = Object.entries(batch).map(([id, c]) =>
        toRustConfig(id, c),
      );
      try {
        await invoke("save_all_sandbox_configs", { configs });
      } catch (e) {
        console.error("Failed to save sandbox configs:", e);
      }
    }, 500);
  }

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
          type: p.toolchain
            ? `${p.toolchain}`
            : p.command
              ? `Cmd: ${p.command}`
              : "Custom",
          status: "Sandboxed",
          active: false, // by default, all inherit global default config
        }));
        setProjectsList(formatted);

        // Initialize default configs including __global_default__
        const initialConfigs: { [id: string]: ProjectSandboxConfig } = {
          __global_default__: { ...DEFAULT_CONFIG },
        };
        formatted.forEach((p) => {
          initialConfigs[p.id] = { ...DEFAULT_CONFIG };
        });

        // Load sandbox configs from backend and merge over defaults
        try {
          const savedConfigs: { [id: string]: any } = await invoke(
            "load_sandbox_configs",
          );
          for (const [projId, rc] of Object.entries(savedConfigs)) {
            initialConfigs[projId] = fromRustConfig(rc);
          }
        } catch (e) {
          console.warn("Failed to load sandbox configs, using defaults:", e);
        }

        setProjectConfigs(initialConfigs);
        setSelectedProjectId("__global_default__");
      } catch (e) {
        console.error("Failed to load real projects in Sandbox:", e);
      }
    })();
  }, []);

  const filteredProjectsList = projectsList.filter(
    (p) =>
      p.name.toLowerCase().includes(searchProject.toLowerCase()) ||
      p.type.toLowerCase().includes(searchProject.toLowerCase()),
  );

  // Helper getters/setters for currently selected project configuration
  const isInheriting =
    selectedProjectId !== "__global_default__" &&
    !projectsList.find((p) => p.id === selectedProjectId)?.active;

  const currentConfig = isInheriting
    ? projectConfigs["__global_default__"] || DEFAULT_CONFIG
    : projectConfigs[selectedProjectId] || DEFAULT_CONFIG;

  const updateCurrentConfig = <K extends keyof ProjectSandboxConfig>(
    key: K,
    value: ProjectSandboxConfig[K],
  ) => {
    if (!selectedProjectId) return;

    // If real project is inheriting, breaking inheritance on edit and clone default settings
    if (selectedProjectId !== "__global_default__" && isInheriting) {
      const merged = {
        ...(projectConfigs["__global_default__"] || DEFAULT_CONFIG),
        [key]: value,
      };
      setProjectsList((prev) =>
        prev.map((p) =>
          p.id === selectedProjectId ? { ...p, active: true } : p,
        ),
      );
      setProjectConfigs((prev) => ({
        ...prev,
        [selectedProjectId]: merged,
      }));
      scheduleSave(selectedProjectId, merged);
    } else {
      const merged = {
        ...(projectConfigs[selectedProjectId] || DEFAULT_CONFIG),
        [key]: value,
      };
      setProjectConfigs((prev) => ({
        ...prev,
        [selectedProjectId]: merged,
      }));
      scheduleSave(selectedProjectId, merged);
    }
  };



  return (
    <div
      className="admin-panel"
      style={{
        display: "flex",
        height: "100%",
        width: "100%",
        maxWidth: "none",
        padding: 0,
        margin: 0,
        overflow: "hidden",
      }}
    >
      {/* ── LEFT CONTAINER: Part 5 (Tabs) & Part 2 (Setup Area) ── */}
      <div
        style={{
          flex: "7 7 0%",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          padding: "20px",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <div>
            <h2 className="admin-panel-title">Sandbox Controller</h2>
            <p className="admin-panel-desc" style={{ margin: 0 }}>
              Configuring project:{" "}
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                {projectsList.find((p) => p.id === selectedProjectId)?.name ||
                  "None Selected"}
              </span>
            </p>
          </div>
          {selectedProjectId && (
            <span
              style={{
                fontSize: "11px",
                padding: "4px 8px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid var(--border-primary)",
                borderRadius: "4px",
                opacity: 0.8,
              }}
            >
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
            paddingBottom: "4px",
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
                color:
                  activeSubTab === tab
                    ? "var(--text-primary)"
                    : "var(--text-muted, #71717a)",
                fontWeight: activeSubTab === tab ? "600" : "400",
                cursor: "pointer",
                padding: "8px 16px",
                borderRadius: "4px",
                fontSize: "13px",
                textTransform: "capitalize",
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* ── Part 2: Setup Details ── */}
        <div style={{ flex: 1 }}>
          {!selectedProjectId ? (
            <div
              style={{
                display: "flex",
                height: "60%",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
                fontSize: "13px",
              }}
            >
              Vui lòng chọn một dự án ở danh sách bên phải để thiết lập cấu
              hình.
            </div>
          ) : (
            <>
              {activeSubTab === "terminal" && (
                <div className="admin-card-grid">
                  <div className="admin-card">
                    <div className="admin-card-header">
                      Terminal Command Interceptor
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        marginTop: "8px",
                      }}
                    >
                      <CustomCheckbox
                        checked={currentConfig.blockSystemCommands}
                        onChange={(val) =>
                          updateCurrentConfig("blockSystemCommands", val)
                        }
                      />
                      <span
                        style={{
                          fontSize: "13px",
                          color: "var(--text-primary)",
                        }}
                      >
                        Block System Execution Hooks
                      </span>
                    </div>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">
                      Pipelining & Operators
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        marginTop: "8px",
                      }}
                    >
                      <CustomCheckbox
                        checked={currentConfig.allowPipeOperators}
                        onChange={(val) =>
                          updateCurrentConfig("allowPipeOperators", val)
                        }
                      />
                      <span
                        style={{
                          fontSize: "13px",
                          color: "var(--text-primary)",
                        }}
                      >
                        Allow Chained Commands (|, &&, ||)
                      </span>
                    </div>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">
                      Buffer Limit (Lines)
                    </div>
                    <input
                      className="admin-input"
                      type="number"
                      value={currentConfig.termBuffer}
                      onChange={(e) =>
                        updateCurrentConfig("termBuffer", e.target.value)
                      }
                    />
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Internet Isolation</div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        marginTop: "8px",
                      }}
                    >
                      <CustomCheckbox
                        checked={currentConfig.blockInternet}
                        onChange={(val) =>
                          updateCurrentConfig("blockInternet", val)
                        }
                      />
                      <span
                        style={{
                          fontSize: "13px",
                          color: "var(--text-primary)",
                        }}
                      >
                        Block all network access
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                        marginTop: "6px",
                      }}
                    >
                      Ngắt hoàn toàn kết nối mạng cho terminal này (áp dụng khi
                      khởi tạo lại)
                    </p>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Skill Agent</div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        marginTop: "8px",
                      }}
                    >
                      <CustomCheckbox
                        checked={currentConfig.skillAgentEnabled}
                        onChange={(val) =>
                          updateCurrentConfig("skillAgentEnabled", val)
                        }
                      />
                      <span
                        style={{
                          fontSize: "13px",
                          color: "var(--text-primary)",
                        }}
                      >
                        Enable Terminal Skill Agent
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                        marginTop: "6px",
                      }}
                    >
                      AI agent hỗ trợ gợi ý lệnh và tự động hóa trong terminal
                      (coming soon)
                    </p>
                  </div>
                </div>
              )}

              {activeSubTab === "browser" && (
                <div className="admin-card-grid">
                  <div className="admin-card">
                    <div className="admin-card-header">Cookie Isolation</div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        marginTop: "8px",
                      }}
                    >
                      <CustomCheckbox
                        checked={currentConfig.cookieIsolation}
                        onChange={(val) =>
                          updateCurrentConfig("cookieIsolation", val)
                        }
                      />
                      <span
                        style={{
                          fontSize: "13px",
                          color: "var(--text-primary)",
                        }}
                      >
                        Strict Cookie & Session Separation
                      </span>
                    </div>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">
                      Webview Process Isolation
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        marginTop: "8px",
                      }}
                    >
                      <CustomCheckbox
                        checked={currentConfig.isolateWebview}
                        onChange={(val) =>
                          updateCurrentConfig("isolateWebview", val)
                        }
                      />
                      <span
                        style={{
                          fontSize: "13px",
                          color: "var(--text-primary)",
                        }}
                      >
                        Run Webviews in separate processes
                      </span>
                    </div>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">CORS Bypass Mode</div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        marginTop: "8px",
                      }}
                    >
                      <CustomCheckbox
                        checked={currentConfig.bypassCors}
                        onChange={(val) =>
                          updateCurrentConfig("bypassCors", val)
                        }
                      />
                      <span
                        style={{
                          fontSize: "13px",
                          color: "var(--text-primary)",
                        }}
                      >
                        Enable CORS Bypass for testing
                      </span>
                    </div>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Zen Browser Mode</div>
                    <select
                      className="admin-select"
                      value={currentConfig.browserMode}
                      onChange={(e) =>
                        updateCurrentConfig("browserMode", e.target.value)
                      }
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
                    <div
                      className="admin-card-header"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span>Tier 1 Semantic Interceptor</span>
                      <CustomCheckbox
                        checked={currentConfig.semanticEnabled}
                        onChange={(val) =>
                          updateCurrentConfig("semanticEnabled", val)
                        }
                      />
                    </div>
                    <p
                      style={{
                        fontSize: "12px",
                        color: "var(--text-secondary)",
                        marginTop: "4px",
                      }}
                    >
                      Analyses command semantics (~, $env, homoglyphs) to
                      intercept system breaches.
                    </p>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">
                      Risk Threshold Level
                    </div>
                    <select
                      className="admin-select"
                      value={currentConfig.riskLevel}
                      disabled={!currentConfig.semanticEnabled}
                      onChange={(e) =>
                        updateCurrentConfig("riskLevel", e.target.value)
                      }
                    >
                      <option value="Low">Low (Permissive)</option>
                      <option value="Medium">Medium (Balanced)</option>
                      <option value="High">High (Strict)</option>
                      <option value="Extreme">Extreme (Paranoid)</option>
                    </select>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Boundary Control</div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        marginTop: "8px",
                      }}
                    >
                      <CustomCheckbox
                        checked={currentConfig.strictBoundary}
                        disabled={!currentConfig.semanticEnabled}
                        onChange={(val) =>
                          updateCurrentConfig("strictBoundary", val)
                        }
                      />
                      <span
                        style={{
                          fontSize: "13px",
                          color: "var(--text-primary)",
                          opacity: !currentConfig.semanticEnabled ? 0.5 : 1,
                        }}
                      >
                        Prevent workspace escapes
                      </span>
                    </div>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">
                      Path Enforcement Details
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        marginTop: "8px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <CustomCheckbox
                          checked={currentConfig.psParsing}
                          disabled={!currentConfig.semanticEnabled}
                          onChange={(val) =>
                            updateCurrentConfig("psParsing", val)
                          }
                        />
                        <span
                          style={{
                            fontSize: "13px",
                            color: "var(--text-primary)",
                            opacity: !currentConfig.semanticEnabled ? 0.5 : 1,
                          }}
                        >
                          Parse PowerShell $subexpressions
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <CustomCheckbox
                          checked={currentConfig.homoglyphNorm}
                          disabled={!currentConfig.semanticEnabled}
                          onChange={(val) =>
                            updateCurrentConfig("homoglyphNorm", val)
                          }
                        />
                        <span
                          style={{
                            fontSize: "13px",
                            color: "var(--text-primary)",
                            opacity: !currentConfig.semanticEnabled ? 0.5 : 1,
                          }}
                        >
                          Normalize Unicode homoglyphs
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">
                      Danger Blocking Policies
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        marginTop: "8px",
                      }}
                    >
                      <CustomCheckbox
                        checked={currentConfig.blockIex}
                        disabled={!currentConfig.semanticEnabled}
                        onChange={(val) => updateCurrentConfig("blockIex", val)}
                      />
                      <span
                        style={{
                          fontSize: "13px",
                          color: "var(--text-primary)",
                          opacity: !currentConfig.semanticEnabled ? 0.5 : 1,
                        }}
                      >
                        Block iex & Invoke-Expression
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === "setup" && (
                <div className="admin-card-grid">
                  <div className="admin-card">
                    <div className="admin-card-header">Memory Limit</div>
                    <select
                      className="admin-select"
                      value={currentConfig.memoryLimit}
                      onChange={(e) =>
                        updateCurrentConfig("memoryLimit", e.target.value)
                      }
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
                      onChange={(e) =>
                        updateCurrentConfig("cpuLimit", e.target.value)
                      }
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
                      onChange={(e) =>
                        updateCurrentConfig("timeout", e.target.value)
                      }
                    />
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-header">Max Write File Size</div>
                    <select
                      className="admin-select"
                      value={currentConfig.maxFileSize}
                      onChange={(e) =>
                        updateCurrentConfig("maxFileSize", e.target.value)
                      }
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
          background: "var(--bg-admin-sidebar, rgba(15, 23, 42, 0.25))",
        }}
      >
        {/* ── Part 1: Global Default Settings Profile Selector (Tab All) ── */}
        <div
          onClick={() => setSelectedProjectId("__global_default__")}
          style={{
            padding: "16px",
            borderBottom: "1px solid var(--border-primary)",
            background:
              selectedProjectId === "__global_default__"
                ? "rgba(255, 255, 255, 0.08)"
                : "rgba(255, 255, 255, 0.02)",
            border:
              selectedProjectId === "__global_default__"
                ? "1px solid var(--text-primary)"
                : "none",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "4px",
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: "13px",
                color: "var(--text-primary)",
              }}
            >
              Tab All (Cấu hình mặc định)
            </span>
            <span
              style={{
                fontSize: "10px",
                padding: "2px 6px",
                background: "rgba(255,255,255,0.05)",
                borderRadius: "3px",
                color: "var(--text-secondary)",
              }}
            >
              Template
            </span>
          </div>
          <p
            style={{
              fontSize: "11px",
              color: "var(--text-secondary)",
              margin: 0,
            }}
          >
            Mẫu cấu hình cơ sở áp dụng cho các dự án mới hoặc dự án kế thừa.
          </p>
        </div>

        {/* ── Part 3: Search Bar ── */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-primary)",
          }}
        >
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
            }}
          >
            <input
              className="admin-input"
              style={{ paddingLeft: "32px", fontSize: "12px", width: "100%" }}
              placeholder="Tìm kiếm dự án..."
              value={searchProject}
              onChange={(e) => setSearchProject(e.target.value)}
            />
            <span
              style={{
                position: "absolute",
                left: "10px",
                opacity: 0.5,
                pointerEvents: "none",
                display: "flex",
                alignItems: "center",
              }}
            >
              <Search size={14} style={{ color: "var(--text-primary)" }} />
            </span>
          </div>
        </div>

        {/* ── Part 4: Imported Projects ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                fontWeight: 600,
                color: "var(--text-secondary)",
              }}
            >
              Dự án được import ({filteredProjectsList.length})
            </span>
          </div>

          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            {filteredProjectsList.map((proj) => {
              const isSelected = proj.id === selectedProjectId;
              return (
                <div
                  key={proj.id}
                  onClick={() => setSelectedProjectId(proj.id)}
                  style={{
                    padding: "10px",
                    borderRadius: "6px",
                    border: isSelected
                      ? "1px solid var(--text-primary)"
                      : "1px solid var(--border-primary)",
                    background: isSelected
                      ? "rgba(255, 255, 255, 0.08)"
                      : proj.active
                        ? "rgba(255, 255, 255, 0.04)"
                        : "rgba(255,255,255,0.01)",
                    opacity: isSelected || proj.active ? 1 : 0.6,
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: "12px",
                        color: "var(--text-primary)",
                      }}
                    >
                      {proj.name}
                    </span>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "9px",
                          color: "var(--text-secondary)",
                        }}
                      >
                        Cấu hình riêng
                      </span>
                      <CustomCheckbox
                        checked={proj.active}
                        onChange={(val) => {
                          setProjectsList((prev) =>
                            prev.map((p) =>
                              p.id === proj.id ? { ...p, active: val } : p,
                            ),
                          );
                        }}
                      />
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "10px",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <span>{proj.type}</span>
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        fontSize: "9px",
                        padding: "1px 4px",
                        background: "rgba(255,255,255,0.05)",
                        borderRadius: "2px",
                      }}
                    >
                      {proj.active
                        ? "Tùy chỉnh (Custom)"
                        : "Mặc định (Inherited)"}
                    </span>
                  </div>
                </div>
              );
            })}

            {filteredProjectsList.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "20px",
                  color: "var(--text-secondary)",
                  fontSize: "12px",
                }}
              >
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
  const [runtimes, setRuntimes] = useState<LanguageRuntime[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editForm, setEditForm] = useState<LanguageRuntime>({
    id: "",
    name: "",
    install_command: "",
    versions: [],
    tools: [],
  });

  useEffect(() => {
    loadRuntimes();
  }, []);

  async function loadRuntimes() {
    try {
      const list = await invoke<LanguageRuntime[]>("get_language_runtimes");
      setRuntimes(list);
    } catch (e) {
      console.error("Failed to load language runtimes:", e);
    }
  }

  function handleSelect(id: string) {
    setIsAdding(false);
    setSelectedId(id);
    const rt = runtimes.find((r) => r.id === id);
    if (rt) setEditForm({ ...rt });
  }

  function handleNew() {
    setSelectedId(null);
    setIsAdding(true);
    setEditForm({
      id: "",
      name: "",
      install_command: "",
      versions: [],
      tools: [],
    });
  }

  async function handleSave() {
    if (!editForm.name.trim()) return;
    const toSave = {
      ...editForm,
      id: editForm.id || editForm.name.toLowerCase().replace(/\s+/g, "-"),
    };
    try {
      await invoke("save_language_runtime", { runtime: toSave });
      setIsAdding(false);
      setSelectedId(toSave.id);
      await loadRuntimes();
    } catch (e) {
      console.error("Failed to save:", e);
    }
  }

  async function handleDelete(id: string) {
    try {
      await invoke("delete_language_runtime", { runtimeId: id });
      if (selectedId === id) {
        setSelectedId(null);
        setIsAdding(false);
      }
      await loadRuntimes();
    } catch (e) {
      console.error("Failed to delete:", e);
    }
  }

  function addVersion() {
    setEditForm((prev) => ({
      ...prev,
      versions: [...prev.versions, ""],
    }));
  }

  function updateVersion(idx: number, val: string) {
    setEditForm((prev) => {
      const v = [...prev.versions];
      v[idx] = val;
      return { ...prev, versions: v };
    });
  }

  function removeVersion(idx: number) {
    setEditForm((prev) => ({
      ...prev,
      versions: prev.versions.filter((_, i) => i !== idx),
    }));
  }

  function addTool() {
    setEditForm((prev) => ({
      ...prev,
      tools: [...prev.tools, { name: "", command: "", version: "" }],
    }));
  }

  function updateTool(idx: number, field: keyof LanguageTool, val: string) {
    setEditForm((prev) => {
      const t = [...prev.tools];
      t[idx] = { ...t[idx], [field]: val };
      return { ...prev, tools: t };
    });
  }

  function removeTool(idx: number) {
    setEditForm((prev) => ({
      ...prev,
      tools: prev.tools.filter((_, i) => i !== idx),
    }));
  }

  const selectedRuntime = runtimes.find((r) => r.id === selectedId);

  return (
    <div
      className="admin-panel"
      style={{
        display: "flex",
        height: "100%",
        width: "100%",
        maxWidth: "none",
        padding: 0,
        margin: 0,
        overflow: "hidden",
      }}
    >
      {/* ── LEFT: Language List ── */}
      <div
        style={{
          flex: "5 5 0%",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          padding: "20px",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <div>
            <h2 className="admin-panel-title">Programming Languages</h2>
            <p className="admin-panel-desc" style={{ margin: 0 }}>
              Manage language runtimes, versions, and tools
            </p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <button
            className="admin-btn admin-btn-primary"
            onClick={handleNew}
            style={{
              alignSelf: "flex-start",
              marginBottom: "8px",
              fontSize: "12px",
            }}
          >
            + Add Language
          </button>

          {runtimes.length === 0 && !isAdding && (
            <div
              style={{
                textAlign: "center",
                padding: "40px",
                color: "var(--text-secondary)",
                fontSize: "13px",
              }}
            >
              No languages configured. Click "+ Add Language" to get started.
            </div>
          )}

          {runtimes.map((rt) => (
            <div
              key={rt.id}
              onClick={() => handleSelect(rt.id)}
              style={{
                padding: "12px 14px",
                borderRadius: "6px",
                border:
                  selectedId === rt.id
                    ? "1px solid var(--text-primary)"
                    : "1px solid var(--border-primary)",
                background:
                  selectedId === rt.id
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(255,255,255,0.02)",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "14px",
                    color: "var(--text-primary)",
                    marginBottom: "4px",
                  }}
                >
                  {rt.name}
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--text-secondary)",
                    display: "flex",
                    gap: "12px",
                  }}
                >
                  <span>{rt.versions.length} version(s)</span>
                  <span>{rt.tools.length} tool(s)</span>
                  <span
                    style={{ fontFamily: "var(--font-mono)", fontSize: "10px" }}
                  >
                    {rt.install_command}
                  </span>
                </div>
              </div>
              <button
                className="admin-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(rt.id);
                }}
                style={{
                  background: "none",
                  border: "1px solid rgba(255,80,80,0.3)",
                  color: "rgba(255,120,120,0.8)",
                  fontSize: "11px",
                  padding: "4px 10px",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── RIGHT: Detail Dock ── */}
      {(selectedRuntime || isAdding) && (
        <div
          style={{
            flex: "7 7 0%",
            display: "flex",
            flexDirection: "column",
            height: "100%",
            padding: "20px",
            borderLeft: "1px solid var(--border-primary)",
            background: "var(--bg-admin-sidebar, rgba(15,23,42,0.25))",
            overflowY: "auto",
          }}
        >
          <h3
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: "var(--text-primary)",
              marginBottom: "16px",
            }}
          >
            {isAdding ? "Add Language" : `Edit: ${editForm.name}`}
          </h3>

          <div className="admin-card-grid">
            {/* Name */}
            <div className="admin-card">
              <div className="admin-card-header">Language Name</div>
              <input
                className="admin-input"
                type="text"
                placeholder="e.g. Node.js"
                value={editForm.name}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>

            {/* Install Command */}
            <div className="admin-card">
              <div className="admin-card-header">Install Command</div>
              <input
                className="admin-input"
                type="text"
                placeholder="e.g. proto install node"
                value={editForm.install_command}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    install_command: e.target.value,
                  }))
                }
                style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
              />
            </div>

            {/* Versions */}
            <div className="admin-card" style={{ gridColumn: "span 2" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <div className="admin-card-header" style={{ margin: 0 }}>
                  Versions
                </div>
                <button
                  className="admin-btn"
                  onClick={addVersion}
                  style={{
                    fontSize: "11px",
                    padding: "4px 10px",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid var(--border-primary)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    color: "var(--text-primary)",
                  }}
                >
                  + Add Version
                </button>
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
              >
                {editForm.versions.length === 0 && (
                  <span
                    style={{ fontSize: "12px", color: "var(--text-secondary)" }}
                  >
                    No versions yet
                  </span>
                )}
                {editForm.versions.map((v, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <input
                      className="admin-input"
                      type="text"
                      placeholder="e.g. 20.11.0"
                      value={v}
                      onChange={(e) => updateVersion(i, e.target.value)}
                      style={{
                        flex: 1,
                        fontFamily: "var(--font-mono)",
                        fontSize: "12px",
                      }}
                    />
                    <button
                      onClick={() => removeVersion(i)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "rgba(255,80,80,0.7)",
                        cursor: "pointer",
                        fontSize: "14px",
                        padding: "2px 6px",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Tools */}
            <div className="admin-card" style={{ gridColumn: "span 2" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <div className="admin-card-header" style={{ margin: 0 }}>
                  Tools / Package Managers
                </div>
                <button
                  className="admin-btn"
                  onClick={addTool}
                  style={{
                    fontSize: "11px",
                    padding: "4px 10px",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid var(--border-primary)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    color: "var(--text-primary)",
                  }}
                >
                  + Add Tool
                </button>
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              >
                {editForm.tools.length === 0 && (
                  <span
                    style={{ fontSize: "12px", color: "var(--text-secondary)" }}
                  >
                    No tools configured
                  </span>
                )}
                {editForm.tools.map((tool, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "10px",
                      border: "1px solid var(--border-primary)",
                      borderRadius: "6px",
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: "6px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "11px",
                          color: "var(--text-secondary)",
                          fontWeight: 600,
                        }}
                      >
                        Tool #{i + 1}
                      </span>
                      <button
                        onClick={() => removeTool(i)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "rgba(255,80,80,0.7)",
                          cursor: "pointer",
                          fontSize: "12px",
                        }}
                      >
                        ✕ Remove
                      </button>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr",
                        gap: "6px",
                      }}
                    >
                      <input
                        className="admin-input"
                        type="text"
                        placeholder="Tool name"
                        value={tool.name}
                        onChange={(e) => updateTool(i, "name", e.target.value)}
                        style={{ fontSize: "12px" }}
                      />
                      <input
                        className="admin-input"
                        type="text"
                        placeholder="Install command"
                        value={tool.command}
                        onChange={(e) =>
                          updateTool(i, "command", e.target.value)
                        }
                        style={{
                          fontSize: "12px",
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                      <input
                        className="admin-input"
                        type="text"
                        placeholder="Version"
                        value={tool.version}
                        onChange={(e) =>
                          updateTool(i, "version", e.target.value)
                        }
                        style={{
                          fontSize: "12px",
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Save / Cancel */}
          <div
            className="admin-actions-bar"
            style={{ marginTop: "16px", display: "flex", gap: "8px" }}
          >
            <button
              className="admin-btn admin-btn-secondary"
              onClick={() => {
                setIsAdding(false);
                if (selectedId) {
                  const rt = runtimes.find((r) => r.id === selectedId);
                  if (rt) setEditForm({ ...rt });
                }
              }}
              style={{ fontSize: "12px" }}
            >
              Cancel
            </button>
            <button
              className="admin-btn admin-btn-primary"
              onClick={handleSave}
              style={{ fontSize: "12px" }}
            >
              <Save size={13} />
              <span>Save Language</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface LanguageRuntime {
  id: string;
  name: string;
  install_command: string;
  versions: string[];
  tools: LanguageTool[];
}

interface LanguageTool {
  name: string;
  command: string;
  version: string;
}
