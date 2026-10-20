import { useEffect, useMemo, useState } from "react";
import { CELL_H, CELL_W, COLS, ROWS, keyCol, keyRow, type MediaInfo } from "../model";
import { estimateGifBytes, fileKind, importAudio, importGif, importImage, importVideo, mediaUrl, videoMeta, type VideoMeta } from "../media";
import { placeSpan, rectKeys, rectOf, useMediaRequest, type MediaRequest } from "../drop";
import { updatePage, useApp } from "../state";
import { Modal } from "./Modal";

interface Shape { c0: number; r0: number; c1: number; r1: number; cols: number; rows: number; score: number; why: string }

// Ranks key rectangles for an image: close aspect ratio first, then enough resolution, then bigger
export function recommendShapes(w: number, h: number, anchor: number): Shape[] {
  const ar = w / h;
  const out: Shape[] = [];
  for (let cols = 1; cols <= COLS; cols++) {
    for (let rows = 1; rows <= ROWS; rows++) {
      const rw = cols * CELL_W, rh = rows * CELL_H;
      const fitErr = Math.abs(Math.log(ar / (rw / rh)));
      const upscale = Math.max(rw / w, rh / h);
      const score = fitErr + Math.max(0, Math.log2(upscale)) * 0.6 - 0.015 * cols * rows;
      const c0 = Math.min(Math.max(0, keyCol(anchor)), COLS - cols);
      const r0 = Math.min(Math.max(0, keyRow(anchor)), ROWS - rows);
      const why = fitErr < 0.12 ? "비율이 거의 같아요" : fitErr < 0.3 ? "가장자리가 조금 잘려요" : "많이 잘려요";
      out.push({ c0, r0, c1: c0 + cols - 1, r1: r0 + rows - 1, cols, rows, score, why: upscale > 1.5 ? `${why} · 이미지가 작아 흐릿할 수 있어요` : why });
    }
  }
  return out.sort((a, b) => a.score - b.score);
}

// A 5x3 mini grid with the rectangle highlighted
function MiniGrid({ c0, r0, c1, r1 }: { c0: number; r0: number; c1: number; r1: number }) {
  return (
    <div className="mini-grid">
      {Array.from({ length: COLS * ROWS }, (_, k) => {
        const c = keyCol(k), r = keyRow(k);
        return <i key={k} className={c >= c0 && c <= c1 && r >= r0 && r <= r1 ? "on" : ""} />;
      })}
    </div>
  );
}

export function MediaDialog() {
  const req = useMediaRequest((s) => s.req);
  if (!req) return null;
  return <MediaFlow req={req} onClose={() => useMediaRequest.setState({ req: null })} />;
}

function MediaFlow({ req, onClose }: { req: MediaRequest; onClose: () => void }) {
  const addLog = useApp((s) => s.addLog);
  const [media, setMedia] = useState<MediaInfo | null>(req.media ?? null);
  const [error, setError] = useState("");
  const kind = req.file ? fileKind(req.file) : null;

  // images, GIFs and sounds import right away; videos go through the converter first
  useEffect(() => {
    if (!req.file || media) return;
    if (kind === "image") importImage(req.file).then(setMedia, (e) => setError(String(e)));
    else if (kind === "gif") importGif(req.file).then(setMedia, (e) => setError(String(e)));
    else if (kind === "audio") {
      importAudio(req.file).then((m) => {
        updatePage((pg) => { pg.keys[req.keys[0]].tap = { type: "sound.play", params: { mediaId: m.id } }; });
        addLog(`소리 "${m.name}"을(를) 키 ${req.keys[0] + 1}에 넣었어요`, "sys");
        onClose();
      }, (e) => setError(String(e)));
    } else if (kind === null) setError("이미지(PNG·JPG), GIF, 영상(MP4·MOV·WEBM), 소리(MP3·WAV) 파일만 넣을 수 있어요");
  }, []);

  if (error) {
    return <Modal title="파일을 넣을 수 없어요" onClose={onClose}><p className="err-text">{error}</p></Modal>;
  }
  if (kind === "video" && !media) {
    return <VideoConvert file={req.file!} keys={req.keys} onDone={setMedia} onClose={onClose} />;
  }
  if (!media) return <Modal title="불러오는 중…"><p className="muted">잠시만요…</p></Modal>;
  return <Placement media={media} req={req} onClose={onClose} />;
}

function Placement({ media, req, onClose }: { media: MediaInfo; req: MediaRequest; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  useEffect(() => { mediaUrl(media.id).then(setUrl); }, [media.id]);

  const anchor = req.keys[0];
  const multi = req.keys.length > 1;
  const shapes = useMemo(() => recommendShapes(media.w, media.h, anchor), [media, anchor]);
  const best = shapes.filter((s) => s.cols * s.rows > 1).slice(0, 3);
  const big = media.w > CELL_W * 2 || media.h > CELL_H * 2;
  const single = shapes.find((s) => s.cols === 1 && s.rows === 1)!;

  const place = (keys: number[]) => {
    if (req.target === "onVisual") {
      updatePage((pg) => { pg.keys[keys[0]].onVisual = { ...pg.keys[keys[0]].onVisual, kind: "image", mediaId: media.id }; });
    } else {
      placeSpan(keys, media.id, fit);
    }
    useApp.setState({ selection: { kind: "keys", keys: [keys[0]] } });
    onClose();
  };

  // small image on one key, or the "on" picture of a toggle: no question needed
  useEffect(() => {
    if (req.target === "onVisual" || (!multi && !big)) place([anchor]);
  }, []);
  if (req.target === "onVisual" || (!multi && !big)) return null;

  const sel = rectOf(req.keys);
  const selShape = recommendShapes(media.w, media.h, anchor).find((s) => s.cols === sel.c1 - sel.c0 + 1 && s.rows === sel.r1 - sel.r0 + 1);

  return (
    <Modal title="이미지를 어떻게 놓을까요?" onClose={onClose} wide>
      <div className="row top">
        {url && <img className="preview" src={url} alt="" />}
        <div className="grow">
          <p>{media.name} · {media.w}×{media.h}{media.frames ? ` · ${media.frames}프레임` : ""}</p>
          <p className="muted small">키 한 칸은 {CELL_W}×{Math.round(CELL_H)} 픽셀이에요. 여러 칸에 걸치면 키 사이 아크릴 틈만큼 이음매가 보여요.</p>
          <div className="row">
            <span className="small">맞추기:</span>
            <div className="seg small">
              <button className={fit === "cover" ? "on" : ""} onClick={() => setFit("cover")}>꽉 채우기 (가장자리 잘림)</button>
              <button className={fit === "contain" ? "on" : ""} onClick={() => setFit("contain")}>전체 보이기 (여백)</button>
            </div>
          </div>
        </div>
      </div>
      <div className="shapes">
        {multi && (
          <button className="shape primary-outline" onClick={() => place(rectKeys(sel))}>
            <MiniGrid {...sel} />
            <b>선택한 {sel.c1 - sel.c0 + 1}×{sel.r1 - sel.r0 + 1} 칸에 넣기</b>
            <span className="muted small">{selShape?.why}</span>
          </button>
        )}
        {best.map((s, i) => (
          <button key={`${s.cols}x${s.rows}`} className="shape" onClick={() => place(rectKeys(s))}>
            <MiniGrid {...s} />
            <b>{i === 0 && !multi ? "추천 · " : ""}{s.cols}×{s.rows} 칸</b>
            <span className="muted small">{s.why}</span>
          </button>
        ))}
        <button className="shape" onClick={() => place([anchor])}>
          <MiniGrid c0={keyCol(anchor)} r0={keyRow(anchor)} c1={keyCol(anchor)} r1={keyRow(anchor)} />
          <b>키 1칸에만</b>
          <span className="muted small">{single.why}</span>
        </button>
      </div>
      <p className="muted small">위치는 처음 놓은 키를 기준으로 잡았어요. 다른 자리를 원하면 키 여러 칸을 드래그로 먼저 선택한 다음 이미지를 놓아 주세요.</p>
    </Modal>
  );
}

function VideoConvert({ file, keys, onDone, onClose }: { file: File; keys: number[]; onDone: (m: MediaInfo) => void; onClose: () => void }) {
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [err, setErr] = useState("");
  const [start, setStart] = useState(0);
  const [seconds, setSeconds] = useState(4);
  const [fps, setFps] = useState(10);
  const [size, setSize] = useState<"key" | "half" | "full">(keys.length > 1 ? "half" : "key");
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    videoMeta(file).then((m) => { setMeta(m); setSeconds(Math.min(4, Math.floor(m.duration * 10) / 10)); }, (e) => setErr(String(e)));
  }, [file]);

  if (err) return <Modal title="영상을 열 수 없어요" onClose={onClose}><p className="err-text">{err}</p></Modal>;
  if (!meta) return <Modal title="영상 확인 중…"><p className="muted">잠시만요…</p></Modal>;

  const box = size === "key" ? [CELL_W * 2, CELL_H * 2] : size === "half" ? [288, 214] : [480, 320];
  const scale = Math.min(1, box[0] / meta.w, box[1] / meta.h);
  const ow = Math.round(meta.w * scale), oh = Math.round(meta.h * scale);
  const est = estimateGifBytes({ start, seconds, fps, maxW: box[0], maxH: box[1] }, ow, oh);
  const estText = est > 1024 * 1024 ? `${(est / 1024 / 1024).toFixed(1)} MB` : `${Math.round(est / 1024)} KB`;

  const convert = async () => {
    setProgress(0);
    try {
      const m = await importVideo(file, { start, seconds, fps, maxW: box[0], maxH: box[1] }, setProgress);
      onDone(m);
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <Modal title="영상을 GIF로 바꿔서 넣어요" onClose={progress == null ? onClose : undefined}>
      <p className="muted small">보드 저장 공간(약 10 MB)과 속도 때문에 영상은 짧고 작은 GIF로 줄여서 넣어요. 원본 영상 {meta.w}×{meta.h}, {meta.duration.toFixed(1)}초.</p>
      <label className="field"><span>시작 위치 {start.toFixed(1)}초</span>
        <input type="range" min={0} max={Math.max(0, meta.duration - 0.5)} step={0.1} value={start} onChange={(e) => setStart(Number(e.target.value))} /></label>
      <label className="field"><span>길이 {seconds.toFixed(1)}초</span>
        <input type="range" min={0.5} max={Math.min(10, meta.duration - start)} step={0.1} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} /></label>
      <label className="field"><span>초당 프레임</span>
        <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
          {[5, 8, 10, 12, 15].map((f) => <option key={f} value={f}>{f} fps{f === 10 ? " (추천)" : ""}</option>)}
        </select></label>
      <label className="field"><span>크기</span>
        <select value={size} onChange={(e) => setSize(e.target.value as any)}>
          <option value="key">키 1~4칸용 (작게)</option>
          <option value="half">키 여러 칸용 (중간)</option>
          <option value="full">화면 전체용 (크게)</option>
        </select></label>
      <p>결과: {ow}×{oh}, {Math.floor(seconds * fps)}프레임, 예상 약 <b>{estText}</b>
        {est > 1.5 * 1024 * 1024 && <span className="warn-text"> · 커요. 길이나 프레임을 줄여 보세요</span>}</p>
      {progress != null && <div className="bar"><div style={{ width: `${progress * 100}%` }} /></div>}
      <div className="row end">
        <button onClick={onClose} disabled={progress != null}>취소</button>
        <button className="primary" onClick={convert} disabled={progress != null}>
          {progress != null ? `바꾸는 중… ${Math.round(progress * 100)}%` : "GIF로 바꾸기"}
        </button>
      </div>
    </Modal>
  );
}
