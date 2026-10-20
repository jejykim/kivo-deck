mod actions;
mod apps;
mod audio;
mod audio_device;
mod gpu;
mod device;
mod obs;
mod runtime;
mod store;
mod system;

use device::DeviceState;
use runtime::RuntimeState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

// Launched by the OS at login (see tauri-plugin-autostart args below)
const AUTOSTART_ARG: &str = "--autostart";

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// "숨긴 채로 시작" lives in the settings file; read it before the web side is up
fn start_hidden(app: &AppHandle) -> bool {
    store::load_store(app.clone())
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v["settings"]["startHidden"].as_bool())
        .unwrap_or(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(DeviceState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let rt = RuntimeState::new(handle.clone());
            let dev = app.state::<DeviceState>().inner().clone();
            device::start(handle.clone(), dev.clone(), rt.clone());
            rt.start_auto_switch(handle.clone(), dev);
            app.manage(rt);

            let open = MenuItem::with_id(app, "open", "Kivo Deck 열기", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Kivo Deck")
                .menu(&Menu::with_items(app, &[&open, &quit])?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            let autostarted = std::env::args().any(|a| a == AUTOSTART_ARG);
            if !(autostarted && start_hidden(&handle)) {
                show_main(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // closing the window keeps the app in the tray so the deck keeps working
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            device::send_command,
            device::push_bundle,
            runtime::set_runtime,
            store::host_os,
            store::load_store,
            store::save_store,
            store::save_media,
            store::load_media,
            store::delete_media,
            store::write_text_file,
            store::read_text_file,
            system::system_stats,
            system::foreground_app,
            apps::installed_apps,
            apps::audio_apps,
            audio_device::audio_devices,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
