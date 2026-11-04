// Notizbücher (VERTRAEGE §7.4, §11.3, F-INK-02): Standard-Notizbücher, REST-Logik, Server-Operationen.
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  SINGLE_USER_ID,
  type Notebook,
  type NotebookCreate,
  type NotebookKind,
  type NotebookList,
  type NotebookUpdate,
} from '@sg/shared';
import type { Db, DbOrTx, Tx } from '../db/client.ts';
import { courseModule, notebook, syncStream } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { afterCursor, cursorTs, decodeCursor, keysetOrder, toPage } from '../lib/pagination.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import { appendOp } from '../sync/append.ts';
import { softDelete } from './trash.ts';

type NotebookRow = typeof notebook.$inferSelect;

/** Standard-Notizbücher je Modul in fester Reihenfolge (VERTRAEGE §7.4) */
export const DEFAULT_NOTEBOOKS: readonly { kind: 'vorlesung' | 'uebung'; title: string }[] = [
  { kind: 'vorlesung', title: 'Vorlesung' },
  { kind: 'uebung', title: 'Übung' },
];

/** Strom eines Notizbuchs (08 §2.2) */
export const notebookStream = (notebookId: string) => `notebook:${notebookId}`;

const notebookNotFound = () => new HttpError(404, 'notebook_not_found', 'Dieses Notizbuch gibt es nicht.');
const moduleNotFound = () => new HttpError(404, 'module_not_found', 'Dieses Modul gibt es nicht.');
const notebookExists = () =>
  new HttpError(409, 'notebook_exists', 'Ein Notizbuch mit dieser ID gibt es schon.');
const kindExists = () =>
  new HttpError(
    409,
    'notebook_kind_exists',
    'Dieses Modul hat schon ein Notizbuch dieser Art („Vorlesung“ bzw. „Übung“).',
  );
const badTitle = () =>
  new HttpError(400, 'validation_failed', 'Der Titel darf nicht leer sein.', {
    in: 'body',
    issues: [{ path: 'title', message: 'darf nicht leer sein' }],
  });

/** Das Modul des Notizbuchs ist nicht gelöscht (bis `deleteModule` über `softDelete` kaskadiert, T1-18) */
export const moduleIsActive = sql`EXISTS (SELECT 1 FROM module WHERE module.id = notebook.module_id AND module.deleted_at IS NULL)`;

function toApiNotebook(row: NotebookRow, pageCount: number): Notebook {
  return {
    id: row.id,
    user_id: row.userId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
    module_id: row.moduleId,
    title: row.title,
    kind: row.kind as NotebookKind,
    page_count: pageCount,
  };
}

/** Anzahl nicht gelöschter Seiten je Notizbuch (abgeleitetes Feld `page_count`) */
const pageCountOf = sql<number>`(SELECT count(*)::int FROM page WHERE page.notebook_id = notebook.id AND page.deleted_at IS NULL)`;

async function activeModuleExists(tx: DbOrTx, moduleId: string): Promise<boolean> {
  const [mod] = await tx
    .select({ id: courseModule.id })
    .from(courseModule)
    .where(and(eq(courseModule.id, moduleId), isNull(courseModule.deletedAt)))
    // Lesesperre: ein laufendes Löschen des Moduls wird abgewartet
    .for('share');
  return mod !== undefined;
}

/**
 * Legt die Notizbücher „Vorlesung“ und „Übung“ des Moduls an, falls sie fehlen. Idempotent und gegen
 * gleichzeitige Aufrufe sicher (`notebook_default_uq`). Gelöschte Module bekommen keine neuen.
 */
export async function ensureDefaultNotebooks(tx: DbOrTx, moduleId: string): Promise<void> {
  if (!(await activeModuleExists(tx, moduleId))) return;
  for (const def of DEFAULT_NOTEBOOKS) {
    await tx
      .insert(notebook)
      .values({ id: uuidv7(), userId: SINGLE_USER_ID, moduleId, title: def.title, kind: def.kind })
      .onConflictDoNothing();
  }
}

async function getNotebookRow(tx: DbOrTx, id: string): Promise<Notebook> {
  const [found] = await tx
    .select({ row: notebook, pageCount: pageCountOf })
    .from(notebook)
    .where(and(eq(notebook.id, id), isNull(notebook.deletedAt), moduleIsActive));
  if (!found) throw notebookNotFound();
  return toApiNotebook(found.row, found.pageCount);
}

export const getNotebook = getNotebookRow;

/**
 * Notizbücher auflisten, nach Anlage sortiert („Vorlesung“, „Übung“, dann eigene). Mit `moduleId` werden
 * fehlende Standard-Notizbücher älterer Module nachgetragen (VERTRAEGE §7.4).
 */
export async function listNotebooks(
  db: Db,
  params: { moduleId?: string | undefined; cursor?: string | undefined; limit: number },
): Promise<NotebookList> {
  const cursor = params.cursor ? decodeCursor(params.cursor) : undefined;
  if (params.moduleId) {
    const moduleId = params.moduleId;
    await db.transaction((tx) => ensureDefaultNotebooks(tx, moduleId));
  }
  const rows = await db
    .select({ row: notebook, pageCount: pageCountOf, ts: cursorTs(notebook.createdAt) })
    .from(notebook)
    .where(
      and(
        isNull(notebook.deletedAt),
        moduleIsActive,
        params.moduleId ? eq(notebook.moduleId, params.moduleId) : undefined,
        afterCursor(notebook.createdAt, notebook.id, cursor, 'asc'),
      ),
    )
    .orderBy(...keysetOrder(notebook.createdAt, notebook.id, 'asc'))
    .limit(params.limit + 1);
  return toPage(
    rows,
    params.limit,
    (r) => ({ ts: r.ts, id: r.row.id }),
    (r) => toApiNotebook(r.row, r.pageCount),
  );
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 3; depth += 1) {
    const info = e as { code?: unknown; constraint_name?: unknown };
    if (info.code === '23505' && info.constraint_name === constraint) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** `POST /notebooks`. `kind` fehlt = frei. Zweites `vorlesung`/`uebung` im Modul: 409 `notebook_kind_exists` */
export async function createNotebook(db: Db, input: NotebookCreate): Promise<Notebook> {
  const kind: NotebookKind = input.kind ?? 'frei';
  const title = input.title.trim();
  if (title === '') throw badTitle();
  try {
    return await db.transaction(async (tx) => {
      if (!(await activeModuleExists(tx, input.module_id))) throw moduleNotFound();
      const id = input.id ?? uuidv7();
      const [taken] = await tx.select({ id: notebook.id }).from(notebook).where(eq(notebook.id, id));
      if (taken) throw notebookExists();
      if (kind !== 'frei') {
        const [dup] = await tx
          .select({ id: notebook.id })
          .from(notebook)
          .where(
            and(eq(notebook.moduleId, input.module_id), eq(notebook.kind, kind), isNull(notebook.deletedAt)),
          );
        if (dup) throw kindExists();
      }
      const [row] = await tx
        .insert(notebook)
        .values({ id, userId: SINGLE_USER_ID, moduleId: input.module_id, title, kind })
        .returning();
      return toApiNotebook(row as NotebookRow, 0);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'notebook_default_uq')) throw kindExists();
    if (isUniqueViolation(error, 'notebook_pkey')) throw notebookExists();
    throw error;
  }
}

/**
 * Sperrt den Strom des Notizbuchs (wie `appendOp`), bevor Zeilen des Notizbuchs gesperrt werden.
 * Der Dispatcher geht in der Reihenfolge Strom → Handler (VERTRAEGE §16.2). Würde REST zuerst das Notizbuch
 * sperren und dann den Strom, könnten beide sich gegenseitig blockieren (Deadlock).
 */
async function lockNotebookStream(tx: Tx, notebookId: string): Promise<void> {
  const stream = notebookStream(notebookId);
  await tx.insert(syncStream).values({ stream, headSeq: 0 }).onConflictDoNothing();
  await tx
    .select({ s: syncStream.stream })
    .from(syncStream)
    .where(eq(syncStream.stream, stream))
    .for('update');
}

/** Server-Operation (`origin = server`) in den Strom des Notizbuchs schreiben */
async function appendServerOp(
  tx: Tx,
  notebookId: string,
  kind: 'notebook.update' | 'notebook.delete',
  data: unknown,
): Promise<void> {
  await appendOp(tx, notebookStream(notebookId), {
    kind,
    data,
    at: Date.now(),
    clockUncertain: false,
    origin: 'server',
  });
}

/**
 * `PATCH /notebooks/{id}`: umbenennen und verschieben. Schreibt `notebook.update` mit dem vollständigen Stand,
 * aber nur bei einer Änderung. Die Standard-Notizbücher bleiben in ihrem Modul (409 `notebook_default`),
 * sonst bräche „genau eines je Modul“ (`notebook_default_uq`).
 */
export async function updateNotebook(db: Db, id: string, input: NotebookUpdate): Promise<Notebook> {
  return db.transaction(async (tx) => {
    await lockNotebookStream(tx, id);
    const [row] = await tx
      .select()
      .from(notebook)
      .where(and(eq(notebook.id, id), isNull(notebook.deletedAt)))
      .for('update');
    if (!row) throw notebookNotFound();
    const title = input.title?.trim();
    if (title !== undefined && title === '') throw badTitle();
    const targetModule =
      input.module_id !== undefined && input.module_id !== row.moduleId ? input.module_id : null;
    if (targetModule !== null) {
      if (row.kind !== 'frei') {
        throw new HttpError(
          409,
          'notebook_default',
          'Die Notizbücher „Vorlesung“ und „Übung“ bleiben in ihrem Modul.',
        );
      }
      if (!(await activeModuleExists(tx, targetModule))) throw moduleNotFound();
    }
    const renamed = title !== undefined && title !== row.title;
    if (!renamed && targetModule === null) return getNotebookRow(tx, id);

    await tx
      .update(notebook)
      .set({
        ...(renamed ? { title } : {}),
        ...(targetModule !== null ? { moduleId: targetModule } : {}),
        updatedAt: new Date(),
      })
      .where(eq(notebook.id, id));
    const current = await getNotebookRow(tx, id);
    await appendServerOp(tx, id, 'notebook.update', {
      notebook_id: id,
      fields: { title: current.title, module_id: current.module_id },
    });
    return current;
  });
}

/** `DELETE /notebooks/{id}`: weich löschen mit Kaskade, dazu `notebook.delete` */
export async function deleteNotebook(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockNotebookStream(tx, id);
    await softDelete(tx, 'notebook', id);
    await appendServerOp(tx, id, 'notebook.delete', { notebook_id: id });
  });
}
