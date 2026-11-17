'use client';

// Folien in der Live-Ansicht wählen, wechseln, hochladen und aus Moodle übernehmen (VERTRAEGE §22.7).
// `NoDeckPanel`: die Spalte ohne (nicht gelöschten) Satz, `DeckStrip`: die Leiste unter den Folien mit Satz.
// Texte ruhig, ohne Rot, ohne Zähler. Nichts davon nimmt den Fokus von selbst oder unterbricht das Mitschreiben.
import { useEffect, useRef, useState } from 'react';
import type { DeckOptions } from '@sg/shared';
import { dismissOffer, readDismissedOffer } from '../../../lib/sessions.ts';
import { DeckPicker } from '../../slides/DeckPicker.tsx';
import type { DeckChoice } from '../../slides/use-deck-choice.ts';

const button =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised aria-disabled:opacity-50';
const quiet =
  'inline-flex min-h-11 items-center justify-center rounded-md px-3 py-2 text-md text-text-muted underline underline-offset-4 hover:bg-surface-raised hover:text-text aria-disabled:opacity-50';

/** Nach dem Schließen der Liste (Wahl oder Esc) geht der Fokus zurück auf den Knopf, der sie geöffnet hat */
function useReturnFocus(open: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !open) ref.current?.focus();
    was.current = open;
  }, [open]);
  return ref;
}

export interface NoDeckPanelProps {
  sessionId: string;
  /** Die Session hatte einen Satz, der inzwischen gelöscht ist */
  deleted: boolean;
  /** Die Session läuft oder ist pausiert */
  active: boolean;
  /** `session.started_at` in ms; entscheidet zwischen „Neue Folien aus Moodle“ und „Vorschlag“ */
  startedAt: number | null;
  options: DeckOptions | undefined;
  choice: DeckChoice;
}

export function NoDeckPanel({ sessionId, deleted, active, startedAt, options, choice }: NoDeckPanelProps) {
  const [picking, setPicking] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const toggle = useReturnFocus(picking);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setDismissed(readDismissedOffer(sessionId)), [sessionId]);

  // Nach einem Folienwechsel (auch eines gelöschten Satzes) gibt es nur noch den Satz (§22.7)
  const locked = options?.lock != null;
  const editable = active && !locked;
  const suggestion = options?.items.find((item) => item.deck.id === options.suggested_deck_id) ?? null;
  const offer = editable && suggestion && dismissed !== suggestion.deck.id ? suggestion : null;
  const fresh =
    offer !== null &&
    offer.source === 'moodle' &&
    startedAt !== null &&
    Date.parse(offer.available_at) > startedAt;

  return (
    <div
      data-testid="slides-panel"
      className="flex h-full min-h-0 flex-col items-center justify-center gap-3 overflow-y-auto p-6 text-center"
    >
      <p role="status" className="text-md text-text-muted">
        {deleted
          ? 'Die Folien dieser Vorlesung sind gelöscht.'
          : 'Folien kommen später – einfach mitschreiben'}
      </p>

      {offer ? (
        <div data-testid="deck-offer" className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <p role="status" className="text-md">
            {fresh ? 'Neue Folien aus Moodle: ' : 'Vorschlag: '}
            <span className="font-medium">{offer.deck.title}</span>
          </p>
          <button
            type="button"
            className={button}
            aria-disabled={choice.busy}
            onClick={() => void choice.choose(offer.deck.id)}
          >
            Übernehmen
          </button>
          <button
            type="button"
            className={quiet}
            onClick={() => {
              dismissOffer(sessionId, offer.deck.id);
              setDismissed(offer.deck.id);
              toggle.current?.focus();
            }}
          >
            Nicht jetzt
          </button>
        </div>
      ) : null}

      {editable ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            ref={toggle}
            type="button"
            className={button}
            aria-expanded={picking}
            onClick={() => {
              choice.clearMessage();
              setPicking(!picking);
            }}
          >
            Folien wählen
          </button>
          {choice.upload ? (
            <>
              <button type="button" className={button} onClick={() => file.current?.click()}>
                PDF hochladen
              </button>
              <input
                ref={file}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                hidden
                aria-label="PDF-Dateien auswählen"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (files.length > 0) choice.upload?.(files);
                }}
              />
            </>
          ) : null}
        </div>
      ) : null}

      {editable && picking && options ? (
        <div className="w-full max-w-md text-left">
          <DeckPicker
            options={options}
            selectedId={null}
            allowNone={false}
            busy={choice.busy}
            onChoose={(id) => {
              void choice.choose(id).then((done) => done && setPicking(false));
            }}
            onClose={() => setPicking(false)}
          />
        </div>
      ) : null}

      {choice.message ? (
        <p role="status" className="text-sm text-text-muted">
          {choice.message}
        </p>
      ) : null}
    </div>
  );
}

export interface DeckStripProps {
  options: DeckOptions | undefined;
  /** Es gab schon einen Folienwechsel (Core `lock` oder ein bekannter `slide_event`): Wechseln und Leeren entfallen */
  locked: boolean;
  /** Die Session läuft oder ist pausiert */
  active: boolean;
  choice: DeckChoice;
}

/** Leiste unter den Folien: „Anderen Foliensatz wählen“ und „Ohne Folien“, solange noch nicht geblättert wurde */
export function DeckStrip({ options, locked, active, choice }: DeckStripProps) {
  const [picking, setPicking] = useState(false);
  const toggle = useReturnFocus(picking);
  const editable = active && !locked && options !== undefined && options.lock === null;
  if (!editable && !choice.message) return null;

  return (
    <div data-testid="deck-strip" className="shrink-0 px-2 pb-1">
      {editable && options ? (
        <div className="flex flex-wrap items-center justify-center gap-x-1">
          <button
            ref={toggle}
            type="button"
            className={quiet}
            aria-expanded={picking}
            onClick={() => {
              choice.clearMessage();
              setPicking(!picking);
            }}
          >
            Anderen Foliensatz wählen
          </button>
          <button
            type="button"
            className={quiet}
            aria-disabled={choice.busy}
            onClick={() => void choice.choose(null)}
          >
            Ohne Folien
          </button>
        </div>
      ) : null}
      {editable && picking && options ? (
        <div className="mx-auto max-h-64 max-w-md overflow-y-auto">
          <DeckPicker
            options={options}
            selectedId={options.current_deck_id}
            allowNone={false}
            busy={choice.busy}
            onChoose={(id) => {
              void choice.choose(id).then((done) => done && setPicking(false));
            }}
            onClose={() => setPicking(false)}
          />
        </div>
      ) : null}
      {choice.message ? (
        <p role="status" className="mt-1 text-center text-sm text-text-muted">
          {choice.message}
        </p>
      ) : null}
    </div>
  );
}
