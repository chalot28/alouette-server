import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Folder, FolderOpen, File, ChevronRight, ChevronDown, Code, Braces } from "lucide-react";

interface FileNode {
  name: String;
  path: String;
  is_dir: boolean;
  children?: FileNode[];
}

interface FileExplorerProps {
  activeCwd: string | undefined;
  onFileSelect: (filePath: string) => void;
}

// Sub-component to render directory tree nodes recursively
function TreeNode({ node, onFileSelect }: { node: FileNode; onFileSelect: (filePath: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);

  const getFileIcon = (fileName: string, isDir: boolean) => {
    if (isDir) {
      return isOpen ? (
        <FolderOpen size={13} className="tree-node-icon folder" />
      ) : (
        <Folder size={13} className="tree-node-icon folder" />
      );
    }

    // Assign specific icons for common extension files
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith(".json")) {
      return <Braces size={13} style={{ color: "#f59e0b" }} />;
    }
    if (
      lowerName.endsWith(".js") ||
      lowerName.endsWith(".ts") ||
      lowerName.endsWith(".tsx") ||
      lowerName.endsWith(".jsx") ||
      lowerName.endsWith(".rs")
    ) {
      return <Code size={13} style={{ color: "#3a86ff" }} />;
    }
    return <File size={13} className="tree-node-icon file" />;
  };

  const handleRowClick = () => {
    if (node.is_dir) {
      setIsOpen(!isOpen);
    } else {
      onFileSelect(node.path as string);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div className="tree-node-row" onClick={handleRowClick}>
        {node.is_dir ? (
          <span style={{ display: "inline-flex", marginRight: "2px" }}>
            {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        ) : (
          <span style={{ width: "13px", display: "inline-block" }} />
        )}
        {getFileIcon(node.name as string, node.is_dir)}
        <span className="tree-node-name">{node.name}</span>
      </div>

      {node.is_dir && isOpen && node.children && (
        <div style={{ paddingLeft: "12px", borderLeft: "1px solid var(--border-primary)", marginLeft: "18px" }}>
          {node.children.map((child, idx) => (
            <TreeNode key={idx} node={child} onFileSelect={onFileSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileExplorer({ activeCwd, onFileSelect }: FileExplorerProps) {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function fetchFiles() {
      setLoading(true);
      setError(null);
      try {
        // Read directory from active cwd or let Rust backend fall back to its standard process dir
        const data = await invoke<FileNode[]>("get_project_files", {
          dirPath: activeCwd || null,
        });
        setFiles(data);
      } catch (e: any) {
        console.error("Failed to load project files tree:", e);
        setError(e.toString());
      } finally {
        setLoading(false);
      }
    }

    fetchFiles();
  }, [activeCwd]);

  return (
    <div className="explorer-container">
      <header className="explorer-header">
        <Folder size={11} />
        <span>PROJECT EXPLORER</span>
      </header>

      <div className="explorer-scroll-viewport">
        {loading && <div className="explorer-empty">Traversing files...</div>}
        {!loading && error && (
          <div className="explorer-empty" style={{ color: "var(--color-danger)" }}>
            Error listing directory
          </div>
        )}
        {!loading && !error && files.length === 0 && (
          <div className="explorer-empty">Folder is empty</div>
        )}
        {!loading && !error && files.length > 0 && (
          <div>
            {files.map((file, idx) => (
              <TreeNode key={idx} node={file} onFileSelect={onFileSelect} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
