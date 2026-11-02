// Finds the Kivo Deck on a USB serial port, keeps the connection alive, relays JSON lines
// (docs/protocol.md) between the device and the web UI, and uploads bundles.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::runtime::RuntimeState;

// Espressif's USB vendor ID: TinyUSB on the ESP32-S3 reports it. Only these ports are probed,
// so other serial devices on the PC never receive our hello.
const ESPRESSIF_VID: u16 = 0x303A;
// Raw bytes per file.data line (base64 makes it 4096 characters; the device buffer is larger)
const CHUNK: usize = 3072;

#[derive(Deserialize)]
pub struct BundleFile {
    path: String,
    b64: String,
}

pub struct PushJob {
    files: Vec<(String, Vec<u8>)>,
    hash: String,
}

enum Msg {
    Line(String),
    Push(PushJob, Sender<Result<(), String>>),
}

#[derive(Default, Clone)]
pub struct DeviceState {
    tx: Arc<Mutex<Option<Sender<Msg>>>>,
    status: Arc<Mutex<Status>>,
}

#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub connected: bool,
    pub port: Option<String>,
    pub hello: Option<Value>,
}

impl DeviceState {
    pub fn send(&self, line: String) -> Result<(), String> {
        self.post(Msg::Line(line))
    }
    // The web side may not be listening yet when the device connects, so it also asks (device_status)
    fn set_status(&self, app: &AppHandle, status: Status) {
        *self.status.lock().unwrap() = status.clone();
        let _ = app.emit("device-status", status);
    }
    fn post(&self, m: Msg) -> Result<(), String> {
        match self.tx.lock().unwrap().as_ref() {
            Some(tx) => tx.send(m).map_err(|e| e.to_string()),
            None => Err("기기가 연결되어 있지 않아요".into()),
        }
    }
}

pub fn start(app: AppHandle, state: DeviceState, rt: RuntimeState) {
    thread::spawn(move || loop {
        if let Some((name, port, hello)) = find_device() {
            let (tx, rx) = channel();
            *state.tx.lock().unwrap() = Some(tx);
            state.set_status(&app, Status { connected: true, port: Some(name.clone()), hello: Some(hello) });
            Link::new(&app, &rt, port).map(|mut l| l.run(rx));
            *state.tx.lock().unwrap() = None;
            state.set_status(&app, Status::default());
        }
        thread::sleep(Duration::from_secs(1));
    });
}

fn open(name: &str) -> Option<Box<dyn serialport::SerialPort>> {
    let mut port = serialport::new(name, 115_200).timeout(Duration::from_millis(20)).open().ok()?;
    // TinyUSB CDC only sends once the host raises DTR
    let _ = port.write_data_terminal_ready(true);
    Some(port)
}

fn find_device() -> Option<(String, Box<dyn serialport::SerialPort>, Value)> {
    let ports = serialport::available_ports().ok()?;
    for p in ports {
        let serialport::SerialPortType::UsbPort(usb) = &p.port_type else { continue };
        if usb.vid != ESPRESSIF_VID {
            continue;
        }
        let Some(mut port) = open(&p.port_name) else { continue };
        if let Some(hello) = handshake(&mut port) {
            return Some((p.port_name, port, hello));
        }
    }
    None
}

// Sends hello and waits up to 1.5 s for {"ev":"hello",...}; other lines (input events) are skipped.
fn handshake(port: &mut Box<dyn serialport::SerialPort>) -> Option<Value> {
    let _ = port.clear(serialport::ClearBuffer::Input);
    port.write_all(b"{\"cmd\":\"hello\"}\n").ok()?;
    let mut reader = BufReader::new(port.try_clone().ok()?);
    let deadline = Instant::now() + Duration::from_millis(1500);
    let mut line = String::new();
    while Instant::now() < deadline {
        match reader.read_line(&mut line) {
            Ok(0) => return None,
            Ok(_) => {
                if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
                    if v["ev"] == "hello" {
                        return Some(v);
                    }
                }
                line.clear();
            }
            Err(e) if e.kind() == ErrorKind::TimedOut => {}
            Err(_) => return None,
        }
    }
    None
}

struct Link<'a> {
    app: &'a AppHandle,
    rt: &'a RuntimeState,
    writer: Box<dyn serialport::SerialPort>,
    reader: BufReader<Box<dyn serialport::SerialPort>>,
    line: String,
}

impl<'a> Link<'a> {
    fn new(app: &'a AppHandle, rt: &'a RuntimeState, port: Box<dyn serialport::SerialPort>) -> Option<Self> {
        let writer = port.try_clone().ok()?;
        Some(Link { app, rt, writer, reader: BufReader::new(port), line: String::new() })
    }

    fn write(&mut self, line: &str) -> std::io::Result<()> {
        self.writer.write_all(format!("{}\n", line.trim()).as_bytes())
    }

    // Reads one complete line if one arrives within the port timeout. Err = port is gone.
    fn read(&mut self) -> Result<Option<Value>, ()> {
        match self.reader.read_line(&mut self.line) {
            Ok(0) => Err(()),
            Ok(_) if self.line.ends_with('\n') => {
                let text = self.line.trim().to_string();
                self.line.clear();
                if text.is_empty() {
                    return Ok(None);
                }
                let v = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!({ "ev": "raw", "text": text }));
                Ok(Some(v))
            }
            Ok(_) => Ok(None),
            Err(e) if e.kind() == ErrorKind::TimedOut => Ok(None),
            Err(_) => Err(()),
        }
    }

    fn dispatch(&self, v: &Value) {
        self.rt.on_device_event(v);
        let _ = self.app.emit("device-event", v);
    }

    // One thread does both directions: short read timeouts let it flush queued commands in between.
    fn run(&mut self, rx: Receiver<Msg>) {
        loop {
            while let Ok(m) = rx.try_recv() {
                match m {
                    Msg::Line(cmd) => {
                        if self.write(&cmd).is_err() {
                            return;
                        }
                    }
                    Msg::Push(job, reply) => {
                        let r = self.push(job);
                        let gone = r.as_ref().err().is_some_and(|e| e == "disconnected");
                        let _ = reply.send(r);
                        if gone {
                            return;
                        }
                    }
                }
            }
            match self.read() {
                Ok(Some(v)) => self.dispatch(&v),
                Ok(None) => {}
                Err(()) => return,
            }
        }
    }

    // Sends a command and waits for {"ev":"ok"}; input events keep flowing meanwhile
    fn request(&mut self, cmd: &str) -> Result<(), String> {
        self.write(cmd).map_err(|_| "disconnected".to_string())?;
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            match self.read() {
                Ok(Some(v)) if v["ev"] == "ok" => return Ok(()),
                Ok(Some(v)) if v["ev"] == "error" => return Err(format!("기기 오류: {}", v["msg"].as_str().unwrap_or("?"))),
                Ok(Some(v)) => self.dispatch(&v),
                Ok(None) => {}
                Err(()) => return Err("disconnected".into()),
            }
        }
        Err("기기가 응답하지 않아요".into())
    }

    fn push(&mut self, job: PushJob) -> Result<(), String> {
        let total: usize = job.files.iter().map(|(_, d)| d.len()).sum();
        let mut done = 0usize;
        let app = self.app.clone();
        let progress = move |done: usize| {
            let _ = app.emit("push-progress", json!({ "done": done, "total": total }));
        };
        self.request(&json!({ "cmd": "bundle.begin", "hash": job.hash, "size": total }).to_string())?;
        for (path, data) in &job.files {
            self.request(&json!({ "cmd": "file.open", "path": path, "size": data.len() }).to_string())?;
            for chunk in data.chunks(CHUNK) {
                self.request(&json!({ "cmd": "file.data", "d": STANDARD.encode(chunk) }).to_string())?;
                done += chunk.len();
                progress(done);
            }
            self.request(r#"{"cmd":"file.close"}"#)?;
        }
        self.request(&json!({ "cmd": "bundle.end", "hash": job.hash }).to_string())
    }
}

#[tauri::command]
pub fn device_status(state: tauri::State<DeviceState>) -> Status {
    state.status.lock().unwrap().clone()
}

#[tauri::command]
pub fn send_command(state: tauri::State<DeviceState>, line: String) -> Result<(), String> {
    serde_json::from_str::<Value>(&line).map_err(|e| format!("JSON 형식이 아니에요: {e}"))?;
    state.send(line)
}

// Uploads a bundle (config.json + images); resolves when the device confirmed bundle.end
#[tauri::command]
pub async fn push_bundle(state: tauri::State<'_, DeviceState>, files: Vec<BundleFile>, hash: String) -> Result<(), String> {
    let mut decoded = Vec::with_capacity(files.len());
    for f in files {
        decoded.push((f.path, STANDARD.decode(f.b64).map_err(|e| e.to_string())?));
    }
    let (tx, rx) = channel();
    state.post(Msg::Push(PushJob { files: decoded, hash }, tx))?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(Err("disconnected".into())))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| if e == "disconnected" { "전송 중에 기기 연결이 끊겼어요".into() } else { e })
}
