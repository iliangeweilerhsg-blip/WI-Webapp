'use client';

// Bestätigung für „Stopp“ per Tastenkürzel (07 §10: ⌘⇧S). Kein Modal: Folie und Notizen bleiben sichtbar, die
// Aufnahme läuft bis zur Bestätigung weiter. Der Fokus liegt auf der ungefährlichen Antwort („Weiter aufnehmen“).
import { useEffect, useRef, type KeyboardEvent } from 'react';

const button =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised';

export function StopConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Fokus zurück an die Stelle vor der Frage
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    return () => {
      if (previous && previous !== document.body && document.contains(previous)) previous.focus();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby="stop-confirm-title"
      onKeyDown={onKeyDown}
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-raised px-3 py-2"
    >
      <p id="stop-confirm-title" className="text-md font-medium">
        Session beenden?
      </p>
      <div className="flex flex-wrap gap-2">
        <button ref={cancel} type="button" className={button} onClick={onCancel}>
          Weiter aufnehmen
        </button>
        <button type="button" className={button} onClick={onConfirm}>
          Session beenden
        </button>
      </div>
    </div>
  );
}
