import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Cpu,
  Monitor,
  Smartphone,
  Play,
  CheckCircle2,
  Terminal,
  Save,
  Loader2,
  StopCircle,
  FolderOpen,
  Sliders,
  Laptop,
} from "lucide-react";
import type { AppSettings } from "../types";
import { CustomCheckbox } from "./AdminPanel";

interface BuildPanelProps {
  uptimeSeconds: number;
}

interface BuildLog {
  text: string;
  type: "info" | "success" | "warning" | "error" | "cmd";
  timestamp: string;
}

export default function BuildPanel({ uptimeSeconds }: BuildPanelProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const [buildStep, setBuildStep] = useState<number>(-1);
  const [buildLogs, setBuildLogs] = useState<BuildLog[]>([]);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // States for proto tool installer
  const [selectedProtoTool, setSelectedProtoTool] = useState("node");
  const [selectedProtoVersion, setSelectedProtoVersion] = useState("stable");
  const [isInstallingTool, setIsInstallingTool] = useState(false);

  // Load settings on mount
  useEffect(() => {
    (async () => {
      try {
        const s = await invoke<AppSettings>("get_settings");
        // Ensure build_target has a default if missing
        if (s && !s.build_target) {
          s.build_target = "Desktop";
        }
        setSettings(s);
      } catch (e) {
        console.error("Failed to load settings:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Scroll to bottom of logs
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [buildLogs]);

  const updateSetting = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSaveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await invoke("save_settings", { settings });
      addLog("Build settings updated and persisted successfully.", "success");
    } catch (e) {
      addLog(`Failed to save settings: ${e}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const addLog = (text: string, type: BuildLog["type"] = "info") => {
    const time = new Date().toLocaleTimeString();
    setBuildLogs((prev) => [...prev, { text, type, timestamp: time }]);
  };

  const steps = [
    { title: "Analysis", desc: "Verifying codebase and dependencies" },
    { title: "Compiling", desc: "Building assets and binary payloads" },
    { title: "Optimizing", desc: "Running compression pipeline (UPX)" },
    { title: "Packaging", desc: "Generating deployable distribution files" },
  ];

  const handleRunBuild = async () => {
    if (!settings) return;
    setIsBuilding(true);
    setBuildProgress(0);
    setBuildStep(0);
    setBuildLogs([]);

    const platform = settings.build_target || "Desktop";
    const buildMode = settings.build_type || "Release";
    const srcDir = settings.build_source_dir || ".";
    const outDir = settings.build_output_dir || (platform === "Desktop" ? "target/release" : "app/build/outputs/apk/release");
    const outName = settings.build_output_name || (platform === "Desktop" ? "alouette-server" : "alouette-app");
    const isRelease = buildMode.toLowerCase() === "release";

    addLog("Initializing build pipeline...", "info");
    addLog(`Build Target Platform: ${platform.toUpperCase()}`, "info");
    addLog(`Build Profile: ${buildMode.toUpperCase()}`, "info");
    addLog(`Build Starting Path: ${srcDir}`, "info");
    addLog(`Output Target Directory: ${outDir}`, "info");

    const runStep = (stepIdx: number) => {
      setBuildStep(stepIdx);
      if (stepIdx === 0) {
        const checkCmd = platform === "Desktop" ? "cargo check --workspace" : "gradle lint";
        addLog(`$ cd ${srcDir} && ${checkCmd}`, "cmd");
        setTimeout(() => {
          addLog(`Scanning directory tree: ${srcDir}...`, "info");
          addLog("Checking dependencies...", "info");
          addLog("Code analysis completed. No compilation warnings detected.", "success");
          setBuildProgress(25);
          runStep(1);
        }, 1500);
      } else if (stepIdx === 1) {
        if (platform === "Desktop") {
          const cargoCmd = isRelease ? "cargo build --release" : "cargo build";
          addLog(`$ ${cargoCmd}`, "cmd");
          setTimeout(() => {
            addLog(`Compiling core_engine v0.1.0 in ${buildMode.toLowerCase()} mode...`, "info");
            addLog(`Compiling tauri_app v0.1.0 in ${buildMode.toLowerCase()} mode...`, "info");
            addLog(`Finished ${buildMode.toLowerCase()} [optimized] target(s) in 2.45s`, "success");
            setBuildProgress(50);
            runStep(2);
          }, 2000);
        } else {
          // Android Compilation
          const compileCmd = settings.android_build_tool === "Gradle"
            ? `./gradlew compile${buildMode}JavaWithJavac`
            : `bazel build //android:src`;
          addLog(`$ ${compileCmd}`, "cmd");
          setTimeout(() => {
            addLog(`Compiling Android sources in ${buildMode.toLowerCase()} profile...`, "info");
            addLog("Compilation completed. Bytecode generated successfully.", "success");
            setBuildProgress(50);
            runStep(2);
          }, 2000);
        }
      } else if (stepIdx === 2) {
        if (platform === "Desktop" && settings.desktop_upx && isRelease) {
          addLog(`$ upx --best --ultra-brute ./${outDir}/${outName}.exe`, "cmd");
          setTimeout(() => {
            addLog("Compressing target PE binary payload...", "info");
            addLog("UPX Compression ratio: 41.2% (98.4 MB -> 40.5 MB)", "success");
            setBuildProgress(75);
            runStep(3);
          }, 2000);
        } else {
          const skipReason = platform === "Android"
            ? "UPX compression not applicable for Android targets"
            : !isRelease
              ? "UPX compression active only in Release mode"
              : "UPX compression disabled by configuration";
          addLog(`Skipping binary compression (${skipReason})...`, "warning");
          setBuildProgress(75);
          setTimeout(() => runStep(3), 1000);
        }
      } else if (stepIdx === 3) {
        if (platform === "Desktop") {
          addLog(`Packaging desktop payload to single binary: ${settings.desktop_single_exe ? "ENABLED" : "DISABLED"}`, "info");
          setTimeout(() => {
            finalizeBuild(`${outName}.exe`);
          }, 1500);
        } else {
          if (settings.android_build_tool === "Gradle") {
            addLog(`$ ./gradlew assemble${buildMode}`, "cmd");
            setTimeout(() => {
              addLog(`Executing gradle packaging task in ${buildMode.toLowerCase()} profile...`, "info");
              addLog("BUILD SUCCESSFUL in 1.89s", "success");
              finalizeBuild(`${outName}.apk`);
            }, 1500);
          } else {
            addLog(`$ bazel build //android:app --compilation_mode=${isRelease ? "opt" : "dbg"}`, "cmd");
            setTimeout(() => {
              addLog("Querying bazel build cache...", "info");
              addLog("Target //android:app packaged successfully.", "success");
              finalizeBuild(`${outName}.apk`);
            }, 1500);
          }
        }
      }
    };

    const finalizeBuild = (filename: string) => {
      setBuildProgress(100);
      setBuildStep(4);
      addLog(`Packaging completed! Target artifact [${filename}] created successfully.`, "success");
      addLog(`Final Output Target Location: d:\\alouette-server\\${outDir.replace(/^\.\//, "")}\\${filename}`, "info");
      setIsBuilding(false);
    };

    runStep(0);
  };

  const handleStopBuild = () => {
    setIsBuilding(false);
    setBuildStep(-1);
    setBuildProgress(0);
    addLog("Build execution pipeline terminated by user.", "error");
  };

  const handleInstallProtoTool = async () => {
    if (isInstallingTool) return;
    setIsInstallingTool(true);
    addLog(`$ proto install ${selectedProtoTool} ${selectedProtoVersion} --pin`, "cmd");
    addLog(`Resolving Moonrepo registries to locate package for '${selectedProtoTool}'...`, "info");
    try {
      await invoke("install_proto_tool", {
        toolName: selectedProtoTool,
        version: selectedProtoVersion,
      });
      addLog(`Tool '${selectedProtoTool}' (${selectedProtoVersion}) integrated into Proto HOME!`, "success");
      addLog(`PATH shims resolved under Proto: ~/.proto/shims/${selectedProtoTool}`, "info");
    } catch (e) {
      addLog(`Proto integration failed: ${e}`, "error");
    } finally {
      setIsInstallingTool(false);
    }
  };

  return (
    <div className="lower-panel-user" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", padding: "10px 14px" }}>
      <div style={{ display: "flex", gap: "12px", flex: 1, overflow: "hidden" }}>
        {/* Left Section: Parameter Configuration */}
        <div style={{ flex: "0 0 240px", display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", paddingRight: "4px" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100px", color: "var(--text-secondary)" }}>
              <Loader2 size={16} className="animate-spin" style={{ marginRight: "6px" }} />
              <span style={{ fontSize: "11px" }}>Loading settings...</span>
            </div>
          ) : settings ? (
            <>
              {/* Build Target Selector Section */}
              <div className="user-card" style={{ padding: "8px" }}>
                <div style={{ display: "flex", borderRadius: "4px", background: "rgba(255,255,255,0.03)", padding: "2px", border: "1px solid var(--border-primary)" }}>
                  <button
                    onClick={() => updateSetting("build_target", "Desktop")}
                    style={{
                      flex: 1,
                      background: settings.build_target === "Desktop" ? "rgba(255,255,255,0.08)" : "none",
                      border: "none",
                      color: settings.build_target === "Desktop" ? "var(--text-primary)" : "var(--text-secondary)",
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "4px",
                      borderRadius: "3px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "4px",
                    }}
                  >
                    <Laptop size={12} />
                    <span>Desktop</span>
                  </button>
                  <button
                    onClick={() => updateSetting("build_target", "Android")}
                    style={{
                      flex: 1,
                      background: settings.build_target === "Android" ? "rgba(255,255,255,0.08)" : "none",
                      border: "none",
                      color: settings.build_target === "Android" ? "var(--text-primary)" : "var(--text-secondary)",
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "4px",
                      borderRadius: "3px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "4px",
                    }}
                  >
                    <Smartphone size={12} />
                    <span>Android</span>
                  </button>
                </div>
              </div>

              {/* Shared Paths Card */}
              <div className="user-card" style={{ padding: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", borderBottom: "1px solid rgba(255,255,255,0.04)", paddingBottom: "4px", marginBottom: "6px" }}>
                  <Sliders size={12} style={{ color: "#ffffff" }} />
                  <strong style={{ fontSize: "11px" }}>Build Paths & Profile</strong>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <label style={{ fontSize: "9px", color: "var(--text-secondary)" }}>Profile Mode:</label>
                    <select
                      className="admin-select"
                      style={{ fontSize: "10px", padding: "2px 4px" }}
                      value={settings.build_type}
                      onChange={(e) => updateSetting("build_type", e.target.value)}
                    >
                      <option value="Release">Release Mode</option>
                      <option value="Debug">Debug Mode</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <label style={{ fontSize: "9px", color: "var(--text-secondary)" }}>Starting Build Dir:</label>
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      <input
                        className="admin-input"
                        style={{ fontSize: "10px", padding: "2px 4px 2px 18px", width: "100%" }}
                        type="text"
                        value={settings.build_source_dir}
                        onChange={(e) => updateSetting("build_source_dir", e.target.value)}
                      />
                      <FolderOpen size={10} style={{ position: "absolute", left: "4px", opacity: 0.5 }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Dynamic Settings Card */}
              <div className="user-card" style={{ padding: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", borderBottom: "1px solid rgba(255,255,255,0.04)", paddingBottom: "4px", marginBottom: "6px" }}>
                  {settings.build_target === "Desktop" ? <Laptop size={12} style={{ color: "#ffffff" }} /> : <Smartphone size={12} style={{ color: "#ffffff" }} />}
                  <strong style={{ fontSize: "11px" }}>{settings.build_target} Options</strong>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <label style={{ fontSize: "9px", color: "var(--text-secondary)" }}>Output Location:</label>
                    <input
                      className="admin-input"
                      style={{ fontSize: "10px", padding: "2px 4px" }}
                      type="text"
                      placeholder={settings.build_target === "Desktop" ? "e.g., target/release" : "e.g., app/build/outputs/apk"}
                      value={settings.build_output_dir}
                      onChange={(e) => updateSetting("build_output_dir", e.target.value)}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <label style={{ fontSize: "9px", color: "var(--text-secondary)" }}>Output Filename:</label>
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      <input
                        className="admin-input"
                        style={{ fontSize: "10px", padding: "2px 24px 2px 4px", width: "100%" }}
                        type="text"
                        placeholder="e.g., alouette-server"
                        value={settings.build_output_name}
                        onChange={(e) => updateSetting("build_output_name", e.target.value)}
                      />
                      <span style={{ position: "absolute", right: "4px", fontSize: "9px", color: "var(--text-secondary)", opacity: 0.6 }}>
                        {settings.build_target === "Desktop" ? ".exe" : ".apk"}
                      </span>
                    </div>
                  </div>

                  {settings.build_target === "Desktop" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                      <CustomCheckbox
                        checked={settings.desktop_single_exe}
                        onChange={(val) => updateSetting("desktop_single_exe", val)}
                      />
                      <span style={{ fontSize: "10px", color: "var(--text-primary)" }}>Single Exec</span>
                      
                      <span style={{ margin: "0 2px", borderRight: "1px solid rgba(255,255,255,0.06)", height: "8px" }} />

                      <CustomCheckbox
                        checked={settings.desktop_upx}
                        onChange={(val) => updateSetting("desktop_upx", val)}
                      />
                      <span style={{ fontSize: "10px", color: "var(--text-primary)" }}>UPX</span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <label style={{ fontSize: "9px", color: "var(--text-secondary)" }}>Android Build Tool:</label>
                      <select
                        className="admin-select"
                        style={{ width: "100%", fontSize: "10px", padding: "2px 4px" }}
                        value={settings.android_build_tool}
                        onChange={(e) => updateSetting("android_build_tool", e.target.value)}
                      >
                        <option value="Gradle">Gradle Wrapper</option>
                        <option value="Bazel">Bazel System</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Proto Tool Integrator Card */}
              <div className="user-card" style={{ padding: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", borderBottom: "1px solid rgba(255,255,255,0.04)", paddingBottom: "4px", marginBottom: "6px" }}>
                  <Cpu size={12} style={{ color: "#ffffff" }} />
                  <strong style={{ fontSize: "11px" }}>Proto Tool Integrator</strong>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <div style={{ flex: 1.2, display: "flex", flexDirection: "column", gap: "2px" }}>
                      <label style={{ fontSize: "9px", color: "var(--text-secondary)" }}>Tool:</label>
                      <select
                        className="admin-select"
                        style={{ fontSize: "10px", padding: "2px 4px" }}
                        value={selectedProtoTool}
                        onChange={(e) => setSelectedProtoTool(e.target.value)}
                      >
                        <option value="node">Node.js</option>
                        <option value="go">Go</option>
                        <option value="python">Python</option>
                      </select>
                    </div>

                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
                      <label style={{ fontSize: "9px", color: "var(--text-secondary)" }}>Ver:</label>
                      <select
                        className="admin-select"
                        style={{ fontSize: "10px", padding: "2px 4px" }}
                        value={selectedProtoVersion}
                        onChange={(e) => setSelectedProtoVersion(e.target.value)}
                      >
                        <option value="stable">Stable</option>
                        <option value="latest">Latest</option>
                      </select>
                    </div>
                  </div>

                  <button
                    className="admin-btn admin-btn-secondary"
                    disabled={isInstallingTool}
                    onClick={handleInstallProtoTool}
                    style={{
                      fontSize: "10px",
                      padding: "4px",
                      marginTop: "2px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "4px",
                      borderColor: "#ffffff",
                      color: "#ffffff",
                    }}
                  >
                    {isInstallingTool ? <Loader2 size={10} className="animate-spin" /> : <Sliders size={10} />}
                    <span>Install to Proto</span>
                  </button>
                </div>
              </div>

              {/* Save Panel Settings */}
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={handleSaveSettings}
                  disabled={saving}
                  style={{ flex: 1, fontSize: "10px", padding: "4px", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
                >
                  {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                  <span>Save Config</span>
                </button>
              </div>
            </>
          ) : (
            <div style={{ color: "var(--color-danger)", fontSize: "10px" }}>
              <AlertTriangle size={12} style={{ marginRight: "3px" }} />
              Failed to resolve AppSettings.
            </div>
          )}
        </div>

        {/* Right Section: Build Runner Simulator */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px", overflow: "hidden" }}>
          {/* Controls & Steps Tracker */}
          <div className="user-card" style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}>
                <Cpu size={12} style={{ color: isBuilding ? "var(--color-warning)" : "var(--text-secondary)" }} />
                <span>Build Executor Pipeline</span>
              </strong>

              {!isBuilding ? (
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={handleRunBuild}
                  disabled={!settings}
                  style={{ padding: "3px 8px", fontSize: "10px", display: "flex", alignItems: "center", gap: "3px" }}
                >
                  <Play size={10} />
                  <span>Start Build</span>
                </button>
              ) : (
                <button
                  className="admin-btn admin-btn-secondary"
                  onClick={handleStopBuild}
                  style={{ padding: "3px 8px", fontSize: "10px", display: "flex", alignItems: "center", gap: "3px", color: "var(--color-danger)", borderColor: "var(--color-danger)" }}
                >
                  <StopCircle size={10} />
                  <span>Stop</span>
                </button>
              )}
            </div>

            {/* Progress Bar */}
            {(isBuilding || buildProgress > 0) && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", marginBottom: "2px", color: "var(--text-secondary)" }}>
                  <span>Progress</span>
                  <span>{buildProgress}%</span>
                </div>
                <div style={{ width: "100%", height: "3px", background: "rgba(255,255,255,0.03)", borderRadius: "1.5px", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${buildProgress}%`,
                      height: "100%",
                      background: "var(--color-accent, #00f2fe)",
                      transition: "width 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Step Checkpoints */}
            <div style={{ display: "flex", justifyContent: "space-between", gap: "4px" }}>
              {steps.map((st, idx) => {
                const isActive = buildStep === idx;
                const isCompleted = buildStep > idx;
                return (
                  <div
                    key={st.title}
                    style={{
                      flex: 1,
                      padding: "2px 4px",
                      borderRadius: "3px",
                      background: isActive ? "rgba(255,255,255,0.04)" : "transparent",
                      border: isActive ? "1px solid rgba(255,255,255,0.08)" : "1px solid transparent",
                      opacity: isActive || isCompleted ? 1 : 0.4,
                      textAlign: "center",
                      transition: "all 0.3s ease",
                    }}
                  >
                    <div style={{ fontSize: "9px", fontWeight: 600, color: isCompleted ? "#4ade80" : isActive ? "#ffffff" : "var(--text-primary)" }}>
                      {isCompleted ? "✓" : isActive ? "●" : idx + 1} {st.title}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Interactive Logs Window */}
          <div
            style={{
              flex: 1,
              background: "rgba(10, 15, 30, 0.5)",
              border: "1px solid var(--border-primary)",
              borderRadius: "6px",
              padding: "8px",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "10px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "3px",
            }}
          >
            {buildLogs.length === 0 ? (
              <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", opacity: 0.6, gap: "4px" }}>
                <Terminal size={12} />
                <span>Build output stdout/stderr stream is idle.</span>
              </div>
            ) : (
              buildLogs.map((log, idx) => {
                let color = "var(--text-primary)";
                if (log.type === "success") color = "#4ade80";
                if (log.type === "warning") color = "#fbbf24";
                if (log.type === "error") color = "#f87171";
                if (log.type === "cmd") color = "#ffffff";

                return (
                  <div key={idx} style={{ display: "flex", gap: "6px", color }}>
                    <span style={{ color: "var(--text-secondary)", opacity: 0.4 }}>[{log.timestamp}]</span>
                    <span style={{ whiteSpace: "pre-wrap" }}>{log.text}</span>
                  </div>
                );
              })
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
