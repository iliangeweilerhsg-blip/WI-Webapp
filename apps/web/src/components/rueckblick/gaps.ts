// Lücken in der Aufnahme (UX-310): Zeiträume zwischen zwei Aufnahmen einer Session, in denen nichts aufgenommen
// wurde (Deckel zu, Mac-Neustart, "Aufnahme neu begonnen", aber auch eine gewollte Pause: VERTRAEGE §9.1).
// Darum neutral "Keine Aufnahme" statt "fehlt". Abgeleitet aus `started_ms` und `duration_ms` der
// Aufnahmen; der Core meldet Lücken nicht selbst. Vor der ersten und hinter der letzten Aufnahme lässt sich aus diesen
// Daten keine Lücke bestimmen (Beginn und Ende der Session sind keine Aufnahmezeiten).
import type { Recording } from '@sg/shared';
import { clockAt, playableRecordings } from '../../lib/transcript.ts';

/** Erst ab dieser Länge gilt ein Abstand zwischen zwei Aufnahmen als Lücke */
export const MIN_GAP_MS = 60_000;

export interface RecordingGap {
  /** Sitzungszeit: Ende der vorherigen Aufnahme */
  start_ms: number;
  /** Sitzungszeit: Beginn der nächsten Aufnahme */
  end_ms: number;
}

export function recordingGaps(recordings: readonly Recording[], minMs: number = MIN_GAP_MS): RecordingGap[] {
  const list = playableRecordings(recordings);
  const gaps: RecordingGap[] = [];
  // Überlappen sich Aufnahmen, zählt das späteste Ende bis dahin
  let coveredUntil: number | null = null;
  for (const r of list) {
    if (coveredUntil !== null && r.started_ms - coveredUntil >= minMs) {
      gaps.push({ start_ms: coveredUntil, end_ms: r.started_ms });
    }
    const end = r.started_ms + (r.duration_ms ?? 0);
    coveredUntil = coveredUntil === null ? end : Math.max(coveredUntil, end);
  }
  return gaps;
}

/** Dauer in ganzen Minuten, mindestens 1: "13 min", ab einer Stunde "1 h 5 min" */
export function formatGapDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "Keine Aufnahme 10:12 bis 10:25 (13 min)", Uhrzeit in Ortszeit wie die Zeiten des Transkripts */
export function gapText(gap: RecordingGap, startedAt: string | null): string {
  return `Keine Aufnahme ${clockAt(startedAt, gap.start_ms)} bis ${clockAt(startedAt, gap.end_ms)} (${formatGapDuration(gap.end_ms - gap.start_ms)})`;
}

/** Summe für den Kopf des Rückblicks, `null` ohne Lücken */
export function gapsSummary(gaps: readonly RecordingGap[]): string | null {
  if (gaps.length === 0) return null;
  const total = gaps.reduce((sum, g) => sum + (g.end_ms - g.start_ms), 0);
  return gaps.length === 1
    ? `${formatGapDuration(total)} ohne Aufnahme.`
    : `${formatGapDuration(total)} ohne Aufnahme, in ${gaps.length} Lücken.`;
}
