'use client';

// Speicherplatz (UX-11, VERTRAEGE §7.6): Abruf von `GET /system/storage` und Schätzung, wie viele Vorlesungen noch
// Platz haben.
import { useQuery } from '@tanstack/react-query';
import { SystemStorageSchema } from '@sg/shared';
import { apiGet } from './api.ts';
import { useHydrationSafe } from './hydrated.ts';
import { AUDIO_BITS_PER_SECOND } from './recorder/recorder.ts';

/** Audio je Stunde Aufnahme in Byte, aus der Bitrate der Aufnahme (48 kbit/s = 21,6 MB) */
export const AUDIO_BYTES_PER_HOUR = (AUDIO_BITS_PER_SECOND / 8) * 3600;
/**
 * Platzbedarf je Stunde Aufnahme insgesamt: die Chunks, die zusammengesetzte `full.m4a` und Zwischenstände der
 * Verarbeitung, jeweils etwa so groß wie das Audio (VERTRAEGE §7.6)
 */
export const STORAGE_BYTES_PER_LECTURE_HOUR = AUDIO_BYTES_PER_HOUR * 3;
/** Eine Vorlesung gilt als anderthalb Stunden */
export const LECTURE_HOURS = 1.5;
/** Platz für so viele Vorlesungen muss mindestens frei sein */
export const WARN_BELOW_LECTURES = 2;
/**
 * Mindestreserve (UX-11): 5 GB. Der Mac braucht neben den Aufnahmen Platz für macOS selbst (Auslagerungsdateien bei
 * 8 GB Arbeitsspeicher, Updates), das WAL von Postgres, Backups, hochgeladene Folien (bis 200 MB je Datei) und die
 * Zwischendateien der Transkription. Darunter wird es knapp, lange bevor das Audio selbst nicht mehr passt.
 */
export const STORAGE_MIN_FREE_BYTES = 5_000_000_000;

/** Platzbedarf einer Vorlesung in Byte */
export const STORAGE_BYTES_PER_LECTURE = STORAGE_BYTES_PER_LECTURE_HOUR * LECTURE_HOURS;
/** Freier Platz in Byte, unter dem „Heute“ warnt: `max(5 GB, Bedarf für 2 Vorlesungen)` */
export const STORAGE_WARN_BELOW_BYTES = Math.max(
  STORAGE_MIN_FREE_BYTES,
  STORAGE_BYTES_PER_LECTURE * WARN_BELOW_LECTURES,
);

/** Wie viele ganze Vorlesungen noch Platz haben */
export function lecturesThatFit(freeBytes: number): number {
  return Math.floor(freeBytes / STORAGE_BYTES_PER_LECTURE);
}

export function isStorageLow(freeBytes: number): boolean {
  return freeBytes < STORAGE_WARN_BELOW_BYTES;
}

export function useSystemStorage(options: { refetchIntervalMs?: number | false } = {}) {
  const query = useQuery({
    queryKey: ['system', 'storage'],
    queryFn: ({ signal }) => apiGet('/system/storage', SystemStorageSchema, { signal }),
    staleTime: 60_000,
    // Der freie Platz ändert sich während einer Vorlesung; ein Fehler (etwa älterer Core) wird nicht wiederholt
    retry: false,
    // Während einer Session fragt die Statusleiste regelmäßig nach (UX-316)
    refetchInterval: options.refetchIntervalMs ?? false,
  });
  return useHydrationSafe(query);
}

const sizeNumber = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/**
 * Größe lesbar wie im Finder: Dezimal-Einheiten (1 GB = 1000³ Byte), deutsches Komma, z. B. `1,5 GB`, `40 GB`.
 * `null` als Strich.
 */
export function formatSize(bytes: number | null): string {
  if (bytes === null) return '–';
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  // 999,96 MB würde zu „1000 MB“ gerundet: dann eine Einheit weiter
  if (Math.round(value * 10) / 10 >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${sizeNumber.format(value)} ${units[unit]}`;
}
