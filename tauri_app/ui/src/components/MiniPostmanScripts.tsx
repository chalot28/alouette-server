import { useState, useRef } from "react";
import Editor from "@monaco-editor/react";
import {
  Terminal,
  Plus,
  FileText,
  Trash2,
  ChevronRight,
  ChevronDown,
} from "lucide-react";

interface ScriptSnippet {
  id: string;
  name: string;
  code: string;
  description: string;
}

const BUILT_IN_SCRIPTS: ScriptSnippet[] = [
  {
    id: "script-log",
    name: "Log Request Info",
    description: "Log request method, URL, and headers to console",
    code: `// Pre-Request Script
console.log("=== Request Info ===");
console.log("Method:", pm.method);
console.log("URL:", pm.url);
console.log("Headers:", JSON.stringify(pm.headers, null, 2));

// Modify headers
pm.headers["X-Debug"] = "true";
`,
  },
  {
    id: "script-timestamp",
    name: "Add Timestamp Header",
    description: "Add X-Timestamp header with current Unix time",
    code: `// Pre-Request Script
const now = new Date();
pm.headers["X-Timestamp"] = now.getTime().toString();
pm.headers["X-Date"] = now.toISOString();
console.log("Timestamps added to headers");
`,
  },
  {
    id: "script-randomize",
    name: "Randomize Body Fields",
    description: "Replace {{$randomEmail}} and {{$randomUUID}} in request body",
    code: `// Pre-Request Script
function randomUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function randomEmail() {
  const domains = ['example.com', 'test.org', 'mail.net'];
  const name = Math.random().toString(36).substring(7);
  const domain = domains[Math.floor(Math.random() * domains.length)];
  return name + '@' + domain;
}

// Apply replacements if body exists
if (pm.body) {
  pm.body = pm.body
    .replace(/{{randomEmail}}/g, randomEmail())
    .replace(/{{randomUUID}}/g, randomUUID());
  console.log("Randomized body values");
}
`,
  },
  {
    id: "script-validate-response",
    name: "Validate Response Schema",
    description: "Post-response script that checks response structure",
    code: `// Post-Response Script
console.log("=== Response Validation ===");
console.log("Status:", pm.response.status);
console.log("Time:", pm.response.elapsedMs + "ms");

// Check required fields
const requiredFields = ["id", "name", "created_at"];
try {
  const data = JSON.parse(pm.response.body);
  const missing = requiredFields.filter(f => !(f in data));
  if (missing.length > 0) {
    console.warn("Missing fields:", missing.join(", "));
  } else {
    console.log("All required fields present ✓");
  }
} catch (e) {
  console.error("Invalid JSON response");
}
`,
  },
  {
    id: "script-status-check",
    name: "Status Code Assertions",
    description: "Advanced status code and header assertions",
    code: `// Post-Response Script
const assertions = [
  { name: "Status is 2xx", pass: pm.response.status >= 200 && pm.response.status < 300 },
  { name: "Has Content-Type", pass: !!pm.response.headers["content-type"] },
  { name: "Response not empty", pass: pm.response.body.length > 0 },
];

console.log("=== Assertions ===");
assertions.forEach(a => {
  console.log(a.pass ? "✓ PASS:" : "✗ FAIL:", a.name);
});

// Add custom test results
pm.testResults = assertions.map(a => ({
  name: a.name,
  passed: a.pass
}));
`,
  },
  {
    id: "script-env",
    name: "Environment Variable Injection",
    description: "Set environment variables from response data",
    code: `// Post-Response Script
// Extract data from response and set env variables
try {
  const data = JSON.parse(pm.response.body);

  if (data.id) {
    pm.environment.set("last_id", data.id.toString());
    console.log("Set env var last_id =", data.id);
  }
  if (data.token) {
    pm.environment.set("auth_token", data.token);
    console.log("Set env var auth_token");
  }
} catch (e) {
  console.warn("Could not parse response body");
}
`,
  },
];

interface Props {
  preRequestCode: string;
  postResponseCode: string;
  onPreRequestChange: (code: string) => void;
  onPostResponseChange: (code: string) => void;
}

export default function MiniPostmanScripts({
  preRequestCode,
  postResponseCode,
  onPreRequestChange,
  onPostResponseChange,
}: Props) {
  const [activeScriptTab, setActiveScriptTab] = useState<"pre" | "post">("pre");
  const [showBuiltIn, setShowBuiltIn] = useState(false);
  const [scriptOutput, setScriptOutput] = useState<string[]>([]);
  const [outputExpanded, setOutputExpanded] = useState(false);

  const [editorHeight, setEditorHeight] = useState(180);
  const [isDraggingHeight, setIsDraggingHeight] = useState(false);
  const editorWrapperRef = useRef<HTMLDivElement>(null);

  const handleHeightResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!editorWrapperRef.current) return;
    setIsDraggingHeight(true);
    const initialRect = editorWrapperRef.current.getBoundingClientRect();
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newHeight = Math.max(120, Math.min(500, moveEvent.clientY - initialRect.top));
      setEditorHeight(newHeight);
    };
    const handleMouseUp = () => {
      setIsDraggingHeight(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const loadBuiltInScript = (script: ScriptSnippet) => {
    if (activeScriptTab === "pre") {
      onPreRequestChange(script.code);
    } else {
      onPostResponseChange(script.code);
    }
    setShowBuiltIn(false);
  };

  const clearEditor = () => {
    if (activeScriptTab === "pre") {
      onPreRequestChange("");
    } else {
      onPostResponseChange("");
    }
  };

  return (
    <div className="scripts-panel">
      {/* Script Tab Switcher */}
      <div className="scripts-tabs-bar">
        <button
          className={`script-tab-btn ${activeScriptTab === "pre" ? "active" : ""}`}
          onClick={() => setActiveScriptTab("pre")}
        >
          <Terminal size={12} />
          <span>Pre-request Script</span>
          {preRequestCode && <span className="script-dot" />}
        </button>
        <button
          className={`script-tab-btn ${activeScriptTab === "post" ? "active" : ""}`}
          onClick={() => setActiveScriptTab("post")}
        >
          <FileText size={12} />
          <span>Post-response Script</span>
          {postResponseCode && <span className="script-dot" />}
        </button>
      </div>

      {/* Script Editor */}
      <div
        ref={editorWrapperRef}
        className="script-editor-wrapper"
        style={{
          height: `${editorHeight}px`,
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        <div className="script-editor-toolbar">
          <div className="flex items-center gap-2">
            <span className="text-xs text-secondary font-bold">
              {activeScriptTab === "pre" ? "Pre-request" : "Post-response"}{" "}
              Script
            </span>
            <span className="text-xxs text-muted italic">
              (JavaScript-like pseudo code)
            </span>
          </div>
          <div className="flex gap-1">
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => setShowBuiltIn(!showBuiltIn)}
              title="Load built-in script"
            >
              <Plus size={11} />
              <span>Built-in</span>
            </button>
            <button
              className="btn btn-ghost btn-xs"
              onClick={clearEditor}
              title="Clear script"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>

        <div className="editor-body" style={{ minHeight: 0, flex: 1 }}>
          <Editor
            height="100%"
            width="100%"
            language="javascript"
            theme="vs-dark"
            value={activeScriptTab === "pre" ? preRequestCode : postResponseCode}
            onChange={(val) => {
              const code = val || "";
              if (activeScriptTab === "pre") {
                onPreRequestChange(code);
              } else {
                onPostResponseChange(code);
              }
            }}
            options={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              minimap: { enabled: false },
              automaticLayout: true,
              scrollBeyondLastLine: false,
              cursorBlinking: "smooth",
              lineNumbers: "on",
              lineNumbersMinChars: 3,
              tabSize: 2,
              insertSpaces: true,
              wordWrap: "on",
              renderLineHighlight: "all",
              scrollbar: {
                vertical: "visible",
                horizontal: "visible",
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
              }
            }}
          />
        </div>

        <div
          className={`resizer-h ${isDraggingHeight ? "dragging" : ""}`}
          style={{ position: "absolute", bottom: "-2px", left: 0 }}
          onMouseDown={handleHeightResizeStart}
        />
      </div>

      {/* Built-in Scripts Dropdown */}
      {showBuiltIn && (
        <div className="built-in-scripts">
          <div className="built-in-header text-xs font-bold text-secondary mb-1">
            Built-in Script Templates
          </div>
          {BUILT_IN_SCRIPTS.map((script) => (
            <div
              key={script.id}
              className="built-in-item"
              onClick={() => loadBuiltInScript(script)}
            >
              <div className="built-in-name text-xs">{script.name}</div>
              <div className="built-in-desc text-xxs text-muted">
                {script.description}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Script Console Output */}
      {scriptOutput.length > 0 && (
        <div className="script-output">
          <div
            className="script-output-header"
            onClick={() => setOutputExpanded(!outputExpanded)}
          >
            {outputExpanded ? (
              <ChevronDown size={11} />
            ) : (
              <ChevronRight size={11} />
            )}
            <Terminal size={11} />
            <span className="text-xxs font-bold">
              Script Output ({scriptOutput.length} lines)
            </span>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => setScriptOutput([])}
            >
              <Trash2 size={10} />
            </button>
          </div>
          {outputExpanded && (
            <pre className="script-output-content">
              {scriptOutput.join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
