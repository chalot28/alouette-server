import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Folder, FolderOpen, File, ChevronRight, ChevronDown, Code, Braces, FilePlus, FolderPlus, RotateCw } from "lucide-react";

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

interface FileExplorerProps {
  activeCwd: string | undefined;
  onFileSelect: (filePath: string) => void;
}

// Helper to get parent path
const getParentPath = (path: string, isDir: boolean) => {
  if (isDir) return path;
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (lastSlash === -1) return "";
  return path.substring(0, lastSlash);
};

// Sub-component to render directory tree nodes recursively
function TreeNode({
  node,
  onFileSelect,
  onNodeContextMenu,
  onNodeChildrenLoaded,
}: {
  node: FileNode;
  onFileSelect: (filePath: string) => void;
  onNodeContextMenu: (x: number, y: number, path: string, isDir: boolean) => void;
  onNodeChildrenLoaded: (path: string, children: FileNode[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLazyLoading, setIsLazyLoading] = useState(false);

  const getFileIcon = (fileName: string, isDir: boolean) => {
    if (isDir) {
      return isOpen ? (
        <FolderOpen size={13} className="tree-node-icon folder" />
      ) : (
        <Folder size={13} className="tree-node-icon folder" />
      );
    }

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

  const handleRowClick = async () => {
    if (node.is_dir) {
      if (!isOpen && (!node.children || node.children.length === 0)) {
        setIsLazyLoading(true);
        try {
          const data = await invoke<FileNode[]>("get_directory_contents", {
            dirPath: node.path,
          });
          onNodeChildrenLoaded(node.path, data);
        } catch (e) {
          console.error("Failed to load lazy directory contents:", e);
        } finally {
          setIsLazyLoading(false);
        }
      }
      setIsOpen(!isOpen);
    } else {
      onFileSelect(node.path);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onNodeContextMenu(e.clientX, e.clientY, node.path, node.is_dir);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }} onContextMenu={handleContextMenu}>
      <div className="tree-node-row" onClick={handleRowClick}>
        {node.is_dir ? (
          <span style={{ display: "inline-flex", marginRight: "2px" }}>
            {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        ) : (
          <span style={{ width: "13px", display: "inline-block" }} />
        )}
        {getFileIcon(node.name, node.is_dir)}
        <span className="tree-node-name">{node.name}</span>
      </div>

      {node.is_dir && isOpen && (
        <div style={{ paddingLeft: "12px", borderLeft: "1px solid var(--border-primary)", marginLeft: "18px" }}>
          {isLazyLoading && <div className="explorer-empty" style={{ padding: "4px 8px", textAlign: "left" }}>Loading...</div>}
          {!isLazyLoading && node.children && node.children.map((child, idx) => (
            <TreeNode
              key={idx}
              node={child}
              onFileSelect={onFileSelect}
              onNodeContextMenu={onNodeContextMenu}
              onNodeChildrenLoaded={onNodeChildrenLoaded}
            />
          ))}
          {!isLazyLoading && (!node.children || node.children.length === 0) && (
            <div className="explorer-empty" style={{ padding: "4px 8px", textAlign: "left" }}>Empty</div>
          )}
        </div>
      )}
    </div>
  );
}

// Tree Merging Helper
const mergeTrees = (newNodes: FileNode[], oldNodes: FileNode[]): FileNode[] => {
  return newNodes.map(newNode => {
    const oldNode = oldNodes.find(o => o.path === newNode.path);
    if (oldNode && oldNode.is_dir) {
      const mergedChildren = (newNode.children && newNode.children.length > 0)
        ? mergeTrees(newNode.children, oldNode.children || [])
        : (oldNode.children || []);
      return { ...newNode, children: mergedChildren };
    }
    return newNode;
  });
};

export default function FileExplorer({ activeCwd, onFileSelect }: FileExplorerProps) {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);


  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    targetPath: string | null;
    targetIsDir: boolean;
  }>({
    visible: false,
    x: 0,
    y: 0,
    targetPath: null,
    targetIsDir: true,
  });

  // Naming Prompt Modal State
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptType, setPromptType] = useState<"file" | "folder">("file");
  const [newItemName, setNewItemName] = useState("");

  const fetchFiles = async (silent = false) => {
    if (!silent && files.length === 0) setLoading(true);
    setError(null);
    try {
      const data = await invoke<FileNode[]>("get_project_files", {
        dirPath: activeCwd || null,
      });
      setFiles(prev => mergeTrees(data, prev));
    } catch (e: any) {
      console.error("Failed to load project files tree:", e);
      setError(e.toString());
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles(false);

    // Auto-polling mechanism to periodically fetch the project file status in the background
    const interval = setInterval(() => {
      fetchFiles(true);
    }, 1000);

    return () => clearInterval(interval);
  }, [activeCwd]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(prev => ({ ...prev, visible: false }));
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  const handleNodeContextMenu = (x: number, y: number, path: string, isDir: boolean) => {
    setContextMenu({
      visible: true,
      x,
      y,
      targetPath: path,
      targetIsDir: isDir,
    });
  };

  const handleContainerContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      targetPath: activeCwd || null,
      targetIsDir: true,
    });
  };

  const handleNodeChildrenLoaded = (path: string, children: FileNode[]) => {
    const updateTree = (nodes: FileNode[]): FileNode[] => {
      return nodes.map(n => {
        if (n.path === path) {
          return { ...n, children };
        }
        if (n.is_dir && n.children) {
          return { ...n, children: updateTree(n.children) };
        }
        return n;
      });
    };
    setFiles(prev => updateTree(prev));
  };

  const triggerCreateItem = (type: "file" | "folder") => {
    setPromptType(type);
    setNewItemName("");
    setShowPrompt(true);
  };

  const submitCreation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;

    let targetDir = activeCwd || "";
    if (contextMenu.targetPath) {
      targetDir = getParentPath(contextMenu.targetPath, contextMenu.targetIsDir);
    }

    const separator = targetDir.includes("\\") ? "\\" : "/";
    const fullPath = targetDir ? `${targetDir}${separator}${newItemName.trim()}` : newItemName.trim();

    try {
      if (promptType === "file") {
        await invoke("create_file", { path: fullPath });
      } else {
        await invoke("create_folder", { path: fullPath });
      }
      setShowPrompt(false);
      setNewItemName("");
      // Refresh immediately
      fetchFiles(true);
    } catch (err: any) {
      alert(`Error: ${err.toString()}`);
    }
  };

  return (
    <div className="explorer-container" onContextMenu={handleContainerContextMenu}>
      {/* Dynamic Styling block for action buttons & context menu */}
      <style>{`
        .explorer-action-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color var(--transition-fast);
          outline: none;
        }
        .explorer-action-btn:hover {
          color: var(--text-primary);
        }
        .explorer-context-menu {
          background-color: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          padding: 4px 0;
          min-width: 140px;
          display: flex;
          flex-direction: column;
          border-radius: 4px;
        }
        .context-menu-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          font-size: 11.5px;
          color: var(--text-secondary);
          cursor: pointer;
          transition: background-color var(--transition-fast), color var(--transition-fast);
        }
        .context-menu-item:hover {
          background-color: var(--bg-tertiary);
          color: var(--text-primary);
        }
      `}</style>

      <header className="explorer-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Folder size={11} />
          <span>PROJECT EXPLORER</span>
        </div>
        <div style={{ display: "flex", gap: "6px" }} onClick={e => e.stopPropagation()}>
          <button
            className="explorer-action-btn"
            title="New File"
            onClick={() => {
              setContextMenu(prev => ({ ...prev, targetPath: activeCwd || null, targetIsDir: true }));
              triggerCreateItem("file");
            }}
          >
            <FilePlus size={12} />
          </button>
          <button
            className="explorer-action-btn"
            title="New Folder"
            onClick={() => {
              setContextMenu(prev => ({ ...prev, targetPath: activeCwd || null, targetIsDir: true }));
              triggerCreateItem("folder");
            }}
          >
            <FolderPlus size={12} />
          </button>
          <button
            className="explorer-action-btn"
            title="Reload Explorer"
            onClick={() => fetchFiles(false)}
          >
            <RotateCw size={12} />
          </button>
        </div>
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
              <TreeNode
                key={idx}
                node={file}
                onFileSelect={onFileSelect}
                onNodeContextMenu={handleNodeContextMenu}
                onNodeChildrenLoaded={handleNodeChildrenLoaded}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sleek context menu */}
      {contextMenu.visible && (
        <div
          className="explorer-context-menu animate-fade-in"
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 1000,
          }}
          onClick={e => e.stopPropagation()}
        >
          <div
            className="context-menu-item"
            onClick={() => triggerCreateItem("file")}
          >
            <FilePlus size={12} />
            <span>New File</span>
          </div>
          <div
            className="context-menu-item"
            onClick={() => triggerCreateItem("folder")}
          >
            <FolderPlus size={12} />
            <span>New Folder</span>
          </div>
        </div>
      )}

      {/* Styled Inline Prompt Modal */}
      {showPrompt && (
        <div className="modal-overlay animate-fade-in" style={{ zIndex: 1001 }} onClick={() => setShowPrompt(false)}>
          <div className="modal-content" style={{ width: "320px", borderRadius: "4px" }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Create New {promptType === "file" ? "File" : "Folder"}</span>
              <button className="terminal-action-btn" onClick={() => setShowPrompt(false)}>✕</button>
            </div>
            <form onSubmit={submitCreation}>
              <div className="modal-body">
                <input
                  autoFocus
                  type="text"
                  className="admin-input"
                  placeholder={promptType === "file" ? "filename.txt" : "Folder Name"}
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  style={{ width: "100%", background: "var(--bg-primary)", border: "1px solid var(--border-primary)", color: "var(--text-primary)", padding: "6px 10px", borderRadius: "4px", outline: "none" }}
                />
              </div>
              <div className="modal-footer" style={{ padding: "8px 12px", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button type="button" className="btn btn-secondary btn-xs" onClick={() => setShowPrompt(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-xs">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

