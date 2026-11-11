'use client';

// Konzepte einer Vorlesung als Chips (VERTRAEGE §20.10): Sprung zur Konzeptansicht, Vorschläge dezent gekennzeichnet,
// die Konzepte der gewählten Folie zuerst. Dazu die ruhigen Zustände ohne Konzepte.
import Link from 'next/link';
import type { AiStatus, Session, SessionConceptItem } from '@sg/shared';
import { CONCEPT_STEPS, conceptHref, orderForSlide } from '../../lib/concepts.ts';
import { AI_SETTINGS_HREF, aiNotConfigured } from '../../lib/costs.ts';
import { isFailed, isPending } from '../../lib/transcript.ts';

const chip =
  'relative inline-flex min-h-8 max-w-full items-center rounded-full border px-3 text-sm hover:bg-surface sg-transition';
const action =
  'inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised aria-disabled:opacity-60';

export interface SessionConceptChipsProps {
  items: readonly SessionConceptItem[] | undefined;
  processing: Session['processing'];
  /** Gewählte Folie (ID), sonst `null` */
  slideId: string | null;
  ai: AiStatus | undefined;
  busy: boolean;
  /** Fehler von „Konzepte erzeugen“, falls ihn sonst nichts zeigt */
  error: string | null;
  /** „Konzepte erzeugen“: `reprocess` ab `concepts.extract` */
  onCreate: () => void;
}

export function SessionConceptChips({
  items,
  processing,
  slideId,
  ai,
  busy,
  error,
  onCreate,
}: SessionConceptChipsProps) {
  const ordered = orderForSlide(items ?? [], slideId);
  const steps = CONCEPT_STEPS.map((step) => processing[step]).filter((state) => state !== undefined);
  const noSteps = steps.length === 0;
  const pending = steps.some((state) => isPending(state));

  let body;
  if (ordered.length > 0) {
    body = (
      <ul aria-label="Konzepte dieser Vorlesung" className="mt-2 flex flex-wrap gap-2">
        {ordered.map(({ concept }) => {
          const proposal = concept.status === 'vorschlag';
          return (
            <li key={concept.id} className="min-w-0">
              <Link
                href={conceptHref(concept.id)}
                data-proposal={proposal ? 'true' : undefined}
                className={`${chip} ${proposal ? 'border-dashed border-border-strong text-text-muted' : 'border-border'}`}
              >
                <span className="truncate">{concept.name}</span>
                {proposal ? <span className="sr-only"> (Vorschlag)</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    );
  } else if (items === undefined || pending || steps.some((state) => isFailed(state))) {
    // Lädt noch, „Konzepte kommen noch“ steht schon oben, oder die Schrittliste sagt, was fehlt
    return null;
  } else if (noSteps) {
    body = aiNotConfigured(ai) ? (
      <p className="mt-2 text-sm text-text-muted">
        KI nicht eingerichtet ·{' '}
        <Link href={AI_SETTINGS_HREF} className="underline underline-offset-2">
          Einstellungen
        </Link>
      </p>
    ) : (
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          className={action}
          aria-disabled={busy}
          onClick={() => {
            if (!busy) onCreate();
          }}
        >
          Konzepte erzeugen
        </button>
        {error ? (
          <p role="alert" className="text-sm text-text-muted">
            {error}
          </p>
        ) : null}
      </div>
    );
  } else {
    body = <p className="mt-2 text-sm text-text-muted">Keine Konzepte in dieser Vorlesung.</p>;
  }

  return (
    <section aria-labelledby="review-concepts-title" data-testid="review-concepts">
      <h2 id="review-concepts-title" className="text-md font-medium">
        Konzepte
      </h2>
      {body}
    </section>
  );
}
