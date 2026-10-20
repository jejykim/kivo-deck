// Live key values (clock, date, CPU, memory, GPU, stopwatch): ticked every second, drawn in the editor
// and pushed to the device as small JPEG tiles for keys on the page the device shows.
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { resolvePreset } from "./model";
import { metric, type GpuInfo, type LiveValues } from "./render";
import { keyTile, makeCtx } from "./bundle";
import { toB64 } from "./media";
import { useApp } from "./state";

interface Timer { running: boolean; startedAt: number; acc: number }

const HIST = 30; // samples kept for the graph style (1 per second)

export const useLive = create<{ values: LiveValues; timer: Timer }>(() => ({
  values: { clock: "--:--", date: "--", timer: "00:00", cpu: 0, mem: 0, gpus: [], hist: {} },
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

let started = false;
let lastPushed: Record<number, string> = {};

async function tick() {
  // GPU names are needed by the key settings even before any live key exists
  if (!anyLive() && started) return;
  started = true;
  const now = new Date();
  const prev = useLive.getState().values;
  const values: LiveValues = {
    ...prev,
    clock: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    date: `${now.getMonth() + 1}/${now.getDate()} (${DAYS[now.getDay()]})`,
    timer: timerText(useLive.getState().timer),
  };
  try {
    const s = await invoke<{ cpu: number; mem: number; gpus: GpuInfo[] }>("system_stats");
    values.cpu = s.cpu;
    values.mem = s.mem;
    values.gpus = s.gpus;
    const push = (key: string, v: number) => [...(prev.hist[key] ?? []), v].slice(-HIST);
    const busiest = s.gpus.reduce((m, g) => Math.max(m, g.usage), 0);
    values.hist = {
      cpu: push("cpu", s.cpu),
      mem: push("mem", s.mem),
      "gpu:auto": push("gpu:auto", busiest),
      ...Object.fromEntries(s.gpus.map((g) => [`gpu:${g.id}`, push(`gpu:${g.id}`, g.usage)])),
    };
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
    const v = key.visual;
    if (v.kind !== "live" || !v.live) continue;
    // only send when what the key shows changed
    const shown = v.live === "clock" ? values.clock : v.live === "date" ? values.date : v.live === "timer" ? values.timer
      : v.liveStyle === "graph" ? metric(v, values).hist.map(Math.round).join(",") : String(Math.round(metric(v, values).value));
    const sig = `${devicePage}:${JSON.stringify(v)}:${shown}`;
    if (lastPushed[k] === sig) continue;
    const jpg = await keyTile(page, k, { cat, live: values });
    invoke("send_command", { line: JSON.stringify({ cmd: "tile", page: devicePage, key: k, d: toB64(jpg) }) }).catch(() => {});
    lastPushed[k] = sig;
  }
}

export function startLive() {
  tick();
  setInterval(tick, 1000);
}
