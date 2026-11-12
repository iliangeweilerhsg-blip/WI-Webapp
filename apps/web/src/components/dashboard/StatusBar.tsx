'use client';

// Statusleiste des Live-Dashboards (F-DSH-06, 07 §3.3), von links nach rechts:
// Aufnahme (● REC und Laufzeit, oder der Zustand: Keine Aufnahme, Pausiert mit Dauer, Mikrofon fehlt, Aufnahme in anderem Tab), Upload-Status, Marker (T1-17), iPad-Status, Live-Verbindung, Stopp-Hinweis, Pause und Beenden.
// Keine Farbe außer dem roten Aufnahmepunkt, kein Text länger als drei Wörter, keine Animationen.
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '@sg/shared';
import { DEVICES_KEY, useDevices } from '../../lib/devices.ts';
import { moduleHref } from '../../lib/nav.ts';
import { isActive, newerSession } from '../../lib/sessions.ts';
import { rueckblickHref } from '../../lib/transcript.ts';
import type { SyncClient } from '../../lib/sync/client.ts';
import { AutoStopHint } from '../autostop';
import { formatElapsed } from '../today/model.ts';
import { POLL_MS, useLiveState, useNow } from '../today/use-today.ts';
import { MarkerControls } from './markers/MarkerControls.tsx';
import { watchReconnect } from './reconnect.ts';
import { useClaimRecordingDisplay, useRecordingFor } from '../../lib/recording';
import { RECORDING_LABEL, RecordDot as Dot, recordingStatusText } from '../recording/labels.ts';
import type { SessionActions } from './use-session.ts';

const secondary =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised aria-disabled:opacity-50';
const primary =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 py-2 text-md font-medium text-accent-contrast aria-disabled:opacity-50';
const ghost =
  'inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-md text-text-muted underline-offset-4 hover:bg-surface-raised hover:text-text hover:underline aria-disabled:opacity-50';

/**
 * Ist ein gekoppeltes iPad gerade verbunden? Nur aus `GET /devices`. Ereignisse (`device.connection`, `online`,
 * `leader.changed`) lösen nur ein neues Laden aus: Sie sagen nicht, welches von mehreren iPads gemeint ist, und
 * kommen nach einem Verbindungsabbruch nicht nach (§11.6).
 */
export function useIpadConnected(client: SyncClient | null): boolean {
  // Ohne Live-Verbindung (auch im Folge-Tab) kommen keine Ereignisse: dann alle 30 s nachfragen
  const { online } = useLiveState(client);
  const devices = useDevices({ refetchIntervalMs: online ? false : POLL_MS });
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!client) return;
    // `exact`: sonst trifft es auch `['devices', 'pairing-requests']`
    const refetch = () => void queryClient.invalidateQueries({ queryKey: DEVICES_KEY, exact: true });
    const offs = [
      client.onEvent('device.connection', (d) => {
        if (d.client === 'ipad') refetch();
      }),
      watchReconnect(client, refetch),
      client.onEvent('leader.changed', refetch),
    ];
    return () => offs.forEach((off) => off());
  }, [client, queryClient]);
  return devices.data?.some((d) => d.kind === 'ipad' && d.connected) ?? false;
}

/** Ab dieser Pausendauer fragt die Leiste „Noch Pause?“ (UX-07) */
export const PAUSE_HINT_MS = 20 * 60_000;
/** So lange steht „Aufnahme neu begonnen“ nach einem Neustart des Recorders (UX-08) */
const RESTART_NOTICE_MS = 30_000;
/** Ab so vielen wartenden Teilen meldet die Leiste den Rückstau (UX-08) */
const BACKLOG_MIN = 3;

export interface StatusBarProps {
  session: Session;
  client: SyncClient | null;
  moduleId: string;
  /** `GET /sessions/{id}` hat einen Stand, aber die Live-Verbindung steht nicht */
  offline: boolean;
  /** Dieser Tab folgt einem anderen (Leader): kein eigener Live-Strom */
  otherTab?: boolean;
  actions: SessionActions;
  /** „Beenden“ wurde gedrückt: die Ansicht fragt nach (UX-06), die Leiste beendet nicht selbst */
  onStopRequest: () => void;
}

export function StatusBar({
  session: pageSession,
  client,
  moduleId,
  offline,
  otherTab = false,
  actions,
  onStopRequest,
}: StatusBarProps) {
  const now = useNow(1000);
  // Aufnahme (Issue #106) und Auto-Stopp (F-SES-03) gehören der App-Shell (RecordingProvider, Issue #210): Die
  // Statusleiste zeigt nur ihren Stand. Nur der Sync-Leader-Tab nimmt auf. REC steht nur, wenn wirklich aufgenommen wird.
  useClaimRecordingDisplay(pageSession.id);
  const rec = useRecordingFor(pageSession.id);
  // Phase aus derselben Quelle wie der Recorder (`useActiveSession`, 10 s bzw. Ereignis), nicht nur aus dem
  // Seitenstand (30 s): Bei derselben Session gilt die neuere Fassung (Issue #266). Nach dem Ende gilt der Seitenstand.
  const session =
    rec.session !== null && rec.session.id === pageSession.id && rec.phase !== 'andere'
      ? newerSession(pageSession, rec.session)
      : pageSession;
  const ipad = useIpadConnected(client);
  const active = isActive(session);
  const running = session.state === 'laeuft';
  const paused = session.state === 'pausiert';
  const startedAt = session.started_at ? Date.parse(session.started_at) : null;
  const endedAt = session.ended_at ? Date.parse(session.ended_at) : null;

  const auto = rec.autoStop;
  const needsMic = running && rec.kind !== 'rec';

  // Pausendauer (UX-07): der Core kennt keinen Beginn der Pause, der Provider merkt ihn sich (einmal je Tab)
  const pausedSince = rec.pausedSince;
  const pauseMs = paused && pausedSince !== null && now !== null ? Math.max(0, now - pausedSince) : null;
  const pauseHint = pauseMs !== null && pauseMs >= PAUSE_HINT_MS;

  // Upload-Status (UX-08): nur der Leader lädt hoch. Neustart und „in dieser Ansicht aufgenommen“ merkt sich die Leiste.
  const { restarts, upload } = rec.status;
  const recordingState = rec.status.state;
  const recordedHere = useRef(false);
  if (recordingState === 'recording' || recordingState === 'starting') recordedHere.current = true;
  const seenRestarts = useRef(restarts);
  const [restartedAt, setRestartedAt] = useState<number | null>(null);
  useEffect(() => {
    if (restarts > seenRestarts.current) setRestartedAt(Date.now());
    seenRestarts.current = restarts;
  }, [restarts]);
  const leader = !otherTab;
  let uploadText: string | null = null;
  if (leader && running) {
    const parts: string[] = [];
    if (upload.pendingChunks >= BACKLOG_MIN) parts.push(`${upload.pendingChunks} Teile warten`);
    if (restartedAt !== null && now !== null && now - restartedAt < RESTART_NOTICE_MS)
      parts.push('Aufnahme neu begonnen');
    uploadText = parts.length > 0 ? parts.join(' · ') : null;
  } else if (leader && !active && recordedHere.current) {
    // Der Recorder stoppt erst nach dem Ende der Session: bis dahin und währenddessen ist noch nichts gesichert
    const saving =
      upload.pendingChunks > 0 ||
      (upload.pendingCompletes ?? 0) > 0 ||
      recordingState === 'stopping' ||
      recordingState === 'recording' ||
      recordingState === 'starting';
    // Zurückgestellte Teile (der Core hat sie abgelehnt) bleiben liegen: dann nicht still „Gesichert“ melden
    const shelved = upload.shelvedChunks;
    uploadText = saving
      ? 'Wird gesichert …'
      : shelved > 0
        ? `Gesichert, ${shelved === 1 ? '1 Teil' : `${shelved} Teile`} zurückgestellt`
        : 'Gesichert';
  }

  let record: { label: string; time: string | null; dot: 'rec' | 'hollow' | 'filled' };
  if (running && rec.kind === 'rec') {
    record = {
      label: 'REC',
      time: now !== null && startedAt !== null ? formatElapsed(now - startedAt) : null,
      dot: 'rec',
    };
  } else if (running) {
    record = { label: RECORDING_LABEL[rec.kind], time: null, dot: 'hollow' };
  } else if (paused) {
    // Die Dauer der Pause steht separat (`pause-elapsed`), `elapsed` bleibt der Laufzeit vorbehalten
    record = { label: 'Pausiert', time: null, dot: 'hollow' };
  } else if (session.state === 'beendet' || session.state === 'verarbeitet') {
    record = {
      label: 'Beendet',
      time: startedAt !== null && endedAt !== null ? formatElapsed(endedAt - startedAt) : null,
      dot: 'filled',
    };
  } else {
    record = { label: 'Nicht gestartet', time: null, dot: 'hollow' };
  }

  const busy = actions.busy !== null;
  const error = actions.error;

  return (
    <footer
      aria-label="Statusleiste"
      data-state={session.state}
      className="shrink-0 border-t border-border bg-surface"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2 text-sm">
        <p className="flex items-center gap-2">
          <Dot filled={record.dot === 'filled'} record={record.dot === 'rec'} />
          <span className={needsMic ? 'font-semibold' : 'font-medium'}>{record.label}</span>
          {record.time ? (
            <span className="tabular-nums" data-testid="elapsed">
              <span className="sr-only">Laufzeit </span>
              {record.time}
            </span>
          ) : null}
          {pauseMs !== null ? (
            <span className="tabular-nums" data-testid="pause-elapsed">
              <span className="sr-only">Pausendauer </span>
              {formatElapsed(pauseMs)}
            </span>
          ) : null}
          {pauseHint ? <span className="font-medium">Noch Pause?</span> : null}
          {/* Zustand für Screenreader als ruhige Statusmeldung */}
          <span role="status" className="sr-only">
            {running
              ? rec.kind === 'rec'
                ? 'Die Session läuft und wird aufgenommen.'
                : `Die Session läuft. ${rec.message ?? ''}`.trim()
              : paused
                ? recordingStatusText({ phase: 'pausiert', kind: 'paused', message: null }, pauseHint)
                : record.label === 'Beendet'
                  ? 'Die Session ist beendet.'
                  : 'Die Session läuft nicht.'}
          </span>
        </p>

        {needsMic &&
        (rec.kind === 'needs-start' ||
          rec.kind === 'mic-denied' ||
          rec.kind === 'mic-missing' ||
          rec.kind === 'error') ? (
          <button
            type="button"
            className={rec.kind === 'needs-start' ? primary : secondary}
            onClick={rec.start}
          >
            {rec.kind === 'needs-start' ? 'Aufnahme starten' : 'Erneut versuchen'}
          </button>
        ) : null}

        <MarkerControls sessionId={session.id} active={active} startedAt={startedAt} client={client} />

        {uploadText ? (
          <p className="text-text-muted" data-testid="upload-status" aria-live="polite">
            {uploadText}
          </p>
        ) : null}

        <p className="flex items-center gap-2 text-text-muted" data-testid="ipad-status">
          <Dot filled={ipad} />
          <span>iPad</span>
          <span className="sr-only">{ipad ? 'verbunden' : 'nicht verbunden'}</span>
        </p>
        <p className="flex items-center gap-2 text-text-muted" data-testid="live-status">
          <Dot filled={!offline && !otherTab} />
          <span>{otherTab ? 'Anderer Tab' : offline ? 'Offline' : 'Live'}</span>
          <span className="sr-only">
            {otherTab
              ? 'Ein anderer Tab hält die Verbindung'
              : offline
                ? 'Keine Live-Verbindung, Stand womöglich veraltet'
                : 'Live-Verbindung'}
          </span>
        </p>

        {active ? (
          <AutoStopHint
            status={auto.status}
            extendMinutes={rec.extendMinutes}
            onExtend={() => void auto.extend()}
            extending={auto.extending}
            error={auto.extendError ?? auto.stopError}
          />
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {active ? (
            <>
              <button
                type="button"
                className={paused ? primary : secondary}
                aria-disabled={busy}
                onClick={() => !busy && void actions.run(paused ? 'resume' : 'pause')}
              >
                {actions.busy === 'pause'
                  ? 'Wird pausiert …'
                  : actions.busy === 'resume'
                    ? 'Wird fortgesetzt …'
                    : paused
                      ? 'Fortsetzen'
                      : 'Pause'}
              </button>
              {/* Mit Abstand und ohne Rahmen, damit „Beenden“ nicht versehentlich statt „Pause“ getroffen wird */}
              <button
                type="button"
                className={`${ghost} ml-2 sm:ml-6`}
                aria-disabled={busy}
                onClick={() => !busy && onStopRequest()}
              >
                {actions.busy === 'stop' ? 'Wird beendet …' : 'Beenden'}
              </button>
            </>
          ) : (
            <>
              {session.state === 'beendet' || session.state === 'verarbeitet' ? (
                <Link href={rueckblickHref(session.id)} className={primary}>
                  Rückblick
                </Link>
              ) : null}
              <Link href="/" className={secondary}>
                Zu Heute
              </Link>
              <Link href={moduleHref(moduleId)} className={secondary}>
                Zum Modul
              </Link>
            </>
          )}
        </div>
      </div>
      {needsMic && rec.message && rec.kind !== 'other-tab' ? (
        <p role="status" className="px-3 pb-2 text-sm text-text-muted" data-testid="recording-hint">
          {rec.message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="px-3 pb-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </footer>
  );
}
