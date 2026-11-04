// Semester und Module (F-ORG-01, 08 §1, 03 §3)
import { and, count, eq, isNotNull, isNull, ne, sql, type SQL } from 'drizzle-orm';
import {
  SINGLE_USER_ID,
  type Module,
  type ModuleColor,
  type ModuleCreate,
  type ModuleSettings,
  type ModuleSettingsUpdate,
  type ModuleUpdate,
  type Semester,
  type SemesterCreate,
  type SemesterUpdate,
} from '@sg/shared';
import type { Db, DbOrTx, Tx } from '../db/client.ts';
import { courseModule, semester } from '../db/schema/index.ts';
import { notDeleted } from '../db/schema/common.ts';
import { HttpError } from '../errors.ts';
import { afterCursor, cursorTs, decodeCursor, keysetOrder, toPage, type Page } from '../lib/pagination.ts';
import { uuidv7 } from '../lib/uuid7.ts';

/** Feste Palette (07 §8), Reihenfolge der automatischen Farbvergabe */
export const MODULE_COLORS: readonly ModuleColor[] = [
  'mod-01',
  'mod-02',
  'mod-03',
  'mod-04',
  'mod-05',
  'mod-06',
  'mod-07',
  'mod-08',
  'mod-09',
  'mod-10',
  'mod-11',
  'mod-12',
];

type SemesterRow = typeof semester.$inferSelect;
type ModuleRow = typeof courseModule.$inferSelect;

export function toApiSemester(row: SemesterRow): Semester {
  return {
    id: row.id,
    user_id: row.userId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
    name: row.name,
    starts_on: row.startsOn,
    ends_on: row.endsOn,
    is_current: row.isCurrent,
    archived_at: row.archivedAt?.toISOString() ?? null,
  };
}

export function toApiModule(row: ModuleRow): Module {
  return {
    id: row.id,
    user_id: row.userId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
    semester_id: row.semesterId,
    name: row.name,
    short_name: row.shortName,
    color: row.color as ModuleColor,
    ects: row.ects,
    exam_type: row.examType,
    lecturer: row.lecturer,
    lang: row.lang as Module['lang'],
    description_md: row.descriptionMd,
    settings: row.settings,
  };
}

/**
 * `module.settings` Schlüssel für Schlüssel zusammenführen, `null` entfernt einen Schlüssel (VERTRAEGE §14.2).
 * Läuft in SQL auf dem aktuellen Wert, damit sich Web-App (`layout`, `column_widths`) und iPad (`ink_mode`)
 * bei gleichzeitigen Änderungen nicht gegenseitig überschreiben.
 */
function mergeModuleSettings(update: ModuleSettingsUpdate): SQL {
  if (update.column_widths) {
    // Das Schema prüft drei Werte zwischen 0 und 100, die Summe prüft der Core (ColumnWidths, F-DSH-01)
    const sum = update.column_widths.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 0.01) {
      throw new HttpError(400, 'validation_failed', 'Die Spaltenbreiten müssen zusammen 100 % ergeben.', {
        field: 'settings.column_widths',
        sum,
      });
    }
  }
  const set: ModuleSettings = {};
  const remove: string[] = [];
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    if (value === null) remove.push(key);
    else (set as Record<string, unknown>)[key] = value;
  }
  let merged = sql`(${courseModule.settings} || ${JSON.stringify(set)}::jsonb)`;
  for (const key of remove) merged = sql`(${merged} - ${key}::text)`;
  return merged;
}

const semesterNotFound = () => new HttpError(404, 'semester_not_found', 'Dieses Semester gibt es nicht.');
const moduleNotFound = () => new HttpError(404, 'module_not_found', 'Dieses Modul gibt es nicht.');
const idTaken = (what: string) => new HttpError(409, 'conflict', `${what} mit dieser ID gibt es schon.`);

/** Verletzung des Primärschlüssels dieser Tabelle (auch wenn Drizzle den Fehler verpackt). Andere Unique-Verstöße bleiben Fehler. */
function isPrimaryKeyViolation(error: unknown, table: string): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 3; depth += 1) {
    const info = e as { code?: unknown; constraint_name?: unknown };
    if (info.code === '23505' && info.constraint_name === `${table}_pkey`) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Serialisiert alle Änderungen an Semestern (`is_current`): letzter Schreiber gewinnt, kein Unique-Fehler.
 * Die Sperre gilt bis zum Ende der Transaktion.
 */
const SEMESTER_LOCK_KEY = 70070001;
async function lockSemesters(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${SEMESTER_LOCK_KEY})`);
}

const now = () => sql`now()` as unknown as Date;

// ---------------------------------------------------------------------------------------------
// Semester
// ---------------------------------------------------------------------------------------------

export interface ListSemestersOptions {
  archived?: boolean | undefined;
  cursor?: string | undefined;
  limit: number;
}

/** Semester, neueste zuerst. Archivierte sind vollständig lesbar (F-ORG-01); `archived` filtert nur. */
export async function listSemesters(db: DbOrTx, options: ListSemestersOptions): Promise<Page<Semester>> {
  const conditions: (SQL | undefined)[] = [
    notDeleted(semester),
    options.archived === undefined
      ? undefined
      : options.archived
        ? isNotNull(semester.archivedAt)
        : isNull(semester.archivedAt),
    afterCursor(
      semester.createdAt,
      semester.id,
      options.cursor ? decodeCursor(options.cursor) : undefined,
      'desc',
    ),
  ];
  const rows = await db
    .select({ row: semester, ts: cursorTs(semester.createdAt) })
    .from(semester)
    .where(and(...conditions))
    .orderBy(...keysetOrder(semester.createdAt, semester.id, 'desc'))
    .limit(options.limit + 1);
  return toPage(
    rows,
    options.limit,
    (r) => ({ ts: r.ts, id: r.row.id }),
    (r) => toApiSemester(r.row),
  );
}

async function findSemester(db: DbOrTx, id: string): Promise<SemesterRow> {
  const [row] = await db
    .select()
    .from(semester)
    .where(and(eq(semester.id, id), notDeleted(semester)));
  if (!row) throw semesterNotFound();
  return row;
}

export async function getSemester(db: DbOrTx, id: string): Promise<Semester> {
  return toApiSemester(await findSemester(db, id));
}

/** Alle anderen Semester auf „nicht aktuell“, damit höchstens eines aktuell ist */
async function clearCurrentExcept(tx: Tx, id: string): Promise<void> {
  await tx
    .update(semester)
    .set({ isCurrent: false, updatedAt: now() })
    .where(and(eq(semester.isCurrent, true), ne(semester.id, id), notDeleted(semester)));
}

export async function createSemester(db: Db, input: SemesterCreate): Promise<Semester> {
  try {
    return await db.transaction(async (tx) => {
      await lockSemesters(tx);
      const id = input.id ?? uuidv7();
      if (input.id) {
        const [existing] = await tx.select({ id: semester.id }).from(semester).where(eq(semester.id, id));
        if (existing) throw idTaken('Ein Semester');
      }
      // Das erste Semester wird automatisch aktuell (sofern der Client nichts anderes sagt)
      let isCurrent = input.is_current;
      if (isCurrent === undefined) {
        const [counted] = await tx.select({ n: count() }).from(semester).where(notDeleted(semester));
        isCurrent = (counted?.n ?? 0) === 0;
      }
      if (isCurrent) await clearCurrentExcept(tx, id);
      const [row] = await tx
        .insert(semester)
        .values({
          id,
          userId: SINGLE_USER_ID,
          name: input.name,
          startsOn: input.starts_on ?? null,
          endsOn: input.ends_on ?? null,
          isCurrent,
        })
        .returning();
      return toApiSemester(row as SemesterRow);
    });
  } catch (error) {
    if (isPrimaryKeyViolation(error, 'semester')) throw idTaken('Ein Semester');
    throw error;
  }
}

export async function updateSemester(db: Db, id: string, input: SemesterUpdate): Promise<Semester> {
  return db.transaction(async (tx) => {
    await lockSemesters(tx);
    const current = await findSemester(tx, id);
    const patch: Partial<typeof semester.$inferInsert> = { updatedAt: now() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.starts_on !== undefined) patch.startsOn = input.starts_on;
    if (input.ends_on !== undefined) patch.endsOn = input.ends_on;

    let archived = current.archivedAt !== null;
    if (input.archived !== undefined) {
      archived = input.archived;
      // Schon archiviert: der ursprüngliche Zeitpunkt bleibt
      patch.archivedAt = input.archived ? (current.archivedAt ?? new Date()) : null;
    }

    let isCurrent = current.isCurrent;
    if (input.is_current !== undefined) isCurrent = input.is_current;
    else if (input.archived === true) isCurrent = false; // ein ausgeblendetes Semester ist nicht „aktuell“
    if (isCurrent && archived) {
      throw new HttpError(
        409,
        'semester_archived',
        'Ein archiviertes Semester kann nicht aktuell sein. Stelle es erst wieder her.',
      );
    }
    patch.isCurrent = isCurrent;

    if (isCurrent) await clearCurrentExcept(tx, id);
    const [row] = await tx.update(semester).set(patch).where(eq(semester.id, id)).returning();
    return toApiSemester(row as SemesterRow);
  });
}

// ---------------------------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------------------------

export interface ListModulesOptions {
  semesterId?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

/** Module in Anlegereihenfolge (stabil für die Seitenleiste) */
export async function listModules(db: DbOrTx, options: ListModulesOptions): Promise<Page<Module>> {
  const conditions: (SQL | undefined)[] = [
    notDeleted(courseModule),
    options.semesterId ? eq(courseModule.semesterId, options.semesterId) : undefined,
    afterCursor(
      courseModule.createdAt,
      courseModule.id,
      options.cursor ? decodeCursor(options.cursor) : undefined,
      'asc',
    ),
  ];
  const rows = await db
    .select({ row: courseModule, ts: cursorTs(courseModule.createdAt) })
    .from(courseModule)
    .where(and(...conditions))
    .orderBy(...keysetOrder(courseModule.createdAt, courseModule.id, 'asc'))
    .limit(options.limit + 1);
  return toPage(
    rows,
    options.limit,
    (r) => ({ ts: r.ts, id: r.row.id }),
    (r) => toApiModule(r.row),
  );
}

async function findModule(db: DbOrTx, id: string): Promise<ModuleRow> {
  const [row] = await db
    .select()
    .from(courseModule)
    .where(and(eq(courseModule.id, id), notDeleted(courseModule)));
  if (!row) throw moduleNotFound();
  return row;
}

export async function getModule(db: DbOrTx, id: string): Promise<Module> {
  return toApiModule(await findModule(db, id));
}

/**
 * Nächste freie Palettenfarbe im Semester: die am seltensten genutzte, bei Gleichstand die erste.
 * Solange weniger als 12 Module existieren, ist das die erste unbenutzte Farbe, danach läuft es zyklisch.
 */
export async function nextModuleColor(db: DbOrTx, semesterId: string): Promise<ModuleColor> {
  const rows = await db
    .select({ color: courseModule.color })
    .from(courseModule)
    .where(and(eq(courseModule.semesterId, semesterId), notDeleted(courseModule)));
  const used = new Map<string, number>();
  for (const r of rows) used.set(r.color, (used.get(r.color) ?? 0) + 1);
  let best: ModuleColor = MODULE_COLORS[0] as ModuleColor;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const color of MODULE_COLORS) {
    const n = used.get(color) ?? 0;
    if (n < bestCount) {
      best = color;
      bestCount = n;
    }
  }
  return best;
}

export async function createModule(db: Db, input: ModuleCreate): Promise<Module> {
  try {
    return await db.transaction(async (tx) => {
      await findSemester(tx, input.semester_id);
      const id = input.id ?? uuidv7();
      if (input.id) {
        const [existing] = await tx
          .select({ id: courseModule.id })
          .from(courseModule)
          .where(eq(courseModule.id, id));
        if (existing) throw idTaken('Ein Modul');
      }
      const color = input.color ?? (await nextModuleColor(tx, input.semester_id));
      const [row] = await tx
        .insert(courseModule)
        .values({
          id,
          userId: SINGLE_USER_ID,
          semesterId: input.semester_id,
          name: input.name,
          shortName: input.short_name ?? null,
          color,
          ects: input.ects ?? null,
          examType: input.exam_type ?? null,
          lecturer: input.lecturer ?? null,
          lang: input.lang ?? null,
          descriptionMd: input.description_md ?? null,
        })
        .returning();
      return toApiModule(row as ModuleRow);
    });
  } catch (error) {
    if (isPrimaryKeyViolation(error, 'module')) throw idTaken('Ein Modul');
    throw error;
  }
}

export async function updateModule(db: Db, id: string, input: ModuleUpdate): Promise<Module> {
  return db.transaction(async (tx) => {
    await findModule(tx, id);
    if (input.semester_id !== undefined) await findSemester(tx, input.semester_id);
    const patch: Partial<typeof courseModule.$inferInsert> = { updatedAt: now() };
    if (input.semester_id !== undefined) patch.semesterId = input.semester_id;
    if (input.name !== undefined) patch.name = input.name;
    if (input.short_name !== undefined) patch.shortName = input.short_name;
    if (input.color !== undefined) patch.color = input.color;
    if (input.ects !== undefined) patch.ects = input.ects;
    if (input.exam_type !== undefined) patch.examType = input.exam_type;
    if (input.lecturer !== undefined) patch.lecturer = input.lecturer;
    if (input.lang !== undefined) patch.lang = input.lang;
    if (input.description_md !== undefined) patch.descriptionMd = input.description_md;
    if (input.settings !== undefined)
      patch.settings = mergeModuleSettings(input.settings) as unknown as ModuleSettings;
    const [row] = await tx.update(courseModule).set(patch).where(eq(courseModule.id, id)).returning();
    return toApiModule(row as ModuleRow);
  });
}

/** Soft-Delete (03 §1): setzt `deleted_at`, Inhalte bleiben für den Papierkorb (F-DAT-04) erhalten */
export async function deleteModule(db: Db, id: string): Promise<void> {
  const rows = await db
    .update(courseModule)
    .set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(courseModule.id, id), notDeleted(courseModule)))
    .returning({ id: courseModule.id });
  if (rows.length === 0) throw moduleNotFound();
}
