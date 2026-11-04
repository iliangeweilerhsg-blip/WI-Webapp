import { vi } from 'vitest';
import type {
  CalendarEvent,
  CalendarEventKind,
  CalendarSource,
  IcsImportResult,
  IcsModuleSuggestion,
  IcsWarning,
} from '@sg/shared';
import { installFakeCore, type FakeCore } from './fake-core.ts';

const USER = '0190f6a2-0000-7000-8000-000000000000';
const STAMP = '2026-11-04T08:00:00Z';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let counter = 0;
const newId = () => `0190f6a2-0000-7000-8000-${String(900000 + ++counter).padStart(12, '0')}`;

export function makeSource(overrides: Partial<CalendarSource> = {}): CalendarSource {
  return {
    id: newId(),
    user_id: USER,
    created_at: STAMP,
    updated_at: STAMP,
    deleted_at: null,
    kind: 'ics_url',
    name: 'stundenplan.example.edu',
    url: 'https://stundenplan.example.edu/plan.ics',
    last_synced_at: '2026-11-04T07:30:00Z',
    last_error: null,
    readonly: true,
    event_count: 0,
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: newId(),
    user_id: USER,
    created_at: STAMP,
    updated_at: STAMP,
    deleted_at: null,
    source_id: null,
    external_uid: null,
    recurrence_id: null,
    module_id: null,
    kind: 'vorlesung',
    assigned_by: 'auto',
    title: 'Mikroökonomie I – Vorlesung',
    location: null,
    description: null,
    // Mittwoch, 4. November 2026, 10:15 Uhr in Zürich
    starts_at: '2026-11-04T09:15:00Z',
    ends_at: '2026-11-04T11:00:00Z',
    all_day: false,
    cancelled: false,
    session_id: null,
    ...overrides,
  };
}

export interface ImportPlan {
  events: CalendarEvent[];
  suggestions: IcsModuleSuggestion[];
  warnings: IcsWarning[];
}

export interface CalendarCore extends FakeCore {
  sources: CalendarSource[];
  events: CalendarEvent[];
  /** Alle Anfragen an /calendar/… (Pfad mit Query) */
  calendarRequests: { method: string; path: string; body: unknown; form: FormData | null }[];
  /** Was der nächste Import (Datei oder URL) anlegt */
  importPlan: ImportPlan;
  /** Die nächste Anfrage an /calendar/… scheitert mit diesem Fehler */
  rejectNext: null | { status: number; code: string; message: string };
}

export function summaryOf(plan: ImportPlan, source: CalendarSource): IcsImportResult {
  const withModule = plan.events.filter((e) => e.module_id !== null).length;
  return {
    source,
    counts: {
      neu: plan.events.length,
      geaendert: 0,
      entfallen: 0,
      unveraendert: 0,
      zugeordnet: withModule,
      ohne_modul: plan.events.length - withModule,
    },
    neu: [],
    geaendert: [],
    entfallen: [],
    zugeordnet: [],
    module_suggestions: plan.suggestions,
    warnings: plan.warnings,
  };
}

/**
 * Fake-Core mit Kalender: Semester und Module kommen aus `installFakeCore`, `/calendar/…` beantwortet dieser
 * In-Memory-Teil mit den Formen aus VERTRAEGE §7.1 (Termine filtern, PATCH mit Serie/einzeln, Import, Abgleich).
 */
export function installCalendarCore(
  initial: Parameters<typeof installFakeCore>[0] & {
    sources?: CalendarSource[];
    events?: CalendarEvent[];
  } = {},
): CalendarCore {
  const base = installFakeCore(initial);
  const underlying = globalThis.fetch;
  const core = base as CalendarCore;
  core.sources = structuredClone(initial.sources ?? []);
  core.events = structuredClone(initial.events ?? []);
  core.calendarRequests = [];
  core.rejectNext = null;
  core.importPlan = { events: [], suggestions: [], warnings: [] };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname.replace(/^\/api\/v1/, '');
      if (!path.startsWith('/calendar')) return underlying(input, init);
      const method = init?.method ?? 'GET';
      const form = init?.body instanceof FormData ? init.body : null;
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      core.calendarRequests.push({ method, path: path + url.search, body, form });
      if (core.down) throw new TypeError('Failed to fetch');
      if (core.rejectNext) {
        const { status, code, message } = core.rejectNext;
        core.rejectNext = null;
        return json({ error: { code, message } }, status);
      }

      if (path === '/calendar/sources' && method === 'GET') {
        const counted = core.sources.map((s) => ({
          ...s,
          event_count: core.events.filter((e) => e.source_id === s.id && !e.deleted_at).length,
        }));
        return json({ items: counted.filter((s) => !s.deleted_at), next_cursor: null });
      }
      if (path === '/calendar/sources' && method === 'POST') {
        const file = form?.get('file');
        const source = makeSource(
          file instanceof File
            ? { kind: 'ics_file', name: file.name, url: null }
            : {
                kind: 'ics_url',
                name: 'stundenplan.example.edu',
                url: String(body?.url).replace(/^webcal:/, 'https:'),
              },
        );
        core.sources.push(source);
        const events = core.importPlan.events.map((e) => ({ ...e, id: newId(), source_id: source.id }));
        core.events.push(...events);
        return json(
          summaryOf({ ...core.importPlan, events }, { ...source, event_count: events.length }),
          201,
        );
      }
      const sync = /^\/calendar\/sources\/([^/]+)\/sync$/.exec(path);
      if (sync && method === 'POST') {
        const source = core.sources.find((s) => s.id === sync[1]);
        if (!source) return json({ error: { code: 'calendar_source_not_found', message: 'x' } }, 404);
        source.last_synced_at = '2026-11-04T08:00:00Z';
        source.last_error = null;
        return json(summaryOf({ events: [], suggestions: [], warnings: [] }, source));
      }
      const sourceOne = /^\/calendar\/sources\/([^/]+)$/.exec(path);
      if (sourceOne && method === 'DELETE') {
        const source = core.sources.find((s) => s.id === sourceOne[1]);
        if (!source) return json({ error: { code: 'calendar_source_not_found', message: 'x' } }, 404);
        source.deleted_at = STAMP;
        core.events.forEach((e) => {
          if (e.source_id === source.id) e.deleted_at = STAMP;
        });
        return new Response(null, { status: 204 });
      }

      if (path === '/calendar/events' && method === 'GET') {
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        const unassigned = url.searchParams.get('unassigned') === 'true';
        const includeCancelled = url.searchParams.get('include_cancelled') === 'true';
        const items = core.events
          .filter((e) => !e.deleted_at)
          .filter((e) => includeCancelled || !e.cancelled)
          .filter((e) => !unassigned || e.module_id === null)
          .filter(
            (e) =>
              !from ||
              Date.parse(e.ends_at) > Date.parse(from) ||
              Date.parse(e.starts_at) >= Date.parse(from),
          )
          .filter((e) => !to || Date.parse(e.starts_at) < Date.parse(to))
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
        return json({ items, next_cursor: null });
      }
      const eventOne = /^\/calendar\/events\/([^/]+)$/.exec(path);
      if (eventOne && method === 'PATCH') {
        const target = core.events.find((e) => e.id === eventOne[1] && !e.deleted_at);
        if (!target) return json({ error: { code: 'calendar_event_not_found', message: 'x' } }, 404);
        const series =
          body?.scope !== 'einzeln' && target.source_id && target.external_uid
            ? core.events.filter(
                (e) => e.source_id === target.source_id && e.external_uid === target.external_uid,
              )
            : [target];
        for (const event of series) {
          if (body && 'module_id' in body) event.module_id = body.module_id as string | null;
          if (body && 'kind' in body) event.kind = body.kind as CalendarEventKind;
          event.assigned_by = 'manuell';
        }
        return json({ items: series, next_cursor: null });
      }
      return json({ error: { code: 'not_found', message: 'x' } }, 404);
    }),
  );
  return core;
}
