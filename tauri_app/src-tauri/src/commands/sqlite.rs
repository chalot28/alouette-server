use crate::state::log_to_app_file;
use base64::{Engine as _, engine::general_purpose};

#[derive(serde::Serialize)]
pub struct SqliteColumn {
    pub name: String,
    pub data_type: String,
    pub is_pk: bool,
}

#[derive(serde::Serialize)]
pub struct SqliteTableData {
    pub columns: Vec<SqliteColumn>,
    pub rows: Vec<Vec<serde_json::Value>>,
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
pub async fn get_sqlite_tables(path: String) -> Result<Vec<String>, String> {
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
pub async fn get_sqlite_table_data(path: String, table: String) -> Result<SqliteTableData, String> {
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
pub async fn update_sqlite_cell(
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
pub async fn insert_sqlite_row(path: String, table: String) -> Result<(), String> {
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
pub async fn delete_sqlite_row(
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
pub async fn add_sqlite_column(
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
