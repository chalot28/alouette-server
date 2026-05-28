import React, { useState, useRef, useEffect } from "react";
import { Plus, Send, RefreshCw, Layers, History, ArrowLeft, Shield, Terminal, Database, Globe, Cpu, Activity, Hammer, Chrome, Lock, Unlock, Zap, GitBranch, Sliders } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ChatItem {
  id: string;
  type: "text" | "tool_request" | "agent_activity";
  sender: "user" | "agent";
  text?: string;
  toolName?: string;
  args?: string;
  toolStatus?: "waiting" | "approved" | "rejected";
  timestamp: string;
}

interface AiAgentProps {
  onBack: () => void;
  activeProjectCwd?: string;
}

export default function AiAgent({ onBack, activeProjectCwd }: AiAgentProps) {
  const [chatHistory, setChatHistory] = useState<ChatItem[]>([]);
  const [activeTool, setActiveTool] = useState<{ status: "executing" | "idle"; tool_name?: string; args?: string }>({ status: "idle" });

  const [inputVal, setInputVal] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [selectedModel, setSelectedModel] = useState("deepseek");
  const [selectedMode, setSelectedMode] = useState("interactive");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("Agent Active Session #1");
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string }[]>([
    { id: "deepseek", name: "DeepSeek" },
    { id: "claude", name: "Claude" },
    { id: "gemini", name: "Gemini" }
  ]);

  const [capabilities, setCapabilities] = useState(() => {
    const saved = localStorage.getItem("alouette_capabilities");
    return saved ? JSON.parse(saved) : {
      sandbox: true,
      terminal: true,
      localData: true,
      internet: false,
      environment: true,
      logSystem: true,
      build: true,
      browser: false,
      interaction: "full", // "readonly" or "full"
      postMini: false,
      git: true
    };
  });

  const toggleCapability = (key: string) => {
    setCapabilities((prev: any) => {
      const next = { ...prev };
      if (key === "interaction") {
        next.interaction = prev.interaction === "full" ? "readonly" : "full";
      } else {
        next[key] = !prev[key];
      }
      localStorage.setItem("alouette_capabilities", JSON.stringify(next));
      return next;
    });
  };

  const [capsOpen, setCapsOpen] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Dynamically load active models from localStorage
  useEffect(() => {
    const loadActiveModels = () => {
      const savedActive = localStorage.getItem("alouette_active_models");
      const activeIds: string[] = savedActive ? JSON.parse(savedActive) : ["deepseek", "claude", "gemini"];
      
      const savedCustom = localStorage.getItem("alouette_custom_models");
      const customs: any[] = savedCustom ? JSON.parse(savedCustom) : [];

      const list: { id: string; name: string }[] = [];
      
      // Full lists of the strongest 2026 models mapped to active providers
      const providerModelsMapping: { [providerId: string]: { id: string; name: string }[] } = {
        deepseek: [
          { id: "deepseek-v4-pro", name: "DeepSeek-V4 Pro (2026)" },
          { id: "deepseek-v4", name: "DeepSeek-V4" },
          { id: "deepseek-r1", name: "DeepSeek-R1 (Reasoning)" }
        ],
        "gpt-chatgpt": [
          { id: "gpt-5.5", name: "GPT-5.5 (2026)" },
          { id: "o1-pro", name: "o1-Pro (Reasoning)" },
          { id: "o3-mini", name: "o3-Mini (Coding)" },
          { id: "gpt-4o", name: "GPT-4o (Vision)" }
        ],
        gemini: [
          { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash (2026)" },
          { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" }
        ],
        claude: [
          { id: "claude-opus-4.7", name: "Claude Opus 4.7 (2026)" },
          { id: "claude-sonnet-5", name: "Claude Sonnet 5" }
        ],
        qwen: [
          { id: "qwen-3.7-max", name: "Qwen 3.7 Max (2026)" }
        ]
      };

      // Populate predefined models if the specific model ID is active in activeIds
      Object.keys(providerModelsMapping).forEach(provId => {
        providerModelsMapping[provId].forEach(m => {
          if (activeIds.includes(m.id)) {
            list.push(m);
          }
        });
      });

      // Populate custom models
      customs.forEach(c => {
        if (activeIds.includes(c.id)) {
          list.push({ id: c.id, name: `${c.provider} - ${c.name}` });
        }
      });

      if (list.length > 0) {
        setAvailableModels(list);
        setSelectedModel(prev => {
          if (list.some(m => m.id === prev)) return prev;
          return list[0].id;
        });
      }
    };

    loadActiveModels();
    
    // Listening for instant saves from Admin panel
    window.addEventListener("storage", loadActiveModels);
    const interval = setInterval(loadActiveModels, 1000);

    return () => {
      window.removeEventListener("storage", loadActiveModels);
      clearInterval(interval);
    };
  }, []);

  // Auto scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isTyping]);

  // Listen to agent tool execution activity
  useEffect(() => {
    let unlistenFn;
    const setupListener = async () => {
      unlistenFn = await listen("agent-activity", (event) => {
        setActiveTool(event.payload);
      });
    };
    setupListener();
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Listen for Alouette Open background error event
  useEffect(() => {
    let unlistenFn: any;
    const setupErrorListener = async () => {
      unlistenFn = await listen("alouette-open-error", (event: any) => {
        const errorData = event.payload;
        // Verify if we are currently standing on this project
        const matchesCwd = activeProjectCwd && errorData.cwd && 
          activeProjectCwd.replace(/\\/g, "/").toLowerCase() === errorData.cwd.replace(/\\/g, "/").toLowerCase();
        
        if (matchesCwd) {
          const timestampStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const newMsg: ChatItem = {
            id: `err_${Date.now()}`,
            type: "text",
            sender: "agent",
            text: `[Alouette Open] Phát hiện lỗi tại dự án "${errorData.project_name}":\n\n\`\`\`\n${errorData.text}\n\`\`\`\n\nBạn có muốn tôi tự động sửa lỗi này không?`,
            timestamp: timestampStr
          };
          setChatHistory((prev) => {
            // Avoid duplicate error inserts
            if (prev.some(m => m.text?.includes(errorData.text))) {
              return prev;
            }
            return [...prev, newMsg];
          });
        }
      });
    };
    setupErrorListener();
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [activeProjectCwd]);

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [inputVal]);

  // Click outside to close dropdown menu
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim()) return;

    const userMsg: ChatItem = {
      id: Date.now().toString(),
      type: "text",
      sender: "user",
      text: inputVal,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setChatHistory((prev) => [...prev, userMsg]);
    const messageText = inputVal;
    setInputVal("");
    setIsTyping(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      const response: {
        session_id: string;
        reply_type: "text" | "tool_request" | "agent_activity";
        text?: string;
        tool_name?: string;
        args?: string;
        pending_id?: string;
      } = await invoke("agent_send_message", {
        message: messageText,
        model: selectedModel,
        mode: selectedMode,
        activeCwd: activeProjectCwd,
      });

      setIsTyping(false);

      if (response.reply_type === "tool_request") {
        const toolMsg: ChatItem = {
          id: response.pending_id || Date.now().toString(),
          type: "tool_request",
          sender: "agent",
          toolName: response.tool_name,
          args: response.args,
          toolStatus: "waiting",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setChatHistory((prev) => [...prev, toolMsg]);
      } else if (response.reply_type === "agent_activity") {
        const activityMsg: ChatItem = {
          id: Date.now().toString(),
          type: "agent_activity",
          sender: "agent",
          text: response.text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setChatHistory((prev) => [...prev, activityMsg]);
      } else {
        const agentMsg: ChatItem = {
          id: Date.now().toString(),
          type: "text",
          sender: "agent",
          text: response.text || "Tôi đã ghi nhận yêu cầu.",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setChatHistory((prev) => [...prev, agentMsg]);
      }
    } catch (err: any) {
      setIsTyping(false);
      const errorMsg: ChatItem = {
        id: Date.now().toString(),
        type: "text",
        sender: "agent",
        text: `Lỗi kết nối Harness Backend: ${err?.message || err}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatHistory((prev) => [...prev, errorMsg]);
    }
  };

  const handleApproveTool = async (id: string) => {
    setChatHistory((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, toolStatus: "approved" as const } : item
      )
    );

    setIsTyping(true);

    try {
      const response: {
        text?: string;
      } = await invoke("agent_approve_tool", { approved: true, activeCwd: activeProjectCwd });

      setIsTyping(false);

      const successMsg: ChatItem = {
        id: Date.now().toString(),
        type: "agent_activity",
        sender: "agent",
        text: response.text || "✓ Đã chạy công cụ thành công.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatHistory((prev) => [...prev, successMsg]);
    } catch (err: any) {
      setIsTyping(false);
      alert(`Lỗi khi phê duyệt tool: ${err?.message || err}`);
    }
  };

  const handleRejectTool = async (id: string) => {
    setChatHistory((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, toolStatus: "rejected" as const } : item
      )
    );

    setIsTyping(true);

    try {
      const response: {
        text?: string;
      } = await invoke("agent_approve_tool", { approved: false, activeCwd: activeProjectCwd });

      setIsTyping(false);

      const rejectMsg: ChatItem = {
        id: Date.now().toString(),
        type: "agent_activity",
        sender: "agent",
        text: response.text || "✕ Từ chối thực thi công cụ.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatHistory((prev) => [...prev, rejectMsg]);
    } catch (err: any) {
      setIsTyping(false);
      alert(`Lỗi khi từ chối tool: ${err?.message || err}`);
    }
  };

  const handleNewChat = async () => {
    try {
      await invoke("agent_reset_session");
      setChatHistory([]);
      setSessionTitle(`Agent Active Session #${Math.floor(Math.random() * 100) + 1}`);
      setMenuOpen(false);
    } catch (err: any) {
      alert(`Lỗi khi reset session: ${err?.message || err}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };


  const capList = [
    { key: "sandbox", label: "Sandbox", icon: Shield, isActive: capabilities.sandbox },
    { key: "terminal", label: "Terminal", icon: Terminal, isActive: capabilities.terminal },
    { key: "localData", label: "Local Data", icon: Database, isActive: capabilities.localData },
    { key: "internet", label: "Internet", icon: Globe, isActive: capabilities.internet },
    { key: "environment", label: "Môi trường", icon: Cpu, isActive: capabilities.environment },
    { key: "logSystem", label: "Log System", icon: Activity, isActive: capabilities.logSystem },
    { key: "build", label: "Build", icon: Hammer, isActive: capabilities.build },
    { key: "browser", label: "Browser", icon: Chrome, isActive: capabilities.browser },
    {
      key: "interaction",
      label: capabilities.interaction === "full" ? "Quyền: Ghi" : "Quyền: Đọc",
      icon: capabilities.interaction === "full" ? Unlock : Lock,
      isActive: capabilities.interaction === "full"
    },
    { key: "postMini", label: "Post Mini", icon: Zap, isActive: capabilities.postMini },
    { key: "git", label: "Git", icon: GitBranch, isActive: capabilities.git }
  ];

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      backgroundColor: "var(--bg-secondary)",
      color: "var(--text-primary)",
      overflow: "hidden"
    }}>
      {/* Monochromatic Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between", // Space between title and actions dropdown
        padding: "10px 14px",
        borderBottom: "1px solid var(--border-primary)",
        backgroundColor: "var(--bg-secondary)",
        height: "41px",
        position: "relative"
      }}>
        {/* Chat Session Title (Left side) */}
        <span style={{ 
          fontSize: "12px", 
          fontWeight: 600, 
          color: "var(--text-primary)", 
          fontFamily: "var(--font-sans)",
          letterSpacing: "-0.01em"
        }}>
          {sessionTitle}
        </span>

        {/* Top Right "+" Actions Dropdown container */}
        <div ref={dropdownRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <button 
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-primary)",
              color: "var(--text-primary)",
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.4)",
              transition: "all var(--transition-fast)",
              padding: 0,
              boxSizing: "border-box"
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--border-primary)"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "var(--bg-tertiary)"}
          >
            <Plus size={16} />
          </button>

          {menuOpen && (
            <div style={{
              position: "absolute",
              top: "100%",
              right: 0,
              marginTop: "6px",
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-primary)",
              boxShadow: "0 8px 16px rgba(0, 0, 0, 0.4)",
              padding: "2px",
              minWidth: "160px",
              zIndex: 100
            }}>
              <button 
                onClick={handleNewChat}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  color: "var(--text-primary)",
                  fontSize: "11px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px"
                }}
                className="dropdown-item"
              >
                <Plus size={11} />
                <span>Chat new</span>
              </button>
              
              <button 
                onClick={() => { alert("Chức năng thêm model đang được phát triển."); setMenuOpen(false); }}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  color: "var(--text-primary)",
                  fontSize: "11px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px"
                }}
                className="dropdown-item"
              >
                <Layers size={11} />
                <span>Thêm model</span>
              </button>

              <button 
                onClick={() => { alert("Chức năng xem lịch sử chat đang được phát triển."); setMenuOpen(false); }}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  color: "var(--text-primary)",
                  fontSize: "11px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px"
                }}
                className="dropdown-item"
              >
                <History size={11} />
                <span>Lịch sử chat</span>
              </button>

              <div style={{ height: "1px", backgroundColor: "var(--border-primary)", margin: "2px 0" }} />

              <button 
                onClick={() => { onBack(); setMenuOpen(false); }}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  color: "var(--text-secondary)",
                  fontSize: "11px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px"
                }}
                className="dropdown-item"
              >
                <ArrowLeft size={11} />
                <span>Quay lại Quản lý</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Seamless Chat Timeline */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "14px",
        display: "flex",
        flexDirection: "column",
        gap: "12px"
      }}>
        {chatHistory.map((item) => {
          const isUser = item.sender === "user";

          if (item.type === "agent_activity") {
            return (
              <div key={item.id} style={{
                padding: "8px 10px",
                backgroundColor: "var(--bg-primary)",
                border: "1px solid var(--border-primary)",
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                color: "var(--text-secondary)",
                lineHeight: "1.4",
                whiteSpace: "pre-wrap"
              }}>
                {item.text}
              </div>
            );
          }

          if (item.type === "tool_request") {
            return (
              <div key={item.id} style={{
                padding: "10px",
                backgroundColor: "var(--bg-primary)",
                border: "1px solid var(--border-primary)",
                display: "flex",
                flexDirection: "column",
                gap: "8px"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "9.5px", textTransform: "uppercase", fontWeight: 700, color: "var(--text-secondary)" }}>
                    ⚙️ Yêu cầu chạy công cụ
                  </span>
                  <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>{item.timestamp}</span>
                </div>
                <div style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "10.5px",
                  color: "var(--text-primary)",
                  backgroundColor: "var(--bg-secondary)",
                  padding: "6px 8px",
                  border: "1px solid var(--border-primary)",
                  wordBreak: "break-all"
                }}>
                  <strong>{item.toolName}</strong> {item.args}
                </div>

                {item.toolStatus === "waiting" && (
                  <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                    <button
                      onClick={() => handleRejectTool(item.id)}
                      style={{
                        padding: "4px 8px",
                        fontSize: "10.5px",
                        backgroundColor: "transparent",
                        border: "1px solid var(--border-primary)",
                        color: "var(--text-secondary)",
                        cursor: "pointer"
                      }}
                    >
                      Từ chối
                    </button>
                    <button
                      onClick={() => handleApproveTool(item.id)}
                      style={{
                        padding: "4px 8px",
                        fontSize: "10.5px",
                        backgroundColor: "var(--border-primary)",
                        border: "1px solid var(--border-primary)",
                        color: "var(--text-primary)",
                        fontWeight: 600,
                        cursor: "pointer"
                      }}
                    >
                      Đồng ý chạy
                    </button>
                  </div>
                )}

                {item.toolStatus === "approved" && (
                  <div style={{ fontSize: "10px", color: "var(--text-secondary)", textAlign: "right", fontStyle: "italic" }}>
                    ✓ Đã chấp thuận
                  </div>
                )}

                {item.toolStatus === "rejected" && (
                  <div style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "right", fontStyle: "italic" }}>
                    ✕ Đã từ chối
                  </div>
                )}
              </div>
            );
          }

          // Plain text messages (User or Agent)
          return (
            <div key={item.id} style={{
              display: "flex",
              flexDirection: "column",
              alignItems: isUser ? "flex-end" : "flex-start",
              maxWidth: "100%"
            }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                marginBottom: "2px",
                fontSize: "10px",
                color: "var(--text-secondary)"
              }}>
                <span>{isUser ? "Bạn" : "Agent"}</span>
                <span style={{ fontSize: "9px", opacity: 0.5 }}>• {item.timestamp}</span>
              </div>
              <div style={{
                backgroundColor: isUser ? "var(--bg-primary)" : "transparent",
                color: "var(--text-primary)",
                padding: isUser ? "6px 10px" : "0px",
                fontSize: "12px",
                lineHeight: "1.4",
                whiteSpace: "pre-wrap",
                border: isUser ? "1px solid var(--border-primary)" : "none",
                maxWidth: "100%"
              }}>
                {item.text}
              </div>
            </div>
          );
        })}

        {isTyping && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {activeTool.status === "executing" ? (
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 12px",
                backgroundColor: "rgba(255, 255, 255, 0.03)",
                border: "1px solid var(--border-primary)",
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                color: "var(--text-primary)",
                boxShadow: "0 2px 8px rgba(0,0,0,0.3)"
              }}>
                <RefreshCw size={12} className="animate-spin" style={{ color: "var(--text-secondary)", marginRight: "4px" }} />
                <span>AI đang chạy công cụ: <strong style={{ color: "var(--text-primary)" }}>{activeTool.tool_name}</strong></span>
                <span style={{ fontSize: "10px", color: "var(--text-muted)", wordBreak: "break-all" }}>
                  ({activeTool.args})
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "4px", fontSize: "10px", color: "var(--text-muted)" }}>
                <span>Agent đang xử lý...</span>
              </div>
            )}
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input Bar & Advanced Controls Panel */}
      <div style={{
        padding: "10px 14px",
        borderTop: "1px solid var(--border-primary)",
        backgroundColor: "var(--bg-secondary)",
        display: "flex",
        flexDirection: "column",
        gap: "8px"
      }}>
        {/* Capabilities Panel */}
        {capsOpen && (
          <div style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "5px",
            paddingBottom: "8px",
            borderBottom: "1px solid var(--border-primary)",
            marginBottom: "2px"
          }}>
            {capList.map((item) => {
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => toggleCapability(item.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "3px 8px",
                    fontSize: "10px",
                    borderRadius: "3px",
                    border: item.isActive 
                      ? "1px solid var(--text-primary)" 
                      : "1px solid var(--border-primary)",
                    backgroundColor: item.isActive 
                      ? "var(--bg-tertiary)" 
                      : "transparent",
                    color: item.isActive ? "var(--text-primary)" : "var(--text-secondary)",
                    cursor: "pointer",
                    transition: "all 0.1s ease-in-out",
                    outline: "none",
                    boxSizing: "border-box"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = item.isActive 
                      ? "var(--border-primary)" 
                      : "rgba(255, 255, 255, 0.04)";
                    if (!item.isActive) {
                      e.currentTarget.style.borderColor = "var(--text-muted)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = item.isActive 
                      ? "var(--bg-tertiary)" 
                      : "transparent";
                    e.currentTarget.style.borderColor = item.isActive 
                      ? "var(--text-primary)" 
                      : "var(--border-primary)";
                  }}
                >
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Dynamic Auto-Resizing Textarea Row */}
        <form onSubmit={handleSend} style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "8px"
        }}>
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="Gửi tin nhắn hoặc ra lệnh..."
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isTyping}
            style={{
              flex: 1,
              backgroundColor: "var(--bg-primary)",
              border: "1px solid var(--border-primary)",
              color: "var(--text-primary)",
              padding: "7px 10px",
              fontSize: "12px",
              outline: "none",
              resize: "none",
              fontFamily: "var(--font-sans)",
              lineHeight: "1.4",
              maxHeight: "180px",
              minHeight: "32px",
              overflowY: "auto"
            }}
          />
          <button
            type="submit"
            disabled={!inputVal.trim() || isTyping}
            style={{
              backgroundColor: "transparent",
              border: "1px solid var(--border-primary)",
              color: inputVal.trim() && !isTyping ? "var(--text-primary)" : "var(--text-muted)",
              height: "32px",
              padding: "0 12px",
              fontSize: "11.5px",
              cursor: inputVal.trim() && !isTyping ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <Send size={12} />
          </button>
        </form>

        {/* Feature Toolbars: Model & Agent Mode Selection */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          paddingTop: "4px",
          borderTop: "1px solid rgba(255,255,255,0.02)"
        }}>
          {/* Capabilities toggle button */}
          <button
            type="button"
            title="Thiết lập quyền và môi trường chạy"
            onClick={() => setCapsOpen(!capsOpen)}
            style={{
              backgroundColor: capsOpen ? "var(--bg-tertiary)" : "var(--bg-primary)",
              border: "1px solid var(--border-primary)",
              color: capsOpen ? "var(--text-primary)" : "var(--text-secondary)",
              width: "20.5px",
              height: "20.5px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.12s ease-in-out",
              outline: "none",
              boxSizing: "border-box",
              padding: "0"
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--border-primary)"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = capsOpen ? "var(--bg-tertiary)" : "var(--bg-primary)"}
          >
            <Sliders size={11} style={{ transform: capsOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s ease", color: capsOpen ? "var(--text-primary)" : "var(--text-secondary)" }} />
          </button>
          {/* Model Selector dropdown */}
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            style={{
              backgroundColor: "var(--bg-primary)",
              border: "1px solid var(--border-primary)",
              color: "var(--text-secondary)",
              fontSize: "10.5px",
              padding: "2px 6px",
              outline: "none",
              cursor: "pointer"
            }}
          >
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>

          {/* Agent Mode selector dropdown */}
          <select
            value={selectedMode}
            onChange={(e) => setSelectedMode(e.target.value)}
            style={{
              backgroundColor: "var(--bg-primary)",
              border: "1px solid var(--border-primary)",
              color: "var(--text-secondary)",
              fontSize: "10.5px",
              padding: "2px 6px",
              outline: "none",
              cursor: "pointer"
            }}
          >
            <option value="interactive">Interactive (Hỏi trước)</option>
            <option value="autonomous">Autonomous (Tự trị)</option>
            <option value="copilot">Copilot (Gợi ý)</option>
          </select>
        </div>
      </div>
    </div>
  );
}
