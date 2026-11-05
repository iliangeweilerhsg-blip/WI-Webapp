'use client';

// Moodle in der Web-App (T1-23, F-MDL-03/-04, VERTRAEGE §17): Kurszuordnung, Abgleich, Inbox, Fristen.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import {
  MoodleCourseLinkListSchema,
  MoodleCourseLinkSchema,
  MoodleCourseListSchema,
  MoodleItemListSchema,
  MoodleItemSchema,
  MoodleStatusSchema,
  MoodleSyncedDeadlineListSchema,
  MoodleSyncStatusSchema,
  type MoodleCourse,
  type MoodleCourseLink,
  type MoodleItem,
  type MoodleSyncStatus,
  type Semester,
} from '@sg/shared';
import { ApiRequestError, apiGet, apiSend, friendlyMessage } from './api.ts';

export const MOODLE_KEY = ['moodle'] as const;
const SYNC_KEY = ['moodle', 'sync'] as const;
const COURSES_KEY = ['moodle', 'courses'] as const;
const LINKS_KEY = ['moodle', 'links'] as const;
const ITEMS_KEY = ['moodle', 'items'] as const;
const DEADLINES_KEY = ['moodle', 'deadlines'] as const;

/** Solange ein Abgleich läuft, alle 2 s nachsehen */
export const SYNC_POLL_MS = 2_000;

const MESSAGES: Record<string, string> = {
  moodle_not_configured: 'Moodle ist noch nicht eingerichtet.',
  moodle_token_invalid: 'Moodle lehnt den Zugang ab. Erneuere ihn mit pnpm sg moodle login.',
  moodle_unreachable: 'Moodle ist gerade nicht erreichbar.',
  moodle_item_not_found: 'Diese Datei gibt es nicht mehr.',
  moodle_link_not_found: 'Dieser Kurs ist keinem Modul mehr zugeordnet.',
  moodle_link_disabled: 'Der Abgleich für diesen Kurs ist ausgeschaltet. Schalte ihn zuerst ein.',
  module_not_found: 'Dieses Modul gibt es nicht mehr.',
  moodle_module_not_removable: 'Das Modul enthält schon Inhalte und bleibt. Löse stattdessen die Zuordnung.',
  session_active: 'In diesem Modul läuft gerade eine Session. Beende sie zuerst.',
};

export function moodleErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.code && MESSAGES[error.code])
    return MESSAGES[error.code] ?? '';
  return friendlyMessage(error);
}

export function isMoodleTokenInvalid(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === 'moodle_token_invalid';
}

/**
 * Sperre gegen Doppelklicks (Review #134, N1): `run` startet nur, wenn kein Aufruf derselben Stelle läuft. Die
 * Sperre gilt sofort (Ref), nicht erst nach dem nächsten Rendern wie `isPending`.
 */
export function useSingleFlight() {
  const busy = useRef(false);
  return useCallback((start: (done: () => void) => void) => {
    if (busy.current) return;
    busy.current = true;
    start(() => {
      busy.current = false;
    });
  }, []);
}

/** Zustände, in denen der Zugang erneuert werden muss bzw. bald sollte (F-MDL-01) */
export type AccessHintState = 'laeuft_bald_ab' | 'abgelaufen' | 'ungueltig';

export function needsRenewal(state: string | undefined): state is AccessHintState {
  return state === 'laeuft_bald_ab' || state === 'abgelaufen' || state === 'ungueltig';
}

const dueDateFormat = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'numeric', year: 'numeric' });

/** „31.1.2027“ aus `YYYY-MM-DD` (Mittag, damit keine Zeitzone den Tag verschiebt) */
export function formatValidUntil(date: string): string {
  return dueDateFormat.format(new Date(`${date}T12:00:00`));
}

/** Ein ruhiger Satz zum Zugang, ohne den Befehl (der steht daneben) */
export function accessHintText(state: AccessHintState, validUntil: string | null): string {
  if (state === 'laeuft_bald_ab') {
    return validUntil
      ? `Der Moodle-Zugang läuft am ${formatValidUntil(validUntil)} ab. Erneuere ihn vorher mit`
      : 'Der Moodle-Zugang läuft bald ab. Erneuere ihn vorher mit';
  }
  return 'Moodle nimmt den Zugang nicht mehr an, der Abgleich pausiert. Erneuere ihn mit';
}

export function isMoodleNotConfigured(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === 'moodle_not_configured';
}

export function useMoodleStatus() {
  return useQuery({
    queryKey: ['moodle', 'status'],
    queryFn: ({ signal }) => apiGet('/moodle/status', MoodleStatusSchema, { signal }),
    staleTime: 60_000,
  });
}

/**
 * Hat der Core beim Laden der Kursliste Kurse automatisch zugeordnet (#141)? Dann stimmen die gemerkten Zuordnungen
 * nicht mehr, und es kann neue Module geben.
 */
export function linksOutdated(
  courses: readonly MoodleCourse[],
  links: readonly MoodleCourseLink[] | undefined,
): boolean {
  const known = new Map((links ?? []).map((link) => [link.moodle_course_id, link.module_id]));
  return courses.some(
    (course) => course.module_id !== null && known.get(course.moodle_id) !== course.module_id,
  );
}

/** Gibt es ein aktuelles Semester? Ohne legt die automatische Zuordnung keine Module an (#141) */
export function hasCurrentSemester(semesters: readonly Semester[]): boolean {
  return semesters.some((s) => s.is_current && s.archived_at === null && s.deleted_at === null);
}

/**
 * Kurse aus Moodle mit Zuordnung und Vorschlag. Braucht Moodle; ohne Einrichtung kein erneuter Versuch. Beim Laden
 * ordnet der Core neue Kurse automatisch zu (#141): Danach Zuordnungen und Module neu laden
 */
export function useMoodleCourses(enabled = true) {
  const client = useQueryClient();
  return useQuery({
    queryKey: COURSES_KEY,
    queryFn: async ({ signal }) => {
      const items = (await apiGet('/moodle/courses', MoodleCourseListSchema, { signal })).items;
      if (linksOutdated(items, client.getQueryData<MoodleCourseLink[]>(LINKS_KEY))) {
        void client.invalidateQueries({ queryKey: LINKS_KEY });
        void client.invalidateQueries({ queryKey: ['modules'] });
      }
      return items;
    },
    enabled,
    // Ohne Einrichtung oder bei abgelehntem Zugang hilft ein erneuter Versuch nicht
    retry: (count, error) => !isMoodleNotConfigured(error) && !isMoodleTokenInvalid(error) && count < 2,
  });
}

/** Kurszuordnungen (lokal, auch ohne Moodle) */
export function useMoodleLinks() {
  return useQuery({
    queryKey: LINKS_KEY,
    queryFn: async ({ signal }) =>
      (await apiGet('/moodle/links', MoodleCourseLinkListSchema, { signal })).items,
  });
}

/** Stand des Abgleichs. Pollt nur, solange er läuft */
export function useMoodleSync() {
  return useQuery({
    queryKey: SYNC_KEY,
    queryFn: ({ signal }) => apiGet('/moodle/sync', MoodleSyncStatusSchema, { signal }),
    refetchInterval: (query) => (query.state.data?.state === 'laeuft' ? SYNC_POLL_MS : false),
  });
}

/** Nach einem Abgleich: Kurse, Dateien, Fristen, Material und (automatisch angelegte, #141) Module neu laden */
function useRefreshAfterSync() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: MOODLE_KEY });
    void client.invalidateQueries({ queryKey: ['modules'] });
    void client.invalidateQueries({ queryKey: ['decks'] });
    void client.invalidateQueries({ queryKey: ['sheets'] });
  }, [client]);
}

export function useStartSync() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (courseId?: number) =>
      apiSend('POST', '/moodle/sync', MoodleSyncStatusSchema, {
        body: courseId ? { course_id: courseId } : {},
      }),
    onSuccess: (status: MoodleSyncStatus) => client.setQueryData(SYNC_KEY, status),
  });
}

/**
 * Stand des Abgleichs mit Neuladen: Endet ein Lauf, den diese Ansicht laufen gesehen hat, werden Kurse, Dateien,
 * Fristen und Material neu geladen.
 */
export function useMoodleSyncWithRefresh() {
  const query = useMoodleSync();
  const refresh = useRefreshAfterSync();
  const state = query.data?.state;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (state === 'laeuft') wasRunning.current = true;
    else if (wasRunning.current && state !== undefined) {
      wasRunning.current = false;
      refresh();
    }
  }, [state, refresh]);
  return query;
}

export function useLinkCourse() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { courseId: number; moduleId: string; syncEnabled?: boolean }) =>
      apiSend('PUT', `/moodle/links/${input.courseId}`, MoodleCourseLinkSchema, {
        body: {
          module_id: input.moduleId,
          ...(input.syncEnabled === undefined ? {} : { sync_enabled: input.syncEnabled }),
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: MOODLE_KEY });
    },
  });
}

export function useUnlinkCourse() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (courseId: number) => apiSend('DELETE', `/moodle/links/${courseId}`, null),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: MOODLE_KEY });
    },
  });
}

/**
 * „Modul entfernen“ (#141): automatisch angelegtes, leeres Modul in den Papierkorb. Der Kurs wird danach nicht wieder
 * automatisch zugeordnet. Rückgängig über den Papierkorb (`POST /trash/{id}/restore`)
 */
export function useRemoveAutoModule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (courseId: number) => apiSend('DELETE', `/moodle/links/${courseId}/module`, null),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: MOODLE_KEY });
      void client.invalidateQueries({ queryKey: ['modules'] });
    },
  });
}

/** Dateien aus Moodle, z. B. `kind = offen` für die Inbox */
export function useMoodleItems(filter: { kind?: MoodleItem['kind']; moduleId?: string } = {}) {
  const params = new URLSearchParams();
  if (filter.kind) params.set('kind', filter.kind);
  if (filter.moduleId) params.set('module_id', filter.moduleId);
  const query = params.toString();
  return useQuery({
    queryKey: [...ITEMS_KEY, filter.kind ?? null, filter.moduleId ?? null],
    queryFn: async ({ signal }) =>
      (await apiGet(`/moodle/items${query ? `?${query}` : ''}`, MoodleItemListSchema, { signal })).items,
  });
}

export function useDecideItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; kind: 'folien' | 'uebung' | 'ignoriert' | 'offen' }) =>
      apiSend('PATCH', `/moodle/items/${encodeURIComponent(input.id)}`, MoodleItemSchema, {
        body: { kind: input.kind },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ITEMS_KEY });
      void client.invalidateQueries({ queryKey: SYNC_KEY });
    },
  });
}

/** Fristen aus dem Abgleich ab jetzt, optional für ein Modul bzw. bis `to` */
export function useSyncedDeadlines(filter: { moduleId?: string; days?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: [...DEADLINES_KEY, filter.moduleId ?? null, filter.days ?? null, filter.limit ?? null],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (filter.moduleId) params.set('module_id', filter.moduleId);
      if (filter.days) params.set('to', new Date(Date.now() + filter.days * 86_400_000).toISOString());
      if (filter.limit) params.set('limit', String(filter.limit));
      const query = params.toString();
      return (
        await apiGet(`/moodle/synced-deadlines${query ? `?${query}` : ''}`, MoodleSyncedDeadlineListSchema, {
          signal,
        })
      ).items;
    },
    staleTime: 60_000,
    // „Alle anzeigen“: die bisherigen Fristen bleiben stehen, bis die längere Liste da ist (kein Flackern)
    placeholderData: keepPreviousData,
  });
}

/** Nur http(s)-Adressen werden als Link gezeigt */
export function isWebUrl(url: string | null): url is string {
  return url !== null && /^https?:\/\//i.test(url);
}

const dayFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** „heute 23:59“, „morgen 10:00“, sonst „Do, 12.11. · 23:59“ (sachlich, ohne Countdown, R11) */
export function formatDue(iso: string, now: number = Date.now()): string {
  const due = new Date(iso);
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((day(due) - day(new Date(now))) / 86_400_000);
  const time = timeFormat.format(due);
  if (diff === 0) return `heute ${time}`;
  if (diff === 1) return `morgen ${time}`;
  return `${dayFormat.format(due)} · ${time}`;
}

/** „zuletzt 12.11., 10:42“ für den letzten Abgleich */
export function formatSyncedAt(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}
