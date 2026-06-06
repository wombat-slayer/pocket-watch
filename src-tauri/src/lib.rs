use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use serde_json::{json, Value};

fn validate_data_path(path: &str) -> Result<(), String> {
    // Reject null bytes
    if path.contains('\0') {
        return Err("Data path must not contain null bytes".to_string());
    }
    let p = std::path::Path::new(path);
    // Must be absolute — no relative traversal starting from CWD
    if !p.is_absolute() {
        return Err("Data path must be absolute".to_string());
    }
    // Reject any ".." component — prevents path traversal attacks
    use std::path::Component;
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Data path must not contain '..' components".to_string());
    }
    // Must end with .json
    match p.extension().and_then(|e| e.to_str()) {
        Some("json") => Ok(()),
        _ => Err("Data path must have a .json extension".to_string()),
    }
}

#[tauri::command]
fn load_data(path: String) -> Result<String, String> {
    validate_data_path(&path)?;
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_data(path: String, data: String) -> Result<(), String> {
    validate_data_path(&path)?;
    if let Some(parent) = PathBuf::from(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn data_file_exists(path: String) -> bool {
    PathBuf::from(&path).exists()
}

#[tauri::command]
fn get_default_data_path(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("pocket-watch.json").to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

// ── OS credential manager (encrypted secret storage) ────────────────────────
//
// Secrets (Plaid client_id/secret, per-item access tokens) live in the OS
// keychain — Windows Credential Manager, macOS Keychain, or Linux Secret
// Service — never in plaintext files. Keys are namespaced by the frontend
// (see src/plaidLayer.js).

const KEYRING_SERVICE: &str = "Pocket Watch";

fn keyring_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    keyring_entry(&key)?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    match keyring_entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    match keyring_entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ── Plaid helpers ────────────────────────────────────────────────────────────

fn plaid_base_url(env: &str) -> String {
    match env {
        "production"  => "https://production.plaid.com".to_string(),
        "development" => "https://development.plaid.com".to_string(),
        _             => "https://sandbox.plaid.com".to_string(),
    }
}

#[tauri::command]
async fn plaid_create_link_token(
    client_id: String,
    secret: String,
    env: String,
    user_id: String,
    redirect_uri: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let base = plaid_base_url(&env);
    let mut payload = json!({
        "client_id": client_id,
        "secret":    secret,
        "client_name": "Pocket Watch",
        "user": { "client_user_id": user_id },
        "products":      ["transactions"],
        "country_codes": ["US"],
        "language":      "en"
    });
    // OAuth institutions (Chase, Wells Fargo, …) require a redirect_uri that
    // exactly matches one registered in the Plaid dashboard.
    if let Some(uri) = redirect_uri {
        payload["redirect_uri"] = json!(uri);
    }
    let resp = client
        .post(format!("{}/link/token/create", base))
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    body["link_token"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| {
            body["error_message"]
                .as_str()
                .unwrap_or("Failed to create link token")
                .to_string()
        })
}

#[tauri::command]
async fn plaid_exchange_token(
    client_id: String,
    secret: String,
    env: String,
    public_token: String,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let base = plaid_base_url(&env);
    let resp = client
        .post(format!("{}/item/public_token/exchange", base))
        .json(&json!({
            "client_id":    client_id,
            "secret":       secret,
            "public_token": public_token
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    body["access_token"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| {
            body["error_message"]
                .as_str()
                .unwrap_or("Failed to exchange token")
                .to_string()
        })
}

#[tauri::command]
async fn plaid_fetch_transactions(
    client_id:    String,
    secret:       String,
    env:          String,
    access_token: String,
    start_date:   String,
    end_date:     String,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let base = plaid_base_url(&env);
    let resp = client
        .post(format!("{}/transactions/get", base))
        .json(&json!({
            "client_id":    client_id,
            "secret":       secret,
            "access_token": access_token,
            "start_date":   start_date,
            "end_date":     end_date,
            "options": { "count": 500, "offset": 0 }
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    if body["error_code"].is_null() {
        Ok(body.to_string())
    } else {
        Err(body["error_message"]
            .as_str()
            .unwrap_or("Failed to fetch transactions")
            .to_string())
    }
}

#[tauri::command]
async fn plaid_remove_item(
    client_id:    String,
    secret:       String,
    env:          String,
    access_token: String,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let base = plaid_base_url(&env);
    let resp = client
        .post(format!("{}/item/remove", base))
        .json(&json!({
            "client_id":    client_id,
            "secret":       secret,
            "access_token": access_token
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    if body["error_code"].is_null() {
        Ok(())
    } else {
        Err(body["error_message"]
            .as_str()
            .unwrap_or("Failed to remove item")
            .to_string())
    }
}

// ── Popup bridge plugin ──────────────────────────────────────────────────────
//
// wry/WebView2 denies window.open() calls coming from cross-origin iframes,
// which silently breaks Plaid Link's OAuth handoff ("Continue to login"
// no-ops — Link's popup returns null and nothing happens). This init script
// runs in EVERY frame: inside subframes it replaces window.open with a
// postMessage to the top frame; PlaidSync.jsx listens for that message and
// opens the URL in the system browser via the opener plugin. The bank flow
// then completes by redirecting the browser to the loopback listener.

const POPUP_BRIDGE_SCRIPT: &str = r#"
(function () {
  if (window.top === window.self) return; // subframes only
  window.open = function (url) {
    try {
      if (typeof url === 'string' && /^https:\/\//.test(url)) {
        window.top.postMessage({ __pocket_watch_open_external: true, url: url }, '*');
      }
    } catch (e) {}
    return null; // callers must treat the popup as fire-and-forget
  };
})();
"#;

fn popup_bridge<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("pw-popup-bridge")
        .js_init_script_on_all_frames(POPUP_BRIDGE_SCRIPT)
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_oauth::init())
        .plugin(popup_bridge())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // System tray setup
            let show = MenuItem::with_id(app, "show", "Show Pocket Watch", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray_builder = TrayIconBuilder::new().menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            let _tray = tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            data_file_exists,
            get_default_data_path,
            plaid_create_link_token,
            plaid_exchange_token,
            plaid_fetch_transactions,
            plaid_remove_item,
            secret_set,
            secret_get,
            secret_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
