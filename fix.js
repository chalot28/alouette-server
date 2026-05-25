const fs = require('fs');
let c = fs.readFileSync('tauri_app/src-tauri/src/commands/browser.rs', 'utf8');
c = c.replace(/let \(win_width, win_height\) = if let Ok\(size\) = window.inner_size\(\) \{\r?\n\s+\(size.width as f64, size.height as f64\)/, 'let (win_width, win_height) = if let Ok(size) = window.inner_size() { let s = window.scale_factor().unwrap_or(1.0); let l = size.to_logical::<f64>(s); (l.width, l.height)');
c = c.replace(/if let Ok\(size\) = win.inner_size\(\) \{\r?\n\s+\(size.width as f64, size.height as f64\)/, 'if let Ok(size) = win.inner_size() { let s = win.scale_factor().unwrap_or(1.0); let l = size.to_logical::<f64>(s); (l.width, l.height)');
fs.writeFileSync('tauri_app/src-tauri/src/commands/browser.rs', c);
