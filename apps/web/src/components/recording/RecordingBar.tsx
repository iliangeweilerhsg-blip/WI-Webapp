'use client';

// Aufnahme-Leiste der App-Shell (Issue #210 Teil 3, VERTRAEGE §11.8, Plan docs/plaene/210-AUFNAHME-APPSHELL.md §4.7):
// Solange eine Session aktiv ist und kein Dashboard sie zeigt, steht hier der Zustand der Aufnahme: REC mit Laufzeit,
// Pause, „Aufnahme starten“, Fehler, die Rückfrage des Auto-Stopps und der Link „Zur Vorlesung“. Bewusst ohne Pause
// und Beenden (Lead-Entscheidung): Ein versehentliches Beenden von einer fremden Seite wäre teurer als zwei Klicks.
// Im Dashboard der aktiven Session übernimmt die Statusleiste. Keine Farbe außer dem roten Punkt, keine Animation.
import Link from 'next/link';
import { useRecordingView } from '../../lib/recording';
import { isDashboardAvailable, sessionHref } from '../../lib/sessions.ts';
import { AutoStopHint } from '../autostop';
import { PAUSE_HINT_MS } from '../dashboard/StatusBar.tsx';
import { formatElapsed } from '../today/model.ts';
import { useNow } from '../today/use-today.ts';
import { RECORDING_LABEL, RecordDot, recordingStatusText } from './labels.ts';

const primary =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 py-2 text-md font-medium text-accent-contrast';
const secondary =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised';

export function RecordingBar() {
  const view = useRecordingView();
  const now = useNow(1000);
  // Ohne aktive Session, oder wenn das Dashboard dieser Session offen ist (dort zeigt die Statusleiste alles)
  if (view.session === null || view.phase === 'andere' || view.shownByDashboard) return null;

  const { kind, session } = view;
  const startedAt = session.started_at ? Date.parse(session.started_at) : null;
  const paused = view.phase === 'pausiert';
  const pauseMs =
    paused && view.pausedSince !== null && now !== null ? Math.max(0, now - view.pausedSince) : null;
  const pauseHint = pauseMs !== null && pauseMs >= PAUSE_HINT_MS;
  const recording = !paused && kind === 'rec';
  const label = paused ? 'Pausiert' : RECORDING_LABEL[kind];
  const needsAction =
    !paused && kind !== 'rec' && kind !== 'starting' && kind !== 'waiting' && kind !== 'other-tab';
  const actionLabel = kind === 'needs-start' ? 'Aufnahme starten' : 'Erneut versuchen';

  return (
    <aside
      aria-label="Aufnahme"
      data-testid="recording-bar"
      data-kind={paused ? 'paused' : kind}
      className="shrink-0 border-t border-border bg-surface"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2 text-sm">
        <p className="flex items-center gap-2">
          <RecordDot filled={false} record={recording} />
          <span className={needsAction ? 'font-semibold' : 'font-medium'}>{label}</span>
          {/* Laufzeit und Pausendauer stehen außerhalb des Status-Satzes: Er soll sich nicht jede Sekunde ändern */}
          {recording && now !== null && startedAt !== null ? (
            <span className="tabular-nums" data-testid="bar-elapsed">
              <span className="sr-only">Laufzeit </span>
              {formatElapsed(now - startedAt)}
            </span>
          ) : null}
          {pauseMs !== null ? (
            <span className="tabular-nums" data-testid="bar-pause-elapsed">
              <span className="sr-only">Pausendauer </span>
              {formatElapsed(pauseMs)}
            </span>
          ) : null}
          {pauseHint ? <span className="font-medium">Noch Pause?</span> : null}
        </p>
        <span role="status" className="sr-only" data-testid="bar-status">
          {recordingStatusText({ phase: view.phase, kind, message: view.message }, pauseHint)}
        </span>

        {needsAction ? (
          <button type="button" className={kind === 'needs-start' ? primary : secondary} onClick={view.start}>
            {actionLabel}
          </button>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
          <AutoStopHint
            status={view.autoStop.status}
            extendMinutes={view.extendMinutes}
            onExtend={() => void view.autoStop.extend()}
            extending={view.autoStop.extending}
            error={view.autoStop.extendError ?? view.autoStop.stopError}
          />
          {/* Der Link erst, wenn die Route existiert (T1-04, siehe `SESSION_DASHBOARD_AVAILABLE`) */}
          {isDashboardAvailable() ? (
            <Link href={sessionHref(session.id)} className={secondary}>
              Zur Vorlesung
            </Link>
          ) : null}
        </div>
      </div>
      {view.message && !paused && kind !== 'other-tab' ? (
        <p className="px-3 pb-2 text-sm text-text-muted" data-testid="bar-hint">
          {view.message}
        </p>
      ) : null}
    </aside>
  );
}
