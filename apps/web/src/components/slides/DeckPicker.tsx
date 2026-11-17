'use client';

// Auswahl des Foliensatzes (VERTRAEGE §22.7): dieselbe Liste auf der Start-Karte (Heute) und in der Live-Ansicht.
// Kein Dialog, sondern eine Liste, die in der Karte bzw. Spalte aufklappt. Jede Zeile ist ein Knopf (Tab, Pfeil hoch
// und runter, Enter), `Esc` schließt. Der Fokus geht beim Öffnen auf den ersten Eintrag; wohin er beim Schließen
// zurückkehrt, entscheidet die aufrufende Stelle (der Knopf, der die Liste geöffnet hat).
import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { DeckOption, DeckOptions } from '@sg/shared';
import { formatDate } from '../../lib/material.ts';

const row =
  'flex min-h-11 w-full flex-col justify-center gap-0.5 px-3 py-2 text-left text-md hover:bg-surface-raised aria-disabled:opacity-60';

/** „schon in VL 6, VL 5“ (§22.3: höchstens drei, keine Gesamtzahl) */
export function usedByText(option: DeckOption): string | null {
  if (option.used_by.length === 0) return null;
  const names = option.used_by.map((use) =>
    use.number !== null ? `VL ${use.number}` : (use.title ?? 'einer anderen Vorlesung'),
  );
  return `schon in ${names.join(', ')}`;
}

/** Ruhige Angaben unter dem Titel eines Satzes */
function meta(option: DeckOption): string {
  const state =
    option.deck.ingest_state === 'neu'
      ? 'wird verarbeitet'
      : option.deck.ingest_state === 'fehler'
        ? 'konnte nicht gelesen werden'
        : null;
  return [
    option.source === 'moodle' ? 'aus Moodle' : null,
    formatDate(option.available_at) || null,
    usedByText(option),
    state,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

export interface DeckPickerProps {
  options: DeckOptions;
  /** Satz, der gerade gilt (trägt „gewählt“); `null` = ohne Folien */
  selectedId: string | null;
  /** Zeile „Ohne Folien“ anbieten (nicht, wo es nichts zu leeren gibt) */
  allowNone: boolean;
  /** Zeile „PDF hochladen …“ anbieten; bekommt die gewählten Dateien */
  onUpload?: (files: File[]) => void;
  onChoose: (deckId: string | null) => void;
  onClose: () => void;
  /** Eine Wahl ist unterwegs */
  busy?: boolean;
  /** Name der Liste für Screenreader */
  label?: string;
}

export function DeckPicker({
  options,
  selectedId,
  allowNone,
  onUpload,
  onChoose,
  onClose,
  busy = false,
  label = 'Foliensätze',
}: DeckPickerProps) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Beim Öffnen auf den ersten Eintrag, damit die Liste ohne Maus erreichbar ist
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    buttons[(next + buttons.length) % buttons.length]?.focus();
  }

  const choose = (id: string | null) => {
    if (!busy) onChoose(id);
  };
  const current = (on: boolean) => (on ? ('true' as const) : undefined);

  return (
    // `data-slide-keys="off"`: Die Pfeiltasten gehören der Liste, sie blättern keine Folie (das würde den Satz sperren)
    <div
      ref={root}
      data-slide-keys="off"
      onKeyDown={onKeyDown}
      className="mt-2 overflow-hidden rounded-md border border-border bg-surface"
    >
      <ul aria-label={label} aria-busy={busy} className="divide-y divide-border">
        {allowNone ? (
          <li>
            <button
              type="button"
              className={row}
              aria-disabled={busy}
              aria-current={current(selectedId === null)}
              onClick={() => choose(null)}
            >
              <span className="font-medium">Ohne Folien</span>
              {selectedId === null ? <span className="text-sm text-text-muted">gewählt</span> : null}
            </button>
          </li>
        ) : null}
        {options.items.map((item) => {
          const chosen = item.deck.id === selectedId;
          const info = meta(item);
          return (
            <li key={item.deck.id}>
              <button
                type="button"
                className={row}
                aria-disabled={busy}
                aria-current={current(chosen)}
                onClick={() => choose(item.deck.id)}
              >
                <span className="min-w-0 break-words font-medium">{item.deck.title}</span>
                {chosen || info ? (
                  <span className="text-sm text-text-muted">
                    {[chosen ? 'gewählt' : null, info || null].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        {onUpload ? (
          <li>
            <button
              type="button"
              className={row}
              aria-disabled={busy}
              onClick={() => (busy ? undefined : input.current?.click())}
            >
              <span className="font-medium">PDF hochladen …</span>
            </button>
          </li>
        ) : null}
      </ul>
      {onUpload ? (
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          aria-label="PDF-Dateien auswählen"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length > 0) onUpload(files);
          }}
        />
      ) : null}
    </div>
  );
}
