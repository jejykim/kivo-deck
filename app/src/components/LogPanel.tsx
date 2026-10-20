import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../state";

const COMMANDS = [
  { label: "hello", line: '{"cmd":"hello"}' },
  { label: "ping", line: '{"cmd":"ping"}' },
  { label: "state", line: '{"cmd":"state"}' },
  { label: "터치 보정", line: '{"cmd":"calibrate"}' },
];

// Device log on the left, folded by default
export function LogPanel() {
  const [open, setOpen] = useState(false);
  const log = useApp((s) => s.log);
  const addLog = useApp((s) => s.addLog);

  const send = async (line: string) => {
    try {
      await invoke("send_command", { line });
      addLog(line, "out");
    } catch (e) {
      addLog(String(e), "err");
    }
  };

  if (!open) {
    return (
      <aside className="log folded" onClick={() => setOpen(true)} title="로그 펼치기">
        <span>로그 ▸</span>
        {log.some((l) => l.kind === "err") && <i className="dot err" />}
      </aside>
    );
  }
  return (
    <aside className="log">
      <div className="panel-head">
        <b>로그</b>
        <button className="ghost" onClick={() => useApp.setState({ log: [] })}>지우기</button>
        <button className="ghost" onClick={() => setOpen(false)} title="접기">◂</button>
      </div>
      <div className="buttons">
        {COMMANDS.map((c) => <button key={c.label} onClick={() => send(c.line)}>{c.label}</button>)}
      </div>
      <pre>
        {log.map((l, i) => (
          <div key={i} className={l.kind}>
            {new Date(l.t).toLocaleTimeString()}  {l.text}
          </div>
        ))}
      </pre>
    </aside>
  );
}
