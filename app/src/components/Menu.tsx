import { useEffect, useRef, useState, type ReactNode } from "react";

// Small dropdown: a button that opens a list of actions below it
export function Menu({ label, title, children }: { label: ReactNode; title?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button title={title} onClick={() => setOpen((o) => !o)}>{label}</button>
      {open && <div className="menu-list">{children(() => setOpen(false))}</div>}
    </div>
  );
}
