import { useState } from "react";
import { ACTIONS, APP_PACKS, type ActionDef } from "../catalog";
import { endDrag, startDrag, type DragItem } from "../dnd";
import type { KeyVisual } from "../model";
import { useApp } from "../state";
import { MacroEditor } from "./MacroEditor";

const CATEGORIES = ["페이지", "키보드", "미디어", "열기", "시간"];

const VISUALS: { name: string; icon: string; item: DragItem }[] = [
  { name: "이미지 · GIF · 영상", icon: "🖼", item: { kind: "pickMedia" } },
  { name: "글자", icon: "🅰", item: { kind: "visual", visual: { kind: "text", text: "글자", fg: "#ffffff", bg: "#1b1d24" } } },
  { name: "시계", icon: "🕒", item: { kind: "visual", visual: { kind: "live", live: "clock" } as KeyVisual } },
  { name: "날짜", icon: "📅", item: { kind: "visual", visual: { kind: "live", live: "date" } as KeyVisual } },
  { name: "CPU 사용률", icon: "🧮", item: { kind: "visual", visual: { kind: "live", live: "cpu" } as KeyVisual } },
  { name: "메모리 사용률", icon: "💾", item: { kind: "visual", visual: { kind: "live", live: "mem" } as KeyVisual } },
  { name: "GPU 사용률", icon: "🎮", item: { kind: "visual", visual: { kind: "live", live: "gpu", liveStyle: "gauge" } as KeyVisual } },
  { name: "스톱워치 표시", icon: "⏱", item: { kind: "visual", visual: { kind: "live", live: "timer" } as KeyVisual } },
];

const SLOT_NAME: Record<string, string> = { key: "키", dial: "노브", fader: "페이더" };

type Tab = "all" | "key" | "dial" | "fader";
const TABS: { id: Tab; name: string }[] = [{ id: "all", name: "전체" }, { id: "key", name: "키" }, { id: "dial", name: "노브" }, { id: "fader", name: "페이더" }];
const TAB_NOTE: Record<Tab, string> = {
  all: "",
  key: "키에 넣는 기능이에요. 노브의 각 칸(돌리기·누르기)에도 넣을 수 있어요.",
  dial: "노브 돌리기 두 방향을 한 번에 채우는 기능이에요. 키 기능도 노브의 각 칸에 넣을 수 있어요.",
  fader: "페이더 위치(0~100%)를 값으로 쓰는 기능이에요.",
};
const fits = (d: ActionDef, tab: Tab) => d.category !== "숨김" && (tab === "all" ? d.slots.length > 0 : d.slots.includes(tab));

function osTag(d: ActionDef): string {
  const os = d.os?.({}, { os: "windows", store: useApp.getState().store, pageIndex: () => -1 });
  if (!os || os.length !== 1) return "";
  return os[0] === "windows" ? "Windows 전용" : "Mac 전용";
}

function Item({ d }: { d: ActionDef }) {
  const tag = osTag(d);
  return (
    <div className="lib-item" draggable
      onDragStart={(e) => startDrag(e, { kind: "action", ref: { type: d.id, params: {} }, slots: d.slots })}
      onDragEnd={endDrag}
      title="키·노브·페이더로 끌어다 놓으세요">
      <span className="lib-icon">{d.icon}</span>
      <span className="grow">{d.name}</span>
      {tag && <span className="badge">{tag}</span>}
      {d.slots.filter((s) => s !== "key").map((s) => <span key={s} className="badge slot">{SLOT_NAME[s]}</span>)}
    </div>
  );
}

export function Library() {
  const [q, setQ] = useState("");
  const [appId, setAppId] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ 화면: true, 페이지: true, 키보드: true });
  const [macro, setMacro] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const macros = useApp((s) => s.store.macros);
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const query = q.trim().toLowerCase();
  const match = (d: ActionDef) => fits(d, tab) && (!query || d.name.toLowerCase().includes(query));
  const pack = APP_PACKS.find((p) => p.id === appId);
  const showVisuals = tab === "all" || tab === "key";
  const packs = APP_PACKS.filter((p) => p.actions.some((d) => fits(d, tab)));

  return (
    <aside className="library">
      <div className="panel-head"><b>기능</b></div>
      <input className="search" placeholder="기능 찾기…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="seg tabs">
        {TABS.map((t) => <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.name}</button>)}
      </div>
      {TAB_NOTE[tab] && <p className="muted small">{TAB_NOTE[tab]}</p>}
      <div className="lib-scroll">
        {query ? (
          <>
            {[...ACTIONS, ...APP_PACKS.flatMap((p) => p.actions)].filter(match).map((d) => <Item key={d.id} d={d} />)}
          </>
        ) : pack ? (
          <>
            <button className="lib-back" onClick={() => setAppId(null)}>← 앱 목록</button>
            <div className="lib-app-title">{pack.icon} {pack.name}</div>
            <p className="muted small">{pack.note}</p>
            {pack.actions.filter(match).map((d) => <Item key={d.id} d={d} />)}
          </>
        ) : (
          <>
            {showVisuals && <Section title="화면 표시" id="화면" open={open} toggle={toggle}>
              {VISUALS.map((v) => (
                <div key={v.name} className="lib-item" draggable onDragStart={(e) => startDrag(e, v.item)} onDragEnd={endDrag}>
                  <span className="lib-icon">{v.icon}</span><span className="grow">{v.name}</span>
                </div>
              ))}
            </Section>}
            {CATEGORIES.filter((c) => ACTIONS.some((d) => d.category === c && match(d))).map((c) => (
              <Section key={c} title={c} id={c} open={tab === "all" ? open : { ...open, [c]: open[c] ?? true }} toggle={toggle}>
                {ACTIONS.filter((d) => d.category === c && match(d)).map((d) => <Item key={d.id} d={d} />)}
              </Section>
            ))}
            {showVisuals && <Section title="매크로" id="매크로" open={open} toggle={toggle}>
              {macros.map((m) => (
                <div key={m.id} className="lib-item" draggable
                  onDragStart={(e) => startDrag(e, { kind: "action", ref: { type: "macro", params: { macroId: m.id } }, slots: ["key"] })}
                  onDragEnd={endDrag}>
                  <span className="lib-icon">🧩</span><span className="grow">{m.name}</span>
                  <button className="ghost small" onClick={() => setMacro(m.id)}>편집</button>
                </div>
              ))}
              <button className="lib-add" onClick={() => setMacro("new")}>+ 새 매크로 만들기</button>
            </Section>}
            <Section title="앱" id="앱" open={{ ...open, 앱: true }} toggle={() => {}}>
              {packs.map((p) => (
                <button key={p.id} className="lib-item lib-app" onClick={() => setAppId(p.id)}>
                  <span className="lib-icon">{p.icon}</span><span className="grow">{p.name}</span>
                  <span className="muted small">{p.actions.filter((d) => fits(d, tab)).length}개 ›</span>
                </button>
              ))}
              <p className="muted small">다른 프로그램도 계속 추가할 예정이에요.</p>
            </Section>
          </>
        )}
      </div>
      {macro && <MacroEditor id={macro === "new" ? null : macro} onClose={() => setMacro(null)} />}
    </aside>
  );
}

function Section({ title, id, open, toggle, children }: { title: string; id: string; open: Record<string, boolean>; toggle: (k: string) => void; children: React.ReactNode }) {
  return (
    <div className="lib-section">
      <button className="lib-section-head" onClick={() => toggle(id)}>{open[id] ? "▾" : "▸"} {title}</button>
      {open[id] && <div>{children}</div>}
    </div>
  );
}
