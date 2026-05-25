import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Globe,
  Wifi,
  Shield,
  Key,
  Hash,
  FileText,
  Clock,
  AlertCircle,
  Activity,
  Terminal,
  Copy,
  XCircle,
} from "lucide-react";

type ToolsTab =
  | "dns"
  | "ping"
  | "ssl"
  | "jwt"
  | "hash"
  | "base64"
  | "timestamp"
  | "status";

interface ToolResult {
  title: string;
  content: string;
  error?: string;
}

export default function MiniPostmanNetworkTools(
  _props: { onClose?: () => void } = {},
) {
  const [activeTool, setActiveTool] = useState<ToolsTab>("dns");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Record<string, ToolResult>>({});

  // DNS Lookup
  const [dnsDomain, setDnsDomain] = useState("google.com");

  // Ping
  const [pingHost, setPingHost] = useState("google.com");
  const [pingCount, setPingCount] = useState(4);

  // SSL
  const [sslHost, setSslHost] = useState("google.com");
  const [sslPort, setSslPort] = useState(443);

  // JWT
  const [jwtToken, setJwtToken] = useState("");

  // Hash
  const [hashText, setHashText] = useState("");

  // Base64
  const [base64Text, setBase64Text] = useState("");
  const [base64Action, setBase64Action] = useState<"encode" | "decode">(
    "encode",
  );

  // Timestamp
  const [tsValue, setTsValue] = useState("");

  // Status Code
  const [statusCode, setStatusCode] = useState("200");

  const runTool = async () => {
    setLoading(true);
    try {
      switch (activeTool) {
        case "dns": {
          const res: any = await invoke("dns_lookup", { domain: dnsDomain });
          const lines = [
            `Domain: ${res.domain}`,
            `IPv4: ${res.ipv4.join(", ") || "None"}`,
            `IPv6: ${res.ipv6.join(", ") || "None"}`,
            `CNAME: ${res.cname || "None"}`,
            `MX Records: ${res.mx.join(", ") || "None"}`,
            `NS Records: ${res.ns.join(", ") || "None"}`,
            `TXT Records: ${res.txt.join(", ") || "None"}`,
          ];
          setResults((prev) => ({
            ...prev,
            dns: { title: "DNS Lookup", content: lines.join("\n") },
          }));
          break;
        }
        case "ping": {
          const res: any = await invoke("ping_host", {
            host: pingHost,
            count: pingCount,
          });
          const lines = [
            `Host: ${res.host}`,
            `Packets: Sent=${res.sent}, Received=${res.received}, Loss=${res.packet_loss.toFixed(1)}%`,
            `Round Trip: Min=${res.min_ms.toFixed(1)}ms, Max=${res.max_ms.toFixed(1)}ms, Avg=${res.avg_ms.toFixed(1)}ms`,
          ];
          setResults((prev) => ({
            ...prev,
            ping: { title: "Ping", content: lines.join("\n") },
          }));
          break;
        }
        case "ssl": {
          const res: any = await invoke("ssl_certificate_info", {
            host: sslHost,
            port: sslPort,
          });
          const lines = [
            `Subject: ${res.subject}`,
            `Issuer: ${res.issuer}`,
            `Valid From: ${res.valid_from}`,
            `Valid To: ${res.valid_to}`,
            `Expires In: ${res.expires_in_days} days`,
            `Fingerprint: ${res.fingerprint}`,
            `TLS Version: ${res.tls_version}`,
          ];
          setResults((prev) => ({
            ...prev,
            ssl: { title: "SSL Certificate Info", content: lines.join("\n") },
          }));
          break;
        }
        case "jwt": {
          const res: any = await invoke("jwt_decode", { token: jwtToken });
          if (res.error) {
            setResults((prev) => ({
              ...prev,
              jwt: { title: "JWT Decode", content: "", error: res.error },
            }));
          } else {
            const header = JSON.stringify(res.header, null, 2);
            const payload = JSON.stringify(res.payload, null, 2);
            setResults((prev) => ({
              ...prev,
              jwt: {
                title: "JWT Decode",
                content: `HEADER:\n${header}\n\nPAYLOAD:\n${payload}\n\nSignature: ${res.signature.substring(0, 20)}...`,
              },
            }));
          }
          break;
        }
        case "hash": {
          const res: any = await invoke("hash_tool", {
            text: hashText || "Hello World",
          });
          const lines = [
            `MD5:    ${res.md5}`,
            `SHA1:   ${res.sha1}`,
            `SHA256: ${res.sha256}`,
          ];
          setResults((prev) => ({
            ...prev,
            hash: { title: "Hash Generator", content: lines.join("\n") },
          }));
          break;
        }
        case "base64": {
          const res: any = await invoke("base64_tool", {
            input: { text: base64Text, action: base64Action },
          });
          setResults((prev) => ({
            ...prev,
            base64: {
              title: `Base64 ${base64Action === "encode" ? "Encode" : "Decode"}`,
              content: res.result,
            },
          }));
          break;
        }
        case "timestamp": {
          const ts = tsValue ? parseInt(tsValue) : null;
          const res: any = await invoke("timestamp_convert", {
            timestamp: ts,
            format: null,
          });
          const lines = [
            `Unix Seconds: ${res.unix_seconds}`,
            `Unix Milliseconds: ${res.unix_milliseconds}`,
            `UTC: ${res.utc_string}`,
            `Local: ${res.local_string}`,
            `ISO 8601: ${res.iso_8601}`,
            `Relative: ${res.relative}`,
          ];
          setResults((prev) => ({
            ...prev,
            timestamp: {
              title: "Timestamp Converter",
              content: lines.join("\n"),
            },
          }));
          break;
        }
        case "status": {
          const res: any = await invoke("http_status_info", {
            code: parseInt(statusCode) || 200,
          });
          const lines = [
            `Code: ${res.code}`,
            `Name: ${res.name}`,
            `Category: ${res.category}`,
            `Description: ${res.description}`,
          ];
          setResults((prev) => ({
            ...prev,
            status: { title: "HTTP Status Code", content: lines.join("\n") },
          }));
          break;
        }
      }
    } catch (e: any) {
      setResults((prev) => ({
        ...prev,
        [activeTool]: { title: "Error", content: "", error: e.toString() },
      }));
    } finally {
      setLoading(false);
    }
  };

  const tools: { id: ToolsTab; label: string; icon: any }[] = [
    { id: "dns", label: "DNS", icon: Globe },
    { id: "ping", label: "Ping", icon: Activity },
    { id: "ssl", label: "SSL", icon: Shield },
    { id: "jwt", label: "JWT", icon: Key },
    { id: "hash", label: "Hash", icon: Hash },
    { id: "base64", label: "Base64", icon: FileText },
    { id: "timestamp", label: "Time", icon: Clock },
    { id: "status", label: "Status", icon: AlertCircle },
  ];

  const copyResult = () => {
    const r = results[activeTool];
    if (r?.content) {
      navigator.clipboard.writeText(r.content);
    }
  };

  return (
    <div className="network-tools-panel">
      <div className="tools-sidebar">
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`tool-btn ${activeTool === tool.id ? "active" : ""}`}
            onClick={() => setActiveTool(tool.id)}
          >
            <tool.icon size={14} />
            <span>{tool.label}</span>
          </button>
        ))}
      </div>

      <div className="tool-workspace">
        {/* Input Section */}
        <div className="tool-inputs">
          {activeTool === "dns" && (
            <div className="input-group">
              <label>Domain Name</label>
              <input
                type="text"
                value={dnsDomain}
                onChange={(e) => setDnsDomain(e.target.value)}
                placeholder="e.g. google.com"
              />
            </div>
          )}
          {activeTool === "ping" && (
            <>
              <div className="input-group">
                <label>Host</label>
                <input
                  type="text"
                  value={pingHost}
                  onChange={(e) => setPingHost(e.target.value)}
                  placeholder="e.g. google.com"
                />
              </div>
              <div className="input-group">
                <label>Count</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={pingCount}
                  onChange={(e) => setPingCount(parseInt(e.target.value) || 4)}
                />
              </div>
            </>
          )}
          {activeTool === "ssl" && (
            <>
              <div className="input-group">
                <label>Host</label>
                <input
                  type="text"
                  value={sslHost}
                  onChange={(e) => setSslHost(e.target.value)}
                  placeholder="e.g. google.com"
                />
              </div>
              <div className="input-group">
                <label>Port</label>
                <input
                  type="number"
                  value={sslPort}
                  onChange={(e) => setSslPort(parseInt(e.target.value) || 443)}
                />
              </div>
            </>
          )}
          {activeTool === "jwt" && (
            <div className="input-group">
              <label>JWT Token</label>
              <textarea
                value={jwtToken}
                onChange={(e) => setJwtToken(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIs..."
                rows={3}
              />
            </div>
          )}
          {activeTool === "hash" && (
            <div className="input-group">
              <label>Text to Hash</label>
              <textarea
                value={hashText}
                onChange={(e) => setHashText(e.target.value)}
                placeholder="Enter text to hash..."
                rows={2}
              />
            </div>
          )}
          {activeTool === "base64" && (
            <>
              <div className="input-group">
                <label>Action</label>
                <select
                  value={base64Action}
                  onChange={(e) => setBase64Action(e.target.value as any)}
                >
                  <option value="encode">Encode → Base64</option>
                  <option value="decode">Decode ← Base64</option>
                </select>
              </div>
              <div className="input-group">
                <label>
                  {base64Action === "encode" ? "Plain Text" : "Base64 Text"}
                </label>
                <textarea
                  value={base64Text}
                  onChange={(e) => setBase64Text(e.target.value)}
                  placeholder="Enter text..."
                  rows={2}
                />
              </div>
            </>
          )}
          {activeTool === "timestamp" && (
            <div className="input-group">
              <label>Unix Timestamp (leave empty for now)</label>
              <input
                type="text"
                value={tsValue}
                onChange={(e) => setTsValue(e.target.value)}
                placeholder="e.g. 1716000000 or 1716000000000"
              />
            </div>
          )}
          {activeTool === "status" && (
            <div className="input-group">
              <label>HTTP Status Code</label>
              <input
                type="number"
                min={100}
                max={599}
                value={statusCode}
                onChange={(e) => setStatusCode(e.target.value)}
              />
            </div>
          )}

          <button
            className="btn btn-primary tool-run-btn"
            onClick={runTool}
            disabled={loading}
          >
            {loading ? (
              <Activity size={14} className="animate-spin" />
            ) : (
              <Terminal size={14} />
            )}
            <span>{loading ? "Running..." : "Run"}</span>
          </button>
        </div>

        {/* Result Section */}
        {results[activeTool] && (
          <div className="tool-result">
            <div className="tool-result-header">
              <span className="font-bold text-xs">
                {results[activeTool].title}
              </span>
              <button
                className="tool-copy-btn"
                onClick={copyResult}
                title="Copy to clipboard"
              >
                <Copy size={12} />
              </button>
            </div>
            {results[activeTool].error ? (
              <div className="tool-error">
                <XCircle size={14} className="text-danger" />
                <pre>{results[activeTool].error}</pre>
              </div>
            ) : (
              <pre className="tool-output">{results[activeTool].content}</pre>
            )}
          </div>
        )}

        {!results[activeTool] && (
          <div className="tool-placeholder">
            <Wifi size={32} className="text-muted" />
            <span className="text-muted text-xs mt-2">
              Configure and click "Run" to execute
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
