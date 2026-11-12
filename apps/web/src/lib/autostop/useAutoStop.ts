'use client';
// React-Hook über dem Auto-Stopp-Controller. Keine Oberfläche: die Hinweis-Komponente (components/autostop) zeigt ihn an,
// eingehängt wird sie vom Lead (Statusleiste, T1-04).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Session } from '@sg/shared';
import { AutoStopController, type AutoStopControllerOptions, type AutoStopSnapshot } from './controller.ts';
import type { AutoStopSettings } from './rules.ts';

export interface UseAutoStopOptions extends Pick<
  AutoStopControllerOptions,
  'events' | 'voice' | 'api' | 'now' | 'subscribeLevel'
> {
  /** Die laufende Session (`laeuft`/`pausiert`); `null` oder eine andere Phase: nichts zu tun */
  session: Session | null | undefined;
  /** `settings.lecture`; `undefined` solange die Einstellungen laden: dann bleibt der Controller still */
  lecture: AutoStopSettings | undefined;
}

export interface UseAutoStopResult extends AutoStopSnapshot {
  /** „Verlängern“ */
  extend: () => Promise<void>;
}

const IDLE: AutoStopSnapshot = {
  status: { state: 'inaktiv' },
  extending: false,
  extendError: null,
  stopping: false,
  stopError: null,
};
const noopSubscribe = () => () => undefined;

/**
 * Ein Controller je Komponente. Er entsteht im Effekt (StrictMode: Mount, Unmount, Mount ergibt je eine frische
 * Instanz) und hört auf Pegel und `session.updated`. Beim Entfernen räumt er auf; ein schon gesendeter Stopp bleibt gültig.
 */
export function useAutoStop(options: UseAutoStopOptions): UseAutoStopResult {
  const latest = useRef(options);
  latest.current = options;
  const [controller, setController] = useState<AutoStopController | null>(null);

  useEffect(() => {
    const { events, voice, api, now, subscribeLevel } = latest.current;
    const instance = new AutoStopController({ events, voice, api, now, subscribeLevel });
    instance.setSettings(latest.current.lecture ?? null);
    instance.setSession(latest.current.session ?? null);
    setController(instance);
    return () => {
      instance.dispose();
      setController(null);
    };
  }, []);

  const { session, lecture, events } = options;
  // Der Sync-Client kann nach dem Mount entstehen oder ersetzt werden: neu anmelden, sonst gehen Ereignisse verloren
  useEffect(() => controller?.setEvents(events ?? null), [controller, events]);
  useEffect(() => controller?.setSettings(lecture ?? null), [controller, lecture]);
  useEffect(() => controller?.setSession(session ?? null), [controller, session]);

  const subscribe = controller ? controller.subscribe : noopSubscribe;
  const getSnapshot = useCallback(() => controller?.getSnapshot() ?? IDLE, [controller]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => IDLE);
  const extend = useCallback(async () => controller?.extend(), [controller]);
  return { ...snapshot, extend };
}
