import React, { useState, useRef, useEffect } from "react";
import { Plus, Send, RefreshCw, Layers, History, ArrowLeft } from "lucide-react";

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
}

export default function AiAgent({ onBack }: AiAgentProps) {
  const [chatHistory, setChatHistory] = useState<ChatItem[]>([
    {
      id: "1",
      type: "text",
      sender: "agent",
      text: "Xin chào! Tôi là AI Agent đồng hành cùng dự án. Mọi tiến trình tự trị, kế hoạch tác vụ và yêu cầu cấp quyền chạy công cụ sẽ được ghi nhận và phê duyệt trực tiếp ngay trong luồng hội thoại này.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
    {
      id: "2",
      type: "agent_activity",
      sender: "agent",
      text: "🔍 Đang khởi chạy quy trình quét d:\\alouette-server...\n📄 Phân tích cấu trúc thư mục và quy tắc AI.json thành công.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
    {
      id: "3",
      type: "tool_request",
      sender: "agent",
      toolName: "port_scanner::check_port",
      args: "{ port: 3000, host: '127.0.0.1' }",
      toolStatus: "waiting",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
  ]);

  const [inputVal, setInputVal] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [selectedModel, setSelectedModel] = useState("gemini-1.5-pro");
  const [selectedMode, setSelectedMode] = useState("interactive");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("Agent Active Session #1");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Auto scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isTyping]);

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

  const handleSend = (e: React.FormEvent) => {
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
    setInputVal("");
    setIsTyping(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    setTimeout(() => {
      setIsTyping(false);
      const agentReply: ChatItem = {
        id: (Date.now() + 1).toString(),
        type: "text",
        sender: "agent",
        text: `Đã ghi nhận yêu cầu chạy ở chế độ [${selectedMode === "autonomous" ? "Tự trị (Autonomous)" : "Hỏi trước (Interactive)"}] bằng mô hình [${selectedModel.toUpperCase()}]. Hệ thống đang liên tục giám sát an toàn.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatHistory((prev) => [...prev, agentReply]);
    }, 1000);
  };

  const handleApproveTool = (id: string) => {
    setChatHistory((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, toolStatus: "approved" as const } : item
      )
    );

    const approvedItem = chatHistory.find((item) => item.id === id);
    
    setTimeout(() => {
      const toolSuccessMsg: ChatItem = {
        id: Date.now().toString(),
        type: "agent_activity",
        sender: "agent",
        text: `✓ Đã chạy thành công công cụ: ${approvedItem?.toolName}\nKết quả: Port 3000 đang được liên kết sạch sẽ bởi PID 8420.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatHistory((prev) => [...prev, toolSuccessMsg]);
    }, 400);
  };

  const handleRejectTool = (id: string) => {
    setChatHistory((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, toolStatus: "rejected" as const } : item
      )
    );
  };

  const handleNewChat = () => {
    setChatHistory([
      {
        id: Date.now().toString(),
        type: "text",
        sender: "agent",
        text: "Timeline đã được làm mới sạch sẽ. Hãy đặt câu hỏi hoặc ra lệnh để Agent bắt đầu quy trình làm việc tự trị.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }
    ]);
    setSessionTitle(`Agent Active Session #${Math.floor(Math.random() * 100) + 1}`);
    setMenuOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

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
          <div style={{ display: "flex", gap: "4px", fontSize: "10px", color: "var(--text-muted)" }}>
            <span>Agent đang xử lý...</span>
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
            <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
            <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
            <option value="claude-3.5-sonnet">Claude 3.5 Sonnet</option>
            <option value="gpt-4o">GPT-4o</option>
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
