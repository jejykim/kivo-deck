// Touch feel of the connected board (fw 0.3.3+). Values live on the board itself (NVS), so each
// assembled deck keeps its own; see "터치 조절" in docs/protocol.md.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "../state";
import { Modal } from "./Modal";

type Tuning = { press: number; release: number; minZ: number; edge: number; slide: number };
type Raw = { x: number; y: number; z: number; key: number };

const SLIDERS: { key: keyof Tuning; label: string; max: number; unit: string; help: string }[] = [
  { key: "press", label: "누름 인정 시간", max: 300, unit: "ms", help: "한 키 위에 이만큼 머물러야 눌려요. 올리면 스치는 터치가 줄고, 반응은 조금 느려져요." },
  { key: "release", label: "뗌 인정 시간", max: 500, unit: "ms", help: "터치가 이만큼 끊겨야 뗀 걸로 봐요. 손을 뗄 때 다른 키가 눌리면 올리세요." },
  { key: "minZ", label: "최소 압력", max: 60, unit: "", help: "이보다 약한 터치는 무시해요. 아래 압력 막대를 보며 살짝 누를 때보다 조금 낮게 맞추세요." },
  { key: "edge", label: "키 경계 무시 폭", max: 30, unit: "px", help: "키 사이 경계 근처에서는 누르기가 시작되지 않아요. 두 키가 같이 눌리면 올리세요." },
];

const send = (cmd: Record<string, unknown>) => invoke("send_command", { line: JSON.stringify(cmd) });

export function TouchDialog({ onClose, onKeyMap }: { onClose: () => void; onKeyMap: () => void }) {
  const device = useApp((s) => s.device);
  const saved = device.hello?.touch as Tuning | undefined;
  const [t, setT] = useState<Tuning | null>(saved ?? null);
  const [raw, setRaw] = useState<Raw | null>(null);
  const [maxZ, setMaxZ] = useState(0);
  const [error, setError] = useState("");
  const pressed = useApp((s) => s.pressed);
  const timer = useRef<number | undefined>(undefined);

  // live pressure while the dialog is open (the board stops by itself after 2 minutes)
  useEffect(() => {
    if (!device.connected || !saved) return;
    const start = () => send({ cmd: "touch.watch", on: 1 }).catch((e) => setError(String(e)));
    start();
    const again = window.setInterval(start, 100000);
    const un = listen<Record<string, any>>("device-event", (m) => {
      const e = m.payload;
      if (e.ev === "touchRaw") {
        setRaw(e as Raw);
        if (e.z) setMaxZ((z) => Math.max(z, e.z));
      } else if (e.ev === "touchCfg") setT(e.touch);
    });
    return () => {
      clearInterval(again);
      un.then((f) => f());
      send({ cmd: "touch.watch", on: 0 }).catch(() => {});
    };
  }, [device.connected, !!saved]);

  const change = (patch: Partial<Tuning>) => {
    if (!t) return;
    setT({ ...t, ...patch });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => send({ cmd: "touch.set", ...patch }).catch((e) => setError(String(e))), 250);
  };

  let body;
  if (!device.connected) body = <p className="muted">보드를 연결하면 조절할 수 있어요.</p>;
  else if (!saved || !t) body = <p className="warn-text">이 보드의 펌웨어는 터치 조절을 지원하지 않아요. 펌웨어를 0.3.3 이상으로 업데이트해 주세요.</p>;
  else body = (
    <>
      <p className="muted small">바꾸는 즉시 보드에 저장돼요. 보드마다 따로 저장되니 보드를 바꿔 끼우면 그 보드의 값이 보여요.</p>
      <div className="touch-live">
        <span>지금 압력 <b>{raw?.z ?? 0}</b> <span className="muted">(이번에 본 최대 {maxZ})</span></span>
        <div className="bar"><div style={{ width: `${Math.min(100, ((raw?.z ?? 0) / 60) * 100)}%` }} /></div>
        <span>손가락 위치의 키 <b>{raw && raw.z > 0 && raw.key >= 0 ? raw.key + 1 : "-"}</b>
          {" · "}눌린 키 <b>{[...pressed].map((k) => k + 1).join(", ") || "-"}</b></span>
      </div>
      {SLIDERS.map((s) => (
        <label className="field" key={s.key}>
          <span>{s.label}: <b>{t[s.key]}{s.unit}</b></span>
          <input type="range" min={0} max={s.max} value={t[s.key]} onChange={(e) => change({ [s.key]: Number(e.target.value) })} />
          <span className="muted small">{s.help}</span>
        </label>
      ))}
      <label className="check">
        <input type="checkbox" checked={!!t.slide} onChange={(e) => change({ slide: e.target.checked ? 1 : 0 })} />
        누른 채 다른 키로 옮겨 가면 그 키로 바꾸기 (끄면 처음 누른 키에 고정)
      </label>
      <div className="row">
        <button onClick={() => send({ cmd: "touch.set", default: 1 }).catch((e) => setError(String(e)))}>기본값으로</button>
        <div className="spacer" />
        <button onClick={onKeyMap}>키별 위치 보정</button>
        <button onClick={() => send({ cmd: "calibrate" }).catch((e) => setError(String(e)))}>터치 보정 다시 하기</button>
      </div>
      <p className="muted small">터치 위치 자체가 어긋나 있으면 조절보다 보정이 먼저예요. 화면 전체가 밀려 있으면 "터치 보정 다시 하기", 가운데 키처럼 일부 키만 어긋나면 "키별 위치 보정"을 쓰세요.</p>
    </>
  );

  return (
    <Modal title="터치 조절" onClose={onClose}>
      {body}
      {error && <p className="err-text">{error}</p>}
      <div className="row end"><button onClick={onClose}>닫기</button></div>
    </Modal>
  );
}
