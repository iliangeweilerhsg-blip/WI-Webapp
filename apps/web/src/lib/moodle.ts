'use client';

// Moodle in der Web-App (T1-23, F-MDL-03/-04, VERTRAEGE §17): Kurszuordnung, Abgleich, Inbox, Fristen.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import {
  MoodleActionCatalogSchema,
  MoodleActionPreviewSchema,
  MoodleActionResultSchema,
  MoodleAssignmentListSchema,
  MoodleAutoAssignResultSchema,
  MoodleCourseLinkListSchema,
  MoodleCourseLinkSchema,
  MoodleCourseListSchema,
  MoodleItemListSchema,
  MoodleItemSchema,
  MoodleStatusSchema,
  MoodleSyncedDeadlineListSchema,
  MoodleSubmissionStatusSchema,
  MoodleSyncStatusSchema,
  MoodleUploadSchema,
  type MoodleActionId,
  type MoodleItem,
  type MoodleSyncStatus,
  type Semester,
} from '@sg/shared';
import { ApiRequestError, apiGet, apiSend, apiUpload, friendlyMessage } from './api.ts';

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
  // Moodle selbst meldet einen Fehler oder lehnt ab (z. B. eine Warnung beim Einreichen), kein Fehler im Core
  moodle_error: 'Moodle hat einen Fehler gemeldet.',
  moodle_item_not_found: 'Diese Datei gibt es nicht mehr.',
  moodle_link_not_found: 'Dieser Kurs ist keinem Modul mehr zugeordnet.',
  moodle_link_disabled: 'Der Abgleich für diesen Kurs ist ausgeschaltet. Schalte ihn zuerst ein.',
  module_not_found: 'Dieses Modul gibt es nicht mehr.',
  moodle_module_not_removable: 'Das Modul enthält schon Inhalte und bleibt. Löse stattdessen die Zuordnung.',
  session_active: 'In diesem Modul läuft gerade eine Session. Beende sie zuerst.',
  // Aktionen und Uploads (T1-24, 08 §9.1)
  moodle_action_not_implemented: 'Diese Aktion ist noch nicht freigeschaltet.',
  moodle_action_busy: 'Für diese Aufgabe läuft gerade eine andere Aktion. Versuche es gleich noch einmal.',
  moodle_confirmation_required: 'Diese Aktion braucht eine Bestätigung.',
  moodle_confirmation_invalid: 'Die Bestätigung gilt nicht mehr. Bitte prüfe die Angaben noch einmal.',
  moodle_upload_not_found: 'Diese Datei ist nicht mehr vorgemerkt. Wähle sie noch einmal.',
  moodle_upload_limit: 'Es sind schon zu viele Dateien vorgemerkt. Entferne zuerst eine.',
  moodle_upload_in_use: 'Die Datei wird gerade verwendet und lässt sich jetzt nicht entfernen.',
  moodle_upload_type_invalid:
    'Dieser Dateityp ist nicht erlaubt. Erlaubt sind PDF, PNG, JPEG, ZIP und Text (.txt, .md, .csv).',
  moodle_function_unavailable: 'Dein Moodle-Zugang erlaubt diese Aktion nicht.',
  multipart_required: 'Die Datei konnte nicht gesendet werden.',
  local_only: 'Das geht nur direkt am Mac.',
};

/** Gründe für `409 moodle_action_rejected` (Plan T1-24 §4.2) */
const REJECTION_REASONS: Record<string, string> = {
  nicht_bearbeitbar: 'Diese Abgabe lässt sich gerade nicht bearbeiten.',
  frist_vorbei: 'Die Frist ist vorbei, Moodle nimmt keine Abgabe mehr an.',
  noch_nicht_offen: 'Die Abgabe ist noch nicht geöffnet.',
  schon_eingereicht: 'Diese Aufgabe ist schon eingereicht.',
  nichts_einzureichen: 'Es gibt nichts einzureichen. Speichere zuerst einen Entwurf.',
  erklaerung_fehlt: 'Die Erklärung zur Eigenständigkeit muss bestätigt sein.',
  abgabeart_nicht_erlaubt: 'Diese Aufgabe nimmt diese Art der Abgabe nicht an.',
  zu_viele_dateien: 'Das sind mehr Dateien, als die Aufgabe erlaubt.',
  datei_zu_gross: 'Eine Datei ist größer, als die Aufgabe erlaubt.',
  dateityp_nicht_erlaubt: 'Diese Aufgabe nimmt diesen Dateityp nicht an.',
  uploads_nicht_freigegeben: 'Dein Moodle-Zugang erlaubt keine Uploads.',
  nicht_gefunden: 'Diese Aufgabe gibt es in Moodle nicht (mehr).',
};

export function moodleErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.code) {
    if (error.code === 'moodle_action_rejected') {
      const reason = error.details.reason;
      return (typeof reason === 'string' ? REJECTION_REASONS[reason] : undefined) ?? 'Moodle lehnt das ab.';
    }
    // Die Obergrenze nennt der Core selbst (Uploads für Moodle: 100 MB), nicht die allgemeine Meldung
    if (error.code === 'file_too_large') {
      const text = error.message.replace(/^file_too_large:\s*/, '').trim();
      return text || 'Die Datei ist zu groß.';
    }
    if (MESSAGES[error.code]) return MESSAGES[error.code] ?? '';
  }
  return friendlyMessage(error);
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof ApiRequestError && error.code === code;
}
/** `501`: der Schalter `SG_MOODLE_ACTIONS` ist für diese Aktion aus */
export const isActionNotImplemented = (error: unknown) => hasCode(error, 'moodle_action_not_implemented');
export const isConfirmationInvalid = (error: unknown) => hasCode(error, 'moodle_confirmation_invalid');
export const isActionBusy = (error: unknown) => hasCode(error, 'moodle_action_busy');
/** `409`: `execute` ohne Code, der Core verlangt jetzt eine Bestätigung (z. B. Aufgabe ohne Einreichen-Schritt) */
export const isConfirmationRequired = (error: unknown) => hasCode(error, 'moodle_confirmation_required');
/** Moodle hat vielleicht geschrieben, vielleicht nicht (`details.outcome_unknown`): nie wiederholen */
export function isOutcomeUnknown(error: unknown): boolean {
  return error instanceof ApiRequestError && error.details.outcome_unknown === true;
}
/** `details.reason = "stand_geaendert"`: der Stand in Moodle ist nicht mehr der der Vorschau */
export function isStateChanged(error: unknown): boolean {
  return isConfirmationInvalid(error) && (error as ApiRequestError).details.reason === 'stand_geaendert';
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

/** Frist, die nach dem Ablauf des Zugangs liegt (UX-313) */
export interface ExpiryDeadline {
  name: string;
  due_at: string;
}

/** So viele Tage vor dem Ablauf warnt die Web-App, wenn danach noch eine Frist liegt (der Core meldet erst ab 7) */
export const EARLY_HINT_DAYS = 14;

/**
 * UX-313: Die früheste noch offene Frist, die nach dem Ablauf des Zugangs liegt. Nur wenn der Ablauf höchstens
 * `EARLY_HINT_DAYS` Tage entfernt ist und noch nicht vorbei. Sonst `null`. Das Ablaufdatum gilt bis Tagesende.
 */
export function deadlineAfterExpiry<T extends ExpiryDeadline>(
  validUntil: string | null,
  deadlines: readonly T[] | undefined,
  now: number = Date.now(),
): T | null {
  if (!validUntil || !deadlines) return null;
  const end = new Date(`${validUntil}T23:59:59`).getTime();
  if (Number.isNaN(end) || end < now || end - now > EARLY_HINT_DAYS * 86_400_000) return null;
  const later = deadlines
    .filter((d) => {
      const due = new Date(d.due_at).getTime();
      return due > end && due >= now;
    })
    .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
  return later[0] ?? null;
}

/** Ein ruhiger Satz zum Zugang, ohne den Befehl (der steht daneben) */
export function accessHintText(
  state: AccessHintState | 'ok',
  validUntil: string | null,
  deadline: ExpiryDeadline | null = null,
  now: number = Date.now(),
): string {
  if (state === 'laeuft_bald_ab' || state === 'ok') {
    const until = validUntil ? ` am ${formatValidUntil(validUntil)}` : ' bald';
    const before = deadline
      ? `, vor der Frist „${deadline.name}“ (${formatDue(deadline.due_at, now)}).`
      : '.';
    return `Der Moodle-Zugang läuft${until} ab${before} Erneuere ihn vorher mit`;
  }
  return 'Moodle nimmt den Zugang nicht mehr an, der Abgleich pausiert. Erneuere ihn mit';
}

/**
 * UX-312: Was zur Frist zu sagen ist, ohne Wertung (R11). `null`, wenn nichts zu sagen ist.
 * Moodle entscheidet selbst, ob es nach der Frist noch annimmt (`cutoff_at`, sonst unbekannt). `due_at` und
 * `cutoff_at` sind die Daten der Aufgabe, eine persönliche Verlängerung kennt die App nicht. Darum die Einschränkung.
 */
export function lateNote(input: {
  state: 'keine' | 'entwurf' | 'eingereicht';
  lastModifiedAt: string | null;
  dueAt: string | null;
  cutoffAt: string | null;
  now?: number;
}): string | null {
  const now = input.now ?? Date.now();
  if (!input.dueAt) return null;
  const due = new Date(input.dueAt).getTime();
  if (input.state === 'eingereicht') {
    const at = input.lastModifiedAt ? new Date(input.lastModifiedAt).getTime() : null;
    return at !== null && at > due
      ? 'Nach der Frist eingereicht. Ohne Verlängerung zeigt Moodle sie als verspätet.'
      : null;
  }
  if (now <= due) return null;
  if (input.cutoffAt) {
    const cutoff = new Date(input.cutoffAt).getTime();
    return now >= cutoff
      ? 'Die Frist ist vorbei. Ohne Verlängerung nimmt Moodle keine Abgabe mehr an.'
      : `Die Frist ist vorbei. Moodle nimmt noch bis ${formatDue(input.cutoffAt, now)} an, die Abgabe gilt dann ohne Verlängerung als verspätet.`;
  }
  return 'Die Frist ist vorbei. Ob Moodle noch annimmt, entscheidet die Aufgabe; ohne Verlängerung gilt eine Abgabe als verspätet.';
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

/** Gibt es ein aktuelles Semester? Ohne legt die automatische Zuordnung keine Module an (#141) */
export function hasCurrentSemester(semesters: readonly Semester[]): boolean {
  return semesters.some((s) => s.is_current && s.archived_at === null && s.deleted_at === null);
}

/**
 * Automatische Kurszuordnung anstoßen (#141, `POST /moodle/auto-assign`). Hat sie etwas zugeordnet oder angelegt,
 * werden Kurse, Zuordnungen und Module neu geladen. Ohne Einrichtung bzw. bei abgelehntem Zugang still.
 */
export function useAutoAssign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiSend('POST', '/moodle/auto-assign', MoodleAutoAssignResultSchema, { body: {} }),
    onSuccess: (result) => {
      if (result.assigned === 0 && result.created === 0) return;
      void client.invalidateQueries({ queryKey: MOODLE_KEY });
      void client.invalidateQueries({ queryKey: ['modules'] });
    },
  });
}

/** Kurse aus Moodle mit Zuordnung und Vorschlag. Braucht Moodle; ohne Einrichtung kein erneuter Versuch */
export function useMoodleCourses(enabled = true) {
  return useQuery({
    queryKey: COURSES_KEY,
    queryFn: async ({ signal }) =>
      (await apiGet('/moodle/courses', MoodleCourseListSchema, { signal })).items,
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
export function useSyncedDeadlines(
  filter: { moduleId?: string; days?: number; limit?: number; enabled?: boolean } = {},
) {
  return useQuery({
    enabled: filter.enabled ?? true,
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

// --- Aktionen (T1-24, 08 §9.3) ---

const ACTIONS_KEY = ['moodle', 'actions'] as const;
const ASSIGNMENTS_KEY = ['moodle', 'assignments'] as const;
const SUBMISSION_KEY = ['moodle', 'submission'] as const;

export type MoodleActionParams = Record<string, unknown>;

/** Aktionskatalog mit Verfügbarkeit für den aktuellen Zugang */
export function useMoodleActionCatalog(enabled = true) {
  return useQuery({
    queryKey: ACTIONS_KEY,
    queryFn: async ({ signal }) =>
      (await apiGet('/moodle/actions', MoodleActionCatalogSchema, { signal })).items,
    enabled,
    staleTime: 60_000,
    retry: (count, error) => !isMoodleNotConfigured(error) && count < 1,
  });
}

/** Vorschau: ändert nichts in Moodle. Liefert bei Bedarf den Bestätigungscode */
export function previewMoodleAction(action: MoodleActionId, params: MoodleActionParams) {
  return apiSend('POST', `/moodle/actions/${action}/preview`, MoodleActionPreviewSchema, {
    body: { params },
  });
}

/** Ausführen. Jeder Aufruf bekommt einen frischen `Idempotency-Key` (`apiSend`), auch nach `moodle_action_busy` */
export function executeMoodleAction(
  action: MoodleActionId,
  params: MoodleActionParams,
  token: string | null,
) {
  return apiSend('POST', `/moodle/actions/${action}/execute`, MoodleActionResultSchema, {
    body: { params, ...(token ? { confirmation_token: token } : {}) },
  });
}

/** Alle Aufgaben (ohne Kurs) bzw. die eines Kurses */
export function useMoodleAssignments(enabled = true) {
  return useQuery({
    queryKey: ASSIGNMENTS_KEY,
    queryFn: async ({ signal }) =>
      (await apiGet('/moodle/assignments', MoodleAssignmentListSchema, { signal })).items,
    enabled,
    staleTime: 60_000,
    retry: (count, error) => !isMoodleNotConfigured(error) && !isMoodleTokenInvalid(error) && count < 1,
  });
}

/** Abgabestand einer Aufgabe */
export function useMoodleSubmission(assignmentId: number | null) {
  return useQuery({
    queryKey: [...SUBMISSION_KEY, assignmentId],
    queryFn: ({ signal }) =>
      apiGet(`/moodle/assignments/${assignmentId}/submission`, MoodleSubmissionStatusSchema, { signal }),
    enabled: assignmentId !== null,
    retry: (count, error) => !isMoodleNotConfigured(error) && !isMoodleTokenInvalid(error) && count < 1,
  });
}

/** Stand der Abgabe neu laden, z. B. nach einer Aktion oder bei unklarem Ausgang */
export function useRefreshSubmission() {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: SUBMISSION_KEY }), [client]);
}

/** Datei für eine Aktion vormerken (`POST /moodle/uploads`), ein Schlüssel je Datei */
export function uploadMoodleFile(file: File, signal?: AbortSignal) {
  return apiUpload('/moodle/uploads', MoodleUploadSchema, {
    file,
    fields: {},
    idempotencyKey: globalThis.crypto.randomUUID(),
    ...(signal ? { signal } : {}),
  });
}

export function removeMoodleUpload(uploadId: string) {
  return apiSend('DELETE', `/moodle/uploads/${encodeURIComponent(uploadId)}`, null);
}

const KB = 1024;
/** „1,2 MB“, „300 KB“ */
export function formatBytes(bytes: number): string {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < KB * KB) return `${Math.max(1, Math.round(bytes / KB))} KB`;
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(bytes / KB / KB)} MB`;
}

const clockFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
export function formatClock(iso: string): string {
  return clockFormat.format(new Date(iso));
}

/**
 * Endungen, die der Core für Moodle-Uploads annimmt (Plan T1-24 F2, `services/core/src/moodle/uploads.ts`). Nur ein
 * Hinweis für die Dateiauswahl, entscheiden tut der Core
 */
export const MOODLE_UPLOAD_ACCEPT = '.pdf,.png,.jpg,.jpeg,.zip,.txt,.md,.csv';

/** Link zur Seite „Abgabe“ */
export function abgabeHref(assignmentId: number, moduleId: string): string {
  return `/abgabe?aufgabe=${assignmentId}&modul=${encodeURIComponent(moduleId)}`;
}
