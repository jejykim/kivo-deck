import type { ReactNode } from "react";

// docked: leaves the action library on the right usable (drag into the dialog)
export function Modal({ title, onClose, children, wide, docked }: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean; docked?: boolean }) {
  return (
    <div className={`modal-back ${docked ? "docked" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? "wide" : ""}`}>
        <div className="modal-head">
          <b>{title}</b>
          {onClose && <button className="icon" onClick={onClose}>✕</button>}
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
