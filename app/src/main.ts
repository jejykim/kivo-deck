// Device monitor: shows every event from docs/protocol.md and lets you send the basic commands.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type Status = { connected: boolean; port: string | null; hello: Record<string, unknown> | null };
type DeviceEvent = { ev: string; id?: number; down?: number; delta?: number; value?: number; [k: string]: unknown };

const KEY_COUNT = 15;
const LOG_LINES = 300;

const $ = (id: string) => document.getElementById(id)!;
const knobTotals = [0, 0];

function log(text: string, kind = "") {
  const el = $("log");
  const line = document.createElement("div");
  line.className = kind;
  line.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
  el.prepend(line);
  while (el.childElementCount > LOG_LINES) el.lastElementChild!.remove();
}

function buildKeys() {
  const wrap = $("keys");
  for (let k = 0; k < KEY_COUNT; k++) {
    const key = document.createElement("div");
    key.className = "key";
    key.id = `key${k}`;
    key.textContent = String(k + 1);
    wrap.append(key);
  }
}

function setFader(id: number, value: number) {
  ($(`fader${id}`) as HTMLElement).style.width = `${value / 10}%`;
  $(`fader${id}v`).textContent = String(value);
}

function onEvent(e: DeviceEvent) {
  switch (e.ev) {
    case "key":
      $(`key${e.id}`).classList.toggle("down", e.down === 1);
      break;
    case "knob":
      knobTotals[e.id!] += e.delta!;
      $(`knob${e.id}`).textContent = String(knobTotals[e.id!]);
      break;
    case "knobPress":
      $(`knob${e.id}`).parentElement!.classList.toggle("down", e.down === 1);
      break;
    case "fader":
      setFader(e.id!, e.value!);
      break;
    case "state": {
      const faders = e.faders as number[];
      faders.forEach((v, i) => v >= 0 && setFader(i, v));
      break;
    }
  }
  log(JSON.stringify(e), e.ev === "error" ? "err" : "in");
}

function onStatus(s: Status) {
  const el = $("status");
  el.className = `status ${s.connected ? "on" : "off"}`;
  el.textContent = s.connected ? `연결됨 · ${s.port} · fw ${s.hello?.fw ?? "?"}` : "기기를 찾는 중…";
  log(s.connected ? `연결됨 ${s.port} ${JSON.stringify(s.hello)}` : "연결 끊김", "sys");
  if (s.connected) send('{"cmd":"state"}');
}

async function send(line: string) {
  try {
    await invoke("send_command", { line });
    log(line, "out");
  } catch (err) {
    log(String(err), "err");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  buildKeys();
  document.querySelectorAll<HTMLButtonElement>("button[data-cmd]").forEach((b) =>
    b.addEventListener("click", () => send(b.dataset.cmd!)),
  );
  $("clear").addEventListener("click", () => ($("log").innerHTML = ""));
  listen<DeviceEvent>("device-event", (m) => onEvent(m.payload));
  listen<Status>("device-status", (m) => onStatus(m.payload));
});
