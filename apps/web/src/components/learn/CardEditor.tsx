'use client';

// Karte von Hand anlegen (VERTRAEGE §21.4 `POST /cards`, §21.10, Ticket B5): inline, kein Dialog (R1).
// Typ (Frage oder Lückentext), Vorderseite, Antwort, Beleg (Pflicht, 1 bis 6) und beim Lückentext eine Vorschau.
// Zwei Einstiege: die Konzeptansicht (Belege des Konzepts) und „Karte daraus“ im Rückblick (Satz und seine Quellen).
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Card, CardContent, EvidenceRef } from '@sg/shared';
import {
  CARDS_KEY,
  CARD_LIMITS,
  REVIEW_KEY,
  cardErrorMessage,
  clozeParts,
  contentFromDraft,
  createCard,
  fetchCard,
  type CardDraft,
} from '../../lib/cards.ts';
import { ApiRequestError } from '../../lib/api.ts';
import { evidenceChip, evidenceSpoken } from '../../lib/concepts.ts';
import { useToast } from '../../lib/toast.tsx';
import { uuidv7 } from '../../lib/uuid.ts';

const field =
  'mt-1 block w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-md focus-visible:outline-2';
const button =
  'min-h-9 rounded-md border border-border px-3 py-1 text-sm hover:bg-surface aria-disabled:opacity-50 sg-transition';

/** Höchstens so viele Belege je Karte (Schema) */
export const MAX_CARD_SOURCES = 6;

export interface EditorSource {
  ref: EvidenceRef;
  /** Zusatz neben dem Chip, etwa der Titel der Folie */
  hint?: string | null;
}

export interface EditorConcept {
  id: string;
  name: string;
}

export interface CardEditorProps {
  /** Aktive Konzepte zur Auswahl; bei einem einzigen steht es fest da */
  concepts: readonly EditorConcept[];
  /** Mögliche Belege (mindestens einer) */
  sources: readonly EditorSource[];
  /** Welche Belege vorgewählt sind: der erste (Konzeptansicht) oder alle (Satz aus der Kurzfassung) */
  preselect?: 'first' | 'all';
  /** „Karte daraus“: Der Satz ist die Antwort bzw. der Lückentext */
  seedText?: string;
  /** Nach dem Anlegen (Karte) oder beim Abbrechen (`null`) */
  onDone: (card: Card | null) => void;
}

/** Gleiche Beleg-Form zweimal? (Dubletten lehnt der Core ab) */
const sameRef = (a: EvidenceRef, b: EvidenceRef) => JSON.stringify(a) === JSON.stringify(b);

export function uniqueSources(sources: readonly EditorSource[]): EditorSource[] {
  const out: EditorSource[] = [];
  for (const source of sources) if (!out.some((o) => sameRef(o.ref, source.ref))) out.push(source);
  return out;
}

const PLACEHOLDER: CardContent = {
  kind: 'basic',
  front: { text_md: '-' },
  back: { text_md: '-', explanation_md: null },
};

export function CardEditor({ concepts, sources, preselect = 'first', seedText, onDone }: CardEditorProps) {
  const base = useId();
  const client = useQueryClient();
  const toast = useToast();
  const choices = uniqueSources(sources);
  const [kind, setKind] = useState<CardDraft['kind']>('basic');
  const [front, setFront] = useState('');
  const [back, setBack] = useState(seedText ?? '');
  const [explanation, setExplanation] = useState('');
  const [conceptId, setConceptId] = useState(concepts[0]?.id ?? '');
  const [picked, setPicked] = useState<boolean[]>(() =>
    choices.map((_, i) => (preselect === 'all' ? i < MAX_CARD_SOURCES : i === 0)),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Eine `id` je Editor: Ein erneutes Senden nach abgerissener Antwort legt keine zweite Karte an
  const cardId = useRef(uuidv7());
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => first.current?.focus(), []);

  const chosen = choices.filter((_, i) => picked[i]);

  function chooseKind(next: CardDraft['kind']) {
    setKind(next);
    setProblem(null);
    // Aus einem Satz wird ein Lückentext, wenn noch nichts getippt ist
    if (next === 'cloze' && front === '' && seedText) setFront(seedText);
  }

  function toggle(index: number) {
    setProblem(null);
    setPicked((current) => {
      const next = [...current];
      if (!next[index] && next.filter(Boolean).length >= MAX_CARD_SOURCES) return current;
      next[index] = !next[index];
      return next;
    });
  }

  async function save() {
    if (busy) return;
    const result = contentFromDraft({ kind, front, back, explanation }, PLACEHOLDER);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    if (chosen.length === 0) {
      setProblem('Wähle mindestens einen Beleg. Jede Karte braucht eine Quelle.');
      return;
    }
    if (conceptId === '') {
      setProblem('Wähle ein Konzept.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      let card: Card;
      try {
        card = await createCard({
          id: cardId.current,
          concept_id: conceptId,
          content: result.content,
          sources: chosen.map((source) => source.ref),
        });
      } catch (error) {
        // Die Antwort ging verloren, die Karte steht aber schon: dann ist sie unsere
        if (error instanceof ApiRequestError && error.code === 'card_exists') {
          card = await fetchCard(cardId.current);
        } else {
          throw error;
        }
      }
      void client.invalidateQueries({ queryKey: CARDS_KEY });
      void client.invalidateQueries({ queryKey: REVIEW_KEY });
      toast.show({ message: 'Karte angelegt' });
      onDone(card);
    } catch (error) {
      setProblem(cardErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDone(null);
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  }

  const preview = kind === 'cloze' ? clozeParts(front) : [];
  const gaps = preview.filter((part) => part.gap !== null);

  return (
    <div
      role="group"
      aria-label="Karte anlegen"
      data-testid="card-editor"
      onKeyDown={onKeyDown}
      className="w-full space-y-3 rounded-lg border border-border bg-surface px-4 py-3"
    >
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">Art der Karte</legend>
        {(
          [
            ['basic', 'Frage und Antwort'],
            ['cloze', 'Lückentext'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex min-h-9 items-center gap-2 text-md">
            <input
              type="radio"
              name={`${base}-kind`}
              checked={kind === value}
              onChange={() => chooseKind(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {concepts.length > 1 ? (
        <div>
          <label htmlFor={`${base}-concept`} className="text-sm text-text-muted">
            Konzept
          </label>
          <select
            id={`${base}-concept`}
            value={conceptId}
            onChange={(e) => setConceptId(e.target.value)}
            className={field}
          >
            {concepts.map((concept) => (
              <option key={concept.id} value={concept.id}>
                {concept.name}
              </option>
            ))}
          </select>
        </div>
      ) : concepts[0] ? (
        <p className="text-sm text-text-muted">
          Konzept: <span className="text-text">{concepts[0].name}</span>
        </p>
      ) : null}

      <div>
        <label htmlFor={`${base}-front`} className="text-sm text-text-muted">
          {kind === 'cloze' ? 'Lückentext' : 'Vorderseite'}
        </label>
        <textarea
          id={`${base}-front`}
          ref={first}
          rows={3}
          maxLength={CARD_LIMITS.front}
          value={front}
          onChange={(e) => {
            setFront(e.target.value);
            setProblem(null);
          }}
          aria-describedby={kind === 'cloze' ? `${base}-cloze-hint` : undefined}
          className={field}
        />
        {kind === 'cloze' ? (
          <p id={`${base}-cloze-hint`} className="mt-1 text-xs text-text-muted">
            Lücken schreibst du so: {'{{c1::Begriff}}'}. Weitere Lücken heißen c2 und c3.
          </p>
        ) : null}
      </div>

      {kind === 'basic' ? (
        <>
          <div>
            <label htmlFor={`${base}-back`} className="text-sm text-text-muted">
              Antwort
            </label>
            <textarea
              id={`${base}-back`}
              rows={3}
              maxLength={CARD_LIMITS.back}
              value={back}
              onChange={(e) => {
                setBack(e.target.value);
                setProblem(null);
              }}
              className={field}
            />
          </div>
          <div>
            <label htmlFor={`${base}-explanation`} className="text-sm text-text-muted">
              Erklärung (optional)
            </label>
            <textarea
              id={`${base}-explanation`}
              rows={2}
              maxLength={CARD_LIMITS.explanation}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              className={field}
            />
          </div>
        </>
      ) : (
        <div data-testid="cloze-preview" className="rounded-md border border-dashed border-border px-3 py-2">
          <p className="text-xs text-text-muted">Vorschau</p>
          {gaps.length === 0 ? (
            <p className="mt-1 text-sm text-text-muted">Noch keine Lücke.</p>
          ) : (
            <>
              <p className="mt-1 whitespace-pre-line break-words text-md">
                {preview.map((part, i) => (part.gap === null ? part.text : <span key={i}>[…]</span>))}
              </p>
              <p className="mt-1 whitespace-pre-line break-words text-md">
                <span className="sr-only">Aufgedeckt: </span>
                {preview.map((part, i) =>
                  part.gap === null ? (
                    part.text
                  ) : (
                    <strong key={i} className="font-semibold">
                      {part.text}
                    </strong>
                  ),
                )}
              </p>
            </>
          )}
        </div>
      )}

      <fieldset>
        <legend className="text-sm text-text-muted">
          Beleg (mindestens einer, höchstens {MAX_CARD_SOURCES})
        </legend>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {choices.map((source, i) => {
            const on = picked[i] === true;
            const full = !on && chosen.length >= MAX_CARD_SOURCES;
            return (
              <li key={i}>
                <label className="flex min-h-9 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={full}
                    onChange={() => toggle(i)}
                    aria-label={evidenceSpoken(source.ref)}
                  />
                  <span aria-hidden="true" className="tabular-nums">
                    {source.ref.kind === 'transcript' ? '▶ ' : ''}
                    {evidenceChip(source.ref)}
                  </span>
                  {source.hint ? <span className="text-text-muted">{source.hint}</span> : null}
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {problem ? (
        <p role="alert" className="text-sm text-text-muted">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} aria-disabled={busy} onClick={() => void save()}>
          Karte anlegen
        </button>
        <button type="button" className={button} onClick={() => onDone(null)}>
          Abbrechen
        </button>
        <span className="text-xs text-text-muted">Strg+Enter legt an, Esc bricht ab.</span>
      </div>
    </div>
  );
}
