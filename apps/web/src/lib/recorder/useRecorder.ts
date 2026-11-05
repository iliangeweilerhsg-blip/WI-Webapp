'use client';
// React-Hook über dem Recorder. Keine Oberfläche: das Dashboard (T1-04) zeigt Status und Hinweise.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AudioRecorder, type RecorderOptions, type SessionEventSource } from './recorder.ts';
import type { RecorderStatus } from './types.ts';

export interface UseRecorderResult {
  status: RecorderStatus;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const IDLE: RecorderStatus = {
  state: 'idle',
  recordingId: null,
  chunkCount: 0,
  recordedMs: 0,
  restarts: 0,
  tabHidden: false,
  wakeLock: 'inactive',
  upload: { pendingChunks: 0, shelvedChunks: 0, offline: false, retryInMs: null },
  error: null,
};
const noopSubscribe = () => () => undefined;

/**
 * Ein Recorder je `sessionId`. Der Recorder entsteht im Effekt und wird beim Aufräumen entsorgt, also auch unter
 * `<StrictMode>` (Mount, Unmount, Mount) mit je einer frischen Instanz. `sessionMs` und `events` müssen nicht
 * stabil sein: der Recorder liest immer den neuesten Wert, ihre Identität erzeugt keinen neuen Recorder.
 * Beim Entfernen der Komponente läuft die Aufnahme NICHT weiter; gepufferte Chunks lädt `resumePendingUploads` nach.
 */
export function useRecorder(options: RecorderOptions): UseRecorderResult {
  const latest = useRef(options);
  latest.current = options;
  const [recorder, setRecorder] = useState<AudioRecorder | null>(null);
  const { sessionId } = options;

  useEffect(() => {
    const events: SessionEventSource = {
      onEvent: (name, fn) => latest.current.events?.onEvent(name, fn) ?? (() => undefined),
    };
    const instance = new AudioRecorder({
      ...latest.current,
      sessionId,
      sessionMs: () => latest.current.sessionMs(),
      events,
    });
    instance.resumeUploads();
    setRecorder(instance);
    return () => {
      instance.dispose();
      setRecorder(null);
    };
  }, [sessionId]);

  const subscribe = useMemo(() => (recorder ? recorder.subscribe : noopSubscribe), [recorder]);
  const getSnapshot = useCallback(() => recorder?.getStatus() ?? IDLE, [recorder]);
  const status = useSyncExternalStore(subscribe, getSnapshot, () => IDLE);
  const start = useCallback(async () => recorder?.start(), [recorder]);
  const stop = useCallback(async () => recorder?.stop(), [recorder]);
  return { status, start, stop };
}
