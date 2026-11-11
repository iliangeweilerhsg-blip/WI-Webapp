'use client';

import Link from 'next/link';
import type { EvidenceRef } from '@sg/shared';
import { evidenceChip, evidenceHref, evidenceSpoken } from '../../lib/concepts.ts';

const chip =
  'relative inline-flex min-h-7 items-center rounded-md border border-border px-2 text-xs tabular-nums text-text-muted hover:bg-surface hover:text-text sg-transition';

export interface SourceChipsProps {
  sources: readonly EvidenceRef[];
  /** Wofür die Quellen stehen (Name der Gruppe für Screenreader) */
  label: string;
  /**
   * Im Rückblick: Der Chip wählt die Folie bzw. springt in der Aufnahme, statt die Seite zu wechseln. Liefert die
   * Funktion `false`, gilt das normale Ziel.
   */
  onPick?: (ref: EvidenceRef) => boolean;
}

/** Quellen-Chips „F 14“ und „42:12“ (§20.10): Folie → PDF-Anzeige, Zeit → Rückblick an dieser Stelle */
export function SourceChips({ sources, label, onPick }: SourceChipsProps) {
  if (sources.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-1">
      {sources.map((ref, i) => (
        <li key={`${evidenceChip(ref)}-${i}`}>
          <Link
            href={evidenceHref(ref)}
            aria-label={evidenceSpoken(ref)}
            className={chip}
            onClick={(event) => {
              if (onPick?.(ref)) event.preventDefault();
            }}
          >
            {ref.kind === 'transcript' ? (
              <span aria-hidden="true" className="mr-1">
                ▶
              </span>
            ) : null}
            {evidenceChip(ref)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
