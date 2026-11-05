'use client';

import { useEffect, useRef } from 'react';
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
  /** Kurze Meldung eines gescheiterten `extend` oder Stopps (einzeilig) */
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
 * Wortlaut laut Spezifikation: „Stoppt gleich · weiter aufnehmen“, die Restzeit klein dahinter. Sie erscheint
 * `auto_stop_warning_s` vor dem Stopp und verschwindet von selbst, wenn der Zustand wieder `ok` ist (Sprache
 * erkannt oder verlängert).
 *
 * Barrierefreiheit: Der Container ist ein dauerhaft eingehängtes `role="status"` (höflich, `aria-live="polite"`
 * implizit). Die Sekunden laufen nur sichtbar (`aria-hidden`); für Screenreader steht ein fester Satz da, der sich
 * nicht ändert und darum genau einmal vorgelesen wird. Verschwindet der Knopf nach dem Tippen, wandert der Fokus auf
 * den Container (`tabIndex=-1`), statt auf `body` zu fallen.
 */
export function AutoStopHint({
  status,
  extendMinutes,
  onExtend,
  extending = false,
  error = null,
}: AutoStopHintProps) {
  const visible = status.state === 'hinweis';
  const container = useRef<HTMLDivElement>(null);
  const focusBack = useRef(false);

  useEffect(() => {
    if (visible || !focusBack.current) return;
    focusBack.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) container.current?.focus();
  }, [visible]);

  return (
    <div className="flex items-center gap-2 text-sm whitespace-nowrap" data-testid="autostop-hint">
      <div ref={container} role="status" tabIndex={-1} className="flex items-center gap-2 outline-none">
        {visible ? (
          <>
            <span aria-hidden="true">
              Stoppt gleich{' '}
              <span className="text-xs text-text-muted">{formatRemaining(status.remainingMs)}</span>
            </span>
            <span className="sr-only">Aufnahme stoppt gleich.</span>
          </>
        ) : null}
        {error ? <span className="max-w-48 truncate text-text-muted">{error}</span> : null}
      </div>
      {visible ? (
        <button
          type="button"
          onClick={() => {
            focusBack.current = true;
            onExtend();
          }}
          disabled={extending}
          aria-label={`Weiter aufnehmen, Aufnahme um ${extendMinutes} Minuten verlängern`}
          className="font-medium text-accent hover:underline disabled:opacity-50"
        >
          weiter aufnehmen
        </button>
      ) : null}
    </div>
  );
}
