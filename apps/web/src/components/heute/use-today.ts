'use client';

// Daten des Heute-Bildschirms: Sessions und Termine des Tages per REST, laufend gehalten durch `session.updated`
// vom Sync-Client (VERTRAEGE §11.6). Ereignisse werden nicht nachgeliefert: Nach einer Unterbrechung lädt die
// Ansicht neu.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarEventListSchema, type CalendarEvent, type Module, type Session } from '@sg/shared';
import { apiGet } from '../../lib/api.ts';
import { CALENDAR_KEY, addDays, dayKey, startOfDay } from '../../lib/calendar.ts';
import { useHydrationSafe } from '../../lib/hydrated.ts';
import { useModules } from '../../lib/modules.ts';
import { listSessions, mergeSession } from '../../lib/sessions.ts';
import type { SyncClient } from '../../lib/sync/client.ts';
import type { ConnectionState } from '../../lib/sync/types.ts';
import { useSyncClient } from '../../lib/sync/SyncProvider.tsx';

const SESSIONS_KEY = ['sessions', 'heute'] as const;

/** Zustände, in denen die Live-Verbindung steht oder gerade aufgebaut wird (kein Hinweis nötig) */
const LIVE_OR_PENDING: readonly ConnectionState[] = ['idle', 'acquiring', 'connecting', 'syncing', 'online'];

export interface DayRange {
  from: Date;
  to: Date;
  key: string;
}

/** Aktuelle Zeit, auf `intervalMs` genau neu gelesen. Beim Server-Render und beim Hydratisieren `null`. */
export function useNow(intervalMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Der Kalendertag (Ortszeit), der mit `dayStart` (ms) beginnt */
export function dayRange(dayStart: number): DayRange {
  const from = new Date(dayStart);
  return { from, to: addDays(from, 1), key: dayKey(from) };
}

/** Verbindungszustand des Sync-Clients: `live` = Ereignisse kommen an; sonst bleibt der letzte Stand stehen. */
export function useLiveState(client: SyncClient | null): { live: boolean } {
  const [state, setState] = useState<ConnectionState>(client?.connectionState ?? 'idle');
  useEffect(() => {
    if (!client) return;
    setState(client.connectionState);
    return client.onEvent('connection', (c) => setState(c.state));
  }, [client]);
  // Ohne Client (Server-Render, erster Paint) gibt es noch nichts zu melden
  return { live: client === null || LIVE_OR_PENDING.includes(state) };
}

export interface TodayData {
  sessions: Session[];
  events: CalendarEvent[];
  modules: Module[];
  /** Erster Abruf läuft noch */
  loading: boolean;
  /** Fehler des letzten Abrufs; der letzte gute Stand bleibt in `sessions` */
  error: unknown;
  /** Zeitpunkt des letzten erfolgreichen Abrufs bzw. Ereignisses (ms) */
  updatedAt: number;
  live: boolean;
  /** Neue Fassung einer Session übernehmen (Antwort einer Aktion); ältere Fassungen werden ignoriert */
  apply: (session: Session) => void;
  refetch: () => void;
}

function useEvents(range: DayRange | null) {
  const query = useQuery({
    queryKey: [...CALENDAR_KEY, 'heute', range?.key ?? null],
    enabled: range !== null,
    queryFn: ({ signal }) =>
      apiGet(
        `/calendar/events?from=${encodeURIComponent(range?.from.toISOString() ?? '')}&to=${encodeURIComponent(range?.to.toISOString() ?? '')}&limit=200`,
        CalendarEventListSchema,
        { signal },
      ),
    select: (page) => page.items.filter((event) => event.deleted_at === null),
  });
  const safe = useHydrationSafe(query);
  return { events: safe.data ?? [], error: safe.error, isPending: safe.isPending, refetch: safe.refetch };
}

export function useTodayData(now: number | null): TodayData {
  const client = useQueryClient();
  const sync = useSyncClient();
  const { live } = useLiveState(sync);
  const dayStart = now === null ? null : startOfDay(new Date(now)).getTime();
  const range = useMemo(() => (dayStart === null ? null : dayRange(dayStart)), [dayStart]);
  const modules = useModules();
  const events = useEvents(range);

  // Ereignisse, die vor dem ersten Abruf eintreffen, gehen nicht verloren: Der Abruf mischt sie ein
  const buffered = useRef(new Map<string, Session>());

  const query = useQuery({
    queryKey: [...SESSIONS_KEY, range?.key ?? null],
    enabled: range !== null,
    // Ohne Live-Verbindung kommen keine Ereignisse; dann alle 30 s nachfragen
    refetchInterval: live ? false : 30_000,
    queryFn: async ({ signal }) => {
      if (!range) return [];
      const [today, active] = await Promise.all([
        listSessions({ from: range.from, to: range.to }, signal),
        // Eine laufende Session vom Vortag gehört auch dazu (F-SES-05)
        listSessions({ states: ['laeuft', 'pausiert'], limit: 10 }, signal),
      ]);
      let merged = today;
      for (const s of active) merged = mergeSession(merged, s, range);
      for (const s of buffered.current.values()) merged = mergeSession(merged, s, range);
      return merged;
    },
  });
  const safe = useHydrationSafe(query);
  const sessionsKey = useMemo(() => [...SESSIONS_KEY, range?.key ?? null], [range?.key]);

  const apply = useCallback(
    (session: Session) => {
      if (!range) return;
      client.setQueryData<Session[]>(sessionsKey, (old) => (old ? mergeSession(old, session, range) : old));
    },
    [client, range, sessionsKey],
  );

  // `session.updated` übernehmen; nach einer Unterbrechung der Verbindung neu laden
  useEffect(() => {
    if (!sync || !range) return;
    const offUpdated = sync.onEvent('session.updated', (session) => {
      buffered.current.set(session.id, session);
      apply(session);
    });
    let wasDown = sync.connectionState !== 'online';
    const refetch = () => void client.invalidateQueries({ queryKey: SESSIONS_KEY });
    const offConnection = sync.onEvent('connection', (c) => {
      if (c.state === 'online') {
        if (wasDown) refetch();
        wasDown = false;
      } else if (c.state !== 'syncing') {
        wasDown = true;
      }
    });
    const offLeader = sync.onEvent('leader.changed', refetch);
    return () => {
      offUpdated();
      offConnection();
      offLeader();
    };
  }, [sync, range, apply, client]);

  const refetch = useCallback(() => void client.invalidateQueries({ queryKey: SESSIONS_KEY }), [client]);

  return {
    sessions: safe.data ?? [],
    events: events.events,
    modules: modules.data ?? [],
    loading: safe.isPending || events.isPending,
    error: safe.error ?? events.error,
    updatedAt: query.dataUpdatedAt,
    live,
    apply,
    refetch,
  };
}
