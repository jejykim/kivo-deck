// What the PC app does when the device hands an action over ({"ev":"act"}) or a fader moves.
// The table is built by app/src/bundle.ts and replaced on every "적용".
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::actions::{Executor, Op};
use crate::device::DeviceState;
use crate::{obs, system};

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeKey {
    tap: Option<Op>,
    long: Option<Op>,
    double: Option<Op>,
    off_tap: Option<Op>,
}

#[derive(Deserialize, Default, Clone)]
pub struct RuntimePage {
    keys: Vec<RuntimeKey>,
}

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeKnob {
    cw: Option<Op>,
    ccw: Option<Op>,
    press: Option<Op>,
    press_cw: Option<Op>,
    press_ccw: Option<Op>,
}

#[derive(Deserialize, Default, Clone)]
pub struct AppRule {
    process: String,
    page: usize,
}

#[derive(Deserialize, Default, Clone)]
pub struct ObsSettings {
    host: String,
    port: u16,
    password: String,
}

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    pages: Vec<RuntimePage>,
    knobs: Vec<RuntimeKnob>,
    faders: Vec<Option<Op>>,
    app_rules: Vec<AppRule>,
    auto_switch: bool,
    obs: ObsSettings,
}

#[derive(Clone)]
pub struct RuntimeState {
    table: Arc<Mutex<Runtime>>,
    exec: Executor,
}

impl RuntimeState {
    pub fn new(app: AppHandle) -> Self {
        RuntimeState { table: Arc::default(), exec: Executor::start(app) }
    }

    pub fn set(&self, rt: Runtime) {
        obs::configure(obs::ObsConfig { host: rt.obs.host.clone(), port: rt.obs.port, password: rt.obs.password.clone() });
        *self.table.lock().unwrap() = rt;
    }

    pub fn on_device_event(&self, v: &Value) {
        let t = self.table.lock().unwrap();
        match v["ev"].as_str() {
            Some("act") => {
                let id = v["id"].as_u64().unwrap_or(0) as usize;
                let kind = v["kind"].as_str().unwrap_or("");
                let op = if v["src"] == "knob" {
                    t.knobs.get(id).and_then(|k| match kind {
                        "cw" => k.cw.clone(),
                        "ccw" => k.ccw.clone(),
                        "pr" => k.press.clone(),
                        "pcw" => k.press_cw.clone(),
                        "pccw" => k.press_ccw.clone(),
                        _ => None,
                    })
                } else {
                    let page = v["page"].as_u64().unwrap_or(0) as usize;
                    t.pages.get(page).and_then(|p| p.keys.get(id)).and_then(|k| match kind {
                        "tap" => k.tap.clone(),
                        "long" => k.long.clone(),
                        "dbl" => k.double.clone(),
                        "off" => k.off_tap.clone(),
                        _ => None,
                    })
                };
                if let Some(op) = op {
                    let n = v["n"].as_u64().unwrap_or(1).clamp(1, 10);
                    for _ in 0..n {
                        self.exec.run(op.clone());
                    }
                }
            }
            Some("fader") => {
                let id = v["id"].as_u64().unwrap_or(0) as usize;
                if let (Some(Some(op)), Some(value)) = (t.faders.get(id), v["value"].as_i64()) {
                    self.exec.fader(op.clone(), value as i32);
                }
            }
            _ => {}
        }
    }

    // Watches the program in front and switches the device page when a rule matches
    pub fn start_auto_switch(&self, app: AppHandle, device: DeviceState) {
        let table = self.table.clone();
        thread::spawn(move || {
            let mut last = String::new();
            loop {
                thread::sleep(Duration::from_millis(700));
                let Some(fg) = system::foreground_process() else { continue };
                if fg == last {
                    continue;
                }
                last = fg.clone();
                let _ = app.emit("foreground", &fg);
                let t = table.lock().unwrap();
                if !t.auto_switch {
                    continue;
                }
                if let Some(rule) = t.app_rules.iter().find(|r| system::same_app(&r.process, &fg)) {
                    let _ = device.send(json!({ "cmd": "page", "n": rule.page }).to_string());
                }
            }
        });
    }
}

#[tauri::command]
pub fn set_runtime(state: tauri::State<RuntimeState>, json: String) -> Result<(), String> {
    let rt: Runtime = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    state.set(rt);
    Ok(())
}
