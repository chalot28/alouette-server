use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio::time::sleep;
use tauri::{AppHandle, Emitter, Manager};
use crate::state::AppState;

pub static ALOUETTE_OPEN_ENABLED: AtomicBool = AtomicBool::new(true);

pub fn is_alouette_open_enabled() -> bool {
    ALOUETTE_OPEN_ENABLED.load(Ordering::Relaxed)
}

pub fn set_alouette_open_enabled(enabled: bool) {
    ALOUETTE_OPEN_ENABLED.store(enabled, Ordering::Relaxed);
}

use std::sync::OnceLock;

fn get_last_processed_timestamps() -> &'static Mutex<HashMap<String, u64>> {
    static TIMESTAMPS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    TIMESTAMPS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Spawns the Alouette Open log monitor background task
pub fn spawn_alouette_open_monitor(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Wait a few seconds for systems to initialize
        sleep(Duration::from_secs(5)).await;

        // Try loading the ONNX model once to verify it works
        let model_path = std::env::current_dir()
            .unwrap_or_default()
            .join("app_data")
            .join("model_alouette_open")
            .join("alouette_open-A1 v1.0.onnx");

        println!("[Alouette Open] Loading ONNX model from: {:?}", model_path);
        let tract_model = match load_onnx_model(&model_path) {
            Ok(m) => {
                println!("[Alouette Open] Successfully loaded ONNX model!");
                Some(Arc::new(m))
            }
            Err(e) => {
                eprintln!("[Alouette Open] Warning: Failed to load ONNX model: {}. Using lightweight heuristic fallback.", e);
                None
            }
        };

        loop {
            sleep(Duration::from_secs(30)).await;

            if !is_alouette_open_enabled() {
                continue;
            }

            let app_state = match app_handle.try_state::<AppState>() {
                Some(state) => state,
                None => continue,
            };

            // Lock ProcessManager to read projects
            let pm = app_state.process_manager.lock().await;
            let projects = pm.get_configs();
            let db = pm.db_manager.clone();
            drop(pm); // Release lock as soon as possible

            for project in projects {
                let project_id = project.id.clone();
                
                // Get logs (fetch up to latest 50 logs)
                if let Ok(logs) = db.get_logs(&project_id, 50) {
                    let mut last_timestamps = get_last_processed_timestamps().lock().unwrap();
                    let last_ts = *last_timestamps.get(&project_id).unwrap_or(&0);
                    
                    let mut max_ts = last_ts;
                    let mut new_logs = Vec::new();

                    for log in logs {
                        if log.timestamp > last_ts {
                            if log.timestamp > max_ts {
                                max_ts = log.timestamp;
                            }
                            new_logs.push(log);
                        }
                    }

                    if !new_logs.is_empty() {
                        last_timestamps.insert(project_id.clone(), max_ts);
                        drop(last_timestamps); // release lock before processing

                        for log in new_logs {
                            let text_lower = log.text.to_lowercase();
                            
                            // 1. Run ONNX Inference if available
                            let is_onnx_error = if let Some(ref model) = tract_model {
                                match run_inference(model.clone(), &log.text) {
                                    Ok(is_err) => is_err,
                                    Err(_) => false,
                                }
                            } else {
                                false
                            };

                            // 2. Heuristic validation (always fallback for high reliability)
                            let is_heuristic_error = text_lower.contains("error") 
                                || text_lower.contains("exception")
                                || text_lower.contains("failed")
                                || text_lower.contains("panic")
                                || text_lower.contains("critical")
                                || log.stream == "stderr";

                            if is_onnx_error || is_heuristic_error {
                                println!("[Alouette Open] Found error in project [{}]: {}", project_id, log.text);
                                
                                // Emit Tauri event to front-end
                                let payload = serde_json::json!({
                                    "project_id": project_id,
                                    "project_name": project.name,
                                    "stream": log.stream,
                                    "text": log.text,
                                    "timestamp": log.timestamp,
                                    "cwd": project.cwd
                                });
                                let _ = app_handle.emit("alouette-open-error", payload);
                            }
                        }
                    }
                }
            }
        }
    });
}

// Struct to represent runnable tract model
type TractModel = tract_onnx::prelude::SimplePlan<tract_onnx::prelude::TypedFact, Box<dyn tract_onnx::prelude::TypedOp>, tract_onnx::prelude::TypedModel>;

fn load_onnx_model(path: &std::path::Path) -> Result<TractModel, String> {
    use tract_onnx::prelude::*;
    
    let model = tract_onnx::onnx()
        .model_for_path(path)
        .map_err(|e| e.to_string())?
        .into_optimized()
        .map_err(|e| e.to_string())?
        .into_runnable()
        .map_err(|e| e.to_string())?;

    Ok(model)
}

fn run_inference(model: Arc<TractModel>, text: &str) -> Result<bool, String> {
    use tract_onnx::prelude::*;

    // A very simple ASCII tokenizer for alouette_open-A1 v1.0.onnx
    // It creates a fixed-size vector (e.g. sequence length of 128) of token IDs
    let mut tokens = vec![0i64; 128];
    for (i, byte) in text.as_bytes().iter().take(128).enumerate() {
        tokens[i] = *byte as i64;
    }

    // Prepare tract tensor of shape [1, 128]
    let tensor = Tensor::from_shape(&[1, 128], &tokens)
        .map_err(|e| e.to_string())?;

    // Run inference
    let result = model.run(tvec!(tensor.into()))
        .map_err(|e| e.to_string())?;

    // Analyze output logits (assume first output is binary classifier: index 1 is error probability)
    if let Some(output_tensor) = result.get(0) {
        if let Ok(logits) = output_tensor.to_array_view::<f32>() {
            let slice = logits.as_slice().unwrap_or(&[]);
            if slice.len() >= 2 {
                let no_err_logit = slice[0];
                let err_logit = slice[1];
                return Ok(err_logit > no_err_logit);
            }
        }
    }

    Ok(false)
}
