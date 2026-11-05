'use client';

import type { AutoStopStatus } from '../../lib/autostop/rules.ts';

export interface AutoStopHintProps {
  /** Zustand aus `useAutoStop().status`; nur `hinweis` zeigt etwas */
  status: AutoStopStatus;
  /** Länge der Verlängerung für die Beschriftung (`lecture.auto_stop_extend_min`) */
  extendMinutes: number;
  /** „Verlängern“ (`useAutoStop().extend`) */
  onExtend: () => void;
  /** `extend` läuft: Knopf gesperrt */
  extending?: boolean;
  /** Meldung eines gescheiterten `extend` */
  error?: string | null;
}

/** 42 s -> „0:42“, 125 s -> „2:05“. Aufgerundet, damit „0:00“ erst beim Stopp erscheint. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Stopp-Hinweis (F-SES-03, 07 §3.3): eine Textzeile für die Statusleiste, kein Dialog, kein Overlay, ohne Animation.
 * Sie erscheint 60 s vor dem Stopp und verschwindet von selbst, wenn der Zustand wieder `ok` ist (Sprache erkannt
 * oder verlängert).
 *
 * Barrierefreiheit: Der Container ist ein dauerhaft eingehängtes `role="status"` (höflich, `aria-live="polite"`
 * implizit). Die Sekunden laufen nur sichtbar (`aria-hidden`); für Screenreader steht ein fester Satz da, der sich
 * nicht ändert und darum genau einmal vorgelesen wird.
 */
export function AutoStopHint({
  status,
  extendMinutes,
  onExtend,
  extending = false,
  error = null,
}: AutoStopHintProps) {
  const visible = status.state === 'hinweis';
  return (
    <div className="flex items-center gap-2 text-sm" data-testid="autostop-hint">
      <div role="status">
        {visible ? (
          <>
            <span aria-hidden="true">Aufnahme endet in {formatRemaining(status.remainingMs)}</span>
            <span className="sr-only">Aufnahme endet gleich.</span>
          </>
        ) : null}
        {visible && error ? <span className="ml-2 text-text-muted">{error}</span> : null}
      </div>
      {visible ? (
        <button
          type="button"
          onClick={onExtend}
          disabled={extending}
          aria-label={`Aufnahme um ${extendMinutes} Minuten verlängern`}
          className="font-medium text-accent hover:underline disabled:opacity-50"
        >
          Verlängern
        </button>
      ) : null}
    </div>
  );
}
