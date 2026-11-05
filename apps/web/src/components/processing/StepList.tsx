'use client';

// Verarbeitungsstand als ruhige Schrittliste (07 §6, VERTRAEGE §18.2 „Anzeige“): ein Schritt je Zeile, kein Balken,
// keine Prozentangaben, keine Benachrichtigung. Zustände: ✓ fertig, … läuft, – wartet, „nicht fertig“ mit
// „Erneut versuchen“. Steht `audio.finalize` auf `fehler`, gibt es zusätzlich „Mit vorhandenem Audio fortfahren“.
import type { PipelineStep, Session } from '@sg/shared';
import { canContinueWithAudio, retryStep, stepRows, type StepState } from '../../lib/transcript.ts';

const MARK: Record<StepState, string> = {
  fertig: '✓',
  laeuft: '…',
  wartet: '–',
  fehler: '',
  abgebrochen: '',
};

const SPOKEN: Record<StepState, string> = {
  fertig: 'fertig',
  laeuft: 'läuft',
  wartet: 'wartet',
  fehler: 'nicht fertig',
  abgebrochen: 'nicht fertig',
};

export interface StepListProps {
  processing: Session['processing'] | undefined;
  /** Eine Aktion wird gerade an den Core geschickt */
  busy?: boolean;
  error?: string | null;
  onRetry?: (fromStep: PipelineStep) => void;
}

const button =
  'inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised aria-disabled:opacity-60';

export function StepList({ processing, busy = false, error = null, onRetry }: StepListProps) {
  const rows = stepRows(processing);
  if (rows.length === 0) return null;
  const retry = retryStep(processing);
  const resume = canContinueWithAudio(processing);

  return (
    <section
      aria-labelledby="processing-title"
      data-testid="step-list"
      className="rounded-lg border border-border bg-surface px-4 py-3"
    >
      <h2 id="processing-title" className="text-sm font-medium text-text-muted">
        Verarbeitung
      </h2>
      {/* polite: Ein Wechsel von „läuft“ auf „fertig“ wird angesagt, ohne zu unterbrechen */}
      <ul aria-live="polite" className="mt-2 flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.step}
            data-step={row.step}
            data-state={row.state}
            className="flex items-baseline gap-3 text-md"
          >
            <span aria-hidden="true" className="w-4 shrink-0 text-center text-text-muted">
              {MARK[row.state]}
            </span>
            <span>{row.label}</span>
            {row.state === 'fehler' || row.state === 'abgebrochen' ? (
              <span className="text-sm text-text-muted">nicht fertig</span>
            ) : (
              <span className="sr-only">{SPOKEN[row.state]}</span>
            )}
          </li>
        ))}
      </ul>
      {retry && onRetry ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={button}
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onRetry(retry);
            }}
          >
            Erneut versuchen
          </button>
          {resume ? (
            <button
              type="button"
              className={button}
              aria-disabled={busy}
              onClick={() => {
                if (!busy) onRetry('transcribe');
              }}
            >
              Mit vorhandenem Audio fortfahren
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-text-muted">
          {error}
        </p>
      ) : null}
    </section>
  );
}
