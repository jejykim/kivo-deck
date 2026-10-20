// System / microphone / per-app volume.
// Windows: Core Audio (per-app through IAudioSessionManager2). Mac: osascript, no per-app volume.

#[cfg(windows)]
mod imp {
    use crate::system::process_name;
    use windows::core::{Interface, Result};
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;

    pub fn init_thread() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
    }

    fn endpoint(flow: EDataFlow) -> Result<IMMDevice> {
        unsafe {
            let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            en.GetDefaultAudioEndpoint(flow, eConsole)
        }
    }

    fn endpoint_volume(flow: EDataFlow) -> Result<IAudioEndpointVolume> {
        unsafe { endpoint(flow)?.Activate(CLSCTX_ALL, None) }
    }

    pub fn set_system_volume(v: f32) -> Result<()> {
        unsafe { endpoint_volume(eRender)?.SetMasterVolumeLevelScalar(v, std::ptr::null()) }
    }

    pub fn set_mic_volume(v: f32) -> Result<()> {
        unsafe { endpoint_volume(eCapture)?.SetMasterVolumeLevelScalar(v, std::ptr::null()) }
    }

    pub fn toggle_mic_mute() -> Result<()> {
        unsafe {
            let vol = endpoint_volume(eCapture)?;
            let muted = vol.GetMute()?.as_bool();
            vol.SetMute(!muted, std::ptr::null())
        }
    }

    fn same_process(a: &str, b: &str) -> bool {
        let norm = |s: &str| s.trim().to_lowercase().trim_end_matches(".exe").to_string();
        !a.trim().is_empty() && norm(a) == norm(b)
    }

    // Calls f with every audio session of `process` on the default output device
    fn for_sessions(process: &str, mut f: impl FnMut(&ISimpleAudioVolume) -> Result<()>) -> Result<bool> {
        unsafe {
            let mgr: IAudioSessionManager2 = endpoint(eRender)?.Activate(CLSCTX_ALL, None)?;
            let list = mgr.GetSessionEnumerator()?;
            let mut found = false;
            for i in 0..list.GetCount()? {
                let ctl = list.GetSession(i)?;
                let ctl2: IAudioSessionControl2 = ctl.cast()?;
                let pid = ctl2.GetProcessId().unwrap_or(0);
                if pid == 0 { continue; }
                if process_name(pid).map(|n| same_process(process, &n)).unwrap_or(false) {
                    f(&ctl.cast::<ISimpleAudioVolume>()?)?;
                    found = true;
                }
            }
            Ok(found)
        }
    }

    // exe names of the programs with an audio session on the default output device
    pub fn session_processes() -> Result<Vec<String>> {
        unsafe {
            let mgr: IAudioSessionManager2 = endpoint(eRender)?.Activate(CLSCTX_ALL, None)?;
            let list = mgr.GetSessionEnumerator()?;
            let mut out = Vec::new();
            for i in 0..list.GetCount()? {
                let ctl2: IAudioSessionControl2 = list.GetSession(i)?.cast()?;
                let pid = ctl2.GetProcessId().unwrap_or(0);
                if let Some(n) = (pid != 0).then(|| process_name(pid)).flatten() {
                    if !out.contains(&n) { out.push(n); }
                }
            }
            Ok(out)
        }
    }

    pub fn set_app_volume(process: &str, v: f32) -> Result<bool> {
        for_sessions(process, |s| unsafe { s.SetMasterVolume(v, std::ptr::null()) })
    }

    pub fn step_app_volume(process: &str, step: i32) -> Result<bool> {
        for_sessions(process, |s| unsafe {
            let v = (s.GetMasterVolume()? + step as f32 / 100.0).clamp(0.0, 1.0);
            s.SetMasterVolume(v, std::ptr::null())
        })
    }
}

#[cfg(windows)]
pub fn init_thread() {
    imp::init_thread();
}
#[cfg(windows)]
pub fn session_processes() -> Vec<String> {
    init_thread();
    imp::session_processes().unwrap_or_default()
}
#[cfg(windows)]
pub fn set_system_volume(v: f32) -> Result<(), String> {
    imp::set_system_volume(v).map_err(|e| e.to_string())
}
#[cfg(windows)]
pub fn set_mic_volume(v: f32) -> Result<(), String> {
    imp::set_mic_volume(v).map_err(|e| e.to_string())
}
#[cfg(windows)]
pub fn toggle_mic_mute() -> Result<(), String> {
    imp::toggle_mic_mute().map_err(|e| e.to_string())
}
#[cfg(windows)]
pub fn set_app_volume(process: &str, v: f32) -> Result<(), String> {
    // the app may not be playing sound right now: not an error
    imp::set_app_volume(process, v).map(|_| ()).map_err(|e| e.to_string())
}
#[cfg(windows)]
pub fn step_app_volume(process: &str, step: i32) -> Result<(), String> {
    imp::step_app_volume(process, step).map(|_| ()).map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ macOS
#[cfg(not(windows))]
fn osascript(script: &str) -> Result<String, String> {
    let out = std::process::Command::new("osascript").args(["-e", script]).output().map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}
#[cfg(not(windows))]
pub fn init_thread() {}
#[cfg(not(windows))]
pub fn session_processes() -> Vec<String> {
    vec![]
}
#[cfg(not(windows))]
pub fn set_system_volume(v: f32) -> Result<(), String> {
    osascript(&format!("set volume output volume {}", (v * 100.0).round() as i32)).map(|_| ())
}
#[cfg(not(windows))]
pub fn set_mic_volume(v: f32) -> Result<(), String> {
    osascript(&format!("set volume input volume {}", (v * 100.0).round() as i32)).map(|_| ())
}
#[cfg(not(windows))]
pub fn toggle_mic_mute() -> Result<(), String> {
    use std::sync::Mutex;
    static LAST: Mutex<i32> = Mutex::new(70);
    let cur: i32 = osascript("input volume of (get volume settings)")?.parse().unwrap_or(0);
    if cur > 0 {
        *LAST.lock().unwrap() = cur;
        osascript("set volume input volume 0").map(|_| ())
    } else {
        let v = *LAST.lock().unwrap();
        osascript(&format!("set volume input volume {v}")).map(|_| ())
    }
}
#[cfg(not(windows))]
pub fn set_app_volume(_process: &str, _v: f32) -> Result<(), String> {
    Err("Mac에서는 앱별 볼륨을 지원하지 않아요".into())
}
#[cfg(not(windows))]
pub fn step_app_volume(_process: &str, _step: i32) -> Result<(), String> {
    Err("Mac에서는 앱별 볼륨을 지원하지 않아요".into())
}
