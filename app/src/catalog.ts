// Every action that can go on a key, knob or fader.
//  - hid(): actions the device can run by itself over USB HID (work even without the app)
//  - run(): everything else, executed by the PC app (src-tauri/src/actions.rs)
//  - Actions from other programs live in APP_PACKS and show up one level deeper in the list.
// To add a program, add a pack at the bottom of this file.
import type { ActionRef, OS, Store } from "./model";
import { hotkeyOS, hotkeyToHid, prettyHotkey } from "./keys";

export type Slot = "key" | "dial" | "fader";

export interface ParamDef {
  key: string;
  label: string;
  kind: "text" | "hotkey" | "number" | "page" | "macro" | "file" | "url" | "process" | "media";
  placeholder?: string;
}

// Device-side action (docs/protocol.md "기기 동작")
export type DevAction =
  | { k: [number, number][] }
  | { c: number }
  | { t: string }
  | { s: DevAction[] }
  | { d: number }
  | { p: "next" | "prev" | "back" | number }
  | { a: 1 };

// PC-side operation (src-tauri/src/actions.rs `Op`)
export type Op =
  | { op: "hotkey"; keys: string }
  | { op: "text"; text: string }
  | { op: "delay"; ms: number }
  | { op: "open"; target: string }
  | { op: "media"; key: "playPause" | "next" | "prev" | "stop" | "volUp" | "volDown" | "mute" }
  | { op: "micMute" }
  | { op: "volume"; target: "system" | "mic" | "app"; process?: string; step?: number }
  | { op: "obs"; req: string; arg?: string }
  | { op: "sound"; mediaId: string }
  | { op: "timer"; cmd: "toggle" | "reset" }
  | { op: "seq"; steps: Op[] };

export interface Ctx {
  os: OS;
  store: Store;
  pageIndex: (pageId: string) => number;
}

export interface ActionDef {
  id: string;
  name: string;
  icon: string;
  category: string;
  app?: string; // app pack id
  slots: Slot[];
  params?: ParamDef[];
  os?: (p: Record<string, any>, ctx: Ctx) => OS[];
  hid?: (p: Record<string, any>, ctx: Ctx) => DevAction | null;
  run?: (p: Record<string, any>, ctx: Ctx) => Op | null;
  dial?: { cw: ActionRef; ccw: ActionRef }; // what a knob gets when this is dropped on "rotate"
  label?: (p: Record<string, any>, ctx: Ctx) => string; // short text drawn on the key
  needsObs?: boolean;
}

const BOTH: OS[] = ["windows", "mac"];
const isAscii = (s: string) => /^[\x20-\x7e\n\t]*$/.test(s);
const ref = (type: string, params: Record<string, any> = {}): ActionRef => ({ type, params });

const hotkeyHid = (keys: string, os: OS): DevAction | null => {
  const h = hotkeyToHid(keys, os);
  return h ? { k: [h] } : null;
};

// Consumer control usage IDs (HID page 0x0C)
const CC = { playPause: 0xcd, next: 0xb5, prev: 0xb6, stop: 0xb7, mute: 0xe2, volUp: 0xe9, volDown: 0xea };

function mediaAction(id: keyof typeof CC, name: string, icon: string): ActionDef {
  return {
    id: `media.${id}`, name, icon, category: "미디어", slots: ["key"],
    hid: () => ({ c: CC[id] }),
    run: () => ({ op: "media", key: id }),
  };
}

export const ACTIONS: ActionDef[] = [
  // ---------------------------------------------------------------- 페이지
  { id: "page.next", name: "다음 페이지", icon: "▶", category: "페이지", slots: ["key"], hid: () => ({ p: "next" }) },
  { id: "page.prev", name: "이전 페이지", icon: "◀", category: "페이지", slots: ["key"], hid: () => ({ p: "prev" }) },
  {
    id: "page.goto", name: "페이지로 이동", icon: "⤴", category: "페이지", slots: ["key"],
    params: [{ key: "pageId", label: "페이지", kind: "page" }],
    hid: (p, c) => (c.pageIndex(p.pageId) >= 0 ? { p: c.pageIndex(p.pageId) } : null),
  },
  {
    id: "page.folder", name: "폴더 열기", icon: "📁", category: "페이지", slots: ["key"],
    params: [{ key: "pageId", label: "폴더 페이지", kind: "page" }],
    hid: (p, c) => (c.pageIndex(p.pageId) >= 0 ? { p: c.pageIndex(p.pageId) } : null),
  },
  { id: "page.back", name: "뒤로 (폴더 닫기)", icon: "↩", category: "페이지", slots: ["key"], hid: () => ({ p: "back" }) },

  // ---------------------------------------------------------------- 키보드
  {
    id: "hotkey", name: "단축키", icon: "⌨", category: "키보드", slots: ["key"],
    params: [{ key: "keys", label: "단축키", kind: "hotkey", placeholder: "Mod+Shift+S" }],
    os: (p) => (p.keys ? hotkeyOS(p.keys) : BOTH),
    hid: (p, c) => (p.keys ? hotkeyHid(p.keys, c.os) : null),
    run: (p) => (p.keys ? { op: "hotkey", keys: p.keys } : null),
    label: (p, c) => (p.keys ? prettyHotkey(p.keys, c.os) : ""),
  },
  {
    id: "text", name: "문자 입력", icon: "🔤", category: "키보드", slots: ["key"],
    params: [{ key: "text", label: "입력할 글자", kind: "text" }],
    // ASCII can be typed by the device itself; Korean etc. needs the app
    hid: (p) => (p.text && isAscii(p.text) ? { t: p.text } : null),
    run: (p) => (p.text ? { op: "text", text: p.text } : null),
  },
  {
    id: "macro", name: "매크로 실행", icon: "🧩", category: "키보드", slots: ["key"],
    params: [{ key: "macroId", label: "매크로", kind: "macro" }],
    os: (p, c) => macroOS(p.macroId, c),
    hid: (p, c) => macroHid(p.macroId, c),
    run: (p, c) => macroRun(p.macroId, c),
    label: (p, c) => c.store.macros.find((m) => m.id === p.macroId)?.name ?? "",
  },
  {
    id: "dial.undo", name: "실행 취소 / 다시 실행", icon: "↶", category: "키보드", slots: ["dial"],
    dial: { cw: ref("hotkey", { keys: "Mod+Shift+Z" }), ccw: ref("hotkey", { keys: "Mod+Z" }) },
  },
  {
    id: "dial.zoom", name: "확대 / 축소", icon: "🔍", category: "키보드", slots: ["dial"],
    dial: { cw: ref("hotkey", { keys: "Mod+=" }), ccw: ref("hotkey", { keys: "Mod+-" }) },
  },
  {
    id: "dial.arrowsV", name: "위 / 아래 화살표", icon: "↕", category: "키보드", slots: ["dial"],
    dial: { cw: ref("hotkey", { keys: "Down" }), ccw: ref("hotkey", { keys: "Up" }) },
  },
  {
    id: "dial.tabs", name: "탭 전환", icon: "🗂", category: "키보드", slots: ["dial"],
    dial: { cw: ref("hotkey", { keys: "Ctrl+Tab" }), ccw: ref("hotkey", { keys: "Ctrl+Shift+Tab" }) },
  },

  // ---------------------------------------------------------------- 미디어 · 소리
  mediaAction("playPause", "재생 / 일시정지", "⏯"),
  mediaAction("next", "다음 곡", "⏭"),
  mediaAction("prev", "이전 곡", "⏮"),
  mediaAction("stop", "정지", "⏹"),
  mediaAction("volUp", "볼륨 올리기", "🔊"),
  mediaAction("volDown", "볼륨 내리기", "🔉"),
  mediaAction("mute", "음소거", "🔇"),
  {
    id: "dial.volume", name: "시스템 볼륨 (노브)", icon: "🎚", category: "미디어", slots: ["dial"],
    dial: { cw: ref("media.volUp"), ccw: ref("media.volDown") },
  },
  {
    id: "dial.track", name: "이전 / 다음 곡 (노브)", icon: "⏭", category: "미디어", slots: ["dial"],
    dial: { cw: ref("media.next"), ccw: ref("media.prev") },
  },
  { id: "mic.mute", name: "마이크 음소거", icon: "🎙", category: "미디어", slots: ["key"], run: () => ({ op: "micMute" }) },
  { id: "volume.system", name: "시스템 볼륨", icon: "🔊", category: "미디어", slots: ["fader"], run: () => ({ op: "volume", target: "system" }) },
  { id: "volume.mic", name: "마이크 볼륨", icon: "🎙", category: "미디어", slots: ["fader"], run: () => ({ op: "volume", target: "mic" }) },
  {
    id: "volume.app", name: "앱별 볼륨", icon: "🎛", category: "미디어", slots: ["fader"],
    params: [{ key: "process", label: "프로그램 (예: chrome.exe)", kind: "process" }],
    os: () => ["windows"], // macOS has no per-app volume API
    run: (p) => ({ op: "volume", target: "app", process: p.process ?? "" }),
    label: (p) => p.process ?? "",
  },
  {
    id: "dial.appVolume", name: "앱별 볼륨 (노브)", icon: "🎛", category: "미디어", slots: ["dial"],
    params: [{ key: "process", label: "프로그램 (예: chrome.exe)", kind: "process" }],
    os: () => ["windows"],
    dial: { cw: ref("volume.appStep", { step: 2 }), ccw: ref("volume.appStep", { step: -2 }) },
  },
  {
    id: "volume.appStep", name: "앱 볼륨 한 칸", icon: "🎛", category: "숨김", slots: [],
    params: [{ key: "process", label: "프로그램", kind: "process" }],
    os: () => ["windows"],
    run: (p) => ({ op: "volume", target: "app", process: p.process ?? "", step: p.step ?? 2 }),
  },
  {
    id: "sound.play", name: "소리 재생 (사운드보드)", icon: "🔔", category: "미디어", slots: ["key"],
    params: [{ key: "mediaId", label: "소리 파일", kind: "media" }],
    run: (p) => (p.mediaId ? { op: "sound", mediaId: p.mediaId } : null),
  },

  // ---------------------------------------------------------------- 열기
  {
    id: "open.app", name: "프로그램 실행", icon: "🚀", category: "열기", slots: ["key"],
    params: [{ key: "target", label: "프로그램 경로", kind: "file", placeholder: "C:\\...\\app.exe 또는 /Applications/App.app" }],
    os: (p) => pathOS(p.target),
    run: (p) => (p.target ? { op: "open", target: p.target } : null),
    label: (p) => baseName(p.target),
  },
  {
    id: "open.file", name: "파일 · 폴더 열기", icon: "📂", category: "열기", slots: ["key"],
    params: [{ key: "target", label: "경로", kind: "file" }],
    os: (p) => pathOS(p.target),
    run: (p) => (p.target ? { op: "open", target: p.target } : null),
    label: (p) => baseName(p.target),
  },
  {
    id: "open.url", name: "웹사이트 열기", icon: "🌐", category: "열기", slots: ["key"],
    params: [{ key: "target", label: "주소", kind: "url", placeholder: "https://" }],
    run: (p) => (p.target ? { op: "open", target: p.target } : null),
  },

  // ---------------------------------------------------------------- 표시 · 시간
  { id: "timer.toggle", name: "스톱워치 시작 / 정지", icon: "⏱", category: "시간", slots: ["key"], run: () => ({ op: "timer", cmd: "toggle" }) },
  { id: "timer.reset", name: "스톱워치 초기화", icon: "🔁", category: "시간", slots: ["key"], run: () => ({ op: "timer", cmd: "reset" }) },
];

// ---------------------------------------------------------------- programs (one level deeper)
export interface AppPack {
  id: string;
  name: string;
  icon: string;
  note: string;
  actions: ActionDef[];
}

function shortcut(app: string, id: string, name: string, keys: string, icon = "⌨"): ActionDef {
  return {
    id: `app.${app}.${id}`, name, icon, category: "앱", app, slots: ["key"],
    os: () => hotkeyOS(keys),
    hid: (_p, c) => hotkeyHid(keys, c.os),
    run: () => ({ op: "hotkey", keys }),
  };
}
function shortcutDial(app: string, id: string, name: string, cw: string, ccw: string, icon = "🎚"): ActionDef {
  return {
    id: `app.${app}.${id}`, name, icon, category: "앱", app, slots: ["dial"],
    dial: { cw: ref("hotkey", { keys: cw }), ccw: ref("hotkey", { keys: ccw }) },
  };
}
function obs(id: string, name: string, icon: string, req: string, param?: ParamDef): ActionDef {
  return {
    id: `app.obs.${id}`, name, icon, category: "앱", app: "obs", slots: ["key"], needsObs: true,
    params: param ? [param] : undefined,
    run: (p) => ({ op: "obs", req, arg: param ? p[param.key] ?? "" : undefined }),
    label: (p) => (param ? p[param.key] ?? "" : ""),
  };
}

export const APP_PACKS: AppPack[] = [
  {
    id: "photoshop", name: "Photoshop", icon: "🖌",
    note: "포토샵 기본 단축키로 동작해요. 포토샵이 앞에 있을 때 눌러 주세요.",
    actions: [
      shortcut("photoshop", "cut", "잘라내기", "Mod+X", "✂"),
      shortcut("photoshop", "copy", "복사", "Mod+C", "📋"),
      shortcut("photoshop", "paste", "붙여넣기", "Mod+V", "📥"),
      shortcut("photoshop", "undo", "실행 취소", "Mod+Z", "↶"),
      shortcut("photoshop", "redo", "다시 실행", "Mod+Shift+Z", "↷"),
      shortcut("photoshop", "move", "이동 도구", "V", "✥"),
      shortcut("photoshop", "marquee", "선택 윤곽 도구", "M", "⬚"),
      shortcut("photoshop", "lasso", "올가미 도구", "L", "➰"),
      shortcut("photoshop", "crop", "자르기 도구", "C", "⛶"),
      shortcut("photoshop", "brush", "브러시 도구", "B", "🖌"),
      shortcut("photoshop", "eraser", "지우개 도구", "E", "🧽"),
      shortcut("photoshop", "eyedropper", "스포이드", "I", "💧"),
      shortcut("photoshop", "text", "문자 도구", "T", "T"),
      shortcut("photoshop", "hand", "손 도구", "H", "✋"),
      shortcut("photoshop", "swap", "전경/배경색 바꾸기", "X", "⇄"),
      shortcut("photoshop", "deselect", "선택 해제", "Mod+D", "⬜"),
      shortcut("photoshop", "invert", "선택 반전", "Mod+Shift+I", "◑"),
      shortcut("photoshop", "transform", "자유 변형", "Mod+T", "⤡"),
      shortcut("photoshop", "newLayer", "새 레이어", "Mod+Shift+N", "➕"),
      shortcut("photoshop", "dupLayer", "레이어 복제", "Mod+J", "⧉"),
      shortcut("photoshop", "merge", "레이어 병합", "Mod+E", "⤓"),
      shortcut("photoshop", "fit", "화면 크기에 맞추기", "Mod+0", "⛶"),
      shortcut("photoshop", "save", "저장", "Mod+S", "💾"),
      shortcut("photoshop", "export", "내보내기 (다른 형식)", "Mod+Shift+Alt+W", "📤"),
      shortcutDial("photoshop", "brushSize", "브러시 크기 (노브)", "]", "[", "◉"),
      shortcutDial("photoshop", "zoom", "확대 / 축소 (노브)", "Mod+=", "Mod+-", "🔍"),
      shortcutDial("photoshop", "history", "작업 내역 앞/뒤 (노브)", "Mod+Shift+Z", "Mod+Z", "🕘"),
    ],
  },
  {
    id: "obs", name: "OBS Studio", icon: "🎥",
    note: "OBS의 WebSocket으로 직접 연결해요. 설정에서 OBS 주소·비밀번호를 넣어 주세요 (OBS → 도구 → WebSocket 서버 설정).",
    actions: [
      obs("scene", "장면 전환", "🎬", "scene", { key: "scene", label: "장면 이름", kind: "text" }),
      obs("record", "녹화 시작 / 정지", "⏺", "toggleRecord"),
      obs("recordPause", "녹화 일시정지", "⏸", "toggleRecordPause"),
      obs("stream", "방송 시작 / 정지", "📡", "toggleStream"),
      obs("mute", "소스 음소거", "🔇", "toggleMute", { key: "input", label: "오디오 소스 이름", kind: "text" }),
      obs("vcam", "가상 카메라 켜기 / 끄기", "📷", "toggleVirtualCam"),
      obs("replay", "리플레이 버퍼 저장", "💾", "saveReplay"),
      {
        id: "app.obs.volume", name: "소스 볼륨 (페이더)", icon: "🎚", category: "앱", app: "obs", slots: ["fader"], needsObs: true,
        params: [{ key: "input", label: "오디오 소스 이름", kind: "text" }],
        run: (p) => ({ op: "obs", req: "volume", arg: p.input ?? "" }),
      },
    ],
  },
];

export const ALL_ACTIONS: ActionDef[] = [...ACTIONS, ...APP_PACKS.flatMap((a) => a.actions)];
const BY_ID = new Map(ALL_ACTIONS.map((a) => [a.id, a]));
export const actionDef = (id: string) => BY_ID.get(id);

// ---------------------------------------------------------------- helpers

function pathOS(path?: string): OS[] {
  if (!path) return BOTH;
  if (/\.(exe|bat|cmd|lnk|msc)$/i.test(path) || /^[a-z]:\\/i.test(path)) return ["windows"];
  if (/\.app\/?$/i.test(path) || path.startsWith("/")) return ["mac"];
  return BOTH;
}
function baseName(path?: string) {
  if (!path) return "";
  return path.split(/[\\/]/).filter(Boolean).pop()?.replace(/\.(exe|app|lnk)$/i, "") ?? "";
}

function macroOS(id: string, c: Ctx): OS[] {
  const m = c.store.macros.find((x) => x.id === id);
  if (!m) return BOTH;
  let os = BOTH;
  for (const s of m.steps) {
    const sub = s.kind === "hotkey" ? hotkeyOS(s.keys) : s.kind === "action" ? actionOS(s.action, c) : BOTH;
    os = os.filter((o) => sub.includes(o));
  }
  return os;
}
function macroHid(id: string, c: Ctx): DevAction | null {
  const m = c.store.macros.find((x) => x.id === id);
  if (!m || !m.steps.length) return null;
  const out: DevAction[] = [];
  for (const s of m.steps) {
    if (s.kind === "delay") out.push({ d: s.ms });
    else if (s.kind === "hotkey") { const h = hotkeyHid(s.keys, c.os); if (!h) return null; out.push(h); }
    else if (s.kind === "text") { if (!isAscii(s.text)) return null; out.push({ t: s.text }); }
    else {
      const d = actionDef(s.action.type);
      const h = d?.hid?.(s.action.params, c);
      if (!h || "p" in h || "a" in h) return null;
      out.push(h);
    }
  }
  return { s: out };
}
function macroRun(id: string, c: Ctx): Op | null {
  const m = c.store.macros.find((x) => x.id === id);
  if (!m) return null;
  const steps: Op[] = [];
  for (const s of m.steps) {
    if (s.kind === "delay") steps.push({ op: "delay", ms: s.ms });
    else if (s.kind === "hotkey") steps.push({ op: "hotkey", keys: s.keys });
    else if (s.kind === "text") steps.push({ op: "text", text: s.text });
    else { const op = actionRun(s.action, c); if (op) steps.push(op); }
  }
  return { op: "seq", steps };
}

// ---------------------------------------------------------------- public API

export function actionOS(a: ActionRef, c: Ctx): OS[] {
  const d = actionDef(a.type);
  if (!d) return [];
  return d.os ? d.os(a.params, c) : BOTH;
}
export const supported = (a: ActionRef | null, c: Ctx) => !a || actionOS(a, c).includes(c.os);

export function actionHid(a: ActionRef, c: Ctx): DevAction | null {
  return actionDef(a.type)?.hid?.(a.params, c) ?? null;
}
export function actionRun(a: ActionRef, c: Ctx): Op | null {
  return actionDef(a.type)?.run?.(a.params, c) ?? null;
}
export function actionName(a: ActionRef | null): string {
  if (!a) return "";
  const d = actionDef(a.type);
  if (!d) return "알 수 없는 기능";
  const pack = d.app ? APP_PACKS.find((p) => p.id === d.app) : undefined;
  return pack ? `${pack.name} · ${d.name}` : d.name;
}
export function actionLabel(a: ActionRef | null, c: Ctx): string {
  if (!a) return "";
  const d = actionDef(a.type);
  if (!d) return "";
  return d.label?.(a.params, c) || d.name;
}
export const actionIcon = (a: ActionRef | null) => (a ? actionDef(a.type)?.icon ?? "?" : "");

export const osOnlyText = (os: OS[]) =>
  os.length === 0 ? "사용 불가" : os.length === 1 ? (os[0] === "windows" ? "Windows 전용" : "Mac 전용") : "";
