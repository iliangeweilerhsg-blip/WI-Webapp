'use client';

import Link from 'next/link';
import type { Session } from '@sg/shared';
import { queueMinutes, useReviewQueue } from '../../lib/cards.ts';
import { useRecordingView } from '../../lib/recording';

/**
 * Kachel „Heute wiederholen · ≈ n min“ (VERTRAEGE §21.10) mit Sprung nach `/lernen`. Nur wenn etwas dran ist, ohne
 * Zahl fälliger Karten und ohne Rückstand (LP9). Während eine Session läuft oder pausiert, steht sie nicht da (R1) und
 * lädt auch nichts. Bei Fehlern der Abfrage: nichts.
 */
export function ReviewTile({ sessions }: { sessions: readonly Session[] }) {
  const view = useRecordingView();
  const sessionRunning =
    view.phase !== 'andere' || sessions.some((s) => s.state === 'laeuft' || s.state === 'pausiert');
  const queue = useReviewQueue(0, { enabled: !sessionRunning });
  const data = queue.data;
  if (sessionRunning || !data || data.items.length === 0) return null;
  return (
    <Link
      href="/lernen"
      data-testid="review-tile"
      className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 hover:bg-surface-raised sg-transition"
    >
      <span className="text-md font-medium">Heute wiederholen · ≈ {queueMinutes(data)} min</span>
      <span aria-hidden="true" className="text-text-muted">
        →
      </span>
    </Link>
  );
}
