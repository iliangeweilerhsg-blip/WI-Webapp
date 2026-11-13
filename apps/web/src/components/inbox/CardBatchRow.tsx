'use client';

// Zeile für einen Kartenvorschlag (`card_batch`, VERTRAEGE §21.7, §21.10): „n Karten zu *Konzept*“, aufklappbar mit je
// Karte Vorderseite, Rückseite, Quellen-Chips und Häkchen (Standard an). → übernimmt die angehakten, ← verwirft alle,
// E bearbeitet die markierte Karte inline (der Entwurf geht beim Annehmen mit). Keine Dialoge.
import Link from 'next/link';
import { useRef, useState, type KeyboardEvent } from 'react';
import type { CardContent, CardProposal, InboxAcceptRequest, InboxCardChoice } from '@sg/shared';
import { cardFrontText, cardsCount, useEffectiveConcept } from '../../lib/cards.ts';
import { conceptHref, sessionRefLabel } from '../../lib/concepts.ts';
import { INBOX_KIND_LABELS, INBOX_KIND_SYMBOLS, type CardBatchItem } from '../../lib/inbox.ts';
import { SourceChips } from '../concepts/SourceChips.tsx';
import { CardBack, CardFront } from '../learn/CardFace.tsx';
import { CardEditFields } from '../learn/CardEditFields.tsx';

const button =
  'min-h-9 rounded-md border border-border px-3 py-1 text-sm hover:bg-surface aria-disabled:opacity-50 sg-transition';

export interface CardBatchRowProps {
  item: CardBatchItem;
  busy: boolean;
  showSession?: boolean;
  /** `request` mit `cards` (nur Abweichungen); alle verworfen geht über `onReject` */
  onAccept: (item: CardBatchItem, request: InboxAcceptRequest) => void;
  onReject: (item: CardBatchItem) => void;
  onMove: (item: CardBatchItem, delta: -1 | 1) => void;
}

/** Ziel, auf dem die Pfeiltasten und `E` der Zeile gelten (Häkchen zählen nicht als Texteingabe) */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement && target.type === 'checkbox') return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** `cards` der Annahme: nur verworfene und bearbeitete Karten, alle anderen werden unverändert angenommen (§21.7) */
export function acceptRequest(
  cards: readonly CardProposal[],
  checked: ReadonlySet<string>,
  edits: Readonly<Record<string, CardContent>>,
): InboxAcceptRequest {
  const choices: InboxCardChoice[] = [];
  for (const card of cards) {
    if (!checked.has(card.key)) choices.push({ key: card.key, accept: false });
    else if (edits[card.key]) choices.push({ key: card.key, accept: true, content: edits[card.key] });
  }
  return choices.length > 0 ? { cards: choices } : {};
}

export function CardBatchRow({
  item,
  busy,
  showSession = false,
  onAccept,
  onReject,
  onMove,
}: CardBatchRowProps) {
  const payload = item.payload;
  const concept = useEffectiveConcept(payload.concept_id, payload.concept_name);
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(payload.cards.map((c) => c.key)));
  const [edits, setEdits] = useState<Readonly<Record<string, CardContent>>>({});
  const [marked, setMarked] = useState<string>(payload.cards[0]?.key ?? '');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);

  /** Nach dem Bearbeiten steht der Fokus wieder auf der Zeile, damit → ← E gleich weiter gelten */
  function stopEditing() {
    setEditingKey(null);
    rowRef.current?.focus();
  }

  const heading = `${cardsCount(payload.cards.length)} zu ${concept.name}`;
  const acceptedCount = payload.cards.filter((c) => checked.has(c.key)).length;

  function accept() {
    if (busy || acceptedCount === 0) return;
    onAccept(item, acceptRequest(payload.cards, checked, edits));
  }

  function toggle(key: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTyping(event.target) || editingKey !== null) return;
    const key = event.key;
    if (key === 'ArrowRight') {
      event.preventDefault();
      accept();
    } else if (key === 'ArrowLeft') {
      event.preventDefault();
      if (!busy) onReject(item);
    } else if (key === 'e' || key === 'E') {
      event.preventDefault();
      if (marked !== '') {
        setOpen(true);
        setEditingKey(marked);
      }
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      onMove(item, key === 'ArrowDown' ? 1 : -1);
    }
  }

  return (
    <li
      ref={rowRef}
      tabIndex={0}
      data-inbox-item={item.id}
      data-kind={item.kind}
      aria-label={`${INBOX_KIND_LABELS[item.kind]}: ${heading}`}
      aria-keyshortcuts="ArrowRight ArrowLeft E"
      onKeyDown={onKeyDown}
      className="relative flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-md px-2 py-3"
    >
      <div className="min-w-0 flex-1 basis-72">
        <p className="break-words">
          <span aria-hidden="true" className="mr-2 inline-block w-4 text-center text-text-muted">
            {INBOX_KIND_SYMBOLS[item.kind]}
          </span>
          <span>{cardsCount(payload.cards.length)} zu </span>
          <Link href={conceptHref(concept.id)} className="font-medium underline-offset-2 hover:underline">
            {concept.name}
          </Link>
          <span aria-hidden="true" title="Vorschlag der KI" className="ml-2 text-text-muted">
            ✦
          </span>
          <span className="sr-only"> (Vorschlag der KI)</span>
          {concept.examRelevant ? (
            <span className="ml-2 rounded-sm border border-border px-1 text-xs text-text-muted">Klausur</span>
          ) : null}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-text-muted">
          <button
            type="button"
            aria-expanded={open}
            className="underline-offset-2 hover:text-text hover:underline"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Karten ausblenden' : 'Karten ansehen'}
          </button>
          {acceptedCount < payload.cards.length ? (
            <span data-testid="batch-count">
              {acceptedCount} von {payload.cards.length} angehakt
            </span>
          ) : null}
          {showSession ? <span className="text-xs">{sessionRefLabel(item.session)}</span> : null}
        </p>
        {open ? (
          <ul aria-label={`Karten zu ${concept.name}`} className="mt-3 space-y-3">
            {payload.cards.map((card) => {
              const content = edits[card.key] ?? card.content;
              const isMarked = marked === card.key;
              return (
                <li
                  key={card.key}
                  data-card-key={card.key}
                  aria-current={isMarked ? 'true' : undefined}
                  onFocus={() => setMarked(card.key)}
                  onClick={() => setMarked(card.key)}
                  className={`rounded-md border px-3 py-2 ${isMarked ? 'border-border-strong' : 'border-border'} ${checked.has(card.key) ? '' : 'opacity-60'}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked.has(card.key)}
                      onChange={() => toggle(card.key)}
                      aria-label={`Karte annehmen: ${cardFrontText(content)}`}
                      className="mt-1.5 size-4 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      {editingKey === card.key ? (
                        <CardEditFields
                          content={content}
                          saveLabel="Übernehmen"
                          onCancel={stopEditing}
                          onSave={(next) => {
                            setEdits((current) => ({ ...current, [card.key]: next }));
                            stopEditing();
                          }}
                        />
                      ) : (
                        <>
                          <div>
                            <CardFront content={content} compact />
                          </div>
                          <div className="mt-2 border-t border-border pt-2 text-text-muted">
                            <CardBack content={content} compact />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <SourceChips sources={card.sources} label={`Quellen zur Karte ${card.key}`} />
                            <button
                              type="button"
                              className={button}
                              aria-label={`Karte bearbeiten: ${cardFrontText(content)}`}
                              onClick={() => {
                                setMarked(card.key);
                                setEditingKey(card.key);
                              }}
                            >
                              Bearbeiten
                            </button>
                          </div>
                          {edits[card.key] ? (
                            <p className="mt-1 text-xs text-text-muted">Geändert, wird so angenommen.</p>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Entscheidung für ${heading}`}>
        <button type="button" className={button} aria-disabled={busy || acceptedCount === 0} onClick={accept}>
          {acceptedCount < payload.cards.length ? `${acceptedCount} annehmen` : 'Annehmen'}
        </button>
        <button
          type="button"
          className={button}
          aria-disabled={busy}
          onClick={() => {
            if (!busy) onReject(item);
          }}
        >
          Verwerfen
        </button>
      </div>
    </li>
  );
}
