import { useEffect, useRef, useState } from "react";
import { COLS, KEY_COUNT, ROWS, SCREEN_H, SCREEN_W, resolvePreset, type Page, type Preset } from "../model";
import { drawOverlay, keyRect, renderPage, type Animated } from "../render";
import { actionIcon, actionLabel, actionName, actionOS, osOnlyText, supported, type Ctx } from "../catalog";
import type { ActionRef } from "../model";
import { makeCtx } from "../bundle";
import { gifFrames, type Frames } from "../media";
import { useLive } from "../live";
import { endDrag, isFileDrag, readDrop, useDrag } from "../dnd";
import { canDrop, dropFilesOnKey, dropOnFader, dropOnKey, dropOnKnob, rectKeys, rectOf } from "../drop";
import { useApp } from "../state";

// The OS used to judge "사용 불가" in the preview: this PC's OS when this preset is the one
// borrowed from the other OS, otherwise the preset's own OS.
export function usePreviewOS(preset: Preset) {
  const store = useApp((s) => s.store);
  const hostOS = useApp((s) => s.hostOS);
  const r = resolvePreset(store, hostOS);
  return r.borrowed && r.preset?.id === preset.id ? hostOS : preset.os;
}

export function DeckView({ preset, page, pageIdx }: { preset: Preset; page: Page; pageIdx: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const store = useApp((s) => s.store);
  const selection = useApp((s) => s.selection);
  const pressed = useApp((s) => s.pressed);
  const devicePage = useApp((s) => s.devicePage);
  const connected = useApp((s) => s.device.connected);
  const hostOS = useApp((s) => s.hostOS);
  const drag = useDrag((s) => s.item);
  const previewOS = usePreviewOS(preset);
  const hasLive = page.keys.some((k) => k.visual.kind === "live");
  const live = useLive((s) => (hasLive ? s.values : null));
  const [over, setOver] = useState<number | null>(null);
  const [dragSel, setDragSel] = useState<number | null>(null);

  // the device shows this page right now -> mirror its pressed keys
  const isLivePage = connected && resolvePreset(store, hostOS).preset?.id === preset.id && devicePage === pageIdx;

  // ---------------------------------------------------------------- drawing (static + GIF loop)
  useEffect(() => {
    let stop = false;
    let raf = 0;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const opts = { cat: makeCtx(store, previewOS, preset), live: live ?? useLive.getState().values };
    (async () => {
      const off = new OffscreenCanvas(SCREEN_W, SCREEN_H);
      const animated: Animated[] = await renderPage(off.getContext("2d")!, page, opts);
      if (stop) return;
      ctx.drawImage(off, 0, 0);
      if (!animated.length) return;
      const frames: (Frames | null)[] = await Promise.all(animated.map((a) => gifFrames(a.mediaId).catch(() => null)));
      const t0 = performance.now();
      const loop = () => {
        if (stop) return;
        const t = performance.now() - t0;
        animated.forEach((a, i) => {
          const f = frames[i];
          if (!f) return;
          const total = f.delays.reduce((x, y) => x + y, 0);
          let rem = t % total, fi = 0;
          while (rem >= f.delays[fi]) { rem -= f.delays[fi]; fi++; }
          const r = a.rect;
          ctx.save();
          ctx.beginPath(); ctx.roundRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 10); ctx.clip();
          ctx.fillStyle = "#000"; ctx.fillRect(r.x, r.y, r.w, r.h);
          const s = a.fit === "cover" ? Math.max((r.w - 6) / f.w, (r.h - 6) / f.h) : Math.min((r.w - 6) / f.w, (r.h - 6) / f.h);
          ctx.drawImage(f.frames[fi], r.x + (r.w - f.w * s) / 2, r.y + (r.h - f.h * s) / 2, f.w * s, f.h * s);
          ctx.restore();
          for (const k of a.keys) drawOverlay(ctx, keyRect(k), page.keys[k], opts);
        });
        raf = requestAnimationFrame(loop);
      };
      loop();
    })();
    return () => { stop = true; cancelAnimationFrame(raf); };
  }, [page, store.media, store.macros, previewOS, preset, live]);

  // ---------------------------------------------------------------- selection
  const selKeys = selection?.kind === "keys" ? selection.keys : [];
  const select = (keys: number[]) => useApp.setState({ selection: { kind: "keys", keys } });
  const anchor = useRef<number | null>(null);

  const onDown = (k: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchor.current != null) {
      select(rectKeys(rectOf([anchor.current, k])));
      return;
    }
    anchor.current = k;
    setDragSel(k);
    select([k]);
  };
  const onEnter = (k: number) => {
    if (dragSel != null) select(rectKeys(rectOf([dragSel, k])));
  };
  useEffect(() => {
    const up = () => setDragSel(null);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <div className="deck">
      <div className="screen-wrap">
        <div className="screen">
          <canvas ref={canvasRef} width={SCREEN_W} height={SCREEN_H} />
          {Array.from({ length: KEY_COUNT }, (_, k) => {
            const r = keyRect(k);
            const cls = [
              "key",
              selKeys.includes(k) ? "sel" : "",
              over === k ? "over" : "",
              drag && canDrop(drag, "key") ? "can" : "",
              isLivePage && pressed.has(k) ? "pressed" : "",
            ].join(" ");
            return (
              <div key={k} className={cls}
                style={{ left: pct(r.x, SCREEN_W), top: pct(r.y, SCREEN_H), width: pct(r.w, SCREEN_W), height: pct(r.h, SCREEN_H) }}
                onMouseDown={(e) => onDown(k, e)}
                onMouseEnter={() => onEnter(k)}
                onDragOver={(e) => { if (isFileDrag(e) || canDrop(useDrag.getState().item, "key")) { e.preventDefault(); setOver(k); } }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => {
                  e.preventDefault(); setOver(null);
                  if (e.dataTransfer.files.length) { endDrag(); dropFilesOnKey(k, e.dataTransfer.files); return; }
                  const item = readDrop(e);
                  if (item?.kind === "pickMedia") { pickFile((f) => dropFilesOnKey(k, f)); return; }
                  if (item && dropOnKey(k, item)) select([k]);
                }}
                title={`키 ${k + 1}${page.keys[k].tap ? ` · ${actionName(page.keys[k].tap)}` : ""}`}
              >
                {(page.keys[k].long || page.keys[k].double || page.keys[k].toggle) && (
                  <span className="key-flags">
                    {page.keys[k].long && "⏳"}{page.keys[k].double && "⏩"}{page.keys[k].toggle && "⇆"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="screen-caption muted small">
          {COLS}×{ROWS} 키 · 드래그해서 여러 칸 선택 · 이미지·GIF·영상 파일을 키에 바로 끌어다 놓아도 돼요
          {previewOS !== preset.os && <b className="warn-text"> · 이 PC({previewOS === "windows" ? "Windows" : "Mac"}) 기준으로 표시 중</b>}
        </div>
      </div>
      <Controls preset={preset} />
    </div>
  );
}

export function pickFile(cb: (f: FileList) => void, accept = "image/*,video/*,.gif") {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = () => input.files?.length && cb(input.files);
  input.click();
}

// ------------------------------------------------------------------ knobs and faders
// "아이콘 이름" plus a red badge when the action does not work on the previewed OS
function ActionLine({ a, cat }: { a: ActionRef | null; cat: Ctx }) {
  if (!a) return <>—</>;
  const bad = supported(a, cat) ? "" : osOnlyText(actionOS(a, cat)) || "사용 불가";
  return (
    <>
      {actionIcon(a)} {a.type === "hotkey" ? actionLabel(a, cat) : actionName(a)}
      {bad && <span className="badge bad">{bad}</span>}
    </>
  );
}

function Controls({ preset }: { preset: Preset }) {
  const store = useApp((s) => s.store);
  const cat = makeCtx(store, usePreviewOS(preset), preset);
  const selection = useApp((s) => s.selection);
  const faderValues = useApp((s) => s.faderValues);
  const drag = useDrag((s) => s.item);
  const [over, setOver] = useState<string | null>(null);

  const zone = (id: string, ok: boolean, onDrop: (e: React.DragEvent) => void) => ({
    className: `${ok ? "can" : ""} ${over === id ? "over" : ""}`,
    onDragOver: (e: React.DragEvent) => { if (ok) { e.preventDefault(); setOver(id); } },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(null); onDrop(e); },
  });

  return (
    <div className="controls">
      {preset.knobs.map((kn, i) => {
        const z = zone(`k${i}`, canDrop(drag, "knobKey"), (e) => {
          const item = readDrop(e);
          if (!item) return;
          const isDial = item.kind === "action" && item.slots.includes("dial");
          if (dropOnKnob(i, isDial ? "rotate" : "press", item)) useApp.setState({ selection: { kind: "knob", id: i } });
        });
        const sel = selection?.kind === "knob" && selection.id === i;
        return (
          <div key={`k${i}`} {...z} className={`ctl knob ${sel ? "sel" : ""} ${z.className}`}
            onClick={() => useApp.setState({ selection: { kind: "knob", id: i } })}>
            <div className="knob-face">{i + 1}</div>
            <div className="ctl-info">
              <b>노브 {i + 1}</b> <span className="muted small">{i === 0 ? "(뒤)" : "(앞)"}</span>
              <div className="small">↻ <ActionLine a={kn.cw} cat={cat} /></div>
              <div className="small">↺ <ActionLine a={kn.ccw} cat={cat} /></div>
              <div className="small">⏺ <ActionLine a={kn.press} cat={cat} /></div>
            </div>
          </div>
        );
      })}
      <div className="faders">
        {preset.faders.map((f, i) => {
          const z = zone(`f${i}`, canDrop(drag, "fader"), (e) => {
            const item = readDrop(e);
            if (item && dropOnFader(i, item)) useApp.setState({ selection: { kind: "fader", id: i } });
          });
          const sel = selection?.kind === "fader" && selection.id === i;
          const v = faderValues[i];
          return (
            <div key={`f${i}`} {...z} className={`ctl fader ${sel ? "sel" : ""} ${z.className}`}
              onClick={() => useApp.setState({ selection: { kind: "fader", id: i } })}>
              <div className="fader-track"><div className="fader-fill" style={{ height: `${v < 0 ? 0 : v / 10}%` }} /></div>
              <b>페이더 {i + 1}</b>
              <span className="small center"><ActionLine a={f.action} cat={cat} /></span>
              {v >= 0 && <span className="muted small">{v}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

