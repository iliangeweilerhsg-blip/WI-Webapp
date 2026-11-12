'use client';

import Link from 'next/link';
import type { Session } from '@sg/shared';
import { useRecordingView } from '../../lib/recording';
import { formatSize, isStorageLow, lecturesThatFit, useSystemStorage } from '../../lib/storage.ts';

/**
 * Speicher-Hinweis auf „Heute“ (UX-11): Reicht der freie Platz nicht für etwa 2 Vorlesungen Audio, steht hier eine
 * ruhige Zeile mit Link zu Einstellungen → Daten. Nie, solange eine Session läuft oder pausiert. Bei Fehlern der
 * Abfrage (etwa ein älterer Core): nichts.
 */
export function StorageHint({ sessions }: { sessions: readonly Session[] }) {
  const storage = useSystemStorage();
  const view = useRecordingView();
  const data = storage.data;
  if (!data || !isStorageLow(data.data_dir_free_bytes)) return null;
  if (view.phase !== 'andere' || sessions.some((s) => s.state === 'laeuft' || s.state === 'pausiert'))
    return null;
  const fit = lecturesThatFit(data.data_dir_free_bytes);
  return (
    <p role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      Auf dem Mac sind nur noch {formatSize(data.data_dir_free_bytes)} frei.{' '}
      {fit < 1
        ? 'Das reicht nicht für eine ganze Vorlesung.'
        : fit === 1
          ? 'Das reicht für etwa eine Vorlesung.'
          : `Das reicht für etwa ${fit} Vorlesungen.`}{' '}
      Räume Platz frei, bevor du aufnimmst.{' '}
      <Link
        href="/einstellungen?bereich=daten"
        className="whitespace-nowrap text-text-muted underline-offset-2 hover:text-text hover:underline"
      >
        Speicherplatz
      </Link>
    </p>
  );
}
