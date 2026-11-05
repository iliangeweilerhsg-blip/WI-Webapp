'use client';

import Link from 'next/link';
import { accessHintText, needsRenewal, useMoodleStatus } from '../lib/moodle.ts';

/**
 * Dezenter Hinweis zum Moodle-Zugang (F-MDL-01, 07 §5 R13): ab 7 Tagen vor Ablauf und wenn Moodle den Zugang nicht
 * mehr annimmt. Genau eine ruhige Zeile mit dem Befehl, keine Warnfarbe. Sonst nichts.
 */
export function MoodleAccessHint({ withLink = false }: { withLink?: boolean }) {
  const status = useMoodleStatus();
  const state = status.data?.state;
  if (!needsRenewal(state)) return null;
  return (
    <p role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      {accessHintText(state, status.data?.token_valid_until ?? null)}{' '}
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
