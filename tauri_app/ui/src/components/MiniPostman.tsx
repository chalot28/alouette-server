import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Send,
  Trash2,
  Clock,
  Database,
  History,
  Globe,
  FolderHeart,
  Save,
  Search,
  Activity,
  CheckCircle2,
  XCircle,
  Minus,
  Square,
  X
} from "lucide-react";

interface HeaderItem {
  key: string;
  value: string;
  enabled: boolean;
}

interface QueryParam {
  key: string;
  value: string;
  enabled: boolean;
}

interface HistoryItem {
  id: string;
  name?: string;
  method: string;
  url: string;
  headers: { [key: string]: string };
  body: string;
  bodyType: string;
  timestamp: number;
  auth?: {
    type: string;
    bearerToken?: string;
    basicUsername?: string;
    basicPassword?: string;
    apiKeyName?: string;
    apiKeyValue?: string;
    apiKeyAddto?: string;
  };
  tests?: {
    status200: boolean;
    latencyUnder200: boolean;
    containsText: boolean;
    containsTextString: string;
    isValidJson: boolean;
  };
  response?: {
    status: number;
    statusText: string;
    elapsedMs: number;
    sizeBytes: number;
    body: string;
    testResults?: {
      name: string;
      passed: boolean;
    }[];
  };
}

export default function MiniPostman() {
  const appWindow = getCurrentWindow();

  const handleMinimize = async () => {
    try {
      await appWindow.minimize();
    } catch (e) {
      console.error("Minimize error:", e);
    }
  };

  const handleMaximize = async () => {
    try {
      await appWindow.toggleMaximize();
    } catch (e) {
      console.error("Maximize error:", e);
    }
  };

  const handleClose = async () => {
    try {
      await appWindow.close();
    } catch (e) {
      console.error("Close error:", e);
    }
  };

  // Request States
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("https://httpbin.org/get");
  const [queryParams, setQueryParams] = useState<QueryParam[]>([
    { key: "", value: "", enabled: true }
  ]);
  const [headers, setHeaders] = useState<HeaderItem[]>([
    { key: "Accept", value: "*/*", enabled: true },
    { key: "", value: "", enabled: true }
  ]);
  const [bodyType, setBodyType] = useState("none"); // "none", "json", "text", "urlencoded"
  const [body, setBody] = useState("");
  const [timeoutMs, setTimeoutMs] = useState<number>(30000);

  // Authorization States
  const [authType, setAuthType] = useState("none"); // "none", "bearer", "basic", "apikey"
  const [bearerToken, setBearerToken] = useState("");
  const [basicUsername, setBasicUsername] = useState("");
  const [basicPassword, setBasicPassword] = useState("");
  const [apiKeyName, setApiKeyName] = useState("");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [apiKeyAddto, setApiKeyAddto] = useState("header"); // "header", "query"

  // Testing States
  const [assertStatus200, setAssertStatus200] = useState(false);
  const [assertLatencyUnder200, setAssertLatencyUnder200] = useState(false);
  const [assertContainsText, setAssertContainsText] = useState(false);
  const [assertContainsTextString, setAssertContainsTextString] = useState("");
  const [assertIsValidJson, setAssertIsValidJson] = useState(false);

  // Active Tabs
  const [reqTab, setReqTab] = useState<"params" | "headers" | "body" | "auth" | "tests" | "settings">("params");
  const [resTab, setResTab] = useState<"body" | "headers" | "tests">("body");

  // Loading & Response States
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<{
    status: number;
    statusText: string;
    elapsedMs: number;
    sizeBytes: number;
    headers: { [key: string]: string };
    body: string;
    testResults?: { name: string; passed: boolean }[];
  } | null>(null);
  const [reqError, setReqError] = useState<string | null>(null);

  // History & Saved states
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [savedRequests, setSavedRequests] = useState<HistoryItem[]>([]);
  const [sidebarTab, setSidebarTab] = useState<"history" | "saved">("history");
  const [searchQuery, setSearchQuery] = useState("");
  const [saveName, setSaveName] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);

  // Sync query params list with URL string
  useEffect(() => {
    try {
      const urlObj = new URL(url);
      const params: QueryParam[] = [];
      urlObj.searchParams.forEach((value, key) => {
        params.push({ key, value, enabled: true });
      });
      // Append an empty row for new additions
      params.push({ key: "", value: "", enabled: true });
      setQueryParams(params);
    } catch (e) {
      // If URL is partial, don't break
    }
  }, []);

  // Update URL string when query params list changes
  const updateUrlFromParams = (paramsList: QueryParam[]) => {
    try {
      const parsedUrl = new URL(url.split("?")[0]);
      paramsList.forEach((param) => {
        if (param.enabled && param.key) {
          parsedUrl.searchParams.append(param.key, param.value);
        }
      });
      setUrl(parsedUrl.toString());
    } catch (e) {
      const baseUrl = url.split("?")[0];
      const qs = paramsList
        .filter((p) => p.enabled && p.key)
        .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
        .join("&");
      setUrl(baseUrl + (qs ? `?${qs}` : ""));
    }
  };

  // Load history & saved from localStorage
  useEffect(() => {
    const loadedHistory = localStorage.getItem("postman_history");
    if (loadedHistory) {
      setHistory(JSON.parse(loadedHistory));
    }
    const loadedSaved = localStorage.getItem("postman_saved");
    if (loadedSaved) {
      setSavedRequests(JSON.parse(loadedSaved));
    }
  }, []);

  // Save history helper
  const saveHistory = (newHistory: HistoryItem[]) => {
    setHistory(newHistory);
    localStorage.setItem("postman_history", JSON.stringify(newHistory));
  };

  // Base64 helper for Basic Auth
  const toBase64 = (str: string): string => {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
      return str;
    }
  };

  // Send request trigger
  const handleSend = async () => {
    if (!url.trim()) {
      setReqError("URL cannot be empty");
      return;
    }

    setIsLoading(true);
    setReqError(null);
    setResponse(null);

    // 1. Build Headers Map
    const headersMap: { [key: string]: string } = {};
    headers.forEach((h) => {
      if (h.enabled && h.key.trim()) {
        headersMap[h.key.trim()] = h.value;
      }
    });

    let finalUrl = url.trim();

    // 2. Inject Authorization Credentials
    if (authType === "bearer" && bearerToken.trim()) {
      headersMap["Authorization"] = `Bearer ${bearerToken.trim()}`;
    } else if (authType === "basic" && (basicUsername.trim() || basicPassword.trim())) {
      const encoded = toBase64(`${basicUsername}:${basicPassword}`);
      headersMap["Authorization"] = `Basic ${encoded}`;
    } else if (authType === "apikey" && apiKeyName.trim() && apiKeyValue.trim()) {
      if (apiKeyAddto === "header") {
        headersMap[apiKeyName.trim()] = apiKeyValue.trim();
      } else {
        try {
          const urlObj = new URL(finalUrl);
          urlObj.searchParams.append(apiKeyName.trim(), apiKeyValue.trim());
          finalUrl = urlObj.toString();
        } catch (e) {
          finalUrl += (finalUrl.includes("?") ? "&" : "?") + `${encodeURIComponent(apiKeyName.trim())}=${encodeURIComponent(apiKeyValue.trim())}`;
        }
      }
    }

    // Make sure JSON body is valid if selected
    if (bodyType === "json" && body.trim()) {
      try {
        JSON.parse(body);
      } catch (e) {
        setReqError("Invalid JSON in Request Body");
        setIsLoading(false);
        return;
      }
    }

    try {
      const res: any = await invoke("send_http_request", {
        req: {
          url: finalUrl,
          method,
          headers: headersMap,
          body: bodyType !== "none" ? body : null,
          body_type: bodyType,
          timeout_ms: timeoutMs || null
        }
      });

      // 3. Evaluate Assertions / Tests
      const testResults: { name: string; passed: boolean }[] = [];
      
      if (assertStatus200) {
        testResults.push({
          name: "Status is 200 OK",
          passed: res.status === 200
        });
      }

      if (assertLatencyUnder200) {
        testResults.push({
          name: `Response time is under 200ms (Actual: ${res.elapsed_ms}ms)`,
          passed: res.elapsed_ms < 200
        });
      }

      if (assertIsValidJson) {
        let isJson = false;
        try {
          JSON.parse(res.body);
          isJson = true;
        } catch (e) {}
        testResults.push({
          name: "Response body is valid JSON",
          passed: isJson
        });
      }

      if (assertContainsText && assertContainsTextString.trim()) {
        const containsStr = assertContainsTextString.trim();
        testResults.push({
          name: `Response body contains string "${containsStr}"`,
          passed: res.body.includes(containsStr)
        });
      }

      const responseData = {
        status: res.status,
        statusText: res.status_text,
        elapsedMs: res.elapsed_ms,
        sizeBytes: res.size_bytes,
        headers: res.headers,
        body: res.body,
        testResults: testResults.length > 0 ? testResults : undefined
      };

      setResponse(responseData);
      if (testResults.length > 0) {
        setResTab("tests");
      } else {
        setResTab("body");
      }

      // 4. Add to history log
      const historyItem: HistoryItem = {
        id: Math.random().toString(36).substring(7),
        method,
        url: url.trim(),
        headers: headersMap,
        body: bodyType !== "none" ? body : "",
        bodyType,
        timestamp: Date.now(),
        auth: authType !== "none" ? {
          type: authType,
          bearerToken,
          basicUsername,
          basicPassword,
          apiKeyName,
          apiKeyValue,
          apiKeyAddto
        } : undefined,
        tests: {
          status200: assertStatus200,
          latencyUnder200: assertLatencyUnder200,
          containsText: assertContainsText,
          containsTextString: assertContainsTextString,
          isValidJson: assertIsValidJson
        },
        response: {
          status: res.status,
          statusText: res.status_text,
          elapsedMs: res.elapsed_ms,
          sizeBytes: res.size_bytes,
          body: res.body,
          testResults: testResults.length > 0 ? testResults : undefined
        }
      };

      const updatedHistory = [historyItem, ...history.slice(0, 49)];
      saveHistory(updatedHistory);

    } catch (err: any) {
      setReqError(err.toString());
    } finally {
      setIsLoading(false);
    }
  };

  // Load request details from saved list/history
  const loadRequest = (item: HistoryItem) => {
    setMethod(item.method);
    setUrl(item.url);
    setBody(item.body);
    setBodyType(item.bodyType);

    // Restore Auth
    if (item.auth) {
      setAuthType(item.auth.type);
      setBearerToken(item.auth.bearerToken || "");
      setBasicUsername(item.auth.basicUsername || "");
      setBasicPassword(item.auth.basicPassword || "");
      setApiKeyName(item.auth.apiKeyName || "");
      setApiKeyValue(item.auth.apiKeyValue || "");
      setApiKeyAddto(item.auth.apiKeyAddto || "header");
    } else {
      setAuthType("none");
      setBearerToken("");
      setBasicUsername("");
      setBasicPassword("");
      setApiKeyName("");
      setApiKeyValue("");
      setApiKeyAddto("header");
    }

    // Restore Tests
    if (item.tests) {
      setAssertStatus200(item.tests.status200);
      setAssertLatencyUnder200(item.tests.latencyUnder200);
      setAssertContainsText(item.tests.containsText);
      setAssertContainsTextString(item.tests.containsTextString || "");
      setAssertIsValidJson(item.tests.isValidJson);
    } else {
      setAssertStatus200(false);
      setAssertLatencyUnder200(false);
      setAssertContainsText(false);
      setAssertContainsTextString("");
      setAssertIsValidJson(false);
    }

    // Map headers array
    const mappedHeaders: HeaderItem[] = Object.entries(item.headers).map(([key, value]) => ({
      key,
      value,
      enabled: true
    }));
    mappedHeaders.push({ key: "", value: "", enabled: true });
    setHeaders(mappedHeaders);

    // Load Response history if available
    if (item.response) {
      setResponse({
        status: item.response.status,
        statusText: item.response.statusText,
        elapsedMs: item.response.elapsedMs,
        sizeBytes: item.response.sizeBytes,
        headers: {},
        body: item.response.body,
        testResults: item.response.testResults
      });
      setReqError(null);
      if (item.response.testResults && item.response.testResults.length > 0) {
        setResTab("tests");
      } else {
        setResTab("body");
      }
    } else {
      setResponse(null);
    }
  };

  // Save active configuration to Saved templates
  const handleSave = () => {
    if (!saveName.trim()) return;

    const headersMap: { [key: string]: string } = {};
    headers.forEach((h) => {
      if (h.enabled && h.key.trim()) {
        headersMap[h.key.trim()] = h.value;
      }
    });

    const newSave: HistoryItem = {
      id: Math.random().toString(36).substring(7),
      name: saveName.trim(),
      method,
      url,
      headers: headersMap,
      body: bodyType !== "none" ? body : "",
      bodyType,
      timestamp: Date.now(),
      auth: authType !== "none" ? {
        type: authType,
        bearerToken,
        basicUsername,
        basicPassword,
        apiKeyName,
        apiKeyValue,
        apiKeyAddto
      } : undefined,
      tests: {
        status200: assertStatus200,
        latencyUnder200: assertLatencyUnder200,
        containsText: assertContainsText,
        containsTextString: assertContainsTextString,
        isValidJson: assertIsValidJson
      }
    };

    const newSaved = [newSave, ...savedRequests];
    setSavedRequests(newSaved);
    localStorage.setItem("postman_saved", JSON.stringify(newSaved));
    setSaveName("");
    setShowSaveModal(false);
  };

  const deleteSavedItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSaved = savedRequests.filter((item) => item.id !== id);
    setSavedRequests(newSaved);
    localStorage.setItem("postman_saved", JSON.stringify(newSaved));
  };

  const clearHistory = () => {
    saveHistory([]);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const dm = 2;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  const getFormattedBody = (rawBody: string) => {
    try {
      const obj = JSON.parse(rawBody);
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return rawBody;
    }
  };

  // Filtered queries
  const filteredHistory = history.filter(
    (item) =>
      item.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.method.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredSaved = savedRequests.filter(
    (item) =>
      (item.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.url.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="postman-container" style={{ flexDirection: "column" }}>
      {/* Custom Titlebar for Borderless Popout window */}
      <div className="postman-window-titlebar" data-tauri-drag-region>
        <div className="titlebar-left" data-tauri-drag-region>
          <Globe size={13} className="titlebar-icon" style={{ color: "var(--color-accent)" }} />
          <span className="titlebar-title">Mini Postman</span>
          <span className="titlebar-subtitle">Connection Diagnostics</span>
        </div>
        
        <div className="titlebar-right">
          <button className="window-control-btn minimize" onClick={handleMinimize} title="Minimize">
            <Minus size={13} />
          </button>
          <button className="window-control-btn maximize" onClick={handleMaximize} title="Maximize">
            <Square size={10} />
          </button>
          <button className="window-control-btn close" onClick={handleClose} title="Close">
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="postman-main-layout" style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar Panel - History & Saved Collections */}
        <div className="postman-sidebar">
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab ${sidebarTab === "history" ? "active" : ""}`}
            onClick={() => setSidebarTab("history")}
          >
            <History size={12} />
            <span>History</span>
          </button>
          <button
            className={`sidebar-tab ${sidebarTab === "saved" ? "active" : ""}`}
            onClick={() => setSidebarTab("saved")}
          >
            <FolderHeart size={12} />
            <span>Saved</span>
          </button>
        </div>

        <div className="sidebar-search">
          <div className="search-input-wrapper">
            <Search size={11} className="search-icon" />
            <input
              type="text"
              placeholder={`Filter ${sidebarTab}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="sidebar-list">
          {sidebarTab === "history" ? (
            filteredHistory.length > 0 ? (
              <>
                {filteredHistory.map((item) => (
                  <div
                    key={item.id}
                    className="sidebar-item"
                    onClick={() => loadRequest(item)}
                  >
                    <div className="item-meta">
                      <span className={`method-badge ${item.method.toLowerCase()}`}>
                        {item.method}
                      </span>
                      {item.response && (
                        <span className={`status-badge ${item.response.status >= 200 && item.response.status < 300 ? "success" : "error"}`}>
                          {item.response.status}
                        </span>
                      )}
                    </div>
                    <div className="item-url" title={item.url}>
                      {item.url}
                    </div>
                    <div className="item-time">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
                <button className="btn-clear-history" onClick={clearHistory}>
                  Clear History
                </button>
              </>
            ) : (
              <div className="empty-state">No request history</div>
            )
          ) : filteredSaved.length > 0 ? (
            filteredSaved.map((item) => (
              <div
                key={item.id}
                className="sidebar-item saved"
                onClick={() => loadRequest(item)}
              >
                <div className="saved-header">
                  <div className="saved-name font-bold">
                    {item.name}
                  </div>
                  <button
                    className="delete-saved-btn"
                    onClick={(e) => deleteSavedItem(item.id, e)}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                <div className="saved-meta">
                  <span className={`method-badge ${item.method.toLowerCase()}`}>
                    {item.method}
                  </span>
                  <span className="saved-url" title={item.url}>
                    {item.url}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">No saved templates</div>
          )}
        </div>
      </div>

      {/* Main Request Workspace Panel (Entire top brand header completely removed as requested) */}
      <div className="postman-main-workspace">
        {/* Compact Request sending Bar (Merged Save Template here to preserve space!) */}
        <div className="request-bar">
          <select
            className="method-select"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
            <option value="PATCH">PATCH</option>
            <option value="OPTIONS">OPTIONS</option>
            <option value="HEAD">HEAD</option>
          </select>

          <input
            type="text"
            className="url-input"
            placeholder="Enter request URL (e.g. http://localhost:8080/api or https://httpbin.org/get)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
          />

          <button
            className="btn btn-secondary"
            onClick={() => setShowSaveModal(true)}
            title="Save Request Template"
            style={{ height: "32px", padding: "0 10px" }}
          >
            <Save size={14} />
          </button>

          <button
            className="btn btn-primary send-btn"
            onClick={handleSend}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Activity size={14} className="animate-spin" />
                <span>Sending...</span>
              </>
            ) : (
              <>
                <Send size={13} />
                <span>Send</span>
              </>
            )}
          </button>
        </div>

        {/* Setup Configuration Workspace */}
        <div className="postman-workspace-tabs">
          <div className="tabs-bar">
            <button
              className={`tab-item ${reqTab === "params" ? "active" : ""}`}
              onClick={() => setReqTab("params")}
            >
              Params ({queryParams.filter((p) => p.key).length})
            </button>
            <button
              className={`tab-item ${reqTab === "auth" ? "active" : ""}`}
              onClick={() => setReqTab("auth")}
            >
              Auth {authType !== "none" && `(${authType})`}
            </button>
            <button
              className={`tab-item ${reqTab === "headers" ? "active" : ""}`}
              onClick={() => setReqTab("headers")}
            >
              Headers ({headers.filter((h) => h.key).length})
            </button>
            <button
              className={`tab-item ${reqTab === "body" ? "active" : ""}`}
              onClick={() => setReqTab("body")}
            >
              Body {bodyType !== "none" && `(${bodyType})`}
            </button>
            <button
              className={`tab-item ${reqTab === "tests" ? "active" : ""}`}
              onClick={() => setReqTab("tests")}
            >
              Tests
            </button>
            <button
              className={`tab-item ${reqTab === "settings" ? "active" : ""}`}
              onClick={() => setReqTab("settings")}
            >
              Settings
            </button>
          </div>

          <div className="tabs-content">
            {/* 1. QUERY PARAMS TAB */}
            {reqTab === "params" && (
              <div className="params-tab flex flex-col gap-2">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th style={{ width: "30px" }}></th>
                      <th>Key</th>
                      <th>Value</th>
                      <th style={{ width: "40px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {queryParams.map((param, index) => (
                      <tr key={index}>
                        <td align="center">
                          <input
                            type="checkbox"
                            checked={param.enabled}
                            onChange={(e) => {
                              const updated = [...queryParams];
                              updated[index].enabled = e.target.checked;
                              setQueryParams(updated);
                              updateUrlFromParams(updated);
                            }}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            placeholder="Parameter Name"
                            value={param.key}
                            onChange={(e) => {
                              const updated = [...queryParams];
                              updated[index].key = e.target.value;
                              if (index === queryParams.length - 1 && e.target.value) {
                                updated.push({ key: "", value: "", enabled: true });
                              }
                              setQueryParams(updated);
                              updateUrlFromParams(updated);
                            }}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            placeholder="Parameter Value"
                            value={param.value}
                            onChange={(e) => {
                              const updated = [...queryParams];
                              updated[index].value = e.target.value;
                              setQueryParams(updated);
                              updateUrlFromParams(updated);
                            }}
                          />
                        </td>
                        <td align="center">
                          {index < queryParams.length - 1 && (
                            <button
                              className="delete-row-btn"
                              onClick={() => {
                                const updated = queryParams.filter((_, idx) => idx !== index);
                                setQueryParams(updated);
                                updateUrlFromParams(updated);
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 2. AUTHORIZATION TAB (API Key, Bearer Token, Basic Auth) */}
            {reqTab === "auth" && (
              <div className="auth-tab flex flex-col gap-3" style={{ padding: "4px 0" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-secondary">Auth Type:</span>
                  <select
                    className="method-select"
                    style={{ height: "28px", padding: "0 6px", fontSize: "11.5px" }}
                    value={authType}
                    onChange={(e) => setAuthType(e.target.value)}
                  >
                    <option value="none">No Auth</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="basic">Basic Auth</option>
                    <option value="apikey">API Key</option>
                  </select>
                </div>

                {authType === "bearer" && (
                  <div className="flex flex-col gap-1 max-w-md">
                    <label className="text-xxs font-bold text-muted uppercase">Bearer Token</label>
                    <input
                      type="text"
                      className="url-input"
                      style={{ fontFamily: "inherit" }}
                      placeholder="Paste authorization token here..."
                      value={bearerToken}
                      onChange={(e) => setBearerToken(e.target.value)}
                    />
                  </div>
                )}

                {authType === "basic" && (
                  <div className="flex gap-3 max-w-lg">
                    <div className="flex-1 flex flex-col gap-1">
                      <label className="text-xxs font-bold text-muted uppercase">Username</label>
                      <input
                        type="text"
                        className="url-input"
                        style={{ fontFamily: "inherit" }}
                        placeholder="Username"
                        value={basicUsername}
                        onChange={(e) => setBasicUsername(e.target.value)}
                      />
                    </div>
                    <div className="flex-1 flex flex-col gap-1">
                      <label className="text-xxs font-bold text-muted uppercase">Password</label>
                      <input
                        type="password"
                        className="url-input"
                        style={{ fontFamily: "inherit" }}
                        placeholder="Password"
                        value={basicPassword}
                        onChange={(e) => setBasicPassword(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {authType === "apikey" && (
                  <div className="flex flex-col gap-3 max-w-xl">
                    <div className="flex gap-3">
                      <div className="flex-1 flex flex-col gap-1">
                        <label className="text-xxs font-bold text-muted uppercase">Key Name</label>
                        <input
                          type="text"
                          className="url-input"
                          placeholder="e.g. X-API-Key"
                          value={apiKeyName}
                          onChange={(e) => setApiKeyName(e.target.value)}
                        />
                      </div>
                      <div className="flex-1 flex flex-col gap-1">
                        <label className="text-xxs font-bold text-muted uppercase">Key Value</label>
                        <input
                          type="text"
                          className="url-input"
                          placeholder="API value..."
                          value={apiKeyValue}
                          onChange={(e) => setApiKeyValue(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-secondary">Add key to:</span>
                      <label className="flex items-center gap-1 cursor-pointer text-xs">
                        <input
                          type="radio"
                          name="apiKeyAddto"
                          checked={apiKeyAddto === "header"}
                          onChange={() => setApiKeyAddto("header")}
                        />
                        <span>Header</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer text-xs ml-2">
                        <input
                          type="radio"
                          name="apiKeyAddto"
                          checked={apiKeyAddto === "query"}
                          onChange={() => setApiKeyAddto("query")}
                        />
                        <span>Query Param</span>
                      </label>
                    </div>
                  </div>
                )}

                {authType === "none" && (
                  <div className="text-muted text-xs italic">
                    This request does not use any authorization headers or values.
                  </div>
                )}
              </div>
            )}

            {/* 3. HEADERS TAB */}
            {reqTab === "headers" && (
              <div className="headers-tab">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th style={{ width: "30px" }}></th>
                      <th>Header Name</th>
                      <th>Header Value</th>
                      <th style={{ width: "40px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {headers.map((header, index) => (
                      <tr key={index}>
                        <td align="center">
                          <input
                            type="checkbox"
                            checked={header.enabled}
                            onChange={(e) => {
                              const updated = [...headers];
                              updated[index].enabled = e.target.checked;
                              setHeaders(updated);
                            }}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            placeholder="Header (e.g. Content-Type)"
                            value={header.key}
                            onChange={(e) => {
                              const updated = [...headers];
                              updated[index].key = e.target.value;
                              if (index === headers.length - 1 && e.target.value) {
                                updated.push({ key: "", value: "", enabled: true });
                              }
                              setHeaders(updated);
                            }}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            placeholder="Header Value"
                            value={header.value}
                            onChange={(e) => {
                              const updated = [...headers];
                              updated[index].value = e.target.value;
                              setHeaders(updated);
                            }}
                          />
                        </td>
                        <td align="center">
                          {index < headers.length - 1 && (
                            <button
                              className="delete-row-btn"
                              onClick={() => {
                                const updated = headers.filter((_, idx) => idx !== index);
                                setHeaders(updated);
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 4. REQUEST BODY TAB */}
            {reqTab === "body" && (
              <div className="body-tab">
                <div className="body-type-selector">
                  <label className="body-type-option">
                    <input
                      type="radio"
                      name="bodyType"
                      checked={bodyType === "none"}
                      onChange={() => setBodyType("none")}
                    />
                    <span>None</span>
                  </label>
                  <label className="body-type-option">
                    <input
                      type="radio"
                      name="bodyType"
                      checked={bodyType === "json"}
                      onChange={() => setBodyType("json")}
                    />
                    <span>JSON (application/json)</span>
                  </label>
                  <label className="body-type-option">
                    <input
                      type="radio"
                      name="bodyType"
                      checked={bodyType === "text"}
                      onChange={() => setBodyType("text")}
                    />
                    <span>Text (text/plain)</span>
                  </label>
                  <label className="body-type-option">
                    <input
                      type="radio"
                      name="bodyType"
                      checked={bodyType === "urlencoded"}
                      onChange={() => setBodyType("urlencoded")}
                    />
                    <span>x-www-form-urlencoded</span>
                  </label>
                </div>

                {bodyType !== "none" && (
                  <div className="body-editor-wrapper">
                    <textarea
                      className="body-textarea mono"
                      placeholder={
                        bodyType === "json"
                          ? '{\n  "key": "value"\n}'
                          : bodyType === "urlencoded"
                          ? "key1=value1&key2=value2"
                          : "Enter request body..."
                      }
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={6}
                    />
                  </div>
                )}
              </div>
            )}

            {/* 5. TESTS / ASSERTIONS TAB (New API simulation testing!) */}
            {reqTab === "tests" && (
              <div className="tests-tab flex flex-col gap-3" style={{ padding: "4px 0" }}>
                <div className="text-secondary text-xs font-bold mb-1">
                  Select active response assertions to validate API behaviors:
                </div>
                
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={assertStatus200}
                      onChange={(e) => setAssertStatus200(e.target.checked)}
                    />
                    <span className="font-semibold">Validate Status Code is 200 OK</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={assertLatencyUnder200}
                      onChange={(e) => setAssertLatencyUnder200(e.target.checked)}
                    />
                    <span className="font-semibold">Validate Response Latency is under 200ms</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={assertIsValidJson}
                      onChange={(e) => setAssertIsValidJson(e.target.checked)}
                    />
                    <span className="font-semibold">Validate Response Body is a valid JSON document</span>
                  </label>

                  <div className="flex flex-col gap-1 mt-1">
                    <label className="flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={assertContainsText}
                        onChange={(e) => setAssertContainsText(e.target.checked)}
                      />
                      <span className="font-semibold">Validate Response Body contains matching text string:</span>
                    </label>
                    {assertContainsText && (
                      <input
                        type="text"
                        className="url-input max-w-md"
                        style={{ height: "26px", fontSize: "11.5px" }}
                        placeholder="e.g. success, user_id, 2026..."
                        value={assertContainsTextString}
                        onChange={(e) => setAssertContainsTextString(e.target.value)}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 6. SETTINGS TAB */}
            {reqTab === "settings" && (
              <div className="settings-tab flex flex-col gap-4">
                <div className="settings-item flex flex-col gap-1">
                  <label className="font-bold text-xs">Request Timeout (milliseconds)</label>
                  <input
                    type="number"
                    style={{
                      backgroundColor: "var(--bg-primary)",
                      border: "1px solid var(--border-primary)",
                      color: "var(--text-primary)",
                      padding: "6px 12px",
                      fontSize: "12px",
                      width: "160px"
                    }}
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(parseInt(e.target.value) || 0)}
                  />
                  <span className="text-muted text-xxs">Max time to wait for a socket response. Defaults to 30000ms.</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Response View Area */}
        <div className="postman-response-section">
          {/* Status Details Bar */}
          {response && (
            <div className="response-status-bar">
              <div className="status-meta">
                <span className={`status-code ${response.status >= 200 && response.status < 300 ? "success" : "error"}`}>
                  {response.status} {response.statusText}
                </span>
                <span className="meta-capsule">
                  <Clock size={11} />
                  <span>{response.elapsedMs} ms</span>
                </span>
                <span className="meta-capsule">
                  <Database size={11} />
                  <span>{formatBytes(response.sizeBytes)}</span>
                </span>
              </div>

              <div className="response-tabs">
                <button
                  className={`res-tab-btn ${resTab === "body" ? "active" : ""}`}
                  onClick={() => setResTab("body")}
                >
                  Response Body
                </button>
                <button
                  className={`res-tab-btn ${resTab === "headers" ? "active" : ""}`}
                  onClick={() => setResTab("headers")}
                >
                  Headers
                </button>
                {response.testResults && (
                  <button
                    className={`res-tab-btn ${resTab === "tests" ? "active" : ""}`}
                    onClick={() => setResTab("tests")}
                  >
                    Tests ({response.testResults.filter(t => t.passed).length}/{response.testResults.length})
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Response Main viewport */}
          <div className="response-viewport">
            {isLoading && (
              <div className="response-loader-overlay">
                <Activity size={24} className="animate-spin text-accent" />
                <span className="text-secondary font-bold text-xs mt-2">Invoking Web Request Socket...</span>
              </div>
            )}

            {reqError && (
              <div className="response-error">
                <h4 className="text-danger font-bold text-sm">Failed to complete request</h4>
                <pre className="mono text-xs">{reqError}</pre>
              </div>
            )}

            {!isLoading && !response && !reqError && (
              <div className="response-placeholder">
                <Globe size={32} className="text-muted" />
                <span className="text-muted text-xs mt-3">Click "Send" above to invoke the request socket</span>
              </div>
            )}

            {response && !isLoading && (
              <>
                {resTab === "body" && (
                  <div className="body-view-wrapper">
                    <textarea
                      readOnly
                      className="response-textarea mono"
                      value={getFormattedBody(response.body)}
                    />
                  </div>
                )}

                {resTab === "headers" && (
                  <div className="headers-view-wrapper">
                    <table className="grid-table font-mono text-xs">
                      <thead>
                        <tr>
                          <th>Header Key</th>
                          <th>Header Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(response.headers).map(([key, value]) => (
                          <tr key={key}>
                            <td className="font-bold">{key}</td>
                            <td>{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {resTab === "tests" && response.testResults && (
                  <div className="headers-view-wrapper flex flex-col gap-3">
                    <h4 className="font-bold text-xs text-secondary mb-1">Test Assertions Run Summary:</h4>
                    <div className="flex flex-col gap-2">
                      {response.testResults.map((test, index) => (
                        <div
                          key={index}
                          className="flex items-center gap-3 p-3 border border-primary rounded"
                          style={{
                            backgroundColor: test.passed ? "rgba(16, 185, 129, 0.04)" : "rgba(239, 68, 68, 0.04)",
                            borderColor: test.passed ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)"
                          }}
                        >
                          {test.passed ? (
                            <CheckCircle2 size={16} className="text-success" />
                          ) : (
                            <XCircle size={16} className="text-danger" />
                          )}
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-primary">
                              {test.passed ? "PASS" : "FAIL"}
                            </span>
                            <span className="text-xs text-secondary">
                              {test.name}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Save Template Dialog overlay */}
      {showSaveModal && (
        <div className="modal-overlay" style={{ zIndex: 120 }}>
          <div className="modal-content" style={{ width: "360px" }}>
            <header className="modal-header">
              <h3 className="modal-title">Save Request Template</h3>
              <button
                className="btn btn-secondary"
                style={{ padding: "3px 6px" }}
                onClick={() => setShowSaveModal(false)}
              >
                ✕
              </button>
            </header>
            <div className="modal-body">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold">Template Name</label>
                <input
                  type="text"
                  placeholder="e.g. Fetch user data"
                  style={{
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-primary)",
                    color: "var(--text-primary)",
                    padding: "8px 12px",
                    fontSize: "12px",
                    width: "100%"
                  }}
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
              </div>
            </div>
            <footer className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setShowSaveModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSave}
                disabled={!saveName.trim()}
              >
                Save Template
              </button>
            </footer>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
