// Data model shared by the editor, the device compiler and the runtime.
// Everything here is saved as one JSON file in the app data folder (see src-tauri/src/store.rs).

export type OS = "windows" | "mac";
export const OS_LIST: OS[] = ["windows", "mac"];
export const OS_LABEL: Record<OS, string> = { windows: "Windows", mac: "Mac" };

export const COLS = 5;
export const ROWS = 3;
export const KEY_COUNT = COLS * ROWS;
export const SCREEN_W = 480;
export const SCREEN_H = 320;
export const CELL_W = SCREEN_W / COLS; // 96
export const CELL_H = SCREEN_H / ROWS; // 106.67
export const SLOTS_PER_OS = 3;

export interface ActionRef {
  type: string; // catalog id, e.g. "hotkey", "app.photoshop.cut"
  params: Record<string, any>;
}

export interface Title {
  text: string;
  pos: "top" | "middle" | "bottom";
  size: number; // px on the device (cell is 96 x 107)
  color: string;
}

export type LiveKind = "clock" | "date" | "cpu" | "mem" | "timer";

export interface KeyVisual {
  kind: "none" | "text" | "image" | "live";
  text?: string;
  fg?: string;
  bg?: string;
  mediaId?: string; // image or GIF in the media folder
  live?: LiveKind;
  title?: Title;
}

export interface KeyCfg {
  tap: ActionRef | null;
  long: ActionRef | null;
  double: ActionRef | null;
  toggle: boolean; // two-state key: tap runs `tap` when off, `offTap` when on
  offTap: ActionRef | null;
  onVisual: KeyVisual;
  visual: KeyVisual;
}

// An image drawn across a rectangle of keys (c0..c1, r0..r1 inclusive)
export interface Span {
  id: string;
  c0: number; r0: number; c1: number; r1: number;
  mediaId: string;
  fit: "cover" | "contain";
}

export interface Page {
  id: string;
  name: string;
  keys: KeyCfg[];
  spans: Span[];
  folder: boolean; // folder pages are opened from a key and get a back key
}

export interface KnobCfg {
  cw: ActionRef | null;
  ccw: ActionRef | null;
  press: ActionRef | null;
  pressCw: ActionRef | null;
  pressCcw: ActionRef | null;
}

export interface FaderCfg {
  action: ActionRef | null; // receives the value 0..1000
}

export interface AppRule {
  process: string; // e.g. "Photoshop.exe" or "Adobe Photoshop 2026"
  pageId: string;
}

export interface Preset {
  id: string;
  name: string;
  os: OS;
  pages: Page[];
  knobs: KnobCfg[];
  faders: FaderCfg[];
  appRules: AppRule[];
}

export type MacroStep =
  | { kind: "hotkey"; keys: string }
  | { kind: "text"; text: string }
  | { kind: "delay"; ms: number }
  | { kind: "action"; action: ActionRef };

export interface Macro {
  id: string;
  name: string;
  steps: MacroStep[];
}

export interface Settings {
  autostart: boolean;
  startHidden: boolean;
  saverMinutes: number; // 0 = off
  autoSwitch: boolean; // switch pages by the app in front
  obs: { host: string; port: number; password: string };
}

export interface MediaInfo {
  id: string;
  kind: "image" | "gif" | "audio";
  ext: string;
  name: string;
  w: number;
  h: number;
  frames?: number;
}

export interface Store {
  version: 1;
  media: Record<string, MediaInfo>;
  slots: Record<OS, (Preset | null)[]>;
  active: Record<OS, number>;
  macros: Macro[];
  settings: Settings;
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export const emptyVisual = (): KeyVisual => ({ kind: "none" });
export const emptyKey = (): KeyCfg => ({
  tap: null, long: null, double: null, toggle: false, offTap: null,
  onVisual: emptyVisual(), visual: emptyVisual(),
});
export const emptyKnob = (): KnobCfg => ({ cw: null, ccw: null, press: null, pressCw: null, pressCcw: null });

export function newPage(name: string, folder = false): Page {
  const keys = Array.from({ length: KEY_COUNT }, emptyKey);
  if (folder) {
    keys[0] = { ...emptyKey(), tap: { type: "page.back", params: {} }, visual: { kind: "text", text: "← 뒤로" } };
  }
  return { id: uid(), name, keys, spans: [], folder };
}

export function newPreset(os: OS, name: string): Preset {
  const page = newPage("페이지 1");
  // Default page navigation on the bottom corners, like the device firmware expects
  page.keys[10] = { ...emptyKey(), tap: { type: "page.prev", params: {} }, visual: { kind: "text", text: "◀" } };
  page.keys[14] = { ...emptyKey(), tap: { type: "page.next", params: {} }, visual: { kind: "text", text: "▶" } };
  return {
    id: uid(), name, os, pages: [page],
    knobs: [
      { ...emptyKnob(), cw: { type: "media.volUp", params: {} }, ccw: { type: "media.volDown", params: {} }, press: { type: "media.mute", params: {} } },
      emptyKnob(),
    ],
    faders: [{ action: { type: "volume.system", params: {} } }, { action: null }],
    appRules: [],
  };
}

export function defaultStore(): Store {
  return {
    version: 1,
    media: {},
    slots: {
      windows: [newPreset("windows", "기본"), null, null],
      mac: [null, null, null],
    },
    active: { windows: 0, mac: 0 },
    macros: [],
    settings: {
      autostart: true, startHidden: true, saverMinutes: 0, autoSwitch: true,
      obs: { host: "localhost", port: 4455, password: "" },
    },
  };
}

export const otherOS = (os: OS): OS => (os === "windows" ? "mac" : "windows");

// The preset the device should use on `os`: the active slot of that OS, otherwise the other OS's
// active preset (its OS-only actions are then shown as unavailable).
export function resolvePreset(store: Store, os: OS): { preset: Preset | null; borrowed: boolean } {
  const own = store.slots[os][store.active[os]];
  if (own) return { preset: own, borrowed: false };
  const other = otherOS(os);
  const theirs = store.slots[other][store.active[other]] ?? store.slots[other].find((p) => p) ?? null;
  return { preset: theirs, borrowed: !!theirs };
}

export const keyIndex = (c: number, r: number) => r * COLS + c;
export const keyCol = (k: number) => k % COLS;
export const keyRow = (k: number) => Math.floor(k / COLS);

export function spanOfKey(page: Page, k: number): Span | undefined {
  const c = keyCol(k), r = keyRow(k);
  return page.spans.find((s) => c >= s.c0 && c <= s.c1 && r >= s.r0 && r <= s.r1);
}
