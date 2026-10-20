// Images, GIFs, sounds: import, video -> GIF conversion, decoding and caching.
// Bytes live in the app data folder (src-tauri/src/store.rs); the Store only keeps MediaInfo.
import { invoke } from "@tauri-apps/api/core";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { parseGIF, decompressFrames } from "gifuct-js";
import { uid, type MediaInfo } from "./model";
import { useApp } from "./state";

export interface Frames { w: number; h: number; frames: ImageBitmap[]; delays: number[] }

const urlCache = new Map<string, string>();
const bytesCache = new Map<string, Uint8Array>();
const frameCache = new Map<string, Promise<Frames>>();

const MAX_IMAGE_W = 960;
const MAX_IMAGE_H = 640;

const mime = (ext: string) =>
  ({ png: "image/png", jpg: "image/jpeg", gif: "image/gif", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4" } as Record<string, string>)[ext] ??
  "application/octet-stream";

export const toB64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function mediaBytes(id: string): Promise<Uint8Array> {
  const hit = bytesCache.get(id);
  if (hit) return hit;
  const info = useApp.getState().store.media[id];
  const b64 = await invoke<string>("load_media", { name: `${id}.${info?.ext ?? "bin"}` });
  const bytes = fromB64(b64);
  bytesCache.set(id, bytes);
  return bytes;
}

export async function mediaUrl(id: string): Promise<string> {
  const hit = urlCache.get(id);
  if (hit) return hit;
  const info = useApp.getState().store.media[id];
  const url = URL.createObjectURL(new Blob([(await mediaBytes(id)) as BlobPart], { type: mime(info?.ext ?? "") }));
  urlCache.set(id, url);
  return url;
}

async function saveMedia(info: Omit<MediaInfo, "id">, bytes: Uint8Array): Promise<MediaInfo> {
  const id = uid();
  await invoke("save_media", { name: `${id}.${info.ext}`, b64: toB64(bytes) });
  bytesCache.set(id, bytes);
  const full = { ...info, id };
  useApp.getState().update((s) => { s.media[id] = full; });
  return full;
}

// Fully composited GIF frames (handles partial frames and disposal)
export function gifFrames(id: string): Promise<Frames> {
  let p = frameCache.get(id);
  if (!p) {
    p = mediaBytes(id).then((b) => decodeGif(b));
    frameCache.set(id, p);
  }
  return p;
}

async function decodeGif(bytes: Uint8Array): Promise<Frames> {
  const gif = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const raw = decompressFrames(gif, true);
  const w = gif.lsd.width, h = gif.lsd.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  const patchCanvas = new OffscreenCanvas(w, h);
  const pctx = patchCanvas.getContext("2d")!;
  const frames: ImageBitmap[] = [];
  const delays: number[] = [];
  for (const f of raw) {
    const before = f.disposalType === 3 ? ctx.getImageData(0, 0, w, h) : null;
    const { width, height, top, left } = f.dims;
    patchCanvas.width = width; patchCanvas.height = height;
    pctx.putImageData(new ImageData(new Uint8ClampedArray(f.patch), width, height), 0, 0);
    ctx.drawImage(patchCanvas, left, top);
    frames.push(await createImageBitmap(canvas));
    delays.push(Math.max(20, f.delay || 100));
    if (f.disposalType === 2) ctx.clearRect(left, top, width, height);
    else if (before) ctx.putImageData(before, 0, 0);
  }
  return { w, h, frames, delays };
}

// ------------------------------------------------------------------ import

export function fileKind(file: File): "image" | "gif" | "video" | "audio" | null {
  if (file.type === "image/gif" || /\.gif$/i.test(file.name)) return "gif";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name)) return "video";
  if (file.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a)$/i.test(file.name)) return "audio";
  return null;
}

export async function importImage(file: File): Promise<MediaInfo> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_W / bmp.width, MAX_IMAGE_H / bmp.height);
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = new OffscreenCanvas(w, h);
  c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  const blob = await c.convertToBlob({ type: "image/png" });
  return saveMedia({ kind: "image", ext: "png", name: file.name, w, h }, new Uint8Array(await blob.arrayBuffer()));
}

export async function importGif(file: File): Promise<MediaInfo> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const f = await decodeGif(bytes);
  // Large GIFs are re-encoded smaller right away so the editor and the device stay fast
  if (f.w > MAX_IMAGE_W || f.h > MAX_IMAGE_H || f.frames.length > 300) {
    const scale = Math.min(1, MAX_IMAGE_W / f.w, MAX_IMAGE_H / f.h);
    const out = encodeGif(f, Math.round(f.w * scale), Math.round(f.h * scale), "contain", 300);
    return saveMedia({ kind: "gif", ext: "gif", name: file.name, w: Math.round(f.w * scale), h: Math.round(f.h * scale), frames: Math.min(300, f.frames.length) }, out);
  }
  const info = await saveMedia({ kind: "gif", ext: "gif", name: file.name, w: f.w, h: f.h, frames: f.frames.length }, bytes);
  frameCache.set(info.id, Promise.resolve(f));
  return info;
}

export async function importAudio(file: File): Promise<MediaInfo> {
  const ext = (file.name.split(".").pop() ?? "mp3").toLowerCase();
  return saveMedia({ kind: "audio", ext, name: file.name, w: 0, h: 0 }, new Uint8Array(await file.arrayBuffer()));
}

// ------------------------------------------------------------------ video -> GIF

export interface VideoMeta { duration: number; w: number; h: number }
export interface VideoOpts { start: number; seconds: number; fps: number; maxW: number; maxH: number }

export function videoMeta(file: File): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata"; v.muted = true;
    v.src = URL.createObjectURL(file);
    v.onloadedmetadata = () => resolve({ duration: v.duration, w: v.videoWidth, h: v.videoHeight });
    v.onerror = () => reject(new Error("영상을 읽을 수 없어요 (지원하지 않는 형식일 수 있어요)"));
  });
}

// Rough GIF size estimate so the user can pick settings before converting
export const estimateGifBytes = (o: VideoOpts, w: number, h: number) => Math.round(w * h * 0.45 * o.seconds * o.fps);

export async function importVideo(file: File, o: VideoOpts, onProgress: (p: number) => void): Promise<MediaInfo> {
  const v = document.createElement("video");
  v.muted = true; v.preload = "auto";
  v.src = URL.createObjectURL(file);
  await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error("영상을 읽을 수 없어요")); });
  const scale = Math.min(1, o.maxW / v.videoWidth, o.maxH / v.videoHeight);
  const w = Math.max(1, Math.round(v.videoWidth * scale)), h = Math.max(1, Math.round(v.videoHeight * scale));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const enc = GIFEncoder();
  const count = Math.max(1, Math.floor(o.seconds * o.fps));
  const delay = Math.round(1000 / o.fps);
  let palette: number[][] | null = null;
  for (let i = 0; i < count; i++) {
    const t = Math.min(v.duration - 0.01, o.start + i / o.fps);
    await new Promise((r) => { v.onseeked = r; v.currentTime = t; });
    ctx.drawImage(v, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    // refresh the palette every 10 frames: keeps colors right without flicker on every frame
    if (!palette || i % 10 === 0) palette = quantize(rgba, 256);
    enc.writeFrame(applyPalette(rgba, palette), w, h, { palette, delay });
    onProgress((i + 1) / count);
  }
  enc.finish();
  URL.revokeObjectURL(v.src);
  const name = file.name.replace(/\.[^.]+$/, "") + ".gif";
  return saveMedia({ kind: "gif", ext: "gif", name, w, h, frames: count }, enc.bytes());
}

// ------------------------------------------------------------------ GIF re-encode (device export)

// Draws `src` (w x h) into a box with cover / contain fitting
export function fitRect(sw: number, sh: number, w: number, h: number, fit: "cover" | "contain") {
  const s = fit === "cover" ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
  const dw = sw * s, dh = sh * s;
  return { x: (w - dw) / 2, y: (h - dh) / 2, w: dw, h: dh };
}

export function encodeGif(
  f: Frames, w: number, h: number, fit: "cover" | "contain", maxFrames = 120,
  overlay?: (ctx: OffscreenCanvasRenderingContext2D) => void,
): Uint8Array {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const enc = GIFEncoder();
  const step = Math.max(1, Math.ceil(f.frames.length / maxFrames));
  let palette: number[][] | null = null;
  for (let i = 0; i < f.frames.length; i += step) {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
    const r = fitRect(f.w, f.h, w, h, fit);
    ctx.drawImage(f.frames[i], r.x, r.y, r.w, r.h);
    overlay?.(ctx);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    if (!palette || (i / step) % 10 === 0) palette = quantize(rgba, 256);
    let delay = 0;
    for (let j = i; j < Math.min(i + step, f.frames.length); j++) delay += f.delays[j];
    enc.writeFrame(applyPalette(rgba, palette), w, h, { palette, delay });
  }
  enc.finish();
  return enc.bytes();
}

// ------------------------------------------------------------------ sound playback (runtime "sound" op)
export async function playSound(id: string) {
  const a = new Audio(await mediaUrl(id));
  a.play().catch(() => {});
}
