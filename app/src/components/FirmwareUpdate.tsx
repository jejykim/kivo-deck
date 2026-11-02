// Firmware update over the USB serial link (docs/protocol.md). Checks the latest GitHub release when
// a board connects, and also accepts a firmware.bin picked from disk.
import { useEffect, useState } from "react";
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useApp } from "../state";
import { Modal } from "./Modal";

type Release = { version: string; url: string; size: number };
type Phase = "idle" | "sending" | "restarting" | "done" | "error";

// How long a restarted board may take to come back with its hello. The firmware rolls back within 60 s.
const RESTART_WAIT_MS = 90000;

const useFirmware = create<{ release: Release | null; checked: boolean; error: string | null }>(() => ({
  release: null, checked: false, error: null,
}));

function newer(a: string, b: string) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

export async function checkFirmware() {
  try {
    const release = await invoke<Release | null>("firmware_latest");
    useFirmware.setState({ release, checked: true, error: null });
  } catch (e) {
    useFirmware.setState({ checked: true, error: String(e) });
  }
}

function useBoard() {
  const device = useApp((s) => s.device);
  const fw: string = device.hello?.fw ?? "";
  return { connected: device.connected, fw, canUpdate: device.connected && !!device.hello?.ota };
}

// Header icon when the release is newer than the connected board
export function FirmwareButton() {
  const { canUpdate, fw } = useBoard();
  const release = useFirmware((s) => s.release);
  const [show, setShow] = useState(false);
  if (!canUpdate || !release || !newer(release.version, fw)) return null;
  return (
    <>
      <button className="icon update" title={`새 펌웨어 ${release.version}`} onClick={() => setShow(true)}>▣</button>
      {show && <FirmwareDialog onClose={() => setShow(false)} />}
    </>
  );
}

export function FirmwareDialog({ onClose }: { onClose: () => void }) {
  const { connected, fw, canUpdate } = useBoard();
  const fs = useFirmware();
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [expected, setExpected] = useState("");
  const [picked, setPicked] = useState<{ path: string; version: string } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const un = listen<{ done: number; total: number }>("firmware-progress", (e) => setProgress(e.payload.done / e.payload.total));
    return () => { un.then((f) => f()); };
  }, []);

  // The transfer is only half of it: the board must come back and keep the new version
  useEffect(() => {
    if (phase !== "restarting") return;
    if (connected && fw === expected) {
      setPhase("done");
      useApp.getState().addLog(`펌웨어 ${fw} 설치 완료`, "sys");
      return;
    }
    if (connected && fw) {
      setPhase("error");
      setMessage(`새 펌웨어가 정상적으로 켜지지 않아 ${fw}로 돌아갔어요.`);
      return;
    }
    const t = setTimeout(() => {
      setPhase("error");
      setMessage("보드가 다시 연결되지 않았어요. USB를 뺐다 꽂아 보세요.");
    }, RESTART_WAIT_MS);
    return () => clearTimeout(t);
  }, [phase, connected, fw, expected]);

  const pick = async () => {
    const path = await open({ multiple: false, filters: [{ name: "펌웨어", extensions: ["bin"] }] });
    if (typeof path !== "string") return;
    try {
      setMessage("");
      setPhase("idle");
      setPicked({ path, version: await invoke<string>("firmware_file_version", { path }) });
    } catch (e) {
      setPicked(null);
      setPhase("error");
      setMessage(String(e));
    }
  };

  const install = async (args: { path?: string; url?: string }) => {
    setPhase("sending");
    setProgress(0);
    setMessage("");
    try {
      const version = await invoke<string>("firmware_install", args);
      setExpected(version);
      // device-status drops to "not connected" around here; forget the old hello right away
      useApp.setState((s) => ({ device: { ...s.device, connected: false, hello: null } }));
      setPhase("restarting");
    } catch (e) {
      setPhase("error");
      setMessage(String(e));
      useApp.getState().addLog(`펌웨어 업데이트 실패: ${e}`, "err");
    }
  };

  const busy = phase === "sending" || phase === "restarting";
  const canInstall = canUpdate && !busy;
  const release = fs.release;
  const hasNew = !!release && connected && newer(release.version, fw);

  return (
    <Modal title="보드 펌웨어" onClose={busy ? undefined : onClose}>
      <p>지금 버전 <b>{phase === "restarting" ? "확인 중…" : connected ? fw || "?" : "연결 안 됨"}</b></p>

      {connected && !canUpdate && !busy && (
        <p className="warn-text">이 보드의 펌웨어는 앱 업데이트를 지원하지 않아요. 0.3.0 이상을 USB로 한 번 직접 올려야 해요.</p>
      )}

      <h4>최신 릴리스</h4>
      {!fs.checked && <p className="muted small">확인 중…</p>}
      {fs.checked && fs.error && <p className="muted small">릴리스를 확인하지 못했어요 (인터넷 연결 문제일 수 있어요)</p>}
      {fs.checked && !fs.error && !release && <p className="muted small">아직 올라온 펌웨어 릴리스가 없어요</p>}
      {release && (
        <div className="row">
          <span>{release.version} {!hasNew && connected && <span className="muted">(새 버전 아님)</span>}</span>
          <div className="spacer" />
          <button className="primary" disabled={!canInstall || !hasNew} onClick={() => install({ url: release.url })}>업데이트</button>
        </div>
      )}
      <div className="row end">
        <button disabled={checking} onClick={async () => { setChecking(true); await checkFirmware(); setChecking(false); }}>
          {checking ? "확인 중…" : "다시 확인"}
        </button>
      </div>

      <h4>파일에서 설치</h4>
      <div className="row">
        <span className="grow muted small">{picked ? `${picked.path} (버전 ${picked.version})` : "firmware.bin 파일을 직접 골라요"}</span>
        <button disabled={busy} onClick={pick}>파일 선택</button>
        <button className="primary" disabled={!canInstall || !picked} onClick={() => picked && install({ path: picked.path })}>설치</button>
      </div>

      {phase === "sending" && (
        <>
          <div className="bar"><div style={{ width: `${progress * 100}%` }} /></div>
          <p className="muted small">보내는 중… {Math.round(progress * 100)}% USB를 빼지 마세요. 키와 노브는 끝날 때까지 쉬어요.</p>
        </>
      )}
      {phase === "restarting" && <p className="muted small">보드가 재시작하고 있어요. 다시 연결될 때까지 기다려 주세요…</p>}
      {phase === "done" && <p>펌웨어 {expected} 설치를 끝냈어요 ✓</p>}
      {phase === "error" && <p className="err-text">{message}</p>}

      <p className="muted small">보정 값과 키 설정은 그대로 남아요. 새 펌웨어가 정상적으로 켜지지 않으면 보드가 이전 버전으로 스스로 돌아가요.</p>
      <div className="row end">
        <button onClick={onClose} disabled={busy}>닫기</button>
      </div>
    </Modal>
  );
}
