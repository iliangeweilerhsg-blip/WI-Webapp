'use client';

// Marker vom Mac (T1-17, F-DSH-05): Zähler ❓ ⚠️ 🔗 in der Statusleiste, Tasten F, K, L oder Klick. Jeder Marker geht als
// Operation `marker.add` mit Sitzungszeit in den Strom der Session (VERTRAEGE §11.3). Stumme Bestätigung: Der Zähler zählt
// hoch und wird 300 ms hervorgehoben. ⌘Z (Mac) bzw. Strg+Z nimmt den letzten eigenen Marker innerhalb von 10 s mit
// `marker.remove` zurück.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarkerKind } from '@sg/shared';
import { sessionStreamId, sessionTimeMs, syncedNowMs } from '../../../lib/session-stream.ts';
import { isEditableTarget, isMacPlatform } from '../../../lib/shortcuts.ts';
import {
  SyncHandedOverError,
  SyncNotConnectedError,
  SyncNotLeaderError,
  SyncRejectedError,
  type SyncClient,
} from '../../../lib/sync/client.ts';
import { uuidv7 } from '../../../lib/uuid.ts';
import { UNDO_WINDOW_MS, addMarker, countByKind, removeMarker, useMarkers } from './use-markers.ts';

export interface MarkerControlsProps {
  sessionId: string;
  /** Die Session läuft oder ist pausiert (sonst keine neuen Marker) */
  active: boolean;
  /** `session.started_at` in ms; Grundlage der Sitzungszeit eines Markers. `null` = nicht gestartet */
  startedAt: number | null;
  /** Sync-Client dieses Tabs; `null` vor dem ersten Effekt */
  client: SyncClient | null;
}

/** Hervorhebung des Zählers nach dem Setzen */
export const FLASH_MS = 300;

const MARKERS: { kind: MarkerKind; key: 'f' | 'k' | 'l'; icon: string; label: string }[] = [
  { kind: 'frage', key: 'f', icon: '❓', label: 'Frage' },
  { kind: 'klausur', key: 'k', icon: '⚠️', label: 'Klausur' },
  { kind: 'verknuepfung', key: 'l', icon: '🔗', label: 'Verknüpfung' },
];

/** Welcher Marker gehört zu dieser Taste? `'undo'` für ⌘Z bzw. Strg+Z, sonst `null`. */
export function markerKeyAction(
  e: KeyboardEvent,
  mac: boolean = isMacPlatform(),
): MarkerKind | 'undo' | null {
  if (e.defaultPrevented || e.repeat || e.isComposing || e.altKey) return null;
  const target = e.target as HTMLElement | null;
  // In Eingabefeldern gehören die Tasten dem Feld; Trennlinien und Reiter nutzen Tasten selbst (VERTRAEGE §16.3)
  if (isEditableTarget(target)) return null;
  if (target?.closest?.('[role="separator"], [role="tab"]')) return null;
  const key = e.key.toLowerCase();
  const modifier = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (key === 'z') return modifier && !e.shiftKey ? 'undo' : null;
  if (e.metaKey || e.ctrlKey || e.shiftKey) return null;
  return MARKERS.find((m) => m.key === key)?.kind ?? null;
}

export function MarkerControls({ sessionId, active, startedAt, client }: MarkerControlsProps) {
  const { state, get, update } = useMarkers(sessionId, client);
  const counts = countByKind(state.markers);
  const [flash, setFlash] = useState<MarkerKind | null>(null);
  const [failed, setFailed] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabled = active && startedAt !== null && client !== null;

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const live = useRef({ enabled, startedAt, client });
  live.current = { enabled, startedAt, client };

  const add = useCallback(
    (kind: MarkerKind) => {
      const { enabled: ok, startedAt: start, client: sync } = live.current;
      if (!ok || start === null || !sync) return;
      const eventAt = syncedNowMs(sync);
      const id = uuidv7(eventAt);
      update((s) => addMarker(s, { id, kind }, { at: eventAt }));
      setFlash(kind);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
      sync
        .send({
          stream: sessionStreamId(sessionId),
          kind: 'marker.add',
          data: {
            marker_id: id,
            session_id: sessionId,
            kind,
            t_ms: sessionTimeMs(start, eventAt),
            page_id: null,
            position: null,
            note: null,
            source: 'mac',
          },
        })
        .then(() => setFailed(false))
        .catch((error: unknown) => {
          // Übergeben: Der neue Leader sendet die Operation, der Marker gilt weiter
          if (error instanceof SyncHandedOverError) return;
          // Nicht in die Warteschlange gekommen (kein Leader, keine Verbindung) oder abgelehnt (liegt in der
          // Fehlerablage): Der Marker gilt nicht, aus Zähler und Rückgängig-Liste
          if (
            error instanceof SyncNotLeaderError ||
            error instanceof SyncNotConnectedError ||
            error instanceof SyncRejectedError
          ) {
            update((s) => removeMarker(s, id));
          }
          setFailed(true);
        });
    },
    [sessionId, update],
  );

  /** Letzten eigenen Marker innerhalb von 10 s zurücknehmen. `false`, wenn keiner zurückzunehmen ist. */
  const undo = useCallback((): boolean => {
    const { client: sync } = live.current;
    if (!sync) return false;
    const now = syncedNowMs(sync);
    const last = get().own.at(-1);
    if (!last || now - last.at > UNDO_WINDOW_MS) return false;
    update((s) => removeMarker(s, last.id));
    sync
      .send({ stream: sessionStreamId(sessionId), kind: 'marker.remove', data: { marker_id: last.id } })
      .catch((error: unknown) => {
        if (!(error instanceof SyncHandedOverError)) setFailed(true);
      });
    return true;
  }, [get, update, sessionId]);

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      const action = markerKeyAction(e);
      if (action === null) return;
      if (action === 'undo') {
        // Ohne Marker zum Zurücknehmen bleibt ⌘Z unberührt
        if (undo()) e.preventDefault();
        return;
      }
      e.preventDefault();
      add(action);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, add, undo]);

  return (
    <span data-testid="marker-controls" className="inline-flex items-center gap-1 text-sm text-text-muted">
      {MARKERS.map((m) => (
        <button
          key={m.kind}
          type="button"
          // Kein Fokus per Maus oder Tab: Sonst löste die Leertaste danach diese Schaltfläche aus (zweiter Marker)
          // statt die Folie weiterzuschalten. Per Tastatur setzt man Marker mit F, K, L.
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => add(m.kind)}
          disabled={!enabled}
          aria-label={`${m.label} markieren, ${counts[m.kind]}`}
          aria-keyshortcuts={m.key.toUpperCase()}
          title={`${m.label} (Taste ${m.key.toUpperCase()})`}
          data-flash={flash === m.kind ? 'true' : undefined}
          className={`inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-surface-raised hover:text-text disabled:opacity-50 ${
            flash === m.kind ? 'bg-accent-soft text-text' : ''
          }`}
        >
          <span aria-hidden="true">{m.icon}</span>
          <span aria-hidden="true" data-testid={`marker-count-${m.kind}`}>
            {counts[m.kind]}
          </span>
        </button>
      ))}
      {failed ? <span role="status">Nicht gesendet</span> : null}
    </span>
  );
}
