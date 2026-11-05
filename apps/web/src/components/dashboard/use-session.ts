'use client';

// Daten des Live-Dashboards: die eine Session per REST (`GET /sessions/{id}`), live gehalten durch `session.updated`
// (VERTRAEGE §11.6) und die Antworten der Aktionen. Ältere Fassungen (`updated_at`) werden verworfen, Gleichstand
// angenommen, wie auf der Heute-Karte (`newerSession`, `mergeSession`).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@sg/shared';
import { friendlyMessage } from '../../lib/api.ts';
import { useHydrationSafe } from '../../lib/hydrated.ts';
import { getSession, newerSession, pauseSession, resumeSession, stopSession } from '../../lib/sessions.ts';
import { useSyncClient } from '../../lib/sync/SyncProvider.tsx';
import { POLL_MS, useLiveState } from '../today/use-today.ts';
import { watchReconnect } from './reconnect.ts';

const key = (id: string) => ['sessions', 'dashboard', id] as const;

export interface SessionData {
  session: Session | undefined;
  loading: boolean;
  error: unknown;
  /** Verbindung steht: Ereignisse kommen an (sonst fragt die Ansicht alle 30 s nach) */
  live: boolean;
  /** Der letzte Stand ist womöglich veraltet */
  hint: boolean;
  /** Dieser Tab folgt einem anderen (Leader) */
  otherTab: boolean;
  apply: (session: Session) => void;
  refetch: () => void;
}

export function useSessionData(id: string | null): SessionData {
  const client = useQueryClient();
  const sync = useSyncClient();
  const { live, hint, online, otherTab } = useLiveState(sync);

  const query = useQuery({
    queryKey: key(id ?? ''),
    enabled: id !== null,
    // Ohne Live-Verbindung kommen keine Ereignisse; dann alle 30 s nachfragen (an `online` gebunden, siehe useLiveState)
    refetchInterval: online ? false : POLL_MS,
    queryFn: async ({ signal }) => {
      const fetched = await getSession(id ?? '', signal);
      // Ein Ereignis, das während des Abrufs eintraf, darf die ältere Antwort nicht überschreiben
      return newerSession(client.getQueryData<Session>(key(id ?? '')), fetched);
    },
  });
  const safe = useHydrationSafe(query);

  const apply = useCallback(
    (session: Session) => {
      if (session.id !== id) return;
      client.setQueryData<Session>(key(session.id), (old) => newerSession(old, session));
    },
    [client, id],
  );

  useEffect(() => {
    if (!sync || id === null) return;
    const refetch = () => void client.invalidateQueries({ queryKey: key(id) });
    const offUpdated = sync.onEvent('session.updated', apply);
    // Nur nach einem Abbruch neu laden, nicht beim ersten Verbindungsaufbau (der Abruf beim Öffnen ist frisch)
    const offConnection = watchReconnect(sync, refetch);
    const offLeader = sync.onEvent('leader.changed', refetch);
    return () => {
      offUpdated();
      offConnection();
      offLeader();
    };
  }, [sync, id, apply, client]);

  const refetch = useCallback(() => {
    if (id !== null) void client.invalidateQueries({ queryKey: key(id) });
  }, [client, id]);

  return {
    session: safe.data,
    loading: id !== null && safe.isPending,
    error: safe.error,
    live,
    hint,
    otherTab,
    apply,
    refetch,
  };
}

export type SessionAction = 'pause' | 'resume' | 'stop';

export interface SessionActions {
  busy: SessionAction | null;
  error: string | null;
  run: (action: SessionAction) => Promise<void>;
}

/**
 * Pause, Fortsetzen und Beenden über die REST-Funktionen aus `lib/sessions.ts` (dieselben wie die Heute-Karte).
 * Ein Doppel-Tipp im selben Takt wird abgefangen; die Antwort geht über `onSession` in die Ansicht.
 */
export function useSessionActions(
  session: Session | undefined,
  onSession: (session: Session) => void,
  onRefetch: () => void,
): SessionActions {
  const [busy, setBusy] = useState<SessionAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  // Eine neue Lage macht die alte Fehlermeldung hinfällig
  useEffect(() => setError(null), [session?.id, session?.state]);

  const run = useCallback(
    async (action: SessionAction) => {
      if (!session || busyRef.current) return;
      busyRef.current = true;
      setBusy(action);
      setError(null);
      try {
        const updated =
          action === 'pause'
            ? await pauseSession(session.id)
            : action === 'resume'
              ? await resumeSession(session.id)
              : await stopSession(session.id);
        onSession(updated);
      } catch (cause) {
        setError(friendlyMessage(cause));
        // Der Zustand im Core ist womöglich ein anderer als gedacht: Ansicht auffrischen
        onRefetch();
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [session, onSession, onRefetch],
  );
  return { busy, error, run };
}
