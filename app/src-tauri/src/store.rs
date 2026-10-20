// Settings file and media files in the app data folder
// (Windows: %APPDATA%\lab.kivo.deck, Mac: ~/Library/Application Support/lab.kivo.deck)
use base64::{engine::general_purpose::STANDARD, Engine};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("media")).map_err(|e| e.to_string())?;
    Ok(dir)
}

// Media names come from the web side; allow only plain file names
fn media_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        return Err("잘못된 파일 이름".into());
    }
    Ok(data_dir(app)?.join("media").join(name))
}

#[tauri::command]
pub fn host_os() -> &'static str {
    if cfg!(target_os = "macos") { "mac" } else { "windows" }
}

#[tauri::command]
pub fn load_store(app: AppHandle) -> Result<Option<String>, String> {
    let p = data_dir(&app)?.join("store.json");
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_store(app: AppHandle, json: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    // write then rename so a crash never leaves a half-written file
    let tmp = dir.join("store.json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(tmp, dir.join("store.json")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_media(app: AppHandle, name: String, b64: String) -> Result<(), String> {
    let bytes = STANDARD.decode(b64).map_err(|e| e.to_string())?;
    fs::write(media_path(&app, &name)?, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_media(app: AppHandle, name: String) -> Result<String, String> {
    let bytes = fs::read(media_path(&app, &name)?).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
pub fn delete_media(app: AppHandle, name: String) -> Result<(), String> {
    let p = media_path(&app, &name)?;
    if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Export / import of preset files at a path the user picked in a save/open dialog
#[tauri::command]
pub fn write_text_file(path: String, text: String) -> Result<(), String> {
    fs::write(path, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}
