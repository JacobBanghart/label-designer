/**
 * Export as a menu rather than three toolbar buttons.
 *
 * The three formats are not equally important -- PDF and PNG are artifacts you
 * hand to someone, JSON is a save file -- and spending three toolbar slots on
 * an action taken occasionally crowded out the tools used constantly.
 */

import { useEffect, useRef, useState } from "react";

export interface ExportAction {
  id: string;
  label: string;
  hint: string;
  run: () => void | Promise<void>;
}

interface Props {
  actions: readonly ExportAction[];
}

export function ExportMenu({ actions }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape, the two things every menu must do.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Export ▾
      </button>

      {open && (
        <div className="menu-items" role="menu">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void action.run();
              }}
            >
              <span className="menu-label">{action.label}</span>
              <span className="menu-hint">{action.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
