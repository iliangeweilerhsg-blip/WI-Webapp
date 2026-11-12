'use client';

import Link from 'next/link';
import type { Session } from '@sg/shared';
import { useRecordingView } from '../../lib/recording';
import {
  formatSize,
  isStorageLow,
  lecturesThatFit,
  STORAGE_MIN_FREE_BYTES,
  useSystemStorage,
} from '../../lib/storage.ts';
import { cardState, pickCard } from './model.ts';
import { useNow } from './use-today.ts';

/**
 * Zeigt die Start-Karte auf „Heute“ gerade „Start“? Dann steht dort schon der Hinweis „reicht nicht für eine ganze
 * Vorlesung“ direkt am Knopf (UX-316), und diese Zeile wiederholt ihn nicht. Gleiche Auswahl wie in `HeuteScreen`.
 */
function startCardOffersStart(sessions: readonly Session[], now: number): boolean {
  const pick = pickCard(sessions, now);
  if (!pick) return false;
  const state = cardState(pick.session, now);
  return state === 'bevorstehend' || state === 'bereit';
}

/**
 * Speicher-Hinweis auf „Heute“ (UX-11): Ist weniger frei als `max(5 GB, Bedarf für 2 Vorlesungen)`, steht hier eine
 * ruhige Zeile mit Link zu Einstellungen → Daten. Nie, solange eine Session läuft oder pausiert. Bei Fehlern der
 * Abfrage (etwa ein älterer Core): nichts. Reicht der Platz für keine Vorlesung und bietet die Start-Karte „Start“ an,
 * steht der Hinweis nur dort (UX-316).
 */
export function StorageHint({ sessions }: { sessions: readonly Session[] }) {
  const storage = useSystemStorage();
  const view = useRecordingView();
  const now = useNow(15_000);
  const data = storage.data;
  if (!data || !isStorageLow(data.data_dir_free_bytes)) return null;
  if (view.phase !== 'andere' || sessions.some((s) => s.state === 'laeuft' || s.state === 'pausiert'))
    return null;
  const fit = lecturesThatFit(data.data_dir_free_bytes);
  if (fit < 1 && (now === null || startCardOffersStart(sessions, now))) return null;
  return (
    <p role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      Auf dem Mac sind nur noch {formatSize(data.data_dir_free_bytes)} frei.{' '}
      {fit < 1
        ? 'Das reicht nicht für eine ganze Vorlesung.'
        : fit === 1
          ? 'Das reicht nur noch für etwa eine Vorlesung.'
          : `Empfohlen sind mindestens ${formatSize(STORAGE_MIN_FREE_BYTES)}, damit macOS, Datenbank, Backups und Verarbeitung Luft haben.`}{' '}
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
