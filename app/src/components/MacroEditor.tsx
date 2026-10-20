import { useState } from "react";
import { uid, type Macro, type MacroStep } from "../model";
import { actionIcon, actionName } from "../catalog";
import { useApp } from "../state";
import { readDrop, useDrag } from "../dnd";
import { Modal } from "./Modal";
import { HotkeyField } from "./ActionSlot";

// Creates or edits a macro. onClose gets the macro id when it was saved.
export function MacroEditor({ id, onClose }: { id: string | null; onClose: (savedId: string | null) => void }) {
  const store = useApp((s) => s.store);
  const update = useApp((s) => s.update);
  const hostOS = useApp((s) => s.hostOS);
  const existing = id ? store.macros.find((m) => m.id === id) : undefined;
  const [m, setM] = useState<Macro>(() => existing ? structuredClone(existing) : { id: uid(), name: "새 매크로", steps: [] });
  const drag = useDrag((s) => s.item);

  const setStep = (i: number, s: MacroStep) => setM({ ...m, steps: m.steps.map((x, j) => (j === i ? s : x)) });
  const add = (s: MacroStep) => setM({ ...m, steps: [...m.steps, s] });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= m.steps.length) return;
    const steps = [...m.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setM({ ...m, steps });
  };

  const save = () => {
    update((s) => {
      const i = s.macros.findIndex((x) => x.id === m.id);
      if (i >= 0) s.macros[i] = m; else s.macros.push(m);
    });
    onClose(m.id);
  };
  const remove = () => {
    update((s) => { s.macros = s.macros.filter((x) => x.id !== m.id); });
    onClose(null);
  };

  return (
    <Modal title={existing ? "매크로 편집" : "새 매크로"} onClose={() => onClose(null)} wide docked>
      <label className="field"><span>이름</span><input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} /></label>
      <p className="muted small">위에서부터 순서대로 실행해요. 단축키·영문 글자·기다리기로만 이루어진 매크로는 앱이 없어도 보드가 직접 실행해요.</p>
      <ol className="steps">
        {m.steps.map((s, i) => (
          <li key={i} className="step">
            <span className="step-no">{i + 1}</span>
            <div className="grow">
              {s.kind === "hotkey" && <HotkeyField label="단축키" value={s.keys} os={hostOS} onChange={(v) => setStep(i, { ...s, keys: v })} />}
              {s.kind === "text" && <label className="field"><span>글자 입력</span><input value={s.text} onChange={(e) => setStep(i, { ...s, text: e.target.value })} /></label>}
              {s.kind === "delay" && <label className="field"><span>기다리기 (밀리초, 1000 = 1초)</span><input type="number" min={0} max={10000} value={s.ms} onChange={(e) => setStep(i, { ...s, ms: Number(e.target.value) })} /></label>}
              {s.kind === "action" && <div className="field"><span>기능</span><b>{actionIcon(s.action)} {actionName(s.action)}</b></div>}
            </div>
            <button className="ghost small" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
            <button className="ghost small" onClick={() => move(i, 1)} disabled={i === m.steps.length - 1}>↓</button>
            <button className="ghost small" onClick={() => setM({ ...m, steps: m.steps.filter((_, j) => j !== i) })}>✕</button>
          </li>
        ))}
      </ol>
      <div className={`slot-box ${drag?.kind === "action" && drag.slots.includes("key") ? "can" : ""}`}
        onDragOver={(e) => { if (useDrag.getState().item?.kind === "action") e.preventDefault(); }}
        onDrop={(e) => {
          e.preventDefault();
          const item = readDrop(e);
          if (item?.kind === "action" && item.slots.includes("key") && item.ref.type !== "macro") add({ kind: "action", action: item.ref });
        }}>
        <div className="row wrap">
          <button onClick={() => add({ kind: "hotkey", keys: "" })}>+ 단축키</button>
          <button onClick={() => add({ kind: "text", text: "" })}>+ 글자 입력</button>
          <button onClick={() => add({ kind: "delay", ms: 200 })}>+ 기다리기</button>
          <span className="muted small">또는 오른쪽 목록의 기능을 여기로 끌어다 놓기</span>
        </div>
      </div>
      <div className="row end">
        {existing && <button className="danger" onClick={remove}>매크로 삭제</button>}
        <div className="spacer" />
        <button onClick={() => onClose(null)}>취소</button>
        <button className="primary" onClick={save}>저장</button>
      </div>
    </Modal>
  );
}
