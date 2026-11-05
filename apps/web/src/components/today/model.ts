// Reine Logik des Heute-Bildschirms (07 §3.1, F-SES-02): welche Session die Start-Karte zeigt, in welchem Zustand
// sie ist und wie die Tagesliste aus Terminen und Sessions entsteht. Keine React-Abhängigkeit, damit testbar.
import type { CalendarEvent, Module, Session } from '@sg/shared';
import { KIND_LABELS } from '../../lib/calendar.ts';
import { isActive } from '../../lib/sessions.ts';

/** Ab so viel Vorlauf meldet der Core `bereit` (VERTRAEGE §9.1: 15 min vor Beginn) */
export const READY_LEAD_MS = 15 * 60_000;

/** Zustände der Start-Karte (F-SES-01/02). `verpasst` ist auch der abgeleitete Zustand (Terminende vorbei, nie gestartet). */
export type CardState =
  'bevorstehend' | 'bereit' | 'laeuft' | 'pausiert' | 'verpasst' | 'beendet' | 'verarbeitet';

/** Zustand der Session, wie der Core ihn beim nächsten Takt melden wird: ein vorbeigegangenes Terminende gilt als `verpasst`. */
export function cardState(session: Session, now: number): CardState {
  if (session.state === 'geplant' || session.state === 'bereit') {
    const end = session.planned_ends_at ? Date.parse(session.planned_ends_at) : Number.NaN;
    if (!Number.isNaN(end) && end <= now) return 'verpasst';
    return session.state === 'geplant' ? 'bevorstehend' : 'bereit';
  }
  return session.state;
}

const plannedStart = (s: Session): number => Date.parse(s.planned_starts_at ?? s.started_at ?? s.created_at);

function lastMoment(s: Session): number {
  return Date.parse(s.ended_at ?? s.planned_ends_at ?? s.planned_starts_at ?? s.created_at);
}

/**
 * Die Session für die Start-Karte: erst eine aktive (laeuft/pausiert), sonst die nächste bevorstehende bzw. bereite,
 * sonst die zuletzt vorbeigegangene (beendet, verarbeitet, nicht aufgenommen). Ohne Sessions `null`.
 */
export function pickCardSession(sessions: readonly Session[], now: number): Session | null {
  const active = sessions
    .filter(isActive)
    .sort((a, b) => Date.parse(b.started_at ?? '') - Date.parse(a.started_at ?? ''));
  if (active[0]) return active[0];

  const upcoming = sessions
    .filter((s) => {
      const state = cardState(s, now);
      return state === 'bevorstehend' || state === 'bereit';
    })
    .sort((a, b) => plannedStart(a) - plannedStart(b) || a.id.localeCompare(b.id));
  if (upcoming[0]) return upcoming[0];

  const past = sessions
    .filter((s) => !isActive(s))
    .sort((a, b) => lastMoment(b) - lastMoment(a) || a.id.localeCompare(b.id));
  return past[0] ?? null;
}

/** Eintrag der Tagesliste: ein Termin, eine Session oder beides (verknüpft über `calendar_event_id`/`session_id`). */
export interface TodayEntry {
  key: string;
  start: number | null;
  allDay: boolean;
  end: number | null;
  module: Module | null;
  /** „Datenbanksysteme · VL 7“ bzw. Terminname */
  label: string;
  room: string | null;
  event: CalendarEvent | null;
  session: Session | null;
}

/** „VL 7“ bei Vorlesungen mit Nummer (Session-`number`, VERTRAEGE §9.2), sonst die Art des Termins */
export function lectureTag(session: Session | null, event: CalendarEvent | null): string | null {
  if (session?.number != null && (event === null || event.kind === 'vorlesung'))
    return `VL ${session.number}`;
  if (event) return KIND_LABELS[event.kind];
  return null;
}

/** Name zur Anzeige: Modul · VL 7 (bzw. Art); ohne Modul der Termin- bzw. Sessiontitel */
export function entryLabel(
  module: Module | null,
  session: Session | null,
  event: CalendarEvent | null,
): string {
  const tag = lectureTag(session, event);
  const base = module?.name ?? event?.title ?? session?.title ?? 'Session';
  return tag && module ? `${base} · ${tag}` : base;
}

/** Tagesliste aus den Terminen des Tages und allen bekannten Sessions, nach Beginn sortiert (ganztägige zuerst) */
export function buildEntries(
  events: readonly CalendarEvent[],
  sessions: readonly Session[],
  modules: readonly Module[],
): TodayEntry[] {
  const moduleById = new Map(modules.map((m) => [m.id, m]));
  const byEvent = new Map<string, Session>();
  for (const s of sessions) if (s.calendar_event_id) byEvent.set(s.calendar_event_id, s);

  const used = new Set<string>();
  const entries: TodayEntry[] = [];
  for (const event of events) {
    if (event.cancelled || event.deleted_at !== null) continue;
    const session = byEvent.get(event.id) ?? sessions.find((s) => s.id === event.session_id) ?? null;
    if (session) used.add(session.id);
    const module = moduleById.get(session?.module_id ?? event.module_id ?? '') ?? null;
    entries.push({
      key: `e:${event.id}`,
      start: Date.parse(event.starts_at),
      end: Date.parse(event.ends_at),
      allDay: event.all_day,
      module,
      label: entryLabel(module, session, event),
      room: event.location?.trim() || null,
      event,
      session,
    });
  }
  for (const session of sessions) {
    if (used.has(session.id)) continue;
    const module = moduleById.get(session.module_id) ?? null;
    const end = session.ended_at ?? session.planned_ends_at;
    entries.push({
      key: `s:${session.id}`,
      // Spontane Session ohne Start: keine Uhrzeit
      start:
        (session.started_at ?? session.planned_starts_at)
          ? Date.parse((session.started_at ?? session.planned_starts_at)!)
          : null,
      end: end ? Date.parse(end) : null,
      allDay: false,
      module,
      label: session.title
        ? `${module?.name ?? 'Session'} · ${session.title}`
        : entryLabel(module, session, null),
      room: null,
      event: null,
      session,
    });
  }
  const order = (e: TodayEntry): number => e.start ?? Date.parse(e.session?.created_at ?? '') ?? 0;
  return entries.sort(
    (a, b) => Number(b.allDay) - Number(a.allDay) || order(a) - order(b) || a.key.localeCompare(b.key),
  );
}

// ---------------------------------------------------------------------------------------------
// Zeiten
// ---------------------------------------------------------------------------------------------

const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

/** „08:15“ (Ortszeit) */
export const formatClock = (ms: number): string => timeFormat.format(new Date(ms));

/** „00:42:13“: immer h:mm:ss, damit die Breite stabil bleibt */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** „in 12 min“, „in 2 h 5 min“ (aufgerundet auf volle Minuten) */
export function formatUntil(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `in ${h} h` : `in ${h} h ${m} min`;
}
