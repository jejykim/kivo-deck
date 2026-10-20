import { CELL_H, CELL_W, spanOfKey, type KeyVisual, type LiveKind, type OS, type Page, type Preset } from "../model";
import { updatePage, updatePreset, useApp } from "../state";
import { clearSpans, dropOnKnob, rectOf, rectKeys, useMediaRequest } from "../drop";
import { emptyKey } from "../model";
import { ActionSlot } from "./ActionSlot";
import { pickFile, usePreviewOS } from "./DeckView";

const LIVE: { id: LiveKind; name: string }[] = [
  { id: "clock", name: "시계" }, { id: "date", name: "날짜" }, { id: "cpu", name: "CPU 사용률" },
  { id: "mem", name: "메모리 사용률" }, { id: "timer", name: "스톱워치" },
];

export function Inspector({ preset, page }: { preset: Preset; page: Page }) {
  const selection = useApp((s) => s.selection);
  const previewOS = usePreviewOS(preset);
  if (!selection) {
    return <div className="inspector empty muted">키·노브·페이더를 누르면 여기에서 자세히 설정할 수 있어요. 기능은 오른쪽 목록에서 끌어다 놓으세요.</div>;
  }
  if (selection.kind === "knob") return <KnobInspector preset={preset} id={selection.id} os={previewOS} />;
  if (selection.kind === "fader") return <FaderInspector preset={preset} id={selection.id} os={previewOS} />;
  if (selection.keys.length > 1) return <MultiKeyInspector page={page} keys={selection.keys} />;
  return <KeyInspector page={page} k={selection.keys[0]} os={previewOS} />;
}

function KeyInspector({ page, k, os }: { page: Page; k: number; os: OS }) {
  const key = page.keys[k];
  const span = spanOfKey(page, k);
  const setKey = (fn: (key: typeof page.keys[number]) => void) => updatePage((pg) => fn(pg.keys[k]));

  return (
    <div className="inspector">
      <div className="insp-head">
        <b>키 {k + 1}</b>
        <div className="spacer" />
        <button className="ghost small" onClick={() => updatePage((pg) => { clearSpans(pg, [k]); pg.keys[k] = emptyKey(); })}>키 비우기</button>
      </div>
      <div className="insp-cols">
        <section>
          <h4>화면 표시</h4>
          {span ? (
            <div className="slot-box">
              <p className="small">이 키는 여러 칸 이미지({span.c1 - span.c0 + 1}×{span.r1 - span.r0 + 1})에 들어 있어요.</p>
              <div className="row wrap">
                <div className="seg small">
                  <button className={span.fit === "cover" ? "on" : ""} onClick={() => updatePage((pg) => { pg.spans.find((s) => s.id === span.id)!.fit = "cover"; })}>꽉 채우기</button>
                  <button className={span.fit === "contain" ? "on" : ""} onClick={() => updatePage((pg) => { pg.spans.find((s) => s.id === span.id)!.fit = "contain"; })}>전체 보이기</button>
                </div>
                <button className="ghost small" onClick={() => updatePage((pg) => { pg.spans = pg.spans.filter((s) => s.id !== span.id); })}>여러 칸 이미지 빼기</button>
              </div>
            </div>
          ) : (
            <VisualEditor visual={key.visual} k={k} target="visual" onChange={(v) => setKey((kk) => { kk.visual = v; })} />
          )}
          <TitleEditor visual={key.visual} onChange={(v) => setKey((kk) => { kk.visual = v; })} />
        </section>
        <section>
          <h4>동작</h4>
          <ActionSlot label={key.toggle ? "누르기 (꺼짐 → 켜짐)" : "누르기"} accept="key" previewOS={os} value={key.tap} onChange={(a) => setKey((kk) => { kk.tap = a; })} />
          <ActionSlot label="길게 누르기 (0.5초)" accept="key" previewOS={os} value={key.long} onChange={(a) => setKey((kk) => { kk.long = a; })} hint="비워 두면 길게 눌러도 그냥 누르기로 동작해요" />
          <ActionSlot label="두 번 누르기" accept="key" previewOS={os} value={key.double} onChange={(a) => setKey((kk) => { kk.double = a; })} hint="넣으면 한 번 누르기가 0.25초 늦게 실행돼요" />
          <label className="check">
            <input type="checkbox" checked={key.toggle} onChange={(e) => setKey((kk) => { kk.toggle = e.target.checked; })} />
            토글 키 (누를 때마다 켜짐 / 꺼짐, 예: 음소거)
          </label>
          {key.toggle && (
            <>
              <ActionSlot label="누르기 (켜짐 → 꺼짐)" accept="key" previewOS={os} value={key.offTap} onChange={(a) => setKey((kk) => { kk.offTap = a; })} hint="비워 두면 같은 동작을 다시 실행해요" />
              <div className="sub">
                <span className="small">켜졌을 때 화면</span>
                <VisualEditor visual={key.onVisual} k={k} target="onVisual" onChange={(v) => setKey((kk) => { kk.onVisual = v; })} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function VisualEditor({ visual, onChange, k, target }: { visual: KeyVisual; onChange: (v: KeyVisual) => void; k: number; target: "visual" | "onVisual" }) {
  const media = useApp((s) => s.store.media);
  const set = (p: Partial<KeyVisual>) => onChange({ ...visual, ...p });
  return (
    <div className="visual-editor">
      <div className="seg small">
        {([["none", "기능 아이콘"], ["text", "글자"], ["image", "이미지·GIF"], ["live", "실시간"]] as const).map(([kind, name]) => (
          <button key={kind} className={visual.kind === kind ? "on" : ""} onClick={() => set({ kind })}>{name}</button>
        ))}
      </div>
      {visual.kind === "text" && (
        <>
          <textarea rows={2} value={visual.text ?? ""} placeholder="키에 보일 글자 (줄바꿈 가능)" onChange={(e) => set({ text: e.target.value })} />
          <div className="row">
            <label className="color"><input type="color" value={visual.fg ?? "#ffffff"} onChange={(e) => set({ fg: e.target.value })} /> 글자색</label>
            <label className="color"><input type="color" value={visual.bg ?? "#1b1d24"} onChange={(e) => set({ bg: e.target.value })} /> 배경색</label>
          </div>
        </>
      )}
      {visual.kind === "image" && (
        <div className="row">
          <span className="grow small">{visual.mediaId ? media[visual.mediaId]?.name ?? "(없는 파일)" : "아직 없어요"}</span>
          <button onClick={() => pickFile((f) => useMediaRequest.setState({ req: { file: f[0], keys: [k], target } }))}>파일 고르기… (이미지·GIF·영상)</button>
        </div>
      )}
      {visual.kind === "live" && (
        <select value={visual.live ?? ""} onChange={(e) => set({ live: e.target.value as LiveKind })}>
          <option value="">무엇을 보여 줄까요?</option>
          {LIVE.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      )}
      {visual.kind === "live" && visual.live === "timer" && <p className="muted small">스톱워치는 「시간」의 「스톱워치 시작 / 정지」 기능과 같이 쓰세요.</p>}
      {visual.kind === "none" && <p className="muted small">넣은 기능의 아이콘과 이름이 자동으로 보여요.</p>}
      <p className="muted small">키 한 칸은 {CELL_W}×{Math.round(CELL_H)} 픽셀이에요.</p>
    </div>
  );
}

function TitleEditor({ visual, onChange }: { visual: KeyVisual; onChange: (v: KeyVisual) => void }) {
  const t = visual.title ?? { text: "", pos: "bottom" as const, size: 14, color: "#ffffff" };
  const set = (p: Partial<typeof t>) => onChange({ ...visual, title: { ...t, ...p } });
  return (
    <div className="title-editor">
      <span className="small">제목 글자 (이미지 위에 덧씌움)</span>
      <input value={t.text} placeholder="예: 녹화" onChange={(e) => set({ text: e.target.value })} />
      {t.text && (
        <div className="row">
          <div className="seg small">
            {([["top", "위"], ["middle", "가운데"], ["bottom", "아래"]] as const).map(([pos, name]) => (
              <button key={pos} className={t.pos === pos ? "on" : ""} onClick={() => set({ pos })}>{name}</button>
            ))}
          </div>
          <select value={t.size} onChange={(e) => set({ size: Number(e.target.value) })}>
            {[11, 13, 14, 16, 18, 22, 26].map((s) => <option key={s} value={s}>{s}px</option>)}
          </select>
          <label className="color"><input type="color" value={t.color} onChange={(e) => set({ color: e.target.value })} /></label>
        </div>
      )}
    </div>
  );
}

function MultiKeyInspector({ page, keys }: { page: Page; keys: number[] }) {
  const r = rectOf(keys);
  const ks = rectKeys(r);
  return (
    <div className="inspector">
      <div className="insp-head"><b>키 {ks.length}개 선택 ({r.c1 - r.c0 + 1}×{r.r1 - r.r0 + 1})</b></div>
      <div className="row wrap">
        <button className="primary" onClick={() => pickFile((f) => useMediaRequest.setState({ req: { file: f[0], keys: ks, target: "visual" } }))}>
          이 칸들에 이미지·GIF·영상 넣기…
        </button>
        <button onClick={() => updatePage((pg) => { clearSpans(pg, ks); for (const k of ks) pg.keys[k] = emptyKey(); })}>선택한 키 모두 비우기</button>
      </div>
      <p className="muted small">파일을 선택한 칸 위로 바로 끌어다 놓아도 돼요. 이미 들어 있는 여러 칸 이미지: {page.spans.length}개</p>
    </div>
  );
}

function KnobInspector({ preset, id, os }: { preset: Preset; id: number; os: OS }) {
  const kn = preset.knobs[id];
  const set = (fn: (k: typeof kn) => void) => updatePreset((p) => fn(p.knobs[id]));
  return (
    <div className="inspector">
      <div className="insp-head"><b>노브 {id + 1}</b> <span className="muted small">{id === 0 ? "뒤쪽" : "앞쪽"} · 「노브」 표시가 있는 기능은 돌리기 두 칸을 한 번에 채워요</span></div>
      <div className="insp-cols">
        <section>
          <h4>돌리기</h4>
          <ActionSlot label="↻ 오른쪽으로" accept="key" onDial={(it) => dropOnKnob(id, "rotate", it)} previewOS={os} value={kn.cw} onChange={(a) => set((k) => { k.cw = a; })} />
          <ActionSlot label="↺ 왼쪽으로" accept="key" onDial={(it) => dropOnKnob(id, "rotate", it)} previewOS={os} value={kn.ccw} onChange={(a) => set((k) => { k.ccw = a; })} />
          <ActionSlot label="⏺ 누르기" accept="key" previewOS={os} value={kn.press} onChange={(a) => set((k) => { k.press = a; })} />
        </section>
        <section>
          <h4>누른 채 돌리기</h4>
          <ActionSlot label="⏺↻ 누른 채 오른쪽" accept="key" onDial={(it) => dropOnKnob(id, "pressRotate", it)} previewOS={os} value={kn.pressCw} onChange={(a) => set((k) => { k.pressCw = a; })} />
          <ActionSlot label="⏺↺ 누른 채 왼쪽" accept="key" onDial={(it) => dropOnKnob(id, "pressRotate", it)} previewOS={os} value={kn.pressCcw} onChange={(a) => set((k) => { k.pressCcw = a; })} />
          <p className="muted small">누른 채 돌리면 「누르기」는 실행되지 않아요.</p>
        </section>
      </div>
    </div>
  );
}

function FaderInspector({ preset, id, os }: { preset: Preset; id: number; os: OS }) {
  const f = preset.faders[id];
  return (
    <div className="inspector">
      <div className="insp-head"><b>페이더 {id + 1}</b> <span className="muted small">{id === 0 ? "왼쪽" : "오른쪽"} · 위치(0~100%)를 그대로 값으로 써요</span></div>
      <ActionSlot label="페이더" accept="fader" previewOS={os} value={f.action}
        onChange={(a) => updatePreset((p) => { p.faders[id].action = a; })} hint="「페이더」 표시가 있는 기능을 끌어다 놓으세요" />
      <p className="muted small">페이더 기능은 PC 앱이 실행해요. 앱이 꺼져 있으면 페이더는 동작하지 않아요.</p>
    </div>
  );
}
