'use client';

// Folien-Spalte des Live-Dashboards (T1-05, F-DSH-02, 07 §3.3): zeigt die aktuelle Folie des Foliensatzes der Session
// mit einer Seitenleiste aus Vorschaubildern. Blättern mit `←` `→`, Leertaste und Klick; jeder Wechsel geht als
// Operation `slide.change` in den Strom der Session (VERTRAEGE §11.3), mit Sitzungszeit seit `started_at`.
// Fremde Wechsel (iPad, anderer Tab) kommen über denselben Strom und aktualisieren die Anzeige.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DeckOptions, Session, Slide } from '@sg/shared';
import { ApiRequestError } from '../../../lib/api.ts';
import {
  deckOptionsKey,
  pageImageUrl,
  pageThumbUrl,
  useDeckDetail,
  useDeckOptions,
} from '../../../lib/material.ts';
import { sessionStreamId, sessionTimeMs, syncedNowMs } from '../../../lib/session-stream.ts';
import { isEditableTarget } from '../../../lib/shortcuts.ts';
import { SyncHandedOverError, type SyncClient } from '../../../lib/sync/client.ts';
import { uuidv7 } from '../../../lib/uuid.ts';
import { useDeckChoice } from '../../slides/use-deck-choice.ts';
import { watchReconnect } from '../reconnect.ts';
import { DeckStrip, NoDeckPanel } from './DeckActions.tsx';
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
  /** Neue Fassung der Session aus einer Antwort des Core (nach dem Setzen oder Wechseln des Foliensatzes) */
  onSession?: (session: Session) => void;
}

/** Abstand der Abfrage nach neuen Folien in einer Session ohne Satz (VERTRAEGE §22.6) */
export const DECK_OFFER_POLL_MS = 60_000;

const NO_SESSION_UPDATE = () => undefined;

function Hint({ children, footer }: { children: string; footer?: React.ReactNode }) {
  return (
    <div
      data-testid="slides-panel"
      className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
    >
      <p role="status" className="text-md text-text-muted">
        {children}
      </p>
      {footer}
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
  // Die Liste der Foliensätze (`DeckPicker`) nutzt die Pfeiltasten selbst; ein Blättern würde den Satz sperren
  if (target?.closest?.('[data-slide-keys="off"]')) return null;
  if (e.key === 'ArrowLeft') return -1;
  if (e.key === 'ArrowRight') return 1;
  if (e.key === ' ') {
    // Auf Schaltflächen und Links löst die Leertaste deren eigene Aktion aus
    if (target?.closest?.('button, a, summary, [role="button"], [role="link"]')) return null;
    return 1;
  }
  return null;
}

export function SlidesPanel({
  sessionId,
  moduleId,
  slideDeckId,
  active,
  startedAt,
  client,
  onSession = NO_SESSION_UPDATE,
}: SlidesPanelProps) {
  const queryClient = useQueryClient();
  const deck = useDeckDetail(slideDeckId ?? '', { enabled: slideDeckId !== null });
  // Der Satz der Session ist gelöscht (der Zeiger bleibt, die Abfrage sagt 404): wie „kein Satz“ behandeln (§22.2)
  const deckGone =
    slideDeckId !== null &&
    deck.isError &&
    deck.error instanceof ApiRequestError &&
    deck.error.status === 404;
  // Seit wann gilt dieser Zeiger? Eine Momentaufnahme der Optionen von davor sagt nichts über den neuen Satz.
  const pointerSince = useRef({ id: slideDeckId, at: Date.now() });
  if (pointerSince.current.id !== slideDeckId) pointerSince.current = { id: slideDeckId, at: Date.now() };
  // `deck-options` (§22.3, §22.6): ohne Satz zum Anbieten und Abfragen auf Moodle, mit Satz für die Sperre und für den
  // Fall, dass der Satz von außen gelöscht wird (dann sagt `current_deck_id = null` es, auch ohne Neuladen)
  const options = useDeckOptions(moduleId, sessionId, {
    enabled: active || deckGone,
    // Bei jedem Sichtbarwerden des Tabs, mit und ohne Satz: eine leichte Abfrage, keine Dauerschleife
    refetchOnVisible: active,
    // Alle 60 s nur, solange es Folien anzubieten gibt: ohne Satz oder mit gelöschtem Satz (§22.6)
    refetchInterval: (data) =>
      active && (slideDeckId === null || deckGone || data?.current_deck_id === null)
        ? DECK_OFFER_POLL_MS
        : false,
  });
  const optionsGone =
    slideDeckId !== null &&
    options.data !== undefined &&
    options.data.current_deck_id === null &&
    options.dataUpdatedAt >= pointerSince.current.at;
  const deleted = deckGone || optionsGone;
  const noDeck = slideDeckId === null || deleted;
  // Bekommt die Session von außen einen anderen Satz (`session.updated`), stimmt `lock` nicht mehr: neu laden. Stimmt die
  // Momentaufnahme schon (eigene Wahl: `useDeckChoice` hat sie gesetzt und lädt selbst neu), entfällt die zweite Abfrage.
  const lastDeck = useRef(slideDeckId);
  useEffect(() => {
    if (lastDeck.current === slideDeckId) return;
    lastDeck.current = slideDeckId;
    const key = deckOptionsKey(moduleId, sessionId);
    if (queryClient.getQueryData<DeckOptions>(key)?.current_deck_id === slideDeckId) return;
    void queryClient.invalidateQueries({ queryKey: key });
  }, [slideDeckId, queryClient, moduleId, sessionId]);
  const choice = useDeckChoice({ id: sessionId, module_id: moduleId }, onSession);
  // Nach jedem Neuverbinden des Sync-Clients nachfragen (§22.6), solange es Folien anzubieten gibt
  useEffect(() => {
    if (!client || !noDeck || !active) return;
    return watchReconnect(client, () => {
      void queryClient.invalidateQueries({ queryKey: deckOptionsKey(moduleId, sessionId) });
    });
  }, [client, noDeck, active, queryClient, moduleId, sessionId]);

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
  const live = useRef({ current, total, active, startedAt, client, slides, noDeck });
  live.current = { current, total, active, startedAt, client, slides, noDeck };

  const goTo = useCallback(
    (target: number) => {
      const {
        total: count,
        active: isActive,
        startedAt: start,
        client: sync,
        slides: list,
        noDeck: gone,
      } = live.current;
      // Ohne (lesbaren) Satz wird nicht geblättert: Ein `slide.change` würde die Session sperren (§22.4)
      if (!isActive || gone || count === 0) return;
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
    if (noDeck || !active) return;
    function onKeyDown(e: KeyboardEvent) {
      const step = slideStep(e);
      if (step === null) return;
      e.preventDefault();
      goTo(Math.min(Math.max(getPosition()?.index ?? 1, 1), live.current.total) + step);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [noDeck, active, goTo, getPosition]);

  // Die Seitenleiste folgt der aktuellen Folie (auch bei Wechseln per Taste oder vom iPad)
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = navRef.current?.querySelector('[aria-current="true"]') as HTMLElement | null;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [current, total]);

  if (noDeck) {
    return (
      <NoDeckPanel
        sessionId={sessionId}
        deleted={deleted}
        active={active}
        startedAt={startedAt}
        options={options.data}
        optionsFailed={options.isError}
        choice={choice}
      />
    );
  }
  if (deck.isPending) return <Hint>Folien werden geladen …</Hint>;
  if (deck.isError) return <Hint>Folien sind gerade nicht erreichbar.</Hint>;
  // Bei einem Satz, der nicht lesbar ist oder noch verarbeitet wird, bleibt der Wechsel möglich (solange nicht
  // geblättert: der Core sagt es über `lock`, eine bekannte Position meldet auch fremde Wechsel von iPad und Tabs)
  const strip = (
    <DeckStrip options={options.data} locked={position !== null} active={active} choice={choice} />
  );
  if (deck.data.deck.ingest_state === 'fehler')
    return <Hint footer={strip}>Der Foliensatz konnte nicht eingelesen werden.</Hint>;
  if (total === 0) return <Hint footer={strip}>Folien werden verarbeitet …</Hint>;

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
        {strip}
      </div>
    </div>
  );
}
