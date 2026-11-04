'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';
import {
  ExerciseSheetListSchema,
  ExerciseSheetSchema,
  SlideDeckDetailSchema,
  SlideDeckListSchema,
  SlideDeckSchema,
  type ExerciseSheet,
  type SlideDeck,
} from '@sg/shared';
import { ApiRequestError, apiBase, apiGet, apiSend } from './api.ts';

/** Foliensatz (`folien`, Tab Vorlesungen) oder Übungsblatt (`blatt`, Tab Übungen). Gleiche Werte wie `?typ=` im Viewer. */
export type MaterialKind = 'folien' | 'blatt';

export const POLL_INTERVAL_MS = 2_000;

export function isMaterialKind(value: string | null): value is MaterialKind {
  return value === 'folien' || value === 'blatt';
}

/** Wörter für Toasts und Listen. */
export const KIND_WORDS: Record<MaterialKind, { one: string; many: string; added: string }> = {
  folien: { one: 'Foliensatz', many: 'Foliensätze', added: 'Foliensatz hinzugefügt' },
  blatt: { one: 'Übungsblatt', many: 'Übungsblätter', added: 'Übungsblatt hinzugefügt' },
};

export function collectionPath(kind: MaterialKind): string {
  return kind === 'folien' ? '/slide-decks' : '/exercise-sheets';
}

export function itemPath(kind: MaterialKind, id: string): string {
  return `${collectionPath(kind)}/${encodeURIComponent(id)}`;
}

/** Adresse des Bildschirms mit der PDF-Anzeige (VERTRAEGE §5: Query-Parameter). */
export function documentHref(kind: MaterialKind, id: string, page?: number): string {
  const base = `/dokument?typ=${kind}&id=${encodeURIComponent(id)}`;
  return page && page > 1 ? `${base}&seite=${page}` : base;
}

/** Vollständige URL einer Datei des Core (Bilder, Original-PDF). */
export function fileUrl(path: string): string {
  return `${apiBase()}${path}`;
}

export function pdfUrl(kind: MaterialKind, id: string): string {
  return fileUrl(`${itemPath(kind, id)}/file`);
}

export function pageImageUrl(kind: MaterialKind, id: string, slideId: string | null, page: number): string {
  return kind === 'folien'
    ? fileUrl(`/slides/${encodeURIComponent(slideId ?? '')}/image`)
    : fileUrl(`${itemPath('blatt', id)}/pages/${page}/image`);
}

export function pageThumbUrl(kind: MaterialKind, id: string, slideId: string | null, page: number): string {
  return kind === 'folien'
    ? fileUrl(`/slides/${encodeURIComponent(slideId ?? '')}/thumb`)
    : fileUrl(`${itemPath('blatt', id)}/pages/${page}/thumb`);
}

// ---------------------------------------------------------------------------------------------
// Abfragen
// ---------------------------------------------------------------------------------------------

type Polled = { items: { ingest_state: string }[] } | undefined;

/** Pollt nur, solange mindestens ein Eintrag noch eingelesen wird (`neu`); bei `verarbeitet`/`fehler` ist Ruhe. */
function pollWhileProcessing(data: Polled): number | false {
  return data?.items.some((item) => item.ingest_state === 'neu') ? POLL_INTERVAL_MS : false;
}

export function useDecks(moduleId: string) {
  return useQuery({
    queryKey: ['decks', moduleId],
    queryFn: ({ signal }) =>
      apiGet(`/slide-decks?module_id=${encodeURIComponent(moduleId)}&limit=100`, SlideDeckListSchema, {
        signal,
      }),
    refetchInterval: (query) => pollWhileProcessing(query.state.data),
    select: (page) => page.items.filter((d) => d.deleted_at === null),
  });
}

export function useSheets(moduleId: string) {
  return useQuery({
    queryKey: ['sheets', moduleId],
    queryFn: ({ signal }) =>
      apiGet(
        `/exercise-sheets?module_id=${encodeURIComponent(moduleId)}&limit=100`,
        ExerciseSheetListSchema,
        {
          signal,
        },
      ),
    refetchInterval: (query) => pollWhileProcessing(query.state.data),
    select: (page) => page.items.filter((s) => s.deleted_at === null),
  });
}

/**
 * Titel aus dem Dateinamen: ohne `.pdf`, ohne Steuerzeichen, NFC-normalisiert, Unterstriche und Mehrfach-Leerzeichen
 * werden zu einem Leerzeichen, höchstens 300 Zeichen (Code Points, ein Emoji wird nicht zerschnitten).
 */
export function titleFromFile(filename: string): string {
  const cleaned = [...filename.normalize('NFC')]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .replace(/\.pdf$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...cleaned].slice(0, 300).join('');
}

/** Einlese-Zustand und Titel eines Eintrags (teilt den Cache mit den Detailansichten). */
export async function fetchIngest(
  client: QueryClient,
  kind: MaterialKind,
  id: string,
): Promise<{ state: SlideDeck['ingest_state']; title: string }> {
  if (kind === 'folien') {
    const { deck } = await client.fetchQuery({
      queryKey: ['deck', id],
      queryFn: ({ signal }) =>
        apiGet(`/slide-decks/${encodeURIComponent(id)}`, SlideDeckDetailSchema, { signal }),
      staleTime: 0,
    });
    return { state: deck.ingest_state, title: deck.title };
  }
  const sheet = await client.fetchQuery({
    queryKey: ['sheet', id],
    queryFn: ({ signal }) =>
      apiGet(`/exercise-sheets/${encodeURIComponent(id)}`, ExerciseSheetSchema, { signal }),
    staleTime: 0,
  });
  return { state: sheet.ingest_state, title: sheet.title };
}

/** Foliensatz mit allen Folien (für Vorschaubild und Viewer). Pollt, solange der Satz eingelesen wird. */
export function useDeckDetail(id: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['deck', id],
    queryFn: ({ signal }) =>
      apiGet(`/slide-decks/${encodeURIComponent(id)}`, SlideDeckDetailSchema, { signal }),
    enabled: options.enabled ?? true,
    refetchInterval: (query) => (query.state.data?.deck.ingest_state === 'neu' ? POLL_INTERVAL_MS : false),
  });
}

export function useSheetDetail(id: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['sheet', id],
    queryFn: ({ signal }) =>
      apiGet(`/exercise-sheets/${encodeURIComponent(id)}`, ExerciseSheetSchema, { signal }),
    enabled: options.enabled ?? true,
    refetchInterval: (query) => (query.state.data?.ingest_state === 'neu' ? POLL_INTERVAL_MS : false),
  });
}

function invalidateMaterial(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['decks'] }),
    client.invalidateQueries({ queryKey: ['sheets'] }),
    client.invalidateQueries({ queryKey: ['deck'] }),
    client.invalidateQueries({ queryKey: ['sheet'] }),
  ]);
}

export { invalidateMaterial };

/** Titel ändern (PATCH). */
export function useRenameMaterial(kind: MaterialKind) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }): Promise<MaterialItem> =>
      kind === 'folien'
        ? apiSend('PATCH', itemPath(kind, id), SlideDeckSchema, { body: { title } })
        : apiSend('PATCH', itemPath(kind, id), ExerciseSheetSchema, { body: { title } }),
    onSuccess: () => invalidateMaterial(client),
  });
}

export type MaterialItem = SlideDeck | ExerciseSheet;

// ---------------------------------------------------------------------------------------------
// Löschen mit Rückgängig (R15)
// ---------------------------------------------------------------------------------------------

interface PendingDelete {
  client: QueryClient;
  kind: MaterialKind;
  id: string;
  onFailed: () => void;
  /** Das DELETE ist unterwegs: Die Löschung lässt sich nicht mehr zurücknehmen. */
  sending?: boolean;
  /** Erledigt, sobald das DELETE durch ist (oder gescheitert) und der Eintrag aus der Vormerkung verschwunden ist */
  done?: Promise<void>;
}

const pending = new Map<string, PendingDelete>();
const listeners = new Set<() => void>();
const EMPTY: ReadonlySet<string> = new Set();
let snapshot: ReadonlySet<string> = EMPTY;

const keyOf = (kind: MaterialKind, id: string) => `${kind}:${id}`;

function publish(): void {
  snapshot = new Set(pending.keys());
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Schlüssel (`folien:<id>`) der Einträge, die gerade ausgeblendet sind und nach dem Rückgängig-Fenster gelöscht werden. */
export function usePendingMaterialDeletes(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
}

/** Einträge ohne die gerade zum Löschen vorgemerkten. */
export function useVisibleItems<T extends { id: string }>(kind: MaterialKind, items: T[] | undefined) {
  const hidden = usePendingMaterialDeletes();
  return useMemo(() => items?.filter((item) => !hidden.has(keyOf(kind, item.id))), [items, hidden, kind]);
}

/** Anzahl der Löschungen, die sich noch rückgängig machen lassen (ohne bereits abgeschickte). */
export function pendingMaterialDeleteCount(): number {
  let count = 0;
  for (const entry of pending.values()) if (!entry.sending) count += 1;
  return count;
}

/** Text des „Rückgängig“-Toasts passend zur aktuellen Zahl offener Löschungen; `null`, wenn keine offen ist. */
export function pendingDeleteMessage(): string | null {
  const open = [...pending.values()].filter((entry) => !entry.sending);
  const [first] = open;
  if (!first) return null;
  return open.length === 1 ? `${KIND_WORDS[first.kind].one} gelöscht` : `${open.length} Dateien gelöscht`;
}

async function sendDelete(kind: MaterialKind, id: string, keepalive: boolean): Promise<void> {
  try {
    await apiSend('DELETE', itemPath(kind, id), null, { keepalive });
  } catch (error) {
    // 404: schon weg, das Ziel ist erreicht
    if (error instanceof ApiRequestError && error.status === 404) return;
    throw error;
  }
}

function commitDelete(key: string): Promise<void> {
  const entry = pending.get(key);
  if (!entry || entry.sending) return Promise.resolve();
  // Ab jetzt ist die Löschung nicht mehr zurücknehmbar (sonst käme „ist wieder da“, obwohl die Datei verschwindet)
  entry.sending = true;
  entry.done = runDelete(key, entry);
  return entry.done;
}

/**
 * Wartet, bis ein bereits abgeschicktes DELETE durch ist. `true`, wenn der Eintrag gerade gelöscht wurde (dann kennt
 * der Core die Datei nicht mehr und ein neuer Upload wird angenommen), sonst `false` (nichts zu warten).
 */
export async function awaitMaterialDelete(kind: MaterialKind, id: string): Promise<boolean> {
  const entry = pending.get(keyOf(kind, id));
  if (!entry?.sending || !entry.done) return false;
  await entry.done;
  return true;
}

async function runDelete(key: string, entry: PendingDelete): Promise<void> {
  try {
    await sendDelete(entry.kind, entry.id, false);
  } catch {
    pending.delete(key);
    publish();
    entry.onFailed();
    return;
  }
  // Erst nach dem Neuladen der Listen wieder „freigeben“, sonst blitzt der Eintrag kurz auf
  await invalidateMaterial(entry.client);
  pending.delete(key);
  publish();
}

/** Blendet den Eintrag sofort aus. Gelöscht wird erst bei {@link commitMaterialDeletes} (Ablauf des Toasts). */
export function scheduleMaterialDelete(
  client: QueryClient,
  kind: MaterialKind,
  id: string,
  onFailed: () => void,
): void {
  const key = keyOf(kind, id);
  if (pending.has(key)) return;
  pending.set(key, { client, kind, id, onFailed });
  publish();
  ensurePageHideFlush();
}

/**
 * Nimmt die Vormerkung eines einzelnen Eintrags zurück (z. B. weil dieselbe Datei erneut hochgeladen wurde: Der Core
 * meldet dann die ID der vorgemerkten Löschung als Dublette). `true`, wenn der Eintrag vorgemerkt war.
 */
export function unscheduleMaterialDelete(kind: MaterialKind, id: string): boolean {
  const key = keyOf(kind, id);
  const entry = pending.get(key);
  // Schon abgeschickt: nicht mehr zurücknehmbar
  if (!entry || entry.sending) return false;
  pending.delete(key);
  publish();
  return true;
}

/** Titel eines Eintrags aus den geladenen Listen des Moduls (für Meldungen). */
export function cachedMaterialTitle(
  client: QueryClient,
  kind: MaterialKind,
  moduleId: string,
  id: string,
): string | null {
  const data = client.getQueryData<{ items: { id: string; title: string }[] }>([
    kind === 'folien' ? 'decks' : 'sheets',
    moduleId,
  ]);
  return data?.items.find((item) => item.id === id)?.title ?? null;
}

export function undoMaterialDeletes(): void {
  for (const [key, entry] of [...pending]) if (!entry.sending) pending.delete(key);
  publish();
}

export function commitMaterialDeletes(): void {
  for (const key of [...pending.keys()]) void commitDelete(key);
}

let flushRegistered = false;
function ensurePageHideFlush(): void {
  if (flushRegistered || typeof window === 'undefined') return;
  flushRegistered = true;
  window.addEventListener('pagehide', () => {
    // Schon abgeschickte DELETEs laufen weiter (keepalive nicht nötig), kein zweites senden
    for (const entry of pending.values()) {
      if (!entry.sending) void sendDelete(entry.kind, entry.id, true).catch(() => {});
    }
    pending.clear();
  });
}

/** Nur für Tests. */
export function resetPendingMaterialDeletes(): void {
  pending.clear();
  publish();
}

// ---------------------------------------------------------------------------------------------
// Anzeige-Helfer
// ---------------------------------------------------------------------------------------------

const DATE = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'short', year: 'numeric' });

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : DATE.format(date);
}

export function pagesLabel(count: number | null): string | null {
  if (count === null) return null;
  return count === 1 ? '1 Seite' : `${count} Seiten`;
}
