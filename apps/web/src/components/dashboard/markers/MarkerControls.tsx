// PLATZHALTER für T1-17 (Marker vom Mac, F-DSH-05): Zähler ❓ ⚠️ 🔗 und Tasten F, K, L. T1-17 ersetzt den Inhalt dieser
// Datei und behält Name und Props bei (Schnittstelle: docs/VERTRAEGE.md, Scope-Tabelle bei T1-04). Die Statusleiste
// bindet nur `MarkerControls` ein.
import type { SyncClient } from '../../../lib/sync/client.ts';

export interface MarkerControlsProps {
  sessionId: string;
  /** Die Session läuft oder ist pausiert (sonst keine neuen Marker) */
  active: boolean;
  /** `session.started_at` in ms; Grundlage der Sitzungszeit eines Markers. `null` = nicht gestartet */
  startedAt: number | null;
  /** Sync-Client dieses Tabs; `null` vor dem ersten Effekt */
  client: SyncClient | null;
}

export function MarkerControls(_props: MarkerControlsProps) {
  return (
    <span data-testid="marker-controls" className="text-sm text-text-muted">
      Marker folgen
    </span>
  );
}
