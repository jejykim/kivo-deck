// Turns the preset for this PC's OS into
//  - the device bundle: config.json + page JPEGs + GIFs (docs/protocol.md "번들")
//  - the runtime table the PC app uses for actions the device hands over ({a:1})
import { KEY_COUNT, resolvePreset, type ActionRef, type OS, type Page, type Preset, type Store } from "./model";
import { actionHid, actionRun, supported, type Ctx, type DevAction, type Op } from "./catalog";
import { drawOverlay, keyRect, renderPage, type LiveValues, type Rect } from "./render";
import { encodeGif, gifFrames } from "./media";

export interface DevKey {
  tap: DevAction | null; long: DevAction | null; dbl: DevAction | null;
  tg?: 1; off?: DevAction | null; on?: string;
}
export interface DevPage { img: string; folder?: 1; keys: DevKey[]; gifs: { f: string; x: number; y: number; w: number; h: number }[]; live: number[] }
export interface DevKnob { cw: DevAction | null; ccw: DevAction | null; pr: DevAction | null; pcw: DevAction | null; pccw: DevAction | null }
export interface DevConfig { v: 1; os: OS; saver: number; pages: DevPage[]; knobs: DevKnob[] }

export interface RuntimeKey { tap: Op | null; long: Op | null; double: Op | null; offTap: Op | null }
export interface Runtime {
  os: OS;
  pages: { keys: RuntimeKey[] }[];
  knobs: { cw: Op | null; ccw: Op | null; press: Op | null; pressCw: Op | null; pressCcw: Op | null }[];
  faders: (Op | null)[];
  appRules: { process: string; page: number }[];
  autoSwitch: boolean;
  obs: { host: string; port: number; password: string };
}

export interface Bundle {
  preset: Preset | null;
  borrowed: boolean;
  config: DevConfig;
  files: { path: string; data: Uint8Array }[];
  runtime: Runtime;
  hash: string;
}

export function makeCtx(store: Store, os: OS, preset: Preset | null): Ctx {
  return { os, store, pageIndex: (id) => preset?.pages.findIndex((p) => p.id === id) ?? -1 };
}

const DEVICE_GIF_FRAMES = 90;

function devAction(a: ActionRef | null, c: Ctx): DevAction | null {
  if (!a || !supported(a, c)) return null;
  const hid = actionHid(a, c);
  if (hid) return hid;
  return actionRun(a, c) ? { a: 1 } : null;
}
// Ops only for actions the device does not run itself
function runOp(a: ActionRef | null, c: Ctx): Op | null {
  if (!a || !supported(a, c) || actionHid(a, c)) return null;
  return actionRun(a, c);
}

async function jpeg(canvas: OffscreenCanvas): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  return new Uint8Array(await blob.arrayBuffer());
}

async function sha256(parts: Uint8Array[]): Promise<string> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
  return Array.from(d.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Live keys are drawn with placeholders: the app pushes real values as tiles every second,
// and the bundle hash must not change with the clock.
export const LIVE_PLACEHOLDER: LiveValues = { clock: "--:--", date: "--", timer: "00:00", cpu: 0, mem: 0, gpus: [], hist: {} };

export async function buildBundle(store: Store, os: OS): Promise<Bundle> {
  const live = LIVE_PLACEHOLDER;
  const { preset, borrowed } = resolvePreset(store, os);
  const cat = makeCtx(store, os, preset);
  const files: Bundle["files"] = [];
  const pages: DevPage[] = [];
  const rtPages: Runtime["pages"] = [];

  for (const [pi, page] of (preset?.pages ?? []).entries()) {
    const canvas = new OffscreenCanvas(480, 320);
    const ctx = canvas.getContext("2d")!;
    const opts = { cat, live };
    const animated = await renderPage(ctx, page, opts);
    const img = `/b/p${pi}.jpg`;
    files.push({ path: img, data: await jpeg(canvas) });

    const gifs: DevPage["gifs"] = [];
    for (const [gi, a] of animated.entries()) {
      const f = await gifFrames(a.mediaId);
      const path = `/b/p${pi}g${gi}.gif`;
      const data = encodeGif(f, a.rect.w, a.rect.h, a.fit, DEVICE_GIF_FRAMES, (g) => {
        // titles and badges of the keys under the GIF, shifted into the GIF's own coordinates
        for (const k of a.keys) {
          const r = keyRect(k);
          drawOverlay(g as any, { x: r.x - a.rect.x, y: r.y - a.rect.y, w: r.w, h: r.h }, page.keys[k], opts);
        }
      });
      files.push({ path, data });
      gifs.push({ f: path, ...a.rect });
    }

    const keys: DevKey[] = [];
    const rtKeys: RuntimeKey[] = [];
    for (let k = 0; k < KEY_COUNT; k++) {
      const key = page.keys[k];
      const dk: DevKey = { tap: devAction(key.tap, cat), long: devAction(key.long, cat), dbl: devAction(key.double, cat) };
      if (key.toggle) {
        dk.tg = 1;
        dk.off = devAction(key.offTap, cat);
        const tile = await keyTile(page, k, { cat, live, toggleOn: new Set([k]) });
        const path = `/b/p${pi}k${k}.jpg`;
        files.push({ path, data: tile });
        dk.on = path;
      }
      keys.push(dk);
      rtKeys.push({ tap: runOp(key.tap, cat), long: runOp(key.long, cat), double: runOp(key.double, cat), offTap: runOp(key.offTap, cat) });
    }
    const live_ = page.keys.flatMap((key, k) => (key.visual.kind === "live" ? [k] : []));
    pages.push({ img, ...(page.folder ? { folder: 1 as const } : {}), keys, gifs, live: live_ });
    rtPages.push({ keys: rtKeys });
  }

  const knobs = (preset?.knobs ?? []).map((kn) => ({
    cw: devAction(kn.cw, cat), ccw: devAction(kn.ccw, cat), pr: devAction(kn.press, cat),
    pcw: devAction(kn.pressCw, cat), pccw: devAction(kn.pressCcw, cat),
  }));
  const config: DevConfig = { v: 1, os, saver: store.settings.saverMinutes, pages, knobs };
  const runtime: Runtime = {
    os,
    pages: rtPages,
    knobs: (preset?.knobs ?? []).map((kn) => ({
      cw: runOp(kn.cw, cat), ccw: runOp(kn.ccw, cat), press: runOp(kn.press, cat),
      pressCw: runOp(kn.pressCw, cat), pressCcw: runOp(kn.pressCcw, cat),
    })),
    faders: (preset?.faders ?? []).map((f) => (f.action && supported(f.action, cat) ? actionRun(f.action, cat) : null)),
    appRules: (preset?.appRules ?? [])
      .map((r) => ({ process: r.process, page: cat.pageIndex(r.pageId) }))
      .filter((r) => r.process && r.page >= 0),
    autoSwitch: store.settings.autoSwitch,
    obs: store.settings.obs,
  };
  const configBytes = new TextEncoder().encode(JSON.stringify(config));
  const hash = await sha256([configBytes, ...files.flatMap((f) => [new TextEncoder().encode(f.path), f.data])]);
  return { preset, borrowed, config, files, runtime, hash };
}

// One key rendered alone (toggle "on" picture and live tiles)
export async function keyTile(page: Page, k: number, opts: Parameters<typeof renderPage>[2]): Promise<Uint8Array> {
  const r: Rect = keyRect(k);
  const full = new OffscreenCanvas(480, 320);
  await renderPage(full.getContext("2d")!, page, { ...opts, animatedAsStill: true });
  const tile = new OffscreenCanvas(r.w, r.h);
  tile.getContext("2d")!.drawImage(full, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return jpeg(tile);
}
