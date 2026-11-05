// T1-23: Kurszuordnung und Abgleich gegen ein nachgebautes Moodle (echter HTTP-Server) und eine echte Datenbank.
// Alle Kurse, Dateien und Namen sind erfunden.
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  MoodleCourseListSchema,
  MoodleItemListSchema,
  MoodleItemSchema,
  MoodleSyncedDeadlineListSchema,
  MoodleSyncStatusSchema,
  type Module,
  type MoodleItem,
  type Semester,
} from '@sg/shared';
import { exerciseSheet, job, moodleDeadline, moodleItem, slideDeck } from '../../src/db/schema/index.ts';
import { createMoodleServices, type MoodleServices } from '../../src/moodle/index.ts';
import { MoodleSync } from '../../src/moodle/sync.ts';
import { StaticTokenStore } from '../../src/moodle/token-store.ts';
import { createSlideDeck, uploadTmpDir } from '../../src/services/material.ts';
import { FakeMoodleServer, fileReply, unix } from '../unit/moodle-server.ts';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import { startTestApp, testDatabaseUrl, type TestApp } from './helpers.ts';

/** Erkennbar unechter Test-Token „0123…ef0123…ef“, ohne Literal gebaut (sonst schlägt gitleaks an, siehe .gitleaksignore) */
const TOKEN = Array.from({ length: 32 }, (_, i) => (i % 16).toString(16)).join('');
const NOW = new Date('2026-11-05T12:00:00Z');

const COURSE = { dbs: 901, org: 902, old: 903, stat: 904 };
const REF = {
  vl01: '/5001/mod_resource/content/1/VL01_Einfuehrung.pdf',
  blatt01: '/5002/mod_resource/content/1/Blatt01.pdf',
  skript: '/5003/mod_folder/content/1/Skript.pdf',
  notes: '/5003/mod_folder/content/1/notizen.txt',
  hidden: '/5004/mod_resource/content/1/VL02_versteckt.pdf',
  section: '/5006/mod_resource/content/1/VL03_Abschnitt.pdf',
  later: '/5003/mod_folder/content/1/Anhang.pdf',
  unlinked: '/6001/mod_resource/content/1/VL01_Statistik.pdf',
};

const pdf = (label: string) => Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`);
const sha = (body: Buffer) => createHash('sha256').update(body).digest('hex');

interface FakeFile {
  ref: string;
  name: string;
  mime: string;
  body: Buffer;
  modified: string;
}

function file(f: FakeFile, base: string) {
  return {
    type: 'file',
    filename: f.name,
    filepath: '/',
    filesize: f.body.length,
    fileurl: `${base}/webservice/pluginfile.php${f.ref}?forcedownload=1&token=${TOKEN}`,
    timemodified: unix(f.modified),
    mimetype: f.mime,
  };
}

/** Kursinhalt des erfundenen Kurses „Datenbanksysteme (Beispielkurs)“, veränderbar je Test */
interface CourseState {
  vl01: FakeFile;
  blatt01: FakeFile | null;
  folder: FakeFile[];
  hiddenFile: FakeFile;
  /** Abschnitt „Woche 3“ mit einer Folien-PDF, sichtbar oder versteckt */
  sectionFile: FakeFile;
  sectionVisible: boolean;
}

function initialState(): CourseState {
  return {
    vl01: {
      ref: REF.vl01,
      name: 'VL01_Einfuehrung.pdf',
      mime: 'application/pdf',
      body: pdf('vl01'),
      modified: '2026-10-20T10:00:00Z',
    },
    blatt01: {
      ref: REF.blatt01,
      name: 'Blatt01.pdf',
      mime: 'application/pdf',
      body: pdf('blatt01'),
      modified: '2026-10-21T10:00:00Z',
    },
    folder: [
      {
        ref: REF.skript,
        name: 'Skript.pdf',
        mime: 'application/pdf',
        body: pdf('skript'),
        modified: '2026-10-22T10:00:00Z',
      },
      {
        ref: REF.notes,
        name: 'notizen.txt',
        mime: 'text/plain',
        body: Buffer.from('nur Text'),
        modified: '2026-10-22T10:00:00Z',
      },
    ],
    sectionFile: {
      ref: REF.section,
      name: 'VL03_Abschnitt.pdf',
      mime: 'application/pdf',
      body: pdf('abschnitt'),
      modified: '2026-10-24T10:00:00Z',
    },
    sectionVisible: false,
    hiddenFile: {
      ref: REF.hidden,
      name: 'VL02_versteckt.pdf',
      mime: 'application/pdf',
      body: pdf('hidden'),
      modified: '2026-10-23T10:00:00Z',
    },
  };
}

let fake: FakeMoodleServer;
let state: CourseState;
let t: TestApp;
let moodle: MoodleServices;
let sync: MoodleSync;
let syncHandle: DbHandle;
let dbsModule: Module;
let statModule: Module;

function installFixtures(): void {
  const base = fake.baseUrl;
  fake.rest = {
    core_webservice_get_site_info: {
      sitename: 'Beispiel-Moodle',
      fullname: 'Erika Beispiel',
      userid: 42,
      functions: [],
    },
    core_enrol_get_users_courses: [
      {
        id: COURSE.dbs,
        shortname: 'DBS-DEMO',
        fullname: 'Datenbanksysteme (Beispielkurs)',
        startdate: unix('2026-10-01T00:00:00Z'),
        enddate: 0,
      },
      {
        id: COURSE.org,
        shortname: 'KT',
        fullname: 'Klausurtermine Beispielfakultät',
        startdate: unix('2026-10-01T00:00:00Z'),
        enddate: 0,
      },
      {
        id: COURSE.old,
        shortname: 'STAT-ALT',
        fullname: 'Statistik (Vorjahr)',
        startdate: unix('2025-10-01T00:00:00Z'),
        enddate: 0,
      },
      {
        id: COURSE.stat,
        shortname: 'STAT',
        fullname: 'Statistik',
        startdate: unix('2026-10-01T00:00:00Z'),
        enddate: 0,
      },
    ],
    core_course_get_contents: (params: URLSearchParams) => {
      const id = Number(params.get('courseid'));
      if (id === COURSE.stat) {
        return [
          {
            id: 20,
            name: 'Woche 1',
            visible: 1,
            section: 1,
            modules: [
              {
                id: 6001,
                name: 'Folien',
                modname: 'resource',
                visible: 1,
                contents: [
                  file(
                    {
                      ref: REF.unlinked,
                      name: 'VL01_Statistik.pdf',
                      mime: 'application/pdf',
                      body: pdf('stat'),
                      modified: '2026-10-20T10:00:00Z',
                    },
                    base,
                  ),
                ],
              },
            ],
          },
        ];
      }
      if (id !== COURSE.dbs) return [];
      const activities = [
        {
          id: 5001,
          name: 'Folien Woche 1',
          modname: 'resource',
          visible: 1,
          contents: [file(state.vl01, base)],
        },
        ...(state.blatt01
          ? [
              {
                id: 5002,
                name: 'Übung 1',
                modname: 'resource',
                visible: 1,
                contents: [file(state.blatt01, base)],
              },
            ]
          : []),
        {
          id: 5003,
          name: 'Material',
          modname: 'folder',
          visible: 1,
          contents: state.folder.map((f) => file(f, base)),
        },
        {
          id: 5004,
          name: 'Folien Woche 2',
          modname: 'resource',
          visible: 0,
          contents: [file(state.hiddenFile, base)],
        },
      ];
      return [
        { id: 10, name: 'Woche 1', visible: 1, section: 1, modules: activities },
        {
          id: 11,
          name: 'Woche 3',
          // Versteckter Abschnitt: die Aktivität selbst ist sichtbar, zählt aber nicht (F-MDL-04 Schritt 4)
          visible: state.sectionVisible ? 1 : 0,
          section: 3,
          modules: [
            {
              id: 5006,
              name: 'Folien Woche 3',
              modname: 'resource',
              visible: 1,
              contents: [file(state.sectionFile, base)],
            },
          ],
        },
      ];
    },
    mod_assign_get_assignments: {
      courses: [
        {
          id: COURSE.dbs,
          assignments: [
            {
              id: 701,
              cmid: 6101,
              course: COURSE.dbs,
              name: 'Abgabe Übungsblatt 1',
              duedate: unix('2026-11-12T22:59:00Z'),
              configs: [],
            },
            { id: 702, cmid: 6102, course: COURSE.dbs, name: 'Ohne Frist', duedate: 0, configs: [] },
          ],
        },
        {
          id: COURSE.stat,
          assignments: [
            {
              id: 703,
              cmid: 6201,
              course: COURSE.stat,
              name: 'Blatt 1',
              duedate: unix('2026-11-13T22:59:00Z'),
              configs: [],
            },
          ],
        },
      ],
    },
    core_calendar_get_action_events_by_timesort: {
      events: [
        // Dieselbe Aufgabe wie 701: kein zweiter Eintrag
        {
          id: 801,
          name: 'Abgabe Übungsblatt 1 ist fällig',
          courseid: COURSE.dbs,
          modulename: 'assign',
          timesort: unix('2026-11-12T22:59:00Z'),
          url: `${base}/mod/assign/view.php?id=6101`,
          action: { actionable: true },
        },
        {
          id: 802,
          name: 'Projektpräsentation',
          courseid: COURSE.dbs,
          modulename: 'quiz',
          timesort: unix('2026-11-20T09:00:00Z'),
          url: `${base}/mod/quiz/view.php?id=6103`,
          action: { actionable: false },
        },
        // Kurs ohne Zuordnung
        {
          id: 803,
          name: 'Fremde Frist',
          courseid: 999,
          modulename: 'assign',
          timesort: unix('2026-11-14T09:00:00Z'),
        },
      ],
    },
  };
  fake.files.clear();
  for (const f of [state.vl01, state.blatt01, ...state.folder, state.hiddenFile, state.sectionFile]) {
    if (f)
      fake.files.set(
        f.ref,
        fileReply({ body: f.body, contentType: f.mime, disposition: `attachment; filename="${f.name}"` }),
      );
  }
  fake.files.set(REF.unlinked, fileReply({ body: pdf('stat') }));
}

async function req<T>(method: 'GET' | 'PUT' | 'PATCH' | 'POST' | 'DELETE', url: string, payload?: object) {
  const res = await t.request({ method, url: `/api/v1${url}`, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: (res.body ? res.json() : null) as T };
}

const items = async (query = '') =>
  MoodleItemListSchema.parse((await req('GET', `/moodle/items${query}`)).body).items;
const itemByRef = async (ref: string): Promise<MoodleItem> => {
  const all = await items('?include_removed=true');
  const found = all.find((item) => item.file_ref === ref);
  if (!found) throw new Error(`kein Eintrag für ${ref}`);
  return found;
};

async function tableCounts() {
  const db = t.handle.db;
  const count = async (
    table: typeof slideDeck | typeof exerciseSheet | typeof moodleItem | typeof moodleDeadline | typeof job,
  ) => (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0]?.n ?? 0;
  return {
    decks: await count(slideDeck),
    sheets: await count(exerciseSheet),
    items: await count(moodleItem),
    deadlines: await count(moodleDeadline),
    jobs: await count(job),
  };
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

beforeAll(async () => {
  fake = await new FakeMoodleServer(TOKEN).start();
});

afterAll(async () => {
  await fake.stop();
  // Semester und Module wieder freigeben (weich gelöscht): die Test-Datenbank gilt für den ganzen Lauf
  if (dbsModule) {
    const handle = createDb(testDatabaseUrl());
    try {
      await handle.db.execute(
        sql`UPDATE module SET deleted_at = now() WHERE id IN (${dbsModule.id}, ${statModule.id})`,
      );
      await handle.db.execute(
        sql`UPDATE semester SET deleted_at = now(), is_current = false WHERE id = ${dbsModule.semester_id}`,
      );
    } finally {
      await handle.close();
    }
  }
});

async function start(): Promise<void> {
  state = initialState();
  installFixtures();
  fake.requests.length = 0;
  const dataDir = mkdtempSync(join(tmpdir(), 'sg-core-moodle-'));
  moodle = createMoodleServices({
    config: { moodleUrl: fake.baseUrl, dataDir },
    tokens: new StaticTokenStore(TOKEN),
    logger: pino({ level: 'silent' }),
    readMeta: async () => ({ token_valid_until: '2027-01-31' }),
    now: () => NOW,
    timeZone: 'Europe/Berlin',
    client: { minIntervalMs: 0, retryDelaysMs: [0, 0], timeoutMs: 2000 },
  });
  // Eigene Verbindung für den Abgleich: er überlebt einen Neustart der App (Test „nach einem Neustart“)
  syncHandle = createDb(testDatabaseUrl());
  sync = new MoodleSync({ db: syncHandle.db, dataDir, moodle, now: () => NOW });
  t = await startTestApp({ moodleUrl: fake.baseUrl, dataDir }, { moodle, moodleSync: sync, now: () => NOW });
  // Einmalig je Datenbank: Semester und Module (die Test-DB gilt für den ganzen Lauf)
  if (!dbsModule) {
    const semester = (
      await req<Semester>('POST', '/semesters', {
        name: 'WS 2026',
        starts_on: '2026-10-01',
        ends_on: '2027-03-31',
      })
    ).body;
    // Unser Semester ist das aktuelle: Vorschläge kommen nur aus dessen Modulen. Andere Testdateien lassen eigene
    // Semester und Module (auch „Datenbanksysteme“) in derselben Datenbank zurück
    expect((await req('PATCH', `/semesters/${semester.id}`, { is_current: true })).status).toBe(200);
    dbsModule = (
      await req<Module>('POST', '/modules', {
        semester_id: semester.id,
        name: 'Datenbanksysteme',
        short_name: 'DBS',
      })
    ).body;
    statModule = (await req<Module>('POST', '/modules', { semester_id: semester.id, name: 'Statistik' }))
      .body;
  }
}

async function cleanup(): Promise<void> {
  await sync.idle();
  const db = t.handle.db;
  await db.execute(sql`TRUNCATE moodle_item, moodle_deadline, moodle_course_link`);
  await db.execute(sql`DELETE FROM job`);
  await db.execute(sql`DELETE FROM slide_deck`);
  await db.execute(sql`DELETE FROM exercise_sheet`);
  await t.close();
  await syncHandle.close();
}

async function linkDbs(): Promise<void> {
  const res = await req('PUT', `/moodle/links/${COURSE.dbs}`, { module_id: dbsModule.id });
  expect(res.status).toBe(200);
  await sync.idle();
}

describe('Moodle-Abgleich (T1-23)', () => {
  afterEach(cleanup);

  it('schlägt Module vor: aktuelle Kurse ja, organisatorische und alte nicht (F-MDL-03)', async () => {
    await start();
    const res = await req('GET', '/moodle/courses');
    expect(res.status).toBe(200);
    const courses = MoodleCourseListSchema.parse(res.body).items;
    const byId = new Map(courses.map((c) => [c.moodle_id, c]));
    expect(byId.get(COURSE.dbs)).toMatchObject({
      category: 'aktuell',
      suggested_module_id: dbsModule.id,
      module_id: null,
    });
    expect(byId.get(COURSE.stat)).toMatchObject({ category: 'aktuell', suggested_module_id: statModule.id });
    expect(byId.get(COURSE.org)).toMatchObject({ category: 'organisatorisch', suggested_module_id: null });
    expect(byId.get(COURSE.old)).toMatchObject({ category: 'alt', suggested_module_id: null });

    // Ein Vorschlag ist noch keine Zuordnung: ohne Bestätigung wird nichts abgeglichen
    await sync.run('manuell');
    expect(fake.calls('core_course_get_contents')).toHaveLength(0);
    expect((await tableCounts()).items).toBe(0);

    // Nach der Bestätigung: module_id statt Vorschlag
    await linkDbs();
    const after = MoodleCourseListSchema.parse((await req('GET', '/moodle/courses')).body).items;
    expect(after.find((c) => c.moodle_id === COURSE.dbs)).toMatchObject({
      module_id: dbsModule.id,
      suggested_module_id: null,
    });
  });

  it('übernimmt Folien und Übungen ins richtige Modul, Unklares in die Inbox, Fristen in die App', async () => {
    await start();
    fake.requests.length = 0;
    await linkDbs();
    // Nur der zugeordnete Kurs wird gelesen
    expect(fake.calls('core_course_get_contents').map((r) => r.params.get('courseid'))).toEqual([
      String(COURSE.dbs),
    ]);

    const vl = await itemByRef(REF.vl01);
    expect(vl).toMatchObject({
      kind: 'folien',
      module_id: dbsModule.id,
      removed_in_moodle_at: null,
      last_error: null,
    });
    const blatt = await itemByRef(REF.blatt01);
    expect(blatt).toMatchObject({ kind: 'uebung' });
    expect(await itemByRef(REF.skript)).toMatchObject({
      kind: 'offen',
      slide_deck_id: null,
      exercise_sheet_id: null,
    });
    expect(await itemByRef(REF.notes)).toMatchObject({ kind: 'ignoriert', is_pdf: false });
    // Versteckte Aktivität: nicht übernommen
    await expect(itemByRef(REF.hidden)).rejects.toThrow();

    const db = t.handle.db;
    const [deck] = await db
      .select()
      .from(slideDeck)
      .where(eq(slideDeck.id, vl.slide_deck_id ?? ''));
    expect(deck).toMatchObject({
      moduleId: dbsModule.id,
      title: 'VL01_Einfuehrung',
      sha256: sha(state.vl01.body),
    });
    const [sheet] = await db
      .select()
      .from(exerciseSheet)
      .where(eq(exerciseSheet.id, blatt.exercise_sheet_id ?? ''));
    expect(sheet).toMatchObject({ moduleId: dbsModule.id, number: 1 });
    // Abgabedatum der passenden Moodle-Aufgabe („Abgabe Übungsblatt 1“ ↔ Blatt 01)
    expect(sheet?.dueAt?.toISOString()).toBe('2026-11-12T22:59:00.000Z');

    // pdf.ingest für beide, wie beim Upload
    const jobs = await db.select({ type: job.type, payload: job.payload }).from(job);
    expect(jobs.map((j) => j.payload).sort()).toEqual(
      [{ slide_deck_id: deck?.id }, { exercise_sheet_id: sheet?.id }].sort(),
    );
    expect(jobs.every((j) => j.type === 'pdf.ingest')).toBe(true);

    // Inbox: genau die unklare Datei
    expect((await items('?kind=offen')).map((i) => i.file_ref)).toEqual([REF.skript]);

    // Fristen: Aufgabe und Termin, ohne Dublette zur Aufgabe und ohne fremde Kurse
    const deadlines = MoodleSyncedDeadlineListSchema.parse(
      (await req('GET', `/moodle/synced-deadlines?module_id=${dbsModule.id}`)).body,
    ).items;
    expect(deadlines.map((d) => [d.source, d.name, d.due_at])).toEqual([
      ['aufgabe', 'Abgabe Übungsblatt 1', '2026-11-12T22:59:00Z'],
      ['termin', 'Projektpräsentation', '2026-11-20T09:00:00Z'],
    ]);
    expect(deadlines[0]?.exercise_sheet_id).toBe(sheet?.id);

    const status = MoodleSyncStatusSchema.parse((await req('GET', '/moodle/sync')).body);
    expect(status).toMatchObject({ state: 'bereit', connection: 'ok' });
    expect(status.last_run).toMatchObject({
      ok: true,
      courses: 1,
      files_new: 4,
      files_imported: 2,
      inbox_new: 1,
      deadlines: 2,
    });
  });

  it('ist idempotent: ein zweiter Abgleich ohne Änderungen lädt nichts und legt nichts doppelt an', async () => {
    await start();
    await linkDbs();
    const before = await tableCounts();
    const downloads = fake.calls('pluginfile').length;
    expect(downloads).toBe(2);

    const second = await sync.run('manuell');
    expect(second).toMatchObject({ ok: true, files_new: 0, files_changed: 0, files_imported: 0 });
    await sync.run('zeitplan');
    expect(fake.calls('pluginfile')).toHaveLength(downloads);
    expect(await tableCounts()).toEqual(before);
  });

  it('verknüpft eine schon per Hand hochgeladene Datei statt sie zu kopieren (sha256)', async () => {
    await start();
    const tmpDir = uploadTmpDir(t.config.dataDir);
    await mkdir(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, 'hand.upload');
    await writeFile(tmpPath, state.vl01.body);
    const manual = await createSlideDeck(
      t.handle.db,
      t.config.dataDir,
      {
        tmpPath,
        size: state.vl01.body.length,
        sha256: sha(state.vl01.body),
        filename: 'meine-folien.pdf',
      },
      { moduleId: dbsModule.id },
    );

    await linkDbs();
    expect((await itemByRef(REF.vl01)).slide_deck_id).toBe(manual.id);
    expect((await tableCounts()).decks).toBe(1);
  });

  it('speichert über IDs, nie unter dem Moodle-Namen', async () => {
    await start();
    state.vl01 = { ...state.vl01, name: '..%2F..%2Fboese Folien VL.pdf' };
    installFixtures();
    await linkDbs();
    const vl = await itemByRef(REF.vl01);
    const [deck] = await t.handle.db
      .select()
      .from(slideDeck)
      .where(eq(slideDeck.id, vl.slide_deck_id ?? ''));
    expect(deck?.filePath).toBe(`media/decks/${deck?.id}/original.pdf`);
    expect(await readFile(join(t.config.dataDir, deck?.filePath ?? ''))).toEqual(state.vl01.body);
    // Kein Dateiname im Datenordner stammt aus Moodle
    const names = (await listFiles(t.config.dataDir)).map((path) => path.slice(t.config.dataDir.length));
    expect(names.filter((name) => /VL01|Blatt01|boese|Einfuehrung/i.test(name))).toEqual([]);
  });

  it('Entscheidung in der Inbox gilt für die ganze Aktivität, auch für spätere Dateien', async () => {
    await start();
    await linkDbs();
    const skript = await itemByRef(REF.skript);
    const res = await req('PATCH', `/moodle/items/${skript.id}`, { kind: 'folien' });
    expect(res.status).toBe(200);
    expect(MoodleItemSchema.parse(res.body)).toMatchObject({ kind: 'folien', kind_source: 'manuell' });
    await sync.idle();
    const decided = await itemByRef(REF.skript);
    expect(decided.slide_deck_id).not.toBeNull();

    // Neue Datei in derselben Aktivität „Material“: ohne Rückfrage als Folien
    state.folder.push({
      ref: REF.later,
      name: 'Anhang.pdf',
      mime: 'application/pdf',
      body: pdf('anhang'),
      modified: '2026-10-30T10:00:00Z',
    });
    installFixtures();
    const run = await sync.run('manuell');
    expect(run).toMatchObject({ files_new: 1, inbox_new: 0, files_imported: 1 });
    expect(await itemByRef(REF.later)).toMatchObject({ kind: 'folien', kind_source: 'auto' });

    // Unbekanntes Ziel und ungültige Art
    expect(
      (await req('PATCH', `/moodle/items/0190f6a2-0000-7000-8000-00000000dead`, { kind: 'uebung' })).status,
    ).toBe(404);
    expect((await req('PATCH', `/moodle/items/${skript.id}`, { kind: 'entfernt' })).status).toBe(400);
  });

  it('neue Fassung: neuer Foliensatz, der alte bleibt. Entfernt: nur markiert, nie gelöscht', async () => {
    await start();
    await linkDbs();
    const first = await itemByRef(REF.vl01);
    const blatt = await itemByRef(REF.blatt01);

    state.vl01 = { ...state.vl01, body: pdf('vl01 neu'), modified: '2026-10-28T10:00:00Z' };
    state.blatt01 = null;
    installFixtures();
    const run = await sync.run('manuell');
    expect(run).toMatchObject({ files_changed: 1, files_imported: 1 });

    const second = await itemByRef(REF.vl01);
    expect(second.slide_deck_id).not.toBe(first.slide_deck_id);
    expect(second.modified_at).toBe('2026-10-28T10:00:00Z');
    const decks = await t.handle.db.select().from(slideDeck);
    expect(decks.map((d) => d.id).sort()).toEqual([first.slide_deck_id, second.slide_deck_id].sort());

    const removed = await itemByRef(REF.blatt01);
    expect(removed.removed_in_moodle_at).not.toBeNull();
    expect(removed.exercise_sheet_id).toBe(blatt.exercise_sheet_id);
    const [sheet] = await t.handle.db
      .select()
      .from(exerciseSheet)
      .where(eq(exerciseSheet.id, blatt.exercise_sheet_id ?? ''));
    expect(sheet?.deletedAt).toBeNull();
    // Standardliste ohne entfernte Dateien
    expect((await items()).map((i) => i.file_ref)).not.toContain(REF.blatt01);
  });

  it('liefert bekannte Dateien auch nach einem Neustart (moodle_item.file_ref, Lead #127)', async () => {
    await start();
    await linkDbs();
    // Frische Dienste: leere Registry im Speicher
    const fresh = createMoodleServices({
      config: { moodleUrl: fake.baseUrl, dataDir: t.config.dataDir },
      tokens: new StaticTokenStore(TOKEN),
      logger: pino({ level: 'silent' }),
      readMeta: async () => ({ token_valid_until: '2027-01-31' }),
      client: { minIntervalMs: 0, retryDelaysMs: [0, 0], timeoutMs: 2000 },
    });
    await t.close();
    t = await startTestApp(
      { moodleUrl: fake.baseUrl, dataDir: t.config.dataDir },
      { moodle: fresh, moodleSync: sync, now: () => NOW },
    );
    const ok = await t.request({
      method: 'GET',
      url: `/api/v1/moodle/file?ref=${encodeURIComponent(REF.vl01)}`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.rawPayload).toEqual(state.vl01.body);
    // Nicht abgeglichen und nie ausgegeben: weiterhin unbekannt
    const unknown = await t.request({
      method: 'GET',
      url: `/api/v1/moodle/file?ref=${encodeURIComponent(REF.unlinked)}`,
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('pausiert bei abgelehntem Token statt Fehler zu sammeln (F-MDL-01)', async () => {
    await start();
    await linkDbs();
    fake.tokenValid = false;
    try {
      moodle.status.invalidate();
      const run = await sync.run('manuell');
      expect(run).toMatchObject({ ok: false, error_code: 'moodle_token_invalid', courses: 0 });
      const status = MoodleSyncStatusSchema.parse((await req('GET', '/moodle/sync')).body);
      expect(status.state).toBe('pausiert');
    } finally {
      fake.tokenValid = true;
      moodle.status.invalidate();
    }
  });

  it('Zuordnung ändern, aus- und lösen', async () => {
    await start();
    await linkDbs();
    // Abgleich aus: der Kurs wird nicht mehr gelesen
    expect(
      (await req('PUT', `/moodle/links/${COURSE.dbs}`, { module_id: dbsModule.id, sync_enabled: false }))
        .status,
    ).toBe(200);
    fake.requests.length = 0;
    await sync.run('manuell');
    expect(fake.calls('core_course_get_contents')).toHaveLength(0);

    // Unbekanntes Modul
    const missing = await req('PUT', `/moodle/links/${COURSE.dbs}`, {
      module_id: '0190f6a2-0000-7000-8000-00000000beef',
    });
    expect(missing.status).toBe(404);

    // Lösen: Fristen weg, Material bleibt
    expect((await req('DELETE', `/moodle/links/${COURSE.dbs}`)).status).toBe(204);
    expect((await req('DELETE', `/moodle/links/${COURSE.dbs}`)).status).toBe(404);
    expect((await tableCounts()).deadlines).toBe(0);
    expect((await tableCounts()).decks).toBe(1);
  });

  it('„Jetzt abgleichen“ antwortet sofort mit 202', async () => {
    await start();
    await linkDbs();
    const res = await req('POST', '/moodle/sync', {});
    expect(res.status).toBe(202);
    expect(MoodleSyncStatusSchema.parse(res.body).state).toMatch(/laeuft|bereit/);
    await sync.idle();
    expect(MoodleSyncStatusSchema.parse((await req('GET', '/moodle/sync')).body).last_run?.trigger).toBe(
      'manuell',
    );
  });

  it('versteckter Abschnitt zählt nicht; wieder sichtbar bzw. wieder da hebt die Markierung auf (Review H1)', async () => {
    await start();
    await linkDbs();
    // Abschnitt versteckt: Datei weder gelistet noch geladen
    await expect(itemByRef(REF.section)).rejects.toThrow();
    expect(fake.calls('pluginfile').map((r) => r.path)).not.toContain(
      `/webservice/pluginfile.php${REF.section}`,
    );

    // Abschnitt sichtbar: wird übernommen
    state.sectionVisible = true;
    installFixtures();
    await sync.run('manuell');
    expect(await itemByRef(REF.section)).toMatchObject({ kind: 'folien', removed_in_moodle_at: null });

    // Wieder versteckt: nur markiert
    state.sectionVisible = false;
    installFixtures();
    await sync.run('manuell');
    const hidden = await itemByRef(REF.section);
    expect(hidden.removed_in_moodle_at).not.toBeNull();
    expect(hidden.slide_deck_id).not.toBeNull();

    // Wieder sichtbar und eine gelöschte Datei wieder da: Markierung weg, nichts doppelt
    state.sectionVisible = true;
    const blatt = state.blatt01;
    state.blatt01 = null;
    installFixtures();
    await sync.run('manuell');
    expect((await itemByRef(REF.blatt01)).removed_in_moodle_at).not.toBeNull();
    state.blatt01 = blatt;
    installFixtures();
    const before = await tableCounts();
    const run = await sync.run('manuell');
    expect(run).toMatchObject({ files_new: 0, files_imported: 0 });
    expect((await itemByRef(REF.section)).removed_in_moodle_at).toBeNull();
    expect((await itemByRef(REF.blatt01)).removed_in_moodle_at).toBeNull();
    expect(await tableCounts()).toEqual(before);
  });

  it('schreibt beim zweiten Abgleich ohne Änderungen keine Datei-Zeile neu (Review S5)', async () => {
    await start();
    await linkDbs();
    const stamps = async () =>
      (await t.handle.db.select({ id: moodleItem.id, updatedAt: moodleItem.updatedAt }).from(moodleItem))
        .map((row) => `${row.id}:${row.updatedAt.toISOString()}`)
        .sort();
    const before = await stamps();
    await new Promise((r) => setTimeout(r, 20));
    await sync.run('manuell');
    expect(await stamps()).toEqual(before);
  });

  it('kein PDF: nur gelistet; eine neue Fassung wird neu geprüft (Review H5)', async () => {
    await start();
    const fakePdf = {
      ref: '/5003/mod_folder/content/1/Folien_Kapitel4.pdf',
      name: 'Folien_Kapitel4.pdf',
      mime: 'application/pdf',
      body: Buffer.from('<html>kein PDF</html>'),
      modified: '2026-10-25T10:00:00Z',
    };
    state.folder.push(fakePdf);
    installFixtures();
    await linkDbs();
    expect(await itemByRef(fakePdf.ref)).toMatchObject({ kind: 'ignoriert', last_error: 'kein_pdf' });
    const downloads = fake.calls('pluginfile').length;

    // Unverändert: nicht erneut laden
    await sync.run('manuell');
    expect(fake.calls('pluginfile')).toHaveLength(downloads);

    // Neue Fassung, jetzt ein echtes PDF
    state.folder[state.folder.length - 1] = {
      ...fakePdf,
      body: pdf('kapitel4'),
      modified: '2026-10-29T10:00:00Z',
    };
    installFixtures();
    const run = await sync.run('manuell');
    expect(run).toMatchObject({ files_changed: 1, files_imported: 1 });
    const item = await itemByRef(fakePdf.ref);
    expect(item).toMatchObject({ kind: 'folien', last_error: null, modified_at: '2026-10-29T10:00:00Z' });
    expect(item.slide_deck_id).not.toBeNull();
  });

  it('Inbox, Dateien und Fristen nur aus zugeordneten Kursen mit Abgleich an (Review S4, H7, H6)', async () => {
    await start();
    await linkDbs();
    expect((await items()).length).toBeGreaterThan(0);
    const deadlinesOf = async () =>
      MoodleSyncedDeadlineListSchema.parse((await req('GET', '/moodle/synced-deadlines')).body).items;
    expect(await deadlinesOf()).toHaveLength(2);
    expect(await items('?limit=1')).toHaveLength(1);

    await req('PUT', `/moodle/links/${COURSE.dbs}`, { module_id: dbsModule.id, sync_enabled: false });
    expect(await items()).toEqual([]);
    expect(await items('?kind=offen')).toEqual([]);
    expect(await deadlinesOf()).toEqual([]);
    // Die Zeilen bleiben erhalten und sind nach dem Einschalten wieder da
    await req('PUT', `/moodle/links/${COURSE.dbs}`, { module_id: dbsModule.id, sync_enabled: true });
    await sync.idle();
    expect((await items('?kind=offen')).map((i) => i.file_ref)).toEqual([REF.skript]);

    // „Jetzt abgleichen“ für einen nicht zugeordneten Kurs
    const missing = await req<{ error: { code: string } }>('POST', '/moodle/sync', {
      course_id: COURSE.stat,
    });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('moodle_link_not_found');
    expect((await req('POST', '/moodle/sync', { course_id: COURSE.dbs })).status).toBe(202);
  });

  it('Beenden während eines Abgleichs: bricht zwischen zwei Dateien ab und wartet nicht lange (Review S3)', async () => {
    await start();
    // Jede Datei braucht 300 ms
    const slow = Array.from({ length: 8 }, (_, i) => ({
      ref: `/5003/mod_folder/content/1/VL1${i}_Langsam.pdf`,
      name: `VL1${i}_Langsam.pdf`,
      mime: 'application/pdf',
      body: pdf(`langsam ${i}`),
      modified: '2026-10-26T10:00:00Z',
    }));
    state.folder.push(...slow);
    installFixtures();
    for (const f of slow) {
      const reply = fileReply({ body: f.body });
      fake.files.set(f.ref, async (res, req) => {
        await new Promise((r) => setTimeout(r, 300));
        await reply(res, req);
      });
    }
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const res = await req('PUT', `/moodle/links/${COURSE.dbs}`, { module_id: dbsModule.id });
      expect(res.status).toBe(200);
      // Warten, bis die erste langsame Datei angefragt ist
      while (!fake.calls('pluginfile').some((r) => r.path.includes('Langsam'))) {
        await new Promise((r) => setTimeout(r, 10));
      }
      const before = Date.now();
      await t.close();
      expect(Date.now() - before).toBeLessThan(3_000);
      const status = await sync.status();
      expect(status.last_run).toMatchObject({ ok: false, error_code: 'abgebrochen' });
      expect(status.last_run?.files_imported ?? 0).toBeLessThan(10);
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toEqual([]);
      expect(process.exitCode ?? 0).toBe(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      // Für das Aufräumen eine frische App auf derselben Datenbank
      t = await startTestApp(
        { moodleUrl: fake.baseUrl, dataDir: t.config.dataDir },
        { moodle, now: () => NOW },
      );
    }
  });

  it('stop() bricht einen laufenden Download sofort ab: kein Material, keine Restdatei (Issue #129)', async () => {
    await start();
    // Die erste Datei liefert ein paar Byte und bleibt dann stehen (Leerlauf-Zeitlimit 30 s, nicht abgewartet)
    let upstreamClosed = false;
    let firstBytesSent = false;
    fake.files.set(REF.vl01, (res) => {
      res.on('close', () => (upstreamClosed = true));
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': 1_000_000 });
      res.write(Buffer.from('%PDF-1.4\n'));
      firstBytesSent = true;
    });
    const before = await tableCounts();
    expect((await req('PUT', `/moodle/links/${COURSE.dbs}`, { module_id: dbsModule.id })).status).toBe(200);
    while (!firstBytesSent) await new Promise((r) => setTimeout(r, 10));
    // Der Download läuft, der Abgleich hängt in dieser Datei
    expect((await sync.status()).state).toBe('laeuft');

    const started = Date.now();
    await sync.stop(10_000);
    // Weit unter der Wartezeit von 10 s und dem Leerlauf-Zeitlimit von 30 s
    expect(Date.now() - started).toBeLessThan(2_000);
    expect((await sync.status()).state).not.toBe('laeuft');
    expect((await sync.status()).last_run).toMatchObject({ ok: false, error_code: 'abgebrochen' });

    const after = await tableCounts();
    expect([after.decks, after.sheets, after.jobs]).toEqual([before.decks, before.sheets, before.jobs]);
    // Auch nicht als fehlgeschlagen vermerkt: ein neuer Abgleich versucht die Datei wieder
    expect((await itemByRef(REF.vl01)).last_error).toBeNull();
    // Moodle-Verbindung ist zu, und im temporären Ordner liegt nichts
    for (let i = 0; i < 100 && !upstreamClosed; i += 1) await new Promise((r) => setTimeout(r, 10));
    expect(upstreamClosed).toBe(true);
    expect(await listFiles(uploadTmpDir(t.config.dataDir)).catch(() => [])).toEqual([]);
  });

  it('stop() genau nach dem Ende des Downloads: kein Material, keine Restdatei (Issue #129, Wettlauf)', async () => {
    await start();
    // Der Download ist vollständig und der Abbruch-Listener des Clients schon weg, wenn stop() kommt:
    // Das Signal kann den Stream nicht mehr treffen, nur die Prüfung nach storeDownload fängt es ab.
    const original = moodle.client.downloadFile.bind(moodle.client);
    let stops = 0;
    moodle.client.downloadFile = async (ref, options) => {
      const real = await original(ref, options);
      const chunks: Buffer[] = [];
      for await (const chunk of real.stream) chunks.push(Buffer.from(chunk as Uint8Array));
      const stream = Readable.from([Buffer.concat(chunks)]);
      // 'end' kommt vor dem Abschluss der Pipeline in storeDownload
      stream.once('end', () => {
        stops += 1;
        void sync.stop();
      });
      return { ...real, stream };
    };
    const before = await tableCounts();
    expect((await req('PUT', `/moodle/links/${COURSE.dbs}`, { module_id: dbsModule.id })).status).toBe(200);
    await sync.idle();
    expect(stops).toBe(1);
    expect((await sync.status()).last_run).toMatchObject({ ok: false, error_code: 'abgebrochen' });
    const after = await tableCounts();
    expect([after.decks, after.sheets, after.jobs]).toEqual([before.decks, before.sheets, before.jobs]);
    expect((await itemByRef(REF.vl01)).last_error).toBeNull();
    expect(await listFiles(uploadTmpDir(t.config.dataDir)).catch(() => [])).toEqual([]);
  });

  it('„Jetzt abgleichen“ für einen ausgeschalteten Kurs → 409 moodle_link_disabled (Issue #129)', async () => {
    await start();
    await linkDbs();
    await req('PUT', `/moodle/links/${COURSE.dbs}`, { module_id: dbsModule.id, sync_enabled: false });
    const requestsBefore = fake.requests.length;
    const disabled = await req<{ error: { code: string } }>('POST', '/moodle/sync', {
      course_id: COURSE.dbs,
    });
    expect(disabled.status).toBe(409);
    expect(disabled.body.error.code).toBe('moodle_link_disabled');
    // Es wurde nichts angestoßen
    await sync.idle();
    expect(fake.requests.length).toBe(requestsBefore);
    // Ein Gesamtabgleich ohne Kurs bleibt erlaubt, wieder eingeschaltet geht auch der Kurs
    expect((await req('POST', '/moodle/sync', {})).status).toBe(202);
    await req('PUT', `/moodle/links/${COURSE.dbs}`, { module_id: dbsModule.id, sync_enabled: true });
    await sync.idle();
    expect((await req('POST', '/moodle/sync', { course_id: COURSE.dbs })).status).toBe(202);
  });

  it('„Ignorieren“ lässt sich rückgängig machen: zurück auf offen, ohne Abgleich (Review #134, M2)', async () => {
    await start();
    state.folder.push({
      ref: REF.later,
      name: 'Anhang.pdf',
      mime: 'application/pdf',
      body: pdf('anhang'),
      modified: '2026-10-30T10:00:00Z',
    });
    installFixtures();
    await linkDbs();
    expect((await items('?kind=offen')).map((i) => i.file_ref).sort()).toEqual(
      [REF.later, REF.skript].sort(),
    );
    const skript = await itemByRef(REF.skript);
    expect((await req('PATCH', `/moodle/items/${skript.id}`, { kind: 'ignoriert' })).status).toBe(200);
    // Dieselbe Entscheidung hat auch „Anhang“ (gleiche Aktivität) erfasst
    expect(await items('?kind=offen')).toEqual([]);
    fake.requests.length = 0;

    const undo = await req('PATCH', `/moodle/items/${skript.id}`, { kind: 'offen' });
    expect(undo.status).toBe(200);
    expect(MoodleItemSchema.parse(undo.body)).toMatchObject({ kind: 'offen', kind_source: 'auto' });
    expect((await items('?kind=offen')).map((i) => i.file_ref).sort()).toEqual(
      [REF.later, REF.skript].sort(),
    );
    // Rückgängig startet keinen Abgleich und lädt nichts
    await sync.idle();
    expect(fake.calls('core_course_get_contents')).toHaveLength(0);
    // Ohne manuelle Entscheidung gilt für die Aktivität wieder die Regel: neue Dateien landen in der Inbox
    state.folder.push({
      ref: '/5003/mod_folder/content/1/Notiz2.pdf',
      name: 'Notiz2.pdf',
      mime: 'application/pdf',
      body: pdf('notiz2'),
      modified: '2026-10-31T10:00:00Z',
    });
    installFixtures();
    expect(await sync.run('manuell')).toMatchObject({ files_new: 1, inbox_new: 1 });
  });
});
