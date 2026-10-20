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
    out
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
