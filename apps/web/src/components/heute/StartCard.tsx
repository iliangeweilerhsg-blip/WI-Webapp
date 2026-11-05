'use client';

// Start-Karte (07 §3.1, F-SES-02): die nächste bzw. laufende Vorlesung mit dem passenden Knopf je Zustand.
// Kein Dialog zwischen Tipp und laufender Session. Fehler stehen ruhig in der Karte.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Session } from '@sg/shared';
import { ApiRequestError } from '../../lib/api.ts';
import { moduleHref } from '../../lib/nav.ts';
import {
  pauseSession,
  resumeSession,
  sessionErrorMessage,
  sessionHref,
  startSession,
  stopSession,
} from '../../lib/sessions.ts';
import { useToast } from '../../lib/toast.tsx';
import { moduleColorVar } from '../../lib/modules.ts';
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
  'inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-6 py-2 text-md font-medium text-accent-contrast disabled:opacity-50';
const secondary =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised disabled:opacity-50';

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
  /** Neue Fassung der Session aus einer Antwort des Core übernehmen */
  onSession: (session: Session) => void;
  /** Liste neu laden (z. B. nach `session_transition_invalid`) */
  onRefetch: () => void;
}

export function StartCard({ entry, now, onSession, onRefetch }: StartCardProps) {
  const session = entry.session;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  const state = session ? cardState(session, now) : null;
  // Eine neue Lage macht die alte Fehlermeldung hinfällig
  useEffect(() => setError(null), [session?.id, session?.state]);
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
    if (!session || busy) return;
    setBusy(action);
    setError(null);
    try {
      if (action === 'start') {
        const result = await startSession(session.id);
        onSession(result.session);
        if (result.ended_session) {
          onSession(result.ended_session);
          toast.show({ message: 'Die vorherige Session wurde beendet.' });
        }
        // F-SES-02: Das Live-Dashboard öffnet sich mit dem Start (T1-04)
        router.push(sessionHref(session.id));
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
      setError(sessionErrorMessage(cause));
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
          <h2 id={titleId} className={`${big ? 'text-xl' : 'text-lg'} flex items-center gap-2 font-semibold`}>
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
              disabled={busy !== null}
              aria-busy={busy === 'start'}
              onClick={() => void run('start')}
            >
              {busy === 'start'
                ? 'Startet …'
                : state === 'bevorstehend'
                  ? 'Früher starten'
                  : earlyReady
                    ? 'Start'
                    : 'Jetzt starten'}
            </button>
          ) : null}
          {state === 'laeuft' || state === 'pausiert' ? (
            <>
              <Link href={sessionHref(session.id)} className={primary}>
                Zur Vorlesung
              </Link>
              <button
                type="button"
                className={secondary}
                disabled={busy !== null}
                onClick={() => void run(state === 'laeuft' ? 'pause' : 'resume')}
              >
                {state === 'laeuft'
                  ? busy === 'pause'
                    ? 'Pausiert …'
                    : 'Pause'
                  : busy === 'resume'
                    ? 'Setzt fort …'
                    : 'Fortsetzen'}
              </button>
              <button
                type="button"
                className={secondary}
                disabled={busy !== null}
                onClick={() => void run('stop')}
              >
                {busy === 'stop' ? 'Beendet …' : 'Stopp'}
              </button>
            </>
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
