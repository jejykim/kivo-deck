import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { loadStore, useApp, type DeviceInfo } from "./state";
import { applyToDevice, scheduleDraft, syncRuntime, useSync } from "./sync";
import { startLive, timerCommand } from "./live";
import { playSound } from "./media";
import { Splash } from "./components/Splash";
import { Header } from "./components/Header";
import { LogPanel } from "./components/LogPanel";
import { Editor } from "./components/Editor";
import { Library } from "./components/Library";
import { checkForUpdate } from "./components/UpdateButton";
import { checkFirmware } from "./components/FirmwareUpdate";
import { syncAutostart } from "./components/SettingsDialog";

type DeviceEvent = { ev: string; id?: number; down?: number; value?: number; n?: number; [k: string]: unknown };

function onDeviceEvent(e: DeviceEvent) {
  const s = useApp.getState();
  if (e.ev === "key") {
    const pressed = new Set(s.pressed);
    if (e.down) pressed.add(e.id!); else pressed.delete(e.id!);
    s.set({ pressed });
  } else if (e.ev === "fader") {
    const faderValues = [...s.faderValues];
    faderValues[e.id!] = e.value!;
    s.set({ faderValues });
  } else if (e.ev === "page") {
    s.set({ devicePage: e.n ?? 0 });
  }
  // fader and knob turns are frequent; keep the log readable
  if (e.ev !== "fader") s.addLog(JSON.stringify(e), e.ev === "error" ? "err" : "in");
}

function onDeviceStatus(info: DeviceInfo) {
  const s = useApp.getState();
  s.set({ device: info, pressed: new Set(), devicePage: 0 });
  s.addLog(info.connected ? `연결됨 ${info.port} ${JSON.stringify(info.hello)}` : "연결 끊김", "sys");
  // before the presets are loaded this would upload the default preset; the check after loading covers it
  if (info.connected && s.loaded) applyToDevice();
}

export function App() {
  const loaded = useApp((s) => s.loaded);
  const [splash, setSplash] = useState(true);

  useEffect(() => {
    const t0 = Date.now();
    loadStore().then(async () => {
      await syncRuntime().catch((e) => useApp.getState().addLog(String(e), "err"));
      syncAutostart();
      startLive();
      // keep the logo up for at least 1.6 s
      setTimeout(() => setSplash(false), Math.max(0, 1600 - (Date.now() - t0)));
      checkForUpdate();
      checkFirmware();
      // the device may have connected before anything was listening
      await Promise.all(un);
      const info = await invoke<DeviceInfo>("device_status");
      if (info.connected) onDeviceStatus(info);
    });
    const un = [
      listen<DeviceEvent>("device-event", (m) => onDeviceEvent(m.payload)),
      listen<DeviceInfo>("device-status", (m) => onDeviceStatus(m.payload)),
      listen<{ done: number; total: number }>("push-progress", (m) =>
        useSync.setState({ progress: m.payload.total ? m.payload.done / m.payload.total : 0 })),
      listen<string>("play-sound", (m) => playSound(m.payload)),
      listen<string>("timer", (m) => timerCommand(m.payload)),
      listen<string>("foreground", (m) => {
        if (/kivo.?deck/i.test(m.payload)) return;
        useApp.setState((s) => ({ recentApps: [m.payload, ...s.recentApps.filter((x) => x !== m.payload)].slice(0, 8) }));
      }),
      listen<string>("action-error", (m) => useApp.getState().addLog(m.payload, "err")),
    ];
    return () => { un.forEach((p) => p.then((f) => f())); };
  }, []);

  // any edit -> recompute whether the device is out of date
  const store = useApp((s) => s.store);
  useEffect(() => { if (loaded) scheduleDraft(); }, [store, loaded]);

  return (
    <>
      {loaded && (
        <div className="app">
          <Header />
          <div className="body">
            <LogPanel />
            <Editor />
            <Library />
          </div>
        </div>
      )}
      {splash && <Splash onSkip={() => loaded && setSplash(false)} />}
    </>
  );
}
