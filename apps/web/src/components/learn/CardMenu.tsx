'use client';

import { useEffect, useId, useRef, useState } from 'react';

const item =
  'block min-h-9 w-full rounded-md px-3 py-1 text-left text-sm hover:bg-surface-raised aria-disabled:opacity-50';

export interface CardMenuProps {
  suspended: boolean;
  /** Kurzer Name für Screenreader („Karte: …“) */
  label: string;
  busy?: boolean;
  onEdit: () => void;
  onToggleSuspended: () => void;
  onDelete: () => void;
}

/**
 * Menü je Karte (VERTRAEGE §21.10): Bearbeiten, Pausieren bzw. Fortsetzen, Löschen. Eine aufklappbare Liste ohne
 * Dialog; Esc schließt und gibt den Fokus zurück.
 */
export function CardMenu({
  suspended,
  label,
  busy = false,
  onEdit,
  onToggleSuspended,
  onDelete,
}: CardMenuProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Menü: ${label}`}
        className="min-h-9 min-w-9 rounded-md border border-border px-2 text-sm hover:bg-surface sg-transition"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <ul
          id={listId}
          className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-border-strong bg-surface-raised p-1 shadow-sm"
        >
          <li>
            <button type="button" className={item} onClick={() => choose(onEdit)}>
              Bearbeiten
            </button>
          </li>
          <li>
            <button
              type="button"
              className={item}
              aria-disabled={busy}
              onClick={() => {
                if (!busy) choose(onToggleSuspended);
              }}
            >
              {suspended ? 'Fortsetzen' : 'Pausieren'}
            </button>
          </li>
          <li>
            <button
              type="button"
              className={item}
              aria-disabled={busy}
              onClick={() => {
                if (!busy) choose(onDelete);
              }}
            >
              Löschen
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
