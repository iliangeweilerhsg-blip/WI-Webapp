// Datenbank-Seite des Moodle-Abgleichs (08 §9.4, T1-23): Kurszuordnung, Dateien, Fristen.
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  SINGLE_USER_ID,
  type MoodleCourse,
  type MoodleCourseLink,
  type MoodleItem,
  type MoodleItemKind,
  type MoodleSyncedDeadline,
} from '@sg/shared';
import type { Db, DbOrTx, Tx } from '../db/client.ts';
import { notDeleted } from '../db/schema/common.ts';
import {
  courseModule,
  moodleCourseLink,
  moodleCourseDecided,
  moodleDeadline,
  moodleItem,
  semester,
} from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { MOODLE_AUTO_LOCK_KEY } from '../lib/locks.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import { courseCategory, suggestModule } from './classify.ts';

type LinkRow = typeof moodleCourseLink.$inferSelect;
type ItemRow = typeof moodleItem.$inferSelect;
type DeadlineRow = typeof moodleDeadline.$inferSelect;

/** REST-Zeitformat (VERTRAEGE §6): Millisekunden nur, wenn sie nicht 0 sind */
export const iso = (date: Date): string => date.toISOString().replace(/\.000Z$/, 'Z');
const isoOrNull = (date: Date | null): string | null => (date ? iso(date) : null);

export function toApiLink(row: LinkRow, removable = false): MoodleCourseLink {
  return {
    moodle_course_id: row.moodleCourseId,
    module_id: row.moduleId,
    sync_enabled: row.syncEnabled,
    last_synced_at: isoOrNull(row.lastSyncedAt),
    auto: (row.auto as MoodleCourseLink['auto']) ?? null,
    module_removable: removable,
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

/** Automatik (#141) und Zuordnung von Hand laufen nacheinander. Die Sperre gilt bis zum Ende der Transaktion */
export async function lockAutoAssign(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${MOODLE_AUTO_LOCK_KEY})`);
}

export type CourseDecision = 'auto' | 'manuell' | 'geloest' | 'entfernt';

/**
 * Entscheidung über einen Kurs festhalten (#141): Danach behandelt die Automatik ihn nie wieder. `overwrite`: eine
 * frühere Entscheidung ersetzen („Lösen“, „Modul entfernen“), sonst bleibt sie stehen.
 */
export async function recordDecision(
  tx: Tx,
  courseId: number,
  reason: CourseDecision,
  overwrite = true,
): Promise<void> {
  const insert = tx
    .insert(moodleCourseDecided)
    .values({ id: uuidv7(), userId: SINGLE_USER_ID, moodleCourseId: courseId, reason });
  await (overwrite
    ? insert.onConflictDoUpdate({ target: moodleCourseDecided.moodleCourseId, set: { reason } })
    : insert.onConflictDoNothing({ target: moodleCourseDecided.moodleCourseId }));
}

/**
 * Lässt sich das Modul der Zuordnung mit „Modul entfernen“ in den Papierkorb legen (#141)? Nur ein automatisch
 * angelegtes Modul, das noch leer ist: keine Session, keine beschriebene Seite, kein eigenes Notizbuch, kein Material
 * außer dem aus Moodle übernommenen, kein von Hand zugeordneter Termin und kein weiterer Moodle-Kurs. Für Abfragen
 * mit `moodle_course_link`.
 */
export function linkRemovable(): SQL<boolean> {
  // Ausdrücklich mit Tabellennamen: Drizzle schreibt Spalten ohne Join unqualifiziert, und in den Unterabfragen
  // bezöge sich `"module_id"` dann auf die innere Tabelle (#158). Mit Join wäre `${spalte}` schon qualifiziert
  const outer = (column: { name: string }) => sql.raw(`"moodle_course_link"."${column.name}"`);
  const moduleId = outer(moodleCourseLink.moduleId);
  return sql<boolean>`(${outer(moodleCourseLink.auto)} IS NOT DISTINCT FROM 'angelegt'
    AND NOT EXISTS (SELECT 1 FROM session s WHERE s.module_id = ${moduleId} AND s.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM notebook n WHERE n.module_id = ${moduleId} AND n.deleted_at IS NULL AND n.kind = 'frei')
    AND NOT EXISTS (SELECT 1 FROM page p JOIN notebook n ON n.id = p.notebook_id
      WHERE n.module_id = ${moduleId} AND p.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM slide_deck d WHERE d.module_id = ${moduleId} AND d.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM moodle_item i WHERE i.slide_deck_id = d.id))
    AND NOT EXISTS (SELECT 1 FROM exercise_sheet e WHERE e.module_id = ${moduleId} AND e.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM moodle_item i WHERE i.exercise_sheet_id = e.id))
    AND NOT EXISTS (SELECT 1 FROM calendar_event c WHERE c.module_id = ${moduleId}
      AND c.assigned_by = 'manuell' AND c.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM moodle_course_link o WHERE o.module_id = ${moduleId}
      AND o.moodle_course_id <> ${outer(moodleCourseLink.moodleCourseId)}))`;
}

/** Alle Zuordnungen, auch zu gelöschten Modulen nicht (die fallen weg, bis das Modul wiederhergestellt ist) */
export async function listLinks(db: DbOrTx): Promise<MoodleCourseLink[]> {
  const rows = await db
    .select({ link: moodleCourseLink, removable: linkRemovable() })
    .from(moodleCourseLink)
    .innerJoin(courseModule, eq(courseModule.id, moodleCourseLink.moduleId))
    .where(notDeleted(courseModule))
    .orderBy(asc(moodleCourseLink.moodleCourseId));
  return rows.map((row) => toApiLink(row.link, row.removable === true));
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
 * Foliensätze und Blätter bleiben im alten Modul (sie gehören dem Nutzer). Wechselt das Modul, gilt die Zuordnung
 * als von Hand (`auto = NULL`). Nur der Schalter „Abgleichen“ lässt den Vermerk der Automatik stehen.
 */
export async function putLink(
  db: Db,
  courseId: number,
  input: { module_id: string; sync_enabled?: boolean | undefined },
): Promise<MoodleCourseLink> {
  return db.transaction(async (tx) => {
    await lockAutoAssign(tx);
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
          // Beide Ausdrücke sehen die alte Zeile: gleiches Modul → Vermerk bleibt, anderes → von Hand
          auto: sql`CASE WHEN ${moodleCourseLink.moduleId} = ${input.module_id}::uuid THEN ${moodleCourseLink.auto} ELSE NULL END`,
          ...(input.sync_enabled === undefined ? {} : { syncEnabled: input.sync_enabled }),
        },
      })
      .returning();
    if (!row) throw new Error('Zuordnung wurde nicht gespeichert');
    // Von Hand zugeordnet: die Automatik fasst den Kurs nie an, auch wenn das Modul später endgültig gelöscht wird.
    // Eine frühere Entscheidung (auto, geloest, entfernt) bleibt stehen
    await recordDecision(tx, courseId, 'manuell', false);
    const [removable] = await tx
      .select({ value: linkRemovable() })
      .from(moodleCourseLink)
      .where(eq(moodleCourseLink.id, row.id));
    await tx
      .update(moodleDeadline)
      .set({ moduleId: input.module_id, exerciseSheetId: null })
      .where(and(eq(moodleDeadline.moodleCourseId, courseId), ne(moodleDeadline.moduleId, input.module_id)));
    return toApiLink(row, removable?.value === true);
  });
}

/**
 * Zuordnung lösen. Die Fristen des Kurses fallen weg, Dateien und übernommenes Material bleiben. Die Entscheidung
 * gilt: Die Automatik ordnet den Kurs danach nicht wieder zu (#141), von Hand geht es weiter.
 */
export async function deleteLink(db: Db, courseId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await lockAutoAssign(tx);
    const removed = await tx
      .delete(moodleCourseLink)
      .where(eq(moodleCourseLink.moodleCourseId, courseId))
      .returning({ id: moodleCourseLink.id });
    if (removed.length === 0) {
      throw new HttpError(404, 'moodle_link_not_found', 'Dieser Kurs ist keinem Modul zugeordnet.');
    }
    await tx.delete(moodleDeadline).where(eq(moodleDeadline.moodleCourseId, courseId));
    await recordDecision(tx, courseId, 'geloest');
  });
}

/** Heute als `YYYY-MM-DD` in der Zeitzone der Kursdaten */
export function todayIn(timeZone: string, now: Date): string {
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
  /** Höchstens so viele Einträge (VERTRAEGE §17.3: Listen ohne Cursor, mit `limit`) */
  limit: number;
}

/**
 * Dateien aus zugeordneten Kursen mit eingeschaltetem Abgleich und nicht gelöschtem Modul, neueste zuerst
 * (Review #133, S4). Dateien gelöster oder ausgeschalteter Kurse bleiben in der Datenbank, erscheinen aber
 * weder hier noch in der Inbox.
 */
export async function listItems(db: DbOrTx, filter: ItemFilter): Promise<MoodleItem[]> {
  const rows = await db
    .select({ item: moodleItem, moduleId: moodleCourseLink.moduleId })
    .from(moodleItem)
    .innerJoin(moodleCourseLink, eq(moodleCourseLink.moodleCourseId, moodleItem.moodleCourseId))
    .innerJoin(courseModule, eq(courseModule.id, moodleCourseLink.moduleId))
    .where(
      and(
        eq(moodleCourseLink.syncEnabled, true),
        notDeleted(courseModule),
        filter.courseId ? eq(moodleItem.moodleCourseId, filter.courseId) : undefined,
        filter.kind ? eq(moodleItem.kind, filter.kind) : undefined,
        filter.includeRemoved ? undefined : isNull(moodleItem.removedInMoodleAt),
        filter.moduleId ? eq(moodleCourseLink.moduleId, filter.moduleId) : undefined,
      ),
    )
    .orderBy(desc(moodleItem.createdAt), desc(moodleItem.id))
    .limit(filter.limit);
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
 * Entscheidung aus der Inbox („Als Folien / Übung / ignorieren“, F-MDL-04), `offen` macht sie rückgängig. Gilt für die Datei und alle noch
 * offenen Dateien derselben Aktivität, künftige Dateien der Aktivität übernehmen sie beim Abgleich. Fehlt danach das
 * Material der gewählten Art, lädt der nächste Abgleich die Datei.
 */
export async function decideItem(
  db: Db,
  id: string,
  kind: 'folien' | 'uebung' | 'ignoriert' | 'offen',
): Promise<{ item: MoodleItem; courseId: number }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(moodleItem).where(eq(moodleItem.id, id)).for('update');
    if (!row) throw new HttpError(404, 'moodle_item_not_found', 'Diese Moodle-Datei ist nicht bekannt.');
    const sameActivity = and(
      eq(moodleItem.moodleCourseId, row.moodleCourseId),
      eq(moodleItem.cmid, row.cmid),
    );
    // Zurück auf „offen“ (Rückgängig, R15): die Datei und alle, die mit derselben Entscheidung eingeordnet wurden
    const revert = kind === 'offen';
    const sameDecision =
      row.kindSource === 'manuell' && row.kindDecidedAt !== null
        ? and(eq(moodleItem.kindSource, 'manuell'), eq(moodleItem.kindDecidedAt, row.kindDecidedAt))
        : undefined;
    const affected = await tx
      .select({ id: moodleItem.id })
      .from(moodleItem)
      .where(
        and(
          sameActivity,
          revert
            ? sameDecision
              ? or(eq(moodleItem.id, id), sameDecision)
              : eq(moodleItem.id, id)
            : or(eq(moodleItem.id, id), eq(moodleItem.kind, 'offen')),
        ),
      )
      .for('update');
    const targets = inArray(
      moodleItem.id,
      affected.map((entry) => entry.id),
    );
    await tx
      .update(moodleItem)
      .set(
        revert
          ? { kind, kindSource: 'auto', kindDecidedAt: null }
          : { kind, kindSource: 'manuell', kindDecidedAt: new Date() },
      )
      .where(targets);
    // Fehlt das Material der neuen Art, wird die Datei neu geladen (sha256 leer = noch nicht verarbeitet)
    if (kind === 'folien' || kind === 'uebung') {
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

/** Fristen aus dem Abgleich, nach Datum. Ohne in Moodle entfernte, ohne gelöste bzw. ausgeschaltete Kurse und ohne Fristen gelöschter Module */
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
        // Nur Fristen zugeordneter Kurse mit eingeschaltetem Abgleich (Review #133, H7)
        eq(moodleCourseLink.syncEnabled, true),
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
