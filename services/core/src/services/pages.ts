// Seiten, Striche, Elemente und die PencilKit-Sicherung (VERTRAEGE §7.4, 08 §4, 03 §6).
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type {
  FileReceipt,
  NotebookPages,
  Page,
  PageDetail,
  PageElement,
  PageStrokes,
  PageTemplate,
  Stroke,
  StrokeLayer,
  StrokeTool,
} from '@sg/shared';
import type { Db, DbOrTx } from '../db/client.ts';
import { notebook, page, pageElement, stroke, syncOp, syncStream } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { resolveDataPath } from './material.ts';
import { moduleIsActive } from './notebooks.ts';

type PageRow = typeof page.$inferSelect;
type StrokeRow = typeof stroke.$inferSelect;
type ElementRow = typeof pageElement.$inferSelect;

/** Größte erlaubte PencilKit-Sicherung (VERTRAEGE §7.4) */
export const MAX_PKDRAWING_BYTES = 50 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const pageNotFound = () => new HttpError(404, 'page_not_found', 'Diese Seite gibt es nicht.');

export function toApiPage(row: PageRow): Page {
  return {
    id: row.id,
    user_id: row.userId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
    notebook_id: row.notebookId,
    session_id: row.sessionId,
    index: row.index,
    template: row.template as PageTemplate,
    background_slide_id: row.backgroundSlideId,
    attached_slide_id: row.attachedSlideId,
    width_pt: row.widthPt,
    height_pt: row.heightPt,
    version: row.version,
    has_pkdrawing: row.pkdrawingPath !== null,
  };
}

export function toApiStroke(row: StrokeRow): Stroke {
  return {
    client_id: row.clientId,
    tool: row.tool as StrokeTool,
    layer: row.layer as StrokeLayer,
    color: row.color,
    width: row.width,
    created_at: row.createdAt.getTime(),
    t_start_ms: row.tStartMs,
    t_end_ms: row.tEndMs,
    transform: row.transform as Stroke['transform'],
    bbox: row.bbox as Stroke['bbox'],
    points: Buffer.from(row.points).toString('base64'),
  };
}

export function toApiElement(row: ElementRow): PageElement {
  // Der Schlüssel `kind` entscheidet über die Form von `payload` (CHECK in der DB, Schema bei der Annahme)
  return {
    element_id: row.id,
    kind: row.kind,
    frame: row.frame,
    z: row.z,
    t_ms: row.tMs,
    payload: row.payload,
  } as unknown as PageElement;
}

/**
 * `seq` und `op_id` des Kopfes eines Stroms (`null` bei `seq = 0`). Gehört in dieselbe Transaktion
 * (Momentaufnahme) wie das Lesen des Zustands, damit beides zusammenpasst.
 */
export async function streamPosition(
  tx: DbOrTx,
  stream: string,
): Promise<{ stream_seq: number; stream_op_id: string | null }> {
  const [head] = await tx
    .select({ headSeq: syncStream.headSeq })
    .from(syncStream)
    .where(eq(syncStream.stream, stream));
  const seq = head?.headSeq ?? 0;
  if (seq === 0) return { stream_seq: 0, stream_op_id: null };
  const [op] = await tx
    .select({ opId: syncOp.opId })
    .from(syncOp)
    .where(and(eq(syncOp.stream, stream), eq(syncOp.seq, seq)));
  return { stream_seq: seq, stream_op_id: op?.opId ?? null };
}

/** Lesen mit einer Momentaufnahme: Zustand und Strom-Kopf stammen aus demselben Stand */
function snapshot<T>(db: Db, fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
  return db.transaction((tx) => fn(tx), { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

async function activePage(tx: DbOrTx, id: string): Promise<PageRow> {
  const [row] = await tx
    .select()
    .from(page)
    .where(and(eq(page.id, id), isNull(page.deletedAt)));
  if (!row) throw pageNotFound();
  return row;
}

/** `GET /pages/{id}` */
export async function getPageDetail(db: Db, id: string): Promise<PageDetail> {
  return snapshot(db, async (tx) => {
    const row = await activePage(tx, id);
    const elements = await tx
      .select()
      .from(pageElement)
      .where(and(eq(pageElement.pageId, id), isNull(pageElement.deletedAt)))
      .orderBy(asc(pageElement.z), asc(pageElement.createdAt), asc(pageElement.id));
    return {
      page: toApiPage(row),
      elements: elements.map(toApiElement),
      ...(await streamPosition(tx, `notebook:${row.notebookId}`)),
    };
  });
}

/** `GET /notebooks/{id}/pages`: nach `index`, dann `created_at`, dann `id` */
export async function getNotebookPages(db: Db, notebookId: string): Promise<NotebookPages> {
  return snapshot(db, async (tx) => {
    const [nb] = await tx
      .select({ id: notebook.id })
      .from(notebook)
      .where(and(eq(notebook.id, notebookId), isNull(notebook.deletedAt), moduleIsActive));
    if (!nb) throw new HttpError(404, 'notebook_not_found', 'Dieses Notizbuch gibt es nicht.');
    const rows = await tx
      .select()
      .from(page)
      .where(and(eq(page.notebookId, notebookId), isNull(page.deletedAt)))
      .orderBy(asc(page.index), asc(page.createdAt), asc(page.id));
    return {
      notebook_id: notebookId,
      ...(await streamPosition(tx, `notebook:${notebookId}`)),
      items: rows.map(toApiPage),
    };
  });
}

/** `GET /pages/{id}/strokes`: nach `created_at`, dann `client_id` */
export async function getPageStrokes(db: Db, id: string): Promise<PageStrokes> {
  return snapshot(db, async (tx) => {
    const row = await activePage(tx, id);
    const rows = await tx
      .select()
      .from(stroke)
      .where(and(eq(stroke.pageId, id), isNull(stroke.deletedAt)))
      .orderBy(asc(stroke.createdAt), asc(stroke.clientId));
    return {
      page_id: id,
      ...(await streamPosition(tx, `notebook:${row.notebookId}`)),
      strokes: rows.map(toApiStroke),
    };
  });
}

// ---------- PencilKit-Sicherung ----------

/** Pfad relativ zu `SG_DATA_DIR`. Nur aus der (geprüften) Seiten-ID, VERTRAEGE §4 */
export function pkdrawingRelativePath(pageId: string): string {
  if (!UUID_RE.test(pageId)) throw new Error('Ungültige Seiten-ID');
  return `media/pages/${pageId}.pkdrawing`;
}

/** sha256 einer Datei (hex) */
export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Datei gestreamt nach `<ziel>.<zufall>.part` schreiben, dabei sha256 und Größe bilden. Räumt bei Fehlern auf. */
export async function writePartFile(
  stream: Readable,
  target: string,
  maxBytes: number,
): Promise<{ partPath: string; sha256: string; size: number }> {
  await mkdir(dirname(target), { recursive: true });
  const partPath = `${target}.${randomUUID()}.part`;
  const hash = createHash('sha256');
  let size = 0;
  try {
    await pipeline(
      stream,
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          size += chunk.length;
          if (size > maxBytes) {
            throw new HttpError(
              413,
              'file_too_large',
              `Die Datei ist größer als ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
            );
          }
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(partPath, { flags: 'wx', mode: 0o600 }),
    );
  } catch (error) {
    await rm(partPath, { force: true });
    if (error instanceof HttpError) throw error;
    const code = (error as { code?: string }).code;
    if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET') {
      throw new HttpError(400, 'upload_aborted', 'Der Upload wurde abgebrochen.');
    }
    throw error;
  }
  return { partPath, sha256: hash.digest('hex'), size };
}

/**
 * `PUT /pages/{id}/pkdrawing`: Sicherung nach `media/pages/<page_id>.pkdrawing` schreiben (`.part`, sha256
 * prüfen, atomar umbenennen). Eine neue Sicherung ersetzt die alte. Dieselbe Datei noch einmal: `duplicate = true`.
 * Auch für weich gelöschte Seiten erlaubt (kommen aus dem Papierkorb samt Sicherung zurück).
 */
export async function storePkdrawing(
  db: Db,
  dataDir: string,
  pageId: string,
  stream: Readable,
  expectedSha256: string,
): Promise<FileReceipt> {
  const [row] = await db.select({ id: page.id }).from(page).where(eq(page.id, pageId));
  // Ohne Seite sofort 404, der Body wird nicht gelesen (Node verwirft den Rest nach der Antwort)
  if (!row) throw pageNotFound();
  const relative = pkdrawingRelativePath(pageId);
  const target = resolveDataPath(dataDir, relative);
  if (!target) throw new Error('Pfad außerhalb des Datenordners');

  const part = await writePartFile(stream, target, MAX_PKDRAWING_BYTES);
  try {
    if (part.size === 0) {
      throw new HttpError(400, 'validation_failed', 'Die Datei ist leer.', { in: 'body' });
    }
    if (part.sha256 !== expectedSha256) {
      throw new HttpError(
        422,
        'checksum_mismatch',
        'Die Prüfsumme der Datei stimmt nicht mit X-Sha256 überein.',
      );
    }
    const current = await stat(target).catch(() => null);
    const duplicate =
      current?.isFile() === true &&
      current.size === part.size &&
      (await sha256OfFile(target)) === part.sha256;
    if (duplicate) {
      await rm(part.partPath, { force: true });
    } else {
      await rename(part.partPath, target);
    }
    const [updated] = await db
      .update(page)
      .set({ pkdrawingPath: relative, updatedAt: sql`now()` })
      .where(eq(page.id, pageId))
      .returning({ updatedAt: page.updatedAt });
    return {
      id: pageId,
      sha256: part.sha256,
      size_bytes: part.size,
      received_at: (updated?.updatedAt ?? new Date()).toISOString(),
      duplicate,
    };
  } catch (error) {
    await rm(part.partPath, { force: true });
    throw error;
  }
}

/** Ablage der Sicherung für `GET /pages/{id}/pkdrawing`: Pfad oder `null`, wenn es keine gibt */
export async function findPkdrawingFile(db: Db, dataDir: string, pageId: string): Promise<string | null> {
  const [row] = await db
    .select({ path: page.pkdrawingPath })
    .from(page)
    .where(and(eq(page.id, pageId), isNull(page.deletedAt)));
  if (!row?.path) return null;
  // Der Pfad kommt aus der ID, nicht aus der DB-Spalte: gleiche Regel wie beim Schreiben
  const full = resolveDataPath(dataDir, pkdrawingRelativePath(pageId));
  if (!full) return null;
  const info = await stat(full).catch(() => null);
  return info?.isFile() ? full : null;
}
