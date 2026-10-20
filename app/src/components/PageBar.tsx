import { useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { newPage } from "../model";
import { editingPreset, updatePreset, useApp } from "../state";
import { Menu } from "./Menu";
import { Modal } from "./Modal";

export function PageBar() {
  const preset = useApp(editingPreset)!;
  const pageIdx = useApp((s) => Math.min(s.pageIdx, preset.pages.length - 1));
  const devicePage = useApp((s) => s.devicePage);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [rules, setRules] = useState(false);
  const go = (i: number) => useApp.setState({ pageIdx: i, selection: null });
  const page = preset.pages[pageIdx];

  const add = (folder: boolean) => {
    updatePreset((p) => {
      p.pages.push(newPage(folder ? `폴더 ${p.pages.filter((x) => x.folder).length + 1}` : `페이지 ${p.pages.filter((x) => !x.folder).length + 1}`, folder));
    });
    go(preset.pages.length);
  };
  // press and hold a tab (0.4 s), then drag it left / right to reorder
  const [dragging, setDragging] = useState<{ from: number; to: number } | null>(null);
  const holdTimer = useRef<number | undefined>(undefined);
  const justDragged = useRef(false);
  const tabAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest("[data-tab]") as HTMLElement | null;
    return el ? Number(el.dataset.tab) : null;
  };
  const startHold = (i: number, e: React.PointerEvent) => {
    if (renaming != null || e.button !== 0) return;
    clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      setDragging({ from: i, to: i });
      const moveH = (ev: PointerEvent) => {
        const t = tabAt(ev.clientX, ev.clientY);
        if (t != null) setDragging((d) => (d ? { ...d, to: t } : d));
      };
      const upH = () => {
        window.removeEventListener("pointermove", moveH);
        window.removeEventListener("pointerup", upH);
        setDragging((d) => {
          if (d && d.to !== d.from) {
            updatePreset((p) => { const [pg] = p.pages.splice(d.from, 1); p.pages.splice(d.to, 0, pg); });
            useApp.setState({ pageIdx: d.to, selection: null });
          }
          return null;
        });
        justDragged.current = true;
        setTimeout(() => { justDragged.current = false; }, 0);
      };
      window.addEventListener("pointermove", moveH);
      window.addEventListener("pointerup", upH);
    }, 400);
  };
  const cancelHold = () => clearTimeout(holdTimer.current);

  const move = (d: number) => {
    const j = pageIdx + d;
    if (j < 0 || j >= preset.pages.length) return;
    updatePreset((p) => { [p.pages[pageIdx], p.pages[j]] = [p.pages[j], p.pages[pageIdx]]; });
    go(j);
  };

  return (
    <div className="page-bar">
      {preset.pages.map((p, i) => (
        <button key={p.id} data-tab={i}
          className={`tab ${i === pageIdx ? "on" : ""} ${dragging?.from === i ? "lifted" : ""} ${dragging && dragging.to === i && dragging.from !== i ? (dragging.to < dragging.from ? "drop-before" : "drop-after") : ""}`}
          onClick={() => !justDragged.current && go(i)} onDoubleClick={() => setRenaming(i)}
          onPointerDown={(e) => startHold(i, e)} onPointerUp={cancelHold} onPointerLeave={() => !dragging && cancelHold()}
          title={`${p.folder ? "폴더 페이지: 키의 「폴더 열기」로 들어가고 「뒤로」로 나와요" : "◀ ▶ 키로 넘기는 페이지"} · 길게 누르고 끌면 순서를 바꿔요`}>
          {p.folder ? "📁 " : ""}
          {renaming === i ? (
            <input autoFocus defaultValue={p.name}
              onBlur={(e) => { updatePreset((pp) => { pp.pages[i].name = e.target.value || p.name; }); setRenaming(null); }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
          ) : p.name}
          {i === devicePage && useApp.getState().device.connected && <i className="dot ok" title="보드에 지금 보이는 페이지" />}
        </button>
      ))}
      <button className="ghost" onClick={() => add(false)}>+ 페이지</button>
      <button className="ghost" onClick={() => add(true)}>+ 폴더</button>
      <div className="spacer" />
      <Menu label="페이지 ⋯">
        {(close) => (
          <>
            <button onClick={() => { setRenaming(pageIdx); close(); }}>이름 바꾸기</button>
            <button onClick={() => { move(-1); close(); }} disabled={pageIdx === 0}>왼쪽으로 옮기기</button>
            <button onClick={() => { move(1); close(); }} disabled={pageIdx === preset.pages.length - 1}>오른쪽으로 옮기기</button>
            <button onClick={() => { setRules(true); close(); }}>프로그램별 자동 전환…</button>
            <hr />
            <button className="danger" disabled={preset.pages.length === 1} onClick={async () => {
              close();
              if (!(await ask(`"${page.name}" 페이지를 지울까요?`, { kind: "warning" }))) return;
              updatePreset((p) => {
                p.appRules = p.appRules.filter((r) => r.pageId !== page.id);
                p.pages.splice(pageIdx, 1);
              });
              go(Math.max(0, pageIdx - 1));
            }}>페이지 삭제</button>
          </>
        )}
      </Menu>
      {rules && <RulesDialog onClose={() => setRules(false)} />}
    </div>
  );
}

function RulesDialog({ onClose }: { onClose: () => void }) {
  const preset = useApp(editingPreset)!;
  const pageIdx = useApp((s) => Math.min(s.pageIdx, preset.pages.length - 1));
  const recent = useApp((s) => s.recentApps);
  const autoSwitch = useApp((s) => s.store.settings.autoSwitch);
  const [text, setText] = useState("");
  const page = preset.pages[pageIdx];
  const mine = preset.appRules.filter((r) => r.pageId === page.id);
  const add = (process: string) => {
    if (!process.trim()) return;
    updatePreset((p) => {
      p.appRules = p.appRules.filter((r) => r.process.toLowerCase() !== process.trim().toLowerCase());
      p.appRules.push({ process: process.trim(), pageId: page.id });
    });
    setText("");
  };

  return (
    <Modal title={`"${page.name}" 자동 전환`} onClose={onClose}>
      <p className="muted">아래 프로그램이 앞에 오면 보드가 이 페이지로 바뀌어요.{!autoSwitch && " (설정에서 자동 전환이 꺼져 있어요)"}</p>
      {mine.length === 0 && <p className="muted small">아직 없어요.</p>}
      {mine.map((r) => (
        <div key={r.process} className="row">
          <code>{r.process}</code>
          <div className="spacer" />
          <button className="ghost" onClick={() => updatePreset((p) => { p.appRules = p.appRules.filter((x) => !(x.process === r.process && x.pageId === page.id)); })}>삭제</button>
        </div>
      ))}
      <div className="row">
        <input className="grow" placeholder={preset.os === "mac" ? "예: Adobe Photoshop 2026" : "예: Photoshop.exe"} value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add(text)} />
        <button onClick={() => add(text)}>추가</button>
      </div>
      {recent.length > 0 && (
        <>
          <p className="muted small">최근에 앞에 있던 프로그램 (눌러서 추가):</p>
          <div className="row wrap">{recent.map((r) => <button key={r} className="chip" onClick={() => add(r)}>{r}</button>)}</div>
        </>
      )}
      <p className="muted small">바꾼 뒤 "보드에 적용"을 눌러야 반영돼요.</p>
    </Modal>
  );
}
