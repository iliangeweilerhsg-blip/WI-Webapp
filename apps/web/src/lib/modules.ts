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
import { apiGet, apiSend } from './api.ts';

/** Feste Palette der Modulfarben (07 §8), Werte in `packages/ui-tokens` */
export const MODULE_COLORS = Array.from({ length: 12 }, (_, i) => `mod-${String(i + 1).padStart(2, '0')}`);

/** Module aus `GET /modules` (erste Seite; für die Navigation reichen 100). */
export function useModules() {
  return useQuery({
    queryKey: ['modules'],
    queryFn: ({ signal }) => apiGet('/modules?limit=100', ModuleListSchema, { signal }),
    select: (page) => page.items.filter((m) => m.deleted_at === null),
  });
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
  timer: ReturnType<typeof setTimeout>;
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

async function sendDelete(id: string, keepalive: boolean): Promise<void> {
  await apiSend('DELETE', `/modules/${encodeURIComponent(id)}`, null, { keepalive });
}

async function commitDelete(id: string): Promise<void> {
  const entry = pending.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
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

/** Blendet das Modul sofort aus und löscht es nach {@link UNDO_WINDOW_MS}, falls niemand rückgängig macht. */
export function scheduleModuleDelete(
  client: QueryClient,
  module: Pick<Module, 'id'>,
  onFailed: () => void,
): void {
  if (pending.has(module.id)) return;
  const timer = setTimeout(() => void commitDelete(module.id), UNDO_WINDOW_MS);
  pending.set(module.id, { timer, client, onFailed });
  publish();
  ensurePageHideFlush();
}

export function undoModuleDelete(id: string): void {
  const entry = pending.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(id);
  publish();
}

let flushRegistered = false;
/** Schließt jemand die App im Rückgängig-Fenster, geht das Löschen trotzdem raus (kleine Anfrage mit keepalive). */
function ensurePageHideFlush(): void {
  if (flushRegistered || typeof window === 'undefined') return;
  flushRegistered = true;
  window.addEventListener('pagehide', () => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      void sendDelete(id, true).catch(() => {});
    }
    pending.clear();
  });
}

/** Nur für Tests: alle vorgemerkten Löschungen verwerfen. */
export function resetPendingModuleDeletes(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  publish();
}
