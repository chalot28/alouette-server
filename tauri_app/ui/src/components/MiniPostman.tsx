import { useState, useEffect, useCallback, useRef } from "react";
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
  FolderOpen,
  Save,
  Search,
  Activity,
  CheckCircle2,
  XCircle,
  Minus,
  Square,
  X,
  Code,
  FileCode,
  Shield,
  Terminal,
  Variable,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Zap,
  Plus,
} from "lucide-react";
import MiniPostmanNetworkTools from "./MiniPostmanNetworkTools";
import MiniPostmanCodeSnippets from "./MiniPostmanCodeSnippets";
import MiniPostmanEnvManager from "./MiniPostmanEnvManager";
import MiniPostmanScripts from "./MiniPostmanScripts";
import MiniPostmanCollections from "./MiniPostmanCollections";
import type {
  HeaderItem,
  QueryParam,
  HistoryItem,
  ApiResponse,
  TestResult,
  BodyType,
  AuthType,
  ReqTab,
  ResTab,
  SidebarTab,
  CookieInfo,
} from "./MiniPostmanTypes";

/* =========================================================================
   MiniPostman – Full-Featured API Debugger & Diagnostics
   ========================================================================= */

export default function MiniPostman() {
  const appWindow = getCurrentWindow();

  /* ---- Titlebar Controls ---- */
  const handleMinimize = async () => {
    try {
      await appWindow.minimize();
    } catch {
      /* noop */
    }
  };
  const handleMaximize = async () => {
    try {
      await appWindow.toggleMaximize();
    } catch {
      /* noop */
    }
  };
  const handleClose = async () => {
    try {
      await appWindow.close();
    } catch {
      /* noop */
    }
  };

  /* ---- Request States ---- */
  const [method, setMethod] = useState<string>("GET");
  const [url, setUrl] = useState<string>("https://httpbin.org/get");
  const [queryParams, setQueryParams] = useState<QueryParam[]>([
    { key: "", value: "", enabled: true },
  ]);
  const [headers, setHeaders] = useState<HeaderItem[]>([
    { key: "Accept", value: "*/*", enabled: true },
    { key: "", value: "", enabled: true },
  ]);
  const [bodyType, setBodyType] = useState<BodyType>("none");
  const [body, setBody] = useState<string>("");
  const [timeoutMs, setTimeoutMs] = useState<number>(30000);

  /* ---- Form-Data, Binary, GraphQL states ---- */
  const [formDataFields, setFormDataFields] = useState<
    {
      key: string;
      value: string;
      enabled: boolean;
      type: "text" | "file";
      fileName?: string;
    }[]
  >([]);
  const [binaryFilePath, setBinaryFilePath] = useState("");
  const [graphqlQuery, setGraphqlQuery] = useState("");
  const [graphqlVariables, setGraphqlVariables] = useState("");

  const parseGraphqlVars = (vars: string): Record<string, any> => {
    try {
      return JSON.parse(vars);
    } catch {
      return {};
    }
  };
  const [selectedEnv, setSelectedEnv] = useState<string>("");

  /* ---- Auth States ---- */
  const [authType, setAuthType] = useState<AuthType>("none");
  const [bearerToken, setBearerToken] = useState("");
  const [basicUsername, setBasicUsername] = useState("");
  const [basicPassword, setBasicPassword] = useState("");
  const [apiKeyName, setApiKeyName] = useState("");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [apiKeyAddto, setApiKeyAddto] = useState<"header" | "query">("header");

  /* ---- OAuth 2.0 & AWS Auth States ---- */
  const [oauthGrantType, setOauthGrantType] =
    useState<string>("authorization_code");
  const [oauthAccessTokenUrl, setOauthAccessTokenUrl] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [oauthToken, setOauthToken] = useState("");
  const [awsAccessKey, setAwsAccessKey] = useState("");
  const [awsSecretKey, setAwsSecretKey] = useState("");
  const [awsRegion, setAwsRegion] = useState("us-east-1");
  const [awsService, setAwsService] = useState("");

  /* ---- Test / Assertion States ---- */
  const [assertStatus200, setAssertStatus200] = useState(false);
  const [assertLatencyUnder200, setAssertLatencyUnder200] = useState(false);
  const [assertContainsText, setAssertContainsText] = useState(false);
  const [assertContainsTextString, setAssertContainsTextString] = useState("");
  const [assertIsValidJson, setAssertIsValidJson] = useState(false);

  /* ---- Script States ---- */
  const [preRequestCode, setPreRequestCode] = useState("");
  const [postResponseCode, setPostResponseCode] = useState("");

  /* ---- Active Tabs ---- */
  const [reqTab, setReqTab] = useState<ReqTab>("params");
  const [resTab, setResTab] = useState<ResTab>("body");

  /* ---- Loading & Response ---- */
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [reqError, setReqError] = useState<string | null>(null);
  const [scriptLogs, setScriptLogs] = useState<string[]>([]);

  /* ---- History & Saved ---- */
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [savedRequests, setSavedRequests] = useState<HistoryItem[]>([]);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("history");
  const [searchQuery, setSearchQuery] = useState("");
  const [saveName, setSaveName] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);

  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);

  const [showImportCurlModal, setShowImportCurlModal] = useState(false);
  const [importCurlInput, setImportCurlInput] = useState("");

  /* ---- UI Toggles ---- */
  const [showCodeSnippets, setShowCodeSnippets] = useState(false);
  const [jsonToolResult, setJsonToolResult] = useState<{
    action: string;
    result: string;
  } | null>(null);
  const [showJsonTools, setShowJsonTools] = useState(false);
  const [diffResult, setDiffResult] = useState<string | null>(null);
  const [showDiffDialog, setShowDiffDialog] = useState(false);
  const [diffInputA, setDiffInputA] = useState("");
  const [diffInputB, setDiffInputB] = useState("");

  /* ---- Schemas ---- */
  /* ---- Response search ---- */
  const [responseSearchQuery, setResponseSearchQuery] = useState("");

  /* ---- Helper: find all matches in text ---- */
  const findAllMatches = (text: string, query: string): number[] => {
    if (!query.trim()) return [];
    const indices: number[] = [];
    let idx = text.toLowerCase().indexOf(query.toLowerCase());
    while (idx !== -1) {
      indices.push(idx);
      idx = text.toLowerCase().indexOf(query.toLowerCase(), idx + 1);
    }
    return indices;
  };

  const [schemaValidation, setSchemaValidation] = useState<{
    valid: boolean;
    errors?: string[];
  } | null>(null);
  const [schemaInput, setSchemaInput] = useState<string>("");
  const [showSchemaInput, setShowSchemaInput] = useState(false);

  /* ---- Environments list (derived from localStorage) ---- */
  const [environments, setEnvironments] = useState<
    { id: string; name: string }[]
  >([]);
  const [envRefreshTrigger, setEnvRefreshTrigger] = useState(0);

  // Load environments list
  useEffect(() => {
    const raw = localStorage.getItem("postman_environments");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setEnvironments(parsed.map((e: any) => ({ id: e.id, name: e.name })));
        if (parsed.length > 0 && !selectedEnv) setSelectedEnv(parsed[0].id);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const refreshEnvironments = useCallback(() => {
    const raw = localStorage.getItem("postman_environments");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setEnvironments(parsed.map((e: any) => ({ id: e.id, name: e.name })));
      } catch {
        /* ignore */
      }
    }
  }, []);

  /* ---- Environment variable substitution ---- */
  const substituteEnvVars = (text: string): string => {
    if (!selectedEnv) return text;
    const raw = localStorage.getItem("postman_environments");
    if (!raw) return text;
    try {
      const envs = JSON.parse(raw);
      const env = envs.find((e: any) => e.id === selectedEnv);
      if (!env) return text;
      let result = text;
      env.variables.forEach((v: any) => {
        if (v.enabled && v.value) {
          result = result.replace(
            new RegExp(`\\{\\{${v.key}\\}\\}`, "g"),
            v.value,
          );
        }
      });
      return result;
    } catch {
      return text;
    }
  };

  /* ---- Sync query params from URL on mount ---- */
  useEffect(() => {
    try {
      const urlObj = new URL(url);
      const params: QueryParam[] = [];
      urlObj.searchParams.forEach((value, key) => {
        params.push({ key, value, enabled: true });
      });
      params.push({ key: "", value: "", enabled: true });
      setQueryParams(params);
    } catch {
      /* partial URL, ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Parse URL and update query params ---- */
  const parseUrlIntoParams = (newUrl: string) => {
    try {
      const urlObj = new URL(newUrl);
      const params: QueryParam[] = [];
      urlObj.searchParams.forEach((value, key) => {
        params.push({ key, value, enabled: true });
      });
      params.push({ key: "", value: "", enabled: true });
      setQueryParams(params);
    } catch {
      // partial/invalid URL, do nothing
    }
  };

  const updateUrlFromParams = (paramsList: QueryParam[]) => {
    try {
      const parsedUrl = new URL(url.split("?")[0]);
      paramsList.forEach((p) => {
        if (p.enabled && p.key) parsedUrl.searchParams.append(p.key, p.value);
      });
      setUrl(parsedUrl.toString());
    } catch {
      const baseUrl = url.split("?")[0];
      const qs = paramsList
        .filter((p) => p.enabled && p.key)
        .map(
          (p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`,
        )
        .join("&");
      setUrl(baseUrl + (qs ? `?${qs}` : ""));
    }
  };

  /* ---- Load history & saved from localStorage ---- */
  useEffect(() => {
    const loadedHistory = localStorage.getItem("postman_history");
    if (loadedHistory) {
      try {
        setHistory(JSON.parse(loadedHistory));
      } catch {
        /* ignore */
      }
    }
    const loadedSaved = localStorage.getItem("postman_saved");
    if (loadedSaved) {
      try {
        setSavedRequests(JSON.parse(loadedSaved));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const saveHistory = (newHistory: HistoryItem[]) => {
    setHistory(newHistory);
    localStorage.setItem("postman_history", JSON.stringify(newHistory));
  };

  const toBase64 = (str: string): string => {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch {
      return str;
    }
  };

  /* =====================================================================
     Script Execution Engine
     ===================================================================== */
  const executeScript = (
    code: string,
    context: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: string;
      response?: ApiResponse;
    },
  ): {
    logs: string[];
    modifiedHeaders: Record<string, string>;
    modifiedBody: string;
    testResults: TestResult[];
  } => {
    const logs: string[] = [];
    const testResults: TestResult[] = [];
    const envSnapshot: Record<string, string> = {};

    // Load current env variables
    try {
      const raw = localStorage.getItem("postman_environments");
      if (raw) {
        const envs = JSON.parse(raw);
        const env = envs.find((e: any) => e.id === selectedEnv);
        if (env) {
          env.variables.forEach((v: any) => {
            if (v.enabled) envSnapshot[v.key] = v.value;
          });
        }
      }
    } catch {
      /* ignore */
    }
    // Custom set function that also persists
    const setEnvVar = (key: string, value: string) => {
      envSnapshot[key] = value;
      try {
        const raw = localStorage.getItem("postman_environments");
        if (raw) {
          const envs = JSON.parse(raw);
          const idx = envs.findIndex((e: any) => e.id === selectedEnv);
          if (idx >= 0) {
            const existing = envs[idx].variables.findIndex(
              (v: any) => v.key === key,
            );
            if (existing >= 0) {
              envs[idx].variables[existing].value = value;
            } else {
              envs[idx].variables.push({ key, value, enabled: true });
            }
            localStorage.setItem("postman_environments", JSON.stringify(envs));
            refreshEnvironments();
          }
        }
      } catch {
        /* ignore */
      }
    };

    // Build the simulated pm object
    const pm: any = {
      method: context.method,
      url: context.url,
      headers: { ...context.headers },
      body: context.body,
      environment: {
        set: (key: string, value: string) => {
          setEnvVar(key, value);
          setEnvRefreshTrigger((prev) => prev + 1);
        },
      },
      testResults: testResults,
      response: context.response
        ? {
            status: context.response.status,
            statusText: context.response.statusText,
            headers: context.response.headers,
            body: context.response.body,
            elapsedMs: context.response.elapsedMs,
            sizeBytes: context.response.sizeBytes,
            cookies: context.response.cookies || [],
          }
        : undefined,
      // Enhanced Postman-style test/expect API
      test: (name: string, fn: Function) => {
        try {
          fn();
          testResults.push({ name, passed: true });
        } catch (err: any) {
          testResults.push({
            name: name + " -> Lỗi: " + err.message,
            passed: false,
          });
        }
      },
      expect: (actual: any) => ({
        to: {
          have: {
            status: (expected: number) => {
              const resp = context.response;
              if (!resp) throw new Error("No response available");
              if (resp.status !== expected)
                throw new Error(`Expected ${expected} but got ${resp.status}`);
            },
          },
          include: (expectedSubstr: string) => {
            const str = String(actual);
            if (!str.includes(expectedSubstr))
              throw new Error(`Expected string to contain "${expectedSubstr}"`);
          },
        },
      }),
    };

    // Monkey-patch console.log
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    console.log = (...args: any[]) => {
      logs.push(
        args
          .map((a: any) =>
            typeof a === "object" ? JSON.stringify(a, null, 2) : String(a),
          )
          .join(" "),
      );
    };
    console.warn = (...args: any[]) => {
      logs.push(
        "⚠️ " +
          args
            .map((a: any) =>
              typeof a === "object" ? JSON.stringify(a, null, 2) : String(a),
            )
            .join(" "),
      );
    };
    console.error = (...args: any[]) => {
      logs.push(
        "❌ " +
          args
            .map((a: any) =>
              typeof a === "object" ? JSON.stringify(a, null, 2) : String(a),
            )
            .join(" "),
      );
    };

    try {
      // Wrap the code in an async IIFE so pm is available
      const wrappedCode = `
        (async () => {
          ${code}
        })();
      `;
      // Use Function constructor for a sandboxed-ish eval
      const fn = new Function("pm", "console", wrappedCode);
      // Execute synchronously; if the user code is async it'll still run,
      // but we capture the state from pm after
      const result = fn(pm, console);
      // If it returns a promise, we don't await it – we just take the sync state
      if (result && typeof result.then === "function") {
        logs.push(
          "ℹ️ Script contains async code. Synchronous portion executed.",
        );
      }
    } catch (e: any) {
      logs.push("❌ Script error: " + e.toString());
    }

    // Restore console
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;

    return {
      logs,
      modifiedHeaders: pm.headers as Record<string, string>,
      modifiedBody: pm.body as string,
      testResults: pm.testResults as TestResult[],
    };
  };

  /* =====================================================================
     Send Request
     ===================================================================== */
  const handleSend = async () => {
    if (!url.trim()) {
      setReqError("URL cannot be empty");
      return;
    }

    // Create abort controller
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setReqError(null);
    setResponse(null);
    setSchemaValidation(null);
    setDiffResult(null);

    // Build header map
    const headersMap: Record<string, string> = {};
    headers.forEach((h) => {
      if (h.enabled && h.key.trim()) headersMap[h.key.trim()] = h.value;
    });

    // Auto-add Content-Type header based on body type
    const hasContentType = Object.keys(headersMap).some(
      (k) => k.toLowerCase() === "content-type",
    );
    if (!hasContentType && bodyType !== "none") {
      const ctMap: Record<string, string> = {
        json: "application/json",
        text: "text/plain",
        urlencoded: "application/x-www-form-urlencoded",
        "form-data": "multipart/form-data",
        xml: "application/xml",
        binary: "application/octet-stream",
        graphql: "application/json",
      };
      if (ctMap[bodyType]) {
        headersMap["Content-Type"] = ctMap[bodyType];
      }
    }

    let finalUrl = substituteEnvVars(url.trim());
    let finalBody = bodyType !== "none" ? substituteEnvVars(body) : "";
    let finalHeaders = { ...headersMap };

    // ---- Pre-request Script Execution ----
    if (preRequestCode.trim()) {
      const scriptResult = executeScript(preRequestCode.trim(), {
        method,
        url: finalUrl,
        headers: finalHeaders,
        body: finalBody,
      });
      setScriptLogs((prev) => [...prev, ...scriptResult.logs]);
      // Apply modifications from pre-request script
      finalHeaders = { ...scriptResult.modifiedHeaders };
      finalBody = scriptResult.modifiedBody;
    }

    // Inject Auth
    if (authType === "bearer" && bearerToken.trim()) {
      finalHeaders["Authorization"] = `Bearer ${bearerToken.trim()}`;
    } else if (
      authType === "basic" &&
      (basicUsername.trim() || basicPassword.trim())
    ) {
      const encoded = toBase64(`${basicUsername}:${basicPassword}`);
      finalHeaders["Authorization"] = `Basic ${encoded}`;
    } else if (
      authType === "apikey" &&
      apiKeyName.trim() &&
      apiKeyValue.trim()
    ) {
      if (apiKeyAddto === "header") {
        finalHeaders[apiKeyName.trim()] = apiKeyValue.trim();
      } else {
        try {
          const urlObj = new URL(finalUrl);
          urlObj.searchParams.append(apiKeyName.trim(), apiKeyValue.trim());
          finalUrl = urlObj.toString();
        } catch {
          finalUrl +=
            (finalUrl.includes("?") ? "&" : "?") +
            `${encodeURIComponent(apiKeyName.trim())}=${encodeURIComponent(apiKeyValue.trim())}`;
        }
      }
    }

    // Validate JSON body
    if (bodyType === "json" && finalBody.trim()) {
      try {
        JSON.parse(finalBody);
      } catch {
        setReqError("Invalid JSON in Request Body");
        setIsLoading(false);
        return;
      }
    }

    // Check if cancelled before sending
    if (controller.signal.aborted) {
      setIsLoading(false);
      return;
    }

    try {
      const res: any = await invoke("send_http_request", {
        req: {
          url: finalUrl,
          method,
          headers: finalHeaders,
          body: bodyType !== "none" ? finalBody : null,
          body_type: bodyType,
          timeout_ms: timeoutMs || null,
        },
      });

      // Evaluate assertions/tests
      const testResults: TestResult[] = [];

      if (assertStatus200) {
        testResults.push({
          name: "Status is 200 OK",
          passed: res.status === 200,
        });
      }
      if (assertLatencyUnder200) {
        testResults.push({
          name: `Response time is under 200ms (Actual: ${res.elapsed_ms}ms)`,
          passed: res.elapsed_ms < 200,
        });
      }
      if (assertIsValidJson) {
        let isJson = false;
        try {
          JSON.parse(res.body);
          isJson = true;
        } catch {
          /* noop */
        }
        testResults.push({
          name: "Response body is valid JSON",
          passed: isJson,
        });
      }
      if (assertContainsText && assertContainsTextString.trim()) {
        const str = assertContainsTextString.trim();
        testResults.push({
          name: `Response body contains string "${str}"`,
          passed: res.body.includes(str),
        });
      }

      const responseData: ApiResponse = {
        status: res.status,
        statusText: res.status_text,
        elapsedMs: res.elapsed_ms,
        sizeBytes: res.size_bytes,
        headers: res.headers,
        body: res.body,
        testResults: testResults.length > 0 ? testResults : undefined,
        cookies: res.cookies,
        timing_breakdown: res.timing_breakdown,
      };

      // ---- Post-response Script Execution ----
      if (postResponseCode.trim()) {
        const scriptResult = executeScript(postResponseCode.trim(), {
          method,
          url: finalUrl,
          headers: finalHeaders,
          body: finalBody,
          response: responseData,
        });
        setScriptLogs((prev) => [...prev, ...scriptResult.logs]);
        // Merge any test results from post-response script
        if (scriptResult.testResults.length > 0) {
          responseData.testResults = [
            ...(responseData.testResults || []),
            ...scriptResult.testResults,
          ];
        }
      }

      setResponse(responseData);

      if (responseData.testResults && responseData.testResults.length > 0) {
        setResTab("tests");
      } else {
        setResTab("body");
      }

      // Add to history
      const historyItem: HistoryItem = {
        id: Math.random().toString(36).substring(7),
        method,
        url: url.trim(),
        headers: finalHeaders,
        body: bodyType !== "none" ? finalBody : "",
        bodyType,
        timestamp: Date.now(),
        auth:
          authType !== "none"
            ? {
                type: authType,
                bearerToken,
                basicUsername,
                basicPassword,
                apiKeyName,
                apiKeyValue,
                apiKeyAddto,
              }
            : undefined,
        tests: {
          status200: assertStatus200,
          latencyUnder200: assertLatencyUnder200,
          containsText: assertContainsText,
          containsTextString: assertContainsTextString,
          isValidJson: assertIsValidJson,
        },
        response: {
          status: res.status,
          statusText: res.status_text,
          elapsedMs: res.elapsed_ms,
          sizeBytes: res.size_bytes,
          headers: res.headers || {},
          body: res.body,
          testResults: testResults.length > 0 ? testResults : undefined,
        },
        scripts: {
          preRequest: preRequestCode,
          postResponse: postResponseCode,
        },
      };

      const updatedHistory = [historyItem, ...history.slice(0, 49)];
      saveHistory(updatedHistory);
    } catch (err: any) {
      if (
        err?.toString()?.includes("Aborted") ||
        err?.toString()?.includes("abort")
      ) {
        setReqError("Request was cancelled by user");
      } else {
        setReqError(err.toString());
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  /* ---- Cancel Request ---- */
  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setReqError("Request cancelled by user");
  };

  /* =====================================================================
     Load / Save / Delete
     ===================================================================== */
  const loadRequest = (item: HistoryItem) => {
    setMethod(item.method);
    setUrl(item.url);
    setBody(item.body);
    setBodyType(item.bodyType as BodyType);

    if (item.auth) {
      setAuthType(item.auth.type as AuthType);
      setBearerToken(item.auth.bearerToken || "");
      setBasicUsername(item.auth.basicUsername || "");
      setBasicPassword(item.auth.basicPassword || "");
      setApiKeyName(item.auth.apiKeyName || "");
      setApiKeyValue(item.auth.apiKeyValue || "");
      setApiKeyAddto((item.auth.apiKeyAddto as "header" | "query") || "header");
    } else {
      setAuthType("none");
      setBearerToken("");
      setBasicUsername("");
      setBasicPassword("");
      setApiKeyName("");
      setApiKeyValue("");
      setApiKeyAddto("header");
    }

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

    if (item.scripts) {
      setPreRequestCode(item.scripts.preRequest || "");
      setPostResponseCode(item.scripts.postResponse || "");
    } else {
      setPreRequestCode("");
      setPostResponseCode("");
    }

    const mappedHeaders: HeaderItem[] = Object.entries(item.headers).map(
      ([key, value]) => ({
        key,
        value,
        enabled: true,
      }),
    );
    mappedHeaders.push({ key: "", value: "", enabled: true });
    setHeaders(mappedHeaders);

    if (item.response) {
      setResponse(item.response as ApiResponse);
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

  const handleSave = () => {
    if (!saveName.trim()) return;

    const headersMap: Record<string, string> = {};
    headers.forEach((h) => {
      if (h.enabled && h.key.trim()) headersMap[h.key.trim()] = h.value;
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
      auth:
        authType !== "none"
          ? {
              type: authType,
              bearerToken,
              basicUsername,
              basicPassword,
              apiKeyName,
              apiKeyValue,
              apiKeyAddto,
            }
          : undefined,
      tests: {
        status200: assertStatus200,
        latencyUnder200: assertLatencyUnder200,
        containsText: assertContainsText,
        containsTextString: assertContainsTextString,
        isValidJson: assertIsValidJson,
      },
      scripts: {
        preRequest: preRequestCode,
        postResponse: postResponseCode,
      },
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

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const dm = 2;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  const getFormattedBody = (rawBody: string): string => {
    try {
      const obj = JSON.parse(rawBody);
      return JSON.stringify(obj, null, 2);
    } catch {
      return rawBody;
    }
  };

  /* ---- Filtered lists ---- */
  const filteredHistory = history.filter(
    (item) =>
      item.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.method.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const filteredSaved = savedRequests.filter(
    (item) =>
      (item.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.url.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  /* ---- JSON Tools ---- */
  const runJsonTool = async (action: "prettify" | "minify" | "validate") => {
    if (!response) return;
    try {
      const res: any = await invoke("json_format_tool", {
        body: { json_text: response.body, action },
      });
      setJsonToolResult({
        action,
        result: res.result || res.message || JSON.stringify(res),
      });
    } catch (e: any) {
      setJsonToolResult({ action, result: "Error: " + e.toString() });
    }
  };

  /* ---- cURL Command ---- */
  const [curlCommand, setCurlCommand] = useState("");
  const [curlCopied, setCurlCopied] = useState(false);
  const generateCurl = async () => {
    const headersMap: Record<string, string> = {};
    headers.forEach((h) => {
      if (h.enabled && h.key.trim()) headersMap[h.key.trim()] = h.value;
    });
    try {
      const res: any = await invoke("generate_curl_command", {
        body: {
          url,
          method,
          headers: headersMap,
          body: bodyType !== "none" ? body : null,
          body_type: bodyType,
          auth_type: authType,
          auth_value:
            authType === "bearer"
              ? bearerToken
              : authType === "basic"
                ? `${basicUsername}:${basicPassword}`
                : authType === "apikey"
                  ? apiKeyValue
                  : "",
        },
      });
      setCurlCommand(res.command || res);
    } catch (e: any) {
      setCurlCommand("// Error generating cURL command:\n// " + e.toString());
    }
  };
  const copyCurl = () => {
    navigator.clipboard.writeText(curlCommand);
    setCurlCopied(true);
    setTimeout(() => setCurlCopied(false), 2000);
  };

  /* ---- Schema Validation ---- */
  const validateSchema = async () => {
    if (!response || !schemaInput.trim()) return;
    try {
      const res: any = await invoke("validate_json_schema", {
        body: { json_body: response.body, schema: schemaInput },
      });
      setSchemaValidation(res);
    } catch (e: any) {
      setSchemaValidation({ valid: false, errors: [e.toString()] });
    }
  };

  /* ---- Response Diff ---- */
  const runDiff = async () => {
    try {
      const res: any = await invoke("response_diff", {
        body: { response_a: diffInputA, response_b: diffInputB },
      });
      setDiffResult(
        typeof res === "string" ? res : JSON.stringify(res, null, 2),
      );
    } catch (e: any) {
      setDiffResult("Diff Error: " + e.toString());
    }
  };

  /* ---- Build code snippet input ---- */
  const getSnippetInput = () => {
    const headersMap: Record<string, string> = {};
    headers.forEach((h) => {
      if (h.enabled && h.key.trim()) headersMap[h.key.trim()] = h.value;
    });
    return {
      url,
      method,
      headers: headersMap,
      body: bodyType !== "none" ? body : "",
      body_type: bodyType,
      auth_type: authType,
      auth_value:
        authType === "bearer"
          ? bearerToken
          : authType === "basic"
            ? `${basicUsername}:${basicPassword}`
            : authType === "apikey"
              ? apiKeyValue
              : "",
    };
  };

  const requestForSnippets = getSnippetInput();

  /* ---- Insert env variable into URL ---- */
  const insertEnvVar = (varName: string) => {
    setUrl((prev) => prev + varName);
  };

  const handleSidebarResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSidebar(true);
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(180, Math.min(500, moveEvent.clientX));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsDraggingSidebar(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const parseCurl = (curl: string) => {
    const cleanCurl = curl.trim().replace(/\s*\\\s*\n/g, " "); // join backslash lines

    // Extract Method
    let parsedMethod = "GET";
    const methodMatch = cleanCurl.match(/-X\s+(\w+)|--request\s+(\w+)/i);
    if (methodMatch) {
      parsedMethod = (methodMatch[1] || methodMatch[2]).toUpperCase();
    } else if (
      cleanCurl.includes("-d ") ||
      cleanCurl.includes("--data ") ||
      cleanCurl.includes("--data-raw ")
    ) {
      parsedMethod = "POST";
    }

    // Extract URL
    let parsedUrl = "https://";
    const urlMatch = cleanCurl.match(/(?:'|")?(https?:\/\/[^\s'"]+)(?:'|")?/i);
    if (urlMatch) {
      parsedUrl = urlMatch[1];
    } else {
      const tokens = cleanCurl.split(/\s+/);
      for (let i = 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (
          t &&
          !t.startsWith("-") &&
          tokens[i - 1] !== "-X" &&
          tokens[i - 1] !== "--request" &&
          tokens[i - 1] !== "-H" &&
          tokens[i - 1] !== "--header" &&
          tokens[i - 1] !== "-d" &&
          tokens[i - 1] !== "--data" &&
          tokens[i - 1] !== "--data-raw"
        ) {
          const cleanT = t.replace(/['"]/g, "");
          if (
            cleanT.startsWith("http://") ||
            cleanT.startsWith("https://") ||
            cleanT.includes(".")
          ) {
            parsedUrl = cleanT;
            break;
          }
        }
      }
    }

    // Extract Headers
    const parsedHeaders: HeaderItem[] = [];
    const headerRegex =
      /(?:-H|--header)\s+((?:'[^']*')|(?:"[^"]*")|(?:[^\s]+))/g;
    let match;
    while ((match = headerRegex.exec(cleanCurl)) !== null) {
      const rawHeader = match[1].replace(/^['"]|['"]$/g, "");
      const separatorIdx = rawHeader.indexOf(":");
      if (separatorIdx > 0) {
        const key = rawHeader.substring(0, separatorIdx).trim();
        const value = rawHeader.substring(separatorIdx + 1).trim();
        parsedHeaders.push({ key, value, enabled: true });
      }
    }
    parsedHeaders.push({ key: "", value: "", enabled: true });

    // Extract Body
    let parsedBody = "";
    let parsedBodyType: BodyType = "none";
    const bodyRegex = /(?:-d|--data|--data-raw)\s+((?:'[^']*')|(?:"[^"]*"))/i;
    const bodyMatch = cleanCurl.match(bodyRegex);
    if (bodyMatch) {
      parsedBody = bodyMatch[1].replace(/^['"]|['"]$/g, "");
      parsedBodyType = "json";
      try {
        const parsedJson = JSON.parse(parsedBody);
        parsedBody = JSON.stringify(parsedJson, null, 2);
      } catch {
        // keep raw
      }
    }

    return {
      method: parsedMethod,
      url: parsedUrl,
      headers: parsedHeaders,
      body: parsedBody,
      bodyType: parsedBodyType,
    };
  };

  const handleImportCurl = () => {
    if (!importCurlInput.trim()) return;
    const parsed = parseCurl(importCurlInput);
    setMethod(parsed.method);
    setUrl(parsed.url);
    setHeaders(parsed.headers);
    setBody(parsed.body);
    setBodyType(parsed.bodyType);

    // Update query params based on the new URL
    try {
      const urlObj = new URL(parsed.url);
      const params: QueryParam[] = [];
      urlObj.searchParams.forEach((value, key) => {
        params.push({ key, value, enabled: true });
      });
      params.push({ key: "", value: "", enabled: true });
      setQueryParams(params);
    } catch {
      /* noop */
    }

    setImportCurlInput("");
    setShowImportCurlModal(false);
  };

  /* =====================================================================
     RENDER
     ===================================================================== */
  return (
    <div className="postman-container" style={{ flexDirection: "column" }}>
      {/* ================================================================ */}
      {/* CUSTOM TITLEBAR                                                 */}
      {/* ================================================================ */}
      <div className="postman-window-titlebar" data-tauri-drag-region>
        <div className="titlebar-left" data-tauri-drag-region>
          <Globe
            size={13}
            className="titlebar-icon"
            style={{ color: "var(--color-accent)" }}
          />
          <span className="titlebar-title">Mini Postman</span>
          <span className="titlebar-subtitle">API Debugger & Diagnostics</span>
        </div>
        <div className="titlebar-right">
          <button
            className="window-control-btn minimize"
            onClick={handleMinimize}
            title="Minimize"
          >
            <Minus size={13} />
          </button>
          <button
            className="window-control-btn maximize"
            onClick={handleMaximize}
            title="Maximize"
          >
            <Square size={10} />
          </button>
          <button
            className="window-control-btn close"
            onClick={handleClose}
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ================================================================ */}
      {/* MAIN LAYOUT                                                     */}
      {/* ================================================================ */}
      <div
        className="postman-main-layout"
        style={{ display: "flex", flex: 1, overflow: "hidden" }}
      >
        {/* -------------------------------------------------------------- */}
        {/* SIDEBAR                                                       */}
        {/* -------------------------------------------------------------- */}
        <div
          className="postman-sidebar"
          style={{
            width: `${sidebarWidth}px`,
            position: "relative",
            flexShrink: 0,
          }}
        >
          <div
            className={`resizer-v ${isDraggingSidebar ? "dragging" : ""}`}
            style={{ right: "-2px" }}
            onMouseDown={handleSidebarResizeStart}
          />
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
            <button
              className={`sidebar-tab ${sidebarTab === "collections" ? "active" : ""}`}
              onClick={() => setSidebarTab("collections")}
            >
              <FolderOpen size={12} />
              <span>Collections</span>
            </button>
            <button
              className={`sidebar-tab ${sidebarTab === "environments" ? "active" : ""}`}
              onClick={() => {
                setSidebarTab("environments");
                refreshEnvironments();
              }}
            >
              <Variable size={12} />
              <span>Envs</span>
            </button>
          </div>

          {/* Search Bar (only for history/saved) */}
          {sidebarTab !== "environments" && (
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
          )}

          <div className="sidebar-list">
            {/* HISTORY TAB */}
            {sidebarTab === "history" &&
              (filteredHistory.length > 0 ? (
                <>
                  {filteredHistory.map((item) => (
                    <div
                      key={item.id}
                      className="sidebar-item"
                      onClick={() => loadRequest(item)}
                    >
                      <div className="item-meta">
                        <span
                          className={`method-badge ${item.method.toLowerCase()}`}
                        >
                          {item.method}
                        </span>
                        {item.response && (
                          <span
                            className={`status-badge ${
                              item.response.status >= 200 &&
                              item.response.status < 300
                                ? "success"
                                : "error"
                            }`}
                          >
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
              ))}

            {/* SAVED TAB */}
            {sidebarTab === "saved" &&
              (filteredSaved.length > 0 ? (
                filteredSaved.map((item) => (
                  <div
                    key={item.id}
                    className="sidebar-item saved"
                    onClick={() => loadRequest(item)}
                  >
                    <div className="saved-header">
                      <div className="saved-name font-bold">{item.name}</div>
                      <button
                        className="delete-saved-btn"
                        onClick={(e) => deleteSavedItem(item.id, e)}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <div className="saved-meta">
                      <span
                        className={`method-badge ${item.method.toLowerCase()}`}
                      >
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
              ))}

            {/* COLLECTIONS TAB */}
            {sidebarTab === "collections" && (
              <MiniPostmanCollections
                onLoadRequest={(req) => {
                  // Load a collection request into the main form
                  setMethod(req.method);
                  setUrl(req.url);
                  setBody(req.body || "");
                  setBodyType(req.bodyType as BodyType);
                  setAuthType(req.authType as AuthType);
                  setBearerToken(req.bearerToken || "");
                  setBasicUsername(req.basicUsername || "");
                  setBasicPassword(req.basicPassword || "");
                  setApiKeyName(req.apiKeyName || "");
                  setApiKeyValue(req.apiKeyValue || "");
                  setApiKeyAddto(
                    (req.apiKeyAddto as "header" | "query") || "header",
                  );
                  // Map headers
                  const mappedHeaders: HeaderItem[] = (req.headers || [])
                    .filter((h) => h.key)
                    .map((h) => ({
                      key: h.key,
                      value: h.value,
                      enabled: h.enabled,
                    }));
                  mappedHeaders.push({ key: "", value: "", enabled: true });
                  setHeaders(mappedHeaders);
                  // Parse URL params
                  parseUrlIntoParams(req.url);
                }}
              />
            )}

            {/* ENVIRONMENTS TAB */}
            {sidebarTab === "environments" && (
              <MiniPostmanEnvManager
                onInsertVariable={insertEnvVar}
                refreshTrigger={envRefreshTrigger}
              />
            )}
          </div>
        </div>

        {/* -------------------------------------------------------------- */}
        {/* MAIN WORKSPACE                                                */}
        {/* -------------------------------------------------------------- */}
        <div className="postman-main-workspace">
          {/* ---- REQUEST BAR ---- */}
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
              placeholder="Enter request URL (e.g. http://localhost:8080/api)"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                parseUrlIntoParams(e.target.value);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
            />

            {/* Environment Selector */}
            <select
              className="env-selector-dropdown"
              value={selectedEnv}
              onChange={(e) => setSelectedEnv(e.target.value)}
              title="Select environment"
              style={{
                height: "32px",
                padding: "0 6px",
                fontSize: "11px",
                backgroundColor: "var(--bg-primary)",
                border: "1px solid var(--border-primary)",
                color: "var(--text-primary)",
                borderRadius: "4px",
                maxWidth: "120px",
              }}
            >
              {environments.length === 0 && <option value="">No Env</option>}
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>

            <button
              className="btn btn-secondary"
              onClick={() => setShowImportCurlModal(true)}
              title="Import from cURL command"
              style={{ height: "32px", padding: "0 10px", gap: "4px" }}
            >
              <Plus size={14} />
              <span className="text-xs">Import</span>
            </button>

            <button
              className="btn btn-secondary"
              onClick={() => setShowSaveModal(true)}
              title="Save Request Template"
              style={{ height: "32px", padding: "0 10px" }}
            >
              <Save size={14} />
            </button>

            <button
              className={`btn ${isLoading ? "btn-danger" : "btn-primary"} send-btn`}
              onClick={isLoading ? handleCancel : handleSend}
              style={{ minWidth: "90px" }}
            >
              {isLoading ? (
                <>
                  <X size={13} />
                  <span>Cancel</span>
                </>
              ) : (
                <>
                  <Send size={13} />
                  <span>Send</span>
                </>
              )}
            </button>
          </div>

          {/* ---- WORKSPACE TABS ---- */}
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
                className={`tab-item ${reqTab === "scripts" ? "active" : ""}`}
                onClick={() => setReqTab("scripts")}
              >
                Scripts {preRequestCode && "•"}
              </button>
              <button
                className={`tab-item ${reqTab === "tools" ? "active" : ""}`}
                onClick={() => setReqTab("tools")}
              >
                Tools
              </button>
              <button
                className={`tab-item ${reqTab === "settings" ? "active" : ""}`}
                onClick={() => setReqTab("settings")}
              >
                Settings
              </button>
            </div>

            <div
              className="tabs-content"
              style={{
                maxHeight:
                  reqTab === "scripts" || reqTab === "tools"
                    ? "none"
                    : undefined,
                overflowY:
                  reqTab === "scripts" || reqTab === "tools"
                    ? "visible"
                    : undefined,
              }}
            >
              {/* 1. PARAMS */}
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
                                if (
                                  index === queryParams.length - 1 &&
                                  e.target.value
                                ) {
                                  updated.push({
                                    key: "",
                                    value: "",
                                    enabled: true,
                                  });
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
                                  const updated = queryParams.filter(
                                    (_, idx) => idx !== index,
                                  );
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

              {/* 2. AUTH */}
              {reqTab === "auth" && (
                <div
                  className="auth-tab flex flex-col gap-3"
                  style={{ padding: "4px 0" }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-secondary">
                      Auth Type:
                    </span>
                    <select
                      className="method-select"
                      style={{
                        height: "28px",
                        padding: "0 6px",
                        fontSize: "11.5px",
                      }}
                      value={authType}
                      onChange={(e) => setAuthType(e.target.value as AuthType)}
                    >
                      <option value="none">No Auth</option>
                      <option value="bearer">Bearer Token</option>
                      <option value="basic">Basic Auth</option>
                      <option value="apikey">API Key</option>
                      <option value="oauth2">OAuth 2.0</option>
                      <option value="aws">AWS Signature</option>
                    </select>
                  </div>

                  {authType === "bearer" && (
                    <div className="flex flex-col gap-1 max-w-md">
                      <label className="text-xxs font-bold text-muted uppercase">
                        Bearer Token
                      </label>
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
                        <label className="text-xxs font-bold text-muted uppercase">
                          Username
                        </label>
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
                        <label className="text-xxs font-bold text-muted uppercase">
                          Password
                        </label>
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
                          <label className="text-xxs font-bold text-muted uppercase">
                            Key Name
                          </label>
                          <input
                            type="text"
                            className="url-input"
                            placeholder="e.g. X-API-Key"
                            value={apiKeyName}
                            onChange={(e) => setApiKeyName(e.target.value)}
                          />
                        </div>
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-xxs font-bold text-muted uppercase">
                            Key Value
                          </label>
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
                        <span className="text-xs text-secondary">
                          Add key to:
                        </span>
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

                  {authType === "oauth2" && (
                    <div className="flex flex-col gap-3 max-w-xl">
                      <div className="flex flex-col gap-1">
                        <label className="text-xxs font-bold text-muted uppercase">
                          Grant Type
                        </label>
                        <select
                          className="method-select"
                          style={{
                            height: "28px",
                            padding: "0 6px",
                            fontSize: "11.5px",
                          }}
                          value={oauthGrantType}
                          onChange={(e) => setOauthGrantType(e.target.value)}
                        >
                          <option value="authorization_code">
                            Authorization Code
                          </option>
                          <option value="client_credentials">
                            Client Credentials
                          </option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xxs font-bold text-muted uppercase">
                          Access Token URL
                        </label>
                        <input
                          type="text"
                          className="url-input"
                          placeholder="https://auth.example.com/token"
                          value={oauthAccessTokenUrl}
                          onChange={(e) =>
                            setOauthAccessTokenUrl(e.target.value)
                          }
                        />
                      </div>
                      <div className="flex gap-3">
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-xxs font-bold text-muted uppercase">
                            Client ID
                          </label>
                          <input
                            type="text"
                            className="url-input"
                            value={oauthClientId}
                            onChange={(e) => setOauthClientId(e.target.value)}
                          />
                        </div>
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-xxs font-bold text-muted uppercase">
                            Client Secret
                          </label>
                          <input
                            type="password"
                            className="url-input"
                            value={oauthClientSecret}
                            onChange={(e) =>
                              setOauthClientSecret(e.target.value)
                            }
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xxs font-bold text-muted uppercase">
                          Scope
                        </label>
                        <input
                          type="text"
                          className="url-input"
                          placeholder="openid profile email"
                          value={oauthScope}
                          onChange={(e) => setOauthScope(e.target.value)}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="btn btn-primary btn-xs"
                          onClick={async () => {
                            // Simulate OAuth token fetch
                            setOauthToken("fetched-oauth-token-" + Date.now());
                            alert(
                              "OAuth token fetched (simulated). Token: " +
                                oauthToken.substring(0, 30) +
                                "...",
                            );
                          }}
                        >
                          <Shield size={11} /> Get New Access Token
                        </button>
                        {oauthToken && (
                          <span className="text-xxs text-success">
                            Token ready ✓
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {authType === "aws" && (
                    <div className="flex flex-col gap-3 max-w-xl">
                      <div className="flex gap-3">
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-xxs font-bold text-muted uppercase">
                            Access Key
                          </label>
                          <input
                            type="text"
                            className="url-input"
                            value={awsAccessKey}
                            onChange={(e) => setAwsAccessKey(e.target.value)}
                          />
                        </div>
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-xxs font-bold text-muted uppercase">
                            Secret Key
                          </label>
                          <input
                            type="password"
                            className="url-input"
                            value={awsSecretKey}
                            onChange={(e) => setAwsSecretKey(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-xxs font-bold text-muted uppercase">
                            AWS Region
                          </label>
                          <input
                            type="text"
                            className="url-input"
                            placeholder="us-east-1"
                            value={awsRegion}
                            onChange={(e) => setAwsRegion(e.target.value)}
                          />
                        </div>
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-xxs font-bold text-muted uppercase">
                            Service Name
                          </label>
                          <input
                            type="text"
                            className="url-input"
                            placeholder="execute-api"
                            value={awsService}
                            onChange={(e) => setAwsService(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {authType === "none" && (
                    <div className="text-muted text-xs italic">
                      This request does not use any authorization headers or
                      values.
                    </div>
                  )}
                </div>
              )}

              {/* 3. HEADERS */}
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
                                if (
                                  index === headers.length - 1 &&
                                  e.target.value
                                ) {
                                  updated.push({
                                    key: "",
                                    value: "",
                                    enabled: true,
                                  });
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
                                  const updated = headers.filter(
                                    (_, idx) => idx !== index,
                                  );
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

              {/* 4. BODY */}
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
                    <label className="body-type-option">
                      <input
                        type="radio"
                        name="bodyType"
                        checked={bodyType === "form-data"}
                        onChange={() => setBodyType("form-data")}
                      />
                      <span>Form-Data (multipart)</span>
                    </label>
                    <label className="body-type-option">
                      <input
                        type="radio"
                        name="bodyType"
                        checked={bodyType === "binary"}
                        onChange={() => setBodyType("binary")}
                      />
                      <span>Binary (octet-stream)</span>
                    </label>
                    <label className="body-type-option">
                      <input
                        type="radio"
                        name="bodyType"
                        checked={bodyType === "graphql"}
                        onChange={() => setBodyType("graphql")}
                      />
                      <span>GraphQL</span>
                    </label>
                  </div>
                  {bodyType !== "none" && (
                    <div className="body-editor-wrapper">
                      {/* ---- JSON / TEXT / URLENCODED ---- */}
                      {bodyType === "json" && (
                        <>
                          <div className="body-editor-header">
                            <span className="lang-badge json">
                              <span
                                className="badge-dot"
                                style={{ backgroundColor: "#818cf8" }}
                              />
                              JSON
                            </span>
                            <span style={{ fontSize: "9px", opacity: 0.4 }}>
                              application/json
                            </span>
                            <div className="header-actions">
                              <button
                                onClick={() => {
                                  try {
                                    setBody(
                                      JSON.stringify(
                                        JSON.parse(body || "{}"),
                                        null,
                                        2,
                                      ),
                                    );
                                  } catch {
                                    /* ignore */
                                  }
                                }}
                                title="Format JSON"
                              >
                                <Code size={11} /> Format
                              </button>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(body);
                                }}
                                title="Copy"
                              >
                                <Copy size={11} />
                              </button>
                            </div>
                          </div>
                          <textarea
                            className="body-textarea json-textarea"
                            placeholder={'{\n  "key": "value"\n}'}
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            rows={8}
                          />
                        </>
                      )}

                      {/* ---- TEXT ---- */}
                      {bodyType === "text" && (
                        <>
                          <div className="body-editor-header">
                            <span className="lang-badge text">
                              <span
                                className="badge-dot"
                                style={{ backgroundColor: "#67e8f9" }}
                              />
                              TEXT
                            </span>
                            <span style={{ fontSize: "9px", opacity: 0.4 }}>
                              text/plain
                            </span>
                            <div className="header-actions">
                              <button
                                onClick={() =>
                                  navigator.clipboard.writeText(body)
                                }
                                title="Copy"
                              >
                                <Copy size={11} />
                              </button>
                            </div>
                          </div>
                          <textarea
                            className="body-textarea"
                            placeholder="Enter plain text body..."
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            rows={6}
                          />
                        </>
                      )}

                      {/* ---- URLENCODED ---- */}
                      {bodyType === "urlencoded" && (
                        <>
                          <div className="body-editor-header">
                            <span className="lang-badge form">
                              <span
                                className="badge-dot"
                                style={{ backgroundColor: "#34d399" }}
                              />
                              FORM
                            </span>
                            <span style={{ fontSize: "9px", opacity: 0.4 }}>
                              x-www-form-urlencoded
                            </span>
                            <div className="header-actions">
                              <button
                                onClick={() => {
                                  // Parse and prettify URL-encoded data into line-by-line
                                  try {
                                    const params = new URLSearchParams(body);
                                    const lines: string[] = [];
                                    params.forEach((v, k) =>
                                      lines.push(`${k}=${v}`),
                                    );
                                    setBody(lines.join("\n"));
                                  } catch {
                                    /* ignore */
                                  }
                                }}
                                title="Format"
                              >
                                <Code size={11} /> Format
                              </button>
                            </div>
                          </div>
                          <textarea
                            className="body-textarea"
                            placeholder={"key1=value1\nkey2=value2"}
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            rows={6}
                          />
                        </>
                      )}

                      {/* ---- FORM-DATA ---- */}
                      {bodyType === "form-data" && (
                        <div className="form-data-editor">
                          <div className="fd-header">
                            <span className="lang-badge form">
                              <span
                                className="badge-dot"
                                style={{ backgroundColor: "#34d399" }}
                              />
                              MULTIPART
                            </span>
                            <span style={{ fontSize: "9px", opacity: 0.4 }}>
                              multipart/form-data
                            </span>
                          </div>
                          <table>
                            <thead>
                              <tr>
                                <th
                                  style={{ width: "32px", textAlign: "center" }}
                                ></th>
                                <th>Key</th>
                                <th>Value</th>
                                <th
                                  style={{ width: "72px", textAlign: "center" }}
                                >
                                  Type
                                </th>
                                <th style={{ width: "36px" }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {(formDataFields.length === 0
                                ? [
                                    {
                                      key: "",
                                      value: "",
                                      enabled: true,
                                      type: "text" as const,
                                    },
                                  ]
                                : formDataFields
                              ).map((field, index) => (
                                <tr key={index}>
                                  <td align="center">
                                    <input
                                      type="checkbox"
                                      checked={field.enabled}
                                      onChange={(e) => {
                                        const updated = [...formDataFields];
                                        updated[index].enabled =
                                          e.target.checked;
                                        setFormDataFields(updated);
                                      }}
                                    />
                                  </td>
                                  <td>
                                    <input
                                      type="text"
                                      placeholder="Field Name"
                                      value={field.key}
                                      onChange={(e) => {
                                        const updated = [...formDataFields];
                                        updated[index].key = e.target.value;
                                        if (
                                          index === formDataFields.length - 1 &&
                                          e.target.value
                                        ) {
                                          updated.push({
                                            key: "",
                                            value: "",
                                            enabled: true,
                                            type: "text",
                                          });
                                        }
                                        setFormDataFields(updated);
                                      }}
                                    />
                                  </td>
                                  <td>
                                    <div
                                      style={{
                                        display: "flex",
                                        gap: "6px",
                                        alignItems: "center",
                                      }}
                                    >
                                      {field.type === "file" ? (
                                        <>
                                          <input
                                            type="text"
                                            className="mono"
                                            placeholder="No file selected"
                                            value={field.fileName || ""}
                                            readOnly
                                            style={{
                                              flex: 1,
                                              fontSize: "11px",
                                            }}
                                          />
                                          <button
                                            className="btn btn-ghost btn-xs"
                                            onClick={() => {
                                              const filePath =
                                                window.prompt(
                                                  "Enter file path:",
                                                );
                                              if (filePath) {
                                                const updated = [
                                                  ...formDataFields,
                                                ];
                                                updated[index].fileName =
                                                  filePath;
                                                updated[index].value =
                                                  "[FILE: " +
                                                  filePath
                                                    .split(/\\|\//)
                                                    .pop() +
                                                  "]";
                                                setFormDataFields(updated);
                                              }
                                            }}
                                            style={{ flexShrink: 0 }}
                                          >
                                            Browse
                                          </button>
                                        </>
                                      ) : (
                                        <input
                                          type="text"
                                          placeholder="Field Value"
                                          value={field.value}
                                          onChange={(e) => {
                                            const updated = [...formDataFields];
                                            updated[index].value =
                                              e.target.value;
                                            setFormDataFields(updated);
                                          }}
                                          style={{ flex: 1 }}
                                        />
                                      )}
                                    </div>
                                  </td>
                                  <td align="center">
                                    <select
                                      value={field.type}
                                      onChange={(e) => {
                                        const updated = [...formDataFields];
                                        updated[index].type = e.target.value as
                                          | "text"
                                          | "file";
                                        if (e.target.value === "file")
                                          updated[index].fileName = "";
                                        setFormDataFields(updated);
                                      }}
                                    >
                                      <option value="text">Text</option>
                                      <option value="file">File</option>
                                    </select>
                                  </td>
                                  <td align="center">
                                    {index < formDataFields.length - 1 && (
                                      <button
                                        className="delete-row-btn"
                                        onClick={() => {
                                          setFormDataFields(
                                            formDataFields.filter(
                                              (_, idx) => idx !== index,
                                            ),
                                          );
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

                      {/* ---- BINARY ---- */}
                      {bodyType === "binary" && (
                        <>
                          <div className="body-editor-header">
                            <span className="lang-badge binary">
                              <span
                                className="badge-dot"
                                style={{ backgroundColor: "#a78bfa" }}
                              />
                              BINARY
                            </span>
                            <span style={{ fontSize: "9px", opacity: 0.4 }}>
                              application/octet-stream
                            </span>
                          </div>
                          <div className="binary-editor">
                            {!binaryFilePath ? (
                              <div
                                className="binary-dropzone"
                                onClick={() => {
                                  const filePath = window.prompt(
                                    "Select file path for binary upload:",
                                  );
                                  if (filePath) {
                                    setBinaryFilePath(filePath);
                                    setBody(
                                      "[BINARY FILE: " +
                                        filePath.split(/\\|\//).pop() +
                                        "]",
                                    );
                                  }
                                }}
                              >
                                <div className="dropzone-icon">
                                  <FileCode size={18} />
                                </div>
                                <span
                                  style={{
                                    fontSize: "13px",
                                    fontWeight: 600,
                                    color: "var(--text-secondary)",
                                  }}
                                >
                                  Select a File
                                </span>
                                <span
                                  style={{
                                    fontSize: "10px",
                                    color: "var(--text-muted)",
                                    textAlign: "center",
                                  }}
                                >
                                  Click to browse — supports images, PDFs,
                                  archives, etc.
                                </span>
                              </div>
                            ) : (
                              <>
                                <div className="binary-file-info">
                                  <FileCode size={16} />
                                  <span style={{ fontWeight: 600 }}>
                                    {binaryFilePath.split(/\\|\//).pop()}
                                  </span>
                                  <span style={{ opacity: 0.6 }}>
                                    — ready to upload
                                  </span>
                                </div>
                                <button
                                  className="btn btn-ghost btn-xs"
                                  onClick={() => {
                                    setBinaryFilePath("");
                                    setBody("");
                                  }}
                                  style={{ gap: "4px" }}
                                >
                                  <Trash2 size={11} /> Clear file
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}

                      {/* ---- GRAPHQL ---- */}
                      {bodyType === "graphql" && (
                        <>
                          <div className="body-editor-header">
                            <span className="lang-badge graphql">
                              <span
                                className="badge-dot"
                                style={{ backgroundColor: "#f472b6" }}
                              />
                              GRAPHQL
                            </span>
                            <span style={{ fontSize: "9px", opacity: 0.4 }}>
                              application/json
                            </span>
                          </div>
                          <div className="graphql-editor">
                            <div className="gql-section">
                              <div className="gql-label">
                                <span className="gql-dot query" />
                                Query
                              </div>
                              <textarea
                                className="body-textarea"
                                placeholder={`query GetUser {\n  user(id: 1) {\n    id\n    name\n    email\n  }\n}`}
                                value={graphqlQuery}
                                onChange={(e) => {
                                  setGraphqlQuery(e.target.value);
                                  setBody(
                                    JSON.stringify({
                                      query: e.target.value,
                                      variables:
                                        parseGraphqlVars(graphqlVariables),
                                    }),
                                  );
                                }}
                                rows={7}
                              />
                            </div>
                            <div className="gql-section">
                              <div className="gql-label">
                                <span className="gql-dot vars" />
                                Variables (JSON)
                              </div>
                              <textarea
                                className="body-textarea"
                                placeholder='{"id": 1}'
                                value={graphqlVariables}
                                onChange={(e) => {
                                  setGraphqlVariables(e.target.value);
                                  setBody(
                                    JSON.stringify({
                                      query: graphqlQuery,
                                      variables: parseGraphqlVars(
                                        e.target.value,
                                      ),
                                    }),
                                  );
                                }}
                                rows={4}
                              />
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 5. TESTS */}
              {reqTab === "tests" && (
                <div
                  className="tests-tab flex flex-col gap-3"
                  style={{ padding: "4px 0" }}
                >
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
                      <span className="font-semibold">
                        Validate Status Code is 200 OK
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={assertLatencyUnder200}
                        onChange={(e) =>
                          setAssertLatencyUnder200(e.target.checked)
                        }
                      />
                      <span className="font-semibold">
                        Validate Response Latency is under 200ms
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={assertIsValidJson}
                        onChange={(e) => setAssertIsValidJson(e.target.checked)}
                      />
                      <span className="font-semibold">
                        Validate Response Body is a valid JSON document
                      </span>
                    </label>
                    <div className="flex flex-col gap-1 mt-1">
                      <label className="flex items-center gap-2 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={assertContainsText}
                          onChange={(e) =>
                            setAssertContainsText(e.target.checked)
                          }
                        />
                        <span className="font-semibold">
                          Validate Response Body contains matching text string:
                        </span>
                      </label>
                      {assertContainsText && (
                        <input
                          type="text"
                          className="url-input max-w-md"
                          style={{ height: "26px", fontSize: "11.5px" }}
                          placeholder="e.g. success, user_id, 2026..."
                          value={assertContainsTextString}
                          onChange={(e) =>
                            setAssertContainsTextString(e.target.value)
                          }
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 6. SCRIPTS */}
              {reqTab === "scripts" && (
                <div className="scripts-tab" style={{ padding: "4px 0" }}>
                  <MiniPostmanScripts
                    preRequestCode={preRequestCode}
                    postResponseCode={postResponseCode}
                    onPreRequestChange={setPreRequestCode}
                    onPostResponseChange={setPostResponseCode}
                  />
                  {/* Script Logs */}
                  {scriptLogs.length > 0 && (
                    <div className="script-logs" style={{ marginTop: "8px" }}>
                      <div className="flex items-center gap-2 mb-1">
                        <Terminal size={11} />
                        <span className="text-xs font-bold">
                          Script Console ({scriptLogs.length} lines)
                        </span>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => setScriptLogs([])}
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                      <pre
                        className="mono"
                        style={{
                          maxHeight: "120px",
                          overflow: "auto",
                          backgroundColor: "var(--bg-secondary)",
                          padding: "6px",
                          fontSize: "10px",
                          borderRadius: "4px",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {scriptLogs.join("\n")}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* 7. TOOLS */}
              {reqTab === "tools" && (
                <div className="tools-tab" style={{ padding: "4px 0" }}>
                  <MiniPostmanNetworkTools />
                </div>
              )}

              {/* 8. SETTINGS */}
              {reqTab === "settings" && (
                <div className="settings-tab flex flex-col gap-4">
                  <div className="settings-item flex flex-col gap-1">
                    <label className="font-bold text-xs">
                      Request Timeout (milliseconds)
                    </label>
                    <input
                      type="number"
                      style={{
                        backgroundColor: "var(--bg-primary)",
                        border: "1px solid var(--border-primary)",
                        color: "var(--text-primary)",
                        padding: "6px 12px",
                        fontSize: "12px",
                        width: "160px",
                      }}
                      value={timeoutMs}
                      onChange={(e) =>
                        setTimeoutMs(parseInt(e.target.value) || 0)
                      }
                    />
                    <span className="text-muted text-xxs">
                      Max time to wait for a socket response. Defaults to
                      30000ms.
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ---- RESPONSE SECTION ---- */}
          <div className="postman-response-section">
            {response && (
              <div className="response-status-bar">
                <div className="status-meta">
                  <span
                    className={`status-code ${
                      response.status >= 200 && response.status < 300
                        ? "success"
                        : "error"
                    }`}
                  >
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
                  {/* Extra Actions */}
                  <span className="meta-actions">
                    {/* JSON Tools */}
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => setShowJsonTools(!showJsonTools)}
                      title="JSON Tools"
                    >
                      <Code size={11} />
                    </button>
                    {/* cURL */}
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        generateCurl();
                        setShowCodeSnippets(true);
                      }}
                      title="Generate cURL command"
                    >
                      <Terminal size={11} />
                    </button>
                    {/* Diff */}
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        setDiffInputA(response.body);
                        setDiffInputB("");
                        setShowDiffDialog(true);
                      }}
                      title="Response Diff Tool"
                    >
                      <FileCode size={11} />
                    </button>
                    {/* Schema */}
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => setShowSchemaInput(!showSchemaInput)}
                      title="JSON Schema Validation"
                    >
                      <Shield size={11} />
                    </button>
                  </span>
                </div>

                <div className="response-tabs">
                  <button
                    className={`res-tab-btn ${resTab === "body" ? "active" : ""}`}
                    onClick={() => setResTab("body")}
                  >
                    Body
                  </button>
                  <button
                    className={`res-tab-btn ${resTab === "preview" ? "active" : ""}`}
                    onClick={() => setResTab("preview")}
                  >
                    Preview
                  </button>
                  <button
                    className={`res-tab-btn ${resTab === "raw" ? "active" : ""}`}
                    onClick={() => setResTab("raw")}
                  >
                    Raw
                  </button>
                  <button
                    className={`res-tab-btn ${resTab === "headers" ? "active" : ""}`}
                    onClick={() => setResTab("headers")}
                  >
                    Headers
                  </button>
                  <button
                    className={`res-tab-btn ${resTab === "cookies" ? "active" : ""}`}
                    onClick={() => setResTab("cookies")}
                  >
                    Cookies {response.cookies && `(${response.cookies.length})`}
                  </button>
                  {response.testResults && (
                    <button
                      className={`res-tab-btn ${resTab === "tests" ? "active" : ""}`}
                      onClick={() => setResTab("tests")}
                    >
                      Tests (
                      {response.testResults.filter((t) => t.passed).length}/
                      {response.testResults.length})
                    </button>
                  )}
                  <button
                    className={`res-tab-btn ${resTab === "timeline" ? "active" : ""}`}
                    onClick={() => setResTab("timeline")}
                  >
                    Timeline
                  </button>
                  <button
                    className={`res-tab-btn ${resTab === "schema" ? "active" : ""}`}
                    onClick={() => setResTab("schema")}
                  >
                    Schema
                  </button>
                </div>
              </div>
            )}

            <div className="response-viewport">
              {/* JSON Tools panel */}
              {showJsonTools && response && (
                <div
                  className="json-tools-bar"
                  style={{
                    display: "flex",
                    gap: "4px",
                    padding: "4px 8px",
                    borderBottom: "1px solid var(--border-primary)",
                    alignItems: "center",
                  }}
                >
                  <span className="text-xxs font-bold text-muted">
                    JSON Tools:
                  </span>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => runJsonTool("prettify")}
                  >
                    <Code size={10} /> Prettify
                  </button>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => runJsonTool("minify")}
                  >
                    <Zap size={10} /> Minify
                  </button>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => runJsonTool("validate")}
                  >
                    <Check size={10} /> Validate
                  </button>
                  {jsonToolResult && (
                    <span
                      className="text-xxs"
                      style={{
                        color:
                          jsonToolResult.action === "validate" &&
                          jsonToolResult.result.includes("valid")
                            ? "var(--color-success)"
                            : "var(--text-secondary)",
                        maxWidth: "200px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {jsonToolResult.result.substring(0, 80)}
                    </span>
                  )}
                </div>
              )}

              {/* Schema Input */}
              {showSchemaInput && response && (
                <div
                  className="schema-input-bar"
                  style={{
                    padding: "6px 8px",
                    borderBottom: "1px solid var(--border-primary)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xxs font-bold text-muted">
                      JSON Schema:
                    </span>
                    <textarea
                      className="mono"
                      rows={3}
                      style={{
                        flex: 1,
                        fontSize: "10px",
                        backgroundColor: "var(--bg-primary)",
                        border: "1px solid var(--border-primary)",
                        color: "var(--text-primary)",
                        borderRadius: "4px",
                        padding: "4px",
                      }}
                      placeholder='{"type": "object", "properties": {"id": {"type": "integer"}}}'
                      value={schemaInput}
                      onChange={(e) => setSchemaInput(e.target.value)}
                    />
                    <button
                      className="btn btn-primary btn-xs"
                      onClick={validateSchema}
                    >
                      Validate
                    </button>
                  </div>
                  {schemaValidation && (
                    <div
                      className="text-xxs"
                      style={{
                        color: schemaValidation.valid
                          ? "var(--color-success)"
                          : "var(--color-danger)",
                      }}
                    >
                      {schemaValidation.valid
                        ? "✓ Schema is valid for this response"
                        : "✗ Validation errors:\n" +
                          (schemaValidation.errors || []).join("\n")}
                    </div>
                  )}
                </div>
              )}

              {/* Loading overlay */}
              {isLoading && (
                <div className="response-loader-overlay">
                  <Activity size={24} className="animate-spin text-accent" />
                  <span className="text-secondary font-bold text-xs mt-2">
                    Invoking Web Request Socket...
                  </span>
                </div>
              )}

              {/* Error */}
              {reqError && (
                <div className="response-error">
                  <h4 className="text-danger font-bold text-sm">
                    Failed to complete request
                  </h4>
                  <pre className="mono text-xs">{reqError}</pre>
                </div>
              )}

              {/* Placeholder */}
              {!isLoading && !response && !reqError && (
                <div className="response-placeholder">
                  <Globe size={32} className="text-muted" />
                  <span className="text-muted text-xs mt-3">
                    Click "Send" above to invoke the request socket
                  </span>
                </div>
              )}

              {/* Response content */}
              {response && !isLoading && (
                <>
                  {/* RESPONSE SEARCH BAR (shown for body, preview, raw) */}
                  {(resTab === "body" ||
                    resTab === "preview" ||
                    resTab === "raw") && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "3px 8px",
                        borderBottom: "1px solid var(--border-primary)",
                        backgroundColor: "var(--bg-secondary)",
                      }}
                    >
                      <Search size={11} className="text-muted" />
                      <input
                        type="text"
                        placeholder="Find in response... (Ctrl+F)"
                        value={responseSearchQuery}
                        onChange={(e) => setResponseSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            // Trigger search (highlight matches)
                          }
                        }}
                        style={{
                          flex: 1,
                          height: "22px",
                          fontSize: "11px",
                          padding: "0 6px",
                          backgroundColor: "var(--bg-primary)",
                          border: "1px solid var(--border-primary)",
                          color: "var(--text-primary)",
                          borderRadius: "4px",
                          outline: "none",
                        }}
                      />
                      {responseSearchQuery && (
                        <span className="text-xxs text-muted">
                          {
                            findAllMatches(
                              resTab === "raw"
                                ? response.body
                                : getFormattedBody(response.body),
                              responseSearchQuery,
                            ).length
                          }{" "}
                          matches
                        </span>
                      )}
                    </div>
                  )}

                  {/* RESPONSE BODY (Prettified JSON) */}
                  {resTab === "body" && (
                    <div
                      className="body-view-wrapper"
                      style={{ position: "relative" }}
                    >
                      <textarea
                        readOnly
                        className="response-textarea mono"
                        value={getFormattedBody(response.body)}
                      />
                      {responseSearchQuery && (
                        <div
                          style={{
                            position: "absolute",
                            bottom: "4px",
                            right: "8px",
                            zIndex: 2,
                            backgroundColor: "var(--bg-secondary)",
                            border: "1px solid var(--border-primary)",
                            borderRadius: "4px",
                            padding: "2px 8px",
                            fontSize: "10px",
                            color: "var(--text-muted)",
                          }}
                        >
                          Searching for &quot;{responseSearchQuery}&quot; (
                          {
                            findAllMatches(
                              getFormattedBody(response.body),
                              responseSearchQuery,
                            ).length
                          }{" "}
                          matches)
                        </div>
                      )}
                    </div>
                  )}

                  {/* RESPONSE PREVIEW */}
                  {resTab === "preview" && (
                    <div
                      className="preview-view-wrapper"
                      style={{ padding: "8px", flex: 1, overflow: "auto" }}
                    >
                      {response.headers["content-type"]?.includes("image/") ||
                      response.body.startsWith("data:image") ? (
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            minHeight: "100px",
                          }}
                        >
                          <img
                            src={
                              response.body.startsWith("data:")
                                ? response.body
                                : `data:${response.headers["content-type"] || "image/png"};base64,${btoa(response.body)}`
                            }
                            alt="Response preview"
                            style={{
                              maxWidth: "100%",
                              maxHeight: "400px",
                              borderRadius: "4px",
                            }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display =
                                "none";
                            }}
                          />
                        </div>
                      ) : response.headers["content-type"]?.includes(
                          "text/html",
                        ) ? (
                        <iframe
                          srcDoc={response.body}
                          title="Response Preview"
                          style={{
                            width: "100%",
                            height: "400px",
                            border: "1px solid var(--border-primary)",
                            borderRadius: "4px",
                            backgroundColor: "white",
                          }}
                          sandbox="allow-same-origin"
                        />
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "12px",
                            alignItems: "center",
                            justifyContent: "center",
                            minHeight: "100px",
                            color: "var(--text-muted)",
                          }}
                        >
                          <Globe size={24} />
                          <span className="text-xs">
                            Preview not available for{" "}
                            {response.headers["content-type"] || "unknown"}{" "}
                            content type.
                          </span>
                          <span className="text-xxs">
                            Switch to "Body" or "Raw" tab to view the content.
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* RESPONSE RAW (minified) */}
                  {resTab === "raw" && (
                    <div
                      className="raw-view-wrapper"
                      style={{ position: "relative" }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: "4px",
                          right: "8px",
                          zIndex: 2,
                        }}
                      >
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => {
                            navigator.clipboard.writeText(response.body);
                          }}
                          title="Copy raw response"
                        >
                          <Copy size={10} />
                        </button>
                      </div>
                      <textarea
                        readOnly
                        className="response-textarea mono"
                        value={response.body}
                        style={{ fontSize: "10px" }}
                      />
                    </div>
                  )}

                  {/* RESPONSE HEADERS */}
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
                          {Object.entries(response.headers).map(
                            ([key, value]) => (
                              <tr key={key}>
                                <td className="font-bold">{key}</td>
                                <td>{value}</td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* COOKIES */}
                  {resTab === "cookies" && (
                    <div
                      className="cookies-view-wrapper"
                      style={{ padding: "8px" }}
                    >
                      {response.cookies && response.cookies.length > 0 ? (
                        <table className="grid-table font-mono text-xs">
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Value</th>
                              <th>Domain</th>
                              <th>Path</th>
                              <th>Secure</th>
                              <th>HttpOnly</th>
                            </tr>
                          </thead>
                          <tbody>
                            {response.cookies.map(
                              (c: CookieInfo, idx: number) => (
                                <tr key={idx}>
                                  <td className="font-bold">{c.name}</td>
                                  <td
                                    style={{
                                      maxWidth: "150px",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {c.value}
                                  </td>
                                  <td>{c.domain || "-"}</td>
                                  <td>{c.path || "-"}</td>
                                  <td>
                                    <span
                                      style={{
                                        color: c.secure
                                          ? "var(--color-success)"
                                          : "var(--text-muted)",
                                      }}
                                    >
                                      {c.secure ? "✓" : "✗"}
                                    </span>
                                  </td>
                                  <td>
                                    <span
                                      style={{
                                        color: c.http_only
                                          ? "var(--color-success)"
                                          : "var(--text-muted)",
                                      }}
                                    >
                                      {c.http_only ? "✓" : "✗"}
                                    </span>
                                  </td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      ) : (
                        <div className="text-muted text-xs italic">
                          No cookies in response
                        </div>
                      )}
                    </div>
                  )}

                  {/* TESTS */}
                  {resTab === "tests" && response.testResults && (
                    <div className="headers-view-wrapper flex flex-col gap-3">
                      <h4 className="font-bold text-xs text-secondary mb-1">
                        Test Assertions Run Summary:
                      </h4>
                      <div className="flex flex-col gap-2">
                        {response.testResults.map((test, index) => (
                          <div
                            key={index}
                            className="flex items-center gap-3 p-3 border border-primary rounded"
                            style={{
                              backgroundColor: test.passed
                                ? "rgba(16, 185, 129, 0.04)"
                                : "rgba(239, 68, 68, 0.04)",
                              borderColor: test.passed
                                ? "rgba(16, 185, 129, 0.15)"
                                : "rgba(239, 68, 68, 0.15)",
                            }}
                          >
                            {test.passed ? (
                              <CheckCircle2
                                size={16}
                                className="text-success"
                              />
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

                  {/* TIMELINE */}
                  {resTab === "timeline" && (
                    <div
                      className="timeline-view-wrapper"
                      style={{ padding: "12px" }}
                    >
                      <h4 className="font-bold text-xs text-secondary mb-2">
                        Timing Breakdown
                      </h4>
                      {response.timing_breakdown ? (
                        <div className="flex flex-col gap-3">
                          <TimelineBar
                            label="DNS Lookup"
                            ms={response.timing_breakdown.dns_lookup_ms}
                            total={response.timing_breakdown.total_ms}
                            color="var(--color-accent)"
                          />
                          <TimelineBar
                            label="TCP Connect"
                            ms={response.timing_breakdown.tcp_connect_ms}
                            total={response.timing_breakdown.total_ms}
                            color="var(--color-info)"
                          />
                          <TimelineBar
                            label="TLS Handshake"
                            ms={response.timing_breakdown.tls_handshake_ms}
                            total={response.timing_breakdown.total_ms}
                            color="var(--color-warning)"
                          />
                          <TimelineBar
                            label="First Byte"
                            ms={response.timing_breakdown.first_byte_ms}
                            total={response.timing_breakdown.total_ms}
                            color="var(--color-success)"
                          />
                          <TimelineBar
                            label="Total"
                            ms={response.timing_breakdown.total_ms}
                            total={response.timing_breakdown.total_ms}
                            color="var(--color-danger)"
                          />
                        </div>
                      ) : (
                        <div className="text-muted text-xs italic">
                          Timing breakdown not available for this response.
                        </div>
                      )}
                    </div>
                  )}

                  {/* SCHEMA */}
                  {resTab === "schema" && (
                    <div
                      className="schema-view-wrapper"
                      style={{ padding: "12px" }}
                    >
                      <h4 className="font-bold text-xs text-secondary mb-2">
                        JSON Schema Validation
                      </h4>
                      <div className="flex flex-col gap-2">
                        <textarea
                          className="mono"
                          rows={6}
                          placeholder='Paste JSON Schema here... {"type": "object", "properties": {...}}'
                          value={schemaInput}
                          onChange={(e) => setSchemaInput(e.target.value)}
                          style={{
                            width: "100%",
                            fontSize: "11px",
                            backgroundColor: "var(--bg-primary)",
                            border: "1px solid var(--border-primary)",
                            color: "var(--text-primary)",
                            borderRadius: "4px",
                            padding: "6px",
                          }}
                        />
                        <div className="flex gap-2">
                          <button
                            className="btn btn-primary btn-xs"
                            onClick={validateSchema}
                          >
                            <Shield size={11} /> Validate
                          </button>
                        </div>
                        {schemaValidation && (
                          <div
                            className="text-xs p-2 rounded"
                            style={{
                              backgroundColor: schemaValidation.valid
                                ? "rgba(16, 185, 129, 0.08)"
                                : "rgba(239, 68, 68, 0.08)",
                              border: `1px solid ${
                                schemaValidation.valid
                                  ? "rgba(16, 185, 129, 0.2)"
                                  : "rgba(239, 68, 68, 0.2)"
                              }`,
                            }}
                          >
                            {schemaValidation.valid ? (
                              <div className="flex items-center gap-2">
                                <CheckCircle2
                                  size={14}
                                  className="text-success"
                                />
                                <span className="text-success font-bold">
                                  Schema is valid
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                  <XCircle size={14} className="text-danger" />
                                  <span className="text-danger font-bold">
                                    Schema validation failed
                                  </span>
                                </div>
                                <pre
                                  className="mono text-xxs"
                                  style={{ whiteSpace: "pre-wrap" }}
                                >
                                  {(schemaValidation.errors || []).join("\n")}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ---- CODE SNIPPETS PANEL (collapsible) ---- */}
          <div
            className="code-snippets-section"
            style={{
              borderTop: "1px solid var(--border-primary)",
              backgroundColor: "var(--bg-secondary)",
            }}
          >
            <div
              className="snippets-toggle"
              onClick={() => {
                if (!showCodeSnippets) generateCurl();
                setShowCodeSnippets(!showCodeSnippets);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 10px",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              {showCodeSnippets ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
              <Code size={12} />
              <span className="text-xs font-bold">Code Snippets</span>
              {curlCommand && (
                <span
                  className="text-xxs text-muted ml-1"
                  style={{
                    maxWidth: "200px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  cURL ready
                </span>
              )}
              {curlCommand && (
                <button
                  className="btn btn-ghost btn-xs ml-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyCurl();
                  }}
                  title="Copy cURL command"
                >
                  {curlCopied ? <Check size={10} /> : <Copy size={10} />}
                </button>
              )}
            </div>
            {showCodeSnippets && (
              <div style={{ padding: "0 8px 8px 8px" }}>
                <MiniPostmanCodeSnippets request={requestForSnippets} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* SAVE MODAL                                                      */}
      {/* ================================================================ */}
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
                <X size={12} />
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
                    width: "100%",
                  }}
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
              </div>
            </div>
            <footer className="modal-footer">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowSaveModal(false)}
              >
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

      {/* ================================================================ */}
      {/* IMPORT cURL MODAL                                               */}
      {/* ================================================================ */}
      {showImportCurlModal && (
        <div className="modal-overlay" style={{ zIndex: 120 }}>
          <div className="modal-content" style={{ width: "500px" }}>
            <header className="modal-header">
              <h3 className="modal-title">Import Request from cURL</h3>
              <button
                className="btn btn-secondary"
                style={{ padding: "3px 6px" }}
                onClick={() => setShowImportCurlModal(false)}
              >
                <X size={12} />
              </button>
            </header>
            <div className="modal-body">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-secondary">
                  Paste raw cURL command
                </label>
                <textarea
                  className="mono"
                  rows={8}
                  style={{
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-primary)",
                    color: "var(--text-primary)",
                    padding: "8px 12px",
                    fontSize: "11px",
                    fontFamily: "var(--font-mono)",
                    width: "100%",
                    resize: "none",
                    outline: "none",
                  }}
                  placeholder={`curl -X POST https://httpbin.org/post \\\n  -H "Content-Type: application/json" \\\n  -d '{"key": "value"}'`}
                  value={importCurlInput}
                  onChange={(e) => setImportCurlInput(e.target.value)}
                />
                <span className="text-xxs text-muted italic">
                  Tip: You can copy raw cURL commands directly from Chrome
                  DevTools Network Tab.
                </span>
              </div>
            </div>
            <footer className="modal-footer">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setImportCurlInput("");
                  setShowImportCurlModal(false);
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleImportCurl}
                disabled={!importCurlInput.trim()}
              >
                Import Request
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* DIFF DIALOG                                                     */}
      {/* ================================================================ */}
      {showDiffDialog && (
        <div className="modal-overlay" style={{ zIndex: 130 }}>
          <div
            className="modal-content"
            style={{ width: "600px", maxHeight: "80vh" }}
          >
            <header className="modal-header">
              <h3 className="modal-title">Response Diff Tool</h3>
              <button
                className="btn btn-secondary"
                style={{ padding: "3px 6px" }}
                onClick={() => setShowDiffDialog(false)}
              >
                <X size={12} />
              </button>
            </header>
            <div
              className="modal-body"
              style={{ maxHeight: "60vh", overflow: "auto" }}
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xxs font-bold text-muted uppercase">
                    Response A
                  </label>
                  <textarea
                    className="mono"
                    rows={5}
                    value={diffInputA}
                    onChange={(e) => setDiffInputA(e.target.value)}
                    style={{
                      width: "100%",
                      fontSize: "10px",
                      backgroundColor: "var(--bg-primary)",
                      border: "1px solid var(--border-primary)",
                      color: "var(--text-primary)",
                      borderRadius: "4px",
                      padding: "6px",
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xxs font-bold text-muted uppercase">
                    Response B
                  </label>
                  <textarea
                    className="mono"
                    rows={5}
                    value={diffInputB}
                    onChange={(e) => setDiffInputB(e.target.value)}
                    placeholder="Paste second response here..."
                    style={{
                      width: "100%",
                      fontSize: "10px",
                      backgroundColor: "var(--bg-primary)",
                      border: "1px solid var(--border-primary)",
                      color: "var(--text-primary)",
                      borderRadius: "4px",
                      padding: "6px",
                    }}
                  />
                </div>
                <button className="btn btn-primary btn-sm" onClick={runDiff}>
                  <FileCode size={12} /> Compare
                </button>
                {diffResult && (
                  <pre
                    className="mono"
                    style={{
                      fontSize: "10px",
                      whiteSpace: "pre-wrap",
                      backgroundColor: "var(--bg-primary)",
                      border: "1px solid var(--border-primary)",
                      borderRadius: "4px",
                      padding: "8px",
                      maxHeight: "200px",
                      overflow: "auto",
                    }}
                  >
                    {diffResult}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   TimelineBar – sub-component for timing breakdown visualization
   ========================================================================= */
function TimelineBar({
  label,
  ms,
  total,
  color,
}: {
  label: string;
  ms: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (ms / total) * 100 : 0;
  return (
    <div
      className="timeline-bar-row"
      style={{ display: "flex", alignItems: "center", gap: "8px" }}
    >
      <span
        className="text-xxs font-bold text-muted"
        style={{ width: "90px", textAlign: "right", flexShrink: 0 }}
      >
        {label}
      </span>
      <div
        className="timeline-track"
        style={{
          flex: 1,
          height: "12px",
          backgroundColor: "var(--bg-primary)",
          borderRadius: "6px",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          className="timeline-fill"
          style={{
            width: `${Math.min(pct, 100)}%`,
            height: "100%",
            backgroundColor: color,
            borderRadius: "6px",
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <span
        className="text-xxs font-bold"
        style={{ width: "60px", flexShrink: 0 }}
      >
        {ms.toFixed(2)} ms
      </span>
    </div>
  );
}
