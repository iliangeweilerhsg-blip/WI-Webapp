'use client';
// React-Hook über dem Recorder. Keine Oberfläche: das Dashboard (T1-04) zeigt Status und Hinweise.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AudioRecorder, type RecorderOptions } from './recorder.ts';
import type { RecorderStatus } from './types.ts';

export interface UseRecorderResult {
  status: RecorderStatus;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Ein Recorder je `sessionId`. `options.sessionMs` und `options.events` sollten stabil sein (z. B. per `useCallback`).
 * Beim Entfernen der Komponente läuft die Aufnahme NICHT weiter: der Aufrufer stoppt sie vorher bewusst.
 */
export function useRecorder(options: RecorderOptions): UseRecorderResult {
  const { sessionId, sessionMs, events } = options;
  const recorder = useMemo(
    () => new AudioRecorder({ ...options, sessionId, sessionMs, ...(events ? { events } : {}) }),
    [sessionId, sessionMs, events],
  );
  useEffect(() => {
    recorder.resumeUploads();
    return () => recorder.dispose();
  }, [recorder]);
  const status = useSyncExternalStore(recorder.subscribe, recorder.getStatus, recorder.getStatus);
  return { status, start: () => recorder.start(), stop: () => recorder.stop() };
}
