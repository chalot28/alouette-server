import { useState, useEffect, useRef } from "react";
import { Save, FileCode, Check, AlertCircle, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface CodeEditorProps {
  filePath: string | null;
  content: string | null;
  isLoading: boolean;
  error: string | null;
  onFileSaved?: () => void;
}

export default function CodeEditor({
  filePath,
  content: initialContent,
  isLoading,
  error,
  onFileSaved
}: CodeEditorProps) {
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // Sync internal content with parent's decoded content when it loads or when path changes
  useEffect(() => {
    if (initialContent !== null) {
      setContent(initialContent);
      setOriginalContent(initialContent);
    } else {
      setContent("");
      setOriginalContent("");
    }
    setSaveStatus("idle");
  }, [initialContent, filePath]);


  // Sync scroll between textarea and line numbers
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const handleSave = async () => {
    if (!filePath || saveStatus === "saving") return;
    setSaveStatus("saving");
    try {
      await invoke("write_file_content", { path: filePath, content });
      setOriginalContent(content);
      setSaveStatus("success");
      if (onFileSaved) onFileSaved();
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

  // Split lines to generate line numbers
  const lines = content.split("\n");
  const lineNumbers = Array.from({ length: lines.length }, (_, i) => i + 1);

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
        <div className="editor-body">
          <div className="line-numbers" ref={lineNumbersRef}>
            {lineNumbers.map((num) => (
              <div key={num} className="line-number-item">
                {num}
              </div>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            className="editor-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onScroll={handleScroll}
            spellCheck={false}
            placeholder="Type code here..."
          />
        </div>
      )}
    </div>
  );
}
