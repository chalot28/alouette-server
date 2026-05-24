import { useState, useEffect, useRef } from "react";
import { Save, FileCode, Check, AlertCircle, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface CodeEditorProps {
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

export default function CodeEditor({
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const lastPathRef = useRef<string | null>(null);

  // Save position on unmount or file path change
  useEffect(() => {
    return () => {
      if (filePath && textareaRef.current) {
        scrollPositionsRef.current[filePath] = textareaRef.current.scrollTop;
        cursorPositionsRef.current[filePath] = {
          start: textareaRef.current.selectionStart,
          end: textareaRef.current.selectionEnd
        };
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
        if (filePath && textareaRef.current) {
          const savedScroll = scrollPositionsRef.current[filePath] || 0;
          const savedCursor = cursorPositionsRef.current[filePath];

          setTimeout(() => {
            if (textareaRef.current) {
              if (savedCursor) {
                textareaRef.current.selectionStart = savedCursor.start;
                textareaRef.current.selectionEnd = savedCursor.end;
              }
              textareaRef.current.scrollTop = savedScroll;
              if (lineNumbersRef.current) {
                lineNumbersRef.current.scrollTop = savedScroll;
              }
            }
          }, 0);
        }
      } else {
        setContent("");
        setOriginalContent("");
        lastPathRef.current = null;
      }
    }
    setSaveStatus("idle");
  }, [initialContent, filePath]);

  // Sync scroll between textarea and line numbers, and record scroll position
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      const scrollPos = textareaRef.current.scrollTop;
      lineNumbersRef.current.scrollTop = scrollPos;
      if (filePath) {
        scrollPositionsRef.current[filePath] = scrollPos;
      }
    }
  };

  // Record cursor selection positions on interactions
  const handleSelect = () => {
    if (textareaRef.current && filePath) {
      cursorPositionsRef.current[filePath] = {
        start: textareaRef.current.selectionStart,
        end: textareaRef.current.selectionEnd
      };
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
      if (onSave) onSave(content);
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
            onChange={(e) => {
              setContent(e.target.value);
              if (onChange) onChange(e.target.value);
            }}
            onScroll={handleScroll}
            onSelect={handleSelect}
            onKeyUp={handleSelect}
            onMouseUp={handleSelect}
            spellCheck={false}
            placeholder="Type code here..."
          />
        </div>
      )}
    </div>
  );
}
