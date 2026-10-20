// Live key values (clock, date, CPU, memory, stopwatch): ticked every second, drawn in the editor
// and pushed to the device as small JPEG tiles for keys on the page the device shows.
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { resolvePreset } from "./model";
import type { LiveValues } from "./render";
import { keyTile, makeCtx } from "./bundle";
import { toB64 } from "./media";
import { useApp } from "./state";

interface Timer { running: boolean; startedAt: number; acc: number }

export const useLive = create<{ values: LiveValues; timer: Timer }>(() => ({
  values: { clock: "--:--", date: "--", cpu: "CPU --", mem: "MEM --", timer: "00:00" },
  timer: { running: false, startedAt: 0, acc: 0 },
}));

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");

function timerText(t: Timer) {
  const ms = t.acc + (t.running ? Date.now() - t.startedAt : 0);
  const s = Math.floor(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export function timerCommand(cmd: string) {
  const t = { ...useLive.getState().timer };
  if (cmd === "toggle") {
    if (t.running) { t.acc += Date.now() - t.startedAt; t.running = false; }
    else { t.startedAt = Date.now(); t.running = true; }
  } else if (cmd === "reset") {
    t.acc = 0; t.startedAt = Date.now();
  }
  useLive.setState({ timer: t });
  tick();
}

function anyLive(): boolean {
  const { store } = useApp.getState();
  return Object.values(store.slots).some((list) =>
    list.some((p) => p?.pages.some((pg) => pg.keys.some((k) => k.visual.kind === "live" || k.onVisual.kind === "live"))),
  );
}

let lastPushed = "";

async function tick() {
  if (!anyLive()) return;
  const now = new Date();
  const values: LiveValues = {
    clock: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    date: `${now.getMonth() + 1}/${now.getDate()} (${DAYS[now.getDay()]})`,
    cpu: useLive.getState().values.cpu,
    mem: useLive.getState().values.mem,
    timer: timerText(useLive.getState().timer),
  };
  try {
    const s = await invoke<{ cpu: number; mem: number }>("system_stats");
    values.cpu = `CPU\n${Math.round(s.cpu)}%`;
    values.mem = `MEM\n${Math.round(s.mem)}%`;
  } catch { /* keep old values */ }
  useLive.setState({ values });
  pushTiles(values);
}

async function pushTiles(values: LiveValues) {
  const { store, hostOS, device, devicePage } = useApp.getState();
  if (!device.connected) return;
  const { preset } = resolvePreset(store, hostOS);
  const page = preset?.pages[devicePage];
  if (!page) return;
  const cat = makeCtx(store, hostOS, preset);
  for (const [k, key] of page.keys.entries()) {
    if (key.visual.kind !== "live") continue;
    const sig = `${devicePage}:${k}:${(values as any)[key.visual.live!]}`;
    if (sig === lastPushed) continue;
    const jpg = await keyTile(page, k, { cat, live: values });
    invoke("send_command", { line: JSON.stringify({ cmd: "tile", page: devicePage, key: k, d: toB64(jpg) }) }).catch(() => {});
    lastPushed = sig;
  }
}

export function startLive() {
  tick();
  setInterval(tick, 1000);
}
