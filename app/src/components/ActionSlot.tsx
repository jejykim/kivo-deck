import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { actionDef, actionIcon, actionName, actionOS, osOnlyText, supported, type ParamDef, type Slot } from "../catalog";
import { hotkeyFromEvent, prettyHotkey } from "../keys";
import type { ActionRef, OS } from "../model";
import { makeCtx } from "../bundle";
import { editingPreset, useApp } from "../state";
import { readDrop, useDrag, type DragItem } from "../dnd";
import { canDrop } from "../drop";
import { importAudio } from "../media";
import { pickFile } from "./DeckView";
import { MacroEditor } from "./MacroEditor";

// A drop target holding one action, with its parameter fields
export function ActionSlot({ label, value, onChange, accept, previewOS, hint, onDial }: {
  label: string;
  value: ActionRef | null;
  onChange: (a: ActionRef | null) => void;
  accept: Slot;
  previewOS: OS;
  hint?: string;
  onDial?: (item: DragItem) => void; // knob rows: a knob-type action fills both directions
}) {
  const store = useApp((s) => s.store);
  const preset = useApp(editingPreset);
  const drag = useDrag((s) => s.item);
  const [over, setOver] = useState(false);
  const ok = canDrop(drag, accept === "dial" ? "key" : accept) || (!!onDial && canDrop(drag, "dial"));
  const cat = makeCtx(store, previewOS, preset);
  const def = value ? actionDef(value.type) : undefined;
  const bad = value && !supported(value, cat) ? osOnlyText(actionOS(value, cat)) || "사용 불가" : "";

  return (
    <div className={`slot-box ${ok ? "can" : ""} ${over ? "over" : ""} ${bad ? "bad" : ""}`}
      onDragOver={(e) => { if (ok) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const item = readDrop(e);
        if (item?.kind !== "action") return;
        if (onDial && item.slots.includes("dial")) onDial(item);
        else if (item.slots.includes(accept === "dial" ? "key" : accept)) onChange(structuredClone(item.ref));
      }}>
      <div className="slot-head">
        <span className="slot-label">{label}</span>
        {value ? (
          <>
            <span className="slot-action">{actionIcon(value)} {actionName(value)}</span>
            {bad && <span className="badge bad">{bad} · 이 OS에서 사용 불가</span>}
            <button className="ghost small" onClick={() => onChange(null)} title="비우기">✕</button>
          </>
        ) : (
          <span className="muted small">{hint ?? "오른쪽 목록에서 기능을 끌어다 놓으세요"}</span>
        )}
      </div>
      {value && def?.params?.map((p) => (
        <ParamField key={p.key} def={p} value={value.params[p.key]} os={previewOS}
          pages={preset?.pages ?? []}
          onChange={(v) => onChange({ ...value, params: { ...value.params, [p.key]: v } })} />
      ))}
      {value && def?.needsObs && !store.settings.obs.host && <p className="warn-text small">설정(⚙)에서 OBS 연결 정보를 넣어 주세요.</p>}
    </div>
  );
}

function ParamField({ def, value, onChange, os, pages }: {
  def: ParamDef; value: any; onChange: (v: any) => void; os: OS; pages: { id: string; name: string; folder: boolean }[];
}) {
  const macros = useApp((s) => s.store.macros);
  const media = useApp((s) => s.store.media);
  const recent = useApp((s) => s.recentApps);
  const [macroOpen, setMacroOpen] = useState<string | null>(null);

  switch (def.kind) {
    case "hotkey":
      return <HotkeyField label={def.label} value={value ?? ""} onChange={onChange} os={os} />;
    case "page":
      return (
        <label className="field"><span>{def.label}</span>
          <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
            <option value="">선택…</option>
            {pages.map((p) => <option key={p.id} value={p.id}>{p.folder ? "📁 " : ""}{p.name}</option>)}
          </select></label>
      );
    case "macro":
      return (
        <div className="field"><span>{def.label}</span>
          <div className="row">
            <select className="grow" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
              <option value="">선택…</option>
              {macros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {value && <button onClick={() => setMacroOpen(value)}>편집</button>}
            <button onClick={() => setMacroOpen("new")}>+ 새 매크로</button>
          </div>
          {macroOpen && <MacroEditor id={macroOpen === "new" ? null : macroOpen} onClose={(id) => { if (id && macroOpen === "new") onChange(id); setMacroOpen(null); }} />}
        </div>
      );
    case "file":
      return (
        <div className="field"><span>{def.label}</span>
          <div className="row">
            <input className="grow" value={value ?? ""} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} />
            <button onClick={async () => {
              const p = await open({ multiple: false, directory: false });
              if (typeof p === "string") onChange(p);
            }}>찾아보기…</button>
          </div></div>
      );
    case "process":
      return (
        <div className="field"><span>{def.label}</span>
          <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
          {recent.length > 0 && <div className="row wrap">{recent.slice(0, 5).map((r) => <button key={r} className="chip" onClick={() => onChange(r)}>{r}</button>)}</div>}
        </div>
      );
    case "media":
      return (
        <div className="field"><span>{def.label}</span>
          <div className="row">
            <span className="grow">{value ? media[value]?.name ?? "(없는 파일)" : "없음"}</span>
            <button onClick={() => pickFile(async (f) => onChange((await importAudio(f[0])).id), "audio/*")}>소리 파일 고르기…</button>
          </div></div>
      );
    case "number":
      return <label className="field"><span>{def.label}</span><input type="number" value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} /></label>;
    default:
      return (
        <label className="field"><span>{def.label}</span>
          {def.kind === "text" && def.key === "text"
            ? <textarea rows={2} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
            : <input value={value ?? ""} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} />}
        </label>
      );
  }
}

// Click, then press the keys. "Mod" = Ctrl on Windows, ⌘ on Mac.
export function HotkeyField({ label, value, onChange, os }: { label: string; value: string; onChange: (v: string) => void; os: OS }) {
  const [rec, setRec] = useState(false);
  const [manual, setManual] = useState(false);
  return (
    <div className="field"><span>{label}</span>
      <div className="row">
        {manual ? (
          <input className="grow" value={value} placeholder="예: Mod+Shift+S" onChange={(e) => onChange(e.target.value)} />
        ) : (
          <button className={`hotkey grow ${rec ? "rec" : ""}`} onClick={() => setRec(true)} onBlur={() => setRec(false)}
            onKeyDown={(e) => {
              if (!rec) return;
              e.preventDefault();
              const h = hotkeyFromEvent(e.nativeEvent, os);
              if (h) { onChange(h); setRec(false); }
            }}>
            {rec ? "키를 눌러 주세요…" : value ? prettyHotkey(value, os) : "눌러서 단축키 녹화"}
          </button>
        )}
        <button className="ghost small" onClick={() => setManual((m) => !m)}>{manual ? "녹화" : "직접 입력"}</button>
      </div>
    </div>
  );
}
