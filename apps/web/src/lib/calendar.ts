'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarEventListSchema,
  CalendarReassignResultSchema,
  CalendarSourceListSchema,
  IcsImportResultSchema,
  type CalendarEvent,
  type CalendarEventKind,
  type CalendarEventUpdate,
  type CalendarSource,
  type IcsImportResult,
} from '@sg/shared';
import { ApiRequestError, apiGet, apiSend, apiUpload, friendlyMessage } from './api.ts';
import { useHydrationSafe } from './hydrated.ts';
import { uuidv7 } from './uuid.ts';

// ---------------------------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------------------------

export const KIND_LABELS: Record<CalendarEventKind, string> = {
  vorlesung: 'Vorlesung',
  uebung: 'Übung',
  tutorium: 'Tutorium',
  pruefung: 'Prüfung',
  fest: 'Fester Termin',
  lernblock_export: 'Lernblock',
};

/** Arten, die man von Hand setzen kann (Lernblöcke schreibt der Planer) */
export const EDITABLE_KINDS: readonly CalendarEventKind[] = [
  'vorlesung',
  'uebung',
  'tutorium',
  'pruefung',
  'fest',
];

/** Größte ICS-Datei, die der Core annimmt (VERTRAEGE §7.1) */
export const MAX_ICS_BYTES = 5 * 1024 * 1024;

/**
 * Freundlicher Text zu einem Fehler des Kalenders. Die Meldung des Core (deutsch, ohne Technik) wird bei den
 * Abruf- und Dateifehlern mitgegeben, weil sie sagt, woran es lag (Zeitlimit, Größe, lokales Netz …).
 */
export function calendarErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.kind === 'api') {
    const detail = error.message.includes(': ') ? error.message.slice(error.message.indexOf(': ') + 2) : '';
    switch (error.code) {
      case 'ics_invalid':
        return 'Das ist keine gültige ICS-Datei. Exportiere den Stundenplan als „.ics“ und versuche es noch einmal.';
      case 'ics_fetch_failed':
        return detail
          ? `Die Adresse lässt sich nicht abrufen. ${detail}`
          : 'Die Adresse lässt sich nicht abrufen.';
      case 'calendar_source_exists':
        return 'Diesen Kalender gibt es schon.';
      case 'file_too_large':
        return 'Die Datei ist zu groß (höchstens 5 MB).';
      case 'file_missing':
        return 'Wähle zuerst eine Datei.';
      case 'calendar_source_not_found':
        return 'Diese Kalenderquelle gibt es nicht mehr.';
      case 'calendar_event_not_found':
        return 'Diesen Termin gibt es nicht mehr.';
      case 'module_not_found':
        return 'Dieses Modul gibt es nicht mehr.';
      case 'ics_too_complex':
        return 'Die Datei ist zu komplex und wurde nicht ausgewertet. Exportiere nur den Zeitraum, den du brauchst.';
      case 'unexpected_file':
        return 'Eine abonnierte Adresse nimmt keine Datei an. Sie wird neu abgerufen.';
      case 'validation_failed':
        // Der Core nennt bei einer ungültigen Adresse den Grund. Sonst bleibt es beim allgemeinen Text.
        return detail && detail !== 'Die Anfrage ist ungültig.' ? detail : friendlyMessage(error);
      default:
    }
  }
  return friendlyMessage(error);
}

// ---------------------------------------------------------------------------------------------
// Woche und Tage (Ortszeit des Browsers)
// ---------------------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-11-09` aus Jahr, Monat und Tag der Ortszeit */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Montag 00:00 der Woche, in der `date` liegt (Ortszeit) */
export function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (start.getDay() + 6) % 7; // Montag = 0
  start.setDate(start.getDate() - offset);
  return start;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return next;
}

/** Die sieben Tage ab Montag */
export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** ISO-Kalenderwoche (Donnerstag-Regel) */
export function isoWeek(date: Date): number {
  const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  return (
    1 +
    Math.round(
      ((thursday.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    )
  );
}

const dayFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDayFormat = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' });
const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const stampFormat = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDay = (date: Date) => dayFormat.format(date);

/** „KW 46 · 9. – 15. November 2026“ */
export function formatWeek(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === end.getMonth();
  const from = sameMonth ? String(weekStart.getDate()) + '.' : shortDayFormat.format(weekStart);
  return `KW ${isoWeek(weekStart)} · ${from} – ${shortDayFormat.format(end)} ${end.getFullYear()}`;
}

export const formatStamp = (iso: string) => stampFormat.format(new Date(iso));

/** Tag, an dem der Termin angezeigt wird: ganztägige Termine liegen auf 00:00 UTC des Datums, sie zählen dort */
export function eventDay(event: Pick<CalendarEvent, 'all_day' | 'starts_at'>): string {
  return event.all_day ? event.starts_at.slice(0, 10) : dayKey(new Date(event.starts_at));
}

/** „10:15–12:00“ bzw. „ganztägig“ */
export function formatEventTime(event: Pick<CalendarEvent, 'all_day' | 'starts_at' | 'ends_at'>): string {
  if (event.all_day) return 'ganztägig';
  const start = timeFormat.format(new Date(event.starts_at));
  return event.ends_at === event.starts_at ? start : `${start}–${timeFormat.format(new Date(event.ends_at))}`;
}

export interface DayGroup {
  date: Date;
  key: string;
  events: CalendarEvent[];
}

/** Termine auf die sieben Tage der Woche verteilen (ganztägige zuerst, dann nach Beginn) */
export function groupByDay(weekStart: Date, events: readonly CalendarEvent[]): DayGroup[] {
  return weekDays(weekStart).map((date) => {
    const key = dayKey(date);
    const mine = events
      .filter((event) => eventDay(event) === key)
      .sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.starts_at.localeCompare(b.starts_at));
    return { date, key, events: mine };
  });
}

// ---------------------------------------------------------------------------------------------
// Abfragen
// ---------------------------------------------------------------------------------------------

export const CALENDAR_KEY = ['calendar'] as const;

/** Termine einer Woche aus `GET /calendar/events` (auch abgesagte, sie werden ruhig durchgestrichen gezeigt) */
export function useWeekEvents(weekStart: Date | null) {
  const from = weekStart ? weekStart.toISOString() : null;
  const to = weekStart ? addDays(weekStart, 7).toISOString() : null;
  const query = useQuery({
    queryKey: [...CALENDAR_KEY, 'events', from, to],
    enabled: from !== null && to !== null,
    queryFn: ({ signal }) =>
      apiGet(
        `/calendar/events?from=${encodeURIComponent(from ?? '')}&to=${encodeURIComponent(to ?? '')}&include_cancelled=true&limit=200`,
        CalendarEventListSchema,
        { signal },
      ),
    select: (page) => page.items.filter((event) => event.deleted_at === null),
  });
  return useHydrationSafe(query);
}

/** So viele Termine ohne Modul zählt der Hinweis höchstens (eine Seite des Core) */
export const UNASSIGNED_LIMIT = 200;

/** „5“ bzw. „200+“, wenn die Obergrenze erreicht ist */
export function formatCount(count: number): string {
  return count >= UNASSIGNED_LIMIT ? `${UNASSIGNED_LIMIT}+` : String(count);
}

/** Kommende Termine ohne Modul (ab heute 0 Uhr, ohne abgesagte), für den Hinweis „n Termine ohne Modul“ */
export function useUnassignedCount() {
  const query = useQuery({
    queryKey: [...CALENDAR_KEY, 'unassigned'],
    queryFn: ({ signal }) => {
      const from = startOfDay(new Date()).toISOString();
      return apiGet(
        `/calendar/events?unassigned=true&from=${encodeURIComponent(from)}&limit=${UNASSIGNED_LIMIT}`,
        CalendarEventListSchema,
        { signal },
      );
    },
    select: (page) => page.items.length,
  });
  return useHydrationSafe(query);
}

export function useCalendarSources() {
  const query = useQuery({
    queryKey: [...CALENDAR_KEY, 'sources'],
    queryFn: ({ signal }) => apiGet('/calendar/sources?limit=100', CalendarSourceListSchema, { signal }),
    select: (page) => page.items.filter((source) => source.deleted_at === null),
  });
  return useHydrationSafe(query);
}

// ---------------------------------------------------------------------------------------------
// Änderungen
// ---------------------------------------------------------------------------------------------

function useInvalidateCalendar() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: CALENDAR_KEY });
}

/** ICS-URL abonnieren (`webcal://` geht auch) */
export function useImportUrl() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ url, name }: { url: string; name?: string }) =>
      apiSend('POST', '/calendar/sources', IcsImportResultSchema, {
        body: { url: url.trim(), ...(name?.trim() ? { name: name.trim() } : {}) },
      }),
    onSuccess: invalidate,
  });
}

/** Ein Schlüssel je Datei: Wiederholt der Nutzer nach einem Netzfehler, legt der Core nichts doppelt an (08 §1) */
const uploadKeys = new WeakMap<File, string>();
function keyFor(file: File): string {
  let key = uploadKeys.get(file);
  if (!key) {
    key = uuidv7();
    uploadKeys.set(file, key);
  }
  return key;
}

export function useImportFile() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ file }: { file: File }) =>
      apiUpload('/calendar/sources', IcsImportResultSchema, {
        file,
        fields: {},
        idempotencyKey: keyFor(file),
      }),
    onSuccess: invalidate,
  });
}

/** Quelle abgleichen: URL neu abrufen, bei einer Datei-Quelle die neue Fassung hochladen */
export function useSyncSource() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ source, file }: { source: CalendarSource; file?: File }): Promise<IcsImportResult> => {
      const path = `/calendar/sources/${encodeURIComponent(source.id)}/sync`;
      if (file)
        return apiUpload(path, IcsImportResultSchema, { file, fields: {}, idempotencyKey: keyFor(file) });
      return apiSend('POST', path, IcsImportResultSchema);
    },
    // Auch nach einem Fehler neu laden: `last_error` steht dann an der Quelle
    onSettled: invalidate,
  });
}

export function useDeleteSource() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (source: CalendarSource) =>
      apiSend('DELETE', `/calendar/sources/${encodeURIComponent(source.id)}`, null),
    onSuccess: invalidate,
  });
}

/** Automatische Zuordnung aller Termine neu berechnen, nach dem Anlegen von Modulen (VERTRAEGE §7.1) */
export function useReassign() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: () => apiSend('POST', '/calendar/reassign', CalendarReassignResultSchema),
    onSuccess: invalidate,
  });
}

/** Modul und/oder Art setzen. `scope` fehlt = ganze Serie (VERTRAEGE §7.1) */
export function useUpdateEvent() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CalendarEventUpdate }) =>
      apiSend('PATCH', `/calendar/events/${encodeURIComponent(id)}`, CalendarEventListSchema, {
        body: patch,
      }),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------------------------
// Zusammenfassung eines Imports
// ---------------------------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Ein ruhiger Satz zum Ergebnis: „24 Termine neu · 2 geändert · 3 entfallen“ */
export function summarizeImport(result: IcsImportResult): string {
  const { neu, geaendert, entfallen, unveraendert } = result.counts;
  const parts: string[] = [];
  if (neu > 0) parts.push(plural(neu, 'Termin neu', 'Termine neu'));
  if (geaendert > 0) parts.push(`${geaendert} geändert`);
  if (entfallen > 0) parts.push(`${entfallen} ${entfallen === 1 ? 'entfällt' : 'entfallen'}`);
  if (parts.length === 0) {
    return unveraendert > 0 ? 'Nichts hat sich geändert.' : 'Die Datei enthält keine Termine.';
  }
  return parts.join(' · ');
}
