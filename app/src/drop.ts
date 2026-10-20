// What happens when something is dropped on a key, knob or fader
import { actionDef } from "./catalog";
import { COLS, KEY_COUNT, keyCol, keyRow, uid, type ActionRef, type KnobCfg, type Page } from "./model";
import type { DragItem } from "./dnd";
import { updatePage, updatePreset, useApp } from "./state";
import { create } from "zustand";
import type { MediaInfo } from "./model";

export type KnobZone = "cw" | "ccw" | "press" | "pressCw" | "pressCcw" | "rotate" | "pressRotate";

// Media placement / video conversion dialog requests (MediaDialog.tsx)
export interface MediaRequest { file?: File; media?: MediaInfo; keys: number[]; target: "visual" | "onVisual" }
export const useMediaRequest = create<{ req: MediaRequest | null }>(() => ({ req: null }));

export function rectOf(keys: number[]) {
  const cs = keys.map(keyCol), rs = keys.map(keyRow);
  return { c0: Math.min(...cs), c1: Math.max(...cs), r0: Math.min(...rs), r1: Math.max(...rs) };
}
export function rectKeys(r: { c0: number; c1: number; r0: number; r1: number }) {
  const out: number[] = [];
  for (let rr = r.r0; rr <= r.r1; rr++) for (let cc = r.c0; cc <= r.c1; cc++) out.push(rr * COLS + cc);
  return out;
}

// Removes spans that overlap the given keys
export function clearSpans(page: Page, keys: number[]) {
  page.spans = page.spans.filter((s) => !rectKeys(s).some((k) => keys.includes(k)));
}

function withParams(a: ActionRef, extra: Record<string, any>): ActionRef {
  return { type: a.type, params: { ...a.params, ...extra } };
}

export function dropOnKey(k: number, item: DragItem) {
  if (item.kind === "action") {
    const def = actionDef(item.ref.type);
    if (!def?.slots.includes("key")) return false;
    updatePage((pg) => { pg.keys[k].tap = structuredClone(item.ref); });
    return true;
  }
  if (item.kind === "visual") {
    updatePage((pg) => {
      clearSpans(pg, [k]);
      pg.keys[k].visual = { ...structuredClone(item.visual), title: pg.keys[k].visual.title };
    });
    return true;
  }
  return false;
}

export function dropFilesOnKey(k: number, files: FileList) {
  const file = files[0];
  if (!file) return;
  const { selection } = useApp.getState();
  // dropping on a key that is part of a multi-key selection places the image over the selection
  const keys = selection?.kind === "keys" && selection.keys.length > 1 && selection.keys.includes(k) ? selection.keys : [k];
  useMediaRequest.setState({ req: { file, keys, target: "visual" } });
}

export function dropOnKnob(id: number, zone: KnobZone, item: DragItem) {
  if (item.kind !== "action") return false;
  const def = actionDef(item.ref.type);
  if (!def) return false;
  updatePreset((p) => {
    const kn: KnobCfg = p.knobs[id];
    if (def.dial) {
      // a dial action fills both directions (in the pressed or normal row)
      const pressed = zone === "pressCw" || zone === "pressCcw" || zone === "pressRotate";
      kn[pressed ? "pressCw" : "cw"] = withParams(def.dial.cw, item.ref.params);
      kn[pressed ? "pressCcw" : "ccw"] = withParams(def.dial.ccw, item.ref.params);
    } else if (def.slots.includes("key")) {
      const z = zone === "rotate" ? "cw" : zone === "pressRotate" ? "pressCw" : zone;
      kn[z] = structuredClone(item.ref);
    }
  });
  return true;
}

export function dropOnFader(id: number, item: DragItem) {
  if (item.kind !== "action") return false;
  if (!actionDef(item.ref.type)?.slots.includes("fader")) return false;
  updatePreset((p) => { p.faders[id].action = structuredClone(item.ref); });
  return true;
}

export function canDrop(item: DragItem | null, target: "key" | "dial" | "knobKey" | "fader") {
  if (!item) return false;
  if (item.kind !== "action") return target === "key";
  const slots = item.slots;
  if (target === "knobKey") return slots.includes("key") || slots.includes("dial");
  return slots.includes(target);
}

export function placeSpan(keys: number[], mediaId: string, fit: "cover" | "contain") {
  const r = rectOf(keys);
  updatePage((pg) => {
    const ks = rectKeys(r);
    clearSpans(pg, ks);
    if (ks.length === 1) {
      pg.keys[ks[0]].visual = { ...pg.keys[ks[0]].visual, kind: "image", mediaId };
    } else {
      for (const k of ks) if (pg.keys[k].visual.kind === "image") pg.keys[k].visual = { kind: "none", title: pg.keys[k].visual.title };
      pg.spans.push({ id: uid(), ...r, mediaId, fit });
    }
  });
}

export const allKeys = () => Array.from({ length: KEY_COUNT }, (_, i) => i);
