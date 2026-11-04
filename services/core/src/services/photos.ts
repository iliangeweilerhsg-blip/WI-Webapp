// Tafel-Fotos (VERTRAEGE §7.4, §11.3, §16.2).
// upsertPhotoMeta (Op `photo.add`) und storePhotoFile (`PUT /photos/{id}/file`) prüfen sich gegenseitig
// (sha256, Typ). Die Reihenfolge von Datei und Metadaten ist egal.
//
// Abweichung von der Signatur in §16.2: Beide Funktionen brauchen den Datenordner, `storePhotoFile` zusätzlich
// die Datenbank. Sie bekommen darum einen letzten Parameter `env`.
import { rename, rm, stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { SINGLE_USER_ID, type FileReceipt, type Photo, type PhotoAddData, type PhotoMime } from '@sg/shared';
import type { Db, Tx } from '../db/client.ts';
import { photo, session } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { SyncOpError } from '../sync/handlers.ts';
import { resolveDataPath } from './material.ts';
import { sha256OfFile, writePartFile } from './pages.ts';

type PhotoRow = typeof photo.$inferSelect;

/** Größtes erlaubtes Foto (VERTRAEGE §7.4) */
export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Dateiendung je Typ. Die Endung kommt nie aus der Eingabe (VERTRAEGE §4) */
const EXTENSION: Record<PhotoMime, string> = { 'image/heic': 'heic', 'image/jpeg': 'jpg' };
const MIMES = Object.keys(EXTENSION) as PhotoMime[];

export interface PhotoMetaEnv {
  dataDir: string;
}
export interface PhotoFileEnv extends PhotoMetaEnv {
  db: Db;
}

/** Pfad relativ zu `SG_DATA_DIR`: `media/photos/<photo_id>.heic|jpg`, nur aus geprüfter ID und Typ */
export function photoRelativePath(photoId: string, mime: PhotoMime): string {
  if (!UUID_RE.test(photoId)) throw new Error('Ungültige Foto-ID');
  const ext = EXTENSION[mime];
  if (!ext) throw new Error('Ungültiger Foto-Typ');
  return `media/photos/${photoId}.${ext}`;
}

function photoAbsolutePath(dataDir: string, photoId: string, mime: PhotoMime): string {
  const full = resolveDataPath(dataDir, photoRelativePath(photoId, mime));
  if (!full) throw new Error('Pfad außerhalb des Datenordners');
  return full;
}

/** Serialisiert Datei-Ablage und Metadaten je Foto bis zum Ende der Transaktion */
async function lockPhoto(tx: Tx, photoId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`photo:${photoId}`}, 0))`);
}

async function fileIsFor(path: string, sha256: string, size: number): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.isFile() === true && info.size === size && (await sha256OfFile(path)) === sha256;
}

export function toApiPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    user_id: row.userId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
    session_id: row.sessionId,
    t_ms: row.tMs,
    page_id: row.pageId,
    mime: row.mime as PhotoMime,
    sha256: row.sha256,
    size_bytes: row.sizeBytes,
    has_file: row.filePath !== null,
    ocr_text: row.ocrText,
  };
}

/** `GET /photos/{id}` */
export async function getPhoto(db: Db, id: string): Promise<Photo> {
  const [row] = await db
    .select()
    .from(photo)
    .where(and(eq(photo.id, id), isNull(photo.deletedAt)));
  if (!row) throw new HttpError(404, 'photo_not_found', 'Dieses Foto gibt es nicht.');
  return toApiPhoto(row);
}

/** Datei für `GET /photos/{id}/file`, oder `null` (kein Foto, gelöscht, Datei fehlt) */
export async function findPhotoFile(
  db: Db,
  dataDir: string,
  id: string,
): Promise<{ path: string; mime: PhotoMime; sha256: string; size: number } | null> {
  const [row] = await db
    .select()
    .from(photo)
    .where(and(eq(photo.id, id), isNull(photo.deletedAt)));
  if (!row?.filePath) return null;
  const mime = row.mime as PhotoMime;
  const path = photoAbsolutePath(dataDir, id, mime);
  const info = await stat(path).catch(() => null);
  return info?.isFile() ? { path, mime, sha256: row.sha256, size: info.size } : null;
}

/**
 * `photo.add`: `photo`-Zeile anlegen, idempotent über `photo_id` (vorhandene Zeile bleibt unverändert).
 * - Weich gelöschte Session: das Foto übernimmt deren `deleted_at`. Session unbekannt: `session_not_found`.
 * - Lag die Datei schon da (Upload vor der Operation), wird sie gegen `file_ref` geprüft (sha256, Größe):
 *   passt sie, ist `has_file` wahr, sonst bleibt `file_path` leer und der nächste Upload ersetzt sie.
 */
export async function upsertPhotoMeta(tx: Tx, data: PhotoAddData, env: PhotoMetaEnv): Promise<void> {
  await lockPhoto(tx, data.photo_id);
  const [existing] = await tx.select({ id: photo.id }).from(photo).where(eq(photo.id, data.photo_id));
  if (existing) return;

  const [parent] = await tx
    .select({ deletedAt: session.deletedAt })
    .from(session)
    .where(eq(session.id, data.session_id))
    // Lesesperre: ein laufendes Löschen der Session wird abgewartet (sonst aktives Foto in gelöschter Session)
    .for('share');
  if (!parent) throw new SyncOpError('session_not_found', false, { session_id: data.session_id });

  const { sha256, mime, size_bytes: size } = data.file_ref;
  const stored = await fileIsFor(photoAbsolutePath(env.dataDir, data.photo_id, mime), sha256, size);
  await tx
    .insert(photo)
    .values({
      id: data.photo_id,
      userId: SINGLE_USER_ID,
      deletedAt: parent.deletedAt,
      sessionId: data.session_id,
      tMs: data.t_ms,
      pageId: data.page_id,
      filePath: stored ? photoRelativePath(data.photo_id, mime) : null,
      mime,
      sha256,
      sizeBytes: size,
    })
    .onConflictDoNothing();
  // Eine früh hochgeladene Datei der anderen Art (HEIC, aber `file_ref` sagt JPEG) ist verwaist: aufräumen
  for (const other of MIMES.filter((m) => m !== mime)) {
    await rm(photoAbsolutePath(env.dataDir, data.photo_id, other), { force: true });
  }
}

/**
 * `PUT /photos/{id}/file`: Datei nach `media/photos/<id>.<ext>` schreiben (`.part`, sha256 prüfen, atomar
 * umbenennen). Gibt es die Zeile (`photo.add`), müssen sha256, Typ und Größe zu ihr passen, sonst
 * `409 photo_file_conflict`. Ohne Zeile wird die Datei trotzdem abgelegt. Dieselbe Datei noch einmal:
 * `duplicate = true`. Eine andere Datei zur selben ID ohne Zeile: `409 photo_file_conflict`.
 */
export async function storePhotoFile(
  id: string,
  stream: Readable,
  sha256: string,
  mime: PhotoMime,
  env: PhotoFileEnv,
): Promise<FileReceipt> {
  const target = photoAbsolutePath(env.dataDir, id, mime);
  const part = await writePartFile(stream, target, MAX_PHOTO_BYTES);
  try {
    if (part.size === 0) throw new HttpError(400, 'validation_failed', 'Die Datei ist leer.', { in: 'body' });
    if (part.sha256 !== sha256) {
      throw new HttpError(
        422,
        'checksum_mismatch',
        'Die Prüfsumme der Datei stimmt nicht mit X-Sha256 überein.',
      );
    }
    return await env.db.transaction(async (tx) => {
      await lockPhoto(tx, id);
      const [row] = await tx.select().from(photo).where(eq(photo.id, id));
      const conflict = (reason: string) =>
        new HttpError(
          409,
          'photo_file_conflict',
          'Zu dieser Foto-ID liegt schon etwas anderes vor (sha256 oder Typ).',
          { reason },
        );
      if (row) {
        if (row.mime !== mime) throw conflict('mime');
        if (row.sha256 !== sha256) throw conflict('sha256');
        if (row.sizeBytes !== part.size) throw conflict('size_bytes');
      } else {
        // Ohne Zeile: eine schon abgelegte Datei der anderen Art (HEIC statt JPEG) ist ein Widerspruch
        for (const other of MIMES.filter((m) => m !== mime)) {
          const info = await stat(photoAbsolutePath(env.dataDir, id, other)).catch(() => null);
          if (info?.isFile()) throw conflict('mime');
        }
      }

      const current = await stat(target).catch(() => null);
      const same = current?.isFile() === true && (await fileIsFor(target, sha256, part.size));
      if (current?.isFile() && !same && !row) throw conflict('sha256');

      if (same) {
        await rm(part.partPath, { force: true });
      } else {
        // Mit Zeile ist `file_ref` maßgeblich: eine abweichende Datei vom frühen Upload wird ersetzt
        await rename(part.partPath, target);
      }
      if (row && row.filePath === null) {
        await tx
          .update(photo)
          .set({ filePath: photoRelativePath(id, mime), updatedAt: sql`now()` })
          .where(eq(photo.id, id));
      }
      return {
        id,
        sha256,
        size_bytes: part.size,
        received_at: (same && current ? current.mtime : new Date()).toISOString(),
        duplicate: same,
      };
    });
  } catch (error) {
    await rm(part.partPath, { force: true });
    throw error;
  }
}
