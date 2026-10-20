// Which program is in front, CPU / memory for live keys, and process names.
use serde::Serialize;
use std::sync::Mutex;
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

#[cfg(windows)]
pub fn process_name(pid: u32) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::*;
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 520];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(h);
        ok.ok()?;
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit('\\').next().map(str::to_string)
    }
}

// File name of the program that owns the focused window, e.g. "Photoshop.exe"
#[cfg(windows)]
pub fn foreground_process() -> Option<String> {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 { None } else { process_name(pid) }
    }
}

// Name of the frontmost app, e.g. "Adobe Photoshop 2026"
#[cfg(not(windows))]
pub fn foreground_process() -> Option<String> {
    let out = std::process::Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to get name of first application process whose frontmost is true"])
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

pub fn same_app(rule: &str, running: &str) -> bool {
    let norm = |s: &str| s.trim().to_lowercase().trim_end_matches(".exe").trim_end_matches(".app").to_string();
    let (r, n) = (norm(rule), norm(running));
    !r.is_empty() && (r == n || n.contains(&r))
}

#[derive(Serialize)]
pub struct Stats {
    cpu: f32,
    mem: f32,
    gpus: Vec<crate::gpu::GpuUsage>,
}

static SYS: Mutex<Option<System>> = Mutex::new(None);

#[tauri::command]
pub fn system_stats() -> Stats {
    let mut guard = SYS.lock().unwrap();
    let sys = guard.get_or_insert_with(|| {
        System::new_with_specifics(RefreshKind::nothing().with_cpu(CpuRefreshKind::nothing().with_cpu_usage()).with_memory(MemoryRefreshKind::nothing().with_ram()))
    });
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    let mem = if sys.total_memory() > 0 { sys.used_memory() as f32 / sys.total_memory() as f32 * 100.0 } else { 0.0 };
    Stats { cpu: sys.global_cpu_usage(), mem, gpus: crate::gpu::read() }
}

#[tauri::command]
pub fn foreground_app() -> Option<String> {
    foreground_process()
}
