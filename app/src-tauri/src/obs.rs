// OBS Studio through obs-websocket v5 (built into OBS 28+). One connection, reopened on failure.
use obws::requests::inputs::{InputId, Volume};
use obws::requests::scenes::SceneId;
use obws::Client;
use std::sync::Mutex;

#[derive(Clone, PartialEq, Default)]
pub struct ObsConfig {
    pub host: String,
    pub port: u16,
    pub password: String,
}

static CONFIG: Mutex<Option<ObsConfig>> = Mutex::new(None);
static CLIENT: tokio::sync::Mutex<Option<Client>> = tokio::sync::Mutex::const_new(None);

pub fn configure(cfg: ObsConfig) {
    let mut cur = CONFIG.lock().unwrap();
    if cur.as_ref() != Some(&cfg) {
        *cur = Some(cfg);
        // drop the old connection; the next request reconnects with the new settings
        tauri::async_runtime::block_on(async { *CLIENT.lock().await = None });
    }
}

// value: fader position 0..1 for "volume"
pub fn request(req: &str, arg: &str, value: Option<f32>) -> Result<(), String> {
    let cfg = CONFIG.lock().unwrap().clone().ok_or("OBS 설정이 없어요")?;
    tauri::async_runtime::block_on(async move {
        let mut guard = CLIENT.lock().await;
        if guard.is_none() {
            let pw = (!cfg.password.is_empty()).then_some(cfg.password.as_str());
            let c = Client::connect(&cfg.host, cfg.port, pw)
                .await
                .map_err(|e| format!("OBS에 연결할 수 없어요 ({e}). OBS가 켜져 있고 WebSocket 서버가 켜져 있는지 확인해 주세요"))?;
            *guard = Some(c);
        }
        let c = guard.as_ref().unwrap();
        let r = match req {
            "scene" => c.scenes().set_current_program_scene(SceneId::Name(arg)).await,
            "toggleRecord" => c.recording().toggle().await.map(|_| ()),
            "toggleRecordPause" => c.recording().toggle_pause().await.map(|_| ()),
            "toggleStream" => c.streaming().toggle().await.map(|_| ()),
            "toggleMute" => c.inputs().toggle_mute(InputId::Name(arg)).await.map(|_| ()),
            "toggleVirtualCam" => c.virtual_cam().toggle().await.map(|_| ()),
            "saveReplay" => c.replay_buffer().save().await,
            "volume" => {
                // fader 0..1 -> -60..0 dB, bottom = silent
                let v = value.unwrap_or(0.0);
                let mul = if v <= 0.001 { 0.0 } else { 10f32.powf((-60.0 + 60.0 * v) / 20.0) };
                c.inputs().set_volume(InputId::Name(arg), Volume::Mul(mul)).await
            }
            _ => Ok(()),
        };
        if let Err(e) = r {
            *guard = None; // reconnect next time
            return Err(format!("OBS 요청 실패: {e}"));
        }
        Ok(())
    })
}
