// Texte und Punkt der Aufnahme-Anzeige, gemeinsam für Statusleiste (Dashboard) und Aufnahme-Leiste.
import { createElement, type ReactElement } from 'react';
import type { RecordingKind, RecordingView } from '../../lib/recording/RecordingProvider.tsx';

export const RECORDING_LABEL: Record<RecordingKind, string> = {
  rec: 'REC',
  starting: 'Startet',
  waiting: 'Wartet auf anderen Tab',
  paused: 'Pausiert',
  'needs-start': 'Keine Aufnahme',
  'mic-denied': 'Zugriff verweigert',
  'mic-missing': 'Mikrofon fehlt',
  error: 'Aufnahme gestört',
  'other-tab': 'Aufnahme in anderem Tab',
  inactive: 'Nicht gestartet',
};

/**
 * Satz für Screenreader (`role="status"`), der sich nur beim Zustandswechsel ändert. `pauseHint`: Die Pause dauert
 * schon über 20 Minuten (UX-07).
 */
export function recordingStatusText(
  view: Pick<RecordingView, 'phase' | 'kind' | 'message'>,
  pauseHint: boolean,
): string {
  if (view.phase === 'pausiert' || view.kind === 'paused')
    return pauseHint ? 'Die Session ist seit über 20 Minuten pausiert.' : 'Die Session ist pausiert.';
  switch (view.kind) {
    case 'rec':
      return 'Die Aufnahme läuft.';
    case 'starting':
      return 'Die Aufnahme startet.';
    case 'other-tab':
      return 'Für die Aufnahme ist ein anderer Tab zuständig.';
    case 'inactive':
      return '';
    default:
      return `Es wird nicht aufgenommen. ${view.message ?? ''}`.trim();
  }
}

/** Punkt vor dem Zustand: rot nur bei REC, gefüllt bei „beendet“, sonst hohl */
export function RecordDot({ filled, record = false }: { filled: boolean; record?: boolean }): ReactElement {
  return createElement('span', {
    'aria-hidden': 'true',
    className: `inline-block size-2.5 shrink-0 rounded-full ${
      record ? 'bg-record' : filled ? 'bg-text-muted' : 'border-2 border-text-muted'
    }`,
  });
}
