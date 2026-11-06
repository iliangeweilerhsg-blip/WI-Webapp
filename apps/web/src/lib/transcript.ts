// Rückblick einer Vorlesung (T2-03, F-NAC-02, VERTRAEGE §18.4, §18.5, §18.9): REST-Funktionen für Transkript und
// `reprocess`, die Zustände des Rückblicks, die Schrittliste und die reine Zeitrechnung (Zeile, Folie, Aufnahme).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PipelineStepSchema,
  SessionReprocessResultSchema,
  SessionTranscriptSchema,
  type PipelineStep,
  type Recording,
  type Session,
  type SessionTranscript,
  type SlideSegment,
  type TranscriptLine,
} from '@sg/shared';
import { ApiRequestError, apiGet, apiSend, friendlyMessage } from './api.ts';
import { useHydrationSafe } from './hydrated.ts';
import { fileUrl } from './material.ts';

// ---------------------------------------------------------------------------------------------
// Adressen und REST
// ---------------------------------------------------------------------------------------------

/** Pfad des Rückblicks. Query-Parameter statt dynamischem Segment (VERTRAEGE §5). */
export function rueckblickHref(sessionId: string): string {
  return `/rueckblick?id=${encodeURIComponent(sessionId)}`;
}

/** Audio einer Aufnahme (`GET /recordings/{id}/audio`, mit `Range`, VERTRAEGE §7.3) */
export function recordingAudioUrl(recordingId: string): string {
  return fileUrl(`/recordings/${encodeURIComponent(recordingId)}/audio`);
}

export const transcriptKey = (sessionId: string) => ['transcript', sessionId] as const;

/** `GET /sessions/{id}/transcript` ohne Wörter (§18.4): einmal je Session, gefiltert wird lokal */
export function getTranscript(sessionId: string, signal?: AbortSignal): Promise<SessionTranscript> {
  return apiGet(`/sessions/${encodeURIComponent(sessionId)}/transcript`, SessionTranscriptSchema, { signal });
}

/** `POST /sessions/{id}/reprocess` (§18.5): 202 mit der Session nach der Änderung */
export function reprocessSession(sessionId: string, fromStep: PipelineStep): Promise<Session> {
  return apiSend(
    'POST',
    `/sessions/${encodeURIComponent(sessionId)}/reprocess`,
    SessionReprocessResultSchema,
    { body: { from_step: fromStep } },
  ).then((result) => result.session);
}

/** Freundliche Texte zu den neuen Fehlercodes (§18.8); `lib/api.ts` kennt sie noch nicht */
export function reprocessMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.kind === 'api') {
    if (error.code === 'session_no_audio')
      return 'Zu dieser Session gibt es noch kein Audio zum Verarbeiten.';
    if (error.code === 'session_not_ended') return 'Die Session läuft noch. Verarbeitet wird danach.';
  }
  return friendlyMessage(error);
}

// ---------------------------------------------------------------------------------------------
// Verarbeitungsstand als Schrittliste (§18.2 „Anzeige“)
// ---------------------------------------------------------------------------------------------

export type StepState = Session['processing'][string];

/** Reihenfolge von `PipelineStep` = Anzeigereihenfolge */
export const PIPELINE_STEPS: readonly PipelineStep[] = PipelineStepSchema.options;

export const STEP_LABELS: Record<PipelineStep, string> = {
  'audio.finalize': 'Audio',
  transcribe: 'Transkript',
  'align.log': 'Folien zuordnen',
  // VERTRAEGE §20.2 (Texte der Schrittliste)
  'concepts.extract': 'Konzepte',
  'concepts.resolve': 'Abgleich',
  'summary.write': 'Zusammenfassung',
};

export interface StepRow {
  step: PipelineStep;
  label: string;
  state: StepState;
}

/** Nur die Schritte, die als Schlüssel in `processing` stehen, in der Reihenfolge von `PipelineStep` */
export function stepRows(processing: Session['processing'] | undefined): StepRow[] {
  const rows: StepRow[] = [];
  for (const step of PIPELINE_STEPS) {
    const state = processing?.[step];
    if (state !== undefined) rows.push({ step, label: STEP_LABELS[step], state });
  }
  return rows;
}

export const isFailed = (state: StepState): boolean => state === 'fehler' || state === 'abgebrochen';
export const isPending = (state: StepState): boolean => state === 'wartet' || state === 'laeuft';

/** `from_step` von „Erneut versuchen“: der erste Schritt in `fehler`/`abgebrochen` */
export function retryStep(processing: Session['processing'] | undefined): PipelineStep | null {
  return stepRows(processing).find((row) => isFailed(row.state))?.step ?? null;
}

/** „Mit vorhandenem Audio fortfahren“ gibt es nur, wenn `audio.finalize` auf `fehler` steht */
export function canContinueWithAudio(processing: Session['processing'] | undefined): boolean {
  return processing?.['audio.finalize'] === 'fehler';
}

// ---------------------------------------------------------------------------------------------
// Zustände des Rückblicks (§18.9, in dieser Reihenfolge geprüft)
// ---------------------------------------------------------------------------------------------

export type ReviewState =
  /** Die Session läuft noch (oder wurde noch nicht gestartet): Es gibt nichts zurückzublicken */
  | 'nicht_beendet'
  /** Ein Schritt steht auf `wartet` oder `laeuft` */
  | 'offen'
  /** Keine Aufnahme mit Länge, oder `transcribe` ist fertig und es gibt kein Transkript */
  | 'keine_aufnahme'
  /** Ein Schritt steht auf `fehler` oder `abgebrochen` */
  | 'fehler'
  /** `stale`: neues Audio seit dem Transkript */
  | 'veraltet'
  | 'bereit';

export function reviewState(session: Session, transcript: SessionTranscript): ReviewState {
  if (session.state !== 'beendet' && session.state !== 'verarbeitet') return 'nicht_beendet';
  const rows = stepRows(session.processing);
  if (rows.some((row) => isPending(row.state))) return 'offen';
  const withAudio = transcript.recordings.some((r) => r.duration_ms !== null && r.duration_ms > 0);
  if (!withAudio || (session.processing.transcribe === 'fertig' && transcript.transcripts.length === 0)) {
    return 'keine_aufnahme';
  }
  if (rows.some((row) => isFailed(row.state))) return 'fehler';
  if (transcript.stale) return 'veraltet';
  return 'bereit';
}

/** Ob die Folien den Zeilen zugeordnet sind (sonst ein Transkript als eine Liste) */
export function hasSlideMapping(transcript: SessionTranscript): boolean {
  return transcript.slide_source !== null && transcript.slide_segments.length > 0;
}

// ---------------------------------------------------------------------------------------------
// Abfragen
// ---------------------------------------------------------------------------------------------

/**
 * Transkript einer Session, einmal im Query-Cache. Wechselt `processing.transcribe` oder `processing['align.log']`
 * auf `fertig`, wird neu geladen (§18.7); nach einem Neuverbinden lädt die Session-Abfrage ohnehin neu und liefert
 * so denselben Übergang.
 */
export function useTranscript(sessionId: string | null, processing: Session['processing'] | undefined) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: transcriptKey(sessionId ?? ''),
    enabled: sessionId !== null,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => getTranscript(sessionId ?? '', signal),
  });
  const previous = useRef(processing);
  useEffect(() => {
    const before = previous.current;
    previous.current = processing;
    if (sessionId === null || !before || !processing) return;
    const finished = (['transcribe', 'align.log'] as const).some(
      (step) => before[step] !== 'fertig' && processing[step] === 'fertig',
    );
    if (finished) void client.invalidateQueries({ queryKey: transcriptKey(sessionId) });
  }, [processing, sessionId, client]);
  return useHydrationSafe(query);
}

export interface ReprocessAction {
  busy: boolean;
  error: string | null;
  run: (fromStep: PipelineStep) => Promise<void>;
}

/** „Erneut versuchen“, „Mit vorhandenem Audio fortfahren“, „Transkript aktualisieren“ (§18.5) */
export function useReprocess(sessionId: string, onSession: (session: Session) => void): ReprocessAction {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const run = useCallback(
    async (fromStep: PipelineStep) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        onSession(await reprocessSession(sessionId, fromStep));
      } catch (cause) {
        setError(reprocessMessage(cause));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [sessionId, onSession],
  );
  return { busy, error, run };
}

// ---------------------------------------------------------------------------------------------
// Zeitrechnung
// ---------------------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** Verstrichene Zeit als `m:ss` bzw. `h:mm:ss` */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Uhrzeit (Ortszeit) zu einer Sitzungszeit: `session.started_at + t_ms`, als `HH:MM` bzw. `HH:MM:SS`.
 * Ohne `started_at` die verstrichene Zeit.
 */
export function clockAt(startedAt: string | null, tMs: number, seconds = false): string {
  const base = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (Number.isNaN(base)) return formatElapsed(tMs);
  const d = new Date(base + tMs);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return seconds ? `${hm}:${pad(d.getSeconds())}` : hm;
}

/** Zeitpunkt (ISO 8601) zu einer Sitzungszeit für `<time dateTime>`; ohne `started_at` `null` */
export function isoAt(startedAt: string | null, tMs: number): string | null {
  const base = startedAt ? Date.parse(startedAt) : Number.NaN;
  return Number.isNaN(base) ? null : new Date(base + tMs).toISOString();
}

/** Schlüssel der Gruppe einer Zeile: Folien-ID, oder `none` für Zeilen ohne Folie */
export const NO_SLIDE = 'none';
export const lineSlideKey = (line: Pick<TranscriptLine, 'slide_id'>): string => line.slide_id ?? NO_SLIDE;

/** Index der Zeile mit `start_ms ≤ t < end_ms` (Zeilen nach `start_ms` sortiert), sonst -1 */
export function activeLineIndex(lines: readonly TranscriptLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid]?.start_ms ?? 0) <= t) {
      last = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  // Zeilen verschiedener Aufnahmen können sich überlappen: ein paar Vorgänger mitprüfen
  for (let i = last; i >= 0 && i > last - 8; i--) {
    const line = lines[i];
    if (line && line.start_ms <= t && t < line.end_ms) return i;
  }
  return -1;
}

/** Folie, deren Segment `t` enthält (bei Überlappung das spätere), sonst `null` */
export function slideAt(segments: readonly SlideSegment[], t: number): SlideSegment | null {
  let found: SlideSegment | null = null;
  for (const s of segments) if (s.start_ms <= t && t < s.end_ms) found = s;
  return found;
}

const SKIP_BACK_MS = 15_000;

export interface PlaybackSpot {
  recording: Recording;
  /** Position in der Datei in Sekunden (`t − recording.started_ms`) */
  offsetS: number;
}

/** Aufnahmen mit Länge, nach `started_ms` */
export function playableRecordings(recordings: readonly Recording[]): Recording[] {
  return recordings
    .filter((r) => r.deleted_at === null && r.duration_ms !== null && r.duration_ms > 0)
    .sort((a, b) => a.started_ms - b.started_ms || a.id.localeCompare(b.id));
}

/**
 * Wo `t` (Sitzungszeit) in den Aufnahmen liegt: in der letzten Aufnahme, die vor `t` beginnt. Liegt `t` hinter deren
 * Ende, beginnt die nächste Aufnahme (zwischen Aufnahmen ist Stille), hinter der letzten gilt deren Ende. Vor der
 * ersten Aufnahme gilt deren Anfang. Rückwärts (`zurueck`) landet eine Zeit in einer Lücke 15 s vor dem Ende der
 * vorherigen Aufnahme, höchstens bis zu deren Anfang.
 */
export function locatePlayback(
  recordings: readonly Recording[],
  t: number,
  direction: 'vor' | 'zurueck' = 'vor',
): PlaybackSpot | null {
  const list = playableRecordings(recordings);
  if (list.length === 0) return null;
  let index = -1;
  list.forEach((r, i) => {
    if (r.started_ms <= t) index = i;
  });
  if (index < 0) return { recording: list[0] as Recording, offsetS: 0 };
  const recording = list[index] as Recording;
  const duration = recording.duration_ms ?? 0;
  const offsetMs = t - recording.started_ms;
  if (offsetMs >= duration) {
    // Rückwärts aus einer Lücke: 15 s vor dem Ende der vorherigen Aufnahme (nicht in die nächste, sonst hängt „zurück“)
    if (direction === 'zurueck') return { recording, offsetS: Math.max(0, duration - SKIP_BACK_MS) / 1000 };
    const next = list[index + 1];
    if (next) return { recording: next, offsetS: 0 };
    return { recording, offsetS: duration / 1000 };
  }
  return { recording, offsetS: Math.max(0, offsetMs) / 1000 };
}

/** Anfang und Ende der Aufnahmen auf der Sitzungszeit (für den Positionsregler) */
export function timelineBounds(recordings: readonly Recording[]): { start: number; end: number } | null {
  const list = playableRecordings(recordings);
  const first = list[0];
  if (!first) return null;
  const end = Math.max(...list.map((r) => r.started_ms + (r.duration_ms ?? 0)));
  return { start: first.started_ms, end };
}
