import { useState, useEffect } from "react";
import { Cloud, Save, Wifi, AlertTriangle, HelpCircle, CheckCircle2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

const CONFIG_PATH = "d:/alouette-server/core_engine/app_data/cloudflare_config.yml";

// Helper to convert plain string to base64
const stringToBase64 = (str: string): string => {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};

// Helper to parse YAML manually for our simplified model
const parseYaml = (yamlStr: string) => {
  const config = {
    mode: "default",
    tunnel_token: ""
  };
  const lines = yamlStr.split("\n");

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("mode:")) {
      config.mode = trimmed.replace("mode:", "").replace(/["']/g, "").trim();
    } else if (trimmed.startsWith("tunnel_token:")) {
      config.tunnel_token = trimmed.replace("tunnel_token:", "").replace(/["']/g, "").trim();
    } else if (trimmed.startsWith("api_key:")) {
      // Backwards compatibility fallback
      config.tunnel_token = trimmed.replace("api_key:", "").replace(/["']/g, "").trim();
    }
  }
  return config;
};

// Helper to stringify config to YAML
const toYaml = (mode: string, tunnelToken: string) => {
  let yaml = `mode: "${mode}"\n`;
  yaml += `tunnel_token: "${tunnelToken || ""}"\n`;
  return yaml;
};

export default function CloudflareTunnel() {
  const [mode, setMode] = useState<string>("default"); // "default" or "token"
  const [tunnelToken, setTunnelToken] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Load config on mount
  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const base64Data = await invoke<string>("read_file_content", { path: CONFIG_PATH });
        const binaryString = window.atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const decodedText = new TextDecoder("utf-8").decode(bytes);
        const parsed = parseYaml(decodedText);
        setMode(parsed.mode === "api" ? "token" : parsed.mode);
        setTunnelToken(parsed.tunnel_token);
      } catch (err: any) {
        console.warn("No existing Cloudflare configuration, using defaults:", err);
      } finally {
        setIsLoading(false);
      }
    };
    loadConfig();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const yamlContent = toYaml(mode, tunnelToken.trim());
      const base64Content = stringToBase64(yamlContent);
      await invoke("write_file_content", { path: CONFIG_PATH, content: base64Content });
      setSuccessMsg("Lưu cấu hình Cloudflare thành công!");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      console.error("Save config error:", err);
      setError(`Lưu cấu hình thất bại: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="editor-loading" style={{ display: "flex", gap: "10px", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-secondary)" }}>
        <Wifi size={20} className="spin-animation text-accent" />
        <span>Đang đọc cấu hình Cloudflare Tunnel...</span>
      </div>
    );
  }

  return (
    <div className="project-resources-panel cloudflare-tunnel-panel" style={{ padding: "24px", maxWidth: "680px", margin: "0 auto" }}>
      
      {/* Title block */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
        <Cloud size={24} style={{ color: "var(--color-accent)" }} />
        <div>
          <h2 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            Cloudflare Tunnel Integration
          </h2>
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            Chia sẻ dự án cục bộ của bạn ra internet thông qua đường truyền bảo mật cao
          </span>
        </div>
      </div>

      {/* Main Single Card Configuration */}
      <div className="stat-card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
        
        {/* Toggle Mode Select */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
            Phương thức hoạt động
          </label>
          <div style={{ display: "flex", gap: "16px", marginTop: "4px" }}>
            <label className="checkbox-label" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-primary)" }}>
              <input
                type="radio"
                name="cloudflare_mode"
                checked={mode === "default"}
                onChange={() => setMode("default")}
                style={{ cursor: "pointer" }}
              />
              <span>Mặc định (Tunnel Free)</span>
            </label>

            <label className="checkbox-label" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-primary)" }}>
              <input
                type="radio"
                name="cloudflare_mode"
                checked={mode === "token"}
                onChange={() => setMode("token")}
                style={{ cursor: "pointer" }}
              />
              <span>Sử dụng Cloudflare Tunnel Token</span>
            </label>
          </div>
        </div>

        {/* Dynamic Options Content */}
        <div style={{ borderTop: "1px solid var(--border-primary)", paddingTop: "16px", minHeight: "80px" }}>
          {mode === "default" ? (
            <div style={{ display: "flex", gap: "10px", backgroundColor: "rgba(99,102,241,0.03)", padding: "12px", borderRadius: "4px", border: "1px solid rgba(99,102,241,0.1)" }}>
              <HelpCircle size={16} style={{ color: "var(--color-accent)", flexShrink: 0, marginTop: "2px" }} />
              <div style={{ fontSize: "11.5px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                <strong>Chế độ Tunnel Free (Khuyên dùng):</strong> Bạn không cần tài khoản Cloudflare. 
                Khi bắt đầu chạy dự án có kích hoạt Cloudflare Tunnel, hệ thống sẽ tự động tạo một đường truyền ngẫu nhiên dạng 
                <code style={{ fontFamily: "var(--font-mono)", padding: "1px 5px", background: "var(--bg-tertiary)", marginLeft: "4px" }}>
                  https://*.trycloudflare.com
                </code> liên kết trực tiếp với cổng mạng của dự án.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--text-secondary)" }}>
                  Tunnel Token (Base64)
                </label>
                <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                  Lấy từ Cloudflare Zero Trust Dashboard
                </span>
              </div>
              <input
                type="password"
                className="form-input-sm"
                placeholder="Nhập Cloudflare Tunnel Token của bạn tại đây..."
                value={tunnelToken}
                onChange={(e) => setTunnelToken(e.target.value)}
                style={{
                  width: "100%",
                  backgroundColor: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: "4px",
                  padding: "8px 10px",
                  fontSize: "11.5px",
                  fontFamily: "var(--font-mono)",
                  outline: "none"
                }}
              />
              <span style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.4, marginTop: "4px" }}>
                Lưu ý: Named Tunnel chạy dưới chế độ Token sẽ sử dụng cấu hình định tuyến tĩnh trên tài khoản Cloudflare của bạn để chuyển tiếp lưu lượng.
              </span>
            </div>
          )}
        </div>

        {/* Message Notifications */}
        {error && (
          <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "10px", backgroundColor: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.15)", borderRadius: "4px", color: "var(--color-danger)", fontSize: "11.5px" }}>
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "10px", backgroundColor: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.15)", borderRadius: "4px", color: "var(--color-success)", fontSize: "11.5px" }}>
            <CheckCircle2 size={14} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Actions bar inside the card */}
        <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--border-primary)", paddingTop: "16px", marginTop: "4px" }}>
          <button
            className="btn btn-primary"
            style={{
              padding: "6px 16px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontWeight: 600,
              fontSize: "11.5px",
              height: "30px"
            }}
            onClick={handleSave}
            disabled={isSaving}
          >
            <Save size={13} />
            <span>{isSaving ? "Đang lưu..." : "Lưu Cấu Hình"}</span>
          </button>
        </div>

      </div>

    </div>
  );
}
