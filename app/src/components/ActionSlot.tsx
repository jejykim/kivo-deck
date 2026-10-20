import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { AppPicker } from "./AppPicker";

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
          onChange={(v, extra) => onChange({ ...value, params: { ...value.params, [p.key]: v, ...extra } })} />
      ))}
      {value && def?.needsObs && !store.settings.obs.host && <p className="warn-text small">설정(⚙)에서 OBS 연결 정보를 넣어 주세요.</p>}
    </div>
  );
}

function ParamField({ def, value, onChange, os, pages }: {
  def: ParamDef; value: any; onChange: (v: any, extra?: Record<string, any>) => void; os: OS; pages: { id: string; name: string; folder: boolean }[];
}) {
  const macros = useApp((s) => s.store.macros);
  const media = useApp((s) => s.store.media);
  const [macroOpen, setMacroOpen] = useState<string | null>(null);
  const [picker, setPicker] = useState<"launch" | "process" | null>(null);

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
    case "app":
      return (
        <div className="field"><span>{def.label}</span>
          <div className="row">
            <button className="primary" onClick={() => setPicker("launch")}>설치된 앱에서 고르기…</button>
            <button onClick={async () => {
              const p = await open({ multiple: false, directory: false });
              if (typeof p === "string") onChange(p);
            }}>파일 찾아보기…</button>
          </div>
          <input value={value ?? ""} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} />
          {picker && <AppPicker mode="launch" onPick={onChange} onClose={() => setPicker(null)} />}
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
          <div className="row">
            <input className="grow" value={value ?? ""} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} />
            <button className="primary" onClick={() => setPicker("process")}>앱 목록에서 고르기…</button>
          </div>
          {picker && <AppPicker mode="process" onPick={onChange} onClose={() => setPicker(null)} />}
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
    case "bool":
      return (
        <label className="check">
          <input type="checkbox" checked={value !== false} onChange={(e) => onChange(e.target.checked)} /> {def.label}
        </label>
      );
    case "audioOut":
    case "audioIn":
      return <AudioDeviceField label={def.label} input={def.kind === "audioIn"} value={value} onChange={onChange} />;
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

interface AudioDevice { id: string; name: string; default: boolean }

// Sound devices of this PC; the name is stored too so the key can show it
function AudioDeviceField({ label, input, value, onChange }: { label: string; input: boolean; value: string | undefined; onChange: (v: any, extra?: Record<string, any>) => void }) {
  const [list, setList] = useState<AudioDevice[] | null>(null);
  const load = () => invoke<AudioDevice[]>("audio_devices", { input }).then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [input]);
  return (
    <div className="field"><span>{label}</span>
      <div className="row">
        <select className="grow" value={value ?? ""} onChange={(e) => {
          const d = list?.find((x) => x.id === e.target.value);
          onChange(e.target.value, { name: d?.name ?? "" });
        }}>
          <option value="">{list == null ? "장치를 읽는 중…" : list.length ? "장치를 고르세요" : "장치를 찾지 못했어요 (Windows에서만 지원)"}</option>
          {list?.map((d) => <option key={d.id} value={d.id}>{d.name}{d.default ? " (지금 사용 중)" : ""}</option>)}
          {value && list && !list.some((d) => d.id === value) && <option value={value}>(연결되지 않은 장치)</option>}
        </select>
        <button className="ghost small" onClick={load} title="다시 읽기">↻</button>
      </div>
      <p className="muted small">토글 키로 만들면 한 번은 이 장치, 다시 누르면 다른 장치로 오갈 수 있어요.</p>
    </div>
  );
}
