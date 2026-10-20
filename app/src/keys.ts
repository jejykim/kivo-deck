// Hotkey strings like "Mod+Shift+K". Mod = Ctrl on Windows, Cmd on Mac.
// Win / Cmd make a hotkey OS-only. The same names are parsed by src-tauri/src/actions.rs.
import type { OS } from "./model";

export const MODIFIERS = ["Mod", "Ctrl", "Shift", "Alt", "Win", "Cmd"] as const;

// HID keyboard usage IDs (USB HID Usage Tables, page 0x07)
const USAGE: Record<string, number> = {
  Enter: 0x28, Esc: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c,
  "-": 0x2d, "=": 0x2e, "[": 0x2f, "]": 0x30, "\\": 0x31, ";": 0x33, "'": 0x34, "`": 0x35,
  ",": 0x36, ".": 0x37, "/": 0x38, CapsLock: 0x39, PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48,
  Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e,
  Right: 0x4f, Left: 0x50, Down: 0x51, Up: 0x52,
};
for (let i = 0; i < 26; i++) USAGE[String.fromCharCode(65 + i)] = 0x04 + i;
for (let i = 1; i <= 9; i++) USAGE[String(i)] = 0x1d + i;
USAGE["0"] = 0x27;
for (let i = 1; i <= 12; i++) USAGE[`F${i}`] = 0x39 + i;
for (let i = 13; i <= 24; i++) USAGE[`F${i}`] = 0x68 + (i - 13);

export const KEY_NAMES = Object.keys(USAGE);

const MOD_BIT = { Ctrl: 1, Shift: 2, Alt: 4, Gui: 8 };

export interface ParsedHotkey { mods: string[]; key: string }

export function parseHotkey(s: string): ParsedHotkey | null {
  const parts = s.split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const norm = key.length === 1 ? key.toUpperCase() : key;
  if (!(norm in USAGE)) return null;
  if (mods.some((m) => !(MODIFIERS as readonly string[]).includes(m))) return null;
  return { mods, key: norm };
}

export function hotkeyOS(s: string): OS[] {
  const p = parseHotkey(s);
  if (!p) return [];
  if (p.mods.includes("Win")) return ["windows"];
  if (p.mods.includes("Cmd")) return ["mac"];
  return ["windows", "mac"];
}

// For the device: [modifier bits, usage]
export function hotkeyToHid(s: string, os: OS): [number, number] | null {
  const p = parseHotkey(s);
  if (!p) return null;
  let bits = 0;
  for (const m of p.mods) {
    if (m === "Ctrl") bits |= MOD_BIT.Ctrl;
    else if (m === "Shift") bits |= MOD_BIT.Shift;
    else if (m === "Alt") bits |= MOD_BIT.Alt;
    else if (m === "Win" || m === "Cmd") bits |= MOD_BIT.Gui;
    else if (m === "Mod") bits |= os === "mac" ? MOD_BIT.Gui : MOD_BIT.Ctrl;
  }
  return [bits, USAGE[p.key]];
}

export function prettyHotkey(s: string, os: OS): string {
  const p = parseHotkey(s);
  if (!p) return s;
  const name = (m: string) =>
    m === "Mod" ? (os === "mac" ? "⌘" : "Ctrl") : m === "Cmd" ? "⌘" : m === "Alt" && os === "mac" ? "⌥" : m;
  return [...p.mods.map(name), p.key].join(os === "mac" ? "" : "+");
}

// Turns a keydown event into a hotkey string (used by the "record" box)
export function hotkeyFromEvent(e: KeyboardEvent, os: OS): string | null {
  const map: Record<string, string> = {
    " ": "Space", Escape: "Esc", ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down",
  };
  let key = map[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (e.code.startsWith("Key")) key = e.code.slice(3);
  if (e.code.startsWith("Digit")) key = e.code.slice(5);
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  if (!(key in USAGE)) return null;
  const mods: string[] = [];
  if (os === "mac") {
    if (e.metaKey) mods.push("Mod");
    if (e.ctrlKey) mods.push("Ctrl");
  } else {
    if (e.ctrlKey) mods.push("Mod");
    if (e.metaKey) mods.push("Win");
  }
  if (e.shiftKey) mods.push("Shift");
  if (e.altKey) mods.push("Alt");
  return [...mods, key].join("+");
}
