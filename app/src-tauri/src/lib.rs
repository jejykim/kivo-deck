mod device;

use device::DeviceState;
use tauri::Manager;

// Sends one JSON command line to the device, e.g. {"cmd":"state"}
#[tauri::command]
fn send_command(state: tauri::State<DeviceState>, line: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&line).map_err(|e| format!("JSON 형식이 아니에요: {e}"))?;
    state.send(line)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DeviceState::default())
        .setup(|app| {
            device::start(app.handle().clone(), app.state::<DeviceState>().inner().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![send_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
