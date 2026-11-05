// Audio-Aufnahmen und Chunks (VERTRAEGE §7.3, §10, §3 „Job audio.finalize“). Ticket T1-06.
// Chunk-Ablage wie bei Fotos: `.part` schreiben, sha256 prüfen, atomar umbenennen (services/photos.ts als Vorlage).
import { rename, rm, stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  AudioFinalizePayloadSchema,
  SINGLE_USER_ID,
  type AudioChunk,
  type AudioChunkMeta,
  type AudioCodec,
  type Recording,
  type RecordingComplete,
  type RecordingCreate,
  type RecordingState,
} from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db, Tx } from '../db/client.ts';
import { audioChunk, calendarEvent, job, recording, session } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import { autoStopBoundary } from './auto-stop.ts';
import { enqueueJob, JOB_NOTIFY_CHANNEL } from './jobs.ts';
import { resolveDataPath } from './material.ts';
import { sha256OfFile, writePartFile } from './pages.ts';
import { getSettings } from './settings.ts';

type RecordingRow = typeof recording.$inferSelect;

/** Größter erlaubter Chunk (VERTRAEGE §10.2) */
export const MAX_CHUNK_BYTES = 10 * 1024 * 1024;
/** `seq` ist eine Postgres-`integer`-Spalte */
export const MAX_SEQ = 2_147_483_647;
/** Verzögerung für Nachzügler-Chunks nach einem fertigen Job, solange `complete` fehlt (bündelt Wiederholungen) */
const LATE_CHUNK_DELAY_MS = 60_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXTENSION: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'mp4' };

export interface RecordingEnv {
  dataDir: string;
}

/** Basistyp (`audio/webm` bzw. `audio/mp4`) einer Aufnahme-MIME, kleingeschrieben und ohne Parameter */
export function baseOfMime(mime: string): string {
  return (mime.split(';')[0] ?? '').trim().toLowerCase();
}

/** Pfad relativ zu `SG_DATA_DIR`: `media/recordings/<id>/chunks/<seq>.webm|mp4` (VERTRAEGE §4) */
export function chunkRelativePath(recordingId: string, seq: number, mime: string): string {
  const ext = EXTENSION[baseOfMime(mime)];
  if (!UUID_RE.test(recordingId)) throw new Error('Ungültige Aufnahme-ID');
  if (!ext) throw new Error('Ungültiger Aufnahme-Typ');
  if (!Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ) throw new Error('Ungültige seq');
  return `media/recordings/${recordingId}/chunks/${seq}.${ext}`;
}

function chunkAbsolutePath(dataDir: string, recordingId: string, seq: number, mime: string): string {
  const full = resolveDataPath(dataDir, chunkRelativePath(recordingId, seq, mime));
  if (!full) throw new Error('Pfad außerhalb des Datenordners');
  return full;
}

/** Pfad von `full.m4a` (geschrieben von `audio.finalize`) */
export function fullAudioPath(dataDir: string, recordingId: string): string {
  if (!UUID_RE.test(recordingId)) throw new Error('Ungültige Aufnahme-ID');
  const full = resolveDataPath(dataDir, `media/recordings/${recordingId}/full.m4a`);
  if (!full) throw new Error('Pfad außerhalb des Datenordners');
  return full;
}

const notFound = () => new HttpError(404, 'recording_not_found', 'Diese Aufnahme gibt es nicht.');
const existsError = () => new HttpError(409, 'recording_exists', 'Diese Aufnahme-ID ist schon vergeben.');

/**
 * Serialisiert Chunks, `complete` und das Anlegen von `audio.finalize`-Jobs je Aufnahme bis zum Ende der
 * Transaktion. Auch das Stoppen einer Session (T1-02), das den Job anlegt, muss diese Sperre nehmen
 * (`lockRecording`), sonst können zwei Jobs für dieselbe Aufnahme entstehen.
 */
export async function lockRecording(tx: Tx, recordingId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`recording:${recordingId}`}, 0))`);
}

async function chunkStats(
  db: Db | Tx,
  recordingId: string,
): Promise<{ count: number; lastSeq: number | null }> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`, lastSeq: sql<number | null>`max(${audioChunk.seq})` })
    .from(audioChunk)
    .where(and(eq(audioChunk.recordingId, recordingId), isNull(audioChunk.deletedAt)));
  return { count: row?.count ?? 0, lastSeq: row?.lastSeq ?? null };
}

function toApiRecording(row: RecordingRow, stats: { count: number; lastSeq: number | null }): Recording {
  return {
    id: row.id,
    user_id: row.userId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
    session_id: row.sessionId,
    mime: row.mime,
    codec: row.codec as AudioCodec,
    started_ms: row.startedMs,
    duration_ms: row.durationMs,
    state: row.state as RecordingState,
    chunks_independent: row.chunksIndependent,
    chunk_count: stats.count,
    last_seq: stats.lastSeq,
    completed_at: row.completedAt?.toISOString() ?? null,
  };
}

async function loadRecording(db: Db | Tx, id: string): Promise<RecordingRow> {
  const [row] = await db
    .select()
    .from(recording)
    .where(and(eq(recording.id, id), isNull(recording.deletedAt)));
  if (!row) throw notFound();
  return row;
}

/** `GET /recordings/{id}` */
export async function getRecording(db: Db, id: string): Promise<Recording> {
  const row = await loadRecording(db, id);
  return toApiRecording(row, await chunkStats(db, id));
}

function isPrimaryKeyViolation(error: unknown): boolean {
  const e = error as { code?: string; constraint_name?: string; cause?: unknown } | null;
  if (e?.code === '23505' && e.constraint_name === 'recording_pkey') return true;
  return e?.cause !== undefined && e.cause !== error ? isPrimaryKeyViolation(e.cause) : false;
}

/** Toleranz für `started_ms` einer nachträglich angelegten Aufnahme (VERTRAEGE §10.1) */
const LATE_START_TOLERANCE_MS = 5 * 60_000;
/** Ersatzgrenze nach `absturz_wiederhergestellt` (offene Lead-Frage, VERTRAEGE §10.1) */
const CRASH_RECORDING_LIMIT_MS = 12 * 3_600_000;
/** Wartezeit des Jobs nach dem Stopp, solange `complete` fehlt (VERTRAEGE §3) */
const FINALIZE_GRACE_MS = 10 * 60_000;

/**
 * `POST /sessions/{id}/recordings`. Erlaubt in `laeuft` und `pausiert`. In `beendet`/`verarbeitet` nur, wenn
 * die Aufnahme innerhalb der Grenze der Session begann (offline gestartet, später nachgereicht, §10.1).
 * Der `audio.finalize`-Job entsteht erst mit dem ersten Chunk (leere Aufnahmen bekommen keinen, §10.2);
 * der Aufruf von `ensureFinalizeOnStop` hier ist nur eine Absicherung. Der Sessionstatus bleibt
 * unverändert (Besitz T1-02). Sperrreihenfolge: Session-Zeile, dann `lockRecording`.
 */
export async function createRecording(
  db: Db,
  sessionId: string,
  input: RecordingCreate,
  config: Pick<Config, 'dataDir'> = { dataDir: '' },
): Promise<Recording> {
  try {
    return await db.transaction(async (tx) => {
      const [parent] = await tx
        .select({
          state: session.state,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          stopReason: session.stopReason,
          extendedUntil: session.autoStopExtendedUntil,
          plannedEndsAt: calendarEvent.endsAt,
        })
        .from(session)
        .leftJoin(calendarEvent, eq(calendarEvent.id, session.calendarEventId))
        .where(and(eq(session.id, sessionId), isNull(session.deletedAt)))
        // Lesesperre: ein gleichzeitiger Stopp wird abgewartet
        .for('share', { of: session });
      if (!parent) throw new HttpError(404, 'session_not_found', 'Diese Session gibt es nicht.');
      const live = parent.state === 'laeuft' || parent.state === 'pausiert';
      const lecture = live ? null : (await getSettings(tx, config)).lecture;
      if (!live && !isLateStartAllowed(parent, input.started_ms, lecture)) {
        throw new HttpError(
          409,
          'session_not_active',
          'Die Session läuft nicht (mehr).',
          parent.endedAt ? { ended_at: parent.endedAt.toISOString() } : undefined,
        );
      }
      const id = input.id ?? uuidv7();
      const [taken] = await tx.select({ id: recording.id }).from(recording).where(eq(recording.id, id));
      if (taken) throw existsError();
      const [row] = await tx
        .insert(recording)
        .values({
          id,
          userId: SINGLE_USER_ID,
          sessionId,
          mime: input.mime,
          codec: input.codec,
          startedMs: input.started_ms,
          chunksIndependent: input.chunks_independent ?? false,
        })
        .returning();
      if (!live) await ensureFinalizeOnStop(tx, id, new Date());
      return toApiRecording(row as RecordingRow, { count: 0, lastSeq: null });
    });
  } catch (error) {
    if (isPrimaryKeyViolation(error)) throw existsError();
    throw error;
  }
}

function isLateStartAllowed(
  s: {
    state: string;
    startedAt: Date | null;
    endedAt: Date | null;
    stopReason: string | null;
    extendedUntil: Date | null;
    plannedEndsAt: Date | null;
  },
  startedMs: number,
  lecture: { auto_stop_hard_after_end_min: number; auto_stop_max_duration_min: number } | null,
): boolean {
  if ((s.state !== 'beendet' && s.state !== 'verarbeitet') || !s.startedAt) return false;
  const started = s.startedAt.getTime();
  let limit = s.endedAt?.getTime() ?? started + CRASH_RECORDING_LIMIT_MS;
  if (s.stopReason === 'absturz_wiederhergestellt') {
    // `ended_at` ist hier nur die letzte Aktivität: es gilt die Auto-Stopp-Grenze (VERTRAEGE §10.1, wie der Core-Takt).
    // Die 12 h bleiben nur als Rückfall, falls Werte fehlen
    const boundary = lecture
      ? autoStopBoundary(
          { startedAt: s.startedAt, plannedEndsAt: s.plannedEndsAt, extendedUntil: s.extendedUntil },
          {
            hardAfterEndMin: lecture.auto_stop_hard_after_end_min,
            maxDurationMin: lecture.auto_stop_max_duration_min,
          },
        ).getTime()
      : Number.NaN;
    limit = Math.max(limit, Number.isFinite(boundary) ? boundary : started + CRASH_RECORDING_LIMIT_MS);
  }
  if (s.extendedUntil) limit = Math.max(limit, s.extendedUntil.getTime());
  return startedMs <= limit - started + LATE_START_TOLERANCE_MS;
}

type JobRow = typeof job.$inferSelect;

/** Neuester `audio.finalize`-Job der Aufnahme (nicht gelöscht) */
async function latestFinalizeJob(tx: Tx, recordingId: string): Promise<JobRow | null> {
  const [row] = await tx
    .select()
    .from(job)
    .where(
      and(
        eq(job.type, 'audio.finalize'),
        sql`${job.payload}->>'recording_id' = ${recordingId}`,
        isNull(job.deletedAt),
      ),
    )
    .orderBy(desc(job.createdAt), desc(job.id))
    .limit(1)
    // Der Worker holt Jobs mit FOR UPDATE SKIP LOCKED: während wir entscheiden, kann er den Job nicht übernehmen
    .for('update');
  return row ?? null;
}

async function insertFinalizeJob(
  tx: Tx,
  rec: RecordingRow,
  options: { runAfter?: Date; dependsOn?: string[] },
): Promise<string> {
  const payload = { recording_id: rec.id };
  AudioFinalizePayloadSchema.parse(payload);
  return enqueueJob(tx, {
    type: 'audio.finalize',
    payload,
    sessionId: rec.sessionId,
    ...(options.runAfter ? { runAfter: options.runAfter } : {}),
    ...(options.dependsOn ? { dependsOn: options.dependsOn } : {}),
  });
}

/**
 * `complete` (VERTRAEGE §3): wartet schon ein Job (vom Stopp der Session), wird er sofort fällig
 * (`run_after = now()`), es entsteht kein zweiter. Sonst entsteht ein Job ohne Wartezeit. Läuft einer gerade
 * oder ist er schon fertig, kommt ein neuer hinzu, der bei einem laufenden Job erst nach diesem startet
 * (Abhängigkeit). Der Aufrufer hält die Sperre `lockRecording`.
 */
export async function requestFinalizeNow(tx: Tx, rec: RecordingRow): Promise<void> {
  const latest = await latestFinalizeJob(tx, rec.id);
  if (!latest) {
    await insertFinalizeJob(tx, rec, {});
  } else if (latest.state === 'wartet') {
    await tx
      .update(job)
      .set({ runAfter: sql`now()`, updatedAt: sql`now()` })
      .where(eq(job.id, latest.id));
    await tx.execute(sql`SELECT pg_notify(${JOB_NOTIFY_CHANNEL}, ${latest.id})`);
  } else {
    await insertFinalizeJob(tx, rec, latest.state === 'laeuft' ? { dependsOn: [latest.id] } : {});
  }
}

/**
 * Für den Stopp einer Session (T1-02, VERTRAEGE §3, §16.2): nimmt `lockRecording` und legt den Job an, wenn
 * noch keiner existiert (oder der letzte `fehler`/`abgebrochen` ist). Sofort, wenn die Aufnahme schon
 * abgeschlossen ist, sonst mit `run_after = stoppedAt + 10 min`. Aufnahmen ohne Chunks bekommen keinen Job. Ein Job in `wartet`, `laeuft` oder `fertig`
 * bleibt unberührt. Mehrere Aufnahmen: in sortierter ID-Reihenfolge aufrufen (Sperrreihenfolge §16.2).
 */
export async function ensureFinalizeOnStop(
  tx: Tx,
  recordingId: string,
  stoppedAt: Date,
  graceMs: number = FINALIZE_GRACE_MS,
): Promise<void> {
  await lockRecording(tx, recordingId);
  const [rec] = await tx
    .select()
    .from(recording)
    .where(and(eq(recording.id, recordingId), isNull(recording.deletedAt)));
  if (!rec) return;
  // Eine Aufnahme ohne Chunks bekommt keinen Job (Pause vor dem ersten Chunk). Der erste Chunk legt ihn an.
  if ((await chunkStats(tx, recordingId)).count === 0) return;
  const latest = await latestFinalizeJob(tx, recordingId);
  if (latest && latest.state !== 'fehler' && latest.state !== 'abgebrochen') return;
  await insertFinalizeJob(
    tx,
    rec,
    rec.completedAt ? {} : { runAfter: new Date(stoppedAt.getTime() + graceMs) },
  );
}

/**
 * Ein neuer Chunk traf ein (VERTRAEGE §3): Gibt es keinen Job (leere Aufnahme beim Stopp), entsteht der erste:
 * sofort bei abgeschlossener Aufnahme, nach 10 min bei beendeter Session, sonst keiner. Gibt es schon einen `audio.finalize`-Job, der nicht mehr wartet
 * (laufend, fertig oder fehlgeschlagen), und wartet keiner, entsteht ein neuer. Ohne bisherigen Job (die
 * Aufnahme läuft noch) passiert nichts. Fehlt `complete` noch, startet der Job erst nach 60 s, damit ein
 * Rückstau aus IndexedDB nicht jedes Mal die ganze Datei neu erzeugt.
 */
async function requestFinalizeForLateChunk(tx: Tx, rec: RecordingRow): Promise<void> {
  const latest = await latestFinalizeJob(tx, rec.id);
  if (!latest) {
    // Erster Job der Aufnahme (sie war leer, als die Session stoppte bzw. `complete` kam)
    if (rec.completedAt) return void (await insertFinalizeJob(tx, rec, {}));
    const [parent] = await tx
      .select({ state: session.state })
      .from(session)
      .where(eq(session.id, rec.sessionId));
    const live = parent?.state === 'laeuft' || parent?.state === 'pausiert';
    if (!live) {
      await insertFinalizeJob(tx, rec, { runAfter: new Date(Date.now() + FINALIZE_GRACE_MS) });
    }
    return;
  }
  if (latest.state === 'wartet') return;
  await insertFinalizeJob(tx, rec, {
    ...(rec.completedAt ? {} : { runAfter: new Date(Date.now() + LATE_CHUNK_DELAY_MS) }),
    ...(latest.state === 'laeuft' ? { dependsOn: [latest.id] } : {}),
  });
}

function toApiChunk(row: typeof audioChunk.$inferSelect, duplicate: boolean): AudioChunk {
  return {
    recording_id: row.recordingId,
    seq: row.seq,
    start_ms: row.startMs,
    duration_ms: row.durationMs,
    sha256: row.sha256,
    size_bytes: row.sizeBytes,
    received_at: row.receivedAt.toISOString(),
    duplicate,
  };
}

async function fileMatches(path: string, sha256: string, size: number): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.isFile() === true && info.size === size && (await sha256OfFile(path)) === sha256;
}

/**
 * `PUT /recordings/{id}/chunks/{seq}`. Reihenfolge der Uploads ist egal, Wiederholungen sind idempotent:
 * gleiche `seq` mit gleichem sha256 = `duplicate`, anderes sha256 = `409 chunk_conflict`.
 * `contentType` ist der Basistyp des Requests (Prüfung gegen die Aufnahme: 415).
 */
export async function storeChunk(
  db: Db,
  recordingId: string,
  meta: AudioChunkMeta,
  contentType: string,
  stream: Readable,
  env: RecordingEnv,
): Promise<AudioChunk> {
  // Vorab prüfen, damit unbekannte Aufnahmen und falsche Typen keine Datei schreiben
  const rec = await loadRecording(db, recordingId);
  if (contentType !== baseOfMime(rec.mime)) {
    throw new HttpError(
      415,
      'chunk_mime_mismatch',
      `Der Content-Type muss ${baseOfMime(rec.mime)} sein (Typ der Aufnahme).`,
    );
  }
  const target = chunkAbsolutePath(env.dataDir, recordingId, meta.seq, rec.mime);
  const part = await writePartFile(stream, target, MAX_CHUNK_BYTES).catch((error: unknown) => {
    if (error instanceof HttpError && error.code === 'file_too_large') {
      throw new HttpError(413, 'chunk_too_large', 'Der Chunk ist größer als 10 MB.');
    }
    throw error;
  });
  try {
    if (part.size === 0) throw new HttpError(400, 'validation_failed', 'Der Chunk ist leer.', { in: 'body' });
    if (part.sha256 !== meta.sha256) {
      throw new HttpError(
        422,
        'checksum_mismatch',
        'Die Prüfsumme des Chunks stimmt nicht mit X-Sha256 überein.',
      );
    }
    return await db.transaction(async (tx) => {
      await lockRecording(tx, recordingId);
      // Nach der Sperre erneut lesen: die Aufnahme könnte inzwischen gelöscht worden sein
      const current = await loadRecording(tx, recordingId);
      const [existing] = await tx
        .select()
        .from(audioChunk)
        .where(and(eq(audioChunk.recordingId, recordingId), eq(audioChunk.seq, meta.seq)));
      if (existing) {
        if (existing.sha256 !== meta.sha256) {
          throw new HttpError(409, 'chunk_conflict', 'Zu dieser seq liegt schon ein anderer Chunk vor.', {
            seq: meta.seq,
          });
        }
        // Gleicher Inhalt. Fehlt die Datei (z. B. von Hand gelöscht), wird sie wiederhergestellt.
        if (await fileMatches(target, existing.sha256, existing.sizeBytes)) {
          await rm(part.partPath, { force: true });
        } else {
          await rename(part.partPath, target);
        }
        return toApiChunk(existing, true);
      }
      if (current.completedAt && current.completedLastSeq !== null && meta.seq > current.completedLastSeq) {
        throw new HttpError(
          409,
          'recording_completed',
          'Die Aufnahme ist abgeschlossen; diese seq liegt hinter last_seq.',
          { seq: meta.seq, last_seq: current.completedLastSeq },
        );
      }
      const [row] = await tx
        .insert(audioChunk)
        .values({
          id: uuidv7(),
          userId: SINGLE_USER_ID,
          recordingId,
          seq: meta.seq,
          startMs: meta.start_ms,
          durationMs: meta.duration_ms,
          filePath: chunkRelativePath(recordingId, meta.seq, current.mime),
          sha256: meta.sha256,
          sizeBytes: part.size,
        })
        .returning();
      await rename(part.partPath, target);
      await requestFinalizeForLateChunk(tx, current);
      return toApiChunk(row as typeof audioChunk.$inferSelect, false);
    });
  } catch (error) {
    await rm(part.partPath, { force: true });
    throw error;
  }
}

/**
 * `POST /recordings/{id}/complete`. `last_seq` darf nicht unter der höchsten empfangenen `seq` liegen
 * (`409 recording_seq_conflict`). Stellt `audio.finalize` ein bzw. macht den wartenden Job fällig.
 * Wiederholung mit denselben Werten ist wirkungslos; andere Werte aktualisieren die Angaben und stoßen
 * die Verarbeitung erneut an (z. B. nach nachgelieferten Chunks).
 */
export async function completeRecording(db: Db, id: string, input: RecordingComplete): Promise<Recording> {
  return db.transaction(async (tx) => {
    await lockRecording(tx, id);
    const rec = await loadRecording(tx, id);
    const stats = await chunkStats(tx, id);
    if (stats.lastSeq !== null && input.last_seq < stats.lastSeq) {
      throw new HttpError(
        409,
        'recording_seq_conflict',
        'last_seq liegt unter einer schon empfangenen seq.',
        {
          last_seq: input.last_seq,
          received_last_seq: stats.lastSeq,
        },
      );
    }
    if (
      rec.completedAt &&
      rec.completedLastSeq === input.last_seq &&
      rec.completedDurationMs === input.duration_ms
    ) {
      return toApiRecording(rec, stats);
    }
    const [updated] = await tx
      .update(recording)
      .set({
        completedAt: rec.completedAt ?? sql`now()`,
        completedLastSeq: input.last_seq,
        completedDurationMs: input.duration_ms,
        updatedAt: sql`now()`,
      })
      .where(eq(recording.id, id))
      .returning();
    if (stats.count > 0) await requestFinalizeNow(tx, updated as RecordingRow);
    return toApiRecording(updated as RecordingRow, stats);
  });
}

/** Datei für `GET /recordings/{id}/audio`, oder `null` (noch nicht erzeugt) */
export async function findFullAudio(db: Db, dataDir: string, id: string): Promise<string | null> {
  await loadRecording(db, id);
  const path = fullAudioPath(dataDir, id);
  const info = await stat(path).catch(() => null);
  return info?.isFile() ? path : null;
}
