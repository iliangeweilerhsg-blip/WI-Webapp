'use client';

// Aktuelle Folie einer Session (T1-05). Der Stand liegt im Query-Cache, nicht im State der Komponente: Unter `lg`
// wird das Panel ausgehängt (VERTRAEGE §16.3) und muss beim Einhängen ohne Flackern denselben Stand zeigen.
// Quellen: der REST-Snapshot (letztes `slide_event`), Operationen `slide.change` anderer Geräte (iPad, anderer Tab)
// aus dem Strom `session:<id>` und die eigenen Wechsel.
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import type { SessionSnapshot, SyncOp } from '@sg/shared';
import { fetchSessionSnapshot, sessionStreamId } from '../../../lib/session-stream.ts';
import type { SyncClient } from '../../../lib/sync/client.ts';

export interface SlidePosition {
  /** 1-basiert, wie `slide_event.slide_index` */
  index: number;
  /** Sitzungszeit des Wechsels; entscheidet, ob ein Snapshot neuer ist als der lokale Stand */
  tMs: number;
}

export const slidePositionKey = (sessionId: string) => ['dashboard', 'slide-position', sessionId] as const;

/** Letzter nicht gelöschter Folienwechsel des Snapshots (bei gleicher Zeit der spätere in der Liste). */
export function latestSlideEvent(snapshot: SessionSnapshot): SlidePosition | null {
  let best: SlidePosition | null = null;
  for (const e of snapshot.slide_events) {
    if (e.deleted_at !== null) continue;
    if (best === null || e.t_ms >= best.tMs) best = { index: e.slide_index, tMs: e.t_ms };
  }
  return best;
}

type SyncSource = Pick<SyncClient, 'subscribe' | 'onEvent' | 'connectionState'>;

/**
 * Hält den Stand aktuell und liefert ihn: lädt den Snapshot, abonniert den Strom ab dessen Position und übernimmt
 * fremde Folienwechsel. `setPosition` schreibt einen eigenen Wechsel in den Cache.
 */
export function useSlidePosition(sessionId: string, client: SyncSource | null) {
  const queryClient = useQueryClient();
  const query = useQuery<SlidePosition | null>({
    queryKey: slidePositionKey(sessionId),
    queryFn: () => queryClient.getQueryData<SlidePosition | null>(slidePositionKey(sessionId)) ?? null,
    enabled: false,
    initialData: null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (!client) return;
    return followSlides(queryClient, sessionId, client);
  }, [client, queryClient, sessionId]);

  const setPosition = useCallback(
    (position: SlidePosition) => queryClient.setQueryData(slidePositionKey(sessionId), position),
    [queryClient, sessionId],
  );
  /** Aktueller Stand direkt aus dem Cache (nicht aus dem letzten Rendern): zwei Tasten kurz nacheinander zählen beide */
  const getPosition = useCallback(
    () => queryClient.getQueryData<SlidePosition | null>(slidePositionKey(sessionId)) ?? null,
    [queryClient, sessionId],
  );
  return { position: query.data ?? null, setPosition, getPosition };
}

/** Snapshot laden, Strom abonnieren, bei Fehlern mit der nächsten funktionierenden Verbindung neu versuchen. */
function followSlides(queryClient: QueryClient, sessionId: string, client: SyncSource): () => void {
  const key = slidePositionKey(sessionId);
  const stream = sessionStreamId(sessionId);
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;
  let running = false;
  let needsReload = false;

  /** Snapshot übernehmen, wenn er neuer ist als der lokale Stand; Rückgabe: Position für das Abonnement */
  const load = async () => {
    const snapshot = await fetchSessionSnapshot(queryClient, sessionId);
    if (!cancelled) {
      const latest = latestSlideEvent(snapshot);
      const local = queryClient.getQueryData<SlidePosition | null>(key) ?? null;
      if (latest && (local === null || latest.tMs > local.tMs)) queryClient.setQueryData(key, latest);
    }
    return { lastSeq: snapshot.stream_seq, lastOpId: snapshot.stream_op_id };
  };

  const onOp = (op: SyncOp) => {
    if (op.kind !== 'slide.change' || op.data.session_id !== sessionId) return;
    queryClient.setQueryData<SlidePosition>(key, { index: op.data.slide_index, tMs: op.data.t_ms });
  };

  const establish = async () => {
    if (running || cancelled) return;
    running = true;
    try {
      const from = await load();
      if (cancelled) return;
      unsubscribe?.();
      unsubscribe =
        client.subscribe(stream, from, onOp, {
          // Bei `reset` den REST-Stand neu laden und dessen Position melden (§11.1)
          // Scheitert das Laden, bleibt der Strom stumm: neu aufbauen, sobald die Verbindung wieder steht
          onReset: async () => {
            try {
              return await load();
            } catch (error) {
              needsReload = true;
              throw error;
            }
          },
        }) ?? null;
      needsReload = false;
    } catch {
      needsReload = true;
    } finally {
      running = false;
    }
  };

  void establish();
  const offConnection = client.onEvent('connection', (c) => {
    if (c.state === 'online' && needsReload) void establish();
  });
  return () => {
    cancelled = true;
    offConnection();
    unsubscribe?.();
    unsubscribe = null;
  };
}
