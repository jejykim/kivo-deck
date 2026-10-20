// Draws a page exactly as the device shows it (480 x 320). Used for the editor preview and for the
// JPEG/GIF files sent to the device, so both always match.
import {
  CELL_W, COLS, KEY_COUNT, ROWS, SCREEN_H, SCREEN_W, keyCol, keyRow, spanOfKey,
  type KeyCfg, type KeyVisual, type Page, type Span,
} from "./model";
import { actionIcon, actionLabel, actionOS, osOnlyText, supported, type Ctx } from "./catalog";
import { fitRect, gifFrames, mediaBytes } from "./media";
import { useApp } from "./state";

export interface Rect { x: number; y: number; w: number; h: number }

export function keyRect(k: number): Rect {
  const c = keyCol(k), r = keyRow(k);
  const y0 = Math.round((r * SCREEN_H) / ROWS), y1 = Math.round(((r + 1) * SCREEN_H) / ROWS);
  return { x: c * CELL_W, y: y0, w: CELL_W, h: y1 - y0 };
}
export function spanRect(s: Span): Rect {
  const a = keyRect(s.r0 * COLS + s.c0), b = keyRect(s.r1 * COLS + s.c1);
  return { x: a.x, y: a.y, w: b.x + b.w - a.x, h: b.y + b.h - a.y };
}

export interface LiveValues { clock: string; date: string; cpu: string; mem: string; timer: string }

export interface RenderOpts {
  cat: Ctx;
  live: LiveValues;
  toggleOn?: Set<number>;
  animatedAsStill?: boolean; // editor: draw the first GIF frame under the animated <img> overlay
}

export interface Animated { mediaId: string; rect: Rect; fit: "cover" | "contain"; keys: number[] }

// ------------------------------------------------------------------ image cache
const bitmaps = new Map<string, Promise<ImageBitmap>>();
export function mediaBitmap(id: string): Promise<ImageBitmap> {
  let p = bitmaps.get(id);
  if (!p) {
    const info = useApp.getState().store.media[id];
    p = info?.kind === "gif"
      ? gifFrames(id).then((f) => f.frames[0])
      : mediaBytes(id).then((b) => createImageBitmap(new Blob([b as BlobPart])));
    bitmaps.set(id, p);
  }
  return p;
}

// ------------------------------------------------------------------ helpers
type C2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
const FONT = `"Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", "Segoe UI Emoji", sans-serif`;

function roundRect(ctx: C2D, r: Rect, rad: number) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, rad);
}

function fitText(ctx: C2D, text: string, r: Rect, maxSize: number, weight = 600) {
  const lines = text.split("\n");
  let size = maxSize;
  for (; size > 9; size -= 1) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest <= r.w && lines.length * size * 1.15 <= r.h) break;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const total = lines.length * size * 1.15;
  lines.forEach((l, i) => ctx.fillText(l, r.x + r.w / 2, r.y + (r.h - total) / 2 + size * 1.15 * (i + 0.5)));
}

function inset(r: Rect, d: number): Rect {
  return { x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d };
}

export function liveText(kind: string, live: LiveValues) {
  return (live as any)[kind] ?? "";
}

// Visual of a key in the current state (toggle on -> onVisual when it has content)
export function currentVisual(key: KeyCfg, on: boolean): KeyVisual {
  return on && key.toggle && key.onVisual.kind !== "none" ? key.onVisual : key.visual;
}

// The first unsupported action of a key on this OS, as badge text ("Mac 전용" ...)
export function unsupportedText(key: KeyCfg, cat: Ctx): string {
  for (const a of [key.tap, key.long, key.double, key.offTap]) {
    if (a && !supported(a, cat)) return osOnlyText(actionOS(a, cat)) || "사용 불가";
  }
  return "";
}

// Content of one key (not the span image): background, image, text or auto icon, title, badge
export async function drawKey(ctx: C2D, r: Rect, key: KeyCfg, page: Page, k: number, o: RenderOpts, skipMedia = false) {
  const on = !!o.toggleOn?.has(k);
  const v = currentVisual(key, on);
  const inner = inset(r, 3);
  const inSpan = !!spanOfKey(page, k);

  if (!inSpan) {
    ctx.fillStyle = v.bg ?? "#1b1d24";
    roundRect(ctx, inner, 10);
    ctx.fill();
  }
  if (v.kind === "image" && v.mediaId && !skipMedia) {
    const bmp = await mediaBitmap(v.mediaId).catch(() => null);
    if (bmp) {
      ctx.save();
      roundRect(ctx, inner, 10);
      ctx.clip();
      const f = fitRect(bmp.width, bmp.height, inner.w, inner.h, "cover");
      ctx.drawImage(bmp, inner.x + f.x, inner.y + f.y, f.w, f.h);
      ctx.restore();
    }
  } else if (v.kind === "text" && v.text) {
    ctx.fillStyle = v.fg ?? "#ffffff";
    fitText(ctx, v.text, inset(inner, 6), 34);
  } else if (v.kind === "live" && v.live) {
    ctx.fillStyle = v.fg ?? "#ffffff";
    fitText(ctx, liveText(v.live, o.live), inset(inner, 6), 30, 700);
  } else if (v.kind === "none" && key.tap && !inSpan) {
    // no picture chosen: show the action's icon and short label, like Stream Deck does
    ctx.fillStyle = "#ffffff";
    fitText(ctx, actionIcon(key.tap), { x: inner.x, y: inner.y + 8, w: inner.w, h: inner.h * 0.5 }, 34, 400);
    ctx.fillStyle = "#c9cbd6";
    fitText(ctx, actionLabel(key.tap, o.cat), { x: inner.x + 4, y: inner.y + inner.h * 0.6, w: inner.w - 8, h: inner.h * 0.32 }, 14);
  }
  if (on && key.toggle && key.onVisual.kind === "none") {
    // toggle on without its own picture: draw a green dot
    ctx.fillStyle = "#22c55e";
    ctx.beginPath(); ctx.arc(inner.x + inner.w - 10, inner.y + 10, 5, 0, Math.PI * 2); ctx.fill();
  }
  drawOverlay(ctx, r, key, o, on);
}

// Title text and the "unavailable" badge; also burned into GIF frames for the device
export function drawOverlay(ctx: C2D, r: Rect, key: KeyCfg, o: RenderOpts, on = false) {
  const v = currentVisual(key, on);
  const inner = inset(r, 3);
  if (v.title?.text) {
    const t = v.title;
    ctx.font = `700 ${t.size}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = t.pos === "top" ? "top" : t.pos === "bottom" ? "bottom" : "middle";
    const y = t.pos === "top" ? inner.y + 5 : t.pos === "bottom" ? inner.y + inner.h - 5 : inner.y + inner.h / 2;
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(t.text, inner.x + inner.w / 2, y, inner.w - 6);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, inner.x + inner.w / 2, y, inner.w - 6);
  }
  const bad = unsupportedText(key, o.cat);
  if (bad) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(ctx, inner, 10); ctx.fill();
    ctx.fillStyle = "#dc2626";
    const band = { x: inner.x, y: inner.y + inner.h / 2 - 13, w: inner.w, h: 26 };
    ctx.fillRect(band.x, band.y, band.w, band.h);
    ctx.fillStyle = "#fff";
    fitText(ctx, bad, inset(band, 2), 13, 700);
  }
}

// Whole page. Returns the regions that are animated (GIF) so callers can play or export them.
export async function renderPage(ctx: C2D, page: Page, o: RenderOpts): Promise<Animated[]> {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  const animated: Animated[] = [];
  const media = useApp.getState().store.media;

  for (const s of page.spans) {
    const r = spanRect(s);
    const keys: number[] = [];
    for (let rr = s.r0; rr <= s.r1; rr++) for (let cc = s.c0; cc <= s.c1; cc++) keys.push(rr * COLS + cc);
    const isGif = media[s.mediaId]?.kind === "gif";
    if (isGif) animated.push({ mediaId: s.mediaId, rect: r, fit: s.fit, keys });
    if (!isGif || o.animatedAsStill) {
      const bmp = await mediaBitmap(s.mediaId).catch(() => null);
      if (bmp) {
        ctx.save();
        roundRect(ctx, inset(r, 3), 10); ctx.clip();
        const f = fitRect(bmp.width, bmp.height, r.w - 6, r.h - 6, s.fit);
        ctx.drawImage(bmp, r.x + 3 + f.x, r.y + 3 + f.y, f.w, f.h);
        ctx.restore();
      }
    }
  }
  for (let k = 0; k < KEY_COUNT; k++) {
    const key = page.keys[k];
    const v = currentVisual(key, !!o.toggleOn?.has(k));
    const gif = v.kind === "image" && v.mediaId && media[v.mediaId]?.kind === "gif";
    if (gif) animated.push({ mediaId: v.mediaId!, rect: keyRect(k), fit: "cover", keys: [k] });
    await drawKey(ctx, keyRect(k), key, page, k, o, !!gif && !o.animatedAsStill);
  }
  return animated;
}
