// "적용": builds the bundle for this PC's OS, uploads it to the device when it changed, and
// hands the PC-side action table to Rust. Also runs automatically when the device connects.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { buildBundle, type Bundle } from "./bundle";
import { toB64 } from "./media";
import { useApp } from "./state";

export const useSync = create<{ busy: boolean; progress: number; error: string | null }>(() => ({
  busy: false, progress: 0, error: null,
}));

let draftTimer: number | undefined;

// Recomputes the draft hash shortly after edits (shows "변경 사항 있음")
export function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = window.setTimeout(async () => {
    const { store, hostOS } = useApp.getState();
    const b = await buildBundle(store, hostOS);
    useApp.setState({ draftHash: b.hash });
  }, 700);
}

async function setRuntime(b: Bundle) {
  await invoke("set_runtime", { json: JSON.stringify(b.runtime) });
}

export async function applyToDevice(force = false) {
  if (useSync.getState().busy) return;
  const { store, hostOS, device, addLog } = useApp.getState();
  useSync.setState({ busy: true, progress: 0, error: null });
  try {
    const b = await buildBundle(store, hostOS);
    await setRuntime(b);
    useApp.setState({ draftHash: b.hash });
    if (!device.connected) {
      addLog("기기가 없어서 PC 쪽 설정만 적용했어요", "sys");
      return;
    }
    if (!force && device.hello?.bundle === b.hash) {
      useApp.setState({ appliedHash: b.hash });
      return;
    }
    const files = [
      { path: "/b/config.json", b64: toB64(new TextEncoder().encode(JSON.stringify(b.config))) },
      ...b.files.map((f) => ({ path: f.path, b64: toB64(f.data) })),
    ];
    const kb = Math.round(files.reduce((n, f) => n + f.b64.length * 0.75, 0) / 1024);
    addLog(`기기에 적용 중… (${files.length}개 파일, ${kb} KB)`, "sys");
    await invoke("push_bundle", { files, hash: b.hash });
    useApp.setState((s) => ({ appliedHash: b.hash, device: { ...s.device, hello: { ...s.device.hello, bundle: b.hash } } }));
    addLog("기기에 적용했어요", "sys");
  } catch (e) {
    useSync.setState({ error: String(e) });
    addLog(`적용 실패: ${e}`, "err");
  } finally {
    useSync.setState({ busy: false });
  }
}

// Runtime only (startup without a device)
export async function syncRuntime() {
  const { store, hostOS } = useApp.getState();
  const b = await buildBundle(store, hostOS);
  await setRuntime(b);
  useApp.setState({ draftHash: b.hash });
}
