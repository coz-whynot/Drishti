// Drishti library — registers Tauri commands the frontend uses.
//
// Commands exposed to the JS frontend:
//   pick_folder()                          → Option<String>  (absolute path)
//   start_scan(project_root)               → ScanResult       (success/failure + dashboard path)
//   read_file(path, project_root)          → Option<String>   (file content; rejects paths outside root)
//   list_recent_projects()                 → Vec<String>
//   add_recent_project(path)               → ()

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

const RECENT_FILE: &str = "drishti-recent.json";
const MAX_RECENT: usize = 12;

#[derive(Serialize)]
pub struct ScanResult {
    pub success: bool,
    pub dashboard_path: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub elapsed_ms: u128,
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path);
    });
    match rx.recv() {
        Ok(Some(p)) => Some(p.to_string()),
        _ => None,
    }
}

#[tauri::command]
fn start_scan(project_root: String, app: tauri::AppHandle) -> ScanResult {
    let start = std::time::Instant::now();
    let scan_js = locate_scan_js(&app);
    if scan_js.is_none() {
        return ScanResult {
            success: false,
            dashboard_path: None,
            stdout: String::new(),
            stderr: "Could not locate src/scan.js. Is the Drishti install directory intact?".into(),
            elapsed_ms: 0,
        };
    }
    let scan_js = scan_js.unwrap();
    let scan_dir = scan_js
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    let output = Command::new("node")
        .arg(&scan_js)
        .arg(&project_root)
        .current_dir(&scan_dir)
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let dashboard_path = scan_dir.join("drishti.html");
            let dash_str = if dashboard_path.exists() {
                Some(dashboard_path.to_string_lossy().to_string())
            } else {
                None
            };
            ScanResult {
                success: out.status.success() && dash_str.is_some(),
                dashboard_path: dash_str,
                stdout, stderr,
                elapsed_ms: start.elapsed().as_millis(),
            }
        }
        Err(e) => ScanResult {
            success: false,
            dashboard_path: None,
            stdout: String::new(),
            stderr: format!("Failed to run `node`: {}. Is Node.js installed and on PATH?", e),
            elapsed_ms: start.elapsed().as_millis(),
        },
    }
}

#[tauri::command]
fn read_file(path: String, project_root: String) -> Option<String> {
    // Path-traversal guard: resolved path must be inside project_root.
    let root = match fs::canonicalize(&project_root) { Ok(p) => p, Err(_) => return None };
    let target = match fs::canonicalize(&path) { Ok(p) => p, Err(_) => return None };
    if !target.starts_with(&root) { return None; }
    // Sensitive-file deny-list — match basename / path against patterns.
    let lower = target.to_string_lossy().to_lowercase();
    let denied = [
        ".env", "credentials", "service-account", ".firebase-credentials",
        "id_rsa", "id_dsa", "id_ed25519", ".pem", ".key", ".p12",
    ];
    if denied.iter().any(|d| lower.contains(d)) {
        return Some(format!("[Drishti] {} matches the sensitive-file deny-list. Open externally to view.", path));
    }
    fs::read_to_string(&target).ok()
}

#[tauri::command]
fn list_recent_projects() -> Vec<String> {
    let path = recent_path();
    let text = fs::read_to_string(&path).unwrap_or_else(|_| String::new());
    serde_json::from_str(&text).unwrap_or_else(|_| Vec::new())
}

#[tauri::command]
fn add_recent_project(path: String) {
    let mut list: Vec<String> = list_recent_projects();
    list.retain(|p| p != &path);
    list.insert(0, path);
    list.truncate(MAX_RECENT);
    if let Ok(json) = serde_json::to_string_pretty(&list) {
        let target = recent_path();
        if let Some(parent) = target.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(target, json);
    }
}

fn recent_path() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        return home.join(".drishti").join(RECENT_FILE);
    }
    PathBuf::from(RECENT_FILE)
}

// Locate the bundled src/scan.js. In dev (cargo run) it's two dirs up from
// the current working dir. In a packaged install it lives next to the .exe
// in the resource directory. We check both.
fn locate_scan_js(app: &tauri::AppHandle) -> Option<PathBuf> {
    // 1. Resource directory (packaged install)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("src").join("scan.js");
        if candidate.exists() { return Some(candidate); }
    }
    // 2. Dev: relative to CWD
    let cwd = std::env::current_dir().ok()?;
    for ancestor in cwd.ancestors().take(4) {
        let candidate = ancestor.join("src").join("scan.js");
        if candidate.exists() { return Some(candidate); }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            start_scan,
            read_file,
            list_recent_projects,
            add_recent_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
