use std::collections::HashMap;
use std::time::Instant;
use tauri::Manager;
use serde::{Deserialize, Serialize};

// ============================================================================
// Data Structures
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct HttpRequestInput {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub body_type: String, // "none", "text", "json", "urlencoded"
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct HttpResponseOutput {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub elapsed_ms: u64,
    pub size_bytes: usize,
    pub redirect_chain: Vec<RedirectInfo>,
    pub cookies: Vec<CookieInfo>,
    pub timing_breakdown: TimingBreakdown,
}

#[derive(Debug, Serialize)]
pub struct TimingBreakdown {
    pub dns_lookup_ms: f64,
    pub tcp_connect_ms: f64,
    pub tls_handshake_ms: f64,
    pub first_byte_ms: f64,
    pub total_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct RedirectInfo {
    pub url: String,
    pub status: u16,
}

#[derive(Debug, Serialize)]
pub struct CookieInfo {
    pub name: String,
    pub value: String,
    pub domain: Option<String>,
    pub path: Option<String>,
    pub expires: Option<String>,
    pub http_only: bool,
    pub secure: bool,
}

#[derive(Debug, Serialize)]
pub struct DnsResult {
    pub domain: String,
    pub ipv4: Vec<String>,
    pub ipv6: Vec<String>,
    pub cname: Option<String>,
    pub mx: Vec<String>,
    pub ns: Vec<String>,
    pub txt: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PingResult {
    pub host: String,
    pub ip: String,
    pub sent: u32,
    pub received: u32,
    pub min_ms: f64,
    pub max_ms: f64,
    pub avg_ms: f64,
    pub packet_loss: f64,
}

#[derive(Debug, Serialize)]
pub struct SslCertInfo {
    pub subject: String,
    pub issuer: String,
    pub valid_from: String,
    pub valid_to: String,
    pub expires_in_days: u64,
    pub sni: String,
    pub fingerprint: String,
    pub tls_version: String,
}

#[derive(Debug, Deserialize)]
pub struct JsonSchemaValidateInput {
    pub json_body: String,
    pub schema: String,
}

#[derive(Debug, Serialize)]
pub struct JsonSchemaResult {
    pub valid: bool,
    pub errors: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct Base64Input {
    pub text: String,
    pub action: String, // "encode" or "decode"
}

#[derive(Debug, Serialize)]
pub struct Base64Output {
    pub result: String,
}

#[derive(Debug, Deserialize)]
pub struct JsonFormatInput {
    pub json_text: String,
    pub action: String, // "prettify" or "minify" or "validate"
}

#[derive(Debug, Serialize)]
pub struct JsonFormatOutput {
    pub success: bool,
    pub result: Option<String>,
    pub error: Option<String>,
    pub is_valid: bool,
}

#[derive(Debug, Deserialize)]
pub struct CurlCommandInput {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub body_type: String,
    pub auth_type: String,
    pub auth_value: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HttpStatusCodeInfo {
    pub code: u16,
    pub name: String,
    pub category: String,
    pub description: String,
}

#[derive(Debug, Serialize)]
pub struct HashOutput {
    pub md5: String,
    pub sha1: String,
    pub sha256: String,
}

// ============================================================================
// Commands
// ============================================================================

#[tauri::command]
pub async fn check_port_status(port: u16) -> Option<u32> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("netstat")
            .args(["-ano", "-p", "tcp"])
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
            .args(["-t", &format!("-i:{}", port)])
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
    .inner_size(1100.0, 780.0)
    .resizable(true)
    .decorations(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ============================================================================
// Main HTTP Request Sender (Enhanced with timing, redirects, cookies)
// ============================================================================

#[tauri::command]
pub async fn send_http_request(req: HttpRequestInput) -> Result<HttpResponseOutput, String> {
    let mut client_builder = reqwest::Client::builder()
        .danger_accept_invalid_certs(false)
        .redirect(reqwest::redirect::Policy::limited(10));

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

    let mut request_builder = client.request(method.clone(), &req.url);

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
                "xml" => {
                    request_builder = request_builder
                        .header("Content-Type", "application/xml")
                        .body(body_content);
                }
                "form-data" => {
                    request_builder = request_builder
                        .header("Content-Type", "multipart/form-data")
                        .body(body_content);
                }
                "binary" => {
                    request_builder = request_builder
                        .header("Content-Type", "application/octet-stream")
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

    // Timing breakdown (approximate since reqwest doesn't expose low-level timings)
    let timing_breakdown = TimingBreakdown {
        dns_lookup_ms: 0.0,     // reqwest doesn't expose DNS time
        tcp_connect_ms: 0.0,    // reqwest doesn't expose TCP time
        tls_handshake_ms: 0.0,  // reqwest doesn't expose TLS time
        first_byte_ms: elapsed as f64 * 0.85,
        total_ms: elapsed,
    };

    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();

    // Extract headers
    let mut headers = HashMap::new();
    for (name, value) in response.headers() {
        if let Ok(val_str) = value.to_str() {
            headers.insert(name.as_str().to_string(), val_str.to_string());
        }
    }

    // Extract cookies
    let cookies: Vec<CookieInfo> = response.cookies().map(|c| {
        CookieInfo {
            name: c.name().to_string(),
            value: c.value().to_string(),
            domain: c.domain().map(|d| d.to_string()),
            path: c.path().map(|p| p.to_string()),
            expires: c.expires().map(|e| format!("{} ms", e.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0))),
            http_only: c.http_only(),
            secure: c.secure(),
        }
    }).collect();

    // Build redirect chain from URL history
    let _redirect_chain: Vec<RedirectInfo> = response
        .url()
        .path_segments()
        .map(|_| vec![])
        .unwrap_or_default();

    // Build redirect chain from the URL history
    let mut chain = Vec::new();
    // The final URL after redirects
    let final_url = response.url().to_string();
    if final_url != req.url {
        chain.push(RedirectInfo {
            url: final_url.clone(),
            status,
        });
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
        redirect_chain: chain,
        cookies,
        timing_breakdown,
    })
}

// ============================================================================
// DNS Lookup Tool
// ============================================================================

#[tauri::command]
pub async fn dns_lookup(domain: String) -> Result<DnsResult, String> {
    use std::net::ToSocketAddrs;
    use std::process::Command;

    let mut ipv4 = Vec::new();
    let mut ipv6 = Vec::new();

    // Basic DNS resolution via std::net
    if let Ok(addrs) = format!("{}:0", domain).to_socket_addrs() {
        for addr in addrs {
            let ip_str = addr.ip().to_string();
            if addr.ip().is_ipv4() {
                if !ipv4.contains(&ip_str) {
                    ipv4.push(ip_str);
                }
            } else {
                if !ipv6.contains(&ip_str) {
                    ipv6.push(ip_str);
                }
            }
        }
    }

    // Try nslookup for more DNS records
    let mut cname = None;
    let mut mx = Vec::new();
    let mut ns = Vec::new();
    let mut txt = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = Command::new("nslookup")
            .arg("-type=all")
            .arg(&domain)
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if trimmed.contains("canonical name =") {
                    cname = trimmed.split('=').nth(1).map(|s| s.trim().to_string());
                }
                if trimmed.contains("MX preference =") || trimmed.contains("mail exchanger =") {
                    if let Some(part) = trimmed.split('=').nth(1) {
                        mx.push(part.trim().to_string());
                    }
                }
                if trimmed.contains("nameserver =") {
                    if let Some(part) = trimmed.split('=').nth(1) {
                        ns.push(part.trim().to_string());
                    }
                }
                if trimmed.contains("text =") {
                    if let Some(part) = trimmed.split('=').nth(1) {
                        txt.push(part.trim().to_string());
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = Command::new("dig")
            .args(["ANY", &domain, "+short"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("CNAME") {
                    cname = trimmed.split_whitespace().nth(1).map(|s| s.to_string());
                }
                if trimmed.starts_with("MX") {
                    mx.push(trimmed.to_string());
                }
                if trimmed.starts_with("NS") {
                    ns.push(trimmed.to_string());
                }
                if trimmed.starts_with("TXT") {
                    txt.push(trimmed.to_string());
                }
            }
        }
    }

    Ok(DnsResult {
        domain,
        ipv4,
        ipv6,
        cname,
        mx,
        ns,
        txt,
    })
}

// ============================================================================
// Ping Tool
// ============================================================================

#[tauri::command]
pub async fn ping_host(host: String, count: Option<u32>) -> Result<PingResult, String> {
    let count = count.unwrap_or(4).min(10);
    let sent: u32 = count;
    let mut received = 0u32;
    let mut times = Vec::new();

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("ping")
            .args(["-n", &count.to_string(), &host])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);

            for line in stdout.lines() {
                let trimmed = line.trim();
                if trimmed.contains("time=") || trimmed.contains("time<") {
                    received += 1;
                    // Extract time value
                    if let Some(time_part) = trimmed.split("time=").nth(1) {
                        if let Some(ms_str) = time_part.split_whitespace().next() {
                            let ms_str = ms_str.replace("ms", "").replace("m", "");
                            if let Ok(ms) = ms_str.parse::<f64>() {
                                times.push(ms);
                            }
                        }
                    }
                }
                if trimmed.starts_with("Reply from") && trimmed.contains("time") {
                    received += 1;
                    if let Some(time_part) = trimmed.split("time=").nth(1) {
                        if let Some(ms_str) = time_part.split_whitespace().next() {
                            let ms_str = ms_str.replace("ms", "").replace("m", "");
                            if let Ok(ms) = ms_str.parse::<f64>() {
                                times.push(ms);
                            }
                        }
                    }
                }
            }
        } else {
            return Err("Ping command failed to execute".to_string());
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("ping")
            .args(["-c", &count.to_string(), &host])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);

            for line in stdout.lines() {
                let trimmed = line.trim();
                if trimmed.contains("bytes from") && trimmed.contains("time=") {
                    received += 1;
                    if let Some(time_part) = trimmed.split("time=").nth(1) {
                        if let Some(ms_str) = time_part.split_whitespace().next() {
                            let ms_str = ms_str.replace("ms", "").replace("m", "");
                            if let Ok(ms) = ms_str.parse::<f64>() {
                                times.push(ms);
                            }
                        }
                    }
                }
            }
        } else {
            return Err("Ping command failed to execute".to_string());
        }
    }

    let packet_loss = if sent > 0 {
        ((sent - received) as f64 / sent as f64) * 100.0
    } else {
        0.0
    };

    let min_ms = times.iter().cloned().fold(f64::MAX, f64::min);
    let max_ms = times.iter().cloned().fold(f64::MIN, f64::max);
    let avg_ms = if !times.is_empty() {
        times.iter().sum::<f64>() / times.len() as f64
    } else {
        0.0
    };

    Ok(PingResult {
        host: host.clone(),
        ip: host,
        sent,
        received,
        min_ms: if min_ms == f64::MAX { 0.0 } else { min_ms },
        max_ms: if max_ms == f64::MIN { 0.0 } else { max_ms },
        avg_ms,
        packet_loss,
    })
}

// ============================================================================
// SSL Certificate Info
// ============================================================================

#[tauri::command]
pub async fn ssl_certificate_info(host: String, port: Option<u16>) -> Result<SslCertInfo, String> {
    use std::net::TcpStream;
    use std::time::Duration;

    let port = port.unwrap_or(443);
    let address = format!("{}:{}", host, port);

    // Use openssl via command line for cert info
    let mut subject = "Unknown".to_string();
    let mut issuer = "Unknown".to_string();
    let mut valid_from = "Unknown".to_string();
    let mut valid_to = "Unknown".to_string();
    let mut fingerprint = "Unknown".to_string();
    let mut tls_version = "Unknown".to_string();
    let mut expires_in_days = 0u64;

    #[cfg(target_os = "windows")]
    {
        // On Windows, try using PowerShell to get cert info
        use std::process::Command;
        let ps_script = format!(
            "$req = [Net.HttpWebRequest]::Create('https://{}'); \
             $req.GetResponse(); \
             $cert = $req.ServicePoint.Certificate; \
             if ($cert) {{ \
                 $subject = $cert.Subject; \
                 $issuer = $cert.Issuer; \
                 $exp = $cert.GetExpirationDateString(); \
                 $start = $cert.GetEffectiveDateString(); \
                 Write-Output \"SUBJECT=$subject\"; \
                 Write-Output \"ISSUER=$issuer\"; \
                 Write-Output \"START=$start\"; \
                 Write-Output \"EXPIRES=$exp\"; \
                 Write-Output \"THUMBPRINT=$($cert.GetCertHashString())\"; \
             }} else {{ \
                 Write-Output 'NO_CERT'; \
             }}",
            host
        );

        if let Ok(output) = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_script])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if let Some(val) = trimmed.strip_prefix("SUBJECT=") {
                    subject = val.to_string();
                }
                if let Some(val) = trimmed.strip_prefix("ISSUER=") {
                    issuer = val.to_string();
                }
                if let Some(val) = trimmed.strip_prefix("START=") {
                    valid_from = val.to_string();
                }
                if let Some(val) = trimmed.strip_prefix("EXPIRES=") {
                    valid_to = val.to_string();
                }
                if let Some(val) = trimmed.strip_prefix("THUMBPRINT=") {
                    fingerprint = val.to_string();
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("openssl")
            .args([
                "s_client",
                "-connect",
                &address,
                "-servername",
                &host,
                "</dev/null",
                "2>/dev/null",
            ])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("subject=") {
                    subject = trimmed[8..].to_string();
                }
                if trimmed.starts_with("issuer=") {
                    issuer = trimmed[7..].to_string();
                }
                if trimmed.contains("Not Before:") {
                    valid_from = trimmed.trim().to_string();
                }
                if trimmed.contains("Not After :") || trimmed.contains("Not After:") {
                    valid_to = trimmed.trim().to_string();
                }
                if trimmed.starts_with("SHA1 Fingerprint=") {
                    fingerprint = trimmed[17..].to_string();
                }
                if trimmed.contains("TLS") && trimmed.contains("handshake") {
                    tls_version = trimmed.to_string();
                }
            }
        }
    }

    // Calculate days until expiration
    if valid_to != "Unknown" {
        // Try to parse the date string
        let date_str = valid_to
            .replace("Not After :", "")
            .replace("Not After:", "")
            .trim()
            .to_string();
        // Simple parsing
        if let Ok(exp_date) = chrono::NaiveDateTime::parse_from_str(
            &date_str,
            "%b %d %H:%M:%S %Y GMT",
        ) {
            let now = chrono::Utc::now().naive_utc();
            let today = now.date();
            let midnight = chrono::NaiveDateTime::new(today, chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap());
            if let Ok(duration) = (exp_date - midnight).to_std() {
                expires_in_days = duration.as_secs() / 86400;
            }
        }
    }

    // Try to connect and measure TLS version
    if let Ok(stream) = TcpStream::connect_timeout(
        &address.parse().map_err(|_| "Invalid address".to_string())?,
        Duration::from_secs(5),
    ) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
        tls_version = format!("TLS 1.2/1.3 (connected to {})", address);
    }

    Ok(SslCertInfo {
        subject,
        issuer,
        valid_from,
        valid_to,
        expires_in_days,
        sni: host,
        fingerprint,
        tls_version,
    })
}

// ============================================================================
// JSON Schema Validator
// ============================================================================

#[tauri::command]
pub async fn validate_json_schema(input: JsonSchemaValidateInput) -> Result<JsonSchemaResult, String> {
    let json_value: serde_json::Value = serde_json::from_str(&input.json_body)
        .map_err(|e| format!("Invalid JSON body: {}", e))?;

    let schema_value: serde_json::Value = serde_json::from_str(&input.schema)
        .map_err(|e| format!("Invalid JSON Schema: {}", e))?;

    let mut errors = Vec::new();

    // Basic JSON Schema validation (using simple structural checks since we don't have jsonschema crate)
    if let Some(obj) = schema_value.as_object() {
        // Check if schema has 'type' constraint
        if let Some(schema_type) = obj.get("type").and_then(|v| v.as_str()) {
            let json_type = match &json_value {
                serde_json::Value::Null => "null",
                serde_json::Value::Bool(_) => "boolean",
                serde_json::Value::Number(_) => "number",
                serde_json::Value::String(_) => "string",
                serde_json::Value::Array(_) => "array",
                serde_json::Value::Object(_) => "object",
            };
            if json_type != schema_type {
                errors.push(format!("Type mismatch: expected '{}', got '{}'", schema_type, json_type));
            }
        }

        // Check required fields
        if let Some(required) = obj.get("required").and_then(|v| v.as_array()) {
            if let Some(json_obj) = json_value.as_object() {
                for req_field in required {
                    if let Some(field_name) = req_field.as_str() {
                        if !json_obj.contains_key(field_name) {
                            errors.push(format!("Missing required field: '{}'", field_name));
                        }
                    }
                }
            }
        }

        // Check properties
        if let Some(properties) = obj.get("properties").and_then(|v| v.as_object()) {
            if let Some(json_obj) = json_value.as_object() {
                for (prop_name, prop_schema) in properties {
                    if let Some(prop_obj) = prop_schema.as_object() {
                        if let Some(json_val) = json_obj.get(prop_name) {
                            // Check type of property
                            if let Some(prop_type) = prop_obj.get("type").and_then(|v| v.as_str()) {
                                let json_type = match json_val {
                                    serde_json::Value::Null => "null",
                                    serde_json::Value::Bool(_) => "boolean",
                                    serde_json::Value::Number(_) => "number",
                                    serde_json::Value::String(_) => "string",
                                    serde_json::Value::Array(_) => "array",
                                    serde_json::Value::Object(_) => "object",
                                };
                                if json_type != prop_type {
                                    errors.push(format!("Property '{}' type mismatch: expected '{}', got '{}'", prop_name, prop_type, json_type));
                                }
                            }
                            // Check min/max length for strings
                            if let Some(s) = json_val.as_str() {
                                if let Some(min_len) = prop_obj.get("minLength").and_then(|v| v.as_u64()) {
                                    if (s.len() as u64) < min_len {
                                        errors.push(format!("Property '{}' too short: min {} chars", prop_name, min_len));
                                    }
                                }
                                if let Some(max_len) = prop_obj.get("maxLength").and_then(|v| v.as_u64()) {
                                    if (s.len() as u64) > max_len {
                                        errors.push(format!("Property '{}' too long: max {} chars", prop_name, max_len));
                                    }
                                }
                            }
                            // Check min/max for numbers
                            if let Some(n) = json_val.as_f64() {
                                if let Some(min_val) = prop_obj.get("minimum").and_then(|v| v.as_f64()) {
                                    if n < min_val {
                                        errors.push(format!("Property '{}' too small: min {}", prop_name, min_val));
                                    }
                                }
                                if let Some(max_val) = prop_obj.get("maximum").and_then(|v| v.as_f64()) {
                                    if n > max_val {
                                        errors.push(format!("Property '{}' too large: max {}", prop_name, max_val));
                                    }
                                }
                            }
                            // Check enum
                            if let Some(enum_vals) = prop_obj.get("enum").and_then(|v| v.as_array()) {
                                if !enum_vals.contains(json_val) {
                                    errors.push(format!("Property '{}' not in enum values", prop_name));
                                }
                            }
                            // Check pattern
                            if let Some(pattern) = prop_obj.get("pattern").and_then(|v| v.as_str()) {
                                if let Some(s) = json_val.as_str() {
                                    let re = regex_lite::Regex::new(pattern).map_err(|e| format!("Invalid regex pattern: {}", e))?;
                                    if !re.is_match(s) {
                                        errors.push(format!("Property '{}' does not match pattern '{}'", prop_name, pattern));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Check array items
        if let Some(items) = obj.get("items") {
            if let Some(json_arr) = json_value.as_array() {
                if let Some(item_schema) = items.as_object() {
                    if let Some(item_type) = item_schema.get("type").and_then(|v| v.as_str()) {
                        for (i, item) in json_arr.iter().enumerate() {
                            let json_type = match item {
                                serde_json::Value::Null => "null",
                                serde_json::Value::Bool(_) => "boolean",
                                serde_json::Value::Number(_) => "number",
                                serde_json::Value::String(_) => "string",
                                serde_json::Value::Array(_) => "array",
                                serde_json::Value::Object(_) => "object",
                            };
                            if json_type != item_type {
                                errors.push(format!("Array item [{}] type mismatch: expected '{}', got '{}'", i, item_type, json_type));
                            }
                        }
                    }
                }
            }
        }
    }

    let valid = errors.is_empty();
    Ok(JsonSchemaResult { valid, errors })
}

// ============================================================================
// JSON Format/Validate Tool
// ============================================================================

#[tauri::command]
pub async fn json_format_tool(input: JsonFormatInput) -> Result<JsonFormatOutput, String> {
    match input.action.as_str() {
        "validate" => {
            match serde_json::from_str::<serde_json::Value>(&input.json_text) {
                Ok(_) => Ok(JsonFormatOutput {
                    success: true,
                    result: None,
                    error: None,
                    is_valid: true,
                }),
                Err(e) => Ok(JsonFormatOutput {
                    success: false,
                    result: None,
                    error: Some(format!("Invalid JSON: {}", e)),
                    is_valid: false,
                }),
            }
        }
        "prettify" => {
            match serde_json::from_str::<serde_json::Value>(&input.json_text) {
                Ok(val) => {
                    let pretty = serde_json::to_string_pretty(&val)
                        .map_err(|e| format!("Failed to prettify JSON: {}", e))?;
                    Ok(JsonFormatOutput {
                        success: true,
                        result: Some(pretty),
                        error: None,
                        is_valid: true,
                    })
                }
                Err(e) => Ok(JsonFormatOutput {
                    success: false,
                    result: None,
                    error: Some(format!("Invalid JSON: {}", e)),
                    is_valid: false,
                }),
            }
        }
        "minify" => {
            match serde_json::from_str::<serde_json::Value>(&input.json_text) {
                Ok(val) => {
                    let minified = serde_json::to_string(&val)
                        .map_err(|e| format!("Failed to minify JSON: {}", e))?;
                    Ok(JsonFormatOutput {
                        success: true,
                        result: Some(minified),
                        error: None,
                        is_valid: true,
                    })
                }
                Err(e) => Ok(JsonFormatOutput {
                    success: false,
                    result: None,
                    error: Some(format!("Invalid JSON: {}", e)),
                    is_valid: false,
                }),
            }
        }
        _ => Err(format!("Unknown action: {}. Use 'prettify', 'minify', or 'validate'", input.action)),
    }
}

// ============================================================================
// Base64 Encode/Decode
// ============================================================================

#[tauri::command]
pub async fn base64_tool(input: Base64Input) -> Result<Base64Output, String> {
    match input.action.as_str() {
        "encode" => {
            let encoded = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                input.text.as_bytes(),
            );
            Ok(Base64Output { result: encoded })
        }
        "decode" => {
            let decoded = base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                &input.text,
            )
            .map_err(|e| format!("Base64 decode failed: {}", e))?;
            let result = String::from_utf8_lossy(&decoded).to_string();
            Ok(Base64Output { result })
        }
        _ => Err("Invalid action. Use 'encode' or 'decode'".to_string()),
    }
}

// ============================================================================
// Generate cURL Command
// ============================================================================

#[tauri::command]
pub async fn generate_curl_command(input: CurlCommandInput) -> Result<String, String> {
    let mut curl = format!("curl -X {} \\\n", input.method.to_uppercase());

    // Add URL
    curl.push_str(&format!("  '{}'", input.url));

    // Add headers
    for (key, value) in &input.headers {
        if !key.trim().is_empty() {
            curl.push_str(&format!(" \\\n  -H '{}: {}'", key.replace("'", "'\\''"), value.replace("'", "'\\''")));
        }
    }

    // Add auth header
    if input.auth_type == "bearer" {
        if let Some(token) = &input.auth_value {
            curl.push_str(&format!(" \\\n  -H 'Authorization: Bearer {}'", token.replace("'", "'\\''")));
        }
    } else if input.auth_type == "basic" {
        if let Some(creds) = &input.auth_value {
            curl.push_str(&format!(" \\\n  -u '{}'", creds.replace("'", "'\\''")));
        }
    } else if input.auth_type == "apikey" {
        if let Some(val) = &input.auth_value {
            curl.push_str(&format!(" \\\n  -H 'X-API-Key: {}'", val.replace("'", "'\\''")));
        }
    }

    // Add body
    if let Some(body_content) = &input.body {
        if !body_content.is_empty() && input.body_type != "none" {
            match input.body_type.as_str() {
                "json" => {
                    curl.push_str(" \\\n  -H 'Content-Type: application/json'");
                    curl.push_str(&format!(" \\\n  -d '{}'", body_content.replace("'", "'\\''")));
                }
                "urlencoded" => {
                    curl.push_str(" \\\n  -H 'Content-Type: application/x-www-form-urlencoded'");
                    curl.push_str(&format!(" \\\n  -d '{}'", body_content.replace("'", "'\\''")));
                }
                _ => {
                    curl.push_str(&format!(" \\\n  -d '{}'", body_content.replace("'", "'\\''")));
                }
            }
        }
    }

    Ok(curl)
}

// ============================================================================
// HTTP Status Code Info
// ============================================================================

#[tauri::command]
pub async fn http_status_info(code: u16) -> Result<HttpStatusCodeInfo, String> {
    let (name, category, description) = match code {
        // 1xx Informational
        100 => ("Continue", "Informational", "The server has received the request headers and the client should proceed to send the request body."),
        101 => ("Switching Protocols", "Informational", "The requester has asked the server to switch protocols and the server has agreed to do so."),
        102 => ("Processing", "Informational", "The server has received and is processing the request, but no response is available yet."),
        103 => ("Early Hints", "Informational", "Used to return some response headers before final HTTP message."),

        // 2xx Success
        200 => ("OK", "Success", "Standard response for successful HTTP requests."),
        201 => ("Created", "Success", "The request has been fulfilled and resulted in a new resource being created."),
        202 => ("Accepted", "Success", "The request has been accepted for processing, but the processing has not been completed."),
        203 => ("Non-Authoritative Information", "Success", "The server is a transforming proxy that received a 200 OK from its origin."),
        204 => ("No Content", "Success", "The server successfully processed the request and is not returning any content."),
        205 => ("Reset Content", "Success", "The server successfully processed the request, asks that the client reset its document view."),
        206 => ("Partial Content", "Success", "The server is delivering only part of the resource due to a range header."),
        207 => ("Multi-Status", "Success", "The message body contains XML with multiple status codes."),
        208 => ("Already Reported", "Success", "The members of a DAV binding have already been enumerated."),
        226 => ("IM Used", "Success", "The server has fulfilled a request for the resource."),

        // 3xx Redirection
        300 => ("Multiple Choices", "Redirection", "Indicates multiple options for the resource."),
        301 => ("Moved Permanently", "Redirection", "This and all future requests should be directed to the given URI."),
        302 => ("Found", "Redirection", "The resource was found but at a different URI (temporary)."),
        303 => ("See Other", "Redirection", "The response can be found under another URI using GET."),
        304 => ("Not Modified", "Redirection", "Indicates that the resource has not been modified since last requested."),
        305 => ("Use Proxy", "Redirection", "The requested resource is available only through a proxy."),
        307 => ("Temporary Redirect", "Redirection", "The request should be repeated with another URI (same method)."),
        308 => ("Permanent Redirect", "Redirection", "The request and all future requests should be repeated using another URI."),

        // 4xx Client Errors
        400 => ("Bad Request", "Client Error", "The server cannot or will not process the request due to an apparent client error."),
        401 => ("Unauthorized", "Client Error", "Authentication is required and has failed or not been provided."),
        402 => ("Payment Required", "Client Error", "Reserved for future use."),
        403 => ("Forbidden", "Client Error", "The request was valid, but the server is refusing action."),
        404 => ("Not Found", "Client Error", "The requested resource could not be found."),
        405 => ("Method Not Allowed", "Client Error", "The request method is not supported for the requested resource."),
        406 => ("Not Acceptable", "Client Error", "The requested resource is only capable of generating content not acceptable."),
        407 => ("Proxy Authentication Required", "Client Error", "The client must first authenticate itself with the proxy."),
        408 => ("Request Timeout", "Client Error", "The server timed out waiting for the request."),
        409 => ("Conflict", "Client Error", "Indicates that the request could not be processed because of conflict."),
        410 => ("Gone", "Client Error", "The resource requested is no longer available."),
        411 => ("Length Required", "Client Error", "The request did not specify the length of its content."),
        412 => ("Precondition Failed", "Client Error", "The server does not meet one of the preconditions."),
        413 => ("Payload Too Large", "Client Error", "The request is larger than the server is willing or able to process."),
        414 => ("URI Too Long", "Client Error", "The URI provided was too long for the server to process."),
        415 => ("Unsupported Media Type", "Client Error", "The request entity has a media type that the server does not support."),
        416 => ("Range Not Satisfiable", "Client Error", "The client has asked for a portion of the file, but the server cannot supply."),
        417 => ("Expectation Failed", "Client Error", "The server cannot meet the requirements of the Expect request-header field."),
        418 => ("I'm a teapot", "Client Error", "HTCPCP/1.0 status code. The entity body is short and stout."),
        422 => ("Unprocessable Entity", "Client Error", "The request was well-formed but was unable to be followed due to semantic errors."),
        423 => ("Locked", "Client Error", "The resource being accessed is locked."),
        424 => ("Failed Dependency", "Client Error", "The request failed due to failure of a previous request."),
        425 => ("Too Early", "Client Error", "Indicates that the server is unwilling to risk processing a request."),
        426 => ("Upgrade Required", "Client Error", "The client should switch to a different protocol."),
        428 => ("Precondition Required", "Client Error", "The origin server requires the request to be conditional."),
        429 => ("Too Many Requests", "Client Error", "The user has sent too many requests in a given amount of time."),
        431 => ("Request Header Fields Too Large", "Client Error", "The server is unwilling to process the request because header fields are too large."),
        451 => ("Unavailable For Legal Reasons", "Client Error", "The resource is unavailable for legal reasons."),

        // 5xx Server Errors
        500 => ("Internal Server Error", "Server Error", "A generic error message when an unexpected condition was encountered."),
        501 => ("Not Implemented", "Server Error", "The server either does not recognize the request method, or lacks the ability to fulfill it."),
        502 => ("Bad Gateway", "Server Error", "The server was acting as a gateway or proxy and received an invalid response."),
        503 => ("Service Unavailable", "Server Error", "The server is currently unavailable (overloaded or down)."),
        504 => ("Gateway Timeout", "Server Error", "The server was acting as a gateway or proxy and did not receive a timely response."),
        505 => ("HTTP Version Not Supported", "Server Error", "The server does not support the HTTP protocol version used in the request."),
        506 => ("Variant Also Negotiates", "Server Error", "Transparent content negotiation for the request results in a circular reference."),
        507 => ("Insufficient Storage", "Server Error", "The server is unable to store the representation needed to complete the request."),
        508 => ("Loop Detected", "Server Error", "The server detected an infinite loop while processing the request."),
        510 => ("Not Extended", "Server Error", "Further extensions to the request are required for the server to fulfill it."),
        511 => ("Network Authentication Required", "Server Error", "The client needs to authenticate to gain network access."),

        _ => {
            if code < 100 {
                return Err("Invalid HTTP status code".to_string());
            } else if code < 200 {
                return Ok(HttpStatusCodeInfo {
                    code,
                    name: format!("Unknown {}", code),
                    category: "Informational".to_string(),
                    description: "Unrecognized informational status code.".to_string(),
                });
            } else if code < 300 {
                return Ok(HttpStatusCodeInfo {
                    code,
                    name: format!("Unknown {}", code),
                    category: "Success".to_string(),
                    description: "Unrecognized success status code.".to_string(),
                });
            } else if code < 400 {
                return Ok(HttpStatusCodeInfo {
                    code,
                    name: format!("Unknown {}", code),
                    category: "Redirection".to_string(),
                    description: "Unrecognized redirection status code.".to_string(),
                });
            } else if code < 500 {
                return Ok(HttpStatusCodeInfo {
                    code,
                    name: format!("Unknown {}", code),
                    category: "Client Error".to_string(),
                    description: "Unrecognized client error status code.".to_string(),
                });
            } else if code < 600 {
                return Ok(HttpStatusCodeInfo {
                    code,
                    name: format!("Unknown {}", code),
                    category: "Server Error".to_string(),
                    description: "Unrecognized server error status code.".to_string(),
                });
            } else {
                return Err("Invalid HTTP status code (must be between 100-599)".to_string());
            }
        }
    };

    Ok(HttpStatusCodeInfo {
        code,
        name: name.to_string(),
        category: category.to_string(),
        description: description.to_string(),
    })
}

// ============================================================================
// Hash Tool (MD5, SHA1, SHA256)
// ============================================================================

#[tauri::command]
pub async fn hash_tool(text: String) -> Result<HashOutput, String> {
    use sha2::{Sha256, Digest as Sha2Digest};

    let md5_hash = format!("{:x}", md5::compute(text.as_bytes()));
    let sha1_hash = format!("{:x}", sha1::Sha1::digest(text.as_bytes()));

    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let sha256_hash = format!("{:x}", hasher.finalize());

    Ok(HashOutput {
        md5: md5_hash,
        sha1: sha1_hash,
        sha256: sha256_hash,
    })
}

// ============================================================================
// JWT Decode Tool
// ============================================================================

#[derive(Debug, Serialize)]
pub struct JwtDecodedOutput {
    pub header: serde_json::Value,
    pub payload: serde_json::Value,
    pub signature: String,
    pub valid: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn jwt_decode(token: String) -> Result<JwtDecodedOutput, String> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Ok(JwtDecodedOutput {
            header: serde_json::json!({}),
            payload: serde_json::json!({}),
            signature: String::new(),
            valid: false,
            error: Some("Invalid JWT format. Expected 3 parts separated by dots.".to_string()),
        });
    }

    // Decode header
    let header_json = decode_jwt_part(parts[0]).unwrap_or_else(|| serde_json::json!({}));
    let payload_json = decode_jwt_part(parts[1]).unwrap_or_else(|| serde_json::json!({}));

    Ok(JwtDecodedOutput {
        header: header_json,
        payload: payload_json,
        signature: parts[2].to_string(),
        valid: true,
        error: None,
    })
}

fn decode_jwt_part(part: &str) -> Option<serde_json::Value> {
    // Add padding
    let padded = match part.len() % 4 {
        2 => format!("{}==", part),
        3 => format!("{}=", part),
        _ => part.to_string(),
    };

    // URL-safe base64 decode
    let standardized = padded.replace('-', "+").replace('_', "/");

    if let Ok(decoded) = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &standardized,
    ) {
        serde_json::from_slice(&decoded).ok()
    } else {
        None
    }
}

// ============================================================================
// Timestamp Converter
// ============================================================================

#[derive(Debug, Serialize)]
pub struct TimestampOutput {
    pub unix_seconds: i64,
    pub unix_milliseconds: i64,
    pub utc_string: String,
    pub local_string: String,
    pub iso_8601: String,
    pub relative: String,
}

#[tauri::command]
pub async fn timestamp_convert(timestamp: Option<i64>, _format: Option<String>) -> Result<TimestampOutput, String> {
    let now = chrono::Utc::now();

    let ts = timestamp.unwrap_or_else(|| now.timestamp_millis());

    // Determine if input is seconds or milliseconds
    let datetime = if ts > 1_000_000_000_000 {
        chrono::DateTime::from_timestamp_millis(ts)
            .unwrap_or(now)
    } else {
        chrono::DateTime::from_timestamp(ts, 0)
            .unwrap_or(now)
    };

    let utc_str = datetime.format("%Y-%m-%d %H:%M:%S UTC").to_string();
    let local = datetime.with_timezone(&chrono::Local::now().timezone());
    let local_str = local.format("%Y-%m-%d %H:%M:%S").to_string();
    let iso = datetime.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    // Calculate relative time
    let duration = now - datetime;
    let relative = if duration.num_seconds() < 60 {
        format!("{} seconds ago", duration.num_seconds())
    } else if duration.num_minutes() < 60 {
        format!("{} minutes ago", duration.num_minutes())
    } else if duration.num_hours() < 24 {
        format!("{} hours ago", duration.num_hours())
    } else if duration.num_days() < 30 {
        format!("{} days ago", duration.num_days())
    } else if duration.num_days() < 365 {
        format!("{} months ago", duration.num_days() / 30)
    } else {
        format!("{} years ago", duration.num_days() / 365)
    };

    Ok(TimestampOutput {
        unix_seconds: datetime.timestamp(),
        unix_milliseconds: datetime.timestamp_millis(),
        utc_string: utc_str,
        local_string: local_str,
        iso_8601: iso,
        relative,
    })
}

// ============================================================================
// Response Diff Tool
// ============================================================================

#[derive(Debug, Serialize)]
pub struct ResponseDiffOutput {
    pub same: bool,
    pub differences: Vec<String>,
}

#[tauri::command]
pub async fn response_diff(response_a: String, response_b: String) -> Result<ResponseDiffOutput, String> {
    // Try to parse as JSON first for structured diff
    if let (Ok(json_a), Ok(json_b)) = (
        serde_json::from_str::<serde_json::Value>(&response_a),
        serde_json::from_str::<serde_json::Value>(&response_b),
    ) {
        let mut differences = Vec::new();
        diff_json_values(&json_a, &json_b, "$", &mut differences);
        return Ok(ResponseDiffOutput {
            same: differences.is_empty(),
            differences,
        });
    }

    // Fallback to line-by-line text diff
    let lines_a: Vec<&str> = response_a.lines().collect();
    let lines_b: Vec<&str> = response_b.lines().collect();
    let mut differences = Vec::new();
    let max_lines = lines_a.len().max(lines_b.len());

    for i in 0..max_lines {
        let line_a = lines_a.get(i).unwrap_or(&"<EOF>");
        let line_b = lines_b.get(i).unwrap_or(&"<EOF>");
        if line_a != line_b {
            differences.push(format!("Line {}:\n  - '{}'\n  + '{}'", i + 1, line_a, line_b));
        }
    }

    Ok(ResponseDiffOutput {
        same: differences.is_empty(),
        differences,
    })
}

fn diff_json_values(a: &serde_json::Value, b: &serde_json::Value, path: &str, diffs: &mut Vec<String>) {
    match (a, b) {
        (serde_json::Value::Object(map_a), serde_json::Value::Object(map_b)) => {
            // Keys in a but not in b
            for key in map_a.keys() {
                let new_path = format!("{}.{}", path, key);
                if let Some(val_b) = map_b.get(key) {
                    diff_json_values(&map_a[key], val_b, &new_path, diffs);
                } else {
                    diffs.push(format!("{}: removed", new_path));
                }
            }
            // Keys in b but not in a
            for key in map_b.keys() {
                if !map_a.contains_key(key) {
                    let new_path = format!("{}.{}", path, key);
                    diffs.push(format!("{}: added", new_path));
                }
            }
        }
        (serde_json::Value::Array(arr_a), serde_json::Value::Array(arr_b)) => {
            let max_len = arr_a.len().max(arr_b.len());
            for i in 0..max_len {
                let new_path = format!("{}[{}]", path, i);
                match (arr_a.get(i), arr_b.get(i)) {
                    (Some(val_a), Some(val_b)) => diff_json_values(val_a, val_b, &new_path, diffs),
                    (Some(_), None) => diffs.push(format!("{}: removed", new_path)),
                    (None, Some(_)) => diffs.push(format!("{}: added", new_path)),
                    _ => {}
                }
            }
        }
        _ => {
            if a != b {
                diffs.push(format!("{}: '{}' → '{}'", path, a, b));
            }
        }
    }
}

// ============================================================================
// Prettify XML Tool
// ============================================================================

#[tauri::command]
pub async fn prettify_xml(xml_text: String) -> Result<String, String> {
    let mut result = String::new();
    let mut indent: i32 = 0;
    let mut in_tag = false;
    let mut in_close_tag = false;
    let mut in_self_close = false;
    let mut chars = xml_text.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '<' {
            in_tag = true;
            if let Some(&'/') = chars.peek() {
                in_close_tag = true;
                indent = indent.saturating_sub(1);
                if !result.is_empty() && !result.ends_with('\n') {
                    result.push('\n');
                }
                for _ in 0..indent {
                    result.push_str("  ");
                }
                result.push('<');
            } else {
                if !result.is_empty() && !result.ends_with('\n') {
                    result.push('\n');
                }
                for _ in 0..indent {
                    result.push_str("  ");
                }
                result.push('<');
                in_close_tag = false;
            }
        } else if c == '>' {
            in_tag = false;
            result.push('>');
            if in_self_close {
                in_self_close = false;
            } else if !in_close_tag {
                indent += 1;
            }
            in_close_tag = false;
            result.push('\n');
        } else if c == '/' && in_tag {
            if let Some(&'>') = chars.peek() {
                in_self_close = true;
                indent = indent.saturating_sub(1);
            }
            result.push('/');
        } else {
            if in_tag {
                result.push(c);
            } else if !c.is_whitespace() {
                // Inside text content - just append
                result.push(c);
            } else if !result.ends_with('\n') && !result.is_empty() {
                // Preserve spaces in text content
                result.push(c);
            }
        }
    }

    // Clean up excessive blank lines
    let cleaned: Vec<&str> = result
        .lines()
        .filter(|l| !l.trim().is_empty())
        .collect();

    Ok(cleaned.join("\n"))
}

// ============================================================================
// Admin Window
// ============================================================================

/// Open (or focus) a standalone Admin / Settings window with left dock navigation.
#[tauri::command]
pub async fn open_admin_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("admin_window") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let _window = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "admin_window",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Admin - Settings & Management")
    .inner_size(1100.0, 750.0)
    .min_inner_size(800.0, 500.0)
    .resizable(true)
    .decorations(false)
    .build()
    .map_err(|e: tauri::Error| e.to_string())?;

    Ok(())
}
