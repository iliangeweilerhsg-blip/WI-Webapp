'use client';

// Bestätigung für „Stopp“: per Tastenkürzel (07 §10: ⌘⇧S) und per Knopf „Beenden“ der Statusleiste (UX-06).
// Kein Modal: Folie und Notizen bleiben sichtbar, die
// Aufnahme läuft bis zur Bestätigung weiter. Der Fokus liegt auf der ungefährlichen Antwort („Weiter aufnehmen“).
import { useEffect, useRef } from 'react';

const button =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised';

export function StopConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    // Fokus zurück an die Stelle vor der Frage
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    // Esc gilt, solange die Frage offen ist, auch wenn der Fokus draußen liegt. Tab kreist zwischen den zwei Knöpfen.
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(box.current?.querySelectorAll<HTMLElement>('button') ?? []);
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && box.current?.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (previous && previous !== document.body && document.contains(previous)) previous.focus();
    };
  }, []);

  return (
    <div
      ref={box}
      role="alertdialog"
      aria-labelledby="stop-confirm-title"
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
