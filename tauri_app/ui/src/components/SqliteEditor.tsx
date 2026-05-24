import { useState, useEffect } from "react";
import { 
  Database, 
  Plus, 
  Trash2, 
  RefreshCw, 
  AlertCircle, 
  Check, 
  PlusCircle, 
  Key, 
  FileSpreadsheet, 
  HelpCircle,
  Columns
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface SqliteColumn {
  name: string;
  data_type: string;
  is_pk: boolean;
}

interface SqliteTableData {
  columns: SqliteColumn[];
  rows: any[][];
}

interface SqliteEditorProps {
  filePath: string;
}

export default function SqliteEditor({ filePath }: SqliteEditorProps) {
  const [tables, setTables] = useState<string[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [data, setData] = useState<SqliteTableData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Cell editing state
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; colName: string } | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  // Add column form state
  const [showAddColumn, setShowAddColumn] = useState<boolean>(false);
  const [newColName, setNewColName] = useState<string>("");
  const [newColType, setNewColType] = useState<string>("TEXT");

  // Save status toast
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");

  const fileName = filePath.split(/[\\/]/).pop() || "";

  // Load tables in the database
  const loadTables = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoke<string[]>("get_sqlite_tables", { path: filePath });
      setTables(res);
      if (res.length > 0) {
        // Auto-select first table if none is active, or preserve active table if it still exists
        if (!activeTable || !res.includes(activeTable)) {
          setActiveTable(res[0]);
        }
      } else {
        setActiveTable(null);
        setData(null);
      }
    } catch (err: any) {
      console.error("Error loading SQLite tables:", err);
      setError(`Failed to read database: ${err.toString()}`);
    } finally {
      setLoading(false);
    }
  };

  // Load active table data
  const loadTableData = async (tableName: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoke<SqliteTableData>("get_sqlite_table_data", { 
        path: filePath, 
        table: tableName 
      });
      setData(res);
    } catch (err: any) {
      console.error("Error loading table data:", err);
      setError(`Failed to load table data: ${err.toString()}`);
    } finally {
      setLoading(false);
    }
  };

  // Load tables initially
  useEffect(() => {
    loadTables();
  }, [filePath]);

  // Load table data when active table changes
  useEffect(() => {
    if (activeTable) {
      loadTableData(activeTable);
    } else {
      setData(null);
    }
    setShowAddColumn(false);
  }, [activeTable]);

  // Show dynamic status message
  const triggerStatus = (status: "saving" | "success" | "error", message: string) => {
    setSaveStatus(status);
    setStatusMessage(message);
    if (status !== "saving") {
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  };

  // Find primary key column info
  const pkColumn = data?.columns.find(c => c.is_pk);
  const pkIndex = data?.columns.findIndex(c => c.is_pk) ?? -1;

  // Handle cell edit commit
  const handleCellSave = async (rowIndex: number, colName: string, originalValue: any) => {
    setEditingCell(null);
    if (!activeTable || !data || !pkColumn || pkIndex === -1) return;

    const row = data.rows[rowIndex];
    const pkValue = row[pkIndex];

    // Determine type and format value
    const colInfo = data.columns.find(c => c.name === colName);
    let formattedValue: any = editValue;

    if (editValue === "" || editValue.toLowerCase() === "null") {
      formattedValue = null;
    } else if (colInfo) {
      const type = colInfo.data_type.toUpperCase();
      if (type.includes("INT") || type.includes("NUM")) {
        const parsed = parseInt(editValue, 10);
        formattedValue = isNaN(parsed) ? editValue : parsed;
      } else if (type.includes("REAL") || type.includes("FLOAT") || type.includes("DOUBLE")) {
        const parsed = parseFloat(editValue);
        formattedValue = isNaN(parsed) ? editValue : parsed;
      }
    }

    // Skip update if value hasn't changed
    if (formattedValue === originalValue) return;

    triggerStatus("saving", "Saving changes to database...");
    try {
      await invoke("update_sqlite_cell", {
        path: filePath,
        table: activeTable,
        column: colName,
        value: formattedValue,
        pkColumn: pkColumn.name,
        pkValue: pkValue
      });
      triggerStatus("success", "Saved successfully!");
      // Refresh local table data
      loadTableData(activeTable);
    } catch (err: any) {
      console.error("Failed to update cell:", err);
      triggerStatus("error", `Save failed: ${err.toString()}`);
    }
  };

  // Add a new row visually
  const handleAddRow = async () => {
    if (!activeTable) return;
    triggerStatus("saving", "Inserting new row...");
    try {
      await invoke("insert_sqlite_row", {
        path: filePath,
        table: activeTable
      });
      triggerStatus("success", "New row added!");
      loadTableData(activeTable);
    } catch (err: any) {
      console.error("Failed to add row:", err);
      triggerStatus("error", `Failed to add row: ${err.toString()}`);
    }
  };

  // Delete a row
  const handleDeleteRow = async (rowIndex: number) => {
    if (!activeTable || !data || !pkColumn || pkIndex === -1) return;
    
    const row = data.rows[rowIndex];
    const pkValue = row[pkIndex];

    if (!confirm(`Are you sure you want to delete this row (ID: ${pkValue})?`)) return;

    triggerStatus("saving", "Deleting row...");
    try {
      await invoke("delete_sqlite_row", {
        path: filePath,
        table: activeTable,
        pkColumn: pkColumn.name,
        pkValue: pkValue
      });
      triggerStatus("success", "Row deleted!");
      loadTableData(activeTable);
    } catch (err: any) {
      console.error("Failed to delete row:", err);
      triggerStatus("error", `Failed to delete row: ${err.toString()}`);
    }
  };

  // Add a new column
  const handleAddColumnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTable || !newColName.trim()) return;

    triggerStatus("saving", "Adding column...");
    try {
      await invoke("add_sqlite_column", {
        path: filePath,
        table: activeTable,
        colName: newColName.trim().replace(/[^a-zA-Z0-9_]/g, "_"), // safe column name
        colType: newColType
      });
      triggerStatus("success", `Column "${newColName}" added successfully!`);
      setNewColName("");
      setShowAddColumn(false);
      loadTableData(activeTable);
    } catch (err: any) {
      console.error("Failed to add column:", err);
      triggerStatus("error", `Failed to add column: ${err.toString()}`);
    }
  };

  return (
    <div className="sqlite-editor-container">
      {/* Editor Header */}
      <div className="sqlite-editor-header">
        <div className="db-info">
          <Database size={16} className="db-icon text-accent" />
          <span className="db-name font-semibold">{fileName}</span>
          <span className="db-badge">SQLite DB</span>
          <span className="db-path text-muted">{filePath}</span>
        </div>
        
        {/* Save Status Indicators */}
        <div className="status-indicator-zone">
          {saveStatus === "saving" && (
            <span className="status-badge text-muted">
              <RefreshCw size={12} className="spin-animation" /> {statusMessage}
            </span>
          )}
          {saveStatus === "success" && (
            <span className="status-badge text-success">
              <Check size={12} /> {statusMessage}
            </span>
          )}
          {saveStatus === "error" && (
            <span className="status-badge text-danger" title={statusMessage}>
              <AlertCircle size={12} /> {statusMessage.length > 30 ? statusMessage.slice(0, 30) + "..." : statusMessage}
            </span>
          )}
        </div>
      </div>

      {/* Editor Main Content Area */}
      <div className="sqlite-editor-body">
        {/* Left Sidebar - Table List */}
        <div className="sqlite-sidebar">
          <div className="sidebar-title">
            <FileSpreadsheet size={13} />
            <span>Tables ({tables.length})</span>
            <button 
              className="refresh-btn" 
              onClick={loadTables} 
              title="Refresh database structure"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="tables-list">
            {tables.map(tbl => (
              <button
                key={tbl}
                className={`table-list-item ${activeTable === tbl ? "active" : ""}`}
                onClick={() => setActiveTable(tbl)}
              >
                <FileSpreadsheet size={13} className="tbl-icon" />
                <span className="tbl-name">{tbl}</span>
              </button>
            ))}
            {tables.length === 0 && !loading && (
              <div className="empty-tables text-muted">No tables found.</div>
            )}
          </div>
        </div>

        {/* Right Area - Grid view */}
        <div className="sqlite-grid-area">
          {error && (
            <div className="sqlite-error-banner">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {activeTable ? (
            <div className="table-grid-view">
              {/* Grid Control Toolbar */}
              <div className="grid-toolbar">
                <div className="table-meta">
                  <span className="table-title font-semibold">{activeTable}</span>
                  <span className="row-count text-muted">{data?.rows.length ?? 0} rows</span>
                </div>
                
                {/* Visual Direct Actions */}
                <div className="toolbar-actions">
                  {pkColumn ? (
                    <button 
                      className="btn-toolbar btn-primary" 
                      onClick={handleAddRow}
                      title="Add a new empty row to this table"
                    >
                      <Plus size={13} />
                      <span>Add Row</span>
                    </button>
                  ) : (
                    <div className="no-pk-warning" title="Primary key is required to add or edit rows.">
                      <HelpCircle size={12} />
                      <span>Read-only Mode (No PK)</span>
                    </div>
                  )}

                  <button 
                    className={`btn-toolbar ${showAddColumn ? "active" : ""}`}
                    onClick={() => setShowAddColumn(!showAddColumn)}
                    title="Add a new column visually to this table"
                  >
                    <Columns size={13} />
                    <span>Add Column</span>
                  </button>

                  <button 
                    className="btn-toolbar" 
                    onClick={() => loadTableData(activeTable)}
                    title="Reload data"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
              </div>

              {/* Add Column Dropdown Panel */}
              {showAddColumn && (
                <form className="add-column-panel animate-fade-in" onSubmit={handleAddColumnSubmit}>
                  <div className="form-group">
                    <label>Column Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. created_at" 
                      value={newColName} 
                      onChange={e => setNewColName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Type</label>
                    <select value={newColType} onChange={e => setNewColType(e.target.value)}>
                      <option value="TEXT">TEXT</option>
                      <option value="INTEGER">INTEGER</option>
                      <option value="REAL">REAL</option>
                    </select>
                  </div>
                  <div className="form-buttons">
                    <button type="submit" className="btn-form btn-primary">Add</button>
                    <button type="button" className="btn-form btn-cancel" onClick={() => setShowAddColumn(false)}>Cancel</button>
                  </div>
                </form>
              )}

              {/* Table Data View */}
              {loading && !data ? (
                <div className="grid-loading">
                  <RefreshCw size={24} className="spin-animation" />
                  <span>Loading table records...</span>
                </div>
              ) : data ? (
                <div className="table-viewport">
                  <table>
                    <thead>
                      <tr>
                        {data.columns.map(col => (
                          <th key={col.name} className={col.is_pk ? "pk-header" : ""}>
                            <div className="header-cell">
                              {col.is_pk && <Key size={11} className="pk-icon text-accent" title="Primary Key" />}
                              <span className="col-name">{col.name}</span>
                              <span className="col-type text-muted">{col.data_type.toLowerCase()}</span>
                            </div>
                          </th>
                        ))}
                        {pkColumn && <th className="actions-header">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, rIdx) => (
                        <tr key={rIdx}>
                          {row.map((val, cIdx) => {
                            const colName = data.columns[cIdx].name;
                            const isEditing = editingCell?.rowIndex === rIdx && editingCell?.colName === colName;

                            return (
                              <td 
                                key={cIdx} 
                                className={`grid-cell ${val === null ? "cell-null" : ""} ${typeof val === "number" ? "text-right" : ""}`}
                                onDoubleClick={() => {
                                  // Can only edit if there is a primary key in the table
                                  if (pkColumn) {
                                    setEditingCell({ rowIndex: rIdx, colName });
                                    setEditValue(val === null ? "" : String(val));
                                  }
                                }}
                                title={pkColumn ? "Double-click to edit cell" : "Read-only table"}
                              >
                                {isEditing ? (
                                  <input
                                    type="text"
                                    className="cell-input"
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={() => handleCellSave(rIdx, colName, val)}
                                    onKeyDown={e => {
                                      if (e.key === "Enter") handleCellSave(rIdx, colName, val);
                                      if (e.key === "Escape") setEditingCell(null);
                                    }}
                                    autoFocus
                                  />
                                ) : val === null ? (
                                  <span className="null-tag">NULL</span>
                                ) : (
                                  <span className="cell-value">{String(val)}</span>
                                )}
                              </td>
                            );
                          })}
                          
                          {/* Visual Actions (Delete Row) */}
                          {pkColumn && (
                            <td className="actions-cell">
                              <button 
                                className="delete-row-btn" 
                                onClick={() => handleDeleteRow(rIdx)}
                                title="Delete this row"
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                      {data.rows.length === 0 && (
                        <tr>
                          <td colSpan={data.columns.length + (pkColumn ? 1 : 0)} className="empty-rows text-muted">
                            Table contains no records. Click "Add Row" to insert data.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid-empty-state">
              <Database size={32} className="empty-icon text-muted" />
              <h3>No Table Selected</h3>
              <p>Choose a table from the sidebar to view and edit its records directly.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
