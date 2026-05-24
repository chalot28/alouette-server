// Prevents additional console window on Windows in release (Trigger recompile: 2026-05-24 11:02)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use core_engine::{ProcessManager, ProcessState, ProjectConfig, ResourceMonitor};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex;
use std::fs;
use std::path::Path;
use base64::{Engine as _, engine::general_purpose};

fn log_to_app_file(msg: &str) {
    let log_dir = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_file = log_dir.join("app.log");
    
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file)
    {
        use std::io::Write;
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let _ = writeln!(file, "[{}] {}", timestamp, msg);
    }
}

struct AppState {
    process_manager: Arc<Mutex<ProcessManager>>,
    resource_monitor: Arc<ResourceMonitor>,
}

#[tauri::command]
async fn start_project_process(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<(), String> {
    log_to_app_file(&format!("Tauri command received: start_project_process for project_id: {}", project_id));
    let mut pm = state.process_manager.lock().await;
    match pm.start_process(&project_id).await {
        Ok(_) => {
            log_to_app_file(&format!("Process successfully started for project_id: {}", project_id));
            Ok(())
        }
        Err(e) => {
            log_to_app_file(&format!("Failed to start process for project_id: {}. Error: {}", project_id, e));
            Err(e)
        }
    }
}

#[tauri::command]
async fn stop_project_process(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<(), String> {
    log_to_app_file(&format!("Tauri command received: stop_project_process for project_id: {}", project_id));
    let mut pm = state.process_manager.lock().await;
    match pm.stop_process(&project_id).await {
        Ok(_) => {
            log_to_app_file(&format!("Process successfully stopped for project_id: {}", project_id));
            Ok(())
        }
        Err(e) => {
            log_to_app_file(&format!("Failed to stop process for project_id: {}. Error: {}", project_id, e));
            Err(e)
        }
    }
}

#[tauri::command]
async fn get_projects(state: State<'_, AppState>) -> Result<Vec<ProjectConfig>, String> {
    let pm = state.process_manager.lock().await;
    Ok(pm.get_configs())
}

#[tauri::command]
async fn get_project_logs(
    state: State<'_, AppState>,
    project_id: String,
    limit: Option<usize>,
) -> Result<Vec<core_engine::ProcessLog>, String> {
    let pm = state.process_manager.lock().await;
    let limit_val = limit.unwrap_or(1000);
    let db = pm.db_manager.clone();
    
    let logs = tokio::task::spawn_blocking(move || {
        db.get_logs(&project_id, limit_val)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;
    
    Ok(logs)
}


#[tauri::command]
async fn get_project_state(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Option<ProcessState>, String> {
    let pm = state.process_manager.lock().await;
    Ok(pm.get_state(&project_id))
}

#[tauri::command]
async fn register_project(
    state: State<'_, AppState>,
    config: ProjectConfig,
) -> Result<(), String> {
    let mut pm = state.process_manager.lock().await;
    pm.register_project(config).await?;
    Ok(())
}

#[tauri::command]
async fn spawn_terminal_session(
    state: State<'_, AppState>,
    session_id: String,
    cwd: Option<String>,
) -> Result<(), String> {
    let mut pm = state.process_manager.lock().await;
    pm.spawn_terminal(&session_id, cwd.as_deref()).await?;
    Ok(())
}

#[tauri::command]
async fn write_to_terminal_session(
    state: State<'_, AppState>,
    session_id: String,
    input: String,
) -> Result<(), String> {
    let pm = state.process_manager.lock().await;
    pm.write_terminal(&session_id, input).await?;
    Ok(())
}

#[tauri::command]
async fn kill_terminal_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let mut pm = state.process_manager.lock().await;
    pm.kill_terminal(&session_id).await?;
    Ok(())
}

#[tauri::command]
async fn deregister_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<(), String> {
    let mut pm = state.process_manager.lock().await;
    pm.deregister_project(&project_id).await?;
    Ok(())
}

#[tauri::command]
async fn check_port_status(port: u16) -> Option<u32> {
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
async fn force_kill_process(pid: u32) -> Result<(), String> {
    core_engine::terminate_process_tree(pid).await;
    Ok(())
}

#[derive(serde::Serialize, Clone)]
struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileNode>>,
}

#[tauri::command]
fn get_project_files(dir_path: Option<String>) -> Result<Vec<FileNode>, String> {
    let path_str = dir_path.unwrap_or_else(|| {
        std::env::current_dir()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    });
    
    let path = Path::new(&path_str);
    if !path.exists() {
        return Err("Directory does not exist".to_string());
    }
    
    read_dir_recursive(path, 0)
}

#[tauri::command]
async fn read_file_content(path: String) -> Result<String, String> {
    log_to_app_file(&format!("Reading file: {}", path));
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    
    // Tăng giới hạn lên 10MB vì Base64 xử lý rất tốt dữ liệu lớn
    if bytes.len() > 10 * 1024 * 1024 {
        return Err("File quá lớn để mở trong trình soạn thảo. Vui lòng sử dụng terminal.".to_string());
    }

    // Chuyển sang Base64 để truyền tải qua IPC cực nhanh và an toàn
    Ok(general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
async fn write_file_content(path: String, content: String) -> Result<(), String> {
    log_to_app_file(&format!("Writing file: {}", path));
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct SqliteColumn {
    name: String,
    data_type: String,
    is_pk: bool,
}

#[derive(serde::Serialize)]
struct SqliteTableData {
    columns: Vec<SqliteColumn>,
    rows: Vec<Vec<serde_json::Value>>,
}

fn is_valid_table_name(conn: &rusqlite::Connection, table: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?1;")
        .map_err(|e: rusqlite::Error| e.to_string())?;
    let exists = stmt.exists(rusqlite::params![table]).map_err(|e: rusqlite::Error| e.to_string())?;
    Ok(exists)
}

fn is_valid_column_name(conn: &rusqlite::Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info(\"{}\");", table.replace("\"", "\"\"")))
        .map_err(|e: rusqlite::Error| e.to_string())?;
        
    let cols_iter = stmt.query_map([], |row: &rusqlite::Row| {
        let name: String = row.get(1)?;
        Ok(name)
    }).map_err(|e: rusqlite::Error| e.to_string())?;
    
    for col in cols_iter {
        if let Ok(name) = col {
            if name == column {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn json_to_rusqlite(val: serde_json::Value) -> Result<rusqlite::types::Value, String> {
    match val {
        serde_json::Value::Null => Ok(rusqlite::types::Value::Null),
        serde_json::Value::Bool(b) => Ok(rusqlite::types::Value::Integer(if b { 1 } else { 0 })),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(rusqlite::types::Value::Integer(i))
            } else if let Some(f) = n.as_f64() {
                Ok(rusqlite::types::Value::Real(f))
            } else {
                Err("Invalid number type".to_string())
            }
        }
        serde_json::Value::String(s) => Ok(rusqlite::types::Value::Text(s)),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            let s = serde_json::to_string(&val).map_err(|e: serde_json::Error| e.to_string())?;
            Ok(rusqlite::types::Value::Text(s))
        }
    }
}

#[tauri::command]
async fn get_sqlite_tables(path: String) -> Result<Vec<String>, String> {
    log_to_app_file(&format!("SQLite: get_sqlite_tables for {}", path));
    let conn = rusqlite::Connection::open(&path)
        .map_err(|e: rusqlite::Error| format!("Failed to open database: {}", e))?;
    
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
        .map_err(|e: rusqlite::Error| e.to_string())?;
        
    let rows = stmt
        .query_map([], |row: &rusqlite::Row| row.get::<_, String>(0))
        .map_err(|e: rusqlite::Error| e.to_string())?;
        
    let mut tables = Vec::new();
    for r in rows {
        if let Ok(t) = r {
            tables.push(t);
        }
    }
    
    Ok(tables)
}

#[tauri::command]
async fn get_sqlite_table_data(path: String, table: String) -> Result<SqliteTableData, String> {
    log_to_app_file(&format!("SQLite: get_sqlite_table_data for {} -> {}", path, table));
    let conn = rusqlite::Connection::open(&path)
        .map_err(|e: rusqlite::Error| format!("Failed to open database: {}", e))?;
        
    if !is_valid_table_name(&conn, &table)? {
        return Err("Invalid table name".to_string());
    }
    
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info(\"{}\");", table.replace("\"", "\"\"")))
        .map_err(|e: rusqlite::Error| e.to_string())?;
        
    let cols_iter = stmt.query_map([], |row: &rusqlite::Row| {
        let name: String = row.get(1)?;
        let data_type: String = row.get(2)?;
        let pk: i32 = row.get(5)?;
        Ok(SqliteColumn {
            name,
            data_type,
            is_pk: pk > 0,
        })
    }).map_err(|e: rusqlite::Error| e.to_string())?;
    
    let mut columns = Vec::new();
    for col in cols_iter {
        columns.push(col.map_err(|e: rusqlite::Error| e.to_string())?);
    }
    
    let mut stmt_rows = conn
        .prepare(&format!("SELECT * FROM \"{}\";", table.replace("\"", "\"\"")))
        .map_err(|e: rusqlite::Error| e.to_string())?;
        
    let col_count = stmt_rows.column_count();
    let mut rows_iter = stmt_rows.query([]).map_err(|e: rusqlite::Error| e.to_string())?;
    let mut rows = Vec::new();
    
    while let Some(row) = rows_iter.next().map_err(|e: rusqlite::Error| e.to_string())? {
        let mut row_values = Vec::new();
        for i in 0..col_count {
            let val_ref = row.get_ref(i).map_err(|e: rusqlite::Error| e.to_string())?;
            let json_val = match val_ref {
                rusqlite::types::ValueRef::Null => serde_json::Value::Null,
                rusqlite::types::ValueRef::Integer(i_val) => serde_json::Value::Number(serde_json::Number::from(i_val)),
                rusqlite::types::ValueRef::Real(f_val) => {
                    if let Some(num) = serde_json::Number::from_f64(f_val) {
                        serde_json::Value::Number(num)
                    } else {
                        serde_json::Value::Null
                    }
                }
                rusqlite::types::ValueRef::Text(t_bytes) => {
                    let s = std::str::from_utf8(t_bytes).unwrap_or("");
                    serde_json::Value::String(s.to_string())
                }
                rusqlite::types::ValueRef::Blob(b_bytes) => {
                    let b64 = general_purpose::STANDARD.encode(b_bytes);
                    serde_json::Value::String(format!("[Blob: {} bytes] {}", b_bytes.len(), b64))
                }
            };
            row_values.push(json_val);
        }
        rows.push(row_values);
    }
    
    Ok(SqliteTableData { columns, rows })
}

#[tauri::command]
async fn update_sqlite_cell(
    path: String,
    table: String,
    column: String,
    value: serde_json::Value,
    pk_column: String,
    pk_value: serde_json::Value,
) -> Result<(), String> {
    log_to_app_file(&format!(
        "SQLite: update_sqlite_cell for {} -> {}.{} where {} = {:?}",
        path, table, column, pk_column, pk_value
    ));
    let conn = rusqlite::Connection::open(&path)
        .map_err(|e: rusqlite::Error| format!("Failed to open database: {}", e))?;
        
    if !is_valid_table_name(&conn, &table)? {
        return Err("Invalid table name".to_string());
    }
    
    if !is_valid_column_name(&conn, &table, &column)? || !is_valid_column_name(&conn, &table, &pk_column)? {
        return Err("Invalid column name".to_string());
    }
    
    let query_str = format!(
        "UPDATE \"{}\" SET \"{}\" = ?1 WHERE \"{}\" = ?2;",
        table.replace("\"", "\"\""),
        column.replace("\"", "\"\""),
        pk_column.replace("\"", "\"\"")
    );
    
    let mut stmt = conn.prepare(&query_str).map_err(|e: rusqlite::Error| e.to_string())?;
    let db_val = json_to_rusqlite(value)?;
    let db_pk_val = json_to_rusqlite(pk_value)?;
    
    stmt.execute(rusqlite::params![db_val, db_pk_val]).map_err(|e: rusqlite::Error| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn insert_sqlite_row(path: String, table: String) -> Result<(), String> {
    log_to_app_file(&format!("SQLite: insert_sqlite_row for {} -> {}", path, table));
    let conn = rusqlite::Connection::open(&path)
        .map_err(|e: rusqlite::Error| format!("Failed to open database: {}", e))?;
        
    if !is_valid_table_name(&conn, &table)? {
        return Err("Invalid table name".to_string());
    }
    
    let query_str = format!("INSERT INTO \"{}\" DEFAULT VALUES;", table.replace("\"", "\"\""));
    let res = conn.execute(&query_str, []);
    
    if let Err(e) = res {
        log_to_app_file(&format!("SQLite: DEFAULT VALUES insert failed, trying explicit column null insert. Error: {}", e));
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info(\"{}\");", table.replace("\"", "\"\"")))
            .map_err(|e: rusqlite::Error| e.to_string())?;
            
        let mut cols = Vec::new();
        let cols_iter = stmt.query_map([], |row: &rusqlite::Row| {
            let name: String = row.get(1)?;
            let pk: i32 = row.get(5)?;
            Ok((name, pk > 0))
        }).map_err(|e: rusqlite::Error| e.to_string())?;
        
        for c in cols_iter {
            if let Ok((name, is_pk)) = c {
                if !is_pk {
                    cols.push(name);
                }
            }
        }
        
        if cols.is_empty() {
            return Err("Table has no non-PK columns, could not insert row".to_string());
        }
        
        let col_names = cols.iter().map(|c: &String| format!("\"{}\"", c.replace("\"", "\"\""))).collect::<Vec<_>>().join(", ");
        let placeholders = cols.iter().map(|_| "NULL").collect::<Vec<_>>().join(", ");
        let query_str_explicit = format!("INSERT INTO \"{}\" ({}) VALUES ({});", table.replace("\"", "\"\""), col_names, placeholders);
        conn.execute(&query_str_explicit, []).map_err(|err: rusqlite::Error| err.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
async fn delete_sqlite_row(
    path: String,
    table: String,
    pk_column: String,
    pk_value: serde_json::Value,
) -> Result<(), String> {
    log_to_app_file(&format!("SQLite: delete_sqlite_row for {} -> {} where {} = {:?}", path, table, pk_column, pk_value));
    let conn = rusqlite::Connection::open(&path)
        .map_err(|e: rusqlite::Error| format!("Failed to open database: {}", e))?;
        
    if !is_valid_table_name(&conn, &table)? {
        return Err("Invalid table name".to_string());
    }
    
    if !is_valid_column_name(&conn, &table, &pk_column)? {
        return Err("Invalid primary key column".to_string());
    }
    
    let query_str = format!(
        "DELETE FROM \"{}\" WHERE \"{}\" = ?1;",
        table.replace("\"", "\"\""),
        pk_column.replace("\"", "\"\"")
    );
    
    let db_pk_val = json_to_rusqlite(pk_value)?;
    conn.execute(&query_str, rusqlite::params![db_pk_val]).map_err(|e: rusqlite::Error| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn add_sqlite_column(
    path: String,
    table: String,
    col_name: String,
    col_type: String,
) -> Result<(), String> {
    log_to_app_file(&format!("SQLite: add_sqlite_column for {} -> {} adding {} {}", path, table, col_name, col_type));
    let conn = rusqlite::Connection::open(&path)
        .map_err(|e: rusqlite::Error| format!("Failed to open database: {}", e))?;
        
    if !is_valid_table_name(&conn, &table)? {
        return Err("Invalid table name".to_string());
    }
    
    if col_name.is_empty() || !col_name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err("Column name must be alphanumeric and underscores only".to_string());
    }
    
    let type_upper = col_type.to_uppercase();
    if type_upper != "TEXT" && type_upper != "INTEGER" && type_upper != "REAL" {
        return Err("Only TEXT, INTEGER, and REAL column types are supported currently".to_string());
    }
    
    let query_str = format!(
        "ALTER TABLE \"{}\" ADD COLUMN \"{}\" {};",
        table.replace("\"", "\"\""),
        col_name,
        type_upper
    );
    
    conn.execute(&query_str, []).map_err(|e: rusqlite::Error| e.to_string())?;
    Ok(())
}

fn read_dir_recursive(path: &Path, depth: usize) -> Result<Vec<FileNode>, String> {
    if depth > 4 {
        return Ok(Vec::new());
    }
    
    let mut entries = Vec::new();
    let read_entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    
    for entry_result in read_entries {
        if let Ok(entry) = entry_result {
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            
            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "gen" {
                continue;
            }
            
            let is_dir = entry_path.is_dir();
            let children = if is_dir {
                Some(read_dir_recursive(&entry_path, depth + 1)?)
            } else {
                None
            };
            
            entries.push(FileNode {
                name,
                path: entry_path.to_string_lossy().to_string(),
                is_dir,
                children,
            });
        }
    }
    
    entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });
    
    Ok(entries)
}

fn main() {
    let log_dir = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("logs");
    let mut pm = ProcessManager::new(&log_dir);

    // Pre-populate a standard System Connection diagnostics task for ease of testing
    let _ = tauri::async_runtime::block_on(pm.register_project(ProjectConfig {
        id: "sys-ping".to_string(),
        name: "Local Connection diagnostics".to_string(),
        command: "ping".to_string(),
        args: vec!["127.0.0.1".to_string(), "-n".to_string(), "20".to_string()],
        cwd: None,
        setup_command: None,
        setup_args: None,
        auto_restart: Some(false),
        env: None,
        max_cpu_percent: None,
        max_ram_mb: None,
        port: None,
        source: None,
        terminal_mode: None,
        toolchain: None,
        toolchain_version: None,
        enable_tunnel: None,
    }));

    let process_manager = Arc::new(Mutex::new(pm));
    let resource_monitor = Arc::new(ResourceMonitor::new());

    let pm_clone = process_manager.clone();
    let rm_clone = resource_monitor.clone();

    tauri::Builder::default()
        .manage(AppState {
            process_manager,
            resource_monitor,
        })
        .setup(move |app| {
            // Get the main webview window. Standard API in Tauri v2.
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| tauri::Error::WindowNotFound)?;

            // Spawn SQLite background log persister task inside active Tokio runtime
            let pm_for_persister = pm_clone.clone();
            tauri::async_runtime::spawn(async move {
                let pm = pm_for_persister.lock().await;
                pm.spawn_log_persister();
            });

            // 0. Spawn environment preloader task (non-blocking ngầm)
            let pm_for_init = pm_clone.clone();
            tauri::async_runtime::spawn(async move {
                let init_msg = "Initializing isolated proto toolchains and latest cloudflared tunnel binary in background...";
                println!("{}", init_msg);
                log_to_app_file(init_msg);
                
                // 1. Brief lock to extract the config paths
                let (proto_home, bin_dir) = {
                    let pm = pm_for_init.lock().await;
                    let app_data_dir = std::env::current_dir().unwrap_or_default().join("app_data");
                    let bin_dir = app_data_dir.join("bin");
                    (pm.proto_manager.proto_home.clone(), bin_dir)
                };

                // 2. Heavy operations outside the mutex lock
                let proto_manager = core_engine::proto_manager::ProtoManager::new(proto_home);
                let proto_bin = match proto_manager.ensure_proto_cli(&bin_dir).await {
                    Ok(bin) => bin,
                    Err(e) => {
                        let err_msg = format!("ENVIRONMENT INIT ERROR (ensure_proto_cli): {}", e);
                        eprintln!("{}", err_msg);
                        log_to_app_file(&err_msg);
                        return;
                    }
                };

                log_to_app_file("Proto CLI verified and active.");

                if let Err(e) = proto_manager.ensure_stable_toolchains(&proto_bin).await {
                    let err_msg = format!("ENVIRONMENT INIT ERROR (ensure_stable_toolchains): {}", e);
                    eprintln!("{}", err_msg);
                    log_to_app_file(&err_msg);
                    return;
                }

                log_to_app_file("Toolchains checked / verified stable.");

                let cloudflared_bin = match core_engine::cloudflared_manager::CloudflaredManager::update_tunnel_binary(&bin_dir).await {
                    Ok(bin) => bin,
                    Err(e) => {
                        let err_msg = format!("ENVIRONMENT INIT ERROR (update_tunnel_binary): {}", e);
                        eprintln!("{}", err_msg);
                        log_to_app_file(&err_msg);
                        return;
                    }
                };

                log_to_app_file("Cloudflared binary verified / updated successfully.");

                // 3. Lock briefly again to write the computed cloudflared binary path back
                {
                    let mut pm = pm_for_init.lock().await;
                    pm.cloudflared_manager.executable_path = cloudflared_bin;
                }
                
                let success_msg = "Isolated environment initialized successfully!";
                println!("{}", success_msg);
                log_to_app_file(success_msg);
            });

            // 1. Spawn Log Event Router Task
            let pm_for_logs = pm_clone.clone();
            let window_for_logs = window.clone();
            tauri::async_runtime::spawn(async move {
                let mut log_rx = {
                    let pm_lock = pm_for_logs.lock().await;
                    pm_lock.subscribe_logs()
                };
                while let Ok(log) = log_rx.recv().await {
                    let _ = window_for_logs.emit("process-log", log);
                }
            });

            // 2. Spawn Status Event Router Task
            let pm_for_status = pm_clone.clone();
            let rm_for_status = rm_clone.clone();
            let window_for_status = window.clone();
            tauri::async_runtime::spawn(async move {
                let mut status_rx = {
                    let pm_lock = pm_for_status.lock().await;
                    pm_lock.subscribe_status()
                };
                while let Ok((project_id, state)) = status_rx.recv().await {
                    // Update state inside ProcessManager
                    {
                        let mut pm = pm_for_status.lock().await;
                        if let Some(inst) = pm.instances.get_mut(&project_id) {
                            inst.state = state.clone();
                        }
                    }

                    // Manage registration in ResourceMonitor
                    match state {
                        ProcessState::Running { pid } => {
                            rm_for_status.register(project_id.clone(), pid);
                        }
                        ProcessState::Stopped | ProcessState::Fatal { .. } | ProcessState::Terminated => {
                            rm_for_status.deregister(project_id.clone());
                        }
                        _ => {}
                    }

                    #[derive(Clone, serde::Serialize)]
                    struct StatusPayload {
                        project_id: String,
                        state: ProcessState,
                    }
                    let _ = window_for_status.emit(
                        "process-status",
                        StatusPayload {
                            project_id,
                            state,
                        },
                    );
                }
            });

            // 3. Spawn Resource Stats Router Task with Watchdog enforcement
            let rm_for_stats = rm_clone.clone();
            let pm_for_watchdog = pm_clone.clone();
            let window_for_stats = window.clone();
            tauri::async_runtime::spawn(async move {
                let mut stats_rx = rm_for_stats.subscribe();
                let mut exceeded_since: std::collections::HashMap<String, std::time::Instant> = std::collections::HashMap::new();

                while let Ok(stats) = stats_rx.recv().await {
                    // Always broadcast stats to frontend
                    let _ = window_for_stats.emit("resource-update", stats.clone());

                    // Read thresholds from project config
                    let limits = {
                        let pm = pm_for_watchdog.lock().await;
                        pm.get_config(&stats.project_id)
                    };

                    if let Some(config) = limits {
                        let cpu_limit = config.max_cpu_percent;
                        let ram_limit_mb = config.max_ram_mb;

                        let cpu_exceeded = cpu_limit.map(|limit| stats.cpu_percentage > limit as f32).unwrap_or(false);
                        let ram_exceeded = ram_limit_mb.map(|limit| stats.ram_bytes > limit * 1024 * 1024).unwrap_or(false);

                        if cpu_exceeded || ram_exceeded {
                            let entry_time = *exceeded_since.entry(stats.project_id.clone()).or_insert_with(std::time::Instant::now);
                            if entry_time.elapsed() >= std::time::Duration::from_secs(30) {
                                // Breach persisted for 30s -> Force kill & fatal state
                                let mut pm = pm_for_watchdog.lock().await;
                                let reason = if cpu_exceeded && ram_exceeded {
                                    format!("CPU limit ({}%) and RAM limit ({}MB) exceeded continuously for 30 seconds", cpu_limit.unwrap(), ram_limit_mb.unwrap())
                                } else if cpu_exceeded {
                                    format!("CPU limit ({}%) exceeded continuously for 30 seconds", cpu_limit.unwrap())
                                } else {
                                    format!("RAM limit ({}MB) exceeded continuously for 30 seconds", ram_limit_mb.unwrap())
                                };

                                let _ = pm.force_fatal_stop(&stats.project_id, reason).await;
                                exceeded_since.remove(&stats.project_id);
                            }
                        } else {
                            exceeded_since.remove(&stats.project_id);
                        }
                    } else {
                        exceeded_since.remove(&stats.project_id);
                    }
                }
            });

            // 4. Spawn Terminal Event Router Task
            let pm_for_terminal = pm_clone.clone();
            let window_for_terminal = window.clone();
            tauri::async_runtime::spawn(async move {
                let mut term_rx = {
                    let pm_lock = pm_for_terminal.lock().await;
                    pm_lock.subscribe_terminal()
                };
                while let Ok(output) = term_rx.recv().await {
                    let _ = window_for_terminal.emit("terminal-output", output);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_project_process,
            stop_project_process,
            get_projects,
            get_project_logs,
            get_project_state,
            register_project,
            deregister_project,
            check_port_status,
            force_kill_process,
            get_project_files,
            spawn_terminal_session,
            write_to_terminal_session,
            kill_terminal_session,
            read_file_content,
            write_file_content,
            get_sqlite_tables,
            get_sqlite_table_data,
            update_sqlite_cell,
            insert_sqlite_row,
            delete_sqlite_row,
            add_sqlite_column
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();

                let state = app_handle.state::<AppState>();
                let pm_clone = state.process_manager.clone();
                let rm_clone = state.resource_monitor.clone();
                let app_handle_clone = app_handle.clone();

                tauri::async_runtime::spawn(async move {
                    let mut pids: Vec<(String, u32)> = Vec::new();
                    let mut term_pids: Vec<u32> = Vec::new();
                    {
                        let mut pm = pm_clone.lock().await;
                        for (id, inst) in pm.instances.iter_mut() {
                            if let ProcessState::Running { pid } = inst.state {
                                pids.push((id.clone(), pid));
                                if let Some(stop_tx) = inst.stop_sender.take() {
                                    let _ = stop_tx.send(());
                                }
                            }
                        }
                        for (_, session) in pm.terminal_sessions.iter() {
                            term_pids.push(session.pid);
                        }
                    }

                    for (project_id, pid) in pids {
                        core_engine::terminate_process_tree(pid).await;
                        rm_clone.deregister(project_id);
                    }
                    
                    for pid in term_pids {
                        core_engine::terminate_process_tree(pid).await;
                    }

                    app_handle_clone.exit(0);
                });
            }
        });
}
