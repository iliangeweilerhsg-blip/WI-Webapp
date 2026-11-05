'use client';

// Marker einer Session (T1-17, F-DSH-05). Zähler und Rückgängig-Liste liegen im Query-Cache der Session, nicht im State
// der Komponente (VERTRAEGE §16.3). Quellen: der REST-Snapshot, `marker.add`/`marker.remove` aus dem Strom
// `session:<id>` (iPad, anderer Tab) und die eigenen Marker, die sofort gezählt werden.
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import type { MarkerKind, SessionSnapshot, SyncOp } from '@sg/shared';
import { fetchSessionSnapshot, sessionStreamId } from '../../../lib/session-stream.ts';
import type { SyncClient } from '../../../lib/sync/client.ts';

export interface MarkerEntry {
  id: string;
  kind: MarkerKind;
}

export interface MarkerState {
  /** Alle bekannten, nicht entfernten Marker der Session */
  markers: MarkerEntry[];
  /** Eigene Marker dieses Tabs, älteste zuerst; `at` = Zeitpunkt des Setzens (für „Rückgängig innerhalb von 10 s“) */
  own: { id: string; at: number }[];
  /** Entfernte IDs: Ein älterer Snapshot oder ein später eintreffendes `marker.add` belebt sie nicht wieder */
  removed: string[];
}

export const EMPTY_MARKERS: MarkerState = { markers: [], own: [], removed: [] };

export const markerStateKey = (sessionId: string) => ['dashboard', 'markers', sessionId] as const;

/** Rückgängig gilt höchstens so lange nach dem Setzen (F-DSH-05) */
export const UNDO_WINDOW_MS = 10_000;

export function countByKind(markers: readonly MarkerEntry[]): Record<MarkerKind, number> {
  const counts: Record<MarkerKind, number> = { frage: 0, klausur: 0, verknuepfung: 0 };
  for (const m of markers) counts[m.kind] += 1;
  return counts;
}

export function addMarker(state: MarkerState, entry: MarkerEntry, own?: { at: number }): MarkerState {
  if (state.removed.includes(entry.id) || state.markers.some((m) => m.id === entry.id)) return state;
  return {
    ...state,
    markers: [...state.markers, entry],
    own: own ? [...state.own, { id: entry.id, at: own.at }] : state.own,
  };
}

export function removeMarker(state: MarkerState, id: string): MarkerState {
  return {
    markers: state.markers.filter((m) => m.id !== id),
    own: state.own.filter((o) => o.id !== id),
    removed: state.removed.includes(id) ? state.removed : [...state.removed, id],
  };
}

/** Snapshot übernehmen: Server-Stand, dazu eigene Marker, die der Core noch nicht kennt, ohne lokal entfernte. */
export function mergeSnapshot(state: MarkerState, snapshot: SessionSnapshot): MarkerState {
  const fromServer = snapshot.markers
    .filter((m) => m.deleted_at === null && !state.removed.includes(m.id))
    .map((m): MarkerEntry => ({ id: m.id, kind: m.kind }));
  const known = new Set(fromServer.map((m) => m.id));
  const pending = state.own
    .filter((o) => !known.has(o.id))
    .map((o) => state.markers.find((m) => m.id === o.id))
    .filter((m): m is MarkerEntry => m !== undefined);
  return { ...state, markers: [...fromServer, ...pending] };
}

type SyncSource = Pick<SyncClient, 'subscribe' | 'onEvent' | 'connectionState'>;

export function useMarkers(sessionId: string, client: SyncSource | null) {
  const queryClient = useQueryClient();
  const query = useQuery<MarkerState>({
    queryKey: markerStateKey(sessionId),
    queryFn: () => queryClient.getQueryData<MarkerState>(markerStateKey(sessionId)) ?? EMPTY_MARKERS,
    enabled: false,
    initialData: EMPTY_MARKERS,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (!client) return;
    return followMarkers(queryClient, sessionId, client);
  }, [client, queryClient, sessionId]);

  /** Stand direkt aus dem Cache (nicht aus dem letzten Rendern), damit schnelle Tasten nacheinander alle zählen */
  const get = useCallback(
    () => queryClient.getQueryData<MarkerState>(markerStateKey(sessionId)) ?? EMPTY_MARKERS,
    [queryClient, sessionId],
  );
  const update = useCallback(
    (fn: (state: MarkerState) => MarkerState) =>
      queryClient.setQueryData<MarkerState>(markerStateKey(sessionId), (old) => fn(old ?? EMPTY_MARKERS)),
    [queryClient, sessionId],
  );
  return { state: query.data ?? EMPTY_MARKERS, get, update };
}

/** Snapshot laden, Strom abonnieren, bei Fehlern mit der nächsten funktionierenden Verbindung neu versuchen. */
function followMarkers(queryClient: QueryClient, sessionId: string, client: SyncSource): () => void {
  const key = markerStateKey(sessionId);
  const stream = sessionStreamId(sessionId);
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;
  let running = false;
  let needsReload = false;
  const update = (fn: (state: MarkerState) => MarkerState) =>
    queryClient.setQueryData<MarkerState>(key, (old) => fn(old ?? EMPTY_MARKERS));

  const load = async () => {
    const snapshot = await fetchSessionSnapshot(queryClient, sessionId);
    if (!cancelled) update((state) => mergeSnapshot(state, snapshot));
    return { lastSeq: snapshot.stream_seq, lastOpId: snapshot.stream_op_id };
  };

  const onOp = (op: SyncOp) => {
    if (op.kind === 'marker.add' && op.data.session_id === sessionId) {
      update((state) => addMarker(state, { id: op.data.marker_id, kind: op.data.kind }));
    } else if (op.kind === 'marker.remove') {
      update((state) => removeMarker(state, op.data.marker_id));
    }
  };

  const establish = async () => {
    if (running || cancelled) return;
    running = true;
    try {
      const from = await load();
      if (cancelled) return;
      unsubscribe?.();
      unsubscribe = client.subscribe(stream, from, onOp, { onReset: () => load() }) ?? null;
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
