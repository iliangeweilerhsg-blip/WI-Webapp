// Moodle-Abgleich (08 §9.4, F-MDL-03/-04, T1-23): Kurszuordnung, Dateien aus Moodle, Fristen.
// Moodle-IDs als int8 (JS-Zahl, Moodle vergibt fortlaufende IDs weit unter 2^53).
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { baseColumns, timestamptz } from './common.ts';
import { exerciseSheet, slideDeck } from './material.ts';
import { courseModule } from './organisation.ts';

const moodleId = (name: string) => bigint(name, { mode: 'number' });

/**
 * Zuordnung Moodle-Kurs → Modul (F-MDL-03). Ein Kurs gehört höchstens zu einem Modul, ein Modul kann mehrere
 * Kurse haben (z. B. Vorlesung und Übung). Lösen der Zuordnung löscht die Zeile (Einstellung, kein Inhalt).
 */
export const moodleCourseLink = pgTable(
  'moodle_course_link',
  {
    ...baseColumns(),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => courseModule.id, { onDelete: 'cascade' }),
    moodleCourseId: moodleId('moodle_course_id').notNull(),
    syncEnabled: boolean('sync_enabled').notNull().default(true),
    /** Letzter erfolgreicher Abgleich dieses Kurses */
    lastSyncedAt: timestamptz('last_synced_at'),
    /**
     * Automatische Zuordnung (#141): `zugeordnet` = eindeutig passendes Modul, `angelegt` = Modul aus dem Kursnamen
     * angelegt. NULL = von Hand. Wechselt das Modul von Hand, wird es NULL
     */
    auto: text('auto'),
  },
  (t) => [
    uniqueIndex('moodle_course_link_course_uq').on(t.moodleCourseId),
    index('moodle_course_link_module_idx').on(t.moduleId),
    check('moodle_course_link_auto_chk', sql`${t.auto} IS NULL OR ${t.auto} IN ('zugeordnet','angelegt')`),
  ],
);

/**
 * Kurse, über die der Nutzer selbst entschieden hat (#141): „Lösen“ bzw. „Modul entfernen“. Die automatische
 * Zuordnung fasst sie nicht mehr an, von Hand zuordnen geht weiter. Einstellung, kein Inhalt (kein Papierkorb).
 */
export const moodleCourseManual = pgTable(
  'moodle_course_manual',
  {
    ...baseColumns(),
    moodleCourseId: moodleId('moodle_course_id').notNull(),
  },
  (t) => [uniqueIndex('moodle_course_manual_course_uq').on(t.moodleCourseId)],
);

/**
 * Eine Datei aus dem Kursinhalt eines zugeordneten Kurses. Wiedererkannt über `file_ref` (Aktivität + Dateipfad).
 * `timemodified`, `size_bytes` und `sha256` beschreiben die zuletzt verarbeitete Fassung. Die Datei selbst liegt nur
 * unter der ID des Foliensatzes bzw. Übungsblatts (08 §7), nie unter dem Moodle-Namen.
 */
export const moodleItem = pgTable(
  'moodle_item',
  {
    ...baseColumns(),
    moodleCourseId: moodleId('moodle_course_id').notNull(),
    cmid: moodleId('cmid').notNull(),
    /** Name der Aktivität (Anzeige, Einordnung) */
    activityName: text('activity_name').notNull(),
    /** Dateiname zur Anzeige, bereinigt und auf 255 Byte gekürzt (Endung bleibt) */
    filename: text('filename').notNull(),
    fileRef: text('file_ref').notNull(),
    mimeType: text('mime_type'),
    timemodified: timestamptz('timemodified'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** NULL, solange die Datei nicht geladen wurde (offen, ignoriert, Fehler) */
    sha256: text('sha256'),
    kind: text('kind').notNull(),
    /** auto: Regel aus 08 bzw. Entscheidung der Aktivität. manuell: Entscheidung in der Inbox */
    kindSource: text('kind_source').notNull().default('auto'),
    /** Zeitpunkt der Entscheidung in der Inbox (`kind_source = manuell`). Die jüngste gilt für die Aktivität */
    kindDecidedAt: timestamptz('kind_decided_at'),
    slideDeckId: uuid('slide_deck_id').references(() => slideDeck.id, { onDelete: 'set null' }),
    exerciseSheetId: uuid('exercise_sheet_id').references(() => exerciseSheet.id, { onDelete: 'set null' }),
    removedInMoodleAt: timestamptz('removed_in_moodle_at'),
    /** Grund, warum die Datei zuletzt nicht übernommen werden konnte (z. B. `kein_pdf`, `zu_gross`) */
    lastError: text('last_error'),
  },
  (t) => [
    uniqueIndex('moodle_item_file_ref_uq').on(t.fileRef),
    index('moodle_item_course_idx').on(t.moodleCourseId, t.cmid),
    check('moodle_item_kind_chk', sql`${t.kind} IN ('folien','uebung','ignoriert','offen')`),
    check('moodle_item_kind_source_chk', sql`${t.kindSource} IN ('auto','manuell')`),
    check('moodle_item_sha256_chk', sql`${t.sha256} IS NULL OR ${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * Frist aus Moodle (F-MDL-04 Schritt 3): Aufgaben mit Abgabedatum (`aufgabe`) und kommende Kalenderereignisse
 * (`termin`). Ein Ereignis zu einer schon übernommenen Aufgabe (gleiche `cmid`) wird nicht doppelt geführt.
 */
export const moodleDeadline = pgTable(
  'moodle_deadline',
  {
    ...baseColumns(),
    source: text('source').notNull(),
    moodleCourseId: moodleId('moodle_course_id').notNull(),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => courseModule.id, { onDelete: 'cascade' }),
    moodleAssignmentId: moodleId('moodle_assignment_id'),
    moodleEventId: moodleId('moodle_event_id'),
    cmid: moodleId('cmid'),
    name: text('name').notNull(),
    dueAt: timestamptz('due_at').notNull(),
    url: text('url'),
    exerciseSheetId: uuid('exercise_sheet_id').references(() => exerciseSheet.id, { onDelete: 'set null' }),
    removedInMoodleAt: timestamptz('removed_in_moodle_at'),
  },
  (t) => [
    uniqueIndex('moodle_deadline_assignment_uq')
      .on(t.moodleAssignmentId)
      .where(sql`${t.moodleAssignmentId} IS NOT NULL`),
    uniqueIndex('moodle_deadline_event_uq')
      .on(t.moodleEventId)
      .where(sql`${t.moodleEventId} IS NOT NULL`),
    index('moodle_deadline_module_due_idx').on(t.moduleId, t.dueAt),
    check(
      'moodle_deadline_source_chk',
      sql`(${t.source} = 'aufgabe' AND ${t.moodleAssignmentId} IS NOT NULL) OR (${t.source} = 'termin' AND ${t.moodleEventId} IS NOT NULL)`,
    ),
  ],
);
