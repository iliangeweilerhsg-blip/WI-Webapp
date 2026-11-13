'use client';

// Lernen `/lernen` (VERTRAEGE §21.10, F-LRN-02/-03 in schmaler Form): Heute wiederholen mit Zeitbudget. Frage →
// aufdecken → Bewertung 1 bis 4, alles mit der Tastatur. Kein Rückstand, kein Rot, keine Dialoge (LP9, R1, 07 §2).
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useReducer, useRef, useState } from 'react';
import type { ReviewRating } from '@sg/shared';
import {
  CARDS_KEY,
  EXTRA_STEP_MINUTES,
  INITIAL_BLOCK,
  REVIEW_KEY,
  type BlockState,
  blockReducer,
  blockSummary,
  cardFrontText,
  fetchReviewQueue,
  newRatingJob,
  nextExtraMinutes,
  queueMinutes,
  ratingOutbox,
  reviewQueueKey,
  useRatingOutbox,
  useReviewQueue,
} from '../../lib/cards.ts';
import { conceptHref } from '../../lib/concepts.ts';
import { CoreHint } from '../CoreHint.tsx';
import { EmptyState } from '../Placeholder.tsx';
import { CardBack, CardFront } from './CardFace.tsx';
import { CardEditFields } from './CardEditFields.tsx';
import { CardMenu } from './CardMenu.tsx';
import { CardSourceChips } from './CardSourceChips.tsx';
import { useCardActions } from './use-card-actions.ts';

const button =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised aria-disabled:opacity-60 sg-transition';
const mark = 'rounded-sm border border-border px-1.5 py-0.5 text-xs text-text-muted';

const RATINGS: readonly { rating: ReviewRating; label: string }[] = [
  { rating: 1, label: 'Nochmal' },
  { rating: 2, label: 'Schwer' },
  { rating: 3, label: 'Gut' },
  { rating: 4, label: 'Leicht' },
];

/** Pro Bewertung zählen höchstens 2 min zur Dauer des Blocks (wie im Core, §21.5): Pausen verfälschen nichts */
const SPENT_CAP_MS = 120_000;

/** Ruhiger Hinweis, wenn Bewertungen nach mehreren Versuchen nicht beim Core angekommen sind */
function OutboxHint() {
  const outbox = useRatingOutbox();
  if (outbox.failed === 0) return null;
  return (
    <p
      role="status"
      data-testid="outbox-hint"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm"
    >
      <span>Einige Bewertungen sind noch nicht gespeichert. Der Core antwortet gerade nicht.</span>
      <button
        type="button"
        className="min-h-9 rounded-md border border-border px-3 py-1 text-sm hover:bg-surface-raised sg-transition"
        onClick={() => ratingOutbox.retryFailed()}
      >
        Erneut versuchen
      </button>
    </p>
  );
}

/** Ziele, auf denen Leertaste und Enter etwas anderes tun als aufdecken */
function isInteractive(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && target.closest('button, a, input, textarea, select, summary') !== null
  );
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export function LearnView() {
  const client = useQueryClient();
  // „Weitere 10 min“ gilt nur für den Lerntag, an dem sie gewählt wurden
  const [extraFor, setExtraFor] = useState<{ minutes: number; day: string | null }>({
    minutes: 0,
    day: null,
  });
  const extra = extraFor.minutes;
  const queue = useReviewQueue(extra);
  const [block, dispatch] = useReducer(blockReducer, INITIAL_BLOCK);
  const outbox = useRatingOutbox();
  const actions = useCardActions();
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  /** Stand, in dem zuletzt bewertet wurde: Ein zweiter Tastendruck vor dem Neuzeichnen bewertet nicht noch einmal */
  const lastRated = useRef<BlockState | null>(null);

  const current = block.phase === 'running' ? block.deck[block.index] : undefined;
  const data = queue.data;
  const settled = outbox.pending === 0;

  // Neuer Lerntag: die zusätzlichen Minuten von gestern zählen nicht mehr
  const day = data?.day ?? null;
  useEffect(() => {
    if (extraFor.minutes > 0 && day !== null && extraFor.day !== null && day !== extraFor.day) {
      setExtraFor({ minutes: 0, day });
    }
  }, [day, extraFor]);

  // Der Block ist durch, sobald nichts mehr dran ist und alle Bewertungen beim Core sind (eine Antwort mit
  // `requeue` hängt die Karte vorher noch hinten an)
  useEffect(() => {
    if (block.phase === 'running' && !current && outbox.pending === 0)
      dispatch({ type: 'end', early: false });
  }, [block.phase, current, outbox.pending]);

  // Am Ende des Blocks neu laden (§21.9), aber erst, wenn alle Bewertungen beim Core sind: Sonst stünden eben
  // bewertete Karten noch in der Warteschlange (etwa nach Esc direkt nach dem Bewerten)
  useEffect(() => {
    if (block.phase === 'finished' && settled) void client.invalidateQueries({ queryKey: REVIEW_KEY });
  }, [block.phase, settled, client]);
  // Ebenso in der Übersicht, wenn Bewertungen von vorhin erst jetzt angekommen sind
  const wasSettled = useRef(settled);
  useEffect(() => {
    if (block.phase === 'overview' && settled && !wasSettled.current) {
      void client.invalidateQueries({ queryKey: REVIEW_KEY });
    }
    wasSettled.current = settled;
  }, [block.phase, settled, client]);

  // Fokus auf die Karte, damit die Tasten sofort gelten; auf „Starten“, solange noch nichts läuft
  const currentId = current?.card.id ?? null;
  useEffect(() => {
    if (currentId !== null && !editing) panel.current?.focus();
  }, [currentId, editing]);
  const canStart = block.phase === 'overview' && (data?.items.length ?? 0) > 0;
  useEffect(() => {
    if (canStart) startButton.current?.focus();
  }, [canStart]);

  /** `false`: nichts zu tun */
  function start(queued = data?.items ?? []): boolean {
    // Karten, deren Bewertung noch nicht beim Core ist (etwa vom letzten Besuch der Seite), kommen nicht noch einmal
    // dran: Sonst würden sie zweimal bewertet
    const unsent = ratingOutbox.unsentCardIds();
    const items = unsent.size > 0 ? queued.filter((item) => !unsent.has(item.card.id)) : queued;
    if (items.length === 0) return false;
    setNote(null);
    setEditing(false);
    dispatch({ type: 'start', items, now: Date.now() });
    return true;
  }

  function rate(rating: ReviewRating) {
    const item = current;
    if (!item || !block.revealed || lastRated.current === block) return;
    lastRated.current = block;
    const now = Date.now();
    const duration = Math.max(0, now - block.shownAt);
    dispatch({ type: 'rate', durationMs: Math.min(duration, SPENT_CAP_MS), now });
    ratingOutbox.submit(newRatingJob(item.card.id, rating, duration), (result) => {
      if (result?.requeue) {
        // Kommt noch einmal dran: ans Ende des Blocks, auch wenn die neue Fälligkeit noch nicht erreicht ist
        dispatch({
          type: 'append',
          item: {
            card: result.card,
            concept: item.concept,
            group: 'angefangen',
            estimate_seconds: item.estimate_seconds,
          },
        });
      }
      void client.invalidateQueries({ queryKey: CARDS_KEY });
    });
  }

  function reveal() {
    if (current && !block.revealed) dispatch({ type: 'reveal' });
  }

  function end() {
    dispatch({ type: 'end', early: true });
  }

  /**
   * Neuer Block aus einer frisch geholten Warteschlange („Weiter“ nach Esc, „Weitere 10 min“), erst wenn alle
   * Bewertungen beim Core sind. `null`: Die 120 zusätzlichen Minuten sind ausgeschöpft.
   */
  async function continueWith(extraMinutes: number | null) {
    if (loadingMore || !settled) return;
    setLoadingMore(true);
    setNote(null);
    try {
      if (extraMinutes === null) {
        setNote('Gerade ist nichts weiter dran.');
        return;
      }
      const fetched = await client.fetchQuery({
        queryKey: reviewQueueKey(extraMinutes),
        queryFn: ({ signal }) => fetchReviewQueue(extraMinutes, signal),
        staleTime: 0,
      });
      if (!start(fetched.items)) {
        setNote('Gerade ist nichts weiter dran.');
        return;
      }
      if (extraMinutes !== extra) setExtraFor({ minutes: extraMinutes, day: fetched.day });
    } catch {
      setNote('Das hat nicht geklappt. Versuch es gleich noch einmal.');
    } finally {
      setLoadingMore(false);
    }
  }

  // Tasten (VERTRAEGE §21.10): Enter startet, Leertaste/Enter deckt auf, 1 bis 4 bewerten, Esc beendet
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (block.phase === 'overview') {
        if (event.key === 'Enter' && canStart && !isInteractive(target)) {
          event.preventDefault();
          start();
        }
        return;
      }
      if (block.phase !== 'running' || editing || !current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        end();
      } else if ((event.key === ' ' || event.key === 'Enter') && !block.revealed) {
        if (isInteractive(target)) return;
        event.preventDefault();
        reveal();
      } else if (block.revealed && ['1', '2', '3', '4'].includes(event.key)) {
        if (isTyping(target)) return;
        event.preventDefault();
        rate(Number(event.key) as ReviewRating);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // ---- Anzeige ----

  if (block.phase === 'running') {
    const total = block.deck.length;
    return (
      <section aria-labelledby="screen-title" className="mx-auto max-w-3xl">
        <h1 id="screen-title" className="sr-only">
          Lernen
        </h1>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p data-testid="learn-progress" className="text-sm tabular-nums text-text-muted">
            {current ? `Karte ${block.index + 1} von ${total}` : 'Speichert …'}
          </p>
          <button
            type="button"
            className="min-h-9 rounded-md border border-border px-3 py-1 text-sm hover:bg-surface sg-transition"
            aria-keyshortcuts="Escape"
            onClick={end}
          >
            Beenden
          </button>
        </div>
        <div className="mt-3">
          <OutboxHint />
        </div>
        {current ? (
          <div
            ref={panel}
            tabIndex={-1}
            role="group"
            aria-label={`Karte ${block.index + 1} von ${total}`}
            className="mt-3 rounded-xl border border-border bg-surface p-6 focus:outline-none"
            data-card-id={current.card.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                <Link href={conceptHref(current.concept.id)} className="underline-offset-2 hover:underline">
                  {current.concept.name}
                </Link>
                {current.concept.exam_relevant ? <span className={mark}>Klausur</span> : null}
              </p>
              <CardMenu
                suspended={current.card.suspended}
                label={cardFrontText(current.card.content)}
                busy={actions.busy}
                onEdit={() => {
                  setEditError(null);
                  setEditing(true);
                }}
                onToggleSuspended={() => {
                  void actions.setSuspended(current.card, true).then((saved) => {
                    if (saved) dispatch({ type: 'remove', cardId: saved.id, now: Date.now() });
                  });
                }}
                onDelete={() => {
                  void actions.remove(current.card).then((done) => {
                    if (done) dispatch({ type: 'remove', cardId: current.card.id, now: Date.now() });
                  });
                }}
              />
            </div>
            {editing ? (
              <div className="mt-4">
                <CardEditFields
                  content={current.card.content}
                  busy={actions.busy}
                  error={editError}
                  onCancel={() => {
                    setEditing(false);
                    panel.current?.focus();
                  }}
                  onSave={(content) => {
                    void actions.saveContent(current.card, content).then((result) => {
                      if (result.ok) {
                        dispatch({ type: 'replace', card: result.card });
                        setEditing(false);
                      } else setEditError(result.message);
                    });
                  }}
                />
              </div>
            ) : (
              <>
                <div className="mt-4">
                  <CardFront content={current.card.content} />
                </div>
                <div aria-live="polite">
                  {block.revealed ? (
                    <div className="mt-5 border-t border-border pt-5">
                      <CardBack content={current.card.content} />
                      <div className="mt-4">
                        <CardSourceChips sources={current.card.sources} label="Quellen dieser Karte" />
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : (
          <p role="status" className="mt-6 text-md text-text-muted">
            Speichert …
          </p>
        )}
        {current && !editing ? (
          block.revealed ? (
            <div role="group" aria-label="Bewertung" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {RATINGS.map(({ rating, label }) => (
                <button
                  key={rating}
                  type="button"
                  className={`${button} flex-col gap-0.5`}
                  aria-keyshortcuts={String(rating)}
                  onClick={() => rate(rating)}
                >
                  <span>{label}</span>
                  <span aria-hidden="true" className="text-xs text-text-muted">
                    {rating}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" className={button} aria-keyshortcuts="Space Enter" onClick={reveal}>
                Aufdecken
              </button>
              <span className="text-xs text-text-muted">Leertaste</span>
            </div>
          )
        ) : null}
      </section>
    );
  }

  if (block.phase === 'finished') {
    return (
      <section aria-labelledby="screen-title" className="mx-auto max-w-3xl">
        <h1 id="screen-title" className="text-xxl font-semibold">
          Lernen
        </h1>
        <div className="mt-6 space-y-4">
          <OutboxHint />
          <p role="status" data-testid="learn-done" className="text-xl">
            {blockSummary(block)}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {block.endedEarly && data && data.items.length > 0 && !queue.isFetching && settled ? (
              <button
                type="button"
                className={button}
                aria-disabled={loadingMore}
                onClick={() => void continueWith(extra)}
              >
                Weiter
              </button>
            ) : null}
            {data?.more_due && !queue.isFetching && settled ? (
              <button
                type="button"
                className={button}
                aria-disabled={loadingMore}
                onClick={() => void continueWith(nextExtraMinutes(data, extra))}
              >
                Weitere {EXTRA_STEP_MINUTES} min
              </button>
            ) : null}
            <Link
              href="/"
              className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
            >
              Zu Heute
            </Link>
          </div>
          {note ? (
            <p role="status" className="text-sm text-text-muted">
              {note}
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  // Übersicht
  let body;
  if (queue.isError && !data) body = <CoreHint error={queue.error} />;
  else if (!data) {
    body = (
      <p role="status" aria-busy="true" className="text-md text-text-muted">
        Lädt …
      </p>
    );
  } else if (!data.has_cards) {
    body = (
      <EmptyState
        action={
          <Link href="/inbox" className={button}>
            Zur Inbox
          </Link>
        }
      >
        Noch keine Karten. Sie entstehen als Vorschlag nach einer Vorlesung oder von Hand in der
        Konzeptansicht.
      </EmptyState>
    );
  } else if (data.items.length === 0) {
    body = (
      <EmptyState
        action={
          data.more_due ? (
            <button
              type="button"
              className={button}
              aria-disabled={loadingMore}
              onClick={() => void continueWith(nextExtraMinutes(data, extra))}
            >
              Weitere {EXTRA_STEP_MINUTES} min
            </button>
          ) : undefined
        }
      >
        {data.reviewed_today > 0 ? 'Für heute geschafft.' : 'Heute ist nichts fällig.'}
      </EmptyState>
    );
  } else {
    body = (
      <div className="rounded-xl border border-border bg-surface p-6">
        <h2 data-testid="learn-headline" className="text-lg font-medium">
          Heute wiederholen · ≈ {queueMinutes(data)} min
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          Leertaste deckt auf, 1 bis 4 bewerten, Esc beendet. Was nicht dran war, bleibt für morgen.
        </p>
        <button
          ref={startButton}
          type="button"
          className={`${button} mt-5`}
          aria-keyshortcuts="Enter"
          onClick={() => start()}
        >
          Starten
        </button>
      </div>
    );
  }

  return (
    <section aria-labelledby="screen-title" className="mx-auto max-w-3xl">
      <h1 id="screen-title" className="text-xxl font-semibold">
        Lernen
      </h1>
      <div className="mt-6 space-y-4">
        <OutboxHint />
        {body}
        {note ? (
          <p role="status" className="text-sm text-text-muted">
            {note}
          </p>
        ) : null}
      </div>
    </section>
  );
}
