// Browser-only preview (npm run dev, opened outside Tauri): fakes the Rust commands in memory so
// the UI can be checked in a normal browser. Never loaded inside the desktop app.
import { mockIPC } from "@tauri-apps/api/mocks";

export function installDevMock() {
  const files = new Map<string, string>();
  let store: string | null = null;
  mockIPC((cmd, args: any) => {
    switch (cmd) {
      case "host_os": return "windows";
      case "device_status": return {
        connected: true, port: "COM6",
        hello: { fw: "0.3.3", ota: 1, bundle: "", touch: { press: 30, release: 60, minZ: 0, edge: 6, slide: 0 } },
      };
      case "load_store": return store;
      case "save_store": store = args.json; return null;
      case "save_media": files.set(args.name, args.b64); return null;
      case "load_media": return files.get(args.name) ?? "";
      case "system_stats": return {
        cpu: 12 + Math.random() * 30, mem: 48,
        gpus: [
          { id: "luid_a", name: "NVIDIA GeForce RTX 5090", usage: 40 + Math.random() * 40 },
          { id: "luid_b", name: "Intel(R) UHD Graphics 770", usage: Math.random() * 5 },
        ],
      };
      case "installed_apps": return [
        { name: "Adobe Photoshop 2026", path: "C:\\ProgramData\\...\\Adobe Photoshop 2026.lnk", exe: "Photoshop.exe" },
        { name: "Discord", path: "C:\\Users\\...\\Discord.lnk", exe: "Discord.exe" },
        { name: "Google Chrome", path: "C:\\ProgramData\\...\\Google Chrome.lnk", exe: "chrome.exe" },
        { name: "OBS Studio", path: "C:\\ProgramData\\...\\OBS Studio.lnk", exe: "obs64.exe" },
      ];
      case "audio_apps": return ["Discord.exe", "chrome.exe"];
      case "audio_devices": return args.input
        ? [{ id: "in1", name: "마이크(Razer Hammerhead V3)", default: true }]
        : [{ id: "out1", name: "스피커(EDIFIER QR30)", default: false }, { id: "out2", name: "헤드폰(Razer Hammerhead V3)", default: true }];
      case "plugin:autostart|is_enabled": return true;
      case "plugin:updater|check": return null;
      case "plugin:app|version": return "0.1.0-dev";
      case "plugin:dialog|ask": case "plugin:dialog|confirm": return true;
      case "firmware_latest": return { version: "0.4.0", url: "https://example.invalid/kivo-deck-firmware-0.4.0.bin", size: 536192 };
      case "send_command": return null;
      default: return null;
    }
  }, { shouldMockEvents: true });
}
