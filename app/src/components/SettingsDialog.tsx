import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useApp } from "../state";
import { Modal } from "./Modal";
import { checkForUpdate, UpdateDialog, useUpdate } from "./UpdateButton";
import { FirmwareDialog } from "./FirmwareUpdate";
import { TouchDialog } from "./TouchDialog";
import { KeyMapDialog } from "./KeyMapDialog";

// Makes the OS login item match the setting. Skipped in dev builds so the dev exe is never registered.
export async function syncAutostart() {
  if (import.meta.env.DEV) return;
  const want = useApp.getState().store.settings.autostart;
  try {
    const on = await isEnabled();
    if (want && !on) await enable();
    if (!want && on) await disable();
  } catch (e) {
    useApp.getState().addLog(`자동 실행 설정 실패: ${e}`, "err");
  }
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useApp((s) => s.store.settings);
  const update = useApp((s) => s.update);
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);
  const [showFirmware, setShowFirmware] = useState(false);
  const [showTouch, setShowTouch] = useState(false);
  const [showKeyMap, setShowKeyMap] = useState(false);
  const fw = useApp((s) => s.device.hello?.fw);
  const upd = useUpdate();

  useEffect(() => { getVersion().then(setVersion); }, []);

  const set = (fn: (s: typeof settings) => void) => update((st) => fn(st.settings));

  return (
    <Modal title="설정" onClose={onClose}>
      <h4>시작</h4>
      <label className="check">
        <input type="checkbox" checked={settings.autostart}
          onChange={(e) => { set((s) => { s.autostart = e.target.checked; }); setTimeout(syncAutostart, 0); }} />
        컴퓨터를 켜면 Kivo Deck 자동 실행 {import.meta.env.DEV && <span className="muted">(개발 모드에서는 등록하지 않아요)</span>}
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.startHidden} onChange={(e) => set((s) => { s.startHidden = e.target.checked; })} />
        자동 실행될 때는 창 없이 트레이에서만 시작
      </label>

      <h4>보드</h4>
      <label className="field">
        <span>화면 보호 (입력이 없으면 화면 끄기)</span>
        <select value={settings.saverMinutes} onChange={(e) => set((s) => { s.saverMinutes = Number(e.target.value); })}>
          <option value={0}>사용 안 함</option>
          {[1, 5, 10, 30, 60].map((m) => <option key={m} value={m}>{m}분</option>)}
        </select>
      </label>
      <p className="muted small">백라이트가 전원에 바로 연결되어 있어 밝기는 조절할 수 없어요. 화면 보호는 검은 화면으로 바꿔요. 아무 입력이나 하면 깨어나요.</p>
      <label className="check">
        <input type="checkbox" checked={settings.autoSwitch} onChange={(e) => set((s) => { s.autoSwitch = e.target.checked; })} />
        앞에 있는 프로그램에 따라 페이지 자동 전환 (페이지 메뉴에서 규칙 지정)
      </label>
      <div className="row">
        <span>펌웨어 {fw ?? "(보드 없음)"}</span>
        <div className="spacer" />
        <button onClick={() => setShowTouch(true)}>터치 조절</button>
        <button onClick={() => setShowFirmware(true)}>펌웨어 업데이트</button>
      </div>
      {showFirmware && <FirmwareDialog onClose={() => setShowFirmware(false)} />}
      {showTouch && <TouchDialog onClose={() => setShowTouch(false)} onKeyMap={() => { setShowTouch(false); setShowKeyMap(true); }} />}
      {showKeyMap && <KeyMapDialog onClose={() => setShowKeyMap(false)} />}

      <h4>OBS Studio</h4>
      <div className="row">
        <label className="field grow"><span>주소</span>
          <input value={settings.obs.host} onChange={(e) => set((s) => { s.obs.host = e.target.value; })} /></label>
        <label className="field"><span>포트</span>
          <input type="number" value={settings.obs.port} style={{ width: 90 }} onChange={(e) => set((s) => { s.obs.port = Number(e.target.value); })} /></label>
      </div>
      <label className="field"><span>비밀번호</span>
        <input type="password" value={settings.obs.password} onChange={(e) => set((s) => { s.obs.password = e.target.value; })} /></label>
      <p className="muted small">OBS → 도구 → WebSocket 서버 설정에서 서버를 켜고 같은 값을 넣어 주세요. 바꾼 뒤 "보드에 적용"을 눌러야 반영돼요.</p>

      <h4>앱 정보</h4>
      <div className="row">
        <span>버전 {version}</span>
        <div className="spacer" />
        <button disabled={checking} onClick={async () => {
          setChecking(true);
          const u = await checkForUpdate();
          setChecking(false);
          if (u) setShowUpdate(true);
        }}>{checking ? "확인 중…" : "업데이트 확인"}</button>
      </div>
      {upd.checked && !upd.update && !checking && <p className="muted small">{upd.error ? "업데이트 정보를 가져오지 못했어요 (아직 릴리스가 없거나 인터넷 연결 문제)" : "최신 버전이에요"}</p>}
      {showUpdate && upd.update && <UpdateDialog update={upd.update} onClose={() => setShowUpdate(false)} />}
    </Modal>
  );
}
