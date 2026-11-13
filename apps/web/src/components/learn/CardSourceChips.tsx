'use client';

import Link from 'next/link';
import type { CardSource } from '@sg/shared';
import { evidenceChip, evidenceHref, evidenceSpoken } from '../../lib/concepts.ts';

const chip =
  'relative inline-flex min-h-7 items-center rounded-md border border-border px-2 text-xs tabular-nums text-text-muted';

/**
 * Quellen-Chips einer Karte (VERTRAEGE §21.10): „F 14“ und „42:12“ mit denselben Zielen wie bei Konzepten (§20.10).
 * Fehlt der Beleg (`missing`), steht der Chip ausgegraut und ohne Link da.
 */
export function CardSourceChips({ sources, label }: { sources: readonly CardSource[]; label: string }) {
  if (sources.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-1">
      {sources.map((source, i) => (
        <li key={`${evidenceChip(source.ref)}-${i}`}>
          {source.missing ? (
            <span
              data-missing="true"
              className={`${chip} border-dashed opacity-60`}
              title="Nicht mehr vorhanden"
            >
              <span className="sr-only">{`${evidenceSpoken(source.ref)}, nicht mehr vorhanden`}</span>
              <span aria-hidden="true">{evidenceChip(source.ref)}</span>
            </span>
          ) : (
            <Link
              href={evidenceHref(source.ref)}
              aria-label={evidenceSpoken(source.ref)}
              className={`${chip} hover:bg-surface hover:text-text sg-transition`}
            >
              {source.ref.kind === 'transcript' ? (
                <span aria-hidden="true" className="mr-1">
                  ▶
                </span>
              ) : null}
              {evidenceChip(source.ref)}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
