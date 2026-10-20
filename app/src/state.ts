// App-wide state (zustand). The Store is saved to disk shortly after every change;
// it reaches the device only when the user presses "적용".
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { defaultStore, type OS, type Page, type Preset, type Store } from "./model";

export type Selection =
  | { kind: "keys"; keys: number[] }
  | { kind: "knob"; id: number }
  | { kind: "fader"; id: number }
  | null;

export interface DeviceInfo {
  connected: boolean;
  port: string | null;
  hello: Record<string, any> | null;
}

export interface LogLine { t: number; text: string; kind: "in" | "out" | "err" | "sys" }

interface AppState {
  loaded: boolean;
  store: Store;
  hostOS: OS;
  editOS: OS;
  editSlot: number;
  pageIdx: number;
  selection: Selection;
  device: DeviceInfo;
  devicePage: number;
  pressed: Set<number>;
  faderValues: number[];
  appliedHash: string | null; // hash of the last bundle sent to the device
  draftHash: string | null; // hash of what would be sent now
  log: LogLine[];
  recentApps: string[]; // programs seen in front (for page auto-switch rules)
  update: (fn: (s: Store) => void) => void;
  set: (p: Partial<AppState>) => void;
  addLog: (text: string, kind: LogLine["kind"]) => void;
}

let saveTimer: number | undefined;
function scheduleSave(store: Store) {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    invoke("save_store", { json: JSON.stringify(store) }).catch((e) => console.error("save failed", e));
  }, 400);
}

export const useApp = create<AppState>((set, get) => ({
  loaded: false,
  store: defaultStore(),
  hostOS: "windows",
  editOS: "windows",
  editSlot: 0,
  pageIdx: 0,
  selection: null,
  device: { connected: false, port: null, hello: null },
  devicePage: 0,
  pressed: new Set(),
  faderValues: [-1, -1],
  appliedHash: null,
  draftHash: null,
  log: [],
  recentApps: [],
  update: (fn) => {
    const next = structuredClone(get().store);
    fn(next);
    set({ store: next });
    scheduleSave(next);
  },
  set: (p) => set(p),
  addLog: (text, kind) => set((s) => ({ log: [{ t: Date.now(), text, kind }, ...s.log].slice(0, 400) })),
}));

export async function loadStore() {
  const hostOS = (await invoke<string>("host_os")) as OS;
  let store: Store | null = null;
  try {
    const json = await invoke<string | null>("load_store");
    if (json) store = JSON.parse(json);
  } catch (e) {
    console.error("load failed", e);
  }
  if (!store) {
    store = defaultStore();
    if (hostOS === "mac") {
      // first run on a Mac: start with a Mac preset instead
      store.slots.mac[0] = { ...store.slots.windows[0]!, os: "mac" };
      store.slots.windows[0] = null;
    }
    invoke("save_store", { json: JSON.stringify(store) });
  }
  useApp.setState({ store, hostOS, editOS: hostOS, editSlot: store.active[hostOS], loaded: true });
}

// --- selectors
export function editingPreset(s: AppState): Preset | null {
  return s.store.slots[s.editOS][s.editSlot] ?? null;
}
export function editingPage(s: AppState): Page | null {
  const p = editingPreset(s);
  return p ? p.pages[Math.min(s.pageIdx, p.pages.length - 1)] ?? null : null;
}

// Mutates the preset being edited (no-op if the slot is empty)
export function updatePreset(fn: (p: Preset, store: Store) => void) {
  const { editOS, editSlot, update } = useApp.getState();
  update((s) => {
    const p = s.slots[editOS][editSlot];
    if (p) fn(p, s);
  });
}
export function updatePage(fn: (pg: Page, p: Preset) => void) {
  const { pageIdx } = useApp.getState();
  updatePreset((p) => {
    const pg = p.pages[Math.min(pageIdx, p.pages.length - 1)];
    if (pg) fn(pg, p);
  });
}
