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
import type { Db, Tx } from '../db/client.ts';
import { audioChunk, job, recording, session } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import { enqueueJob, JOB_NOTIFY_CHANNEL } from './jobs.ts';
import { resolveDataPath } from './material.ts';
import { sha256OfFile, writePartFile } from './pages.ts';

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

/** `POST /sessions/{id}/recordings`. Nur für Sessions in `laeuft` oder `pausiert` (§10.1) */
export async function createRecording(db: Db, sessionId: string, input: RecordingCreate): Promise<Recording> {
  try {
    return await db.transaction(async (tx) => {
      const [parent] = await tx
        .select({ state: session.state })
        .from(session)
        .where(and(eq(session.id, sessionId), isNull(session.deletedAt)))
        // Lesesperre: ein gleichzeitiger Stopp wird abgewartet
        .for('share');
      if (!parent) throw new HttpError(404, 'session_not_found', 'Diese Session gibt es nicht.');
      if (parent.state !== 'laeuft' && parent.state !== 'pausiert') {
        throw new HttpError(409, 'session_not_active', 'Die Session läuft nicht (mehr).');
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
      return toApiRecording(row as RecordingRow, { count: 0, lastSeq: null });
    });
  } catch (error) {
    if (isPrimaryKeyViolation(error)) throw existsError();
    throw error;
  }
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
    .limit(1);
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
 * Ein neuer Chunk traf ein (VERTRAEGE §3): Gibt es schon einen `audio.finalize`-Job, der nicht mehr wartet
 * (laufend, fertig oder fehlgeschlagen), und wartet keiner, entsteht ein neuer. Ohne bisherigen Job (die
 * Aufnahme läuft noch) passiert nichts. Fehlt `complete` noch, startet der Job erst nach 60 s, damit ein
 * Rückstau aus IndexedDB nicht jedes Mal die ganze Datei neu erzeugt.
 */
async function requestFinalizeForLateChunk(tx: Tx, rec: RecordingRow): Promise<void> {
  const latest = await latestFinalizeJob(tx, rec.id);
  if (!latest || latest.state === 'wartet' || latest.state === 'abgebrochen') return;
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
    await requestFinalizeNow(tx, updated as RecordingRow);
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
