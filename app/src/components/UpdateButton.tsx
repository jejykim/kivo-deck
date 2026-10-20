// Checks GitHub releases (jejykim/kivo-deck, latest.json) at startup. When a newer version exists,
// an icon appears in the header; the popup downloads, installs and restarts.
import { useState } from "react";
import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Modal } from "./Modal";

const useUpdate = create<{ update: Update | null; checked: boolean; error: string | null }>(() => ({
  update: null, checked: false, error: null,
}));

export async function checkForUpdate(): Promise<Update | null> {
  try {
    const update = await check();
    useUpdate.setState({ update, checked: true, error: null });
    return update;
  } catch (e) {
    // no release yet, offline, ... : stay quiet in the header
    useUpdate.setState({ checked: true, error: String(e) });
    return null;
  }
}

export function UpdateButton() {
  const update = useUpdate((s) => s.update);
  const [open, setOpen] = useState(false);
  if (!update) return null;
  return (
    <>
      <button className="icon update" title={`새 버전 ${update.version}`} onClick={() => setOpen(true)}>⬆</button>
      {open && <UpdateDialog update={update} onClose={() => setOpen(false)} />}
    </>
  );
}

export function UpdateDialog({ update, onClose }: { update: Update; onClose: () => void }) {
  const [state, setState] = useState<"idle" | "downloading" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const install = async () => {
    setState("downloading");
    let total = 0, done = 0;
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") { done += e.data.chunkLength; if (total) setProgress(done / total); }
      });
      await relaunch();
    } catch (e) {
      setState("error");
      setError(String(e));
    }
  };

  return (
    <Modal title="새 버전이 있어요" onClose={state === "downloading" ? undefined : onClose}>
      <p>
        지금 버전 <b>{update.currentVersion}</b> → 새 버전 <b>{update.version}</b>
      </p>
      {update.body && <pre className="notes">{update.body}</pre>}
      {state === "downloading" && <div className="bar"><div style={{ width: `${progress * 100}%` }} /></div>}
      {state === "error" && <p className="err-text">업데이트 실패: {error}</p>}
      <div className="row end">
        <button onClick={onClose} disabled={state === "downloading"}>나중에</button>
        <button className="primary" onClick={install} disabled={state === "downloading"}>
          {state === "downloading" ? `받는 중… ${Math.round(progress * 100)}%` : "지금 업데이트"}
        </button>
      </div>
      <p className="muted small">업데이트가 끝나면 앱이 다시 시작돼요.</p>
    </Modal>
  );
}

export { useUpdate };
