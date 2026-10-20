// Browser-only preview (npm run dev, opened outside Tauri): fakes the Rust commands in memory so
// the UI can be checked in a normal browser. Never loaded inside the desktop app.
import { mockIPC } from "@tauri-apps/api/mocks";

export function installDevMock() {
  const files = new Map<string, string>();
  let store: string | null = null;
  mockIPC((cmd, args: any) => {
    switch (cmd) {
      case "host_os": return "windows";
      case "load_store": return store;
      case "save_store": store = args.json; return null;
      case "save_media": files.set(args.name, args.b64); return null;
      case "load_media": return files.get(args.name) ?? "";
      case "system_stats": return { cpu: 12 + Math.random() * 30, mem: 48 };
      case "plugin:autostart|is_enabled": return true;
      case "plugin:updater|check": return null;
      case "plugin:app|version": return "0.1.0-dev";
      case "plugin:dialog|ask": case "plugin:dialog|confirm": return true;
      case "send_command": throw "기기가 연결되어 있지 않아요";
      default: return null;
    }
  }, { shouldMockEvents: true });
}
