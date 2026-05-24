import brandIcon from "./brand-icon.png";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  FileText,
  Settings,
  Search,
  Sun,
  Moon,
  Minus,
  Square,
  X
} from "lucide-react";

interface HeaderProps {
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  fileMenuOpen: boolean;
  setFileMenuOpen: (o: boolean) => void;
  settingMenuOpen: boolean;
  setSettingMenuOpen: (o: boolean) => void;
  handleExportConfig: () => void;
  handleImportMockConfig: () => void;
  wipeConfig: () => void;
}

export default function Header({
  theme,
  setTheme,
  searchQuery,
  setSearchQuery,
  fileMenuOpen,
  setFileMenuOpen,
  settingMenuOpen,
  setSettingMenuOpen,
  handleExportConfig,
  handleImportMockConfig,
  wipeConfig
}: HeaderProps) {
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

  return (
    <header className="global-header" data-tauri-drag-region>
      <div className="header-left">
        <div className="brand" data-tauri-drag-region>
          <img src={brandIcon} className="brand-icon" alt="App Icon" />
        </div>

        <div className="top-red-boxes">
          <div className="dropdown-container">
            <button
              className={`btn-top-box ${fileMenuOpen ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setFileMenuOpen(!fileMenuOpen);
                setSettingMenuOpen(false);
              }}
            >
              <FileText size={13} />
              <span>File</span>
            </button>
            {fileMenuOpen && (
              <div className="dropdown-menu">
                <button className="dropdown-item" onClick={handleExportConfig}>
                  Export Configurations
                </button>
                <button className="dropdown-item" onClick={handleImportMockConfig}>
                  Load Demo Templates
                </button>
                <div className="dropdown-divider"></div>
                <button
                  className="dropdown-item text-danger"
                  onClick={() => {
                    if (confirm("Are you sure you want to wipe all configurations?")) {
                      wipeConfig();
                    }
                  }}
                >
                  Wipe Configurations
                </button>
              </div>
            )}
          </div>

          <div className="dropdown-container">
            <button
              className={`btn-top-box ${settingMenuOpen ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setSettingMenuOpen(!settingMenuOpen);
                setFileMenuOpen(false);
              }}
            >
              <Settings size={13} />
              <span>Setting</span>
            </button>
            {settingMenuOpen && (
              <div className="dropdown-menu">
                <div className="dropdown-header">Buffer Settings</div>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    alert("Log buffer capped at 2000 lines.");
                    setSettingMenuOpen(false);
                  }}
                >
                  Capped 2000 lines
                </button>
                <div className="dropdown-divider"></div>
                <div className="dropdown-header">System Style</div>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setTheme(theme === "dark" ? "light" : "dark");
                    setSettingMenuOpen(false);
                  }}
                >
                  Toggle Theme ({theme.toUpperCase()})
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Center Search (Big box in the middle) */}
      <div className="header-center">
        <div className="search-bar-wrapper">
          <Search size={13} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search processes, logs, commands..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear-btn" onClick={() => setSearchQuery("")}>
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="header-right">

        <button
          className="btn-theme-toggle"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title="Toggle theme"
        >
          {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
        </button>

        {/* Custom Window Action Controls */}
        <div className="window-controls-container">
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
    </header>
  );
}
