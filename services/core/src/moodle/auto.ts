// Automatische Kurszuordnung (#141, Owner-Wunsch vom 05.11.2026, ergänzt F-MDL-03): Beim Abgleich und beim Laden der
// Kursliste bekommt jeder aktuelle Kurs ohne Zuordnung ein Modul. Passt genau ein Modul des aktuellen Semesters, wird
// er ihm zugeordnet. Passt keins, legt die App eines an. Mehrdeutig bleibt ein Vorschlag. Keine KI.
import { and, asc, eq, isNull } from 'drizzle-orm';
import { SINGLE_USER_ID, type MoodleCourse } from '@sg/shared';
import type { Db } from '../db/client.ts';
import { notDeleted } from '../db/schema/common.ts';
import { courseModule, moodleCourseLink, moodleCourseManual, semester } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import { createModule, deleteModule } from '../services/organisation.ts';
import { courseCategory } from './classify.ts';
import { cleanCourseName, cleanShortName, matchForAuto, moduleNameKey } from './course-name.ts';
import { linkRemovable, lockAutoAssign, todayIn } from './store.ts';

export interface AutoAssignResult {
  /** Kurse, die einem bestehenden Modul zugeordnet wurden */
  assigned: number;
  /** Neu angelegte Module */
  created: number;
}

/**
 * Ordnet die Kurse des aktuellen Semesters automatisch zu (#141). Behandelt werden nur Kurse der Art `aktuell`, die
 * weder eine Zuordnung haben (auch keine zu einem gelöschten Modul, die der Papierkorb wiederherstellen kann) noch
 * nach „Lösen“ bzw. „Modul entfernen“ von Hand entschieden sind. Ohne aktuelles Semester passiert nichts.
 *
 * Idempotent und sicher bei gleichzeitigen Läufen: Alles läuft in einer Transaktion unter einer Advisory-Sperre. Ein
 * zweiter Lauf wartet und findet die Kurse danach zugeordnet vor. Neue Module entstehen über `createModule`
 * (Farbe, Notizbücher) als Teil dieser Transaktion.
 */
export async function autoAssignCourses(
  db: Db,
  courses: readonly Pick<
    MoodleCourse,
    'moodle_id' | 'full_name' | 'short_name' | 'start_date' | 'end_date'
  >[],
  options: { timeZone: string; now: Date },
): Promise<AutoAssignResult> {
  const result: AutoAssignResult = { assigned: 0, created: 0 };
  if (courses.length === 0) return result;
  return db.transaction(async (tx) => {
    await lockAutoAssign(tx);
    const [current] = await tx
      .select({ id: semester.id, startsOn: semester.startsOn })
      .from(semester)
      .where(and(eq(semester.isCurrent, true), notDeleted(semester), isNull(semester.archivedAt)))
      .limit(1);
    // Ohne aktuelles Semester keine Module anlegen und nichts zuordnen. Die Web-App zeigt den Hinweis
    if (!current) return result;

    const linked = await tx.select({ id: moodleCourseLink.moodleCourseId }).from(moodleCourseLink);
    const manual = await tx.select({ id: moodleCourseManual.moodleCourseId }).from(moodleCourseManual);
    const taken = new Set([...linked, ...manual].map((row) => row.id));
    const today = todayIn(options.timeZone, options.now);
    const open = courses.filter(
      (course) =>
        !taken.has(course.moodle_id) && courseCategory(course, current.startsOn, today) === 'aktuell',
    );
    if (open.length === 0) return result;

    const modules = await tx
      .select({
        id: courseModule.id,
        name: courseModule.name,
        shortName: courseModule.shortName,
        lecturer: courseModule.lecturer,
      })
      .from(courseModule)
      .where(and(eq(courseModule.semesterId, current.id), notDeleted(courseModule)))
      .orderBy(asc(courseModule.createdAt), asc(courseModule.id));

    const link = async (courseId: number, moduleId: string, auto: 'zugeordnet' | 'angelegt') => {
      await tx
        .insert(moodleCourseLink)
        .values({ id: uuidv7(), userId: SINGLE_USER_ID, moduleId, moodleCourseId: courseId, auto })
        .onConflictDoNothing({ target: moodleCourseLink.moodleCourseId });
    };

    // 1. Gegen die bestehenden Module. Neue Module dieses Laufs zählen hier nicht, damit die Reihenfolge der Kurse
    //    nichts entscheidet („Statistik“ und „Statistik II“ ergeben zwei Module)
    const toCreate = new Map<string, { name: string; courses: typeof open }>();
    for (const course of open) {
      const match = matchForAuto(course, modules);
      if (match.kind === 'eindeutig') {
        await link(course.moodle_id, match.id, 'zugeordnet');
        result.assigned += 1;
      } else if (match.kind === 'keiner') {
        const name = cleanCourseName(course.full_name);
        const key = moduleNameKey(name);
        const group = toCreate.get(key) ?? { name, courses: [] };
        group.courses.push(course);
        toCreate.set(key, group);
      }
    }

    // 2. Je bereinigtem Namen ein neues Modul im aktuellen Semester. Kurse mit gleichem Namen teilen es sich
    for (const group of toCreate.values()) {
      const first = group.courses[0];
      if (!first) continue;
      // createModule öffnet eine Transaktion; in der Transaktion des Laufs wird daraus ein Savepoint
      const module = await createModule(tx as unknown as Db, {
        semester_id: current.id,
        name: group.name,
        short_name: cleanShortName(first.short_name, group.name),
      });
      result.created += 1;
      for (const course of group.courses) await link(course.moodle_id, module.id, 'angelegt');
    }
    return result;
  });
}

/**
 * „Modul entfernen“ (#141, R15): Ein automatisch angelegtes Modul, das noch leer ist, kommt per Soft-Delete in den
 * Papierkorb (mit Kaskade, wiederherstellbar). Die Zuordnung bleibt stehen und lebt mit dem Wiederherstellen wieder
 * auf. Der Kurs gilt danach als von Hand entschieden: Die Automatik legt kein neues Modul an.
 * 404 `moodle_link_not_found`, 409 `moodle_module_not_removable`, 409 `session_active` (aus `deleteModule`).
 */
export async function removeAutoModule(db: Db, courseId: number): Promise<{ moduleId: string }> {
  const [row] = await db
    .select({ link: moodleCourseLink, removable: linkRemovable() })
    .from(moodleCourseLink)
    .innerJoin(courseModule, eq(courseModule.id, moodleCourseLink.moduleId))
    .where(and(eq(moodleCourseLink.moodleCourseId, courseId), notDeleted(courseModule)));
  if (!row) throw new HttpError(404, 'moodle_link_not_found', 'Dieser Kurs ist keinem Modul zugeordnet.');
  if (!row.removable) {
    throw new HttpError(
      409,
      'moodle_module_not_removable',
      'Dieses Modul wurde nicht automatisch angelegt oder enthält schon Inhalte.',
    );
  }
  await deleteModule(db, row.link.moduleId);
  await db
    .insert(moodleCourseManual)
    .values({ id: uuidv7(), userId: SINGLE_USER_ID, moodleCourseId: courseId })
    .onConflictDoNothing({ target: moodleCourseManual.moodleCourseId });
  return { moduleId: row.link.moduleId };
}
