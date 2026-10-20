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
  kind: "text" | "hotkey" | "number" | "page" | "macro" | "file" | "app" | "url" | "process" | "media" | "bool" | "audioOut" | "audioIn";
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
  | { op: "seq"; steps: Op[] }
  | { op: "launchApp"; names: string[] }
  | { op: "terminal"; command: string }
  | { op: "exec"; program: string; args: string[] }
  | { op: "audioDevice"; id: string }
  | { op: "audioNext"; input: boolean }
  | { op: "http"; method: "GET" | "POST"; url: string; body?: string };

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
    params: [{ key: "process", label: "프로그램", kind: "process", placeholder: "프로그램 이름 (예: chrome.exe)" }],
    os: () => ["windows"], // macOS has no per-app volume API
    run: (p) => ({ op: "volume", target: "app", process: p.process ?? "" }),
    label: (p) => p.process ?? "",
  },
  {
    id: "dial.appVolume", name: "앱별 볼륨 (노브)", icon: "🎛", category: "미디어", slots: ["dial"],
    params: [{ key: "process", label: "프로그램", kind: "process", placeholder: "프로그램 이름 (예: chrome.exe)" }],
    os: () => ["windows"],
    dial: { cw: ref("volume.appStep", { step: 2 }), ccw: ref("volume.appStep", { step: -2 }) },
  },
  {
    id: "volume.appStep", name: "앱 볼륨 한 칸", icon: "🎛", category: "숨김", slots: [],
    params: [{ key: "process", label: "프로그램", kind: "process", placeholder: "프로그램 이름 (예: chrome.exe)" }],
    os: () => ["windows"],
    run: (p) => ({ op: "volume", target: "app", process: p.process ?? "", step: p.step ?? 2 }),
  },
  {
    id: "sound.play", name: "소리 재생 (사운드보드)", icon: "🔔", category: "미디어", slots: ["key"],
    params: [{ key: "mediaId", label: "소리 파일", kind: "media" }],
    run: (p) => (p.mediaId ? { op: "sound", mediaId: p.mediaId } : null),
  },
  // Windows only for now: changing the default device needs an API macOS does not expose to scripts
  {
    id: "audio.output", name: "출력 장치 바꾸기 (스피커·이어폰)", icon: "🎧", category: "미디어", slots: ["key"],
    params: [{ key: "deviceId", label: "바꿀 장치", kind: "audioOut" }],
    os: () => ["windows"],
    run: (p) => (p.deviceId ? { op: "audioDevice", id: p.deviceId } : null),
    label: (p) => p.name ?? "",
  },
  {
    id: "audio.outputNext", name: "출력 장치 차례로 바꾸기", icon: "🔀", category: "미디어", slots: ["key"],
    os: () => ["windows"],
    run: () => ({ op: "audioNext", input: false }),
  },
  {
    id: "audio.input", name: "입력 장치 바꾸기 (마이크)", icon: "🎙", category: "미디어", slots: ["key"],
    params: [{ key: "deviceId", label: "바꿀 마이크", kind: "audioIn" }],
    os: () => ["windows"],
    run: (p) => (p.deviceId ? { op: "audioDevice", id: p.deviceId } : null),
    label: (p) => p.name ?? "",
  },
  {
    id: "audio.inputNext", name: "입력 장치 차례로 바꾸기", icon: "🔀", category: "미디어", slots: ["key"],
    os: () => ["windows"],
    run: () => ({ op: "audioNext", input: true }),
  },

  // ---------------------------------------------------------------- 열기
  {
    id: "open.app", name: "앱 실행", icon: "🚀", category: "열기", slots: ["key"],
    params: [{ key: "target", label: "앱", kind: "app", placeholder: "프로그램 위치 (예: C:\\Program Files\\앱\\app.exe)" }],
    os: (p) => pathOS(p.target),
    run: (p) => (p.target ? { op: "open", target: p.target } : null),
    label: (p) => baseName(p.target),
  },
  {
    id: "open.file", name: "파일 · 폴더 열기", icon: "📂", category: "열기", slots: ["key"],
    params: [{ key: "target", label: "파일·폴더", kind: "file", placeholder: "파일·폴더 위치 (예: C:\\Users\\나\\Documents)" }],
    os: (p) => pathOS(p.target),
    run: (p) => (p.target ? { op: "open", target: p.target } : null),
    label: (p) => baseName(p.target),
  },
  {
    id: "open.url", name: "웹사이트 열기", icon: "🌐", category: "열기", slots: ["key"],
    params: [{ key: "target", label: "주소", kind: "url", placeholder: "웹 주소 (예: https://youtube.com)" }],
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

// keys: one hotkey for both OS, or { windows, mac } when they differ
type Keys = string | Record<OS, string>;
const keysFor = (k: Keys, os: OS) => (typeof k === "string" ? k : k[os]);

function shortcut(app: string, id: string, name: string, keys: Keys, icon = "⌨"): ActionDef {
  return {
    id: `app.${app}.${id}`, name, icon, category: "앱", app, slots: ["key"],
    os: () => (typeof keys === "string" ? hotkeyOS(keys) : BOTH),
    hid: (_p, c) => hotkeyHid(keysFor(keys, c.os), c.os),
    run: (_p, c) => ({ op: "hotkey", keys: keysFor(keys, c.os) }),
  };
}
// Opens the app (or brings it to the front). names: how it is called in the Start menu / Applications
function launch(app: string, appName: string, names: string[]): ActionDef {
  return {
    id: `app.${app}.open`, name: `${appName} 열기`, icon: "🚀", category: "앱", app, slots: ["key"],
    run: () => ({ op: "launchApp", names }),
  };
}
// AI apps: opens the app, types the text and (optionally) sends it
function prompt(app: string, names: string[]): ActionDef {
  return {
    id: `app.${app}.prompt`, name: "질문 보내기", icon: "💬", category: "앱", app, slots: ["key"],
    params: [
      { key: "text", label: "보낼 글", kind: "text" },
      { key: "submit", label: "바로 보내기 (Enter까지 누름)", kind: "bool" },
    ],
    run: (p) => (p.text ? {
      op: "seq",
      steps: [{ op: "launchApp", names }, { op: "delay", ms: 1000 }, { op: "text", text: p.text }, ...(p.submit !== false ? [{ op: "hotkey" as const, keys: "Enter" }] : [])],
    } : null),
    label: (p) => (p.text ?? "").slice(0, 14),
  };
}
function openUrl(app: string, id: string, name: string, url: string, icon = "🌐"): ActionDef {
  return { id: `app.${app}.${id}`, name, icon, category: "앱", app, slots: ["key"], run: () => ({ op: "open", target: url }) };
}
const COMFY_DEFAULT = "http://127.0.0.1:8188";
const comfyServer: ParamDef = { key: "server", label: "ComfyUI 주소", kind: "url", placeholder: `비워 두면 ${COMFY_DEFAULT}` };
function comfyApi(id: string, name: string, icon: string, path: string, body?: object): ActionDef {
  return {
    id: `app.comfyui.${id}`, name, icon, category: "앱", app: "comfyui", slots: ["key"],
    params: [comfyServer],
    run: (p) => ({ op: "http", method: "POST", url: `${(p.server || COMFY_DEFAULT).replace(/\/$/, "")}${path}`, body: body ? JSON.stringify(body) : undefined }),
  };
}
const ollamaModel: ParamDef = { key: "model", label: "모델", kind: "text", placeholder: "모델 이름 (예: llama3.2, gemma3)" };

// Editor shortcuts shared by VS Code and editors built on it (Antigravity)
function codeEditor(app: string): ActionDef[] {
  return [
    shortcut(app, "palette", "명령 팔레트", "Mod+Shift+P", "⌘"),
    shortcut(app, "quickOpen", "파일 빠르게 열기", "Mod+P", "🔎"),
    shortcut(app, "terminal", "터미널 열기 / 닫기", "Ctrl+`", "🖥"),
    shortcut(app, "sidebar", "사이드바 열기 / 닫기", "Mod+B", "◧"),
    shortcut(app, "explorer", "탐색기", "Mod+Shift+E", "📁"),
    shortcut(app, "search", "전체 검색", "Mod+Shift+F", "🔍"),
    shortcut(app, "git", "소스 제어", "Ctrl+Shift+G", "🌿"),
    shortcut(app, "extensions", "확장", "Mod+Shift+X", "🧩"),
    shortcut(app, "save", "저장", "Mod+S", "💾"),
    shortcut(app, "comment", "줄 주석", "Mod+/", "💬"),
    shortcut(app, "format", "문서 서식 맞추기", "Shift+Alt+F", "✨"),
    shortcut(app, "split", "편집기 나누기", "Mod+\\", "◫"),
    shortcut(app, "definition", "정의로 이동", "F12", "↗"),
    shortcut(app, "rename", "이름 바꾸기", "F2", "✏"),
    shortcut(app, "debug", "디버그 시작 / 계속", "F5", "▶"),
    shortcut(app, "stopDebug", "디버그 중지", "Shift+F5", "⏹"),
    shortcut(app, "closeTab", "탭 닫기", { windows: "Ctrl+F4", mac: "Mod+W" }, "✕"),
    shortcutDial(app, "moveLine", "줄 위 / 아래로 옮기기 (노브)", "Alt+Down", "Alt+Up", "↕"),
    shortcutDial(app, "zoom", "글자 크게 / 작게 (노브)", "Mod+=", "Mod+-", "🔍"),
  ];
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
  {
    id: "premiere", name: "Premiere Pro", icon: "🎞",
    note: "프리미어 프로 기본 단축키로 동작해요. 프리미어 프로가 앞에 있을 때 눌러 주세요.",
    actions: [
      launch("premiere", "Premiere Pro", ["Adobe Premiere Pro 2026", "Adobe Premiere Pro", "Premiere Pro"]),
      shortcut("premiere", "play", "재생 / 정지", "Space", "⏯"),
      shortcut("premiere", "addEdit", "재생 헤드에서 자르기", "Mod+K", "✂"),
      shortcut("premiere", "addEditAll", "모든 트랙 자르기", "Mod+Shift+K", "✂"),
      shortcut("premiere", "rippleDelete", "잔물결 삭제", "Shift+Delete", "⌫"),
      shortcut("premiere", "selection", "선택 도구", "V", "↖"),
      shortcut("premiere", "razor", "자르기 도구", "C", "🔪"),
      shortcut("premiere", "trackSelect", "트랙 앞으로 선택 도구", "A", "⇥"),
      shortcut("premiere", "rippleEdit", "잔물결 편집 도구", "B", "⇿"),
      shortcut("premiere", "text", "문자 도구", "T", "T"),
      shortcut("premiere", "markIn", "시작 표시 (In)", "I", "["),
      shortcut("premiere", "markOut", "종료 표시 (Out)", "O", "]"),
      shortcut("premiere", "marker", "마커 추가", "M", "📍"),
      shortcut("premiere", "prevEdit", "이전 편집 지점", "Up", "⏮"),
      shortcut("premiere", "nextEdit", "다음 편집 지점", "Down", "⏭"),
      shortcut("premiere", "maximize", "패널 최대화", "`", "⛶"),
      shortcut("premiere", "zoomFit", "타임라인 전체 보기", "\\", "↔"),
      shortcut("premiere", "undo", "실행 취소", "Mod+Z", "↶"),
      shortcut("premiere", "redo", "다시 실행", "Mod+Shift+Z", "↷"),
      shortcut("premiere", "save", "저장", "Mod+S", "💾"),
      shortcut("premiere", "export", "내보내기", "Mod+M", "📤"),
      shortcutDial("premiere", "frame", "한 프레임씩 이동 (노브)", "Right", "Left", "🎞"),
      shortcutDial("premiere", "shuttle", "빨리 감기 / 되감기 (노브)", "L", "J", "⏩"),
      shortcutDial("premiere", "timelineZoom", "타임라인 확대 / 축소 (노브)", "=", "-", "🔍"),
      shortcutDial("premiere", "editPoint", "편집 지점 이동 (노브)", "Down", "Up", "⇅"),
    ],
  },
  {
    id: "figma", name: "Figma", icon: "🎨",
    note: "피그마 기본 단축키로 동작해요. 피그마가 앞에 있을 때 눌러 주세요.",
    actions: [
      launch("figma", "Figma", ["Figma"]),
      shortcut("figma", "move", "이동 도구", "V", "↖"),
      shortcut("figma", "frame", "프레임", "F", "#"),
      shortcut("figma", "rect", "사각형", "R", "▭"),
      shortcut("figma", "ellipse", "원", "O", "◯"),
      shortcut("figma", "line", "선", "L", "╱"),
      shortcut("figma", "arrow", "화살표", "Shift+L", "→"),
      shortcut("figma", "pen", "펜", "P", "✒"),
      shortcut("figma", "text", "텍스트", "T", "T"),
      shortcut("figma", "comment", "댓글", "C", "💬"),
      shortcut("figma", "eyedropper", "스포이드", "I", "💧"),
      shortcut("figma", "group", "그룹", "Mod+G", "▣"),
      shortcut("figma", "ungroup", "그룹 해제", "Mod+Shift+G", "▢"),
      shortcut("figma", "frameSelection", "선택 영역을 프레임으로", "Mod+Alt+G", "⬚"),
      shortcut("figma", "component", "컴포넌트 만들기", "Mod+Alt+K", "❖"),
      shortcut("figma", "autoLayout", "오토 레이아웃", "Shift+A", "☰"),
      shortcut("figma", "duplicate", "복제", "Mod+D", "⧉"),
      shortcut("figma", "zoomFit", "전체 보기", "Shift+1", "⛶"),
      shortcut("figma", "zoomSelection", "선택한 것 크게 보기", "Shift+2", "🔍"),
      shortcut("figma", "zoom100", "100%로 보기", "Shift+0", "1:1"),
      shortcut("figma", "hideUI", "화면 도구 숨기기", "Mod+\\", "◻"),
      shortcut("figma", "export", "내보내기", "Mod+Shift+E", "📤"),
      shortcut("figma", "undo", "실행 취소", "Mod+Z", "↶"),
      shortcut("figma", "redo", "다시 실행", "Mod+Shift+Z", "↷"),
      shortcutDial("figma", "zoom", "확대 / 축소 (노브)", "Shift+=", "-", "🔍"),
      shortcutDial("figma", "history", "작업 내역 앞 / 뒤 (노브)", "Mod+Shift+Z", "Mod+Z", "🕘"),
    ],
  },
  {
    id: "claude", name: "Claude", icon: "✳",
    note: "Claude 데스크톱 앱이에요. 단축키는 버전마다 달라서, 앱 열기와 질문 보내기만 넣었어요.",
    actions: [launch("claude", "Claude", ["Claude"]), prompt("claude", ["Claude"])],
  },
  {
    id: "chatgpt", name: "ChatGPT", icon: "🤖",
    note: "ChatGPT 데스크톱 앱의 기본 단축키로 동작해요.",
    actions: [
      launch("chatgpt", "ChatGPT", ["ChatGPT"]),
      prompt("chatgpt", ["ChatGPT"]),
      shortcut("chatgpt", "newChat", "새 대화", "Mod+Shift+O", "➕"),
      shortcut("chatgpt", "sidebar", "사이드바 열기 / 닫기", "Mod+Shift+S", "◧"),
      shortcut("chatgpt", "copyLast", "마지막 답변 복사", "Mod+Shift+C", "📋"),
      shortcut("chatgpt", "focusInput", "입력창으로 이동", "Shift+Esc", "⌨"),
      shortcut("chatgpt", "companion", "빠른 창 열기", "Alt+Space", "⚡"),
    ],
  },
  {
    id: "harness", name: "DeepSeek 하네스", icon: "🐋",
    note: "DeepSeek Harness 데스크톱 앱이에요(프리뷰). 단축키가 아직 정해지지 않아 앱 열기와 질문 보내기만 넣었어요.",
    actions: [launch("harness", "하네스", ["DeepSeek Harness", "Harness"]), prompt("harness", ["DeepSeek Harness", "Harness"])],
  },
  {
    id: "steam", name: "Steam", icon: "🎮",
    note: "스팀 주소(steam://)로 동작해서 스팀이 꺼져 있어도 켜면서 열어요.",
    actions: [
      openUrl("steam", "open", "스팀 열기", "steam://open/main", "🚀"),
      openUrl("steam", "library", "라이브러리", "steam://open/games", "📚"),
      openUrl("steam", "store", "상점", "steam://store", "🛒"),
      openUrl("steam", "friends", "친구", "steam://open/friends", "👥"),
      openUrl("steam", "downloads", "다운로드", "steam://open/downloads", "⬇"),
      openUrl("steam", "bigpicture", "빅 픽처 모드", "steam://open/bigpicture", "📺"),
      {
        id: "app.steam.run", name: "게임 실행", icon: "🎮", category: "앱", app: "steam", slots: ["key"],
        params: [{ key: "appid", label: "게임 번호", kind: "text", placeholder: "상점 주소의 숫자 (예: 570)" }],
        run: (p) => (p.appid ? { op: "open", target: `steam://rungameid/${String(p.appid).trim()}` } : null),
        label: (p) => p.appid ?? "",
      },
      shortcut("steam", "screenshot", "스크린샷 (게임 중)", "F12", "📸"),
      shortcut("steam", "overlay", "스팀 오버레이 (게임 중)", "Shift+Tab", "🪟"),
    ],
  },
  {
    id: "ollama", name: "Ollama", icon: "🦙",
    note: "Ollama가 설치되어 있어야 해요. 모델 이름은 터미널의 `ollama list`에 나오는 이름 그대로 넣어 주세요.",
    actions: [
      launch("ollama", "Ollama", ["Ollama"]),
      prompt("ollama", ["Ollama"]),
      {
        id: "app.ollama.chat", name: "모델과 대화 (터미널)", icon: "🖥", category: "앱", app: "ollama", slots: ["key"],
        params: [ollamaModel],
        run: (p) => (p.model ? { op: "terminal", command: `ollama run ${p.model}` } : null),
        label: (p) => p.model ?? "",
      },
      {
        id: "app.ollama.stop", name: "모델 메모리에서 내리기", icon: "⏏", category: "앱", app: "ollama", slots: ["key"],
        params: [ollamaModel],
        run: (p) => (p.model ? { op: "exec", program: "ollama", args: ["stop", p.model] } : null),
        label: (p) => p.model ?? "",
      },
      { id: "app.ollama.ps", name: "실행 중인 모델 보기", icon: "📋", category: "앱", app: "ollama", slots: ["key"], run: () => ({ op: "terminal", command: "ollama ps" }) },
    ],
  },
  {
    id: "vscode", name: "VS Code", icon: "🧑‍💻",
    note: "VS Code 기본 단축키로 동작해요. VS Code가 앞에 있을 때 눌러 주세요.",
    actions: [
      launch("vscode", "VS Code", ["Visual Studio Code", "Code"]),
      {
        id: "app.vscode.folder", name: "폴더 열기", icon: "📂", category: "앱", app: "vscode", slots: ["key"],
        params: [{ key: "path", label: "폴더", kind: "file", placeholder: "폴더 위치 (예: F:\\kivo-deck)" }],
        run: (p) => (p.path ? { op: "open", target: `vscode://file/${String(p.path).replace(/\\/g, "/")}` } : null),
        label: (p) => baseName(p.path),
      },
      ...codeEditor("vscode"),
    ],
  },
  {
    id: "antigravity", name: "Antigravity", icon: "🪐",
    note: "구글 Antigravity예요. VS Code를 바탕으로 만들어져서 편집기 단축키가 같아요.",
    actions: [
      launch("antigravity", "Antigravity", ["Antigravity"]),
      shortcut("antigravity", "agentManager", "편집기 ↔ 에이전트 매니저", "Mod+E", "🤖"),
      ...codeEditor("antigravity"),
    ],
  },
  {
    id: "comfyui", name: "ComfyUI", icon: "🧪",
    note: "단축키는 ComfyUI 화면이 앞에 있을 때, 생성 중지·대기열·VRAM은 ComfyUI 서버에 바로 요청해서 언제든 동작해요.",
    actions: [
      launch("comfyui", "ComfyUI", ["ComfyUI", "Comfy Desktop"]),
      shortcut("comfyui", "queue", "생성 실행 (대기열에 넣기)", "Mod+Enter", "▶"),
      shortcut("comfyui", "queueFront", "맨 앞에 넣기", "Mod+Shift+Enter", "⏫"),
      comfyApi("interrupt", "생성 중지", "⏹", "/interrupt"),
      comfyApi("clearQueue", "대기열 비우기", "🗑", "/queue", { clear: true }),
      comfyApi("free", "VRAM 비우기 (모델 내리기)", "🧹", "/free", { unload_models: true, free_memory: true }),
      shortcut("comfyui", "save", "워크플로 저장", "Mod+S", "💾"),
      shortcut("comfyui", "openWf", "워크플로 열기", "Mod+O", "📂"),
      shortcut("comfyui", "default", "기본 워크플로 불러오기", "Mod+D", "🏠"),
      shortcut("comfyui", "mute", "노드 끄기 (Mute)", "Mod+M", "🔇"),
      shortcut("comfyui", "bypass", "노드 건너뛰기 (Bypass)", "Mod+B", "⤼"),
      shortcut("comfyui", "fit", "전체 노드 보기", ".", "⛶"),
      shortcut("comfyui", "undo", "실행 취소", "Mod+Z", "↶"),
      shortcut("comfyui", "redo", "다시 실행", "Mod+Y", "↷"),
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
