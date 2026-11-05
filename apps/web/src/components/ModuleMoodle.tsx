'use client';

import Link from 'next/link';
import { formatSyncedAt, useMoodleItems, useMoodleLinks } from '../lib/moodle.ts';
import { MoodleDeadlines } from './MoodleDeadlines.tsx';

/**
 * Moodle auf der Modulseite (07 §3.2, T1-23): eine ruhige Zeile zum Abgleich, offene Dateien als Hinweis auf die
 * Inbox und die Fristen des Moduls. Ohne zugeordneten Kurs zeigt sie nichts.
 */
export function ModuleMoodle({ moduleId }: { moduleId: string }) {
  const links = useMoodleLinks();
  const open = useMoodleItems({ kind: 'offen', moduleId });
  const mine = (links.data ?? []).filter((link) => link.module_id === moduleId);
  if (mine.length === 0) return null;
  const last = mine
    .map((link) => link.last_synced_at)
    .filter((at): at is string => at !== null)
    .sort()
    .at(-1);
  const waiting = open.data?.length ?? 0;

  return (
    <div className="mt-6 space-y-4">
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-text-muted">
        <span>
          {mine.length === 1 ? 'Moodle-Kurs zugeordnet' : `${mine.length} Moodle-Kurse zugeordnet`}
          {last ? ` · abgeglichen ${formatSyncedAt(last)}` : ' · noch nicht abgeglichen'}
        </span>
        {waiting > 0 ? (
          <Link href="/inbox" className="text-text underline-offset-2 hover:underline">
            {waiting === 1 ? '1 Datei wartet in der Inbox' : `${waiting} Dateien warten in der Inbox`}
          </Link>
        ) : null}
        <Link
          href="/einstellungen?bereich=moodle"
          className="underline-offset-2 hover:text-text hover:underline"
        >
          Zuordnung
        </Link>
      </p>
      <MoodleDeadlines moduleId={moduleId} headingId={`fristen-${moduleId}`} />
    </div>
  );
}
