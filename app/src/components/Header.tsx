import { useState } from "react";
import logo from "../assets/kivo-logo.png";
import { OS_LABEL, resolvePreset } from "../model";
import { useApp } from "../state";
import { applyToDevice, useSync } from "../sync";
import { UpdateButton } from "./UpdateButton";
import { SettingsDialog } from "./SettingsDialog";

export function Header() {
  const device = useApp((s) => s.device);
  const store = useApp((s) => s.store);
  const hostOS = useApp((s) => s.hostOS);
  const draftHash = useApp((s) => s.draftHash);
  const appliedHash = useApp((s) => s.appliedHash);
  const sync = useSync();
  const [settings, setSettings] = useState(false);

  const { preset, borrowed } = resolvePreset(store, hostOS);
  const deviceHash = device.hello?.bundle ?? appliedHash;
  const upToDate = device.connected && !!draftHash && deviceHash === draftHash;

  let applyText = "보드에 적용";
  if (sync.busy) applyText = `적용 중… ${Math.round(sync.progress * 100)}%`;
  else if (upToDate) applyText = "적용됨 ✓";

  return (
    <header className="top">
      <img className="logo" src={logo} alt="" />
      <h1>Kivo Deck</h1>
      <span className={`pill ${device.connected ? "ok" : "warn"}`}>
        {device.connected ? `연결됨 · ${device.port} · fw ${device.hello?.fw ?? "?"}` : "보드를 찾는 중…"}
      </span>
      <span className="muted">
        이 PC: {OS_LABEL[hostOS]} · 사용 중: {preset ? `${OS_LABEL[preset.os]} · ${preset.name}` : "없음"}
        {borrowed && <b className="warn-text"> (다른 OS 프리셋 사용 중)</b>}
      </span>
      <div className="spacer" />
      <button
        className={`primary ${upToDate ? "done" : ""}`}
        disabled={sync.busy || !device.connected}
        onClick={() => applyToDevice(true)}
        title={device.connected ? "편집한 내용을 보드에 저장해요" : "보드를 연결하면 적용할 수 있어요"}
      >
        {applyText}
      </button>
      <UpdateButton />
      <button className="icon" title="설정" onClick={() => setSettings(true)}>⚙</button>
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
    </header>
  );
}
