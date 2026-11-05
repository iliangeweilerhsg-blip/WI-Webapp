// PLATZHALTER für T1-05 (Folien blättern, `slide_event`, Tastenkürzel; F-DSH-02). T1-05 ersetzt den Inhalt dieser Datei
// und behält Name und Props bei (Schnittstelle: docs/VERTRAEGE.md, Scope-Tabelle bei T1-04). Das Dashboard bindet
// nur `SlidesPanel` ein.
import type { SyncClient } from '../../../lib/sync/client.ts';

export interface SlidesPanelProps {
  sessionId: string;
  moduleId: string;
  /** `session.slide_deck_id`; `null` = folienloser Modus */
  slideDeckId: string | null;
  /** Die Session läuft oder ist pausiert (sonst nur ansehen, nicht blättern) */
  active: boolean;
  /** `session.started_at` in ms; `slide.change` braucht `t_ms` = Ereigniszeit − `started_at`. `null` = nicht gestartet */
  startedAt: number | null;
  /** Sync-Client dieses Tabs; `null` vor dem ersten Effekt */
  client: SyncClient | null;
}

export function SlidesPanel({ slideDeckId }: SlidesPanelProps) {
  return (
    <div data-testid="slides-panel" className="flex h-full items-center justify-center p-6 text-center">
      <p className="text-md text-text-muted">
        {slideDeckId === null ? 'Folien kommen später – einfach mitschreiben' : 'Folien-Ansicht folgt'}
      </p>
    </div>
  );
}
