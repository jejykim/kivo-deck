// Programs installed on this PC, for the "앱 실행" and per-app volume pickers.
// Windows: Start menu shortcuts (.lnk) with their target exe. Mac: .app bundles in the Applications folders.
use serde::Serialize;
use std::path::PathBuf;
#[cfg(windows)]
use std::path::Path;

#[derive(Serialize, Clone)]
pub struct AppEntry {
    pub name: String,
    pub path: String,        // what "앱 실행" opens (shortcut or .app)
    pub exe: Option<String>, // process name used to match audio sessions / the app in front
}

fn skip_name(name: &str) -> bool {
    let n = name.to_lowercase();
    ["uninstall", "제거", "readme", "help", "도움말", "website", "license"].iter().any(|w| n.contains(w))
}

#[cfg(windows)]
fn shortcut_target(lnk: &Path) -> Option<String> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::*;
    use windows::Win32::UI::Shell::*;
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let file: IPersistFile = link.cast().ok()?;
        file.Load(&HSTRING::from(lnk.as_os_str()), STGM_READ).ok()?;
        let mut buf = [0u16; 520];
        link.GetPath(&mut buf, std::ptr::null_mut(), 0).ok()?;
        let len = buf.iter().position(|&c| c == 0).unwrap_or(0);
        if len == 0 { None } else { Some(String::from_utf16_lossy(&buf[..len])) }
    }
}

#[cfg(windows)]
fn walk(dir: &Path, out: &mut Vec<AppEntry>, depth: u32) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() && depth < 4 {
            walk(&p, out, depth + 1);
        } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("lnk")) {
            let name = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            if skip_name(&name) { continue; }
            let target = shortcut_target(&p);
            // keep only shortcuts to programs (not to web pages or documents)
            if let Some(t) = &target {
                if !t.to_lowercase().ends_with(".exe") { continue; }
            }
            let exe = target.as_ref().and_then(|t| Path::new(t).file_name()).map(|f| f.to_string_lossy().to_string());
            out.push(AppEntry { name, path: p.to_string_lossy().to_string(), exe });
        }
    }
}

#[cfg(windows)]
fn list() -> Vec<AppEntry> {
    use windows::Win32::System::Com::*;
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    let mut out = Vec::new();
    let roots: Vec<PathBuf> = [std::env::var("ProgramData").ok(), std::env::var("APPDATA").ok()]
        .into_iter()
        .flatten()
        .map(|b| PathBuf::from(b).join("Microsoft\\Windows\\Start Menu\\Programs"))
        .collect();
    for r in roots {
        walk(&r, &mut out, 0);
    }
    // Store / MSIX apps (Claude, ...) have no .lnk: take the full Start menu list and open them
    // through shell:AppsFolder. Shortcut entries win because they know the exe name.
    for (name, id) in start_apps() {
        if skip_name(&name) || id.starts_with("http") || out.iter().any(|a| a.name.eq_ignore_ascii_case(&name)) {
            continue;
        }
        let exe = id.to_lowercase().ends_with(".exe").then(|| id.rsplit(['\\', '/']).next().unwrap_or("").to_string());
        out.push(AppEntry { name, path: format!("shell:AppsFolder\\{id}"), exe });
    }
    out
}

// (Name, AppID) of every Start menu entry, from PowerShell's Get-StartApps
#[cfg(windows)]
fn start_apps() -> Vec<(String, String)> {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command",
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress"])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output();
    let Ok(out) = out else { return vec![] };
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(&out.stdout) else { return vec![] };
    let items = if v.is_array() { v.as_array().cloned().unwrap_or_default() } else { vec![v] };
    items
        .iter()
        .filter_map(|i| Some((i["Name"].as_str()?.to_string(), i["AppID"].as_str()?.to_string())))
        .collect()
}

#[cfg(not(windows))]
fn list() -> Vec<AppEntry> {
    let mut out = Vec::new();
    let mut dirs = vec![PathBuf::from("/Applications"), PathBuf::from("/Applications/Utilities"), PathBuf::from("/System/Applications")];
    if let Ok(home) = std::env::var("HOME") {
        dirs.push(PathBuf::from(home).join("Applications"));
    }
    for d in dirs {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "app") {
                let name = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                if skip_name(&name) { continue; }
                out.push(AppEntry { name: name.clone(), path: p.to_string_lossy().to_string(), exe: Some(name) });
            }
        }
    }
    out
}

// The shortcut / .app of the first installed app whose name matches (exact name first, then "contains")
#[cfg_attr(not(windows), allow(dead_code))]
pub fn find(names: &[String]) -> Option<String> {
    use std::sync::Mutex;
    static CACHE: Mutex<Option<Vec<AppEntry>>> = Mutex::new(None);
    let mut guard = CACHE.lock().unwrap();
    let apps = guard.get_or_insert_with(list);
    let lower: Vec<String> = names.iter().map(|n| n.to_lowercase()).collect();
    for n in &lower {
        if let Some(a) = apps.iter().find(|a| a.name.to_lowercase() == *n) {
            return Some(a.path.clone());
        }
    }
    for n in &lower {
        if let Some(a) = apps.iter().find(|a| a.name.to_lowercase().contains(n.as_str())) {
            return Some(a.path.clone());
        }
    }
    None
}

#[tauri::command]
pub async fn installed_apps() -> Vec<AppEntry> {
    let mut apps = tauri::async_runtime::spawn_blocking(list).await.unwrap_or_default();
    apps.sort_by_key(|a| a.name.to_lowercase());
    apps.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
    apps
}

// Programs that have an audio session right now (Windows only; empty on Mac)
#[tauri::command]
pub async fn audio_apps() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(crate::audio::session_processes).await.unwrap_or_default()
}


#[cfg(test)]
mod tests {
    #[test]
    fn lists_apps() {
        let apps = tauri::async_runtime::block_on(super::installed_apps());
        println!("{} apps", apps.len());
        for a in apps.iter().take(8) {
            println!("{} | {:?}", a.name, a.exe);
        }
        println!("audio: {:?}", tauri::async_runtime::block_on(super::audio_apps()));
    }
}

#[cfg(test)]
mod find_tests {
    #[test]
    fn finds_packs() {
        let packs: &[&[&str]] = &[
            &["Adobe Premiere Pro 2026", "Adobe Premiere Pro", "Premiere Pro"], &["Figma"], &["Claude"], &["ChatGPT"],
            &["DeepSeek Harness", "Harness"], &["Ollama"], &["Visual Studio Code", "Code"], &["Antigravity"], &["ComfyUI", "Comfy Desktop"], &["Steam"],
        ];
        for names in packs {
            let v: Vec<String> = names.iter().map(|s| s.to_string()).collect();
            println!("{:<26} -> {:?}", names[0], super::find(&v).map(|p| p.rsplit(['\\', '/']).next().unwrap_or("").to_string()));
        }
    }
}
