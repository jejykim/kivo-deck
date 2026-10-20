// Default sound output / input device (earphones, speakers, mics).
// Windows has no public API for changing it; every tool uses the undocumented IPolicyConfig
// (the same one the Sound control panel uses). Mac: not supported yet (needs CoreAudio).
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub default: bool,
}

#[cfg(windows)]
mod imp {
    #![allow(non_snake_case)]
    use super::AudioDevice;
    use windows::core::{interface, IUnknown, IUnknown_Vtbl, Interface, GUID, HRESULT, PCWSTR, Result};
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;

    #[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
    unsafe trait IPolicyConfig: IUnknown {
        fn GetMixFormat(&self, id: PCWSTR, fmt: *mut *mut u8) -> HRESULT;
        fn GetDeviceFormat(&self, id: PCWSTR, default: i32, fmt: *mut *mut u8) -> HRESULT;
        fn ResetDeviceFormat(&self, id: PCWSTR) -> HRESULT;
        fn SetDeviceFormat(&self, id: PCWSTR, endpoint: *mut u8, mix: *mut u8) -> HRESULT;
        fn GetProcessingPeriod(&self, id: PCWSTR, default: i32, def: *mut i64, min: *mut i64) -> HRESULT;
        fn SetProcessingPeriod(&self, id: PCWSTR, period: *mut i64) -> HRESULT;
        fn GetShareMode(&self, id: PCWSTR, mode: *mut u8) -> HRESULT;
        fn SetShareMode(&self, id: PCWSTR, mode: *mut u8) -> HRESULT;
        fn GetPropertyValue(&self, id: PCWSTR, key: *const u8, value: *mut u8) -> HRESULT;
        fn SetPropertyValue(&self, id: PCWSTR, key: *const u8, value: *mut u8) -> HRESULT;
        fn SetDefaultEndpoint(&self, id: PCWSTR, role: ERole) -> HRESULT;
        fn SetEndpointVisibility(&self, id: PCWSTR, visible: i32) -> HRESULT;
    }
    const CLSID_POLICY_CONFIG: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

    fn flow_of(input: bool) -> EDataFlow {
        if input { eCapture } else { eRender }
    }

    unsafe fn id_of(d: &IMMDevice) -> Result<String> {
        unsafe {
            let p = d.GetId()?;
            let s = p.to_string().unwrap_or_default();
            CoTaskMemFree(Some(p.0 as _));
            Ok(s)
        }
    }

    pub fn list(input: bool) -> Result<Vec<AudioDevice>> {
        unsafe {
            let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let default = en.GetDefaultAudioEndpoint(flow_of(input), eConsole).ok().and_then(|d| id_of(&d).ok()).unwrap_or_default();
            let col = en.EnumAudioEndpoints(flow_of(input), DEVICE_STATE_ACTIVE)?;
            let mut out = Vec::new();
            for i in 0..col.GetCount()? {
                let d = col.Item(i)?;
                let id = id_of(&d)?;
                let name = d
                    .OpenPropertyStore(STGM_READ)
                    .and_then(|st| st.GetValue(&PKEY_Device_FriendlyName))
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| id.clone());
                out.push(AudioDevice { default: id == default, id, name });
            }
            Ok(out)
        }
    }

    pub fn set_default(id: &str) -> Result<()> {
        unsafe {
            let pc: IPolicyConfig = CoCreateInstance(&CLSID_POLICY_CONFIG, None, CLSCTX_ALL)?;
            let wide: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
            for role in [eConsole, eMultimedia, eCommunications] {
                pc.SetDefaultEndpoint(PCWSTR(wide.as_ptr()), role).ok()?;
            }
            Ok(())
        }
    }

    // keep Interface in use for the macro-generated code
    #[allow(dead_code)]
    fn _iid() -> GUID { IPolicyConfig::IID }
}

#[cfg(windows)]
pub fn list(input: bool) -> Vec<AudioDevice> {
    crate::audio::init_thread();
    imp::list(input).unwrap_or_default()
}

#[cfg(windows)]
pub fn set_default(id: &str) -> Result<(), String> {
    imp::set_default(id).map_err(|e| format!("소리 장치를 바꿀 수 없어요: {e}"))
}

// Switches to the next active device after the current default
#[cfg(windows)]
pub fn next(input: bool) -> Result<(), String> {
    let list = list(input);
    if list.len() < 2 {
        return Err("바꿀 다른 소리 장치가 없어요".into());
    }
    let cur = list.iter().position(|d| d.default).unwrap_or(0);
    set_default(&list[(cur + 1) % list.len()].id)
}

#[cfg(not(windows))]
pub fn list(_input: bool) -> Vec<AudioDevice> {
    vec![]
}
#[cfg(not(windows))]
pub fn set_default(_id: &str) -> Result<(), String> {
    Err("Mac에서는 아직 소리 장치 바꾸기를 지원하지 않아요".into())
}
#[cfg(not(windows))]
pub fn next(_input: bool) -> Result<(), String> {
    Err("Mac에서는 아직 소리 장치 바꾸기를 지원하지 않아요".into())
}

#[tauri::command]
pub async fn audio_devices(input: bool) -> Vec<AudioDevice> {
    tauri::async_runtime::spawn_blocking(move || list(input)).await.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    #[test]
    fn lists_devices() {
        for d in super::list(false) { println!("OUT {} {}", if d.default { "*" } else { " " }, d.name); }
        for d in super::list(true) { println!("IN  {} {}", if d.default { "*" } else { " " }, d.name); }
    }
}
