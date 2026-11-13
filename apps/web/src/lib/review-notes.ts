'use client';

// Notizen im Rückblick (F-NAC-02 rechte Spalte, VERTRAEGE §18.9): Seiten der Session, ihre Striche und der Snapshot
// mit Markern und Fotos. Es gibt nur lesende Aufrufe vorhandener Endpunkte; der Rückblick schreibt nichts.
import { useQuery } from '@tanstack/react-query';
import type { Page, PageStrokes, SessionSnapshot } from '@sg/shared';
import { fetchNotebookPages, fetchNotebooks, fetchPageStrokes } from './ink.ts';
import { fileUrl } from './material.ts';
import { getSessionSnapshot, sessionSnapshotKey } from './session-stream.ts';

export const sessionPagesKey = (sessionId: string) => ['review', 'pages', sessionId] as const;
export const pageStrokesKey = (pageId: string) => ['review', 'strokes', pageId] as const;

/**
 * Alle Notizseiten der Session: `GET /notebooks?module_id`, dann `GET /notebooks/{id}/pages` je Notizbuch, Seiten mit
 * `session_id` = Session (§18.9). Reihenfolge: Notizbuch, dann `index`.
 */
export async function fetchSessionPages(
  moduleId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<Page[]> {
  const notebooks = await fetchNotebooks(moduleId, signal);
  const lists = await Promise.all(
    notebooks.items.filter((n) => n.deleted_at === null).map((n) => fetchNotebookPages(n.id, signal)),
  );
  return lists.flatMap((l) => l.items).filter((p) => p.session_id === sessionId && p.deleted_at === null);
}

export function useSessionPages(moduleId: string, sessionId: string, enabled = true) {
  return useQuery<Page[]>({
    queryKey: sessionPagesKey(sessionId),
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    queryFn: ({ signal }) => fetchSessionPages(moduleId, sessionId, signal),
  });
}

/** Marker und Fotos kommen aus dem Snapshot der Session (`GET /sessions/{id}/snapshot`). */
export function useSessionSnapshot(sessionId: string, enabled = true) {
  return useQuery<SessionSnapshot>({
    queryKey: sessionSnapshotKey(sessionId),
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    queryFn: ({ signal }) => getSessionSnapshot(sessionId, signal),
  });
}

/**
 * Striche einer Seite. Nur für sichtbare Seiten (`enabled`); `gcTime` kurz, damit Striche nicht im Speicher bleiben,
 * wenn man durch viele Folien blättert (#79).
 */
export function usePageStrokes(pageId: string, enabled: boolean) {
  return useQuery<PageStrokes>({
    queryKey: pageStrokesKey(pageId),
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
    gcTime: 60_000,
    queryFn: ({ signal }) => fetchPageStrokes(pageId, signal),
  });
}

/** Datei eines Tafel-Fotos (`GET /photos/{id}/file`) */
export const photoFileUrl = (photoId: string): string =>
  fileUrl(`/photos/${encodeURIComponent(photoId)}/file`);
