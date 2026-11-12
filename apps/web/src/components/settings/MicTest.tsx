'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { startLevelMeter, subscribeAudioLevel } from '../../lib/recorder';
import { useRecordingView } from '../../lib/recording';

/** So lange läuft der Test höchstens, danach gibt er das Mikrofon von selbst frei */
export const MIC_TEST_MAX_MS = 10_000;
/** Ab diesem Effektivwert gilt ein Signal als gehört (Stille liegt weit darunter) */
const HEARD_RMS = 0.01;

type TestState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'running'; level: number }
  | { kind: 'done'; heard: boolean }
  | { kind: 'error'; message: string };

function errorMessage(cause: unknown, chosen: boolean): string {
  const name = (cause as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Der Zugriff auf das Mikrofon ist verweigert. Erlaube ihn in den Einstellungen des Browsers.';
  if ((name === 'NotFoundError' || name === 'OverconstrainedError') && chosen)
    return 'Das gewählte Mikrofon wurde nicht gefunden. Ohne es nimmt die Aufnahme das Standardmikrofon. Schließe es an oder wähle ein anderes.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'Es wurde kein Mikrofon gefunden. Schließe eines an.';
  return 'Das Mikrofon lässt sich nicht öffnen. Ist es von einem anderen Programm belegt?';
}

/** Anzeige 0 bis 1: Wurzel, damit auch leise Sprache sichtbar ausschlägt */
function displayLevel(rms: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, rms)) * 1.6);
}

function hasWebAudio(): boolean {
  const g = globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown };
  return g.AudioContext !== undefined || g.webkitAudioContext !== undefined;
}

/**
 * „Mikrofon testen“ (UX-03): kurzer Pegel-Test mit dem gewählten Mikrofon. Es wird nichts aufgenommen und nichts
 * hochgeladen; der Strom geht nur an den Pegelmesser des Recorders (`startLevelMeter`) und wird danach sofort
 * geschlossen, auch wenn der Tab in den Hintergrund geht. Gesperrt, solange eine Session läuft oder pausiert (dann hält
 * ein Recorder das Mikrofon, auch in einem anderen Tab). Die Aufnahme nutzt dasselbe Mikrofon (`microphone_id`).
 */
export function MicTest({ microphoneId }: { microphoneId: string | null }) {
  const view = useRecordingView();
  const busy = view.phase !== 'andere';
  const [state, setState] = useState<TestState>({ kind: 'idle' });
  const cleanup = useRef<(() => void) | null>(null);
  const peak = useRef(0);
  const alive = useRef(true);
  const run = useRef(0);

  const finish = useCallback((next?: TestState) => {
    run.current += 1;
    cleanup.current?.();
    cleanup.current = null;
    if (!alive.current) return;
    setState(next ?? { kind: 'done', heard: peak.current >= HEARD_RMS });
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      run.current += 1;
      cleanup.current?.();
      cleanup.current = null;
    };
  }, []);

  // Eine Session beginnt, während der Test läuft: sofort freigeben, das Mikrofon gehört jetzt der Aufnahme
  useEffect(() => {
    if (busy) finish({ kind: 'idle' });
  }, [busy, finish]);

  // Tab im Hintergrund: Test abbrechen, das Mikrofon bleibt nicht unbemerkt offen
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && cleanup.current !== null) finish({ kind: 'idle' });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [finish]);

  async function start() {
    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setState({ kind: 'error', message: 'Dieser Browser kann das Mikrofon nicht öffnen.' });
      return;
    }
    if (!hasWebAudio()) {
      // Ohne Web Audio gäbe es nur Nullen und am Ende ein falsches „Kein Signal“: das Mikrofon gar nicht erst öffnen
      setState({ kind: 'error', message: 'Der Pegel lässt sich in diesem Browser nicht messen.' });
      return;
    }
    const mine = ++run.current;
    peak.current = 0;
    setState({ kind: 'starting' });
    let stream: MediaStream;
    try {
      stream = await media.getUserMedia({
        audio:
          microphoneId === null
            ? { channelCount: 1 }
            : { channelCount: 1, deviceId: { exact: microphoneId } },
      });
    } catch (cause) {
      if (run.current === mine && alive.current)
        setState({ kind: 'error', message: errorMessage(cause, microphoneId !== null) });
      return;
    }
    const release = () => {
      for (const track of stream.getTracks()) track.stop();
    };
    if (run.current !== mine || !alive.current) {
      release(); // abgebrochen, während der Browser-Dialog offen war
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      release(); // Tab ging in den Hintergrund, während der Dialog offen war
      finish({ kind: 'idle' });
      return;
    }
    let stopMeter: () => void = () => undefined;
    let unsubscribe: () => void = () => undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    cleanup.current = () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
      stopMeter();
      release();
    };
    try {
      unsubscribe = subscribeAudioLevel((sample) => {
        if (run.current !== mine) return;
        peak.current = Math.max(peak.current, sample.rms);
        setState({ kind: 'running', level: displayLevel(sample.rms) });
      });
      stopMeter = startLevelMeter(stream);
    } catch {
      finish({ kind: 'error', message: 'Der Pegel lässt sich in diesem Browser nicht messen.' });
      return;
    }
    setState({ kind: 'running', level: 0 });
    timer = setTimeout(() => finish(), MIC_TEST_MAX_MS);
  }

  const running = state.kind === 'running' || state.kind === 'starting';
  const level = state.kind === 'running' ? state.level : 0;
  return (
    <div className="space-y-2 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            state.kind === 'starting'
              ? finish({ kind: 'idle' }) // Browser-Dialog noch offen: abbrechen, kein „Kein Signal“
              : running
                ? finish()
                : void start()
          }
          className="inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface disabled:opacity-60"
        >
          {running ? 'Test beenden' : 'Mikrofon testen'}
        </button>
        {state.kind === 'running' ? (
          <div
            role="meter"
            aria-label="Pegel des Mikrofons"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level * 100)}
            className="h-3 w-48 overflow-hidden rounded-full bg-surface"
          >
            <div className="h-full bg-accent" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
        ) : null}
      </div>
      <p role="status" className="text-xs text-text-muted">
        {busy
          ? 'Gesperrt: Gerade läuft eine Session. Das Mikrofon gehört der Aufnahme.'
          : state.kind === 'starting'
            ? 'Mikrofon wird geöffnet …'
            : state.kind === 'running'
              ? 'Sprich etwas: Der Balken sollte ausschlagen. Es wird nichts aufgenommen oder gespeichert.'
              : state.kind === 'done'
                ? state.heard
                  ? 'Das Mikrofon funktioniert. Der Test ist beendet, das Mikrofon ist wieder frei.'
                  : 'Kein Signal gehört. Prüfe, ob das richtige Mikrofon gewählt und nicht stummgeschaltet ist.'
                : state.kind === 'error'
                  ? state.message
                  : 'Prüft mit dem gewählten Mikrofon den Pegel. Es wird nichts aufgenommen oder gespeichert.'}
      </p>
    </div>
  );
}
