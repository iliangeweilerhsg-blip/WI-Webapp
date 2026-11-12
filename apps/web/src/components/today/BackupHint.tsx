'use client';

import Link from 'next/link';
import type { Session } from '@sg/shared';
import { useBackups } from '../../lib/data.ts';
import { useRecordingView } from '../../lib/recording';

const dateFormat = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' });

/**
 * Backup-Hinweis auf „Heute“ (UX-10): Ist ein Ziel eingestellt und das letzte gelungene Backup älter als 3 Tage (oder
 * es gab noch keins), steht hier eine ruhige Zeile mit Link zu Einstellungen → Daten. Nie, solange eine Session läuft
 * oder pausiert. Ohne Ziel (bewusst kein Backup) und bei Fehlern der Abfrage: nichts.
 */
export function BackupHint({ sessions }: { sessions: readonly Session[] }) {
  const backups = useBackups();
  const view = useRecordingView();
  const status = backups.data?.status;
  // Läuft gerade ein Backup, ist der Datenträger da: dann keine Frage danach
  if (!status || status.target === null || !status.stale || status.running) return null;
  if (view.phase !== 'andere' || sessions.some((s) => s.state === 'laeuft' || s.state === 'pausiert'))
    return null;
  return (
    <p role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      {status.last_success_at
        ? `Das letzte Backup ist vom ${dateFormat.format(new Date(status.last_success_at))}, also älter als 3 Tage. Ist der Backup-Datenträger angeschlossen?`
        : 'Es gab noch kein erfolgreiches Backup. Ist der Backup-Datenträger angeschlossen?'}{' '}
      <Link
        href="/einstellungen?bereich=daten"
        className="whitespace-nowrap text-text-muted underline-offset-2 hover:text-text hover:underline"
      >
        Daten und Backups
      </Link>
    </p>
  );
}
