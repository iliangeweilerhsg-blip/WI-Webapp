// REST-Funktionen für Sessions (VERTRAEGE §7.2): Stopp und Verlängerung (T1-07), Liste und Zustandswechsel (T1-03).
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  SessionListSchema,
  SessionSchema,
  SessionStartResultSchema,
  type Session,
  type SessionStartResult,
  type StopReason,
} from '@sg/shared';
import { ApiRequestError, apiGet, apiSend } from './api.ts';
import { useConnectionState } from './recorder/leader-state.ts';
import { useSyncClient } from './sync/SyncProvider.tsx';
import { uuidv7 } from './uuid.ts';

/** `POST /sessions/{id}/stop`. Ohne Grund gilt `manuell`. Gleicher Zielzustand ist kein Fehler (§9.1). */
export function stopSession(id: string, reason?: StopReason): Promise<Session> {
  return apiSend('POST', `/sessions/${id}/stop`, SessionSchema, {
    body: reason ? { reason } : {},
  });
}

/**
 * `POST /sessions/{id}/extend` (§9.4): `auto_stop_extended_until = max(jetzt, bisheriger Wert) + minutes`.
 * Ohne `minutes` nimmt der Core `lecture.auto_stop_extend_min`. 409 `session_not_active`, wenn die Session nicht läuft.
 */
export function extendSession(id: string, minutes?: number): Promise<Session> {
  return apiSend('POST', `/sessions/${id}/extend`, SessionSchema, {
    body: minutes === undefined ? {} : { minutes },
  });
}

/**
 * Schalter für das Live-Dashboard (T1-04, Route `/session`). Mit `true` zeigt die Start-Karte den Link „Zur Vorlesung“
 * und leitet der Start (F-SES-02: „Dashboard öffnet sich im Live-Layout“) automatisch weiter.
 */
export const SESSION_DASHBOARD_AVAILABLE = true;

/** Wird von Tests überschrieben; sonst gilt `SESSION_DASHBOARD_AVAILABLE` */
export function isDashboardAvailable(): boolean {
  return SESSION_DASHBOARD_AVAILABLE;
}

/** Pfad des Live-Dashboards (T1-04, `apps/web/src/app/session/**`). Query-Parameter statt dynamischem Segment (§5). */
export function sessionHref(id: string): string {
  return `/session?id=${encodeURIComponent(id)}`;
}

/** `GET /sessions/{id}`: 404 `session_not_found` kommt als `ApiRequestError` mit `status` 404. */
export function getSession(id: string, signal?: AbortSignal): Promise<Session> {
  return apiGet(`/sessions/${encodeURIComponent(id)}`, SessionSchema, { signal });
}

type SessionFilter = {
  from?: Date;
  to?: Date;
  states?: readonly string[];
  limit?: number;
  moduleId?: string;
  cursor?: string | null;
};

async function fetchSessionPage(filter: SessionFilter, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (filter.from) params.set('from', filter.from.toISOString());
  if (filter.to) params.set('to', filter.to.toISOString());
  if (filter.states?.length) params.set('state', filter.states.join(','));
  if (filter.moduleId) params.set('module_id', filter.moduleId);
  if (filter.cursor) params.set('cursor', filter.cursor);
  params.set('limit', String(filter.limit ?? 200));
  const page = await apiGet(`/sessions?${params.toString()}`, SessionListSchema, { signal });
  return { items: page.items.filter((item) => item.deleted_at === null), next: page.next_cursor };
}

/** `GET /sessions` mit Zeitraum (`from` einschließlich, `to` ausschließlich), Zuständen und/oder Modul (§7.2). Eine Seite. */
export async function listSessions(filter: SessionFilter, signal?: AbortSignal): Promise<Session[]> {
  return (await fetchSessionPage(filter, signal)).items;
}

/** So viele Seiten (je 200) lädt `listSessionsAll` höchstens */
const MAX_SESSION_PAGES = 5;

/** Wie `listSessions`, folgt aber dem Cursor (der Core sortiert aufsteigend und kennt keine andere Reihenfolge) */
export async function listSessionsAll(filter: SessionFilter, signal?: AbortSignal): Promise<Session[]> {
  const items: Session[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_SESSION_PAGES; page += 1) {
    const result = await fetchSessionPage({ ...filter, cursor }, signal);
    items.push(...result.items);
    cursor = result.next;
    if (!cursor) break;
  }
  return items;
}

/** Vorbei und aufgenommen: Den Rückblick gibt es für `beendet` und `verarbeitet` */
export const FINISHED_STATES = ['beendet', 'verarbeitet'] as const;

export function isFinished(session: Pick<Session, 'state'>): boolean {
  return (FINISHED_STATES as readonly string[]).includes(session.state);
}

/** Neueste zuerst (nach Startzeit; gleiche Zeit nach ID) */
export function newestFirst(sessions: readonly Session[]): Session[] {
  return [...sessions].sort((a, b) => sessionAnchor(b) - sessionAnchor(a) || b.id.localeCompare(a.id));
}

/** Dauer von Start bis Ende in ms; `null`, solange eines von beiden fehlt. Pausen sind nicht abgezogen. */
export function sessionDurationMs(session: Pick<Session, 'started_at' | 'ended_at'>): number | null {
  const ms = time(session.ended_at) - time(session.started_at);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** „45 Min.“, „1 Std.“, „1 Std. 30 Min.“; unter einer Minute „< 1 Min.“ */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '< 1 Min.';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} Min.`;
  return m === 0 ? `${h} Std.` : `${h} Std. ${m} Min.`;
}

/** „VL 7 · Normalformen“; ohne Nummer und Titel der Foliensatz, sonst „Vorlesung“ */
export function sessionLabel(session: Pick<Session, 'number' | 'title'>, deckTitle?: string | null): string {
  const name = session.title?.trim() || deckTitle?.trim() || null;
  const parts = [session.number !== null ? `VL ${session.number}` : null, name].filter(
    (p): p is string => p !== null,
  );
  return parts.join(' · ') || 'Vorlesung';
}

/** Abfrage: vergangene Vorlesungen eines Moduls, neueste zuerst */
export function useModuleSessions(moduleId: string) {
  return useQuery({
    queryKey: ['sessions', 'modul', moduleId],
    // Der Core filtert die Zustände schon, damit geplante Termine des Semesters keine Seiten belegen
    queryFn: ({ signal }) => listSessionsAll({ moduleId, states: FINISHED_STATES }, signal),
    select: (items) => newestFirst(items.filter(isFinished)),
  });
}

/**
 * `POST /sessions/{id}/start` (Serverzeit). Eine andere aktive Session beendet der Core vorher und liefert sie als
 * `ended_session` mit. Der Doppel-Tipp auf eine laufende Session ist kein Fehler (§9.1).
 */
export function startSession(id: string, startedFrom: 'mac' | 'ipad' = 'mac'): Promise<SessionStartResult> {
  return apiSend('POST', `/sessions/${id}/start`, SessionStartResultSchema, {
    body: { started_from: startedFrom },
  });
}

/** `POST /sessions/{id}/pause` */
export function pauseSession(id: string): Promise<Session> {
  return apiSend('POST', `/sessions/${id}/pause`, SessionSchema);
}

/** `POST /sessions/{id}/resume` */
export function resumeSession(id: string): Promise<Session> {
  return apiSend('POST', `/sessions/${id}/resume`, SessionSchema);
}

const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN);

/** Zeitpunkt, nach dem `GET /sessions?from&to` filtert: `coalesce(started_at, planned_starts_at, created_at)` (§7.2). */
export function sessionAnchor(session: Session): number {
  return time(session.started_at ?? session.planned_starts_at ?? session.created_at);
}

export function isActive(session: Pick<Session, 'state'>): boolean {
  return session.state === 'laeuft' || session.state === 'pausiert';
}

/**
 * Wendet eine neue Fassung einer Session (Ereignis `session.updated` oder Antwort einer Aktion) auf eine Liste an.
 * Ältere Fassungen (`updated_at` kleiner als die bekannte) ändern nichts; dieselbe Liste kommt dann unverändert
 * zurück. Gelöschte Sessions verschwinden. Eine unbekannte Session kommt nur hinein, wenn sie aktiv ist oder in
 * `[from, to)` liegt (Ereignisse betreffen alle Sessions, die Liste nur einen Tag).
 */
export function mergeSession(
  list: readonly Session[],
  incoming: Session,
  range: { from: Date; to: Date },
): Session[] {
  const known = list.find((s) => s.id === incoming.id);
  if (known && time(incoming.updated_at) < time(known.updated_at)) return list as Session[];
  if (incoming.deleted_at !== null)
    return known ? list.filter((s) => s.id !== incoming.id) : (list as Session[]);
  if (known) return list.map((s) => (s.id === incoming.id ? incoming : s));
  const anchor = sessionAnchor(incoming);
  const inRange = anchor >= range.from.getTime() && anchor < range.to.getTime();
  return isActive(incoming) || inRange ? [...list, incoming] : (list as Session[]);
}

// ---------------------------------------------------------------------------------------------
// Spontane Session ohne Termin (F-SES-04, Issue #120): `POST /sessions`, danach `POST /sessions/{id}/start`
// ---------------------------------------------------------------------------------------------

/** `POST /sessions` (§7.2): spontane Session im Zustand `bereit`. Die Client-ID macht Wiederholungen sicher. */
export function createSession(moduleId: string, id: string = uuidv7()): Promise<Session> {
  return apiSend('POST', '/sessions', SessionSchema, { body: { id, module_id: moduleId } });
}

/**
 * Legt eine spontane Session an und startet sie. Ist die ID schon vergeben (`session_exists`, z. B. nach einem
 * gescheiterten Start und erneutem Tipp), wird nur noch gestartet. Der Core beendet eine andere aktive Session dabei (§9.1).
 */
export async function createAndStartSession(
  moduleId: string,
  id: string = uuidv7(),
): Promise<SessionStartResult> {
  try {
    await createSession(moduleId, id);
  } catch (cause) {
    if (!(cause instanceof ApiRequestError && cause.code === 'session_exists')) throw cause;
  }
  return startSession(id);
}

/** Die laufende oder pausierte Session, falls es eine gibt (`GET /sessions?state=laeuft,pausiert`) */
export async function findActiveSession(signal?: AbortSignal): Promise<Session | null> {
  const active = await listSessions({ states: ['laeuft', 'pausiert'], limit: 10 }, signal);
  return active.find(isActive) ?? null;
}

export const ACTIVE_SESSION_KEY = ['sessions', 'active'] as const;

/** `DELETE /sessions/{id}` (Papierkorb; 409 `session_active`, wenn sie läuft oder pausiert) */
export function deleteSession(id: string): Promise<void> {
  return apiSend('DELETE', `/sessions/${encodeURIComponent(id)}`, null);
}

/** Abstand der Abfrage ohne Live-Verbindung, solange eine Session aktiv ist */
export const ACTIVE_POLL_MS = 10_000;
/** … und ohne aktive Session */
export const ACTIVE_IDLE_POLL_MS = 30_000;

/**
 * Übernimmt eine neue Fassung in den Cache `ACTIVE_SESSION_KEY` (Ereignis `session.updated` oder Antwort einer
 * Aktion bzw. des Auto-Stopps). Dieselbe Session: Ältere Fassungen (`updated_at`) ändern nichts, eine nicht mehr
 * aktive oder gelöschte Fassung leert den Cache. Andere Session: Eine aktive Fassung ersetzt die bekannte nur, wenn ihr
 * `updated_at` nicht älter ist (sonst ist sie veraltet, z. B. eine späte Antwort für A, nachdem B gestartet wurde).
 * Ist der Cache noch nicht geladen, liefert der Abruf den Stand.
 */
export function applyActiveSession(client: QueryClient, incoming: Session): void {
  client.setQueryData<Session | null>(ACTIVE_SESSION_KEY, (old) => {
    if (old === undefined) return old;
    const active = isActive(incoming) && incoming.deleted_at === null;
    if (old && old.id === incoming.id) {
      const next = newerSession(old, incoming);
      if (next !== incoming) return old;
      return active ? incoming : null;
    }
    if (!active) return old;
    if (old && time(incoming.updated_at) < time(old.updated_at)) return old;
    return incoming;
  });
}

/**
 * Abfrage der aktiven Session, live gehalten durch `session.updated` (z. B. ein Start vom iPad). Nach einer
 * Unterbrechung der Verbindung oder einem Wechsel des Leaders wird neu geladen. Nachgefragt wird nur ohne
 * Live-Verbindung (Folge-Tab, `backoff`, `failed`): alle 10 s mit aktiver Session, sonst alle 30 s (§11.8). Das gilt
 * auch im Hintergrund (`refetchIntervalInBackground`) und ohne Netz: Der Core ist lokal, darum pausiert React Query
 * Abfragen nie (`networkMode: 'always'` gilt app-weit, `lib/query.tsx`). Das Intervall hängt an `online`, nicht an `live`: `live`
 * springt bei blockiertem WebSocket zwischen `connecting` und `backoff` und startete den Timer immer wieder neu.
 */
export function useActiveSession() {
  const client = useQueryClient();
  const sync = useSyncClient();
  const online = useConnectionState(sync) === 'online';
  useEffect(() => {
    if (!sync) return;
    const refetch = () => void client.invalidateQueries({ queryKey: ACTIVE_SESSION_KEY });
    const offUpdated = sync.onEvent('session.updated', (incoming) => {
      applyActiveSession(client, incoming);
      // Kam das Ereignis während eines Abrufs, kann dessen Antwort älter sein und das Ereignis überschreiben. Online
      // fragt niemand nach, der falsche Stand bliebe stehen: darum neu abrufen (bricht den laufenden Abruf ab).
      if (client.isFetching({ queryKey: ACTIVE_SESSION_KEY, exact: true }) > 0) refetch();
    });
    let wasDown = sync.connectionState !== 'online';
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
  }, [sync, client]);
  return useQuery({
    queryKey: ACTIVE_SESSION_KEY,
    queryFn: ({ signal }) => findActiveSession(signal),
    refetchInterval: (query) => (online ? false : query.state.data ? ACTIVE_POLL_MS : ACTIVE_IDLE_POLL_MS),
    refetchIntervalInBackground: true,
  });
}

const LAST_MODULE_KEY = 'sg.session.lastModule';

/** Modul der zuletzt gestarteten Session (nur dieser Browser; ohne Speicher `null`) */
export function readLastModuleId(): string | null {
  try {
    return window.localStorage.getItem(LAST_MODULE_KEY);
  } catch {
    return null;
  }
}

export function rememberLastModuleId(moduleId: string): void {
  try {
    window.localStorage.setItem(LAST_MODULE_KEY, moduleId);
  } catch {
    // Speicher gesperrt: Die Vorauswahl fällt auf die Sessions des Tages zurück
  }
}

/**
 * Übernimmt eine neue Fassung EINER Session (Ereignis `session.updated` oder Antwort einer Aktion): Eine ältere
 * Fassung (`updated_at` kleiner als die bekannte) wird verworfen, Gleichstand angenommen (wie `mergeSession`).
 * Ohne bekannte Fassung gilt die neue.
 */
export function newerSession(known: Session | undefined | null, incoming: Session): Session {
  if (!known || known.id !== incoming.id) return incoming;
  return time(incoming.updated_at) < time(known.updated_at) ? known : incoming;
}
