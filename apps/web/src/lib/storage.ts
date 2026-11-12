'use client';

// Speicherplatz (UX-11, VERTRAEGE §7.6): Abruf von `GET /system/storage` und Schätzung, wie viele Vorlesungen noch
// Platz haben.
import { useQuery } from '@tanstack/react-query';
import { SystemStorageSchema } from '@sg/shared';
import { apiGet } from './api.ts';
import { useHydrationSafe } from './hydrated.ts';
import { AUDIO_BITS_PER_SECOND } from './recorder/recorder.ts';

/** Audio je Stunde Aufnahme in Byte, aus der Bitrate der Aufnahme (48 kbit/s ≈ 21,6 MB) */
export const AUDIO_BYTES_PER_HOUR = (AUDIO_BITS_PER_SECOND / 8) * 3600;
/**
 * Platzbedarf je Stunde Aufnahme insgesamt: die Chunks, die zusammengesetzte `full.m4a` und Zwischenstände der
 * Verarbeitung, jeweils etwa so groß wie das Audio (VERTRAEGE §7.6)
 */
export const STORAGE_BYTES_PER_LECTURE_HOUR = AUDIO_BYTES_PER_HOUR * 3;
/** Eine Vorlesung gilt als anderthalb Stunden */
export const LECTURE_HOURS = 1.5;
/** „Heute“ warnt, wenn weniger als so viele Vorlesungen Platz haben */
export const WARN_BELOW_LECTURES = 2;

/** Platzbedarf einer Vorlesung in Byte */
export const STORAGE_BYTES_PER_LECTURE = STORAGE_BYTES_PER_LECTURE_HOUR * LECTURE_HOURS;
/** Freier Platz in Byte, unter dem „Heute“ warnt */
export const STORAGE_WARN_BELOW_BYTES = STORAGE_BYTES_PER_LECTURE * WARN_BELOW_LECTURES;

/** Wie viele ganze Vorlesungen noch Platz haben */
export function lecturesThatFit(freeBytes: number): number {
  return Math.floor(freeBytes / STORAGE_BYTES_PER_LECTURE);
}

export function isStorageLow(freeBytes: number): boolean {
  return freeBytes < STORAGE_WARN_BELOW_BYTES;
}

export function useSystemStorage() {
  const query = useQuery({
    queryKey: ['system', 'storage'],
    queryFn: ({ signal }) => apiGet('/system/storage', SystemStorageSchema, { signal }),
    staleTime: 60_000,
    // Der freie Platz ändert sich während einer Vorlesung; ein Fehler (etwa älterer Core) wird nicht wiederholt
    retry: false,
  });
  return useHydrationSafe(query);
}

/** Größe lesbar: `1.5 GB` (1024er-Schritte), `null` als Strich */
export function formatSize(bytes: number | null): string {
  if (bytes === null) return '–';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
