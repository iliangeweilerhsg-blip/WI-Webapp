// Material (03 §4): Foliensätze, Folien, Übungsblätter. Upload, Abfragen, Soft-Delete (F-ORG-02/03).
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import {
  SINGLE_USER_ID,
  type ExerciseSheet,
  type ExerciseSheetList,
  type ExerciseSheetUpdate,
  type Slide,
  type SlideDeck,
  type SlideDeckDetail,
  type SlideDeckList,
  type UploadResult,
} from '@sg/shared';
import type { Db, Tx } from '../db/client.ts';
import { notDeleted } from '../db/schema/common.ts';
import { courseModule, exerciseSheet, session, slide, slideDeck } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { afterCursor, cursorTs, decodeCursor, keysetOrder, toPage } from '../lib/pagination.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import { enqueueJob } from './jobs.ts';

/** Eine fertig gespeicherte Upload-Datei (temporär, im Datenordner, damit `rename` atomar ist) */
export interface StoredUpload {
  tmpPath: string;
  size: number;
  sha256: string;
  filename: string;
}

export interface DeckUploadInput {
  moduleId: string;
  sessionId?: string | undefined;
  title?: string | undefined;
}

export interface SheetUploadInput {
  moduleId: string;
  title?: string | undefined;
  number?: number | undefined;
  dueAt?: Date | undefined;
}

type DeckRow = typeof slideDeck.$inferSelect;
type SlideRow = typeof slide.$inferSelect;
type SheetRow = typeof exerciseSheet.$inferSelect;

const iso = (date: Date): string => date.toISOString();

export function toApiDeck(row: DeckRow): SlideDeck {
  return {
    id: row.id,
    user_id: row.userId,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    deleted_at: row.deletedAt ? iso(row.deletedAt) : null,
    module_id: row.moduleId,
    session_id: row.sessionId,
    title: row.title,
    sha256: row.sha256,
    page_count: row.pageCount,
    uploaded_at: iso(row.uploadedAt),
    ingest_state: row.ingestState as SlideDeck['ingest_state'],
  };
}

export function toApiSlide(row: SlideRow): Slide {
  return {
    id: row.id,
    user_id: row.userId,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    deleted_at: row.deletedAt ? iso(row.deletedAt) : null,
    deck_id: row.deckId,
    index: row.index,
    width_pt: row.widthPt,
    height_pt: row.heightPt,
    text: row.text,
    text_blocks: row.textBlocks as Slide['text_blocks'],
    vision_summary: row.visionSummary,
    title: row.title,
    chapter: row.chapter,
  };
}

export function toApiSheet(row: SheetRow): ExerciseSheet {
  return {
    id: row.id,
    user_id: row.userId,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    deleted_at: row.deletedAt ? iso(row.deletedAt) : null,
    module_id: row.moduleId,
    title: row.title,
    number: row.number,
    sha256: row.sha256,
    page_count: row.pageCount,
    due_at: row.dueAt ? iso(row.dueAt) : null,
    has_solution: row.solutionFilePath !== null,
    ingest_state: row.ingestState as ExerciseSheet['ingest_state'],
  };
}

/** Titel aus dem Dateinamen: ohne Endung `.pdf`, ohne Steuerzeichen, höchstens 300 Zeichen */
export function titleFromFilename(filename: string): string {
  const cleaned = [...filename]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .replace(/\.pdf$/i, '')
    .trim();
  return (cleaned || 'Unbenannt').slice(0, 300);
}

/** Pfad im Datenordner. Der Pfad kommt aus der DB oder aus IDs, nie aus Nutzereingaben. */
export function resolveDataPath(dataDir: string, relative: string): string | null {
  const root = resolve(dataDir);
  const full = resolve(root, relative);
  return full.startsWith(root + sep) ? full : null;
}

export function uploadTmpDir(dataDir: string): string {
  return join(dataDir, 'media', '.tmp');
}

async function requireModule(db: Db, moduleId: string): Promise<void> {
  const [row] = await db
    .select({ id: courseModule.id })
    .from(courseModule)
    .where(and(eq(courseModule.id, moduleId), notDeleted(courseModule)));
  if (!row) throw new HttpError(404, 'module_not_found', 'Das Modul wurde nicht gefunden.');
}

async function requireSession(db: Db, sessionId: string, moduleId: string): Promise<void> {
  const [row] = await db
    .select({ id: session.id, moduleId: session.moduleId })
    .from(session)
    .where(and(eq(session.id, sessionId), notDeleted(session)));
  if (!row) throw new HttpError(404, 'session_not_found', 'Die Session wurde nicht gefunden.');
  if (row.moduleId !== moduleId) {
    throw new HttpError(400, 'session_module_mismatch', 'Die Session gehört zu einem anderen Modul.');
  }
}

interface PlaceOptions {
  dataDir: string;
  /** `decks` oder `sheets` */
  kind: 'decks' | 'sheets';
  id: string;
  upload: StoredUpload;
}

/** Verschiebt die temporäre Datei atomar nach `media/<kind>/<id>/original.pdf`. Gibt den relativen Pfad zurück. */
async function placeOriginal({ dataDir, kind, id, upload }: PlaceOptions): Promise<string> {
  const relative = `media/${kind}/${id}/original.pdf`;
  const target = join(dataDir, relative);
  await mkdir(dirname(target), { recursive: true });
  await rename(upload.tmpPath, target);
  return relative;
}

/**
 * Legt Foliensatz (oder Blatt) samt Job an. Ablauf in EINER Transaktion:
 * Advisory-Lock auf (Modul, sha256) → Dublettenprüfung → Zeile anlegen → Datei an Ort und Stelle
 * rücken → Job anlegen. Schlägt etwas fehl, rollt die Transaktion zurück und der Ordner wird entfernt.
 * Die Datei liegt beim Commit schon da, bevor der Worker per NOTIFY geweckt wird.
 */
async function createMaterial(
  db: Db,
  dataDir: string,
  kind: 'deck' | 'sheet',
  moduleId: string,
  upload: StoredUpload,
  insert: (tx: Tx, id: string, filePath: string) => Promise<void>,
  existing: (tx: Tx) => Promise<string | undefined>,
  jobPayload: (id: string) => Record<string, unknown>,
  sessionId?: string,
): Promise<UploadResult> {
  const folder = kind === 'deck' ? 'decks' : 'sheets';
  const id = uuidv7();
  let placed = false;
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${kind}:${moduleId}:${upload.sha256}`}, 0))`,
      );
      const duplicate = await existing(tx);
      if (duplicate) return { id: duplicate, duplicate: true };

      const filePath = `media/${folder}/${id}/original.pdf`;
      await insert(tx, id, filePath);
      await placeOriginal({ dataDir, kind: folder, id, upload });
      placed = true;
      await enqueueJob(tx, {
        type: 'pdf.ingest',
        payload: jobPayload(id),
        ...(sessionId ? { sessionId } : {}),
      });
      return { id, duplicate: false };
    });
  } catch (error) {
    if (placed)
      await rm(join(dataDir, 'media', folder, id), { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function createSlideDeck(
  db: Db,
  dataDir: string,
  upload: StoredUpload,
  input: DeckUploadInput,
): Promise<UploadResult> {
  await requireModule(db, input.moduleId);
  if (input.sessionId) await requireSession(db, input.sessionId, input.moduleId);
  return createMaterial(
    db,
    dataDir,
    'deck',
    input.moduleId,
    upload,
    async (tx, id, filePath) => {
      await tx.insert(slideDeck).values({
        id,
        userId: SINGLE_USER_ID,
        moduleId: input.moduleId,
        sessionId: input.sessionId ?? null,
        title: input.title ?? titleFromFilename(upload.filename),
        filePath,
        sha256: upload.sha256,
      });
    },
    async (tx) => {
      const [row] = await tx
        .select({ id: slideDeck.id })
        .from(slideDeck)
        .where(
          and(
            eq(slideDeck.moduleId, input.moduleId),
            eq(slideDeck.sha256, upload.sha256),
            notDeleted(slideDeck),
          ),
        )
        .limit(1);
      return row?.id;
    },
    (id) => ({ slide_deck_id: id }),
    input.sessionId,
  );
}

export async function createExerciseSheet(
  db: Db,
  dataDir: string,
  upload: StoredUpload,
  input: SheetUploadInput,
): Promise<UploadResult> {
  await requireModule(db, input.moduleId);
  return createMaterial(
    db,
    dataDir,
    'sheet',
    input.moduleId,
    upload,
    async (tx, id, filePath) => {
      await tx.insert(exerciseSheet).values({
        id,
        userId: SINGLE_USER_ID,
        moduleId: input.moduleId,
        title: input.title ?? titleFromFilename(upload.filename),
        number: input.number ?? null,
        dueAt: input.dueAt ?? null,
        filePath,
        sha256: upload.sha256,
      });
    },
    async (tx) => {
      const [row] = await tx
        .select({ id: exerciseSheet.id })
        .from(exerciseSheet)
        .where(
          and(
            eq(exerciseSheet.moduleId, input.moduleId),
            eq(exerciseSheet.sha256, upload.sha256),
            notDeleted(exerciseSheet),
          ),
        )
        .limit(1);
      return row?.id;
    },
    (id) => ({ exercise_sheet_id: id }),
  );
}

// ---------- Foliensätze ----------

export interface ListOptions {
  moduleId?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

export async function listSlideDecks(db: Db, options: ListOptions): Promise<SlideDeckList> {
  const conditions: (SQL | undefined)[] = [
    notDeleted(slideDeck),
    options.moduleId ? eq(slideDeck.moduleId, options.moduleId) : undefined,
    afterCursor(
      slideDeck.createdAt,
      slideDeck.id,
      options.cursor ? decodeCursor(options.cursor) : undefined,
      'desc',
    ),
  ];
  const rows = await db
    .select({ row: slideDeck, ts: cursorTs(slideDeck.createdAt) })
    .from(slideDeck)
    .where(and(...conditions))
    .orderBy(...keysetOrder(slideDeck.createdAt, slideDeck.id, 'desc'))
    .limit(options.limit + 1);
  return toPage(
    rows,
    options.limit,
    (r) => ({ ts: r.ts, id: r.row.id }),
    (r) => toApiDeck(r.row),
  );
}

export async function getDeckRow(db: Db, id: string): Promise<DeckRow> {
  const [row] = await db
    .select()
    .from(slideDeck)
    .where(and(eq(slideDeck.id, id), notDeleted(slideDeck)));
  if (!row) throw new HttpError(404, 'slide_deck_not_found', 'Der Foliensatz wurde nicht gefunden.');
  return row;
}

export async function getSlideDeckDetail(db: Db, id: string): Promise<SlideDeckDetail> {
  const deck = await getDeckRow(db, id);
  const slides = await db
    .select()
    .from(slide)
    .where(and(eq(slide.deckId, id), notDeleted(slide)))
    .orderBy(asc(slide.index));
  return { deck: toApiDeck(deck), slides: slides.map(toApiSlide) };
}

export async function renameSlideDeck(db: Db, id: string, title: string): Promise<SlideDeck> {
  const [row] = await db
    .update(slideDeck)
    .set({ title, updatedAt: sql`now()` })
    .where(and(eq(slideDeck.id, id), notDeleted(slideDeck)))
    .returning();
  if (!row) throw new HttpError(404, 'slide_deck_not_found', 'Der Foliensatz wurde nicht gefunden.');
  return toApiDeck(row);
}

/** Soft-Delete (03 §1). Folien bleiben erhalten, sie sind nur über den Foliensatz erreichbar. */
export async function deleteSlideDeck(db: Db, id: string): Promise<void> {
  const rows = await db
    .update(slideDeck)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(slideDeck.id, id), notDeleted(slideDeck)))
    .returning({ id: slideDeck.id });
  if (rows.length === 0)
    throw new HttpError(404, 'slide_deck_not_found', 'Der Foliensatz wurde nicht gefunden.');
}

export async function getSlideWithDeck(db: Db, slideId: string): Promise<{ slide: SlideRow; deck: DeckRow }> {
  const [row] = await db
    .select({ slide, deck: slideDeck })
    .from(slide)
    .innerJoin(slideDeck, eq(slide.deckId, slideDeck.id))
    .where(and(eq(slide.id, slideId), notDeleted(slide), notDeleted(slideDeck)));
  if (!row) throw new HttpError(404, 'slide_not_found', 'Die Folie wurde nicht gefunden.');
  return row;
}

// ---------- Übungsblätter ----------

export async function listExerciseSheets(db: Db, options: ListOptions): Promise<ExerciseSheetList> {
  const conditions: (SQL | undefined)[] = [
    notDeleted(exerciseSheet),
    options.moduleId ? eq(exerciseSheet.moduleId, options.moduleId) : undefined,
    afterCursor(
      exerciseSheet.createdAt,
      exerciseSheet.id,
      options.cursor ? decodeCursor(options.cursor) : undefined,
      'desc',
    ),
  ];
  const rows = await db
    .select({ row: exerciseSheet, ts: cursorTs(exerciseSheet.createdAt) })
    .from(exerciseSheet)
    .where(and(...conditions))
    .orderBy(...keysetOrder(exerciseSheet.createdAt, exerciseSheet.id, 'desc'))
    .limit(options.limit + 1);
  return toPage(
    rows,
    options.limit,
    (r) => ({ ts: r.ts, id: r.row.id }),
    (r) => toApiSheet(r.row),
  );
}

export async function getSheetRow(db: Db, id: string): Promise<SheetRow> {
  const [row] = await db
    .select()
    .from(exerciseSheet)
    .where(and(eq(exerciseSheet.id, id), notDeleted(exerciseSheet)));
  if (!row) throw new HttpError(404, 'exercise_sheet_not_found', 'Das Übungsblatt wurde nicht gefunden.');
  return row;
}

export async function updateExerciseSheet(
  db: Db,
  id: string,
  update: ExerciseSheetUpdate,
): Promise<ExerciseSheet> {
  const set: Partial<typeof exerciseSheet.$inferInsert> = {};
  if (update.title !== undefined) set.title = update.title;
  if (update.number !== undefined) set.number = update.number;
  if (update.due_at !== undefined) set.dueAt = update.due_at === null ? null : new Date(update.due_at);
  if (Object.keys(set).length === 0) return toApiSheet(await getSheetRow(db, id));
  const [row] = await db
    .update(exerciseSheet)
    .set({ ...set, updatedAt: sql`now()` })
    .where(and(eq(exerciseSheet.id, id), notDeleted(exerciseSheet)))
    .returning();
  if (!row) throw new HttpError(404, 'exercise_sheet_not_found', 'Das Übungsblatt wurde nicht gefunden.');
  return toApiSheet(row);
}

export async function deleteExerciseSheet(db: Db, id: string): Promise<void> {
  const rows = await db
    .update(exerciseSheet)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(exerciseSheet.id, id), notDeleted(exerciseSheet)))
    .returning({ id: exerciseSheet.id });
  if (rows.length === 0) {
    throw new HttpError(404, 'exercise_sheet_not_found', 'Das Übungsblatt wurde nicht gefunden.');
  }
}
