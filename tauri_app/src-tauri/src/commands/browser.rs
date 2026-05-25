use tauri::{AppHandle, Manager, WebviewUrl};
use tauri::webview::WebviewBuilder;
use tauri::{LogicalPosition, LogicalSize};
use tauri::Window;

/// Open (or focus) the standalone Browser window.
/// The window contains our custom React UI (tabs + custom titlebar + URL bar),
/// and manages child webviews dynamically for each tab.
#[tauri::command]
pub async fn open_browser_window(app_handle: AppHandle) -> Result<(), String> {
    // If already open, just focus it
    if let Some(webview_win) = app_handle.get_webview_window("browser_window") {
        let _ = webview_win.show();
        let _ = webview_win.set_focus();
        return Ok(());
    }

    // Create the browser shell window (our UI: titlebar + url bar)
    let _webview_win = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "browser_window",
        WebviewUrl::App("index.html".into()),
    )
    .title("Alouette - Browser")
    .inner_size(1200.0, 800.0)
    .min_inner_size(800.0, 500.0)
    .resizable(true)
    .decorations(false)
    .build()
    .map_err(|e: tauri::Error| e.to_string())?;

    Ok(())
}

/// Create a new child webview overlay for a specific tab.
/// Always creates with about:blank; use navigate_tab to load the actual URL.
/// This avoids double-loading and race conditions.
#[tauri::command]
pub async fn create_tab_webview(
    app_handle: AppHandle,
    tab_id: String,
    show: bool,
) -> Result<(), String> {
    let window: Window = app_handle
        .get_window("browser_window")
        .ok_or_else(|| "Browser window not found".to_string())?;

    let label = format!("browser_tab_{}", tab_id);

    // If webview already exists, do nothing
    if app_handle.get_webview(&label).is_some() {
        return Ok(());
    }

    // Get current window inner size for dynamic webview sizing
    let (win_width, win_height) = if let Ok(size) = window.inner_size() { let s = window.scale_factor().unwrap_or(1.0); let l = size.to_logical::<f64>(s); (l.width, l.height)
    } else {
        (1200.0, 800.0)
    };

    // Position active tabs below UI area: 40px titlebar + 55px toolbar + 28px bookmarks = 123px
    // Hidden tabs are moved offscreen
    let pos = if show {
        LogicalPosition::new(0.0, 123.0)
    } else {
        LogicalPosition::new(-10000.0, -10000.0)
    };

    let content_height = (win_height - 123.0).max(100.0);
    let content_width = win_width.max(100.0);

    let size = if show {
        LogicalSize::new(content_width, content_height)
    } else {
        LogicalSize::new(0.0, 0.0)
    };

    window
        .add_child(
            // NOTE: auto_resize() deliberately NOT used - it would fill the entire window and hide the React UI
            WebviewBuilder::new(&label, WebviewUrl::External("about:blank".parse().unwrap())),
            pos,
            size,
        )
        .map_err(|e: tauri::Error| e.to_string())?;

    // Set visibility using native hide/show
    if !show {
        if let Some(webview) = app_handle.get_webview(&label) {
            let _ = webview.hide();
        }
    }

    Ok(())
}

/// Navigate a specific tab's webview to a new URL. Reuses the webview instance to preserve history.
#[tauri::command]
pub async fn navigate_tab(app_handle: AppHandle, tab_id: String, url: String) -> Result<(), String> {
    let label = format!("browser_tab_{}", tab_id);
    let webview = app_handle
        .get_webview(&label)
        .ok_or_else(|| format!("Webview for tab {} not found", tab_id))?;

    let parsed_url: url::Url = url
        .parse()
        .map_err(|e: url::ParseError| format!("Invalid URL: {}", e))?;

    webview.navigate(parsed_url).map_err(|e| e.to_string())?;
    Ok(())
}

/// Close and destroy a tab's child webview overlay.
#[tauri::command]
pub async fn close_tab_webview(app_handle: AppHandle, tab_id: String) -> Result<(), String> {
    let label = format!("browser_tab_{}", tab_id);
    if let Some(webview) = app_handle.get_webview(&label) {
        let _ = webview.close();
    }
    Ok(())
}

/// Switch active tab, showing the selected webview and hiding all others.
#[tauri::command]
pub async fn switch_tab_webview(
    app_handle: AppHandle,
    active_tab_id: String,
    inactive_tab_ids: Vec<String>,
) -> Result<(), String> {
    // Calculate dynamic size based on current window dimensions
    let (win_width, win_height) = if let Some(win) = app_handle.get_window("browser_window") {
        if let Ok(size) = win.inner_size() { let s = win.scale_factor().unwrap_or(1.0); let l = size.to_logical::<f64>(s); (l.width, l.height)
        } else {
            (1200.0, 800.0)
        }
    } else {
        (1200.0, 800.0)
    };

    let content_height = (win_height - 123.0).max(100.0);
    let content_width = win_width.max(100.0);

    // 1. Show the active webview, position it below toolbar area, and make it visible
    if let Some(active_wv) = app_handle.get_webview(&format!("browser_tab_{}", active_tab_id)) {
        let _ = active_wv.show();
        let _ = active_wv.set_position(LogicalPosition::new(0.0, 123.0));
        let _ = active_wv.set_size(LogicalSize::new(content_width, content_height));
    }

    // 2. Hide all inactive webviews, move them offscreen, and make them invisible
    for id in inactive_tab_ids {
        if let Some(inactive_wv) = app_handle.get_webview(&format!("browser_tab_{}", id)) {
            let _ = inactive_wv.hide();
            let _ = inactive_wv.set_position(LogicalPosition::new(-10000.0, -10000.0));
            let _ = inactive_wv.set_size(LogicalSize::new(0.0, 0.0));
        }
    }

    Ok(())
}

/// Fetch the current live URL of the webview (used for address bar sync).
#[tauri::command]
pub async fn get_webview_url(app_handle: AppHandle, tab_id: String) -> Result<String, String> {
    let label = format!("browser_tab_{}", tab_id);
    if let Some(webview) = app_handle.get_webview(&label) {
        if let Ok(url) = webview.url() {
            let url_str = url.to_string();
            // Don't show blank placeholder URL to user
            if url_str == "about:blank" {
                return Ok("".to_string());
            }
            return Ok(url_str);
        }
    }
    Ok("".to_string())
}

/// Tell the specific browser content child webview to go back in history.
#[tauri::command]
pub async fn browser_go_back(app_handle: AppHandle, tab_id: String) -> Result<(), String> {
    let label = format!("browser_tab_{}", tab_id);
    if let Some(webview) = app_handle.get_webview(&label) {
        if let Ok(url) = webview.url() {
            if url.as_str() != "about:blank" {
                let _ = webview.eval("window.history.back()");
            }
        }
    }
    Ok(())
}

/// Tell the specific browser content child webview to go forward in history.
#[tauri::command]
pub async fn browser_go_forward(app_handle: AppHandle, tab_id: String) -> Result<(), String> {
    let label = format!("browser_tab_{}", tab_id);
    if let Some(webview) = app_handle.get_webview(&label) {
        let _ = webview.eval("window.history.forward()");
    }
    Ok(())
}

/// Reload the specific browser content child webview.
#[tauri::command]
pub async fn browser_reload(app_handle: AppHandle, tab_id: String) -> Result<(), String> {
    let label = format!("browser_tab_{}", tab_id);
    if let Some(webview) = app_handle.get_webview(&label) {
        let _ = webview.eval("window.location.reload()");
    }
    Ok(())
}
