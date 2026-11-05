// Datenbank-Seite des Moodle-Abgleichs (08 §9.4, T1-23): Kurszuordnung, Dateien, Fristen.
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, type SQL } from 'drizzle-orm';
import {
  SINGLE_USER_ID,
  type MoodleCourse,
  type MoodleCourseLink,
  type MoodleItem,
  type MoodleItemKind,
  type MoodleSyncedDeadline,
} from '@sg/shared';
import type { Db, DbOrTx } from '../db/client.ts';
import { notDeleted } from '../db/schema/common.ts';
import { courseModule, moodleCourseLink, moodleDeadline, moodleItem, semester } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import { courseCategory, suggestModule } from './classify.ts';

type LinkRow = typeof moodleCourseLink.$inferSelect;
type ItemRow = typeof moodleItem.$inferSelect;
type DeadlineRow = typeof moodleDeadline.$inferSelect;

/** REST-Zeitformat (VERTRAEGE §6): Millisekunden nur, wenn sie nicht 0 sind */
export const iso = (date: Date): string => date.toISOString().replace(/\.000Z$/, 'Z');
const isoOrNull = (date: Date | null): string | null => (date ? iso(date) : null);

export function toApiLink(row: LinkRow): MoodleCourseLink {
  return {
    moodle_course_id: row.moodleCourseId,
    module_id: row.moduleId,
    sync_enabled: row.syncEnabled,
    last_synced_at: isoOrNull(row.lastSyncedAt),
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
  };
}

/** Nur PDFs werden übernommen (F-MDL-04). Erkannt an Typ oder Endung, beim Laden zusätzlich am Inhalt */
export function looksLikePdf(mimeType: string | null, filename: string): boolean {
  return mimeType?.toLowerCase() === 'application/pdf' || /\.pdf$/i.test(filename);
}

export function toApiItem(row: ItemRow, moduleId: string | null): MoodleItem {
  return {
    id: row.id,
    moodle_course_id: row.moodleCourseId,
    module_id: moduleId,
    cmid: row.cmid,
    activity_name: row.activityName,
    filename: row.filename,
    file_ref: row.fileRef,
    mime_type: row.mimeType,
    is_pdf: looksLikePdf(row.mimeType, row.filename),
    size_bytes: row.sizeBytes,
    modified_at: isoOrNull(row.timemodified),
    kind: row.kind as MoodleItemKind,
    kind_source: row.kindSource as MoodleItem['kind_source'],
    slide_deck_id: row.slideDeckId,
    exercise_sheet_id: row.exerciseSheetId,
    removed_in_moodle_at: isoOrNull(row.removedInMoodleAt),
    last_error: row.lastError as MoodleItem['last_error'],
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
  };
}

export function toApiDeadline(row: DeadlineRow): MoodleSyncedDeadline {
  return {
    id: row.id,
    source: row.source as MoodleSyncedDeadline['source'],
    moodle_course_id: row.moodleCourseId,
    module_id: row.moduleId,
    assignment_id: row.moodleAssignmentId,
    event_id: row.moodleEventId,
    cmid: row.cmid,
    name: row.name,
    due_at: iso(row.dueAt),
    url: row.url,
    exercise_sheet_id: row.exerciseSheetId,
    removed_in_moodle_at: isoOrNull(row.removedInMoodleAt),
  };
}

async function requireModule(db: DbOrTx, moduleId: string): Promise<void> {
  const [row] = await db
    .select({ id: courseModule.id })
    .from(courseModule)
    .where(and(eq(courseModule.id, moduleId), notDeleted(courseModule)));
  if (!row) throw new HttpError(404, 'module_not_found', 'Das Modul wurde nicht gefunden.');
}

// ---------- Kurszuordnung (F-MDL-03) ----------

/** Alle Zuordnungen, auch zu gelöschten Modulen nicht (die fallen weg, bis das Modul wiederhergestellt ist) */
export async function listLinks(db: DbOrTx): Promise<MoodleCourseLink[]> {
  const rows = await db
    .select({ link: moodleCourseLink })
    .from(moodleCourseLink)
    .innerJoin(courseModule, eq(courseModule.id, moodleCourseLink.moduleId))
    .where(notDeleted(courseModule))
    .orderBy(asc(moodleCourseLink.moodleCourseId));
  return rows.map((row) => toApiLink(row.link));
}

/** Zuordnungen, die abgeglichen werden: Abgleich an, Modul nicht gelöscht. Optional nur bestimmte Kurse */
export async function activeLinks(db: DbOrTx, courseIds: readonly number[] | null): Promise<LinkRow[]> {
  const rows = await db
    .select({ link: moodleCourseLink })
    .from(moodleCourseLink)
    .innerJoin(courseModule, eq(courseModule.id, moodleCourseLink.moduleId))
    .where(
      and(
        eq(moodleCourseLink.syncEnabled, true),
        notDeleted(courseModule),
        courseIds ? inArray(moodleCourseLink.moodleCourseId, [...courseIds]) : undefined,
      ),
    )
    .orderBy(asc(moodleCourseLink.moodleCourseId));
  return rows.map((row) => row.link);
}

/**
 * Zuordnung bestätigen oder ändern. Wechselt das Modul, ziehen die Fristen des Kurses mit. Schon übernommene
 * Foliensätze und Blätter bleiben im alten Modul (sie gehören dem Nutzer).
 */
export async function putLink(
  db: Db,
  courseId: number,
  input: { module_id: string; sync_enabled?: boolean | undefined },
): Promise<MoodleCourseLink> {
  return db.transaction(async (tx) => {
    await requireModule(tx, input.module_id);
    const [row] = await tx
      .insert(moodleCourseLink)
      .values({
        id: uuidv7(),
        userId: SINGLE_USER_ID,
        moduleId: input.module_id,
        moodleCourseId: courseId,
        syncEnabled: input.sync_enabled ?? true,
      })
      .onConflictDoUpdate({
        target: moodleCourseLink.moodleCourseId,
        set: {
          moduleId: input.module_id,
          ...(input.sync_enabled === undefined ? {} : { syncEnabled: input.sync_enabled }),
        },
      })
      .returning();
    if (!row) throw new Error('Zuordnung wurde nicht gespeichert');
    await tx
      .update(moodleDeadline)
      .set({ moduleId: input.module_id, exerciseSheetId: null })
      .where(and(eq(moodleDeadline.moodleCourseId, courseId), ne(moodleDeadline.moduleId, input.module_id)));
    return toApiLink(row);
  });
}

/** Zuordnung lösen. Die Fristen des Kurses fallen weg, Dateien und übernommenes Material bleiben */
export async function deleteLink(db: Db, courseId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(moodleCourseLink)
      .where(eq(moodleCourseLink.moodleCourseId, courseId))
      .returning({ id: moodleCourseLink.id });
    if (removed.length === 0) {
      throw new HttpError(404, 'moodle_link_not_found', 'Dieser Kurs ist keinem Modul zugeordnet.');
    }
    await tx.delete(moodleDeadline).where(eq(moodleDeadline.moodleCourseId, courseId));
  });
}

/** Heute als `YYYY-MM-DD` in der Zeitzone der Kursdaten */
function todayIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Ergänzt die Kursliste aus Moodle um die bestätigte Zuordnung, den Vorschlag und die Kursart (F-MDL-03).
 * Vorgeschlagen werden nur Module des aktuellen Semesters (ohne aktuelles Semester: alle nicht archivierten).
 */
export async function annotateCourses(
  db: DbOrTx,
  courses: readonly MoodleCourse[],
  options: { timeZone: string; now: Date },
): Promise<MoodleCourse[]> {
  const links = new Map((await listLinks(db)).map((link) => [link.moodle_course_id, link.module_id]));
  const [current] = await db
    .select({ id: semester.id, startsOn: semester.startsOn })
    .from(semester)
    .where(and(eq(semester.isCurrent, true), notDeleted(semester)))
    .limit(1);
  const modules = await db
    .select({
      id: courseModule.id,
      name: courseModule.name,
      shortName: courseModule.shortName,
      lecturer: courseModule.lecturer,
    })
    .from(courseModule)
    .innerJoin(semester, eq(semester.id, courseModule.semesterId))
    .where(
      and(
        notDeleted(courseModule),
        notDeleted(semester),
        current ? eq(semester.id, current.id) : isNull(semester.archivedAt),
      ),
    );
  const today = todayIn(options.timeZone, options.now);
  return courses.map((course) => {
    const moduleId = links.get(course.moodle_id) ?? null;
    const category = courseCategory(course, current?.startsOn ?? null, today);
    return {
      ...course,
      module_id: moduleId,
      category,
      suggested_module_id:
        moduleId === null && category === 'aktuell' ? suggestModule(course, modules) : null,
    };
  });
}

// ---------- Dateien ----------

export interface ItemFilter {
  courseId?: number | undefined;
  moduleId?: string | undefined;
  kind?: MoodleItemKind | undefined;
  /** Auch in Moodle entfernte Dateien. Standard: nein */
  includeRemoved?: boolean | undefined;
}

/** Dateien aus zugeordneten Kursen, neueste zuerst. Ohne Zuordnung bleibt `module_id` leer */
export async function listItems(db: DbOrTx, filter: ItemFilter): Promise<MoodleItem[]> {
  const conditions: (SQL | undefined)[] = [
    filter.courseId ? eq(moodleItem.moodleCourseId, filter.courseId) : undefined,
    filter.kind ? eq(moodleItem.kind, filter.kind) : undefined,
    filter.includeRemoved ? undefined : isNull(moodleItem.removedInMoodleAt),
    filter.moduleId ? eq(moodleCourseLink.moduleId, filter.moduleId) : undefined,
  ];
  const rows = await db
    .select({ item: moodleItem, moduleId: moodleCourseLink.moduleId })
    .from(moodleItem)
    .leftJoin(moodleCourseLink, eq(moodleCourseLink.moodleCourseId, moodleItem.moodleCourseId))
    .where(and(...conditions))
    .orderBy(desc(moodleItem.createdAt), desc(moodleItem.id));
  return rows.map((row) => toApiItem(row.item, row.moduleId));
}

/** Ist der Verweis eine Datei aus einem abgeglichenen Kurs? (dauerhafte Quelle für GET /moodle/file, Lead #127) */
export async function isKnownFileRef(db: DbOrTx, ref: string): Promise<boolean> {
  const [row] = await db
    .select({ id: moodleItem.id })
    .from(moodleItem)
    .where(eq(moodleItem.fileRef, ref))
    .limit(1);
  return row !== undefined;
}

/**
 * Entscheidung aus der Inbox („Als Folien / Übung / ignorieren“, F-MDL-04). Gilt für die Datei und alle noch
 * offenen Dateien derselben Aktivität, künftige Dateien der Aktivität übernehmen sie beim Abgleich. Fehlt danach das
 * Material der gewählten Art, lädt der nächste Abgleich die Datei.
 */
export async function decideItem(
  db: Db,
  id: string,
  kind: 'folien' | 'uebung' | 'ignoriert',
): Promise<{ item: MoodleItem; courseId: number }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(moodleItem).where(eq(moodleItem.id, id)).for('update');
    if (!row) throw new HttpError(404, 'moodle_item_not_found', 'Diese Moodle-Datei ist nicht bekannt.');
    const affected = await tx
      .select({ id: moodleItem.id })
      .from(moodleItem)
      .where(
        and(
          eq(moodleItem.moodleCourseId, row.moodleCourseId),
          eq(moodleItem.cmid, row.cmid),
          or(eq(moodleItem.id, id), eq(moodleItem.kind, 'offen')),
        ),
      )
      .for('update');
    const targets = inArray(
      moodleItem.id,
      affected.map((entry) => entry.id),
    );
    await tx.update(moodleItem).set({ kind, kindSource: 'manuell' }).where(targets);
    // Fehlt das Material der neuen Art, wird die Datei neu geladen (sha256 leer = noch nicht verarbeitet)
    if (kind !== 'ignoriert') {
      const missing = kind === 'folien' ? isNull(moodleItem.slideDeckId) : isNull(moodleItem.exerciseSheetId);
      await tx.update(moodleItem).set({ sha256: null, lastError: null }).where(and(targets, missing));
    }
    const [updated] = await tx
      .select({ item: moodleItem, moduleId: moodleCourseLink.moduleId })
      .from(moodleItem)
      .leftJoin(moodleCourseLink, eq(moodleCourseLink.moodleCourseId, moodleItem.moodleCourseId))
      .where(eq(moodleItem.id, id));
    if (!updated) throw new Error('Moodle-Datei verschwunden');
    return { item: toApiItem(updated.item, updated.moduleId), courseId: row.moodleCourseId };
  });
}

// ---------- Fristen ----------

export interface DeadlineFilter {
  moduleId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit: number;
}

/** Fristen aus dem Abgleich, nach Datum. Ohne in Moodle entfernte und ohne Fristen gelöschter Module */
export async function listSyncedDeadlines(
  db: DbOrTx,
  filter: DeadlineFilter,
): Promise<MoodleSyncedDeadline[]> {
  const rows = await db
    .select({ deadline: moodleDeadline })
    .from(moodleDeadline)
    .innerJoin(courseModule, eq(courseModule.id, moodleDeadline.moduleId))
    .innerJoin(moodleCourseLink, eq(moodleCourseLink.moodleCourseId, moodleDeadline.moodleCourseId))
    .where(
      and(
        notDeleted(courseModule),
        isNull(moodleDeadline.removedInMoodleAt),
        filter.moduleId ? eq(moodleDeadline.moduleId, filter.moduleId) : undefined,
        filter.from ? gte(moodleDeadline.dueAt, filter.from) : undefined,
        filter.to ? lte(moodleDeadline.dueAt, filter.to) : undefined,
      ),
    )
    .orderBy(asc(moodleDeadline.dueAt), asc(moodleDeadline.id))
    .limit(filter.limit);
  return rows.map((row) => toApiDeadline(row.deadline));
}
