'use client';

// Ruhige Zeile in Statusleiste und Aufnahme-Leiste, wenn während einer Session weniger als 1 GB frei ist (UX-316).
// Kein Dialog, kein Ton (R1); die Aufnahme läuft weiter. Bei Fehlern der Abfrage (etwa ein älterer Core): nichts.
import Link from 'next/link';
import { formatSize, useSystemStorage } from '../../lib/storage.ts';

/** Darunter meldet die Leiste den knappen Platz */
export const SESSION_STORAGE_WARN_BYTES = 1_000_000_000;
/** So oft fragt die Leiste während der Session nach dem freien Platz */
const POLL_STORAGE_MS = 60_000;

export function LowStorageNote({ active }: { active: boolean }) {
  const storage = useSystemStorage({ refetchIntervalMs: active ? POLL_STORAGE_MS : false });
  const free = storage.data?.data_dir_free_bytes;
  if (!active || free === undefined || free >= SESSION_STORAGE_WARN_BYTES) return null;
  return (
    <p className="text-text-muted" data-testid="storage-status" role="status">
      Auf dem Mac sind nur noch {formatSize(free)} frei.{' '}
      <Link
        href="/einstellungen?bereich=daten"
        className="whitespace-nowrap underline underline-offset-2 hover:text-text"
      >
        Speicherplatz
      </Link>
    </p>
  );
}
