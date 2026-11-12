'use client';

import Link from 'next/link';
import {
  accessHintText,
  deadlineAfterExpiry,
  EARLY_HINT_DAYS,
  needsRenewal,
  useMoodleStatus,
  useSyncedDeadlines,
} from '../lib/moodle.ts';

/** Fristen, die der frühe Hinweis berücksichtigt: bis zu zwei Monate voraus */
const LOOKAHEAD_DAYS = 60;

/**
 * Dezenter Hinweis zum Moodle-Zugang (F-MDL-01, 07 §5 R13): ab 7 Tagen vor Ablauf und wenn Moodle den Zugang nicht
 * mehr annimmt. Liegt eine bekannte Frist nach dem Ablauf, schon ab 14 Tagen vorher und mit dem Namen der Frist
 * (UX-313). Genau eine ruhige Zeile mit dem Befehl, keine Warnfarbe. Sonst nichts.
 */
export function MoodleAccessHint({ withLink = false }: { withLink?: boolean }) {
  const status = useMoodleStatus();
  const state = status.data?.state;
  const validUntil = status.data?.token_valid_until ?? null;
  // Fristen laden wir nur, solange der Ablauf nah genug ist; sonst kostet der Hinweis keine Abfrage
  const expiresSoon =
    validUntil !== null &&
    (state === 'ok' || state === 'laeuft_bald_ab') &&
    new Date(`${validUntil}T23:59:59`).getTime() - Date.now() <= EARLY_HINT_DAYS * 86_400_000;
  const deadlines = useSyncedDeadlines({ days: LOOKAHEAD_DAYS, enabled: expiresSoon });
  const deadline = deadlineAfterExpiry(
    validUntil,
    deadlines.data?.filter((d) => d.source === 'aufgabe'),
  );
  const shown = needsRenewal(state) ? state : state === 'ok' && deadline ? 'ok' : null;
  if (shown === null) return null;
  return (
    <p role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      {accessHintText(shown, validUntil, deadline)}{' '}
      <code className="whitespace-nowrap font-mono">pnpm sg moodle login</code>.
      {withLink ? (
        <>
          {' '}
          <Link
            href="/einstellungen?bereich=moodle"
            className="whitespace-nowrap text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Moodle-Einstellungen
          </Link>
        </>
      ) : null}
    </p>
  );
}
