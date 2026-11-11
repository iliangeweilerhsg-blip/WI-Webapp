'use client';

// Start-Karte (07 §3.1, F-SES-02): die nächste bzw. laufende Vorlesung mit dem passenden Knopf je Zustand.
// Kein Dialog zwischen Tipp und laufender Session. Fehler stehen ruhig in der Karte.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '@sg/shared';
import { ApiRequestError, friendlyMessage } from '../../lib/api.ts';
import { moduleHref } from '../../lib/nav.ts';
import { noteMicIntent } from '../../lib/recorder/mic-intent.ts';
import {
  isDashboardAvailable,
  pauseSession,
  resumeSession,
  sessionHref,
  startSession,
  stopSession,
} from '../../lib/sessions.ts';
import { moduleColorVar } from '../../lib/modules.ts';
import { rueckblickHref } from '../../lib/transcript.ts';
import { useNow } from './use-today.ts';
import {
  READY_LEAD_MS,
  cardState,
  formatClock,
  formatElapsed,
  formatUntil,
  type CardState,
  type TodayEntry,
} from './model.ts';

const primary =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-6 py-2 text-md font-medium text-accent-contrast aria-disabled:opacity-50';
const secondary =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised aria-disabled:opacity-50';

const ghost =
  'inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-md text-text-muted underline-offset-4 hover:bg-surface-raised hover:text-text hover:underline aria-disabled:opacity-50';

type Action = 'start' | 'pause' | 'resume' | 'stop';

const HEADINGS: Record<CardState, string> = {
  bevorstehend: 'Als Nächstes',
  bereit: 'Gleich',
  laeuft: 'Läuft',
  pausiert: 'Pausiert',
  verpasst: 'Nicht aufgenommen',
  beendet: 'Beendet',
  verarbeitet: 'Verarbeitet',
};

/** Dauer seit Start; tickt jede Sekunde (die Pause kennt der Core nicht als Zeitraum, darum zeigt die Pause keine Dauer) */
function Elapsed({ since }: { since: number }) {
  const now = useNow(1000);
  if (now === null) return <span className="tabular-nums">--:--:--</span>;
  return (
    <time className="tabular-nums" dateTime={`PT${Math.max(0, Math.floor((now - since) / 1000))}S`}>
      {formatElapsed(now - since)}
    </time>
  );
}

export interface StartCardProps {
  entry: TodayEntry;
  now: number;
  /** Eine vergessene aktive Session läuft noch; der Core beendet sie beim Start (§9.1) */
  previousRunning?: boolean;
  /** Neue Fassung der Session aus einer Antwort des Core übernehmen */
  onSession: (session: Session) => void;
  /** Liste neu laden (z. B. nach `session_transition_invalid`) */
  onRefetch: () => void;
}

export function StartCard({ entry, now, previousRunning = false, onSession, onRefetch }: StartCardProps) {
  const session = entry.session;
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  // Doppel-Tipp im selben Render-Takt abfangen (der Zustand `busy` kommt erst im nächsten)
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hadFocus = useRef(false);
  const stateAtRun = useRef<string | null>(null);

  const state = session ? cardState(session, now) : null;
  // Eine neue Lage macht die alte Fehlermeldung hinfällig
  useEffect(() => setError(null), [session?.id, session?.state]);
  useEffect(() => setEnded(false), [session?.id]);
  // Verschwindet der Knopf, der den Fokus hatte (z. B. „Start“), geht der Fokus auf die Überschrift der Karte
  useEffect(() => {
    if (busy !== null || !hadFocus.current) return;
    const active = document.activeElement;
    if (!active || active === document.body) {
      headingRef.current?.focus();
      hadFocus.current = false;
    } else if (session?.state !== stateAtRun.current) {
      hadFocus.current = false; // der Fokus ist noch auf einem Knopf der Karte
    }
    // sonst: Die neue Fassung der Session ist noch nicht angekommen, nächster Durchlauf
  }, [busy, session?.state]);
  if (!session || !state) return null;

  const plannedStart = session.planned_starts_at ? Date.parse(session.planned_starts_at) : null;
  const startedAt = session.started_at ? Date.parse(session.started_at) : null;
  const startsInMs = plannedStart === null ? 0 : plannedStart - now;
  const earlyReady = state === 'bereit' && startsInMs > 0;
  const canStart = state === 'bevorstehend' || state === 'bereit';
  const big = state !== 'bevorstehend' || startsInMs <= READY_LEAD_MS;

  const timeRange =
    entry.start !== null && !entry.allDay
      ? entry.end !== null && entry.end !== entry.start
        ? `${formatClock(entry.start)}–${formatClock(entry.end)}`
        : formatClock(entry.start)
      : null;

  async function run(action: Action) {
    if (!session || busyRef.current) return;
    busyRef.current = true;
    hadFocus.current = cardRef.current?.contains(document.activeElement) ?? false;
    stateAtRun.current = session.state;
    setBusy(action);
    setError(null);
    try {
      if (action === 'start') {
        noteMicIntent();
        const result = await startSession(session.id);
        onSession(result.session);
        if (result.ended_session) {
          onSession(result.ended_session);
          setEnded(true);
        }
        // F-SES-02: Das Live-Dashboard öffnet sich mit dem Start. Erst, wenn die Route existiert (T1-04, siehe Schalter)
        if (isDashboardAvailable()) router.push(sessionHref(session.id));
        return;
      }
      const updated =
        action === 'pause'
          ? await pauseSession(session.id)
          : action === 'resume'
            ? await resumeSession(session.id)
            : await stopSession(session.id);
      onSession(updated);
    } catch (cause) {
      hadFocus.current = false;
      setError(friendlyMessage(cause));
      // Der Zustand im Core ist ein anderer als gedacht: Ansicht auffrischen
      if (
        cause instanceof ApiRequestError &&
        cause.kind === 'api' &&
        (cause.status ?? 0) >= 400 &&
        (cause.status ?? 0) < 500
      ) {
        onRefetch();
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const dot =
    state === 'laeuft' ? (
      <span aria-hidden="true" className="inline-block size-2.5 rounded-full bg-record" />
    ) : state === 'pausiert' ? (
      <span aria-hidden="true" className="inline-block size-2.5 rounded-full border-2 border-text-muted" />
    ) : null;

  const titleId = `start-card-${session.id}`;
  return (
    <section
      ref={cardRef}
      aria-labelledby={titleId}
      data-state={state}
      className={`rounded-lg border bg-surface ${big ? 'border-border-strong px-4 py-5 sm:px-6' : 'border-border px-4 py-4'}`}
    >
      <p className="flex items-center gap-2 text-sm font-medium text-text-muted">
        {dot}
        <span>{HEADINGS[state]}</span>
        {/* Zustand für Screenreader als ruhige Statusmeldung */}
        <span role="status" className="sr-only">
          {statusText(state)}
        </span>
      </p>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-60">
          <h2
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            className={`${big ? 'text-xl' : 'text-lg'} flex items-center gap-2 font-semibold outline-offset-4`}
          >
            {entry.module ? (
              <span
                aria-hidden="true"
                className="inline-block size-3 shrink-0 rounded-full"
                style={{ backgroundColor: moduleColorVar(entry.module.color) }}
              />
            ) : null}
            <span className="min-w-0 break-words">{entry.label}</span>
          </h2>
          <p className="mt-1 text-md text-text-muted">
            {[timeRange, entry.room].filter(Boolean).join(' · ') || 'Spontane Session'}
          </p>
          <p className="mt-2 text-md">
            {detail(state, { now, startsInMs, plannedStart, startedAt, session })}
          </p>
          {previousRunning && canStart ? (
            <p className="mt-1 text-sm text-text-muted">
              Vorherige Vorlesung läuft noch und wird beim Start beendet.
            </p>
          ) : null}
          {ended ? (
            <p className="mt-1 text-sm text-text-muted">Die vorherige Session wurde beendet.</p>
          ) : null}
          {state === 'laeuft' && startedAt !== null ? (
            <p className="mt-1 text-lg">
              <span className="sr-only">Dauer seit Start </span>
              <Elapsed since={startedAt} />
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canStart ? (
            <button
              type="button"
              className={state === 'bereit' ? primary : secondary}
              aria-disabled={busy !== null}
              aria-busy={busy === 'start'}
              onClick={() => void run('start')}
            >
              {busy === 'start'
                ? 'Wird gestartet …'
                : state === 'bevorstehend'
                  ? 'Früher starten'
                  : earlyReady
                    ? 'Start'
                    : 'Jetzt starten'}
            </button>
          ) : null}
          {state === 'laeuft' || state === 'pausiert' ? (
            <>
              {/* Der Link erst, wenn die Route existiert (T1-04, siehe `SESSION_DASHBOARD_AVAILABLE`) */}
              {isDashboardAvailable() ? (
                <Link href={sessionHref(session.id)} className={state === 'laeuft' ? primary : secondary}>
                  Zur Vorlesung
                </Link>
              ) : null}
              <button
                type="button"
                className={state === 'pausiert' ? primary : secondary}
                aria-disabled={busy !== null}
                onClick={() => void run(state === 'laeuft' ? 'pause' : 'resume')}
              >
                {state === 'laeuft'
                  ? busy === 'pause'
                    ? 'Wird pausiert …'
                    : 'Pause'
                  : busy === 'resume'
                    ? 'Wird fortgesetzt …'
                    : 'Fortsetzen'}
              </button>
              {/* Mit Abstand und ohne Rahmen, damit „Beenden“ nicht versehentlich statt „Pause“ getroffen wird */}
              <button
                type="button"
                className={`${ghost} ml-4 sm:ml-8`}
                aria-disabled={busy !== null}
                onClick={() => void run('stop')}
              >
                {busy === 'stop' ? 'Wird beendet …' : 'Beenden'}
              </button>
            </>
          ) : null}
          {state === 'verarbeitet' || state === 'beendet' ? (
            <Link href={rueckblickHref(session.id)} className={secondary}>
              Rückblick
            </Link>
          ) : null}
          {state === 'verarbeitet' || state === 'beendet' ? (
            <Link href={moduleHref(session.module_id)} className={secondary}>
              Zum Modul
            </Link>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function statusText(state: CardState): string {
  switch (state) {
    case 'bevorstehend':
      return 'Die Session beginnt später.';
    case 'bereit':
      return 'Die Session ist bereit zum Start.';
    case 'laeuft':
      return 'Die Session läuft.';
    case 'pausiert':
      return 'Die Session ist pausiert.';
    case 'verpasst':
      return 'Zu diesem Termin wurde nicht aufgenommen.';
    case 'beendet':
      return 'Die Session ist beendet und wird verarbeitet.';
    case 'verarbeitet':
      return 'Die Session ist verarbeitet.';
  }
}

function detail(
  state: CardState,
  c: {
    now: number;
    startsInMs: number;
    plannedStart: number | null;
    startedAt: number | null;
    session: Session;
  },
): string {
  switch (state) {
    case 'bevorstehend':
    case 'bereit':
      if (c.plannedStart === null) return 'Ein Tipp auf Start genügt.';
      return c.startsInMs > 0
        ? `Beginnt um ${formatClock(c.plannedStart)}, ${formatUntil(c.startsInMs)}.`
        : 'Der Termin hat begonnen.';
    case 'laeuft':
      return c.startedAt !== null ? `Seit ${formatClock(c.startedAt)} Uhr.` : 'Läuft.';
    case 'pausiert':
      return 'Fortsetzen nimmt genau dort wieder auf.';
    case 'verpasst':
      return 'Der Termin ist vorbei, ohne dass aufgenommen wurde.';
    case 'beendet':
      return 'Die Aufnahme wird gerade verarbeitet.';
    case 'verarbeitet':
      return 'Alles ist verarbeitet.';
  }
}
