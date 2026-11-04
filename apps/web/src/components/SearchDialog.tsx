'use client';

import { useEffect, useRef } from 'react';

/** Platzhalter für die Suche (⌘K, 07 §3.12). Overlay mittig, 640 px breit. Die echte Suche folgt in Phase 2. */
export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    // Fokus im Dialog halten: Tab wandert zwischen Eingabefeld und Schließen-Knopf
    if (e.key === 'Tab') {
      const first = inputRef.current;
      const last = closeRef.current;
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[15vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Suche"
        onKeyDown={onKeyDown}
        className="w-full max-w-[640px] rounded-lg border border-border bg-surface-raised p-4 shadow-lg"
      >
        <input
          ref={inputRef}
          type="search"
          aria-label="Suchbegriff"
          placeholder="Suchen …"
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-md"
        />
        <p className="mt-4 text-sm text-text-muted">
          Die Suche kommt in Phase 2. Dann findest du hier Konzepte, Folien, Gesagtes, Notizen, Aufgaben und
          Karten.
        </p>
        <div className="mt-4 flex items-center justify-between text-xs text-text-muted">
          <span>Esc schließt</span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1 text-sm hover:bg-surface"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
