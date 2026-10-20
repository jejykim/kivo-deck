import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../state";
import { Modal } from "./Modal";

export interface AppEntry { name: string; path: string; exe: string | null }

// The list takes a moment to read (shortcut targets), so it is fetched once per app run
let cache: Promise<AppEntry[]> | null = null;
export const installedApps = () => (cache ??= invoke<AppEntry[]>("installed_apps").catch(() => []));

// mode "launch": returns the shortcut / .app to open. mode "process": returns the program name
// (exe on Windows) used to find its sound and window, and lists programs playing sound first.
export function AppPicker({ mode, onPick, onClose }: { mode: "launch" | "process"; onPick: (value: string) => void; onClose: () => void }) {
  const [apps, setApps] = useState<AppEntry[] | null>(null);
  const [sound, setSound] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const recent = useApp((s) => s.recentApps);

  useEffect(() => {
    installedApps().then(setApps);
    if (mode === "process") invoke<string[]>("audio_apps").then(setSound).catch(() => {});
  }, [mode]);

  const query = q.trim().toLowerCase();
  const list = (apps ?? []).filter((a) => (mode === "launch" || a.exe) && (!query || a.name.toLowerCase().includes(query) || a.exe?.toLowerCase().includes(query)));
  const pick = (v: string) => { onPick(v); onClose(); };

  return (
    <Modal title={mode === "launch" ? "실행할 앱 고르기" : "프로그램 고르기"} onClose={onClose} wide>
      <input className="search" autoFocus placeholder="앱 이름으로 찾기…" value={q} onChange={(e) => setQ(e.target.value)} />
      {mode === "process" && !query && (sound.length > 0 || recent.length > 0) && (
        <>
          {sound.length > 0 && <p className="muted small">지금 소리를 내고 있는 프로그램</p>}
          <div className="row wrap">{sound.map((s) => <button key={s} className="chip" onClick={() => pick(s)}>🔊 {s}</button>)}</div>
          {recent.length > 0 && <p className="muted small">최근에 앞에 있던 프로그램</p>}
          <div className="row wrap">{recent.map((s) => <button key={s} className="chip" onClick={() => pick(s)}>{s}</button>)}</div>
          <p className="muted small">설치된 앱</p>
        </>
      )}
      <div className="app-list">
        {apps == null && <p className="muted">설치된 앱을 읽는 중…</p>}
        {apps != null && list.length === 0 && <p className="muted">찾는 앱이 없어요. 위치를 직접 입력해 주세요.</p>}
        {list.map((a) => (
          <button key={a.path} className="app-row" onClick={() => pick(mode === "launch" ? a.path : a.exe!)} title={a.path}>
            <b>{a.name}</b>
            <span className="muted small">{mode === "launch" ? a.exe ?? a.path : a.exe}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
