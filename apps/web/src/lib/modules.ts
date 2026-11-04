'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';
import {
  ModuleListSchema,
  ModuleSchema,
  type Module,
  type ModuleCreate,
  type ModuleUpdate,
} from '@sg/shared';
import { ApiRequestError, apiGet, apiSend } from './api.ts';
import { useHydrationSafe } from './hydrated.ts';

/** Feste Palette der Modulfarben (07 §8), Werte in `packages/ui-tokens` */
export const MODULE_COLORS = Array.from({ length: 12 }, (_, i) => `mod-${String(i + 1).padStart(2, '0')}`);

/** Module aus `GET /modules` (erste Seite; für die Navigation reichen 100). */
export function useModules() {
  const query = useQuery({
    queryKey: ['modules'],
    queryFn: ({ signal }) => apiGet('/modules?limit=100', ModuleListSchema, { signal }),
    select: (page) => page.items.filter((m) => m.deleted_at === null),
  });
  // Die Seitenleiste ist vorgerendert: bis zur Hydration „lädt“ (siehe hydrated.ts)
  return useHydrationSafe(query);
}

/** CSS-Wert der Modulfarbe (`mod-03` → `var(--sg-mod-03)`). */
export function moduleColorVar(token: string): string {
  return `var(--sg-${token})`;
}

export function useCreateModule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ModuleCreate) => apiSend('POST', '/modules', ModuleSchema, { body: input }),
    // Rückgabe abwarten: Das Anlegen gilt erst als fertig, wenn die Seitenleiste aktuell ist
    onSuccess: () => client.invalidateQueries({ queryKey: ['modules'] }),
  });
}

export function useUpdateModule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ModuleUpdate }) =>
      apiSend('PATCH', `/modules/${encodeURIComponent(id)}`, ModuleSchema, { body: patch }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['modules'] }),
  });
}

// ---------------------------------------------------------------------------------------------
// Löschen mit Rückgängig (R15)
// ---------------------------------------------------------------------------------------------

/** So lange bleibt „Rückgängig“ möglich (R15). Erst danach geht `DELETE /modules/{id}` raus. */
export const UNDO_WINDOW_MS = 10_000;

interface PendingDelete {
  client: QueryClient;
  onFailed: () => void;
}

const pending = new Map<string, PendingDelete>();
const listeners = new Set<() => void>();
const EMPTY: ReadonlySet<string> = new Set();
let snapshot: ReadonlySet<string> = EMPTY;

function publish(): void {
  snapshot = new Set(pending.keys());
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** IDs von Modulen, die gerade ausgeblendet sind und nach Ablauf des Rückgängig-Fensters gelöscht werden. */
export function usePendingModuleDeletes(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
}

/** Module ohne die gerade zum Löschen vorgemerkten. */
export function useVisibleModules() {
  const query = useModules();
  const hidden = usePendingModuleDeletes();
  const modules = useMemo(() => query.data?.filter((m) => !hidden.has(m.id)), [query.data, hidden]);
  return { query, modules };
}

export function pendingModuleDeleteCount(): number {
  return pending.size;
}

async function sendDelete(id: string, keepalive: boolean): Promise<void> {
  try {
    await apiSend('DELETE', `/modules/${encodeURIComponent(id)}`, null, { keepalive });
  } catch (error) {
    // 404: Das Modul ist schon weg, also ist das Ziel erreicht
    if (error instanceof ApiRequestError && error.status === 404) return;
    throw error;
  }
}

async function commitDelete(id: string): Promise<void> {
  const entry = pending.get(id);
  if (!entry) return;
  try {
    await sendDelete(id, false);
  } catch {
    // Nicht gelöscht: Modul wieder einblenden und ruhig Bescheid geben
    pending.delete(id);
    publish();
    entry.onFailed();
    return;
  }
  // Erst nach dem Neuladen der Liste wieder „freigeben“, sonst blitzt das Modul kurz auf
  await entry.client.invalidateQueries({ queryKey: ['modules'] });
  pending.delete(id);
  publish();
}

/** Blendet das Modul sofort aus. Gelöscht wird erst bei {@link commitModuleDeletes} (Ablauf des Toasts). */
export function scheduleModuleDelete(
  client: QueryClient,
  module: Pick<Module, 'id'>,
  onFailed: () => void,
): void {
  if (pending.has(module.id)) return;
  pending.set(module.id, { client, onFailed });
  publish();
  ensurePageHideFlush();
}

/** Macht alle vorgemerkten Löschungen rückgängig. */
export function undoModuleDeletes(): void {
  pending.clear();
  publish();
}

/** Sendet alle vorgemerkten Löschungen. */
export function commitModuleDeletes(): void {
  for (const id of [...pending.keys()]) void commitDelete(id);
}

let flushRegistered = false;
/** Schließt jemand die App im Rückgängig-Fenster, geht das Löschen trotzdem raus (kleine Anfrage mit keepalive). */
function ensurePageHideFlush(): void {
  if (flushRegistered || typeof window === 'undefined') return;
  flushRegistered = true;
  window.addEventListener('pagehide', () => {
    for (const id of pending.keys()) void sendDelete(id, true).catch(() => {});
    pending.clear();
  });
}

/** Nur für Tests: alle vorgemerkten Löschungen verwerfen. */
export function resetPendingModuleDeletes(): void {
  pending.clear();
  publish();
}
