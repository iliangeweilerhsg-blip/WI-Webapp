'use client';

// Daten des Heute-Bildschirms: Sessions und Termine des Tages per REST, laufend gehalten durch `session.updated`
// vom Sync-Client (VERTRAEGE §11.6). Ereignisse werden nicht nachgeliefert: Nach einer Unterbrechung lädt die
// Ansicht neu.
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarEventListSchema, type CalendarEvent, type Module, type Session } from '@sg/shared';
import { apiGet } from '../../lib/api.ts';
import { CALENDAR_KEY, addDays, dayKey, startOfDay } from '../../lib/calendar.ts';
import { useHydrationSafe } from '../../lib/hydrated.ts';
import { useModules } from '../../lib/modules.ts';
import { applyActiveSession, listSessions, mergeSession } from '../../lib/sessions.ts';
import type { SyncClient } from '../../lib/sync/client.ts';
import type { ConnectionState } from '../../lib/sync/types.ts';
import { useSyncClient } from '../../lib/sync/SyncProvider.tsx';

const SESSIONS_KEY = ['sessions', 'heute'] as const;

/** Zustände, in denen die Live-Verbindung steht oder gerade aufgebaut wird (kein Hinweis nötig) */
const LIVE_OR_PENDING: readonly ConnectionState[] = ['idle', 'acquiring', 'connecting', 'syncing', 'online'];

/** So lange darf der Verbindungsaufbau dauern, bevor die Ansicht ihn wie „offline“ behandelt */
export const CONNECT_STALL_MS = 10_000;

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

/** So oft fragt eine Ansicht ohne Live-Verbindung nach (Ereignisse kommen dann nicht an) */
export const POLL_MS = 30_000;

/**
 * Verbindungszustand des Sync-Clients. `live`: Ereignisse kommen an. `hint`: Der letzte Stand ist womöglich veraltet,
 * das sagt die Ansicht. Ein anderer Tab als Leader (`other_tab`) ist nicht live, braucht aber keinen Hinweis (das zeigt
 * `OtherTabBanner`); `otherTab` ist dann `true`. Ein Verbindungsaufbau, der länger als `CONNECT_STALL_MS` hängt, gilt wie
 * offline.
 *
 * `online` ist der STABILE Wert für das Nachfragen (`refetchInterval`): Er ändert sich nur beim Wechsel von/nach
 * `online`. `live` springt bei blockiertem WebSocket zwischen `connecting` und `backoff` und würde den Timer immer
 * wieder neu starten, sodass nie nachgefragt wird.
 */
export function useLiveState(client: SyncClient | null): {
  live: boolean;
  hint: boolean;
  online: boolean;
  otherTab: boolean;
} {
  const [state, setState] = useState<ConnectionState>(client?.connectionState ?? 'idle');
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!client) return;
    setState(client.connectionState);
    return client.onEvent('connection', (c) => setState(c.state));
  }, [client]);
  useEffect(() => {
    setStalled(false);
    if (state !== 'connecting') return;
    const timer = window.setTimeout(() => setStalled(true), CONNECT_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [state]);
  // Ohne Client (Server-Render, erster Paint) gibt es noch nichts zu melden und nichts nachzufragen
  if (client === null) return { live: true, hint: false, online: true, otherTab: false };
  const online = state === 'online';
  if (stalled) return { live: false, hint: true, online, otherTab: false };
  if (state === 'other_tab') return { live: false, hint: false, online, otherTab: true };
  const live = LIVE_OR_PENDING.includes(state);
  return { live, hint: !live, online, otherTab: false };
}

export interface TodayData {
  sessions: Session[];
  events: CalendarEvent[];
  modules: Module[];
  /** Erster Abruf läuft noch */
  loading: boolean;
  /** Fehler des letzten Abrufs; der letzte gute Stand bleibt in `sessions` */
  error: unknown;
  /** Es gibt schon einen Stand (auch nach dem Tageswechsel der vom Vortag, bis der neue da ist) */
  hasData: boolean;
  /** Zeitpunkt des letzten erfolgreichen Abrufs bzw. Ereignisses (ms) */
  updatedAt: number;
  live: boolean;
  /** Hinweis „keine Live-Verbindung“ zeigen */
  hint: boolean;
  /** Dieser Tab ist Folge-Tab: Ein anderer Tab hält die Sync-Leader-Rolle */
  otherTab: boolean;
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
    placeholderData: keepPreviousData,
    select: (page) => page.items.filter((event) => event.deleted_at === null),
  });
  const safe = useHydrationSafe(query);
  return { events: safe.data ?? [], error: safe.error, isPending: safe.isPending, refetch: safe.refetch };
}

export function useTodayData(now: number | null): TodayData {
  const client = useQueryClient();
  const sync = useSyncClient();
  const { live, hint, online, otherTab } = useLiveState(sync);
  const dayStart = now === null ? null : startOfDay(new Date(now)).getTime();
  const range = useMemo(() => (dayStart === null ? null : dayRange(dayStart)), [dayStart]);
  const modules = useModules();
  const events = useEvents(range);

  // Neuere Fassungen, die WÄHREND eines laufenden Abrufs eintreffen (Ereignis oder Antwort einer Aktion), mischt dieser
  // Abruf ein: Seine Antwort kann älter sein als sie. Der Puffer gilt nur für diesen Abruf und wird danach verworfen;
  // sonst käme eine inzwischen gelöschte oder verschobene Session über ihn zurück.
  const inflight = useRef(new Set<Map<string, Session>>());

  const query = useQuery({
    queryKey: [...SESSIONS_KEY, range?.key ?? null],
    enabled: range !== null,
    placeholderData: keepPreviousData,
    // Ohne Live-Verbindung kommen keine Ereignisse; dann alle 30 s nachfragen (an `online` gebunden, siehe useLiveState)
    refetchInterval: online ? false : POLL_MS,
    queryFn: async ({ signal }) => {
      if (!range) return [];
      const during = new Map<string, Session>();
      inflight.current.add(during);
      try {
        const [today, active] = await Promise.all([
          listSessions({ from: range.from, to: range.to }, signal),
          // Eine laufende Session vom Vortag gehört auch dazu (F-SES-05)
          listSessions({ states: ['laeuft', 'pausiert'], limit: 10 }, signal),
        ]);
        let merged = today;
        for (const s of active) merged = mergeSession(merged, s, range);
        for (const s of during.values()) merged = mergeSession(merged, s, range);
        return merged;
      } finally {
        inflight.current.delete(during);
      }
    },
  });
  const lastOk = useRef(0);
  if (query.dataUpdatedAt > lastOk.current) lastOk.current = query.dataUpdatedAt;
  const safe = useHydrationSafe(query);
  const sessionsKey = useMemo(() => [...SESSIONS_KEY, range?.key ?? null], [range?.key]);

  const apply = useCallback(
    (session: Session) => {
      applyActiveSession(client, session);
      if (!range) return;
      for (const during of inflight.current) {
        const known = during.get(session.id);
        if (!known || Date.parse(session.updated_at) >= Date.parse(known.updated_at))
          during.set(session.id, session);
      }
      client.setQueryData<Session[]>(sessionsKey, (old) => (old ? mergeSession(old, session, range) : old));
    },
    [client, range, sessionsKey],
  );

  // `session.updated` übernehmen; nach einer Unterbrechung der Verbindung neu laden
  useEffect(() => {
    if (!sync || !range) return;
    const offUpdated = sync.onEvent('session.updated', apply);
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
    hasData: safe.data !== undefined,
    updatedAt: lastOk.current,
    live,
    hint,
    otherTab,
    apply,
    refetch,
  };
}
