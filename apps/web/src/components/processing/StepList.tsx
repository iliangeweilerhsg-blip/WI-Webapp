'use client';

// Verarbeitungsstand als ruhige Schrittliste (07 §6, VERTRAEGE §18.2 „Anzeige“): ein Schritt je Zeile, kein Balken,
// keine Prozentangaben, keine Benachrichtigung. Zustände: ✓ fertig, … läuft, – wartet, „nicht fertig“ mit
// „Erneut versuchen“. Steht `audio.finalize` auf `fehler`, gibt es zusätzlich „Mit vorhandenem Audio fortfahren“.
//
// Konzept-Schritte (VERTRAEGE §20.10): Ist die KI nicht eingerichtet oder das Monatsbudget erreicht, steht das ruhig
// statt „nicht fertig“ da. Steht `transcribe` auf `fehler`, gibt es zusätzlich „Konzepte nur aus Folien“.
import Link from 'next/link';
import type { AiStatus, PipelineStep, Session } from '@sg/shared';
import { CONCEPT_STEPS } from '../../lib/concepts.ts';
import { AI_SETTINGS_HREF, aiNotConfigured, monthLabel } from '../../lib/costs.ts';
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
  /** Stand der KI (`GET /ai/status`); ohne Angabe gelten die bisherigen Texte */
  ai?: AiStatus | null | undefined;
  /**
   * Eine andere Session läuft oder ist pausiert (UX-05). Der Core hält dann schwere Jobs zurück (VERTRAEGE §3), nennt
   * aber nicht, welche. Darum steht nur ein allgemeiner Hinweis, wenn ein Schritt wartet, ohne die Liste zu kopieren.
   */
  lectureRunning?: boolean;
  /**
   * Die Session hat Konzepte, aber keinen Schritt „Karten“ (ältere Session): dann bietet die Liste „Karten erzeugen“
   * an (VERTRAEGE §21.10)
   */
  cardsMissing?: boolean;
}

/** Ruhiger Grund, warum ein Konzept-Schritt nicht fertig ist; `null` = „nicht fertig“ */
export function aiReason(step: PipelineStep, ai: AiStatus | null | undefined): string | null {
  if (!ai) return null;
  // Karten pausieren schon ab 80 % des Monatsbudgets (VERTRAEGE §21.6): ruhig sagen, warum, und wie es weitergeht
  if (step === 'cards.generate') {
    if (aiNotConfigured(ai)) return 'KI nicht eingerichtet';
    return ai.budget.warn ? 'Karten pausiert · KI-Budget' : null;
  }
  if (!CONCEPT_STEPS.includes(step)) return null;
  if (aiNotConfigured(ai)) return 'KI nicht eingerichtet';
  if (ai.budget.reached) return `KI-Budget für ${monthLabel(ai.budget.month)} erreicht`;
  return null;
}

/**
 * Schritte, die der Worker auch während einer laufenden Session abholt (Erlaubnisliste `LIGHT_JOB_TYPES` in
 * `services/worker/src/sg_worker/jobs.py`, VERTRAEGE §3). Alle anderen gelten als gehalten, auch ein neuer Schritt.
 */
const LIGHT_STEPS: ReadonlySet<PipelineStep> = new Set<PipelineStep>(['audio.finalize', 'align.log']);

const button =
  'inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised aria-disabled:opacity-60';

export function StepList({
  processing,
  busy = false,
  error = null,
  onRetry,
  ai,
  lectureRunning = false,
  cardsMissing = false,
}: StepListProps) {
  const rows = stepRows(processing);
  if (rows.length === 0) return null;
  const retry = retryStep(processing);
  const resume = canContinueWithAudio(processing);
  const slidesOnly = processing?.transcribe === 'fehler';
  // Pause durch das Budget: statt „Erneut versuchen“ steht dort „Karten erzeugen“ (der Nutzer erhöht erst das Budget)
  const cardsPaused = retry === 'cards.generate' && aiReason('cards.generate', ai) !== null;
  const generateCards = cardsPaused || (cardsMissing && retry === null);

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
              aiReason(row.step, ai) ? (
                <span className="text-sm text-text-muted">
                  {aiReason(row.step, ai)} ·{' '}
                  <Link href={AI_SETTINGS_HREF} className="underline underline-offset-2">
                    Einstellungen
                  </Link>
                </span>
              ) : (
                <span className="text-sm text-text-muted">nicht fertig</span>
              )
            ) : (
              <span className="sr-only">{SPOKEN[row.state]}</span>
            )}
          </li>
        ))}
      </ul>
      {lectureRunning && rows.some((row) => row.state === 'wartet' && !LIGHT_STEPS.has(row.step)) ? (
        <p className="mt-2 text-sm text-text-muted" data-testid="step-hold">
          Manche Schritte warten, bis die Vorlesung vorbei ist.
        </p>
      ) : null}
      {(retry || generateCards) && onRetry ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={button}
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onRetry(generateCards ? 'cards.generate' : (retry ?? 'cards.generate'));
            }}
          >
            {generateCards ? 'Karten erzeugen' : 'Erneut versuchen'}
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
          {slidesOnly ? (
            <button
              type="button"
              className={button}
              aria-disabled={busy}
              onClick={() => {
                if (!busy) onRetry('concepts.extract');
              }}
            >
              Konzepte nur aus Folien
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
