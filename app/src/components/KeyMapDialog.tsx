// Per-key touch calibration (fw 0.3.4+). The board picks the key whose center is nearest to the
// touch; here those centers are measured by pressing each key, checked against the stray points
// that land on a neighbour, and moved by hand. Key actions are muted on the board meanwhile.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "../state";
import { Modal } from "./Modal";

const W = 480, H = 320, COLS = 5, ROWS = 3, KEYS = COLS * ROWS;
const SCALE = 1.25;   // canvas px per screen px
const COLORS = ["#4f8cff", "#ff7a59", "#3dbb7e", "#e8b931", "#a070e0"];

type Pt = { x: number; y: number };
type Stroke = { target: number | null; pts: Pt[] };

const send = (cmd: Record<string, unknown>) => invoke("send_command", { line: JSON.stringify(cmd) });

function grid(): Pt[] {
  return Array.from({ length: KEYS }, (_, k) => ({
    x: (k % COLS) * (W / COLS) + W / COLS / 2,
    y: Math.round((Math.floor(k / COLS) + 0.5) * (H / ROWS)),
  }));
}

function nearest(c: Pt[], p: Pt) {
  let best = 0, d1 = Infinity;
  c.forEach((q, k) => {
    const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
    if (d < d1) { d1 = d; best = k; }
  });
  return best;
}

function median(v: number[]) {
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
}

export function KeyMapDialog({ onClose }: { onClose: () => void }) {
  const device = useApp((s) => s.device);
  const pressed = useApp((s) => s.pressed);
  const supported = device.connected && !!device.hello?.kmap;
  const [saved, setSaved] = useState<Pt[] | null>(null);
  const [centers, setCenters] = useState<Pt[]>(grid);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<Pt[]>([]);
  const [target, setTarget] = useState<number | null>(null);
  const [wizard, setWizard] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<number | null>(null);
  // the event listener needs the latest values without re-subscribing
  const live = useRef({ target, wizard, current });
  live.current = { target, wizard, current };

  useEffect(() => {
    if (!supported) return;
    const start = () => send({ cmd: "touch.watch", on: 1, mute: 1 }).catch((e) => setMessage(String(e)));
    start();
    send({ cmd: "touch.map" }).catch(() => {});
    const again = window.setInterval(start, 100000);
    const un = listen<Record<string, any>>("device-event", (m) => {
      const e = m.payload;
      if (e.ev === "touchMap") {
        const c = e.cx.map((x: number, k: number) => ({ x, y: e.cy[k] }));
        setSaved(c);
        setCenters(c);
      } else if (e.ev === "touchRaw") {
        if (e.z > 0) { setCurrent((c) => [...c, { x: e.x, y: e.y }]); return; }
        finishStroke();
      }
    });
    return () => {
      clearInterval(again);
      un.then((f) => f());
      send({ cmd: "touch.watch", on: 0 }).catch(() => {});
    };
  }, [supported]);

  // one press ended: keep its points, and when measuring, move that key's center to their median
  function finishStroke() {
    const { target: t, wizard: wiz, current: pts } = live.current;
    setCurrent([]);
    if (pts.length === 0) return;
    setStrokes((s) => [...s.slice(-200), { target: t, pts }]);
    if (t === null || pts.length < 3) return;
    const c = { x: Math.round(median(pts.map((p) => p.x))), y: Math.round(median(pts.map((p) => p.y))) };
    setCenters((cs) => cs.map((q, k) => (k === t ? c : q)));
    if (wiz && t < KEYS - 1) setTarget(t + 1);
    else { setTarget(null); setWizard(false); }
  }

  // per key: how many measured points fell on another key with the current centers
  const stats = useMemo(() => {
    const out = Array.from({ length: KEYS }, () => ({ total: 0, stray: new Map<number, number>() }));
    for (const s of strokes) {
      if (s.target === null) continue;
      for (const p of s.pts) {
        const k = nearest(centers, p);
        out[s.target].total++;
        if (k !== s.target) out[s.target].stray.set(k, (out[s.target].stray.get(k) ?? 0) + 1);
      }
    }
    return out;
  }, [strokes, centers]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const g = cv.getContext("2d")!;
    g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    // key regions: color every 4 px cell by its nearest center
    for (let y = 0; y < H; y += 4) {
      for (let x = 0; x < W; x += 4) {
        const k = nearest(centers, { x: x + 2, y: y + 2 });
        g.fillStyle = COLORS[(k % COLS + Math.floor(k / COLS)) % COLORS.length] + "40";
        g.clearRect(x, y, 4, 4);
        g.fillRect(x, y, 4, 4);
      }
    }
    // the plain grid for reference
    g.strokeStyle = "#ffffff30";
    g.lineWidth = 1;
    for (let c = 1; c < COLS; c++) { g.beginPath(); g.moveTo((c * W) / COLS, 0); g.lineTo((c * W) / COLS, H); g.stroke(); }
    for (let r = 1; r < ROWS; r++) { g.beginPath(); g.moveTo(0, (r * H) / ROWS); g.lineTo(W, (r * H) / ROWS); g.stroke(); }
    // points: measured ones are green on their key and red elsewhere; free presses are white
    const dot = (p: Pt, color: string) => { g.fillStyle = color; g.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); };
    for (const s of strokes.slice(-60)) {
      for (const p of s.pts) dot(p, s.target === null ? "#ffffffaa" : nearest(centers, p) === s.target ? "#3dff8a" : "#ff4040");
    }
    for (const p of current) dot(p, "#ffe14a");
    // centers
    centers.forEach((p, k) => {
      g.beginPath();
      g.arc(p.x, p.y, 9, 0, Math.PI * 2);
      g.fillStyle = k === target ? "#ffe14a" : k === selected ? "#ffffff" : "#1b1f27";
      g.fill();
      g.strokeStyle = pressed.has(k) ? "#3dff8a" : "#ffffff";
      g.lineWidth = pressed.has(k) ? 3 : 1.5;
      g.stroke();
      g.fillStyle = k === target || k === selected ? "#000" : "#fff";
      g.font = "bold 10px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(k + 1), p.x, p.y + 0.5);
    });
  }, [centers, strokes, current, target, selected, pressed]);

  const at = (e: React.PointerEvent): Pt => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const onDown = (e: React.PointerEvent) => {
    const p = at(e);
    const k = centers.findIndex((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 14 ** 2);
    if (k < 0) return;
    drag.current = k;
    setSelected(k);
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const k = drag.current;
    if (k === null) return;
    const p = at(e);
    const c = { x: Math.round(Math.min(W - 1, Math.max(0, p.x))), y: Math.round(Math.min(H - 1, Math.max(0, p.y))) };
    setCenters((cs) => cs.map((q, i) => (i === k ? c : q)));
  };
  const nudge = (dx: number, dy: number) => {
    if (selected === null) return;
    setCenters((cs) => cs.map((q, i) => (i === selected ? { x: q.x + dx, y: q.y + dy } : q)));
  };

  const dirty = !!saved && centers.some((p, k) => p.x !== saved[k].x || p.y !== saved[k].y);
  const save = () => send({ cmd: "touch.map", cx: centers.map((p) => p.x), cy: centers.map((p) => p.y) })
    .then(() => setMessage("보드에 저장했어요"))
    .catch((e) => setMessage(String(e)));

  if (!supported) {
    return (
      <Modal title="키별 터치 보정" onClose={onClose}>
        <p className="warn-text">{device.connected ? "이 기능은 펌웨어 0.3.4 이상이 필요해요. 설정 → 펌웨어 업데이트에서 올려 주세요." : "보드를 연결하면 쓸 수 있어요."}</p>
        <div className="row end"><button onClick={onClose}>닫기</button></div>
      </Modal>
    );
  }

  const guide = target !== null
    ? <b className="target-text">보드의 {target + 1}번 키 가운데를 평소처럼 눌렀다 떼세요{wizard ? ` (${target + 1}/${KEYS})` : ""}</b>
    : <span className="muted">아무 키나 눌러 보면 점이 찍혀요. 노란 점은 지금 누르는 중, 흰 점은 지난 터치예요.</span>;

  return (
    <Modal title="키별 터치 보정" onClose={onClose} wide>
      <p className="muted small">이 창이 열려 있는 동안 보드 키를 눌러도 기능은 실행되지 않아요. 숫자 원이 각 키의 중심이고, 손가락은 가장 가까운 중심의 키로 판단해요. 색칠된 영역이 지금 중심으로 나뉜 키 범위예요.</p>
      <p>{guide}</p>
      <canvas
        ref={canvas}
        className="keymap"
        width={W * SCALE}
        height={H * SCALE}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => { drag.current = null; }}
      />
      <div className="row">
        {!wizard
          ? <button className="primary" onClick={() => { setWizard(true); setTarget(0); setStrokes([]); }}>1번부터 차례로 재기</button>
          : <button onClick={() => { setWizard(false); setTarget(null); }}>재기 멈추기</button>}
        <button disabled={selected === null || wizard} onClick={() => setTarget(selected)}>
          {selected === null ? "원을 눌러 키 고르기" : `${selected + 1}번만 다시 재기`}
        </button>
        {wizard && target !== null && <button onClick={() => setTarget(target < KEYS - 1 ? target + 1 : null)}>이 키 건너뛰기</button>}
        <div className="spacer" />
        <span className="muted small">고른 키 옮기기</span>
        <button disabled={selected === null} onClick={() => nudge(0, -2)}>↑</button>
        <button disabled={selected === null} onClick={() => nudge(0, 2)}>↓</button>
        <button disabled={selected === null} onClick={() => nudge(-2, 0)}>←</button>
        <button disabled={selected === null} onClick={() => nudge(2, 0)}>→</button>
      </div>

      <h4>키별 결과</h4>
      <div className="keymap-stats">
        {stats.map((s, k) => {
          const strays = [...s.stray.entries()].sort((a, b) => b[1] - a[1]);
          const n = strays.reduce((a, [, c]) => a + c, 0);
          return (
            <div key={k} className={`keymap-stat ${n ? "bad" : s.total ? "good" : ""}`} onClick={() => setSelected(k)}>
              <b>{k + 1}번</b>{" "}
              {s.total === 0 ? <span className="muted">아직 안 잼</span>
                : n === 0 ? <span>점 {s.total}개 · 튐 없음</span>
                : <span>점 {s.total}개 · 튐 {n}개 ({strays.map(([to, c]) => `${to + 1}번 ${c}`).join(", ")})</span>}
            </div>
          );
        })}
      </div>
      <p className="muted small">빨간 점이 다른 키로 튄 점이에요. 튐이 남은 키는 다시 재거나, 원을 끌어서 튄 쪽의 반대로 조금 옮겨 보세요. 저장하기 전까지 보드는 예전 값을 써요.</p>

      {message && <p className="muted small">{message}</p>}
      <div className="row">
        <button onClick={() => { setCenters(grid()); setMessage("격자 기본값으로 바꿨어요. 저장하면 보드에 반영돼요."); }}>격자 기본값</button>
        <button disabled={!dirty} onClick={() => saved && setCenters(saved)}>보드에 저장된 값으로</button>
        <button onClick={() => { setStrokes([]); setCurrent([]); }}>점 지우기</button>
        <div className="spacer" />
        <button onClick={onClose}>닫기</button>
        <button className="primary" disabled={!dirty} onClick={save}>보드에 저장</button>
      </div>
    </Modal>
  );
}
