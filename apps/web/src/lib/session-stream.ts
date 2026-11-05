// Gemeinsame Hilfen für Dashboard-Komponenten, die den Strom `session:<id>` lesen und beschreiben
// (Folien T1-05, Marker T1-17): Snapshot per REST (VERTRAEGE §7.2), Stromname und Sitzungszeit.
import type { QueryClient } from '@tanstack/react-query';
import { SessionSnapshotSchema, type SessionSnapshot } from '@sg/shared';
import { apiGet } from './api.ts';

export function sessionStreamId(sessionId: string): string {
  return `session:${sessionId}`;
}

export const sessionSnapshotKey = (sessionId: string) => ['session-snapshot', sessionId] as const;

/** `GET /sessions/{id}/snapshot`: Live-Stand samt `stream_seq`/`stream_op_id` zum Abonnieren (§11.1). */
export function getSessionSnapshot(sessionId: string, signal?: AbortSignal): Promise<SessionSnapshot> {
  return apiGet(`/sessions/${encodeURIComponent(sessionId)}/snapshot`, SessionSnapshotSchema, { signal });
}

/** Immer frisch laden (kein Cache-Treffer): der Stand dient als Anker für das Abonnement. */
export function fetchSessionSnapshot(queryClient: QueryClient, sessionId: string): Promise<SessionSnapshot> {
  return queryClient.fetchQuery({
    queryKey: sessionSnapshotKey(sessionId),
    queryFn: ({ signal }) => getSessionSnapshot(sessionId, signal),
    staleTime: 0,
  });
}

/** Sitzungszeit in ms seit `session.started_at`. Negative Werte (Uhrversatz) werden 0 (Schema `SessionMs`). */
export function sessionTimeMs(startedAt: number, eventAt: number): number {
  return Math.max(0, Math.round(eventAt - startedAt));
}

/**
 * Jetzt in synchronisierter Zeit (VERTRAEGE §11.5): lokale Uhr + gemessener Versatz des Sync-Clients. `started_at`
 * stammt von der Uhr des Cores, `t_ms` muss darum gegen diese Zeit gerechnet werden. Ohne Messung gilt Versatz 0.
 */
export function syncedNowMs(client: { clockOffsetMs?: number | null } | null): number {
  return Date.now() + (client?.clockOffsetMs ?? 0);
}
