'use client';

// Statusleiste des Live-Dashboards (F-DSH-06, 07 §3.3), von links nach rechts:
// Aufnahme (● REC und Laufzeit), Marker (T1-17), iPad-Status, Live-Verbindung, Stopp-Hinweis, Pause und Beenden.
// Keine Farbe außer dem roten Aufnahmepunkt, kein Text länger als drei Wörter, keine Animationen.
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Session } from '@sg/shared';
import { useAutoStop } from '../../lib/autostop';
import { DEVICES_KEY, useDevices } from '../../lib/devices.ts';
import { moduleHref } from '../../lib/nav.ts';
import { isActive } from '../../lib/sessions.ts';
import { useSettings } from '../../lib/settings.ts';
import type { SyncClient } from '../../lib/sync/client.ts';
import { AutoStopHint } from '../autostop';
import { formatElapsed } from '../today/model.ts';
import { useNow } from '../today/use-today.ts';
import { MarkerControls } from './markers/MarkerControls.tsx';
import type { SessionActions } from './use-session.ts';

const secondary =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised aria-disabled:opacity-50';
const primary =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 py-2 text-md font-medium text-accent-contrast aria-disabled:opacity-50';
const ghost =
  'inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-md text-text-muted underline-offset-4 hover:bg-surface-raised hover:text-text hover:underline aria-disabled:opacity-50';

/** Ist ein gekoppeltes iPad gerade verbunden? Start aus `GET /devices`, danach `device.connection` (§11.6). */
export function useIpadConnected(client: SyncClient | null): boolean {
  const devices = useDevices();
  const [live, setLive] = useState<boolean | null>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!client) return;
    return client.onEvent('device.connection', (d) => {
      if (d.client !== 'ipad') return;
      setLive(d.connected);
      void queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
    });
  }, [client, queryClient]);
  const fromRest = devices.data?.some((d) => d.kind === 'ipad' && d.connected) ?? false;
  return live ?? fromRest;
}

function Dot({ filled, record = false }: { filled: boolean; record?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2.5 shrink-0 rounded-full ${
        record ? 'bg-record' : filled ? 'bg-text-muted' : 'border-2 border-text-muted'
      }`}
    />
  );
}

export interface StatusBarProps {
  session: Session;
  client: SyncClient | null;
  moduleId: string;
  /** `GET /sessions/{id}` hat einen Stand, aber die Live-Verbindung steht nicht */
  offline: boolean;
  actions: SessionActions;
}

export function StatusBar({ session, client, moduleId, offline, actions }: StatusBarProps) {
  const now = useNow(1000);
  const ipad = useIpadConnected(client);
  const settings = useSettings();
  const active = isActive(session);
  const running = session.state === 'laeuft';
  const paused = session.state === 'pausiert';
  const startedAt = session.started_at ? Date.parse(session.started_at) : null;
  const endedAt = session.ended_at ? Date.parse(session.ended_at) : null;

  // Auto-Stopp (F-SES-03): Text und Verhalten sind festgelegt, `extend` ohne `minutes`
  const auto = useAutoStop({
    session: active ? session : null,
    lecture: settings.data?.lecture,
    events: client ?? undefined,
  });

  let record: { label: string; time: string | null; dot: 'rec' | 'hollow' | 'filled' };
  if (running) {
    record = {
      label: 'REC',
      time: now !== null && startedAt !== null ? formatElapsed(now - startedAt) : null,
      dot: 'rec',
    };
  } else if (paused) {
    // Die Pause kennt der Core nicht als Zeitraum, darum zeigt sie keine Dauer (wie die Start-Karte)
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
          <span className="font-medium">{record.label}</span>
          {record.time ? (
            <span className="tabular-nums" data-testid="elapsed">
              <span className="sr-only">Laufzeit </span>
              {record.time}
            </span>
          ) : null}
          {/* Zustand für Screenreader als ruhige Statusmeldung */}
          <span role="status" className="sr-only">
            {running
              ? 'Die Session läuft.'
              : paused
                ? 'Die Session ist pausiert.'
                : record.label === 'Beendet'
                  ? 'Die Session ist beendet.'
                  : 'Die Session läuft nicht.'}
          </span>
        </p>

        <MarkerControls sessionId={session.id} active={active} startedAt={startedAt} client={client} />

        <p className="flex items-center gap-2 text-text-muted" data-testid="ipad-status">
          <Dot filled={ipad} />
          <span>iPad</span>
          <span className="sr-only">{ipad ? 'verbunden' : 'nicht verbunden'}</span>
        </p>
        <p className="flex items-center gap-2 text-text-muted" data-testid="live-status">
          <Dot filled={!offline} />
          <span>{offline ? 'Offline' : 'Live'}</span>
          <span className="sr-only">
            {offline ? 'Keine Live-Verbindung, Stand womöglich veraltet' : 'Live-Verbindung'}
          </span>
        </p>

        {active ? (
          <AutoStopHint
            status={auto.status}
            extendMinutes={settings.data?.lecture.auto_stop_extend_min ?? 15}
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
                onClick={() => !busy && void actions.run('stop')}
              >
                {actions.busy === 'stop' ? 'Wird beendet …' : 'Beenden'}
              </button>
            </>
          ) : (
            <>
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
      {error ? (
        <p role="alert" className="px-3 pb-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </footer>
  );
}
