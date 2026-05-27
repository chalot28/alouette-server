import { useState, useEffect, useRef } from "react";
import { Save, FileCode, Check, AlertCircle, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import Editor from "@monaco-editor/react";

interface CodeEditorProps {
  theme?: "dark" | "light";
  filePath: string | null;
  content: string | null;
  isLoading: boolean;
  error: string | null;
  onFileSaved?: () => void;
  onChange?: (val: string) => void;
  onSave?: (val: string) => void;
  scrollPositionsRef: React.MutableRefObject<{ [path: string]: number }>;
  cursorPositionsRef: React.MutableRefObject<{ [path: string]: { start: number; end: number } }>;
}

const getLanguageFromPath = (path: string | null): string => {
  if (!path) return "plaintext";
  const fileName = path.split(/[\\/]/).pop()?.toLowerCase() || "";
  
  if (fileName.startsWith(".env")) {
    return "ini";
  }
  
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case "js":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "html":
      return "html";
    case "css":
      return "css";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "rs":
      return "rust";
    case "toml":
      return "toml";
    case "yaml":
    case "yml":
      return "yaml";
    case "py":
      return "python";
    case "go":
      return "go";
    case "sh":
    case "bash":
    case "zsh":
      return "shell";
    case "sql":
      return "sql";
    case "xml":
      return "xml";
    case "c":
    case "cpp":
    case "h":
    case "hpp":
      return "cpp";
    case "java":
      return "java";
    case "cs":
      return "csharp";
    default:
      return "plaintext";
  }
};

export default function CodeEditor({
  theme = "dark",
  filePath,
  content: initialContent,
  isLoading,
  error,
  onFileSaved,
  onChange,
  onSave,
  scrollPositionsRef,
  cursorPositionsRef
}: CodeEditorProps) {
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const editorRef = useRef<any>(null);
  const lastPathRef = useRef<string | null>(null);

  // Save position on unmount or file path change
  useEffect(() => {
    return () => {
      if (filePath && editorRef.current) {
        const editor = editorRef.current;
        const model = editor.getModel();
        if (model) {
          scrollPositionsRef.current[filePath] = editor.getScrollTop();
          const selection = editor.getSelection();
          if (selection) {
            cursorPositionsRef.current[filePath] = {
              start: model.getOffsetAt({ lineNumber: selection.startLineNumber, column: selection.startColumn }),
              end: model.getOffsetAt({ lineNumber: selection.endLineNumber, column: selection.endColumn })
            };
          }
        }
      }
    };
  }, [filePath, scrollPositionsRef, cursorPositionsRef]);

  // Sync internal content with parent's decoded content without cursor jumping
  useEffect(() => {
    if (filePath !== lastPathRef.current || (initialContent !== null && originalContent === "")) {
      if (initialContent !== null) {
        setContent(initialContent);
        setOriginalContent(initialContent);
        lastPathRef.current = filePath;

        // Restore scroll and cursor for the new file path using setTimeout
        if (filePath && editorRef.current) {
          const editor = editorRef.current;
          const model = editor.getModel();
          if (model) {
            const savedScroll = scrollPositionsRef.current[filePath] || 0;
            const savedCursor = cursorPositionsRef.current[filePath];

            setTimeout(() => {
              if (savedCursor) {
                const startPos = model.getPositionAt(savedCursor.start);
                const endPos = model.getPositionAt(savedCursor.end);
                editor.setSelection({
                  startLineNumber: startPos.lineNumber,
                  startColumn: startPos.column,
                  endLineNumber: endPos.lineNumber,
                  endColumn: endPos.column,
                });
              }
              editor.setScrollTop(savedScroll);
            }, 0);
          }
        }
      } else {
        setContent("");
        setOriginalContent("");
        lastPathRef.current = null;
      }
    }
    setSaveStatus("idle");
  }, [initialContent, filePath]);

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;

    // Restore scroll and cursor for the active file path
    if (filePath) {
      const model = editor.getModel();
      if (model) {
        const savedScroll = scrollPositionsRef.current[filePath] || 0;
        const savedCursor = cursorPositionsRef.current[filePath];

        if (savedCursor) {
          const startPos = model.getPositionAt(savedCursor.start);
          const endPos = model.getPositionAt(savedCursor.end);
          editor.setSelection({
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column,
          });
        }
        editor.setScrollTop(savedScroll);
      }
    }
  };

  const handleSave = async () => {
    if (!filePath || saveStatus === "saving") return;
    setSaveStatus("saving");
    try {
      // Get latest content from editor if available, to make sure it is 100% in sync
      const latestContent = editorRef.current ? editorRef.current.getValue() : content;
      await invoke("write_file_content", { path: filePath, content: latestContent });
      setOriginalContent(latestContent);
      setSaveStatus("success");
      if (onFileSaved) onFileSaved();
      if (onSave) onSave(latestContent);
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err: any) {
      console.error("Error writing file:", err);
      setSaveStatus("error");
      alert(`Save failed: ${err.toString()}`);
    }
  };

  // Keyboard shortcut Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [content, filePath, saveStatus]);

  const isDirty = content !== originalContent;
  const fileName = filePath ? filePath.split(/[\\/]/).pop() : "";

  if (!filePath) {
    return (
      <div className="code-editor-empty">
        <FileCode size={32} className="empty-icon" />
        <h3>No File Selected</h3>
        <p>Click on any file in the Project Explorer to read and edit it directly here.</p>
      </div>
    );
  }

  return (
    <div className="code-editor-container">
      <div className="code-editor-header">
        <div className="file-info">
          <FileCode size={14} className="file-icon" />
          <span className="file-name">{fileName}</span>
          {isDirty && <span className="dirty-dot" title="Unsaved changes" />}
          <span className="file-path">{filePath}</span>
        </div>
        <div className="editor-actions">
          {saveStatus === "saving" && (
            <span className="save-status-indicator text-muted">
              <RefreshCw size={11} className="spin-animation" /> Saving...
            </span>
          )}
          {saveStatus === "success" && (
            <span className="save-status-indicator text-success">
              <Check size={11} /> Saved
            </span>
          )}
          <button
            className={`btn-save-file ${isDirty ? "dirty" : ""}`}
            onClick={handleSave}
            disabled={!isDirty || saveStatus === "saving"}
            title="Save file (Ctrl + S)"
          >
            <Save size={12} />
            <span>Save</span>
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="editor-loading">
          <RefreshCw size={24} className="spin-animation" />
          <span>Reading file contents...</span>
        </div>
      ) : error ? (
        <div className="editor-error">
          <AlertCircle size={24} />
          <span>{error}</span>
        </div>
      ) : (
        <div className="editor-body" style={{ minHeight: 0, flex: 1 }}>
          <Editor
            height="100%"
            width="100%"
            language={getLanguageFromPath(filePath)}
            theme={theme === "light" ? "light" : "vs-dark"}
            value={content}
            onChange={(val) => {
              const newVal = val || "";
              setContent(newVal);
              if (onChange) onChange(newVal);
            }}
            onMount={handleEditorDidMount}
            options={{
              fontSize: 12,
              fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
              minimap: { enabled: false },
              automaticLayout: true,
              scrollBeyondLastLine: false,
              cursorBlinking: "smooth",
              lineNumbers: "on",
              lineNumbersMinChars: 5,
              tabSize: 4,
              insertSpaces: true,
              wordWrap: "on",
              renderLineHighlight: "all",
              scrollbar: {
                vertical: "visible",
                horizontal: "visible",
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
