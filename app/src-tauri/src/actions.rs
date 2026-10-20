// Executes PC-side operations (`Op`, built by app/src/catalog.ts) on one worker thread.
// Hotkey strings use the same names as app/src/keys.ts.
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use serde::Deserialize;
use std::sync::mpsc::{channel, Sender};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::{audio, obs};

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Op {
    Hotkey { keys: String },
    Text { text: String },
    Delay { ms: u64 },
    Open { target: String },
    Media { key: String },
    MicMute,
    Volume { target: String, process: Option<String>, step: Option<i32> },
    Obs { req: String, arg: Option<String> },
    Sound {
        #[serde(rename = "mediaId")]
        media_id: String,
    },
    Timer { cmd: String },
    Seq { steps: Vec<Op> },
    LaunchApp { names: Vec<String> },     // open an installed app by name (or bring it to the front)
    Terminal { command: String },         // run a command in a new terminal window
    Exec { program: String, args: Vec<String> }, // run a program without a window
    AudioDevice { id: String },           // make this the default sound device
    AudioNext { input: bool },            // next output (or input) device
    Http { method: String, url: String, body: Option<String> }, // e.g. ComfyUI /interrupt
}

pub enum Job {
    Run(Op),
    Fader(Op, i32), // value 0..1000
}

#[derive(Clone)]
pub struct Executor {
    tx: Sender<Job>,
}

impl Executor {
    pub fn start(app: AppHandle) -> Self {
        let (tx, rx) = channel::<Job>();
        thread::spawn(move || {
            audio::init_thread();
            let mut enigo = Enigo::new(&Settings::default()).ok();
            while let Ok(mut job) = rx.recv() {
                // faders send many values: only the newest one matters
                while let Ok(next) = rx.try_recv() {
                    match (&job, &next) {
                        (Job::Fader(..), Job::Fader(..)) => job = next,
                        _ => {
                            run_job(&app, enigo.as_mut(), job);
                            job = next;
                        }
                    }
                }
                run_job(&app, enigo.as_mut(), job);
            }
        });
        Executor { tx }
    }
    pub fn run(&self, op: Op) {
        let _ = self.tx.send(Job::Run(op));
    }
    pub fn fader(&self, op: Op, value: i32) {
        let _ = self.tx.send(Job::Fader(op, value));
    }
}

fn run_job(app: &AppHandle, enigo: Option<&mut Enigo>, job: Job) {
    let result = match job {
        Job::Run(op) => run_op(app, enigo, &op),
        Job::Fader(op, v) => fader_op(&op, v),
    };
    if let Err(e) = result {
        let _ = app.emit("action-error", e);
    }
}

fn run_op(app: &AppHandle, mut enigo: Option<&mut Enigo>, op: &Op) -> Result<(), String> {
    match op {
        Op::Hotkey { keys } => hotkey(enigo.ok_or("키 입력을 쓸 수 없어요")?, keys),
        Op::Text { text } => enigo.ok_or("키 입력을 쓸 수 없어요")?.text(text).map_err(|e| e.to_string()),
        Op::Delay { ms } => {
            thread::sleep(Duration::from_millis((*ms).min(10_000)));
            Ok(())
        }
        Op::Open { target } => open(target),
        Op::Media { key } => media(enigo.ok_or("키 입력을 쓸 수 없어요")?, key),
        Op::MicMute => audio::toggle_mic_mute(),
        Op::Volume { target, process, step } => match target.as_str() {
            "app" => audio::step_app_volume(process.as_deref().unwrap_or(""), step.unwrap_or(2)),
            _ => Ok(()),
        },
        Op::Obs { req, arg } => obs::request(req, arg.as_deref().unwrap_or(""), None),
        Op::Sound { media_id } => app.emit("play-sound", media_id).map_err(|e| e.to_string()),
        Op::Timer { cmd } => app.emit("timer", cmd).map_err(|e| e.to_string()),
        Op::LaunchApp { names } => launch_app(names),
        Op::Terminal { command } => terminal(command),
        Op::Exec { program, args } => std::process::Command::new(program).args(args).spawn().map(|_| ()).map_err(|e| format!("{program} 실행 실패: {e}")),
        Op::AudioDevice { id } => crate::audio_device::set_default(id),
        Op::AudioNext { input } => crate::audio_device::next(*input),
        Op::Http { method, url, body } => http(method, url, body.as_deref()),
        Op::Seq { steps } => {
            for s in steps {
                run_op(app, enigo.as_deref_mut(), s)?;
                thread::sleep(Duration::from_millis(15));
            }
            Ok(())
        }
    }
}

fn fader_op(op: &Op, value: i32) -> Result<(), String> {
    let v = (value.clamp(0, 1000) as f32) / 1000.0;
    match op {
        Op::Volume { target, process, .. } => match target.as_str() {
            "system" => audio::set_system_volume(v),
            "mic" => audio::set_mic_volume(v),
            "app" => audio::set_app_volume(process.as_deref().unwrap_or(""), v),
            _ => Ok(()),
        },
        Op::Obs { req, arg } => obs::request(req, arg.as_deref().unwrap_or(""), Some(v)),
        _ => Ok(()),
    }
}

fn open(target: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Store apps from the Start menu list
        if target.starts_with("shell:") {
            return std::process::Command::new("explorer.exe").arg(target).spawn().map(|_| ()).map_err(|e| e.to_string());
        }
        // `start` resolves programs, files, folders and URLs the same way Explorer does
        std::process::Command::new("cmd")
            .args(["/C", "start", "", target])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("open").arg(target).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

fn launch_app(names: &[String]) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let path = crate::apps::find(names).ok_or_else(|| format!("{}을(를) 찾을 수 없어요. 설치되어 있는지 확인해 주세요", names.first().map(String::as_str).unwrap_or("앱")))?;
        open(&path)
    }
    #[cfg(not(target_os = "windows"))]
    {
        for n in names {
            if std::process::Command::new("open").args(["-a", n]).status().map(|s| s.success()).unwrap_or(false) {
                return Ok(());
            }
        }
        Err(format!("{}을(를) 찾을 수 없어요", names.first().map(String::as_str).unwrap_or("앱")))
    }
}

fn http(method: &str, url: &str, body: Option<&str>) -> Result<(), String> {
    let agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(5))).build().new_agent();
    let r = if method.eq_ignore_ascii_case("GET") {
        agent.get(url).call()
    } else {
        agent.post(url).header("Content-Type", "application/json").send(body.unwrap_or("{}"))
    };
    r.map(|_| ()).map_err(|e| format!("{url} 요청 실패: {e}"))
}

fn terminal(command: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd").args(["/C", "start", "", "cmd", "/K", command]).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!("tell application \"Terminal\"\nactivate\ndo script \"{escaped}\"\nend tell");
        std::process::Command::new("osascript").args(["-e", &script]).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

fn media(enigo: &mut Enigo, key: &str) -> Result<(), String> {
    let k = match key {
        "playPause" => Key::MediaPlayPause,
        "next" => Key::MediaNextTrack,
        "prev" => Key::MediaPrevTrack,
        #[cfg(not(target_os = "macos"))]
        "stop" => Key::MediaStop,
        "volUp" => Key::VolumeUp,
        "volDown" => Key::VolumeDown,
        "mute" => Key::VolumeMute,
        _ => return Ok(()),
    };
    enigo.key(k, Direction::Click).map_err(|e| e.to_string())
}

fn modifier(name: &str) -> Option<Key> {
    Some(match name {
        "Mod" => {
            if cfg!(target_os = "macos") { Key::Meta } else { Key::Control }
        }
        "Ctrl" => Key::Control,
        "Shift" => Key::Shift,
        "Alt" => Key::Alt,
        "Win" | "Cmd" => Key::Meta,
        _ => return None,
    })
}

fn main_key(name: &str) -> Option<Key> {
    if name.chars().count() == 1 {
        return Some(Key::Unicode(name.chars().next()?.to_ascii_lowercase()));
    }
    if let Some(n) = name.strip_prefix('F').and_then(|n| n.parse::<u8>().ok()) {
        return function_key(n);
    }
    Some(match name {
        "Enter" => Key::Return,
        "Esc" => Key::Escape,
        "Backspace" => Key::Backspace,
        "Tab" => Key::Tab,
        "Space" => Key::Space,
        "CapsLock" => Key::CapsLock,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        "Delete" => Key::Delete,
        "Left" => Key::LeftArrow,
        "Right" => Key::RightArrow,
        "Up" => Key::UpArrow,
        "Down" => Key::DownArrow,
        #[cfg(not(target_os = "macos"))]
        "Insert" => Key::Insert,
        #[cfg(not(target_os = "macos"))]
        "PrintScreen" => Key::PrintScr,
        #[cfg(not(target_os = "macos"))]
        "Pause" => Key::Pause,
        _ => return None,
    })
}

fn function_key(n: u8) -> Option<Key> {
    Some(match n {
        1 => Key::F1, 2 => Key::F2, 3 => Key::F3, 4 => Key::F4, 5 => Key::F5, 6 => Key::F6,
        7 => Key::F7, 8 => Key::F8, 9 => Key::F9, 10 => Key::F10, 11 => Key::F11, 12 => Key::F12,
        13 => Key::F13, 14 => Key::F14, 15 => Key::F15, 16 => Key::F16, 17 => Key::F17, 18 => Key::F18,
        19 => Key::F19, 20 => Key::F20,
        #[cfg(not(target_os = "macos"))]
        21 => Key::F21,
        #[cfg(not(target_os = "macos"))]
        22 => Key::F22,
        #[cfg(not(target_os = "macos"))]
        23 => Key::F23,
        #[cfg(not(target_os = "macos"))]
        24 => Key::F24,
        _ => return None,
    })
}

pub fn hotkey(enigo: &mut Enigo, keys: &str) -> Result<(), String> {
    let parts: Vec<&str> = keys.split('+').map(str::trim).filter(|s| !s.is_empty()).collect();
    let (last, mods) = parts.split_last().ok_or("빈 단축키")?;
    let mods: Vec<Key> = mods.iter().filter_map(|m| modifier(m)).collect();
    let key = main_key(last).ok_or_else(|| format!("이 PC에서 쓸 수 없는 키: {last}"))?;
    for m in &mods {
        enigo.key(*m, Direction::Press).map_err(|e| e.to_string())?;
    }
    let r = enigo.key(key, Direction::Click).map_err(|e| e.to_string());
    for m in mods.iter().rev() {
        let _ = enigo.key(*m, Direction::Release);
    }
    r
}
