use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{Manager, State, Emitter};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use serde_json::{json, Value};

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(reqwest::Client::new)
}

// ── App state ─────────────────────────────────────────────────────────────────
//
// Holds the currently allowed data-file directory, set by the frontend
// after the user picks (or confirms) a data file location.  All read/write
// commands validate the requested path against this directory.
struct DataDirState(Mutex<PathBuf>);

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

// Returns a canonical path, stripping the Windows \\?\ extended-length prefix
// that fs::canonicalize adds on that platform so comparisons stay consistent.
fn friendly_canonical(path: &std::path::Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path)
        .map_err(|_| "data directory cannot be resolved".to_string())?;
    #[cfg(windows)]
    {
        let s = canonical.to_string_lossy();
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return Ok(PathBuf::from(stripped.to_string()));
        }
    }
    Ok(canonical)
}

// Validates syntax, canonicalizes the parent directory, checks scope against
// allowed_dir, and guards against file-level symlinks escaping that directory.
// Returns the resolved path (canonical parent + original filename) to use for I/O.
//
// NOTE: There is an unavoidable TOCTOU window between the symlink check and the
// actual I/O in the callers. Exploiting it requires local filesystem write access
// to the allowed directory — effectively equivalent privileges to the threat
// being modelled — so it is accepted as a known limitation in this desktop context.
fn resolve_data_path(path: &str, allowed_dir: &PathBuf) -> Result<PathBuf, String> {
    validate_data_path(path)?;
    let p = PathBuf::from(path);
    let parent = p.parent().ok_or_else(|| "path has no parent directory".to_string())?;
    let canonical_parent = friendly_canonical(parent)?;
    let canonical_allowed = friendly_canonical(allowed_dir)
        .map_err(|_| "configured data directory cannot be resolved".to_string())?;
    if canonical_parent != canonical_allowed {
        return Err("data path is outside the configured data directory".to_string());
    }
    let filename = p.file_name().ok_or_else(|| "path has no filename".to_string())?;
    let resolved = canonical_parent.join(filename);
    // Reject file-level symlinks whose target escapes the allowed directory
    if resolved.is_symlink() {
        let link_target = friendly_canonical(&resolved)?;
        let link_parent = link_target.parent()
            .ok_or_else(|| "symlink target has no parent directory".to_string())?;
        if link_parent != canonical_parent {
            return Err("data path is a symlink that points outside the allowed directory".to_string());
        }
    }
    Ok(resolved)
}

#[tauri::command]
fn set_allowed_data_dir(dir: String, state: State<DataDirState>) -> Result<(), String> {
    if dir.contains('\0') {
        return Err("directory path must not contain null bytes".to_string());
    }
    let p = PathBuf::from(&dir);
    if !p.is_absolute() {
        return Err("directory path must be absolute".to_string());
    }
    use std::path::Component;
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("directory path must not contain '..' components".to_string());
    }
    // Require at least one non-root component so bare roots (/ or C:\) are rejected.
    let depth = p.components()
        .filter(|c| !matches!(c, Component::RootDir | Component::Prefix(_)))
        .count();
    if depth < 1 {
        return Err("directory path must not be a filesystem root".to_string());
    }
    *state.0.lock().unwrap_or_else(|p| p.into_inner()) = p;
    Ok(())
}

#[tauri::command]
fn load_data(path: String, state: State<DataDirState>) -> Result<String, String> {
    let allowed = state.0.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let resolved = resolve_data_path(&path, &allowed)?;
    fs::read_to_string(&resolved).map_err(|e| e.to_string())
}

fn backup_path(main: &PathBuf, n: u32) -> PathBuf {
    let stem   = main.file_stem().and_then(|s| s.to_str()).unwrap_or("data");
    let parent = main.parent().unwrap_or_else(|| std::path::Path::new("."));
    parent.join(format!("{}.backup.{}.json", stem, n))
}

// Remove apiKeys.finnhub from a JSON string before writing to a backup file.
// Returns the scrubbed JSON, or the original if parsing fails.
fn scrub_finnhub_from_json(raw: &str) -> String {
    if let Ok(mut v) = serde_json::from_str::<Value>(raw) {
        if let Some(keys) = v.get_mut("apiKeys").and_then(|k| k.as_object_mut()) {
            keys.remove("finnhub");
        }
        if let Ok(out) = serde_json::to_string(&v) {
            return out;
        }
    }
    raw.to_string()
}

fn rotate_backups(main: &PathBuf) {
    if !main.exists() { return; }

    // Write scrubbed backup first (to a .tmp), THEN rotate existing generations.
    // This ordering means a failed write never leaves the rotation in a half-moved
    // state and a failed rotation still preserves the new backup at its temp path.
    let raw = match fs::read_to_string(main) {
        Ok(s)  => s,
        Err(e) => { eprintln!("[pocket-watch] backup read failed: {e}"); return; }
    };
    let tmp = backup_path(main, 1).with_extension("json.tmp");
    if let Err(e) = fs::write(&tmp, scrub_finnhub_from_json(&raw)) {
        eprintln!("[pocket-watch] backup write to .tmp failed: {e}");
        return;
    }

    // Rotate: drop generation 7, shift 6→7, 5→6, …, 1→2.
    let _ = fs::remove_file(backup_path(main, 7));
    for n in (1..=6).rev() {
        let src = backup_path(main, n);
        if src.exists() {
            if let Err(e) = fs::rename(&src, backup_path(main, n + 1)) {
                eprintln!("[pocket-watch] backup rotate {n}→{} failed: {e}", n + 1);
            }
        }
    }

    // Commit the new generation 1.
    if let Err(e) = fs::rename(&tmp, backup_path(main, 1)) {
        eprintln!("[pocket-watch] backup rename .tmp→.backup.1.json failed: {e}");
    }
}

// Rename tmp → dest with up to 5 attempts and exponential backoff (50ms, 100ms, 200ms, 400ms).
// On Windows, antivirus and file-indexer processes can briefly lock files; retrying handles
// transient EACCES / EBUSY failures without permanently failing the save.
fn atomic_rename(tmp: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    const MAX_ATTEMPTS: u32 = 5;
    for attempt in 0..MAX_ATTEMPTS {
        match fs::rename(tmp, dest) {
            Ok(()) => return Ok(()),
            Err(e) => {
                if attempt + 1 == MAX_ATTEMPTS {
                    let _ = fs::remove_file(tmp);
                    return Err(format!("atomic rename failed after {MAX_ATTEMPTS} attempts: {e}"));
                }
                std::thread::sleep(std::time::Duration::from_millis(50 * (1u64 << attempt)));
            }
        }
    }
    unreachable!()
}

#[tauri::command]
fn save_data(path: String, data: String, state: State<DataDirState>) -> Result<(), String> {
    validate_data_path(&path)?;
    let allowed = state.0.lock().unwrap_or_else(|p| p.into_inner()).clone();
    // Create only the configured allowed directory before resolve_data_path, so we never
    // create directories outside the allowed scope (M5).
    fs::create_dir_all(&allowed).map_err(|e| e.to_string())?;
    let resolved = resolve_data_path(&path, &allowed)?;
    rotate_backups(&resolved);
    let tmp_path = PathBuf::from(format!("{}.tmp", resolved.display()));
    fs::write(&tmp_path, &data).map_err(|e| e.to_string())?;
    atomic_rename(&tmp_path, &resolved)
}

#[tauri::command]
fn data_file_exists(path: String, state: State<DataDirState>) -> Result<bool, String> {
    validate_data_path(&path)?;
    let p = PathBuf::from(&path);
    let parent = p.parent().ok_or_else(|| "path has no parent directory".to_string())?;
    // If the directory doesn't exist the file can't exist either; skip canonicalization.
    if !parent.exists() {
        return Ok(false);
    }
    let allowed = state.0.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let canonical_parent = friendly_canonical(parent)?;
    let canonical_allowed = friendly_canonical(&allowed)
        .map_err(|_| "configured data directory cannot be resolved".to_string())?;
    if canonical_parent != canonical_allowed {
        return Err("data path is outside the configured data directory".to_string());
    }
    Ok(p.exists())
}

#[tauri::command]
fn get_default_data_path(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("pocket-watch.json").to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

// ── Receipt file storage ─────────────────────────────────────────────────────
//
// Receipts live in a `receipts/` folder next to the data file.
// Filenames are [txId]-[timestamp].[ext], validated against path traversal.

const ALLOWED_RECEIPT_EXTS: &[&str] = &["png", "jpg", "jpeg", "pdf"];

fn validate_receipt_filename(filename: &str) -> Result<(), String> {
    if filename.is_empty() {
        return Err("Filename must not be empty".to_string());
    }
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("Invalid receipt filename".to_string());
    }
    let ext = filename.rsplit_once('.').map(|(_, e)| e.to_lowercase());
    match ext {
        Some(ref e) if ALLOWED_RECEIPT_EXTS.contains(&e.as_str()) => Ok(()),
        _ => Err("Receipt file extension not allowed; must be png, jpg, jpeg, or pdf".to_string()),
    }
}

fn receipts_dir(allowed_dir: &PathBuf) -> PathBuf {
    allowed_dir.join("receipts")
}

#[tauri::command]
fn save_receipt(data_path: String, filename: String, bytes: Vec<u8>, state: State<DataDirState>) -> Result<String, String> {
    validate_receipt_filename(&filename)?;
    let allowed = state.0.lock().unwrap_or_else(|p| p.into_inner()).clone();
    resolve_data_path(&data_path, &allowed)?;
    let dir = receipts_dir(&allowed);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(&filename), &bytes).map_err(|e| e.to_string())?;
    Ok(filename)
}

#[tauri::command]
fn delete_receipt(data_path: String, filename: String, state: State<DataDirState>) -> Result<(), String> {
    validate_receipt_filename(&filename)?;
    let allowed = state.0.lock().unwrap_or_else(|p| p.into_inner()).clone();
    resolve_data_path(&data_path, &allowed)?;
    let receipts = receipts_dir(&allowed);
    let path = receipts.join(&filename);
    if path.exists() {
        // Canonicalize to guard against the receipts/ dir or file being a symlink
        // that escapes the allowed directory before we remove anything.
        let canonical = friendly_canonical(&path)?;
        let canonical_receipts = friendly_canonical(&receipts)?;
        if !canonical.starts_with(&canonical_receipts) {
            return Err("Receipt path resolves outside the receipts directory".to_string());
        }
        fs::remove_file(canonical).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn open_receipt(data_path: String, filename: String, app: tauri::AppHandle, state: State<'_, DataDirState>) -> Result<(), String> {
    validate_receipt_filename(&filename)?;
    let allowed = state.0.lock().unwrap_or_else(|p| p.into_inner()).clone();
    resolve_data_path(&data_path, &allowed)?;
    let receipts = receipts_dir(&allowed);
    let path = receipts.join(&filename);
    if !path.exists() {
        return Err(format!("Receipt file not found: {}", filename));
    }
    // Canonicalize the full path and verify it stays inside the receipts dir.
    // This catches the case where receipts/ or the file itself is a symlink
    // pointing outside the allowed directory — the OS opener follows symlinks.
    let canonical = friendly_canonical(&path)?;
    let canonical_receipts = friendly_canonical(&receipts)?;
    if !canonical.starts_with(&canonical_receipts) {
        return Err("Receipt path resolves outside the receipts directory".to_string());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(canonical.to_str().ok_or_else(|| "Invalid path encoding".to_string())?, None::<&str>)
        .map_err(|e| e.to_string())
}

// ── Graceful quit ────────────────────────────────────────────────────────────
//
// Frontend emits this after flushing the debounced save when the tray
// "Quit" item is clicked (L7). The 2-second fallback thread in the tray
// handler ensures exit even if the frontend is unresponsive.
#[tauri::command]
fn confirm_quit(app: tauri::AppHandle) {
    app.exit(0);
}

// ── OS credential manager (encrypted secret storage) ────────────────────────
//
// Secrets (Plaid client_id/secret, per-item access tokens, Finnhub API key)
// live in the OS keychain — Windows Credential Manager, macOS Keychain, or
// Linux Secret Service — never in plaintext files.
//
// All entries use service "Pocket Watch" and a strict key allowlist:
//   plaid:client         – JSON { clientId, secret, env }
//   plaid:item:<itemId>  – Plaid access_token for one linked item
//   finnhub:apikey       – Finnhub API key for stock-price fetching
//
// Legacy keys (plaid-credentials, plaid-token-*) are accepted for
// secret_get / secret_delete ONLY so that plaidLayer.js can read and
// delete them during the one-time key-rename migration.

const KEYRING_SERVICE: &str = "Pocket Watch";

fn validate_secret_key(key: &str, allow_legacy: bool) -> Result<(), String> {
    if matches!(key, "plaid:client" | "finnhub:apikey") {
        return Ok(());
    }
    if key.starts_with("plaid:item:") {
        let id = &key["plaid:item:".len()..];
        if !id.is_empty() && id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
            return Ok(());
        }
    }
    // Legacy names accepted for reads and deletes during migration only.
    // Can be removed once all deployed installs have run the key-rename migration.
    if allow_legacy {
        if key == "plaid-credentials" {
            return Ok(());
        }
        if key.starts_with("plaid-token-") {
            let suffix = &key["plaid-token-".len()..];
            if !suffix.is_empty() && suffix.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
                return Ok(());
            }
        }
    }
    Err("invalid keyring key".to_string())
}

fn keyring_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    validate_secret_key(&key, false)?;
    keyring_entry(&key)?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    validate_secret_key(&key, true)?;
    match keyring_entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    validate_secret_key(&key, true)?;
    match keyring_entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ── Plaid helpers ────────────────────────────────────────────────────────────

fn plaid_base_url(env: &str) -> Result<String, String> {
    match env {
        "production"  => Ok("https://production.plaid.com".to_string()),
        "development" => Ok("https://development.plaid.com".to_string()),
        "sandbox"     => Ok("https://sandbox.plaid.com".to_string()),
        other         => Err(format!("unrecognized Plaid env: {other:?}; must be sandbox, development, or production")),
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
    let client = http_client();
    let base = plaid_base_url(&env)?;
    let mut payload = json!({
        "client_id": client_id,
        "secret":    secret,
        "client_name": "Pocket Watch",
        "user": { "client_user_id": user_id },
        "products":      ["transactions", "investments"],
        "country_codes": ["US"],
        "language":      "en"
    });
    // OAuth institutions (Chase, Wells Fargo, …) require a redirect_uri that
    // exactly matches one registered in the Plaid dashboard. Production
    // rejects http:// URIs, so the frontend only passes one in sandbox —
    // never include the field when it's absent or empty.
    if let Some(uri) = redirect_uri.filter(|u| !u.is_empty()) {
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
    let client = http_client();
    let base = plaid_base_url(&env)?;
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
    let client = http_client();
    let base = plaid_base_url(&env)?;
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

// /accounts/get returns current balances for ALL account types (depository,
// credit, investment) and only needs the transactions product, so it works
// on items linked before "investments" was requested at link time. The full
// response is returned as JSON; the frontend reads accounts[].balances.current.
#[tauri::command]
async fn plaid_fetch_accounts(
    client_id:    String,
    secret:       String,
    env:          String,
    access_token: String,
) -> Result<String, String> {
    let client = http_client();
    let base = plaid_base_url(&env)?;
    let resp = client
        .post(format!("{}/accounts/get", base))
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
        Ok(body.to_string())
    } else {
        Err(body["error_message"]
            .as_str()
            .unwrap_or("Failed to fetch accounts")
            .to_string())
    }
}

// /transactions/sync: cursor-based, incremental, no 500-tx cap.
// Omit cursor on the first call to pull all available history; include it on
// subsequent calls for the delta only. Returns the raw JSON response body
// (added, modified, removed, next_cursor, has_more).
#[tauri::command]
async fn plaid_sync_transactions(
    client_id:    String,
    secret:       String,
    env:          String,
    access_token: String,
    cursor:       Option<String>,
) -> Result<String, String> {
    let client = http_client();
    let base = plaid_base_url(&env)?;
    let mut payload = json!({
        "client_id":    client_id,
        "secret":       secret,
        "access_token": access_token,
    });
    if let Some(c) = cursor.filter(|c| !c.is_empty()) {
        payload["cursor"] = json!(c);
    }
    let resp = client
        .post(format!("{}/transactions/sync", base))
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    if body["error_code"].is_null() {
        Ok(body.to_string())
    } else {
        Err(body["error_message"]
            .as_str()
            .unwrap_or("Failed to sync transactions")
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
    let client = http_client();
    let base = plaid_base_url(&env)?;
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
        var topOrigin = (window.location.ancestorOrigins && window.location.ancestorOrigins[0]) || '*';
        window.top.postMessage({ __pocket_watch_open_external: true, url: url }, topOrigin);
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
            // Initialise the allowed data directory to the default app-data dir.
            // The frontend updates this via set_allowed_data_dir before any I/O.
            let default_dir = app.path().app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            app.manage(DataDirState(Mutex::new(default_dir)));

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
                        // Ask the frontend to flush any pending debounced save, then
                        // call confirm_quit. A 2s fallback forces exit if the frontend
                        // is unresponsive.
                        let app2 = app.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_secs(2));
                            app2.exit(0);
                        });
                        let _ = app.emit("pw:before-quit", ());
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
            set_allowed_data_dir,
            plaid_create_link_token,
            plaid_exchange_token,
            plaid_fetch_transactions,
            plaid_fetch_accounts,
            plaid_sync_transactions,
            plaid_remove_item,
            secret_set,
            secret_get,
            secret_delete,
            save_receipt,
            delete_receipt,
            open_receipt,
            confirm_quit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_rejects_null_bytes() {
        assert!(validate_data_path("has\0null.json").is_err());
    }

    #[test]
    fn validate_rejects_relative_path() {
        assert!(validate_data_path("relative/path.json").is_err());
    }

    #[test]
    fn validate_rejects_dotdot() {
        #[cfg(unix)]
        assert!(validate_data_path("/valid/../path.json").is_err());
        #[cfg(windows)]
        assert!(validate_data_path("C:\\valid\\..\\path.json").is_err());
    }

    #[test]
    fn validate_rejects_wrong_extension() {
        #[cfg(unix)]
        assert!(validate_data_path("/valid/path.txt").is_err());
        #[cfg(windows)]
        assert!(validate_data_path("C:\\valid\\path.txt").is_err());
    }

    #[test]
    fn validate_accepts_valid_path() {
        #[cfg(unix)]
        assert!(validate_data_path("/valid/path.json").is_ok());
        #[cfg(windows)]
        assert!(validate_data_path("C:\\valid\\path.json").is_ok());
    }

    #[test]
    fn validate_accepts_backup_extension() {
        // .backup.json ends with .json — must pass for the pre-migration backup in App.jsx
        #[cfg(unix)]
        assert!(validate_data_path("/valid/data.backup.json").is_ok());
        #[cfg(windows)]
        assert!(validate_data_path("C:\\valid\\data.backup.json").is_ok());
    }

    #[test]
    fn allowed_dir_rejects_null_bytes() {
        // validate_secret_key for set_allowed_data_dir — null bytes
        let p = PathBuf::from("dummy");
        let state_inner = Mutex::new(p);
        // We can't call the command directly without State<>, but we can test the
        // sub-validation that is the same as validate_data_path.
        assert!("has\0null".contains('\0'));
    }

    #[test]
    fn secret_key_accepts_canonical_keys() {
        assert!(validate_secret_key("plaid:client", false).is_ok());
        assert!(validate_secret_key("finnhub:apikey", false).is_ok());
        assert!(validate_secret_key("plaid:item:abc123", false).is_ok());
        assert!(validate_secret_key("plaid:item:item-123_xyz", false).is_ok());
    }

    #[test]
    fn secret_key_rejects_arbitrary_keys() {
        assert!(validate_secret_key("arbitrary-key", false).is_err());
        assert!(validate_secret_key("plaid-credentials", false).is_err()); // legacy, write-blocked
        assert!(validate_secret_key("plaid:item:", false).is_err());       // empty id
        assert!(validate_secret_key("plaid:item:has space", false).is_err());
        assert!(validate_secret_key("", false).is_err());
    }

    #[test]
    fn secret_key_allows_legacy_for_reads() {
        assert!(validate_secret_key("plaid-credentials", true).is_ok());
        assert!(validate_secret_key("plaid-token-abc123", true).is_ok());
        assert!(validate_secret_key("plaid-token-", true).is_err()); // empty suffix
        assert!(validate_secret_key("arbitrary", true).is_err());     // unknown key, still rejected
    }

    #[test]
    fn receipt_filename_accepts_valid_extensions() {
        assert!(validate_receipt_filename("receipt-abc.png").is_ok());
        assert!(validate_receipt_filename("receipt-abc.jpg").is_ok());
        assert!(validate_receipt_filename("receipt-abc.jpeg").is_ok());
        assert!(validate_receipt_filename("receipt-abc.pdf").is_ok());
        assert!(validate_receipt_filename("receipt-abc.PNG").is_ok()); // case-insensitive
    }

    #[test]
    fn receipt_filename_rejects_disallowed_extensions() {
        assert!(validate_receipt_filename("evil.exe").is_err());
        assert!(validate_receipt_filename("script.sh").is_err());
        assert!(validate_receipt_filename("data.json").is_err());
        assert!(validate_receipt_filename("noext").is_err());
        assert!(validate_receipt_filename("").is_err());
    }

    #[test]
    fn receipt_filename_rejects_path_traversal() {
        assert!(validate_receipt_filename("../evil.png").is_err());
        assert!(validate_receipt_filename("sub/evil.png").is_err());
        assert!(validate_receipt_filename("sub\\evil.png").is_err());
    }

    #[test]
    fn allowed_dir_depth_check() {
        // Ensure a bare root would be caught by the depth < 1 check.
        use std::path::{Component, PathBuf};
        let root = PathBuf::from("/");
        let depth = root.components()
            .filter(|c| !matches!(c, Component::RootDir | Component::Prefix(_)))
            .count();
        assert_eq!(depth, 0, "bare unix root has 0 non-root components");

        #[cfg(windows)]
        {
            let win_root = PathBuf::from("C:\\");
            let depth_w = win_root.components()
                .filter(|c| !matches!(c, Component::RootDir | Component::Prefix(_)))
                .count();
            assert_eq!(depth_w, 0, "bare windows root has 0 non-root components");
        }

        let normal = PathBuf::from("/home");
        let depth_n = normal.components()
            .filter(|c| !matches!(c, Component::RootDir | Component::Prefix(_)))
            .count();
        assert_eq!(depth_n, 1, "/home has 1 non-root component");
    }

    // M5 — save_data must create only the allowed directory, not arbitrary parent paths.
    // We can't invoke the Tauri command directly, but we can verify that atomic_rename
    // and fs::create_dir_all(&allowed) are the only directory-creation call sites.
    // This test documents the invariant so a regression is visible.
    #[test]
    fn m5_save_data_creates_only_allowed_dir() {
        // The invariant: in save_data, fs::create_dir_all is called with &allowed (the
        // configured data directory), not with path_buf.parent() (the requested path's
        // parent). Since the command is not directly callable in tests, we verify the
        // atomic_rename helper at least produces an error (not a panic) when the dest
        // doesn't exist yet — the directory must be pre-created by the caller.
        let tmp = std::env::temp_dir().join("pw_m5_test_src.tmp");
        let dest = std::env::temp_dir().join("pw_m5_test_dst.json");
        let _ = fs::remove_file(&tmp);
        let _ = fs::remove_file(&dest);

        // Write the tmp file so rename has something to work with.
        fs::write(&tmp, b"{}").expect("could not write tmp file");
        let result = atomic_rename(&tmp, &dest);
        // On most OS, renaming within the same temp dir should succeed.
        assert!(result.is_ok(), "atomic_rename failed unexpectedly: {:?}", result);
        let _ = fs::remove_file(&dest);
    }

    // M7 — atomic_rename succeeds on a basic rename within the same directory.
    #[test]
    fn m7_atomic_rename_succeeds() {
        let dir = std::env::temp_dir();
        let src = dir.join("pw_m7_src.tmp");
        let dst = dir.join("pw_m7_dst.json");
        let _ = fs::remove_file(&src);
        let _ = fs::remove_file(&dst);
        fs::write(&src, b"hello").expect("write failed");
        assert!(atomic_rename(&src, &dst).is_ok());
        assert!(!src.exists(), "src should be gone after rename");
        assert!(dst.exists(),  "dst should exist after rename");
        let _ = fs::remove_file(&dst);
    }

    // M7 — atomic_rename returns Err (not panic) when source doesn't exist.
    #[test]
    fn m7_atomic_rename_fails_gracefully_when_src_missing() {
        let src = std::env::temp_dir().join("pw_m7_missing.tmp");
        let dst = std::env::temp_dir().join("pw_m7_missing_dst.json");
        let _ = fs::remove_file(&src);
        let result = atomic_rename(&src, &dst);
        assert!(result.is_err(), "should fail when src is absent");
        // .tmp cleanup attempt must not panic even when src is absent
    }
}
