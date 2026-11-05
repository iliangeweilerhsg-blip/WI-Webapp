// Moodle-Abgleich (F-MDL-04, 08 §9.4, T1-23): läuft im Core (er braucht den Token), nur lesend gegenüber Moodle.
// Je zugeordnetem Kurs: Kursinhalt holen, Dateien über `file_ref` wiedererkennen, neue bzw. geänderte PDFs als
// Foliensatz oder Übungsblatt anlegen (wie beim Upload, inklusive `pdf.ingest`), Unklares in die Inbox,
// Fristen übernehmen. Zweimal abgleichen ergibt keine Dubletten: Dateien sind über `file_ref` eindeutig, Material
// über (Modul, sha256), Fristen über Aufgaben- bzw. Ereignis-ID.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, eq, gte, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import {
  SINGLE_USER_ID,
  type MoodleAssignment,
  type MoodleDeadline,
  type MoodleFile,
  type MoodleSyncRun,
  type MoodleSyncStatus,
  type MoodleSyncTrigger,
} from '@sg/shared';
import type { Db } from '../db/client.ts';
import { notDeleted } from '../db/schema/common.ts';
import { exerciseSheet, moodleCourseLink, moodleDeadline, moodleItem } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import {
  createExerciseSheet,
  createSlideDeck,
  titleFromFilename,
  uploadTmpDir,
  type StoredUpload,
} from '../services/material.ts';
import { autoAssignCourses } from './auto.ts';
import { classifyFile, displayFilename, sheetNumber, type FileKind } from './classify.ts';
import type { MoodleServices } from './index.ts';
import { activeLinks, iso, looksLikePdf } from './store.ts';

/** Abgleich alle 2 h (F-MDL-04) */
export const SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000;
/** Größte Datei, die als Material übernommen wird: wie beim Upload (F-ORG-02) */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
/** Moodle liefert höchstens 50 Kalenderereignisse je Aufruf */
const EVENT_LIMIT = 50;
const PDF_MAGIC = Buffer.from('%PDF');
const MAGIC_WINDOW = 1024;

type ItemRow = typeof moodleItem.$inferSelect;
type LinkRow = typeof moodleCourseLink.$inferSelect;

interface SyncLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
}

export interface MoodleSyncOptions {
  db: Db;
  dataDir: string;
  moodle: Pick<MoodleServices, 'client' | 'status' | 'reader'>;
  logger?: SyncLogger;
  now?: () => Date;
  maxImportBytes?: number;
}

/** Ein Kurs bzw. alle zugeordneten Kurse (`null`) */
type Scope = ReadonlySet<number> | null;

/** Ein angehängter Abgleich, der nach dem laufenden startet */
interface Queued {
  trigger: MoodleSyncTrigger;
  scope: Set<number> | null;
  promise: Promise<MoodleSyncRun>;
}

class TokenInvalid extends Error {}
class SyncStopped extends Error {}

/** So lange wartet das Herunterfahren höchstens auf einen laufenden Abgleich (main.ts beendet hart nach 10 s) */
export const SHUTDOWN_WAIT_MS = 7_000;

function codeOf(error: unknown): string {
  return error instanceof HttpError ? error.code : 'internal_error';
}

/** Lädt die Datei in den temporären Upload-Ordner: sha256, Größe, `%PDF` in den ersten 1024 Byte */
async function storeDownload(
  stream: Readable,
  dataDir: string,
  maxBytes: number,
): Promise<{ tmpPath: string; size: number; sha256: string; isPdf: boolean }> {
  const tmpDir = uploadTmpDir(dataDir);
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = join(tmpDir, `${uuidv7()}.moodle`);
  const hash = createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > maxBytes) {
        done(new HttpError(502, 'moodle_unreachable', 'Die Datei ist zu groß.', { reason: 'too_large' }));
        return;
      }
      hash.update(chunk);
      if (head.length < MAGIC_WINDOW)
        head = Buffer.concat([head, chunk.subarray(0, MAGIC_WINDOW - head.length)]);
      done(null, chunk);
    },
  });
  try {
    await pipeline(stream, meter, createWriteStream(tmpPath));
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
  return { tmpPath, size, sha256: hash.digest('hex'), isPdf: size > 0 && head.includes(PDF_MAGIC) };
}

function emptyRun(trigger: MoodleSyncTrigger, startedAt: Date): MoodleSyncRun {
  return {
    trigger,
    started_at: iso(startedAt),
    finished_at: null,
    ok: true,
    error_code: null,
    courses: 0,
    files_new: 0,
    files_changed: 0,
    files_imported: 0,
    inbox_new: 0,
    deadlines: 0,
    failed_courses: [],
  };
}

export class MoodleSync {
  private readonly db: Db;
  private readonly dataDir: string;
  private readonly moodle: MoodleSyncOptions['moodle'];
  private readonly logger: SyncLogger | undefined;
  private readonly now: () => Date;
  private readonly maxImportBytes: number;
  private current: Promise<MoodleSyncRun> | null = null;
  private queued: Queued | null = null;
  private lastRun: MoodleSyncRun | null = null;
  private stopped = false;
  /** Wird bei `stop()` ausgelöst und bricht einen laufenden Datei-Download ab */
  private readonly stopController = new AbortController();
  private nextRunAt: Date | null = null;

  constructor(options: MoodleSyncOptions) {
    this.db = options.db;
    this.dataDir = options.dataDir;
    this.moodle = options.moodle;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.maxImportBytes = options.maxImportBytes ?? MAX_IMPORT_BYTES;
  }

  async status(): Promise<MoodleSyncStatus> {
    const connection = (await this.moodle.status.getStatus()).state;
    const state =
      this.current !== null
        ? 'laeuft'
        : connection === 'nicht_eingerichtet'
          ? 'aus'
          : connection === 'ungueltig' || connection === 'abgelaufen'
            ? 'pausiert'
            : 'bereit';
    return {
      state,
      connection,
      last_run: this.lastRun,
      next_run_at: this.nextRunAt ? iso(this.nextRunAt) : null,
    };
  }

  /**
   * Startet einen Abgleich. Läuft schon einer, wird genau ein weiterer danach angehängt (Kurse zusammengefasst).
   * Das Promise erfüllt sich mit dem Ergebnis des Laufs, der diese Anfrage abdeckt. Es wird nie verworfen.
   */
  run(trigger: MoodleSyncTrigger, courseIds?: readonly number[]): Promise<MoodleSyncRun> {
    const scope = courseIds ? new Set(courseIds) : null;
    if (this.stopped) return Promise.resolve(this.abortedRun(trigger));
    // Direkt nur, wenn weder einer läuft noch einer wartet: Zwischen dem Ende des laufenden und dem Start des
    // angehängten Laufs ist `current` kurz leer (Review #133, S2)
    if (this.current === null && this.queued === null) {
      return this.begin(trigger, scope);
    }
    if (this.queued) {
      const queued = this.queued;
      if (queued.scope !== null) {
        if (scope === null) queued.scope = null;
        else for (const id of scope) queued.scope.add(id);
      }
      return queued.promise;
    }
    const entry: Partial<Queued> & Pick<Queued, 'trigger' | 'scope'> = { trigger, scope };
    entry.promise = (this.current ?? Promise.resolve()).then(() => {
      this.queued = null;
      // Nach stop(): der angehängte Lauf wird verworfen
      if (this.stopped) return this.abortedRun(entry.trigger);
      return this.begin(entry.trigger, entry.scope);
    });
    this.queued = entry as Queued;
    return entry.promise;
  }

  /** Wartet, bis kein Abgleich mehr läuft (Tests, Herunterfahren) */
  async idle(): Promise<void> {
    while (this.current || this.queued) await (this.queued?.promise ?? this.current);
  }

  /**
   * Herunterfahren (Review #133, S3): keine neuen Läufe, der angehängte wird verworfen, der laufende bricht ab
   * (`error_code = abgebrochen`). Ein gerade laufender Datei-Download wird sofort abgebrochen (`AbortSignal`), die
   * temporäre Datei entfernt und kein Material angelegt. Sonst bricht er an der nächsten Stelle zwischen zwei
   * Dateien bzw. Kursen ab. Wartet höchstens `waitMs`, damit der Core vor seiner harten Frist
   * (`SHUTDOWN_DEADLINE_MS` in main.ts) sauber endet.
   *
   * **`stop()` ist endgültig:** Danach startet diese Instanz nie wieder einen Lauf (`run()` liefert nur noch
   * `abgebrochen`), auch nicht nach Ablauf von `waitMs`. Wer wieder abgleichen will, legt eine neue Instanz an.
   */
  async stop(waitMs: number = SHUTDOWN_WAIT_MS): Promise<void> {
    this.stopped = true;
    this.stopController.abort();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs);
      timer.unref();
    });
    await Promise.race([this.idle(), timeout]);
    clearTimeout(timer);
  }

  private abortedRun(trigger: MoodleSyncTrigger): MoodleSyncRun {
    const run = emptyRun(trigger, this.now());
    run.ok = false;
    run.error_code = 'abgebrochen';
    run.finished_at = run.started_at;
    return run;
  }

  /** Zwischen Dateien und Kursen: nach stop() nicht weitermachen */
  private checkStopped(): void {
    if (this.stopped) throw new SyncStopped();
  }

  /** Abgleich beim Start und danach alle 2 h. Rückgabe stoppt den Zeitplan */
  startSchedule(intervalMs: number = SYNC_INTERVAL_MS): () => void {
    const fire = (trigger: MoodleSyncTrigger) => {
      this.nextRunAt = new Date(this.now().getTime() + intervalMs);
      void this.run(trigger);
    };
    const timer = setInterval(() => fire('zeitplan'), intervalMs);
    timer.unref();
    fire('start');
    return () => {
      clearInterval(timer);
      this.nextRunAt = null;
    };
  }

  private begin(trigger: MoodleSyncTrigger, scope: Scope): Promise<MoodleSyncRun> {
    const promise = this.execute(trigger, scope).finally(() => {
      this.current = null;
    });
    this.current = promise;
    return promise;
  }

  private async execute(trigger: MoodleSyncTrigger, scope: Scope): Promise<MoodleSyncRun> {
    const run = emptyRun(trigger, this.now());
    try {
      await this.syncAll(run, scope);
    } catch (error) {
      run.ok = false;
      run.error_code =
        error instanceof TokenInvalid
          ? 'moodle_token_invalid'
          : error instanceof SyncStopped
            ? 'abgebrochen'
            : codeOf(error);
      this.logger?.warn({ err: error, trigger }, 'Moodle-Abgleich abgebrochen');
    }
    run.finished_at = iso(this.now());
    this.lastRun = run;
    this.logger?.info(
      {
        trigger,
        ok: run.ok,
        courses: run.courses,
        files_new: run.files_new,
        files_imported: run.files_imported,
        inbox_new: run.inbox_new,
      },
      'Moodle-Abgleich beendet',
    );
    return run;
  }

  private async syncAll(run: MoodleSyncRun, scope: Scope): Promise<void> {
    // Kein Zugang oder Token abgelehnt bzw. abgelaufen: Abgleich pausiert (F-MDL-01), statt Fehler zu sammeln
    const connection = (await this.moodle.status.getStatus()).state;
    if (connection === 'nicht_eingerichtet') {
      run.ok = false;
      run.error_code = 'moodle_not_configured';
      return;
    }
    if (connection === 'ungueltig' || connection === 'abgelaufen') throw new TokenInvalid();

    // Voller Lauf: zuerst neue Kurse automatisch zuordnen (#141), damit sie gleich mit abgeglichen werden
    if (scope === null) await this.autoAssign(run);
    const links = await activeLinks(this.db, scope ? [...scope] : null);
    for (const link of links) {
      this.checkStopped();
      try {
        await this.syncCourse(link, run);
        await this.db
          .update(moodleCourseLink)
          .set({ lastSyncedAt: this.now() })
          .where(eq(moodleCourseLink.id, link.id));
        run.courses += 1;
      } catch (error) {
        if (codeOfToken(error)) throw new TokenInvalid();
        if (error instanceof SyncStopped) throw error;
        run.ok = false;
        run.error_code ??= codeOf(error);
        run.failed_courses.push(link.moodleCourseId);
        this.logger?.warn({ err: error, course_id: link.moodleCourseId }, 'Moodle-Kurs nicht abgeglichen');
      }
    }
    if (links.length === 0) return;
    this.checkStopped();
    try {
      run.deadlines = await this.syncDeadlines(links);
    } catch (error) {
      if (codeOfToken(error)) throw new TokenInvalid();
      run.ok = false;
      run.error_code ??= codeOf(error);
      this.logger?.warn({ err: error }, 'Moodle-Fristen nicht abgeglichen');
    }
  }

  /** Automatische Kurszuordnung (#141). Scheitert sie, gleicht der Lauf die bestehenden Zuordnungen trotzdem ab */
  private async autoAssign(run: MoodleSyncRun): Promise<void> {
    try {
      const courses = await this.moodle.reader.courses();
      const result = await autoAssignCourses(this.db, courses.items, {
        timeZone: this.moodle.reader.timeZone,
        now: this.now(),
      });
      if (result.assigned > 0 || result.created > 0) {
        this.logger?.info(result, 'Moodle-Kurse automatisch zugeordnet');
      }
    } catch (error) {
      if (codeOfToken(error)) throw new TokenInvalid();
      run.ok = false;
      run.error_code ??= codeOf(error);
      this.logger?.warn({ err: error }, 'Automatische Kurszuordnung fehlgeschlagen');
    }
  }

  // ---------- Dateien ----------

  private async syncCourse(link: LinkRow, run: MoodleSyncRun): Promise<void> {
    const courseId = link.moodleCourseId;
    const contents = await this.moodle.reader.courseContents(courseId);
    // Sichtbare Dateien je Verweis. Versteckte gelten wie gelöschte als „in Moodle entfernt“ (F-MDL-04 Schritt 4)
    const seen = new Map<string, { file: MoodleFile; cmid: number; activity: string }>();
    for (const section of contents.sections) {
      for (const activity of section.activities) {
        if (!section.visible || !activity.visible) continue;
        for (const file of activity.files) {
          if (!seen.has(file.ref)) seen.set(file.ref, { file, cmid: activity.cmid, activity: activity.name });
        }
      }
    }

    const existing = await this.db.select().from(moodleItem).where(eq(moodleItem.moodleCourseId, courseId));
    const byRef = new Map(existing.map((row) => [row.fileRef, row]));
    // Entscheidung aus der Inbox gilt für die ganze Aktivität: die jüngste manuelle Einordnung je cmid
    const decided = new Map<number, { kind: string; at: number }>();
    for (const row of existing) {
      if (row.kindSource !== 'manuell' || row.kindDecidedAt === null) continue;
      const previous = decided.get(row.cmid);
      const at = row.kindDecidedAt.getTime();
      if (!previous || at > previous.at) decided.set(row.cmid, { kind: row.kind, at });
    }
    const classify = (filename: string, activity: string, cmid: number) =>
      decided.get(cmid)?.kind ?? classifyFile(filename, activity) ?? 'offen';

    for (const { file, cmid, activity } of seen.values()) {
      this.checkStopped();
      const filename = displayFilename(file.filename);
      const modified = file.modified_at ? new Date(file.modified_at) : null;
      let row = byRef.get(file.ref);
      let changed = false;
      if (!row) {
        const kind = !looksLikePdf(file.mime_type, filename)
          ? 'ignoriert'
          : classify(filename, activity, cmid);
        const [inserted] = await this.db
          .insert(moodleItem)
          .values({
            id: uuidv7(),
            userId: SINGLE_USER_ID,
            moodleCourseId: courseId,
            cmid,
            activityName: activity,
            filename,
            fileRef: file.ref,
            mimeType: file.mime_type,
            timemodified: modified,
            sizeBytes: file.size_bytes,
            kind,
          })
          .onConflictDoNothing({ target: moodleItem.fileRef })
          .returning();
        if (!inserted) continue;
        row = inserted;
        run.files_new += 1;
        if (kind === 'offen') run.inbox_new += 1;
      } else {
        changed =
          (row.timemodified?.getTime() ?? null) !== (modified?.getTime() ?? null) ||
          row.sizeBytes !== file.size_bytes;
        if (changed) run.files_changed += 1;
        const kindIsMaterial = row.kind === 'folien' || row.kind === 'uebung';
        const set: Partial<typeof moodleItem.$inferInsert> = {};
        if (row.activityName !== activity) set.activityName = activity;
        if (row.filename !== filename) set.filename = filename;
        if (row.mimeType !== file.mime_type) set.mimeType = file.mime_type;
        if (row.removedInMoodleAt !== null) set.removedInMoodleAt = null;
        if (changed && row.lastError === 'kein_pdf' && looksLikePdf(file.mime_type, filename)) {
          // „Kein PDF“ gilt nur für die geprüfte Fassung: eine neue wird neu eingeordnet und geprüft (Review #133, H5)
          const kind = classify(filename, activity, row.cmid);
          Object.assign(set, { kind, kindSource: 'auto', lastError: null, sha256: null });
          if (kind === 'offen') run.inbox_new += 1;
        } else if (changed && !kindIsMaterial) {
          // Material: die Fassung gilt erst nach dem Laden als verarbeitet. Sonst nur Metadaten
          Object.assign(set, { timemodified: modified, sizeBytes: file.size_bytes });
        }
        // Nur schreiben, wenn sich etwas ändert (Review #133, S5)
        if (Object.keys(set).length > 0) {
          const [updated] = await this.db
            .update(moodleItem)
            .set(set)
            .where(eq(moodleItem.id, row.id))
            .returning();
          if (updated) row = updated;
        }
      }
      if (this.needsImport(row, changed)) await this.importFile(row, file, modified, link.moduleId, run);
    }

    // In Moodle entfernt oder versteckt: nur markieren, lokal wird nie gelöscht
    const gone = existing.filter((row) => !seen.has(row.fileRef) && row.removedInMoodleAt === null);
    if (gone.length > 0) {
      await this.db
        .update(moodleItem)
        .set({ removedInMoodleAt: this.now() })
        .where(
          inArray(
            moodleItem.id,
            gone.map((row) => row.id),
          ),
        );
    }
  }

  /** Neu laden, wenn die Datei geändert ist oder Material der gewählten Art fehlt und noch nie geladen wurde */
  private needsImport(row: ItemRow, changed: boolean): boolean {
    if (row.kind !== 'folien' && row.kind !== 'uebung') return false;
    if (changed) return true;
    const target = row.kind === 'folien' ? row.slideDeckId : row.exerciseSheetId;
    return (
      target === null && row.sha256 === null && row.lastError !== 'zu_gross' && row.lastError !== 'kein_pdf'
    );
  }

  private async importFile(
    row: ItemRow,
    file: MoodleFile,
    modified: Date | null,
    moduleId: string,
    run: MoodleSyncRun,
  ): Promise<void> {
    const kind = row.kind as FileKind;
    const meta = { timemodified: modified, sizeBytes: file.size_bytes };
    const fail = async (error: 'zu_gross' | 'nicht_gefunden' | 'download_fehlgeschlagen' | 'kein_pdf') => {
      await this.db
        .update(moodleItem)
        .set({
          lastError: error,
          // Kein PDF bleibt nur gelistet. Zu groß: erst eine neue Fassung wird wieder versucht
          ...(error === 'kein_pdf' ? { kind: 'ignoriert', kindSource: 'auto', ...meta } : {}),
          ...(error === 'zu_gross' ? meta : {}),
        })
        .where(eq(moodleItem.id, row.id));
    };
    if (file.size_bytes > this.maxImportBytes) return fail('zu_gross');

    let stored: Awaited<ReturnType<typeof storeDownload>>;
    try {
      const download = await this.moodle.client.downloadFile(file.ref, {
        signal: this.stopController.signal,
      });
      stored = await storeDownload(download.stream, this.dataDir, this.maxImportBytes);
    } catch (error) {
      // Abbruch durch stop() ist kein Fehler der Datei: nichts vermerken, Lauf endet mit `abgebrochen`
      if (this.stopped) throw new SyncStopped();
      if (codeOfToken(error)) throw error;
      if (error instanceof HttpError && error.code === 'moodle_file_not_found') return fail('nicht_gefunden');
      if (error instanceof HttpError && error.details?.reason === 'too_large') return fail('zu_gross');
      this.logger?.warn({ err: error, cmid: row.cmid }, 'Moodle-Datei nicht geladen');
      return fail('download_fehlgeschlagen');
    }
    if (this.stopped) {
      // Der Download war schon fertig, als gestoppt wurde: kein Material mehr anlegen
      await rm(stored.tmpPath, { force: true });
      throw new SyncStopped();
    }
    if (!stored.isPdf) {
      await rm(stored.tmpPath, { force: true });
      return fail('kein_pdf');
    }
    const upload: StoredUpload = {
      tmpPath: stored.tmpPath,
      size: stored.size,
      sha256: stored.sha256,
      filename: row.filename,
    };
    try {
      // Gespeichert wird unter der ID des Materials (08 §7). Der Moodle-Name dient nur als Titel
      const title = titleFromFilename(row.filename);
      const result =
        kind === 'folien'
          ? await createSlideDeck(this.db, this.dataDir, upload, { moduleId, title })
          : await createExerciseSheet(this.db, this.dataDir, upload, {
              moduleId,
              title,
              number: sheetNumber(row.filename) ?? sheetNumber(row.activityName) ?? undefined,
            });
      await this.db
        .update(moodleItem)
        .set({
          ...meta,
          sha256: stored.sha256,
          lastError: null,
          ...(kind === 'folien' ? { slideDeckId: result.id } : { exerciseSheetId: result.id }),
        })
        .where(eq(moodleItem.id, row.id));
      run.files_imported += 1;
    } finally {
      // Nach dem Anlegen ist die temporäre Datei verschoben, `rm` bleibt dann ohne Wirkung. Bei einer Dublette
      // (gleiche Datei schon im Modul) oder einem Fehler liegt sie noch da und wird hier entfernt
      await rm(stored.tmpPath, { force: true });
    }
  }

  // ---------- Fristen ----------

  /** Aufgaben mit Abgabedatum und kommende Kalenderereignisse der Kurse. Rückgabe: aktuelle Fristen */
  private async syncDeadlines(links: readonly LinkRow[]): Promise<number> {
    const moduleOf = new Map(links.map((link) => [link.moodleCourseId, link.moduleId]));
    const courseIds = [...moduleOf.keys()];
    const now = this.now();
    const assignments = (await this.moodle.reader.assignments()).items.filter((a) =>
      moduleOf.has(a.course_id),
    );
    const events = (await this.moodle.reader.deadlines(now, EVENT_LIMIT)).items;

    const withDue = assignments.filter((a): a is MoodleAssignment & { due_at: string } => a.due_at !== null);
    for (const assignment of withDue) {
      await this.upsertDeadline(
        {
          source: 'aufgabe',
          moodleAssignmentId: assignment.moodle_id,
          moodleEventId: null,
          cmid: assignment.cmid,
          name: assignment.name,
          dueAt: new Date(assignment.due_at),
          url: `${this.moodle.client.baseUrl}/mod/assign/view.php?id=${assignment.cmid}`,
        },
        assignment.course_id,
        moduleOf,
      );
    }
    // Aufgaben, die es nicht mehr gibt oder die kein Abgabedatum mehr haben
    await this.markRemoved(
      and(
        eq(moodleDeadline.source, 'aufgabe'),
        inArray(moodleDeadline.moodleCourseId, courseIds),
        withDue.length > 0
          ? notInArray(
              moodleDeadline.moodleAssignmentId,
              withDue.map((a) => a.moodle_id),
            )
          : undefined,
      ),
    );

    // Kalenderereignisse, außer denen zu einer schon übernommenen Aufgabe (gleiche cmid)
    const assignmentCmids = new Set(assignments.map((a) => a.cmid));
    const relevant = events.filter(
      (event): event is MoodleDeadline & { course_id: number } =>
        event.course_id !== null &&
        moduleOf.has(event.course_id) &&
        !(event.cmid !== null && assignmentCmids.has(event.cmid)),
    );
    for (const event of relevant) {
      await this.upsertDeadline(
        {
          source: 'termin',
          moodleAssignmentId: null,
          moodleEventId: event.event_id,
          cmid: event.cmid,
          name: event.name,
          dueAt: new Date(event.due_at),
          url: event.url,
        },
        event.course_id,
        moduleOf,
      );
    }
    // Kommende Ereignisse, die Moodle nicht mehr meldet. Bei vollen 50 nur bis zum letzten gemeldeten Datum
    const horizon = events.length >= EVENT_LIMIT ? events.at(-1)?.due_at : undefined;
    await this.markRemoved(
      and(
        eq(moodleDeadline.source, 'termin'),
        inArray(moodleDeadline.moodleCourseId, courseIds),
        gte(moodleDeadline.dueAt, now),
        horizon ? sql`${moodleDeadline.dueAt} <= ${new Date(horizon)}` : undefined,
        relevant.length > 0
          ? notInArray(
              moodleDeadline.moodleEventId,
              relevant.map((event) => event.event_id),
            )
          : undefined,
      ),
    );

    await this.matchSheets([...new Set(moduleOf.values())]);
    const [count] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(moodleDeadline)
      .where(
        and(
          inArray(moodleDeadline.moodleCourseId, courseIds),
          isNull(moodleDeadline.removedInMoodleAt),
          gte(moodleDeadline.dueAt, now),
        ),
      );
    return count?.n ?? 0;
  }

  private async upsertDeadline(
    values: Pick<
      typeof moodleDeadline.$inferInsert,
      'source' | 'moodleAssignmentId' | 'moodleEventId' | 'cmid' | 'name' | 'dueAt' | 'url'
    >,
    courseId: number,
    moduleOf: ReadonlyMap<number, string>,
  ): Promise<void> {
    const moduleId = moduleOf.get(courseId);
    if (!moduleId) return;
    const set = { ...values, moodleCourseId: courseId, moduleId, removedInMoodleAt: null };
    const byAssignment = values.moodleAssignmentId !== null;
    // Ändert sich das Abgabedatum, zieht ein verknüpftes Blatt mit, sofern es noch das alte Datum trägt
    const [before] = await this.db
      .select({ dueAt: moodleDeadline.dueAt, sheetId: moodleDeadline.exerciseSheetId })
      .from(moodleDeadline)
      .where(
        byAssignment
          ? eq(moodleDeadline.moodleAssignmentId, values.moodleAssignmentId as number)
          : eq(moodleDeadline.moodleEventId, values.moodleEventId as number),
      );
    await this.db
      .insert(moodleDeadline)
      .values({ id: uuidv7(), userId: SINGLE_USER_ID, ...set })
      .onConflictDoUpdate(
        byAssignment
          ? {
              target: moodleDeadline.moodleAssignmentId,
              targetWhere: sql`${moodleDeadline.moodleAssignmentId} IS NOT NULL`,
              set,
            }
          : {
              target: moodleDeadline.moodleEventId,
              targetWhere: sql`${moodleDeadline.moodleEventId} IS NOT NULL`,
              set,
            },
      );
    if (before?.sheetId && before.dueAt.getTime() !== values.dueAt.getTime()) {
      await this.db
        .update(exerciseSheet)
        .set({ dueAt: values.dueAt })
        .where(and(eq(exerciseSheet.id, before.sheetId), eq(exerciseSheet.dueAt, before.dueAt)));
    }
  }

  private async markRemoved(where: ReturnType<typeof and>): Promise<void> {
    await this.db
      .update(moodleDeadline)
      .set({ removedInMoodleAt: this.now() })
      .where(and(where, isNull(moodleDeadline.removedInMoodleAt)));
  }

  /**
   * Übungsblatt ↔ Moodle-Aufgabe (F-MDL-04 Schritt 3): Treffer über dieselbe Aktivität (Datei in der Aufgabe), sonst
   * über dieselbe Blattnummer bzw. denselben Namen im selben Modul. Nur eindeutige Treffer zählen. Das Blatt bekommt
   * das Abgabedatum, wenn es noch keins hat.
   */
  private async matchSheets(moduleIds: readonly string[]): Promise<void> {
    if (moduleIds.length === 0) return;
    const deadlines = await this.db
      .select()
      .from(moodleDeadline)
      .where(
        and(
          inArray(moodleDeadline.moduleId, [...moduleIds]),
          eq(moodleDeadline.source, 'aufgabe'),
          isNull(moodleDeadline.removedInMoodleAt),
        ),
      );
    const sheets = await this.db
      .select({
        id: exerciseSheet.id,
        moduleId: exerciseSheet.moduleId,
        title: exerciseSheet.title,
        number: exerciseSheet.number,
        dueAt: exerciseSheet.dueAt,
      })
      .from(exerciseSheet)
      .where(and(inArray(exerciseSheet.moduleId, [...moduleIds]), notDeleted(exerciseSheet)));
    if (deadlines.length === 0 || sheets.length === 0) return;
    const fromMoodle = await this.db
      .select({ sheetId: moodleItem.exerciseSheetId, cmid: moodleItem.cmid })
      .from(moodleItem)
      .where(
        inArray(
          moodleItem.exerciseSheetId,
          sheets.map((s) => s.id),
        ),
      );
    const taken = new Set(deadlines.map((d) => d.exerciseSheetId).filter((id): id is string => id !== null));
    const normalized = (text: string) => titleFromFilename(text).toLowerCase().replace(/\s+/g, ' ').trim();

    for (const deadline of deadlines) {
      if (deadline.exerciseSheetId) continue;
      const candidates = sheets.filter(
        (sheet) => sheet.moduleId === deadline.moduleId && !taken.has(sheet.id),
      );
      const sameActivity = candidates.filter((sheet) =>
        fromMoodle.some((item) => item.sheetId === sheet.id && item.cmid === deadline.cmid),
      );
      const number = sheetNumber(deadline.name);
      const sameNumber =
        number === null
          ? []
          : candidates.filter((sheet) => (sheet.number ?? sheetNumber(sheet.title)) === number);
      const sameName = candidates.filter((sheet) => normalized(sheet.title) === normalized(deadline.name));
      const match = [sameActivity, sameNumber, sameName].find((list) => list.length === 1)?.[0];
      if (!match) continue;
      taken.add(match.id);
      await this.db
        .update(moodleDeadline)
        .set({ exerciseSheetId: match.id })
        .where(eq(moodleDeadline.id, deadline.id));
      if (match.dueAt === null) {
        await this.db
          .update(exerciseSheet)
          .set({ dueAt: deadline.dueAt })
          .where(and(eq(exerciseSheet.id, match.id), isNull(exerciseSheet.dueAt)));
      }
    }
  }
}

function codeOfToken(error: unknown): boolean {
  return error instanceof HttpError && error.code === 'moodle_token_invalid';
}
