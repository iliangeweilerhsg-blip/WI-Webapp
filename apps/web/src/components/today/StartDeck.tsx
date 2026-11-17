'use client';

// Folien auf der Start-Karte (VERTRAEGE §22.7): eine Zeile „Folien: ‹Titel›“ mit „Ändern“ (aufklappende Liste, kein
// Dialog). Der Vorschlag kommt aus `GET /modules/{id}/deck-options`; der Start schickt ihn als `slide_deck_id` mit.
// Der Start wartet nie auf diese Abfrage: Sind die Optionen noch nicht da oder gescheitert, startet der Tipp ohne Satz.
import { useEffect, useRef, useState } from 'react';
import type { DeckOption, Session } from '@sg/shared';
import { useDeckOptions } from '../../lib/material.ts';
import { readNoDeck, rememberNoDeck } from '../../lib/sessions.ts';
import { DeckPicker } from '../slides/DeckPicker.tsx';
import { useDeckChoice } from '../slides/use-deck-choice.ts';

export interface StartDeck {
  /** Satz, der beim Start mitgeschickt wird; `undefined` = ohne das Feld starten */
  startDeckId: string | undefined;
  /** Der Satz, der in der Zeile steht (gewählt oder vorgeschlagen); `null` = „Ohne Folien“ */
  shown: DeckOption | null;
  /** Die Optionen sind da: erst dann gibt es die Zeile */
  ready: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  choice: ReturnType<typeof useDeckChoice>;
  /** PDF-Upload für diese Session; ab dem Anstoßen schickt der Start den Vorschlag nicht mehr mit */
  upload: ((files: File[]) => void) | undefined;
  options: ReturnType<typeof useDeckOptions>['data'];
  onChoose: (deckId: string | null) => Promise<void>;
}

/** Zustand der Folien-Zeile einer startbaren Session. `enabled`: nur Karten mit Start-Knopf fragen ab. */
export function useStartDeck(
  session: Session | undefined,
  enabled: boolean,
  onSession: (session: Session) => void,
): StartDeck {
  const query = useDeckOptions(session?.module_id ?? '', session?.id ?? null, {
    enabled: enabled && session !== undefined,
  });
  const choice = useDeckChoice(session, onSession);
  const [noDeck, setNoDeck] = useState(false);
  const [open, setOpen] = useState(false);
  // Ein Upload für diese Session läuft oder lief: Er hängt den Satz selbst an, der Start schickt nichts mit
  const [uploading, setUploading] = useState(false);
  const sessionId = session?.id;
  useEffect(() => {
    setNoDeck(sessionId ? readNoDeck(sessionId) : false);
    setOpen(false);
    setUploading(false);
  }, [sessionId]);

  const options = query.data;
  // Maßgeblich ist der Zeiger der Session (aktueller als die Momentaufnahme); sagen die Optionen, es gebe schon einen
  // Satz (anderer Weg, Upload), gilt auch das. Ein Vorschlag nur, wenn beide „kein Satz“ sagen.
  const currentId = session?.slide_deck_id ?? options?.current_deck_id ?? null;
  // … und nur ohne ausdrückliches „Ohne Folien“
  const suggestedId = currentId === null && !noDeck ? (options?.suggested_deck_id ?? null) : null;
  const shownId = currentId ?? suggestedId;
  const shown = options?.items.find((item) => item.deck.id === shownId) ?? null;

  async function onChoose(deckId: string | null) {
    if (!session) return;
    // „Ohne Folien“ leert nur, wenn es etwas zu leeren gibt; der Merker gilt in jedem Fall
    const done = deckId === null && currentId === null ? true : await choice.choose(deckId);
    if (!done) return;
    rememberNoDeck(session.id, deckId === null);
    setNoDeck(deckId === null);
    setOpen(false);
  }

  return {
    // Hat die Session schon einen Satz, bleibt er stehen: kein Feld im Start. Auch nicht mitten in einer Wahl oder in
    // einem Upload: Ein Start mit Satz überschreibt im Core ohne Prüfung (§22.4).
    startDeckId: choice.busy || uploading ? undefined : (suggestedId ?? undefined),
    shown,
    ready: options !== undefined,
    open,
    setOpen,
    choice,
    upload: choice.upload
      ? (files: File[]) => {
          setUploading(true);
          choice.upload?.(files);
        }
      : undefined,
    options,
    onChoose,
  };
}

const changeButton =
  'inline-flex min-h-11 items-center rounded-md px-3 text-md text-text-muted underline underline-offset-4 hover:bg-surface-raised hover:text-text aria-disabled:opacity-50';

/** Die Zeile unter dem Titel der Start-Karte; ohne geladene Optionen steht nichts da. */
export function StartDeckRow({ deck, sessionId }: { deck: StartDeck; sessionId: string }) {
  const toggle = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const { open, setOpen, options, shown, choice, upload } = deck;
  // Beim Schließen (Wahl oder Esc) geht der Fokus zurück auf „Ändern“
  useEffect(() => {
    if (wasOpen.current && !open) toggle.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!deck.ready || !options) return null;
  const listId = `start-deck-${sessionId}`;
  const selectedId = shown?.deck.id ?? null;

  return (
    <div data-testid="start-deck" className="mt-2">
      <div className="flex flex-wrap items-center gap-x-1">
        <p className="text-md">
          {shown ? (
            <>
              Folien: <span className="font-medium">{shown.deck.title}</span>
              {shown.source === 'moodle' ? <span className="text-text-muted"> aus Moodle</span> : null}
            </>
          ) : (
            'Ohne Folien'
          )}
        </p>
        <button
          ref={toggle}
          type="button"
          className={changeButton}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => {
            choice.clearMessage();
            setOpen(!open);
          }}
        >
          Ändern
        </button>
      </div>
      {open ? (
        <div id={listId}>
          <DeckPicker
            options={options}
            selectedId={selectedId}
            allowNone
            busy={choice.busy}
            {...(upload
              ? {
                  onUpload: (files: File[]) => {
                    upload(files);
                    setOpen(false);
                  },
                }
              : {})}
            onChoose={(id) => void deck.onChoose(id)}
            onClose={() => setOpen(false)}
          />
        </div>
      ) : null}
      {choice.message ? (
        <p role="status" className="mt-1 text-sm text-text-muted">
          {choice.message}
        </p>
      ) : null}
    </div>
  );
}
