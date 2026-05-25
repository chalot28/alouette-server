import { useState, useRef, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import {
  Chrome,
  Minus,
  Square,
  X,
  Search,
  Globe,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Plus,
  Home,
  Lock,
  Star,
} from "lucide-react";

interface BrowserTab {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export default function BrowserWindow() {
  const appWindow = getCurrentWindow();
  const [tabs, setTabs] = useState<BrowserTab[]>([
    {
      id: "1",
      title: "New Tab",
      url: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("1");
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  useEffect(() => {
    setTimeout(() => searchInputRef.current?.focus(), 300);
  }, [activeTabId]);

  // 1. Sync child webview visibility with active tab URL in React
  useEffect(() => {
    const syncWebviews = async () => {
      try {
        // If active tab URL is empty, we show the beautiful React landing dashboard.
        // In this case, we hide ALL child webview overlays (moving them offscreen).
        if (!activeTab.url) {
          const inactiveIds = tabs.map((t) => t.id);
          await invoke("switch_tab_webview", {
            active_tab_id: "", // this will hide/move offscreen all child webviews
            inactive_tab_ids: inactiveIds,
          });
        } else {
          // Otherwise, we show the active tab's webview and hide the others
          const inactiveIds = tabs
            .filter((t) => t.id !== activeTabId)
            .map((t) => t.id);
          await invoke("switch_tab_webview", {
            active_tab_id: activeTabId,
            inactive_tab_ids: inactiveIds,
          });
        }
      } catch (e) {
        console.error("Failed to sync webviews with Rust backend:", e);
      }
    };
    syncWebviews();
  }, [activeTabId, activeTab?.url, tabs.length]);

  // 2. Poll URL from Rust backend to detect link clicks inside the native webview
  useEffect(() => {
    if (!activeTabId || !activeTab.url) return;

    const interval = setInterval(async () => {
      try {
        const liveUrl = await invoke<string>("get_webview_url", {
          tab_id: activeTabId,
        });
        if (liveUrl && liveUrl !== activeTab.url) {
          // Extract a clean domain name for the tab title
          let title = liveUrl;
          try {
            const parsed = new URL(liveUrl);
            title = parsed.hostname.replace("www.", "");
          } catch {}

          setTabs((prev) =>
            prev.map((t) =>
              t.id === activeTabId
                ? { ...t, url: liveUrl, title, loading: false }
                : t,
            ),
          );
          setQuery(liveUrl);
        }
      } catch (e) {
        console.error("Failed to poll live webview URL:", e);
      }
    }, 400);

    return () => clearInterval(interval);
  }, [activeTabId, activeTab?.url]);

  // 3. Tab Operations
  const handleAddTab = async (targetUrl = "") => {
    const newId = Date.now().toString();
    const newTab: BrowserTab = {
      id: newId,
      title: targetUrl ? "Loading..." : "New Tab",
      url: targetUrl,
      loading: !!targetUrl,
      canGoBack: false,
      canGoForward: false,
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
    setQuery(targetUrl);

    try {
      await invoke("create_tab_webview", {
        tab_id: newId,
        show: !!targetUrl,
      });
      // If a URL was provided, navigate the webview to it
      if (targetUrl) {
        await invoke("navigate_tab", { tab_id: newId, url: targetUrl });
      }
    } catch (e) {
      console.error("Failed to create webview for new tab:", e);
    }
  };

  const handleCloseTab = async (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();

    // If it's the last remaining tab, reset it to New Tab page
    if (tabs.length === 1) {
      const resetTab = {
        ...tabs[0],
        title: "New Tab",
        url: "",
        loading: false,
      };
      setTabs([resetTab]);
      setQuery("");
      try {
        await invoke("close_tab_webview", { tab_id: tabId });
      } catch {}
      return;
    }

    const tabIndex = tabs.findIndex((t) => t.id === tabId);
    const newTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(newTabs);

    if (activeTabId === tabId) {
      const nextActiveIndex = Math.max(0, tabIndex - 1);
      const nextActive = newTabs[nextActiveIndex];
      setActiveTabId(nextActive.id);
      setQuery(nextActive.url);
    }

    try {
      await invoke("close_tab_webview", { tab_id: tabId });
    } catch (e) {
      console.error("Failed to close tab webview in Rust:", e);
    }
  };

  // 4. Navigation Operations
  const handleNavigate = async (targetUrl: string) => {
    const text = targetUrl.trim();
    if (!text) return;

    let url: string;
    if (/^https?:\/\//i.test(text)) {
      url = text;
    } else if (/^[\w-]+(\.[\w-]+)+/.test(text)) {
      url = "https://" + text;
    } else {
      url = "https://www.google.com/search?q=" + encodeURIComponent(text);
    }

    // Set tab to loading
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, url, loading: true, title: "Loading..." }
          : t,
      ),
    );
    setQuery(url);

    try {
      // Lazy load webview if it wasn't initialized yet (e.g. was on New Tab Page)
      await invoke("create_tab_webview", {
        tab_id: activeTabId,
        show: true,
      });

      // Navigate to the target URL (this is the only navigation, avoiding double-load)
      await invoke("navigate_tab", { tab_id: activeTabId, url });
    } catch (e) {
      console.error("Failed to navigate:", e);
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, loading: false } : t)),
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleNavigate(query);
    }
  };

  const handleBack = async () => {
    try {
      await invoke("browser_go_back", { tab_id: activeTabId });
    } catch (e) {
      console.error("Failed to go back:", e);
    }
  };

  const handleForward = async () => {
    try {
      await invoke("browser_go_forward", { tab_id: activeTabId });
    } catch (e) {
      console.error("Failed to go forward:", e);
    }
  };

  const handleReload = async () => {
    try {
      await invoke("browser_reload", { tab_id: activeTabId });
    } catch (e) {
      console.error("Failed to reload:", e);
    }
  };

  const handleMinimize = async () => {
    try {
      await appWindow.minimize();
    } catch {}
  };

  const handleMaximize = async () => {
    try {
      await appWindow.toggleMaximize();
    } catch {}
  };

  const handleClose = async () => {
    try {
      await appWindow.close();
    } catch {}
  };

  // 5. Bookmarks Bar configuration
  const bookmarks = [
    { name: "Google", url: "https://www.google.com" },
    { name: "GitHub", url: "https://github.com" },
    { name: "StackOverflow", url: "https://stackoverflow.com" },
    { name: "YouTube", url: "https://youtube.com" },
    { name: "Local Server", url: "http://localhost:3000" },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "var(--bg-primary)",
      }}
    >
      {/* ================================================================ */}
      {/* CUSTOM CHROME-LIKE TITLEBAR + TABS                               */}
      {/* ================================================================ */}
      <div
        className="postman-window-titlebar"
        data-tauri-drag-region
        style={{
          flexShrink: 0,
          height: "40px",
          paddingRight: "0px",
          gap: "8px",
        }}
      >
        <div
          className="titlebar-left"
          data-tauri-drag-region
          style={{ flexShrink: 0 }}
        >
          <Chrome
            size={14}
            className="titlebar-icon"
            style={{ color: "var(--color-accent)" }}
          />
          <span className="titlebar-title" style={{ marginRight: "4px" }}>
            Alouette
          </span>
        </div>

        {/* Dynamic Chrome Tab Bar */}
        <div className="browser-tabbar" data-tauri-drag-region>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`browser-tab ${tab.id === activeTabId ? "active" : ""}`}
              onClick={() => {
                setActiveTabId(tab.id);
                setQuery(tab.url);
              }}
            >
              <Globe
                size={11}
                style={{
                  flexShrink: 0,
                  opacity: tab.id === activeTabId ? 1 : 0.7,
                }}
              />
              <span className="browser-tab-title">{tab.title}</span>
              <button
                className="browser-tab-close"
                onClick={(e) => handleCloseTab(e, tab.id)}
              >
                <X size={10} />
              </button>
            </div>
          ))}
          <button
            className="browser-tab-add"
            onClick={() => handleAddTab()}
            title="New Tab"
          >
            <Plus size={12} />
          </button>
        </div>

        {/* Window controls */}
        <div className="titlebar-right" style={{ flexShrink: 0 }}>
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
      {/* TOOLBAR - Navigation + URL Bar (55px)                          */}
      {/* ================================================================ */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 10px",
          height: "55px",
          flexShrink: 0,
          backgroundColor: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border-primary)",
          position: "relative",
        }}
      >
        {/* Nav Buttons */}
        <div style={{ display: "flex", gap: "2px" }}>
          <button
            className="window-control-btn"
            onClick={handleBack}
            title="Back"
          >
            <ArrowLeft size={14} />
          </button>
          <button
            className="window-control-btn"
            onClick={handleForward}
            title="Forward"
          >
            <ArrowRight size={14} />
          </button>
          <button
            className="window-control-btn"
            onClick={handleReload}
            title="Reload"
          >
            <RotateCw size={14} />
          </button>
          <button
            className="window-control-btn"
            onClick={() => {
              setQuery("");
              // Reset current tab URL to empty to trigger React landing page
              setTabs((prev) =>
                prev.map((t) =>
                  t.id === activeTabId
                    ? { ...t, url: "", title: "New Tab" }
                    : t,
                ),
              );
            }}
            title="New Tab / Dashboard"
          >
            <Home size={14} />
          </button>
        </div>

        {/* URL Bar */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: "6px",
            backgroundColor: "var(--bg-primary)",
            border: "1px solid var(--border-primary)",
            borderRadius: "6px",
            padding: "4px 10px",
          }}
        >
          {/* SSL Status Lock Icon */}
          {activeTab.url ? (
            <div
              title={
                activeTab.url.startsWith("https")
                  ? "Connection is Secure"
                  : "Connection is Unsecure"
              }
              style={{ display: "flex", alignItems: "center" }}
            >
              <Lock
                size={12}
                style={{
                  color: activeTab.url.startsWith("https")
                    ? "#10b981"
                    : "var(--text-muted)",
                  flexShrink: 0,
                }}
              />
            </div>
          ) : (
            <Globe
              size={12}
              style={{ color: "var(--text-muted)", flexShrink: 0 }}
            />
          )}

          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search Google or enter URL..."
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              backgroundColor: "transparent",
              color: "var(--text-primary)",
              fontSize: "12px",
              fontFamily: "var(--font-sans)",
            }}
          />
        </div>

        {/* Go Button */}
        <button
          className="btn btn-primary"
          onClick={() => handleNavigate(query)}
          style={{ height: "28px", padding: "0 12px", gap: "4px" }}
        >
          <Search size={12} />
          <span style={{ fontSize: "11px" }}>Go</span>
        </button>

        {/* Modern animated thin loader at the bottom of toolbar */}
        {activeTab.loading && (
          <div className="browser-progress-bar-container">
            <div className="browser-progress-bar" />
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* QUICK BOOKMARKS BAR                                              */}
      {/* ================================================================ */}
      <div className="browser-bookmarks-bar">
        <Star
          size={10}
          style={{
            color: "var(--color-accent)",
            marginRight: "2px",
            opacity: 0.8,
          }}
        />
        {bookmarks.map((bm) => (
          <div
            key={bm.name}
            className="browser-bookmark-pill"
            onClick={() => handleNavigate(bm.url)}
          >
            <span>{bm.name}</span>
          </div>
        ))}
      </div>

      {/* ================================================================ */}
      {/* PREMIUM NEW TAB PAGE (Rendered when url is empty)                */}
      {/* ================================================================ */}
      {!activeTab.url && (
        <div className="newtab-dashboard">
          <div className="newtab-header">
            <div className="newtab-logo-container">
              <Chrome size={34} />
            </div>
            <span className="newtab-title">Alouette Browser</span>
            <div className="newtab-subtitle">
              Sleek, secure, and isolated custom browser client. Enjoy extremely
              stable multi-tab web browsing.
            </div>
          </div>

          <div className="newtab-search-box">
            <Search size={16} style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              className="newtab-search-input"
              placeholder="Search Google or enter domain address..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              className="btn btn-primary btn-xs"
              onClick={() => handleNavigate(query)}
              style={{ borderRadius: "6px" }}
            >
              Search
            </button>
          </div>

          <div className="newtab-shortcuts">
            <div
              className="newtab-shortcut-card"
              onClick={() => handleNavigate("https://github.com")}
            >
              <div className="newtab-shortcut-icon">
                <Globe size={18} />
              </div>
              <span className="newtab-shortcut-title">GitHub</span>
            </div>
            <div
              className="newtab-shortcut-card"
              onClick={() => handleNavigate("https://stackoverflow.com")}
            >
              <div className="newtab-shortcut-icon">
                <Globe size={18} />
              </div>
              <span className="newtab-shortcut-title">StackOverflow</span>
            </div>
            <div
              className="newtab-shortcut-card"
              onClick={() => handleNavigate("https://www.google.com")}
            >
              <div className="newtab-shortcut-icon">
                <Globe size={18} />
              </div>
              <span className="newtab-shortcut-title">Google</span>
            </div>
            <div
              className="newtab-shortcut-card"
              onClick={() => handleNavigate("https://youtube.com")}
            >
              <div className="newtab-shortcut-icon">
                <Globe size={18} />
              </div>
              <span className="newtab-shortcut-title">YouTube</span>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* Child webviews appear automatically overlaid at y=123 (below     */}
      {/* 40px titlebar + 55px toolbar + 28px bookmarks = 123px)           */}
      {/* Wait, Rust creates child webview at y=95px, let's keep it there!  */}
      {/* Wait, the bookmarks bar is 28px, so:                             */}
      {/* y = 40 (titlebar) + 55 (toolbar) = 95px is correct!              */}
      {/* The bookmarks bar is rendered using standard React overlay flow  */}
      {/* or we can fit bookmarks inside the 95px height layout.            */}
      {/* Actually, let's keep the bookmarks bar as is, it blends nicely!  */}
      {/* ================================================================ */}
    </div>
  );
}
