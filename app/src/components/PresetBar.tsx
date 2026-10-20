import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { OS_LABEL, OS_LIST, SLOTS_PER_OS, newPreset, otherOS, uid, type OS, type Preset } from "../model";
import { useApp } from "../state";
import { exportPreset, importPreset } from "../presetFile";
import { Menu } from "./Menu";

const clonePreset = (p: Preset, os: OS): Preset => ({ ...structuredClone(p), id: uid(), os });

export function PresetBar() {
  const store = useApp((s) => s.store);
  const hostOS = useApp((s) => s.hostOS);
  const editOS = useApp((s) => s.editOS);
  const editSlot = useApp((s) => s.editSlot);
  const update = useApp((s) => s.update);
  const addLog = useApp((s) => s.addLog);
  const [renaming, setRenaming] = useState(false);

  const slots = store.slots[editOS];
  const preset = slots[editSlot];
  const choose = (os: OS, slot: number) => useApp.setState({ editOS: os, editSlot: slot, pageIdx: 0, selection: null });

  const putPreset = (os: OS, slot: number, p: Preset | null) => update((s) => { s.slots[os][slot] = p; });

  const hostMissing = !store.slots[hostOS][store.active[hostOS]];
  const other = otherOS(hostOS);

  return (
    <div className="preset-bar">
      <div className="seg">
        {OS_LIST.map((os) => (
          <button key={os} className={os === editOS ? "on" : ""} onClick={() => choose(os, store.active[os])}>
            {OS_LABEL[os]}{os === hostOS && <small> · 이 PC</small>}
          </button>
        ))}
      </div>

      <div className="slots">
        {Array.from({ length: SLOTS_PER_OS }, (_, i) => {
          const p = slots[i];
          const active = store.active[editOS] === i;
          const cls = `slot ${i === editSlot ? "sel" : ""} ${p ? "" : "empty"}`;
          return (
            <button key={i} className={cls} onClick={() => choose(editOS, i)} onDoubleClick={() => p && setRenaming(true)}>
              {active && <i className="dot ok" title="이 OS에서 사용 중" />}
              {i === editSlot && renaming && p ? (
                <input autoFocus defaultValue={p.name}
                  onBlur={(e) => { update((s) => { s.slots[editOS][i]!.name = e.target.value || p.name; }); setRenaming(false); }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
              ) : (
                <span>{p ? p.name : `프리셋 ${i + 1} (비어 있음)`}</span>
              )}
            </button>
          );
        })}
      </div>

      {preset && (
        <div className="row">
          {store.active[editOS] !== editSlot ? (
            <button onClick={() => update((s) => { s.active[editOS] = editSlot; })}>이 프리셋 사용</button>
          ) : (
            <span className="pill ok small">사용 중</span>
          )}
          <Menu label="⋯">
            {(close) => (
              <>
                <button onClick={() => { setRenaming(true); close(); }}>이름 바꾸기</button>
                {Array.from({ length: SLOTS_PER_OS }, (_, i) => i).filter((i) => i !== editSlot).map((i) => (
                  <button key={`d${i}`} onClick={async () => {
                    close();
                    if (slots[i] && !(await ask(`"${slots[i]!.name}"을(를) 덮어쓸까요?`, { kind: "warning" }))) return;
                    putPreset(editOS, i, { ...clonePreset(preset, editOS), name: `${preset.name} 복사본` });
                  }}>{OS_LABEL[editOS]} 프리셋 {i + 1}에 복제{slots[i] ? " (덮어쓰기)" : ""}</button>
                ))}
                {Array.from({ length: SLOTS_PER_OS }, (_, i) => i).map((i) => (
                  <button key={`o${i}`} onClick={async () => {
                    close();
                    const o = otherOS(editOS);
                    if (store.slots[o][i] && !(await ask(`${OS_LABEL[o]}의 "${store.slots[o][i]!.name}"을(를) 덮어쓸까요?`, { kind: "warning" }))) return;
                    putPreset(o, i, clonePreset(preset, o));
                  }}>{OS_LABEL[otherOS(editOS)]} 프리셋 {i + 1}(으)로 복사{store.slots[otherOS(editOS)][i] ? " (덮어쓰기)" : ""}</button>
                ))}
                <button onClick={() => { close(); exportPreset(preset).catch((e) => addLog(String(e), "err")); }}>파일로 내보내기…</button>
                <hr />
                <button className="danger" onClick={async () => {
                  close();
                  if (await ask(`"${preset.name}" 프리셋을 지울까요?`, { kind: "warning" })) putPreset(editOS, editSlot, null);
                }}>삭제</button>
              </>
            )}
          </Menu>
        </div>
      )}

      {hostMissing && (
        <div className="banner">
          이 PC({OS_LABEL[hostOS]})용 프리셋이 비어 있어서 {OS_LABEL[other]} 프리셋을 대신 쓰고 있어요.
          {` ${OS_LABEL[other]} 전용 기능은 앱과 보드 화면에 "사용 불가"로 표시돼요.`}
        </div>
      )}
    </div>
  );
}

// Shown in place of the editor when the selected slot is empty
export function EmptySlot() {
  const store = useApp((s) => s.store);
  const editOS = useApp((s) => s.editOS);
  const editSlot = useApp((s) => s.editSlot);
  const update = useApp((s) => s.update);
  const addLog = useApp((s) => s.addLog);
  const put = (p: Preset) => update((s) => { s.slots[editOS][editSlot] = p; });
  const others = OS_LIST.flatMap((os) => store.slots[os].map((p, i) => ({ os, i, p }))).filter((x) => x.p && !(x.os === editOS && x.i === editSlot));

  return (
    <div className="empty-slot">
      <h3>{OS_LABEL[editOS]} 프리셋 {editSlot + 1}은(는) 비어 있어요</h3>
      <p className="muted">
        {store.active[editOS] === editSlot
          ? `${OS_LABEL[editOS]}에서는 지금 ${OS_LABEL[otherOS(editOS)]} 프리셋을 대신 쓰고 있어요.`
          : "새로 만들거나 다른 프리셋을 복사해 오세요."}
      </p>
      <div className="row wrap">
        <button className="primary" onClick={() => put(newPreset(editOS, `프리셋 ${editSlot + 1}`))}>+ 새 프리셋 만들기</button>
        {others.map(({ os, i, p }) => (
          <button key={`${os}${i}`} onClick={() => put({ ...clonePreset(p!, editOS), name: p!.name })}>
            {OS_LABEL[os]} · {p!.name} 복사해 오기
          </button>
        ))}
        <button onClick={async () => {
          try { const p = await importPreset(editOS); if (p) put(p); } catch (e) { addLog(String(e), "err"); }
        }}>파일에서 가져오기…</button>
      </div>
    </div>
  );
}
