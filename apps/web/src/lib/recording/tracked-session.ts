'use client';
// Die Session, der der Recorder folgt (Plan 210, E2): die aktive Session und, nach ihrem Ende, dieselbe weiter, bis
// eine neue aktiv wird. So lebt der Recorder nach „Beenden“ weiter, bis alles hochgeladen ist („Wird gesichert …“).
import { useMemo, useState } from 'react';
import type { Session } from '@sg/shared';
import { useActiveSession } from '../sessions.ts';

export type TrackedPhase = 'laeuft' | 'pausiert' | 'andere';

export interface TrackedSession {
  /** Letzte bekannte Fassung. Nach dem Ende bleibt die letzte aktive Fassung stehen. */
  session: Session;
  phase: TrackedPhase;
}

/** Wie `useTrackedSession`, dazu: Die Abfrage der aktiven Session hat noch keine Antwort (`isPending`). */
export function useTrackedSessionState(): { tracked: TrackedSession | null; pending: boolean } {
  const query = useActiveSession();
  const data = query.data;
  // Letzte aktive Fassung merken (abgeleiteter Zustand beim Rendern, kein Ref)
  const [last, setLast] = useState<Session | null>(null);
  if (data && data !== last) setLast(data);
  const tracked = useMemo<TrackedSession | null>(() => {
    const session = data ?? last;
    if (!session) return null;
    return { session, phase: data ? (data.state === 'pausiert' ? 'pausiert' : 'laeuft') : 'andere' };
  }, [data, last]);
  return { tracked, pending: query.isPending };
}

/**
 * Die aktive Session; nach ihrem Ende dieselbe mit `phase = 'andere'`, bis eine neue aktiv wird. Lädt die Session
 * bewusst NICHT per ID nach (`GET /sessions/{id}`): Der Stand kommt aus `useActiveSession`.
 */
export function useTrackedSession(): TrackedSession | null {
  return useTrackedSessionState().tracked;
}
