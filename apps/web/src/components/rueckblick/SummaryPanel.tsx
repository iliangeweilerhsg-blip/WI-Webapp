'use client';

// Kurzfassung ✦ einer Vorlesung über dem Transkript (VERTRAEGE §20.4, §20.10, F-NAC-08): höchstens fünf Sätze mit
// Quellen-Chips und die Gliederung. Aufklappbar. Die Texte kommen von der KI und stehen als reiner Text da.
import type { EvidenceRef, SessionSummary } from '@sg/shared';
import { SourceChips } from '../concepts/SourceChips.tsx';

export interface SummaryPanelProps {
  summary: SessionSummary;
  /** Folien-Chip wählt die Folie, Zeit-Chip springt in der Aufnahme; `false` = normales Ziel */
  onPick: (ref: EvidenceRef) => boolean;
}

export function SummaryPanel({ summary, onPick }: SummaryPanelProps) {
  return (
    <details
      open
      data-testid="review-summary"
      className="relative rounded-lg border border-border bg-surface px-4 py-3"
    >
      <summary className="cursor-pointer text-md font-medium">
        <h2 className="inline text-md font-medium">Kurzfassung</h2>
        <span aria-hidden="true" title="Von der KI geschrieben" className="ml-2 text-text-muted">
          ✦
        </span>
        <span className="sr-only"> (von der KI geschrieben)</span>
      </summary>
      <ol className="mt-3 flex flex-col gap-3">
        {summary.sentences.map((sentence, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="min-w-0 flex-1 basis-72 break-words text-md">{sentence.text}</p>
            <SourceChips sources={sentence.sources} label={`Quellen zu Satz ${i + 1}`} onPick={onPick} />
          </li>
        ))}
      </ol>
      {summary.outline.length > 0 ? (
        <>
          <h3 className="mt-4 text-sm font-medium text-text-muted">Gliederung</h3>
          <ol className="mt-1 flex flex-col gap-1">
            {summary.outline.map((item, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="min-w-0 break-words text-sm">{item.title}</p>
                <SourceChips sources={item.sources} label={`Quellen zu ${item.title}`} onPick={onPick} />
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </details>
  );
}
