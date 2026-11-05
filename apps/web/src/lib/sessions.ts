// REST-Funktionen für Sessions (VERTRAEGE §7.2): Stopp und Verlängerung (T1-07), Liste und Zustandswechsel (T1-03).
import {
  SessionListSchema,
  SessionSchema,
  SessionStartResultSchema,
  type Session,
  type SessionStartResult,
  type StopReason,
} from '@sg/shared';
import { apiGet, apiSend } from './api.ts';

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
 * SCHALTER FÜR T1-04: Solange die Route `/session` nicht existiert, bleibt die Start-Karte nach dem Start auf
 * „läuft“ und zeigt nur den Link „Zur Vorlesung“. T1-04 setzt das auf `true`; dann leitet der Start (F-SES-02:
 * „Dashboard öffnet sich im Live-Layout“) automatisch weiter.
 */
export const SESSION_DASHBOARD_AVAILABLE = false;

/** Wird von Tests überschrieben; sonst gilt `SESSION_DASHBOARD_AVAILABLE` */
export function isDashboardAvailable(): boolean {
  return SESSION_DASHBOARD_AVAILABLE;
}

/** Pfad des Live-Dashboards (T1-04, `apps/web/src/app/session/**`). Query-Parameter statt dynamischem Segment (§5). */
export function sessionHref(id: string): string {
  return `/session?id=${encodeURIComponent(id)}`;
}

/** `GET /sessions` mit Zeitraum (`from` einschließlich, `to` ausschließlich) und/oder Zuständen (§7.2). Eine Seite. */
export async function listSessions(
  filter: { from?: Date; to?: Date; states?: readonly string[]; limit?: number },
  signal?: AbortSignal,
): Promise<Session[]> {
  const params = new URLSearchParams();
  if (filter.from) params.set('from', filter.from.toISOString());
  if (filter.to) params.set('to', filter.to.toISOString());
  if (filter.states?.length) params.set('state', filter.states.join(','));
  params.set('limit', String(filter.limit ?? 200));
  const page = await apiGet(`/sessions?${params.toString()}`, SessionListSchema, { signal });
  return page.items.filter((item) => item.deleted_at === null);
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
