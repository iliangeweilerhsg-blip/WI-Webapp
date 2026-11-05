'use client';

// Folien-Spalte des Live-Dashboards (T1-05, F-DSH-02, 07 §3.3): zeigt die aktuelle Folie des Foliensatzes der Session
// mit einer Seitenleiste aus Vorschaubildern. Blättern mit `←` `→`, Leertaste und Klick; jeder Wechsel geht als
// Operation `slide.change` in den Strom der Session (VERTRAEGE §11.3), mit Sitzungszeit seit `started_at`.
// Fremde Wechsel (iPad, anderer Tab) kommen über denselben Strom und aktualisieren die Anzeige.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Slide } from '@sg/shared';
import { pageImageUrl, pageThumbUrl, useDeckDetail } from '../../../lib/material.ts';
import { sessionStreamId, sessionTimeMs, syncedNowMs } from '../../../lib/session-stream.ts';
import { isEditableTarget } from '../../../lib/shortcuts.ts';
import { SyncHandedOverError, type SyncClient } from '../../../lib/sync/client.ts';
import { uuidv7 } from '../../../lib/uuid.ts';
import { useSlidePosition } from './use-slide-position.ts';

export interface SlidesPanelProps {
  sessionId: string;
  moduleId: string;
  /** `session.slide_deck_id`; `null` = folienloser Modus */
  slideDeckId: string | null;
  /** Die Session läuft oder ist pausiert (sonst nur ansehen, nicht blättern) */
  active: boolean;
  /** `session.started_at` in ms; `slide.change` braucht `t_ms` = Ereigniszeit − `started_at`. `null` = nicht gestartet */
  startedAt: number | null;
  /** Sync-Client dieses Tabs; `null` vor dem ersten Effekt */
  client: SyncClient | null;
}

function Hint({ children }: { children: string }) {
  return (
    <div data-testid="slides-panel" className="flex h-full items-center justify-center p-6 text-center">
      <p role="status" className="text-md text-text-muted">
        {children}
      </p>
    </div>
  );
}

/** Ein Tastendruck, der die Folie wechseln soll: `-1` zurück, `1` vor, sonst `null`. */
export function slideStep(e: KeyboardEvent): -1 | 1 | null {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing) return null;
  if (e.repeat) return null;
  const target = e.target as HTMLElement | null;
  if (isEditableTarget(target)) return null;
  // Trennlinien und Reiter nutzen die Pfeiltasten selbst (VERTRAEGE §16.3)
  if (target?.closest?.('[role="separator"], [role="tab"]')) return null;
  if (e.key === 'ArrowLeft') return -1;
  if (e.key === 'ArrowRight') return 1;
  if (e.key === ' ') {
    // Auf Schaltflächen und Links löst die Leertaste deren eigene Aktion aus
    if (target?.closest?.('button, a, summary, [role="button"], [role="link"]')) return null;
    return 1;
  }
  return null;
}

export function SlidesPanel({ sessionId, slideDeckId, active, startedAt, client }: SlidesPanelProps) {
  const deck = useDeckDetail(slideDeckId ?? '', { enabled: slideDeckId !== null });
  const { position, setPosition, getPosition } = useSlidePosition(
    sessionId,
    slideDeckId !== null ? client : null,
  );
  const [sendHint, setSendHint] = useState(false);

  const slides = useMemo<Slide[]>(
    () => (deck.data?.slides ?? []).filter((s) => s.deleted_at === null).sort((a, b) => a.index - b.index),
    [deck.data],
  );
  const total = slides.length;
  const current = total === 0 ? 1 : Math.min(Math.max(position?.index ?? 1, 1), total);

  // Stand für den Tastatur-Handler, ohne ihn bei jedem Wechsel neu zu registrieren
  const live = useRef({ current, total, active, startedAt, client, slides });
  live.current = { current, total, active, startedAt, client, slides };

  const goTo = useCallback(
    (target: number) => {
      const { total: count, active: isActive, startedAt: start, client: sync, slides: list } = live.current;
      if (!isActive || count === 0) return;
      const now = Math.min(Math.max(getPosition()?.index ?? 1, 1), count);
      const next = Math.min(Math.max(target, 1), count);
      if (next === now) return;
      const eventAt = syncedNowMs(sync);
      const slide = list[next - 1];
      // Die Anzeige wechselt sofort; ohne `started_at` gibt es keine Sitzungszeit, dann wird nichts gesendet
      setPosition({ index: next, tMs: start === null ? 0 : sessionTimeMs(start, eventAt) });
      if (start === null || !sync || !slide) return;
      sync
        .send({
          stream: sessionStreamId(sessionId),
          kind: 'slide.change',
          data: {
            event_id: uuidv7(eventAt),
            session_id: sessionId,
            slide_id: slide.id,
            slide_index: next,
            t_ms: sessionTimeMs(start, eventAt),
            device: 'mac',
          },
        })
        .then(() => setSendHint(false))
        .catch((error: unknown) => {
          // Übergeben: Der neue Leader sendet die Operation
          if (!(error instanceof SyncHandedOverError)) setSendHint(true);
        });
    },
    [sessionId, setPosition, getPosition],
  );

  useEffect(() => {
    if (slideDeckId === null || !active) return;
    function onKeyDown(e: KeyboardEvent) {
      const step = slideStep(e);
      if (step === null) return;
      e.preventDefault();
      goTo(Math.min(Math.max(getPosition()?.index ?? 1, 1), live.current.total) + step);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [slideDeckId, active, goTo, getPosition]);

  // Die Seitenleiste folgt der aktuellen Folie (auch bei Wechseln per Taste oder vom iPad)
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = navRef.current?.querySelector('[aria-current="true"]') as HTMLElement | null;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [current, total]);

  if (slideDeckId === null) return <Hint>Folien kommen später – einfach mitschreiben</Hint>;
  if (deck.isPending) return <Hint>Folien werden geladen …</Hint>;
  if (deck.isError) return <Hint>Folien sind gerade nicht erreichbar.</Hint>;
  if (deck.data.deck.ingest_state === 'fehler')
    return <Hint>Der Foliensatz konnte nicht eingelesen werden.</Hint>;
  if (total === 0) return <Hint>Folien werden verarbeitet …</Hint>;

  const slide = slides[current - 1];
  const btn =
    'inline-flex min-h-9 min-w-9 items-center justify-center rounded-md px-2 text-md text-text-muted hover:bg-surface-raised hover:text-text disabled:opacity-40';

  return (
    <div data-testid="slides-panel" className="flex h-full min-h-0">
      <nav
        ref={navRef}
        aria-label="Folien"
        className="w-24 shrink-0 overflow-y-auto border-r border-border p-1.5"
      >
        <ol className="flex flex-col gap-1.5">
          {slides.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                // Kein Fokus per Maus oder Tab: Sonst löste die Leertaste danach diese Schaltfläche aus, und die Tasten
                // des Dashboards würden an ihr hängen. Per Tastatur blättert man mit den Pfeiltasten.
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => goTo(i + 1)}
                disabled={!active}
                aria-label={`Folie ${i + 1}`}
                aria-current={i + 1 === current ? 'true' : undefined}
                className={`block w-full rounded-md border p-0.5 text-center text-xs ${
                  i + 1 === current ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-raised'
                }`}
              >
                <img
                  src={pageThumbUrl('folien', s.deck_id, s.id, i + 1)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  style={{ aspectRatio: `${s.width_pt} / ${s.height_pt}` }}
                  className="block w-full rounded-sm bg-white"
                />
                <span aria-hidden="true" className="block text-text-muted">
                  {i + 1}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 place-items-center p-2">
          {slide ? (
            <img
              key={slide.id}
              src={pageImageUrl('folien', slide.deck_id, slide.id, current)}
              alt={`Folie ${current}`}
              draggable={false}
              style={{ aspectRatio: `${slide.width_pt} / ${slide.height_pt}` }}
              className="max-h-full max-w-full select-none bg-white object-contain shadow-md"
            />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-center gap-2 px-2 pb-1 text-sm text-text-muted">
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => goTo(current - 1)}
            disabled={!active || current <= 1}
            aria-label="Vorherige Folie"
            aria-keyshortcuts="ArrowLeft"
            className={btn}
          >
            ‹
          </button>
          <span data-testid="slide-counter" aria-live="off">
            Folie {current} / {total}
          </span>
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => goTo(current + 1)}
            disabled={!active || current >= total}
            aria-label="Nächste Folie"
            aria-keyshortcuts="ArrowRight Space"
            className={btn}
          >
            ›
          </button>
          {sendHint || (startedAt === null && active) ? (
            <span role="status" className="ml-2">
              Wechsel nicht aufgezeichnet
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
