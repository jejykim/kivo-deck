// Finds the Kivo Deck on a USB serial port, keeps the connection alive and relays JSON lines
// (docs/protocol.md) between the device and the web UI.
use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

// Espressif's USB vendor ID: TinyUSB on the ESP32-S3 reports it. Only these ports are probed,
// so other serial devices on the PC never receive our hello.
const ESPRESSIF_VID: u16 = 0x303A;

#[derive(Default, Clone)]
pub struct DeviceState {
    tx: Arc<Mutex<Option<Sender<String>>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub connected: bool,
    pub port: Option<String>,
    pub hello: Option<Value>,
}

impl DeviceState {
    pub fn send(&self, line: String) -> Result<(), String> {
        match self.tx.lock().unwrap().as_ref() {
            Some(tx) => tx.send(line).map_err(|e| e.to_string()),
            None => Err("기기가 연결되어 있지 않아요".into()),
        }
    }
}

pub fn start(app: AppHandle, state: DeviceState) {
    thread::spawn(move || loop {
        if let Some((name, port, hello)) = find_device() {
            let (tx, rx) = channel();
            *state.tx.lock().unwrap() = Some(tx);
            let _ = app.emit("device-status", Status { connected: true, port: Some(name.clone()), hello: Some(hello) });
            run(&app, port, rx);
            *state.tx.lock().unwrap() = None;
            let _ = app.emit("device-status", Status { connected: false, port: None, hello: None });
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
        if usb.vid != ESPRESSIF_VID { continue; }
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
                    if v["ev"] == "hello" { return Some(v); }
                }
                line.clear();
            }
            Err(e) if e.kind() == ErrorKind::TimedOut => {}
            Err(_) => return None,
        }
    }
    None
}

// One thread does both directions: short read timeouts let it flush queued commands in between.
fn run(app: &AppHandle, port: Box<dyn serialport::SerialPort>, rx: Receiver<String>) {
    let Ok(mut writer) = port.try_clone() else { return };
    let mut reader = BufReader::new(port);
    let mut line = String::new();
    loop {
        while let Ok(cmd) = rx.try_recv() {
            if writer.write_all(format!("{}\n", cmd.trim()).as_bytes()).is_err() { return; }
        }
        match reader.read_line(&mut line) {
            Ok(0) => return,
            Ok(_) => {
                if line.ends_with('\n') {
                    let text = line.trim();
                    if !text.is_empty() {
                        let v = serde_json::from_str::<Value>(text)
                            .unwrap_or_else(|_| serde_json::json!({ "ev": "raw", "text": text }));
                        let _ = app.emit("device-event", v);
                    }
                    line.clear();
                }
            }
            Err(e) if e.kind() == ErrorKind::TimedOut => {}
            Err(_) => return,
        }
    }
}
