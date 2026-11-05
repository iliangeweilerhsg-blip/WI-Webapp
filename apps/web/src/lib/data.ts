'use client';

// Daten und Papierkorb (T1-18, VERTRAEGE §7.5): Hooks für Backups und Papierkorb
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BackupOverviewSchema,
  BackupRunSchema,
  SettingsSchema,
  TrashListSchema,
  TrashRestoreResultSchema,
  type SettingsUpdate,
  type TrashKind,
} from '@sg/shared';
import { apiGet, apiSend, type Parser } from './api.ts';
import { useHydrationSafe } from './hydrated.ts';

/** Antwort von `DELETE /trash` (kein Schema in packages/schemas) */
const EmptiedParser: Parser<{ purged_count: number }> = {
  safeParse(value) {
    const n = (value as { purged_count?: unknown } | null)?.purged_count;
    return typeof n === 'number'
      ? { success: true, data: { purged_count: n } }
      : { success: false, error: { message: 'purged_count fehlt' } };
  },
};

export function useBackups() {
  const query = useQuery({
    queryKey: ['backups'],
    queryFn: ({ signal }) => apiGet('/backups?limit=10', BackupOverviewSchema, { signal }),
    // Solange ein Lauf läuft, regelmäßig nachsehen
    refetchInterval: (q) => (q.state.data?.status.running ? 3_000 : false),
  });
  return useHydrationSafe(query);
}

export function useStartBackup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiSend('POST', '/backup', BackupRunSchema),
    onSettled: () => client.invalidateQueries({ queryKey: ['backups'] }),
  });
}

export function useSettings() {
  const query = useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) => apiGet('/settings', SettingsSchema, { signal }),
  });
  return useHydrationSafe(query);
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (update: SettingsUpdate) => apiSend('PATCH', '/settings', SettingsSchema, { body: update }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['settings'] }),
        client.invalidateQueries({ queryKey: ['backups'] }),
      ]),
  });
}

/** Papierkorb seitenweise (`next_cursor`). Der Aufrufer zeigt bis zur Hydration „lädt“ (siehe hydrated.ts). */
export function useTrash(kind?: TrashKind) {
  return useInfiniteQuery({
    queryKey: ['trash', kind ?? 'alle'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiGet(
        `/trash?limit=50${kind ? `&kind=${kind}` : ''}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        TrashListSchema,
        { signal },
      ),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
}

export function useRestoreTrashItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiSend('POST', `/trash/${encodeURIComponent(id)}/restore`, TrashRestoreResultSchema),
    // Wiederherstellen und Löschen verändern Listen aller Bereiche
    onSuccess: () => client.invalidateQueries(),
  });
}

export function usePurgeTrashItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend('DELETE', `/trash/${encodeURIComponent(id)}`, null),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useEmptyTrash() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiSend('DELETE', '/trash', EmptiedParser),
    onSuccess: () => client.invalidateQueries(),
  });
}
