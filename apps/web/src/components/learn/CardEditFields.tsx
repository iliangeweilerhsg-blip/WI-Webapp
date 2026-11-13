'use client';

// Karte inline bearbeiten (VERTRAEGE §21.10, kein Dialog): Vorderseite, Antwort, Erklärung bzw. der Lückentext.
// Gespeichert wird vom Aufrufer (PATCH in der Konzeptansicht und im Lernen, Entwurf in der Inbox).
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { CardContent } from '@sg/shared';
import { CARD_LIMITS, contentFromDraft, draftFromContent, type CardDraft } from '../../lib/cards.ts';

const field =
  'mt-1 block w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-md focus-visible:outline-2';
const button =
  'min-h-9 rounded-md border border-border px-3 py-1 text-sm hover:bg-surface aria-disabled:opacity-50 sg-transition';

export interface CardEditFieldsProps {
  content: CardContent;
  /** Beschriftung des Speichern-Knopfs */
  saveLabel?: string;
  busy?: boolean;
  /** Fehlertext vom Core (etwa `card_invalid`) */
  error?: string | null;
  onSave: (content: CardContent) => void;
  onCancel: () => void;
}

export function CardEditFields({
  content,
  saveLabel = 'Speichern',
  busy = false,
  error = null,
  onSave,
  onCancel,
}: CardEditFieldsProps) {
  const base = useId();
  const [draft, setDraft] = useState<CardDraft>(() => draftFromContent(content));
  const [problem, setProblem] = useState<string | null>(null);
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => first.current?.focus(), []);

  const set = (patch: Partial<CardDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setProblem(null);
  };

  function save() {
    if (busy) return;
    const result = contentFromDraft(draft, content);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    onSave(result.content);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  }

  const shown = problem ?? error;
  return (
    <div role="group" aria-label="Karte bearbeiten" onKeyDown={onKeyDown} className="w-full space-y-3">
      <div>
        <label htmlFor={`${base}-front`} className="text-sm text-text-muted">
          {draft.kind === 'cloze' ? 'Lückentext' : 'Vorderseite'}
        </label>
        <textarea
          id={`${base}-front`}
          ref={first}
          rows={3}
          maxLength={CARD_LIMITS.front}
          value={draft.front}
          onChange={(e) => set({ front: e.target.value })}
          className={field}
        />
        {draft.kind === 'cloze' ? (
          <p className="mt-1 text-xs text-text-muted">Lücken schreibst du so: {'{{c1::Begriff}}'}</p>
        ) : null}
      </div>
      {draft.kind === 'basic' ? (
        <>
          <div>
            <label htmlFor={`${base}-back`} className="text-sm text-text-muted">
              Antwort
            </label>
            <textarea
              id={`${base}-back`}
              rows={3}
              maxLength={CARD_LIMITS.back}
              value={draft.back}
              onChange={(e) => set({ back: e.target.value })}
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
              value={draft.explanation}
              onChange={(e) => set({ explanation: e.target.value })}
              className={field}
            />
          </div>
        </>
      ) : null}
      {shown ? (
        <p role="alert" className="text-sm text-text-muted">
          {shown}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} aria-disabled={busy} onClick={save}>
          {saveLabel}
        </button>
        <button type="button" className={button} onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}
