// Transkript lesen und Kette neu anstoßen (VERTRAEGE §18.4, §18.5). Geschrieben wird `transcript` vom Worker;
// der Core liest nur und teilt die Abschnitte beim Lesen an den Foliengrenzen.
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type {
  Recording,
  SessionReprocessRequest,
  SessionReprocessResult,
  SessionTranscript,
  SlideSegment,
  SlideSegmentSource,
  TranscriptInfo,
  TranscriptLine,
  TranscriptWord,
} from '@sg/shared';
import type { Db } from '../db/client.ts';
import {
  notDeleted,
  recording,
  session,
  slideSegment,
  transcript,
  transcriptSegment,
} from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { toApiJob } from './jobs.ts';
import { ensurePipelineJobs, recordingsWithChunks } from './pipeline.ts';
import { isoTs, requireSession, toApiSession } from './sessions.ts';

/** Rangfolge der Quellen der Folienzuordnung (§18.4): die erste mit nicht gelöschten Segmenten gewinnt */
const SLIDE_SOURCES: readonly SlideSegmentSource[] = ['manuell', 'ausrichtung', 'log'];

export interface TranscriptQuery {
  /** Nur Zeilen dieser Folie. Eine unbekannte Folie ergibt leere `lines` */
  slideId?: string | undefined;
  includeWords: boolean;
}

// --- Teilung an Foliengrenzen (§18.4) -------------------------------------------------------------------

/** Abschnitt, wie ihn die Teilung braucht */
export interface SplitInput {
  id: string;
  recordingId: string;
  startMs: number;
  endMs: number;
  text: string;
  lang: string | null;
  words: TranscriptWord[] | null;
}

/** Folie eines Segments der gewählten Quelle */
export interface SlideRange {
  slideId: string;
  slideIndex: number;
  startMs: number;
  endMs: number;
}

/** Regel 1: überlappend. Ein Abschnitt ohne Dauer zählt, wenn sein Zeitpunkt im Segment liegt (Ende ausschließlich) */
function overlaps(g: SplitInput, s: SlideRange): boolean {
  if (g.startMs === g.endMs) return s.startMs <= g.startMs && g.startMs < s.endMs;
  return s.startMs < g.endMs && g.startMs < s.endMs;
}

/** Abstand eines Zeitpunkts zum Intervall `[start, end)`; 0 innerhalb */
function distance(point: number, s: SlideRange): number {
  return Math.max(s.startMs - point, point - s.endMs, 0);
}

/**
 * Teilt einen Abschnitt `g` an den Grenzen der Folien-Segmente `slides` (nach `start_ms` sortiert) in Zeilen:
 * 1. überlappende Segmente bestimmen,
 * 2. keines: eine Zeile ohne Folie,
 * 3. mindestens zwei und Wörter vorhanden: jedes Wort gehört zum Segment, das die Mitte `floor((start+end)/2)`
 *    enthält, sonst zum nächstgelegenen überlappenden (Gleichstand: das frühere). Aufeinanderfolgende Wörter
 *    derselben Folie bilden eine Zeile,
 * 4. sonst eine Zeile mit dem ganzen Abschnitt, Folie = Segment mit der Mitte von `g`, ersatzweise das mit der
 *    größten Überlappung (Gleichstand: das frühere).
 */
export function splitSegment(g: SplitInput, slides: SlideRange[], includeWords: boolean): TranscriptLine[] {
  const line = (
    part: number,
    slide: SlideRange | null,
    startMs: number,
    endMs: number,
    text: string,
    words: TranscriptWord[],
  ): TranscriptLine => ({
    segment_id: g.id,
    part,
    recording_id: g.recordingId,
    slide_id: slide?.slideId ?? null,
    slide_index: slide?.slideIndex ?? null,
    start_ms: startMs,
    end_ms: endMs,
    text,
    lang: g.lang as TranscriptLine['lang'],
    ...(includeWords ? { words } : {}),
  });

  const hit = slides.filter((s) => overlaps(g, s));
  if (hit.length === 0) return [line(0, null, g.startMs, g.endMs, g.text, g.words ?? [])];

  const words = g.words ?? [];
  if (hit.length >= 2 && words.length > 0) {
    const lines: TranscriptLine[] = [];
    let current: { slide: SlideRange; words: TranscriptWord[] } | null = null;
    const flush = () => {
      if (!current) return;
      const first = current.words[0]!;
      const last = current.words[current.words.length - 1]!;
      lines.push(
        line(
          lines.length,
          current.slide,
          first.start_ms,
          last.end_ms,
          current.words.map((w) => w.text).join(' '),
          current.words,
        ),
      );
    };
    for (const word of words) {
      const mid = Math.floor((word.start_ms + word.end_ms) / 2);
      let owner = hit.find((s) => s.startMs <= mid && mid < s.endMs);
      if (!owner) {
        owner = hit[0]!;
        for (const s of hit) if (distance(mid, s) < distance(mid, owner)) owner = s;
      }
      if (current && current.slide.slideId === owner.slideId) {
        current.words.push(word);
      } else {
        flush();
        current = { slide: owner, words: [word] };
      }
    }
    flush();
    return lines;
  }

  const mid = Math.floor((g.startMs + g.endMs) / 2);
  let owner = hit.find((s) => s.startMs <= mid && mid < s.endMs);
  if (!owner) {
    const size = (s: SlideRange) => Math.min(s.endMs, g.endMs) - Math.max(s.startMs, g.startMs);
    owner = hit[0]!;
    for (const s of hit) if (size(s) > size(owner)) owner = s;
  }
  return [line(0, owner, g.startMs, g.endMs, g.text, words)];
}

// --- GET /sessions/{id}/transcript ----------------------------------------------------------------------

/**
 * `GET /sessions/{id}/transcript` (§18.4). Eine Transaktion mit `REPEATABLE READ`, damit Zuordnung, Transkript und
 * `stale` zusammenpassen. Wörter werden nur gelesen, wenn sie gebraucht werden (`include_words` oder Teilung).
 * Fehler: 404 `session_not_found` (auch weich gelöscht).
 */
export async function getSessionTranscript(
  db: Db,
  sessionId: string,
  query: TranscriptQuery,
): Promise<SessionTranscript> {
  return db.transaction(
    async (tx) => {
      const loaded = await requireSession(tx, sessionId);

      // Folienzuordnung: erst Segmente gelöschter Folien weglassen, dann die erste Quelle mit Segmenten wählen
      const segRows = await tx
        .select({
          seg: slideSegment,
          slideAlive: sql<boolean>`EXISTS (SELECT 1 FROM slide s WHERE s.id = ${slideSegment.slideId} AND s.deleted_at IS NULL)`,
        })
        .from(slideSegment)
        .where(and(eq(slideSegment.sessionId, sessionId), notDeleted(slideSegment)))
        .orderBy(asc(slideSegment.startMs), asc(slideSegment.id));
      const liveRows = segRows.filter((r) => r.slideAlive);
      const slideSource = SLIDE_SOURCES.find((s) => liveRows.some((r) => r.seg.source === s)) ?? null;
      const chosen = liveRows.filter((r) => r.seg.source === slideSource);
      const slide_segments = chosen.map(({ seg }): SlideSegment => ({
        id: seg.id,
        user_id: seg.userId,
        created_at: isoTs(seg.createdAt),
        updated_at: isoTs(seg.updatedAt),
        deleted_at: seg.deletedAt ? isoTs(seg.deletedAt) : null,
        session_id: seg.sessionId,
        slide_id: seg.slideId,
        slide_index: seg.slideIndex,
        start_ms: seg.startMs,
        end_ms: seg.endMs,
        source: seg.source as SlideSegmentSource,
        confidence: seg.confidence,
        job_id: seg.jobId,
      }));

      // Transkripte; `stale`: der neueste fertige audio.finalize-Job der Aufnahme ist nicht `finalize_job_id`
      const transcriptRows = await tx
        .select({
          row: transcript,
          stale: sql<boolean>`COALESCE((
            SELECT j.id <> ${transcript.finalizeJobId} FROM job j
            WHERE j.session_id = ${transcript.sessionId} AND j.type = 'audio.finalize'
              AND j.payload->>'recording_id' = ${transcript.recordingId}::text
              AND j.state = 'fertig' AND j.deleted_at IS NULL
            ORDER BY j.created_at DESC, j.id DESC LIMIT 1), false)`,
        })
        .from(transcript)
        .innerJoin(recording, eq(recording.id, transcript.recordingId))
        .where(and(eq(transcript.sessionId, sessionId), notDeleted(transcript)))
        .orderBy(asc(recording.startedMs), asc(transcript.id));
      const transcripts = transcriptRows.map(({ row: t, stale }): TranscriptInfo => ({
        id: t.id,
        user_id: t.userId,
        created_at: isoTs(t.createdAt),
        updated_at: isoTs(t.updatedAt),
        deleted_at: t.deletedAt ? isoTs(t.deletedAt) : null,
        session_id: t.sessionId,
        recording_id: t.recordingId,
        job_id: t.jobId,
        finalize_job_id: t.finalizeJobId,
        provider: t.provider as TranscriptInfo['provider'],
        model: t.model,
        language: t.language as TranscriptInfo['language'],
        segment_count: t.segmentCount,
        word_count: t.wordCount,
        audio_duration_ms: t.audioDurationMs,
        stale,
      }));

      // Aufnahmen wie im Snapshot, nach started_ms
      const recordingRows = await tx
        .select({
          row: recording,
          chunkCount: sql<number>`(SELECT count(*)::int FROM audio_chunk c WHERE c.recording_id = ${recording.id} AND c.deleted_at IS NULL)`,
          lastSeq: sql<
            number | null
          >`(SELECT max(c.seq)::int FROM audio_chunk c WHERE c.recording_id = ${recording.id} AND c.deleted_at IS NULL)`,
        })
        .from(recording)
        .where(and(eq(recording.sessionId, sessionId), notDeleted(recording)))
        .orderBy(asc(recording.startedMs), asc(recording.id));
      const recordings = recordingRows.map(({ row: r, chunkCount, lastSeq }): Recording => ({
        id: r.id,
        user_id: r.userId,
        created_at: isoTs(r.createdAt),
        updated_at: isoTs(r.updatedAt),
        deleted_at: r.deletedAt ? isoTs(r.deletedAt) : null,
        session_id: r.sessionId,
        mime: r.mime,
        codec: r.codec as Recording['codec'],
        started_ms: r.startedMs,
        duration_ms: r.durationMs,
        state: r.state as Recording['state'],
        chunks_independent: r.chunksIndependent,
        chunk_count: chunkCount,
        last_seq: lastSeq,
        completed_at: r.completedAt ? isoTs(r.completedAt) : null,
      }));

      // Oben: ein Transkript ist veraltet, oder eine Aufnahme mit Dauer und fertigem Audio hat gar keins
      const [missing] = await tx.execute<{ missing: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM recording r
          WHERE r.session_id = ${sessionId} AND r.deleted_at IS NULL AND r.duration_ms > 0
            AND EXISTS (SELECT 1 FROM job j WHERE j.session_id = r.session_id AND j.type = 'audio.finalize'
                        AND j.payload->>'recording_id' = r.id::text AND j.state = 'fertig' AND j.deleted_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM transcript t WHERE t.recording_id = r.id AND t.deleted_at IS NULL)
        ) AS missing`);
      const stale = transcripts.some((t) => t.stale) || missing?.missing === true;

      // Zeilen
      const needWords = query.includeWords || slide_segments.length >= 2;
      const segmentRows = await tx
        .select({
          id: transcriptSegment.id,
          recordingId: transcriptSegment.recordingId,
          startMs: transcriptSegment.startMs,
          endMs: transcriptSegment.endMs,
          text: transcriptSegment.text,
          lang: transcriptSegment.lang,
          words: needWords ? transcriptSegment.words : sql<TranscriptWord[] | null>`NULL::jsonb`,
        })
        .from(transcriptSegment)
        .where(and(eq(transcriptSegment.sessionId, sessionId), isNull(transcriptSegment.deletedAt)))
        .orderBy(
          asc(transcriptSegment.startMs),
          asc(transcriptSegment.recordingId),
          asc(transcriptSegment.seq),
        );
      const ranges: SlideRange[] = slide_segments.map((s) => ({
        slideId: s.slide_id,
        slideIndex: s.slide_index,
        startMs: s.start_ms,
        endMs: s.end_ms,
      }));
      let lines = segmentRows.flatMap((g) => splitSegment(g, ranges, query.includeWords));
      if (query.slideId !== undefined) lines = lines.filter((l) => l.slide_id === query.slideId);

      return {
        session_id: sessionId,
        slide_deck_id: loaded.row.slideDeckId,
        slide_source: slideSource,
        slide_segments,
        transcripts,
        recordings,
        lines,
        stale,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

// --- POST /sessions/{id}/reprocess ----------------------------------------------------------------------

/**
 * `POST /sessions/{id}/reprocess` (§18.5): sperrt die Session (`FOR NO KEY UPDATE`) und ruft `ensurePipelineJobs`.
 * Der Zustand der Session ändert sich nicht, nur `processing`.
 *
 * Fehler (HttpError): 404 `session_not_found`, 409 `session_not_ended` (`details.state`), 409 `session_no_audio`
 * (ab `audio.finalize`/`transcribe` ohne nicht gelöschte Aufnahme mit mindestens einem Chunk).
 */
export async function reprocessSession(
  db: Db,
  sessionId: string,
  input: SessionReprocessRequest,
): Promise<SessionReprocessResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ state: session.state, deletedAt: session.deletedAt })
      .from(session)
      .where(eq(session.id, sessionId))
      .for('no key update');
    if (!row || row.deletedAt) {
      throw new HttpError(404, 'session_not_found', 'Die Session wurde nicht gefunden.');
    }
    if (row.state !== 'beendet' && row.state !== 'verarbeitet') {
      throw new HttpError(409, 'session_not_ended', 'Die Session ist noch nicht beendet.', {
        state: row.state,
      });
    }
    const fromStep = input.from_step ?? 'transcribe';
    if (fromStep !== 'align.log' && (await recordingsWithChunks(tx, sessionId)).length === 0) {
      throw new HttpError(409, 'session_no_audio', 'Die Session hat keine Aufnahme mit Audio.');
    }
    const jobs = await ensurePipelineJobs(tx, sessionId, { fromStep, force: input.force ?? false });
    return { session: toApiSession(await requireSession(tx, sessionId)), jobs: jobs.map(toApiJob) };
  });
}
