use std::collections::HashMap;
use std::time::Instant;
use tauri::Manager;

#[derive(Debug, serde::Deserialize)]
pub struct HttpRequestInput {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub body_type: String, // "none", "text", "json", "urlencoded"
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, serde::Serialize)]
pub struct HttpResponseOutput {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub elapsed_ms: u64,
    pub size_bytes: usize,
}

#[tauri::command]
pub async fn check_port_status(port: u16) -> Option<u32> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("netstat")
            .args(&["-ano", "-p", "tcp"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let port_suffix_colon = format!(":{}", port);

            for line in stdout.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 5 {
                    let local_addr = parts[1];
                    let state = parts[3];
                    let pid_str = parts[4];

                    if (local_addr.ends_with(&port_suffix_colon) || local_addr.ends_with(&format!("]{}", port_suffix_colon)))
                        && state == "LISTENING"
                    {
                        if let Ok(pid) = pid_str.parse::<u32>() {
                            if pid > 0 {
                                return Some(pid);
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("lsof")
            .args(&["-t", &format!("-i:{}", port)])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(first_line) = stdout.lines().next() {
                if let Ok(pid) = first_line.trim().parse::<u32>() {
                    return Some(pid);
                }
            }
        }
    }

    None
}

#[tauri::command]
pub async fn force_kill_process(pid: u32) -> Result<(), String> {
    core_engine::terminate_process_tree(pid).await;
    Ok(())
}

#[tauri::command]
pub async fn open_ping_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("ping_window") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let _window = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "ping_window",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Mini Postman - Connection Diagnostics")
    .inner_size(950.0, 720.0)
    .resizable(true)
    .decorations(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn send_http_request(req: HttpRequestInput) -> Result<HttpResponseOutput, String> {
    let mut client_builder = reqwest::Client::builder();
    
    if let Some(timeout) = req.timeout_ms {
        client_builder = client_builder.timeout(std::time::Duration::from_millis(timeout));
    } else {
        client_builder = client_builder.timeout(std::time::Duration::from_secs(30));
    }

    let client = client_builder.build().map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let method = match req.method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "OPTIONS" => reqwest::Method::OPTIONS,
        "HEAD" => reqwest::Method::HEAD,
        _ => return Err(format!("Unsupported HTTP method: {}", req.method)),
    };

    let mut request_builder = client.request(method, &req.url);

    for (k, v) in req.headers {
        if !k.trim().is_empty() {
            request_builder = request_builder.header(k.trim(), v);
        }
    }

    if let Some(body_content) = req.body {
        if !body_content.is_empty() && req.body_type != "none" {
            match req.body_type.as_str() {
                "json" => {
                    request_builder = request_builder
                        .header("Content-Type", "application/json")
                        .body(body_content);
                }
                "urlencoded" => {
                    request_builder = request_builder
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .body(body_content);
                }
                _ => {
                    request_builder = request_builder.body(body_content);
                }
            }
        }
    }

    let start = Instant::now();
    let response = request_builder.send().await.map_err(|e| format!("Request failed: {}", e))?;
    let elapsed = start.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();

    let mut headers = HashMap::new();
    for (name, value) in response.headers() {
        if let Ok(val_str) = value.to_str() {
            headers.insert(name.as_str().to_string(), val_str.to_string());
        }
    }

    let body_bytes = response.bytes().await.map_err(|e| format!("Failed to read response body: {}", e))?;
    let size_bytes = body_bytes.len();
    let body = String::from_utf8_lossy(&body_bytes).to_string();

    Ok(HttpResponseOutput {
        status,
        status_text,
        headers,
        body,
        elapsed_ms: elapsed,
        size_bytes,
    })
}
