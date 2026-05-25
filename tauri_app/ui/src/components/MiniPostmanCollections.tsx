import { useState } from "react";
import {
  Plus,
  Trash2,
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  Upload,
  Download,
} from "lucide-react";

/* ---- Types ---- */
export interface CollectionItem {
  id: string;
  name: string;
  type: "folder" | "request";
  children?: CollectionItem[];
  request?: {
    method: string;
    url: string;
    headers: { key: string; value: string; enabled: boolean }[];
    body: string;
    bodyType: string;
    authType: string;
    bearerToken?: string;
    basicUsername?: string;
    basicPassword?: string;
    apiKeyName?: string;
    apiKeyValue?: string;
    apiKeyAddto?: string;
  };
}

interface Props {
  onLoadRequest?: (request: NonNullable<CollectionItem["request"]>) => void;
}

/* ---- Helpers ---- */
const generateId = () => Math.random().toString(36).substring(2, 10);

const loadCollections = (): CollectionItem[] => {
  try {
    const raw = localStorage.getItem("postman_collections");
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [
    {
      id: generateId(),
      name: "My Collection",
      type: "folder",
      children: [],
    },
  ];
};

const saveCollections = (items: CollectionItem[]) => {
  localStorage.setItem("postman_collections", JSON.stringify(items));
};

/* ---- Export Postman Collection v2.1 ---- */
const exportPostmanCollection = (items: CollectionItem[]) => {
  const buildItem = (item: CollectionItem): any => {
    if (item.type === "folder") {
      return {
        name: item.name,
        item: (item.children || []).map(buildItem),
      };
    }
    const req = item.request || {
      method: "GET",
      url: "",
      headers: [],
      body: "",
      bodyType: "none",
      authType: "none",
    };
    const headerArr = req.headers
      .filter((h) => h.enabled && h.key)
      .map((h) => ({ key: h.key, value: h.value, type: "text" }));
    const bodyObj: any = {};
    if (req.bodyType !== "none") {
      bodyObj.mode = req.bodyType === "json" ? "raw" : req.bodyType;
      if (bodyObj.mode === "raw") {
        bodyObj.raw = req.body;
        bodyObj.options = {
          raw: { language: req.bodyType === "json" ? "json" : "text" },
        };
      } else if (req.bodyType === "urlencoded") {
        bodyObj.urlencoded = [];
      }
    }
    return {
      name: item.name,
      request: {
        method: req.method,
        header: headerArr,
        url: { raw: req.url },
        body: bodyObj,
      },
    };
  };

  const collection = {
    info: {
      name: "Exported Collection",
      schema:
        "https://schemas.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: items.map(buildItem),
  };

  const blob = new Blob([JSON.stringify(collection, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "postman_collection.json";
  a.click();
  URL.revokeObjectURL(url);
};

/* ---- Import Postman/OpenAPI ---- */
const importCollection = (jsonText: string): CollectionItem[] => {
  try {
    const data = JSON.parse(jsonText);
    // Postman Collection v2.1
    if (data.info && data.item) {
      const parsePostmanItem = (item: any): CollectionItem => {
        if (item.item) {
          return {
            id: generateId(),
            name: item.name || "Folder",
            type: "folder",
            children: item.item.map(parsePostmanItem),
          };
        }
        const request = item.request || {};
        return {
          id: generateId(),
          name: item.name || "Request",
          type: "request",
          request: {
            method: request.method || "GET",
            url:
              typeof request.url === "object"
                ? request.url.raw || ""
                : request.url || "",
            headers: (request.header || []).map((h: any) => ({
              key: h.key || "",
              value: h.value || "",
              enabled: true,
            })),
            body: request.body?.raw || "",
            bodyType:
              request.body?.mode === "raw"
                ? "json"
                : request.body?.mode || "none",
            authType: "none",
          },
        };
      };
      return data.item.map(parsePostmanItem);
    }
    // Swagger/OpenAPI v3
    if (data.openapi || data.swagger) {
      return parseOpenApi(data);
    }
  } catch {
    /* ignore */
  }
  return [];
};

const parseOpenApi = (spec: any): CollectionItem[] => {
  const paths = spec.paths || {};
  const folders: Record<string, CollectionItem> = {};
  const rootItems: CollectionItem[] = [];

  Object.entries(paths).forEach(([path, methods]: [string, any]) => {
    Object.entries(methods).forEach(([method, details]: [string, any]) => {
      const tags = details.tags || ["Default"];
      const tag = tags[0];
      if (!folders[tag]) {
        folders[tag] = {
          id: generateId(),
          name: tag,
          type: "folder",
          children: [],
        };
        rootItems.push(folders[tag]);
      }
      const contentType = Object.keys(
        details.requestBody?.content || { "application/json": {} },
      )[0];
      let body = "";
      let bodyType = "none";
      if (contentType) {
        try {
          const example =
            details.requestBody?.content?.[contentType]?.example ||
            details.requestBody?.content?.[contentType]?.schema?.example;
          body = example ? JSON.stringify(example, null, 2) : "";
          bodyType = contentType.includes("json")
            ? "json"
            : contentType.includes("urlencoded")
              ? "urlencoded"
              : "text";
        } catch {
          /* ignore */
        }
      }
      folders[tag].children!.push({
        id: generateId(),
        name: details.summary || `${method.toUpperCase()} ${path}`,
        type: "request",
        request: {
          method: method.toUpperCase(),
          url: (spec.servers?.[0]?.url || spec.host || "") + path,
          headers: [],
          body,
          bodyType,
          authType: "none",
        },
      });
    });
  });

  return rootItems;
};

/* =====================================================================
   MiniPostmanCollections Component
   ===================================================================== */
export default function MiniPostmanCollections({ onLoadRequest }: Props) {
  const [collections, setCollections] =
    useState<CollectionItem[]>(loadCollections);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );

  const [importText, setImportText] = useState("");
  const [showImportInput, setShowImportInput] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: CollectionItem;
  } | null>(null);

  const persist = (items: CollectionItem[]) => {
    setCollections(items);
    saveCollections(items);
  };

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addFolder = (parentId?: string) => {
    const name = prompt("Folder name:") || "New Folder";
    const newFolder: CollectionItem = {
      id: generateId(),
      name,
      type: "folder",
      children: [],
    };

    if (!parentId) {
      persist([...collections, newFolder]);
    } else {
      const updateChildren = (items: CollectionItem[]): CollectionItem[] =>
        items.map((item) => {
          if (item.id === parentId && item.type === "folder") {
            return { ...item, children: [...(item.children || []), newFolder] };
          }
          if (item.children)
            return { ...item, children: updateChildren(item.children) };
          return item;
        });
      persist(updateChildren(collections));
    }
    setExpandedFolders((prev) => new Set(prev).add(parentId || newFolder.id));
  };

  const addRequest = (parentId?: string) => {
    const name = prompt("Request name:") || "New Request";
    const newReq: CollectionItem = {
      id: generateId(),
      name,
      type: "request",
      request: {
        method: "GET",
        url: "",
        headers: [],
        body: "",
        bodyType: "none",
        authType: "none",
      },
    };

    if (!parentId) {
      persist([...collections, newReq]);
    } else {
      const updateChildren = (items: CollectionItem[]): CollectionItem[] =>
        items.map((item) => {
          if (item.id === parentId && item.type === "folder") {
            return { ...item, children: [...(item.children || []), newReq] };
          }
          if (item.children)
            return { ...item, children: updateChildren(item.children) };
          return item;
        });
      persist(updateChildren(collections));
    }
  };

  const deleteItem = (id: string) => {
    const remove = (items: CollectionItem[]): CollectionItem[] =>
      items
        .filter((item) => item.id !== id)
        .map((item) => {
          if (item.children)
            return { ...item, children: remove(item.children) };
          return item;
        });
    persist(remove(collections));
    setContextMenu(null);
  };

  const handleExport = () => {
    exportPostmanCollection(collections);
  };

  const handleImport = () => {
    const items = importCollection(importText);
    if (items.length > 0) {
      persist([...collections, ...items]);
      setImportText("");
      setShowImportInput(false);
    } else {
      alert(
        "Could not parse the file. Please ensure it's a valid Postman Collection or OpenAPI spec.",
      );
    }
  };

  const handleFileImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.yaml,.yml";
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        setImportText(text);
        setShowImportInput(true);
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const renderTree = (items: CollectionItem[], depth = 0): React.ReactNode => {
    return items.map((item) => (
      <div key={item.id}>
        <div
          className="sidebar-item"
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => {
            if (item.type === "folder") toggleFolder(item.id);
            else if (item.request && onLoadRequest) onLoadRequest(item.request);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, item });
          }}
        >
          {item.type === "folder" ? (
            <>
              {expandedFolders.has(item.id) ? (
                <ChevronDown size={10} style={{ flexShrink: 0 }} />
              ) : (
                <ChevronRight size={10} style={{ flexShrink: 0 }} />
              )}
              {expandedFolders.has(item.id) ? (
                <FolderOpen size={12} className="text-accent" />
              ) : (
                <Folder size={12} className="text-accent" />
              )}
            </>
          ) : (
            <>
              <span style={{ width: "10px" }} />
              <FileText size={12} className="text-muted" />
            </>
          )}
          <span
            className="item-url"
            style={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.name}
          </span>
          {item.type === "request" && item.request?.method && (
            <span
              className={`method-badge ${item.request.method.toLowerCase()}`}
              style={{ flexShrink: 0 }}
            >
              {item.request.method}
            </span>
          )}
        </div>
        {item.type === "folder" &&
          expandedFolders.has(item.id) &&
          item.children && <div>{renderTree(item.children, depth + 1)}</div>}
      </div>
    ));
  };

  return (
    <div
      className="collections-panel"
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          gap: "4px",
          padding: "4px 6px",
          borderBottom: "1px solid var(--border-primary)",
        }}
      >
        <button
          className="btn btn-ghost btn-xs"
          onClick={() => addFolder()}
          title="Add Folder"
        >
          <Folder size={11} /> <Plus size={9} />
        </button>
        <button
          className="btn btn-ghost btn-xs"
          onClick={() => addRequest()}
          title="Add Request"
        >
          <FileText size={11} /> <Plus size={9} />
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="btn btn-ghost btn-xs"
          onClick={handleExport}
          title="Export Collection"
        >
          <Download size={11} />
        </button>
        <button
          className="btn btn-ghost btn-xs"
          onClick={handleFileImport}
          title="Import Collection/Swagger"
        >
          <Upload size={11} />
        </button>
      </div>

      {/* Tree */}
      <div className="sidebar-list" style={{ flex: 1, overflow: "auto" }}>
        {collections.length === 0 ? (
          <div className="empty-state">
            <FolderOpen size={24} className="text-muted" />
            <span className="text-xs text-muted mt-1">
              No collections yet. Create a folder or request.
            </span>
          </div>
        ) : (
          renderTree(collections)
        )}
      </div>

      {/* Import Input */}
      {showImportInput && (
        <div
          style={{
            padding: "6px",
            borderTop: "1px solid var(--border-primary)",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          <textarea
            className="mono"
            rows={5}
            placeholder="Pasted JSON content..."
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            style={{
              width: "100%",
              fontSize: "10px",
              backgroundColor: "var(--bg-primary)",
              border: "1px solid var(--border-primary)",
              color: "var(--text-primary)",
              borderRadius: "4px",
              padding: "4px",
            }}
          />
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              className="btn btn-primary btn-xs"
              onClick={handleImport}
              disabled={!importText.trim()}
            >
              Import
            </button>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => {
                setShowImportInput(false);
                setImportText("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: "var(--bg-primary)",
            border: "1px solid var(--border-primary)",
            borderRadius: "4px",
            padding: "4px 0",
            zIndex: 9999,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            minWidth: "140px",
          }}
          onClick={() => setContextMenu(null)}
        >
          {contextMenu.item.type === "folder" && (
            <>
              <div
                className="context-menu-item"
                onClick={() => {
                  addRequest(contextMenu.item.id);
                  setContextMenu(null);
                }}
              >
                <FileText size={11} /> Add Request
              </div>
              <div
                className="context-menu-item"
                onClick={() => {
                  addFolder(contextMenu.item.id);
                  setContextMenu(null);
                }}
              >
                <Folder size={11} /> Add Subfolder
              </div>
              <div className="context-menu-divider" />
            </>
          )}
          <div
            className="context-menu-item"
            onClick={() => {
              deleteItem(contextMenu.item.id);
            }}
          >
            <Trash2 size={11} /> Delete
          </div>
        </div>
      )}

      <style>{`
        .context-menu-item {
          display: flex; align-items: center; gap: 6px;
          padding: 4px 10px; font-size: 11px; cursor: pointer;
          color: var(--text-primary);
        }
        .context-menu-item:hover { background-color: var(--bg-hover); }
        .context-menu-divider { height: 1px; background-color: var(--border-primary); margin: 2px 0; }
      `}</style>
    </div>
  );
}
