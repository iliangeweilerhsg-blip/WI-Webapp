// #141: Module automatisch aus Moodle-Kursen anlegen und zuordnen, gegen ein nachgebautes Moodle (echter HTTP-Server)
// und eine echte Datenbank. Die Kursnamen sind dem Screenshot des Owners nachgebaut, Kurs-IDs, Kürzel und alle
// übrigen Angaben sind erfunden. Keine echten Personen.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  MoodleAutoAssignResultSchema,
  MoodleCourseLinkListSchema,
  MoodleCourseListSchema,
  SINGLE_USER_ID,
  type Module,
  type MoodleCourse,
  type MoodleCourseLink,
  type Semester,
} from '@sg/shared';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import { autoAssignCourses } from '../../src/moodle/auto.ts';
import { createMoodleServices, type MoodleServices } from '../../src/moodle/index.ts';
import { MoodleSync } from '../../src/moodle/sync.ts';
import { StaticTokenStore } from '../../src/moodle/token-store.ts';
import { FakeMoodleServer, fileReply, unix } from '../unit/moodle-server.ts';
import { startTestApp, testDatabaseUrl, type TestApp } from './helpers.ts';

/** Erkennbar unechter Test-Token, ohne Literal gebaut (gitleaks, siehe moodle-sync.test.ts) */
const TOKEN = Array.from({ length: 32 }, (_, i) => ((i + 3) % 16).toString(16)).join('');
const NOW = new Date('2026-11-05T12:00:00Z');
const START = '2026-09-14T00:00:00Z';

const C = {
  marketing: 2001,
  programmierung: 2002,
  mathe: 2003,
  bwl: 2004,
  wi: 2005,
  praktikum: 2006,
  pruefungsamt: 2007,
  alt: 2008,
  mehrdeutig: 2009,
  stufe: 2010,
};

interface FakeCourse {
  id: number;
  fullname: string;
  shortname: string;
  startdate?: string;
}

/** Die sechs Kurse aus dem Screenshot plus ein organisatorischer und ein alter Kurs */
const SCREENSHOT: FakeCourse[] = [
  { id: C.marketing, fullname: 'Einführung in das Marketing WiSe 26/27', shortname: 'EiM-WS2627' },
  { id: C.programmierung, fullname: 'Grundlagen der Programmierung 26/27', shortname: 'GdP-2627' },
  {
    id: C.mathe,
    fullname: 'Mathematik für Wirtschaftinformatik WiSe 2026/27',
    shortname: 'MathWI WS26/27',
  },
  { id: C.bwl, fullname: 'BMBWL110_Einfuehrung_in_die_Betriebswirtschaftslehre', shortname: 'BMBWL110' },
  { id: C.wi, fullname: 'Einführung in die Wirtschaftsinformatik WiSe 26/27', shortname: 'EWI WS26/27' },
  { id: C.praktikum, fullname: 'Betriebspraktikum Wirtschaftswissenschaften', shortname: 'BPWW' },
  { id: C.pruefungsamt, fullname: 'Prüfungsamt – Informationen für Studierende', shortname: 'PA-INFO' },
  { id: C.alt, fullname: 'Statistik WiSe 25/26', shortname: 'STAT-2526', startdate: '2025-10-01T00:00:00Z' },
];

const EXPECTED_NEW = [
  'Einführung in das Marketing',
  'Grundlagen der Programmierung',
  // Der Tippfehler kommt aus Moodle und bleibt
  'Mathematik für Wirtschaftinformatik',
  'Einführung in die Betriebswirtschaftslehre',
  'Betriebspraktikum Wirtschaftswissenschaften',
];

const pdfBody = Buffer.from('%PDF-1.4\n% marketing\n%%EOF\n');
const PDF_REF = '/7001/mod_resource/content/1/VL01_Marketing.pdf';

let fake: FakeMoodleServer;
let courses: FakeCourse[];
let t: TestApp;
let moodle: MoodleServices;
let sync: MoodleSync;
let syncHandle: DbHandle;
let semester: Semester;
let wiModule: Module;

function installFixtures(): void {
  const base = fake.baseUrl;
  fake.rest = {
    core_webservice_get_site_info: {
      sitename: 'Beispiel-Moodle',
      fullname: 'Erika Beispiel',
      userid: 42,
      functions: [],
    },
    core_enrol_get_users_courses: () =>
      courses.map((course) => ({
        id: course.id,
        shortname: course.shortname,
        fullname: course.fullname,
        startdate: unix(course.startdate ?? START),
        enddate: 0,
      })),
    // Nur das Marketing hat eine Folien-PDF (übernommenes Material zählt nicht als Inhalt)
    core_course_get_contents: (params: URLSearchParams) =>
      Number(params.get('courseid')) === C.marketing
        ? [
            {
              id: 70,
              name: 'Woche 1',
              visible: 1,
              section: 1,
              modules: [
                {
                  id: 7001,
                  name: 'Vorlesung 1',
                  modname: 'resource',
                  visible: 1,
                  contents: [
                    {
                      type: 'file',
                      filename: 'VL01_Marketing.pdf',
                      filepath: '/',
                      filesize: pdfBody.length,
                      fileurl: `${base}/webservice/pluginfile.php${PDF_REF}?forcedownload=1&token=${TOKEN}`,
                      timemodified: unix('2026-10-20T10:00:00Z'),
                      mimetype: 'application/pdf',
                    },
                  ],
                },
              ],
            },
          ]
        : [],
    mod_assign_get_assignments: { courses: [] },
    core_calendar_get_action_events_by_timesort: { events: [] },
  };
  fake.files.clear();
  fake.files.set(PDF_REF, fileReply({ body: pdfBody }));
}

async function req<T>(method: 'GET' | 'PUT' | 'PATCH' | 'POST' | 'DELETE', url: string, payload?: object) {
  const res = await t.request({ method, url: `/api/v1${url}`, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: (res.body ? res.json() : null) as T };
}

const listCourses = async (): Promise<Map<number, MoodleCourse>> => {
  const res = await req('GET', '/moodle/courses');
  expect(res.status).toBe(200);
  return new Map(MoodleCourseListSchema.parse(res.body).items.map((course) => [course.moodle_id, course]));
};
const listLinks = async (): Promise<Map<number, MoodleCourseLink>> => {
  const items = MoodleCourseLinkListSchema.parse((await req('GET', '/moodle/links')).body).items;
  return new Map(items.map((link) => [link.moodle_course_id, link]));
};
/** Nicht gelöschte Module unseres Semesters, nach Anlage */
async function semesterModules(): Promise<{ id: string; name: string; short_name: string | null }[]> {
  return (await t.handle.db.execute(
    sql`SELECT id, name, short_name FROM module WHERE semester_id = ${semester.id} AND deleted_at IS NULL ORDER BY created_at, id`,
  )) as unknown as { id: string; name: string; short_name: string | null }[];
}

beforeAll(async () => {
  fake = await new FakeMoodleServer(TOKEN).start();
});

afterAll(async () => {
  await fake.stop();
});

async function start(fixture: FakeCourse[] = SCREENSHOT): Promise<void> {
  courses = fixture;
  installFixtures();
  const dataDir = mkdtempSync(join(tmpdir(), 'sg-core-moodle-auto-'));
  moodle = createMoodleServices({
    config: { moodleUrl: fake.baseUrl, dataDir },
    tokens: new StaticTokenStore(TOKEN),
    logger: pino({ level: 'silent' }),
    readMeta: async () => ({ token_valid_until: '2027-01-31' }),
    now: () => NOW,
    timeZone: 'Europe/Berlin',
    client: { minIntervalMs: 0, retryDelaysMs: [0, 0], timeoutMs: 2000 },
  });
  syncHandle = createDb(testDatabaseUrl());
  sync = new MoodleSync({ db: syncHandle.db, dataDir, moodle, now: () => NOW });
  t = await startTestApp({ moodleUrl: fake.baseUrl, dataDir }, { moodle, moodleSync: sync, now: () => NOW });
  // Je Test ein eigenes, aktuelles Semester mit dem einen Modul aus dem Screenshot. Andere Testdateien lassen eigene
  // Semester in derselben Datenbank zurück
  semester = (
    await req<Semester>('POST', '/semesters', {
      name: 'HS 2026',
      starts_on: '2026-09-14',
      ends_on: '2027-02-28',
      is_current: true,
    })
  ).body;
  wiModule = (
    await req<Module>('POST', '/modules', {
      semester_id: semester.id,
      name: 'Einführung in die Wirtschaftsinformatik',
    })
  ).body;
}

afterEach(async () => {
  await sync.idle();
  const db = t.handle.db;
  await db.execute(
    sql`TRUNCATE moodle_item, moodle_deadline, moodle_course_link, moodle_course_decided, slide_deck, exercise_sheet CASCADE`,
  );
  await db.execute(sql`DELETE FROM job`);
  await db.execute(
    sql`UPDATE calendar_event SET deleted_at = now() WHERE module_id IN (SELECT id FROM module WHERE semester_id = ${semester.id})`,
  );
  await db.execute(sql`UPDATE module SET deleted_at = now() WHERE semester_id = ${semester.id}`);
  await db.execute(sql`UPDATE semester SET deleted_at = now(), is_current = false WHERE id = ${semester.id}`);
  await t.close();
  await syncHandle.close();
});

/** POST /moodle/auto-assign wie die Web-App beim Öffnen von Einstellungen › Moodle */
async function autoAssign(): Promise<{ assigned: number; created: number }> {
  const res = await req<{ assigned: number; created: number }>('POST', '/moodle/auto-assign');
  expect(res.status).toBe(200);
  return MoodleAutoAssignResultSchema.parse(res.body);
}

describe('Moodle: Module automatisch anlegen und zuordnen (#141)', () => {
  it('legt aus den Kursen des Screenshots die Module an und ordnet den WI-Kurs dem bestehenden Modul zu', async () => {
    await start();
    expect(await autoAssign()).toEqual({ assigned: 1, created: 5 });
    const byId = await listCourses();

    const modules = await semesterModules();
    expect(modules.map((m) => m.name)).toEqual([wiModule.name, ...EXPECTED_NEW]);
    const moduleOf = (courseId: number) => modules.find((m) => m.id === byId.get(courseId)?.module_id);
    expect(moduleOf(C.marketing)?.name).toBe('Einführung in das Marketing');
    expect(moduleOf(C.programmierung)?.name).toBe('Grundlagen der Programmierung');
    expect(moduleOf(C.mathe)?.name).toBe('Mathematik für Wirtschaftinformatik');
    expect(moduleOf(C.bwl)?.name).toBe('Einführung in die Betriebswirtschaftslehre');
    expect(moduleOf(C.praktikum)?.name).toBe('Betriebspraktikum Wirtschaftswissenschaften');
    // Kein neues Modul für die Wirtschaftsinformatik: das bestehende
    expect(byId.get(C.wi)?.module_id).toBe(wiModule.id);
    expect(modules.filter((m) => m.name.startsWith('Einführung in die Wirtschaftsinformatik'))).toHaveLength(
      1,
    );
    // Organisatorisch und alt: nichts
    expect(byId.get(C.pruefungsamt)).toMatchObject({ category: 'organisatorisch', module_id: null });
    expect(byId.get(C.alt)).toMatchObject({ category: 'alt', module_id: null });
    // Kein Kürzel aus Moodle: Die Seitenleiste zeigt den bereinigten Namen (Lead-Review #144)
    expect(modules.map((m) => m.short_name)).toEqual([null, null, null, null, null, null]);

    // Vermerk und „Modul entfernen“
    const links = await listLinks();
    expect(links.get(C.wi)).toMatchObject({ auto: 'zugeordnet', module_removable: false });
    for (const id of [C.marketing, C.programmierung, C.mathe, C.bwl, C.praktikum]) {
      expect(links.get(id), String(id)).toMatchObject({ auto: 'angelegt', module_removable: true });
    }
    // Jeder behandelte Kurs ist entschieden
    const decided = (await t.handle.db.execute(
      sql`SELECT moodle_course_id::int AS id, reason FROM moodle_course_decided ORDER BY moodle_course_id`,
    )) as unknown as { id: number; reason: string }[];
    expect(decided).toEqual(
      [C.marketing, C.programmierung, C.mathe, C.bwl, C.wi, C.praktikum].map((id) => ({
        id,
        reason: 'auto',
      })),
    );
    // Neue Module bekommen wie von Hand angelegte die Notizbücher „Vorlesung“ und „Übung“
    const notebooks = (await t.handle.db.execute(
      sql`SELECT count(*)::int AS n FROM notebook WHERE module_id = ${moduleOf(C.marketing)?.id ?? ''}`,
    )) as unknown as { n: number }[];
    expect(notebooks[0]?.n).toBe(2);
  });

  it('GET /moodle/courses schreibt nichts, auch nicht mit fremdem Origin; POST mit fremdem Origin wird abgelehnt', async () => {
    await start();
    const evil = { origin: 'https://evil.example' };
    const get = await t.request({ method: 'GET', url: '/api/v1/moodle/courses', headers: evil });
    expect([200, 403]).toContain(get.statusCode);
    expect((await listCourses()).get(C.marketing)?.module_id).toBeNull();
    const post = await t.request({ method: 'POST', url: '/api/v1/moodle/auto-assign', headers: evil });
    expect(post.statusCode).toBe(403);
    expect(post.json().error.code).toBe('origin_not_allowed');
    expect(await semesterModules()).toHaveLength(1);
    expect((await listLinks()).size).toBe(0);
  });

  it('ist idempotent: nacheinander und bei vier gleichzeitigen Läufen keine doppelten Module', async () => {
    await start();
    const list = (await moodle.reader.courses()).items;
    const handles = Array.from({ length: 4 }, () => createDb(testDatabaseUrl()));
    try {
      const results = await Promise.all(
        handles.map((handle) => autoAssignCourses(handle.db, list, { timeZone: 'Europe/Berlin', now: NOW })),
      );
      expect(results.reduce((sum, r) => sum + r.created, 0)).toBe(5);
      expect(results.reduce((sum, r) => sum + r.assigned, 0)).toBe(1);
    } finally {
      await Promise.all(handles.map((handle) => handle.close()));
    }
    expect(await semesterModules()).toHaveLength(6);
    // Abgleich, Anstoß der Web-App und Abgleich gleichzeitig: nichts Neues
    await Promise.all([sync.run('manuell'), autoAssign(), sync.run('zeitplan')]);
    await sync.idle();
    expect(await semesterModules()).toHaveLength(6);
    expect((await listLinks()).size).toBe(6);
  });

  it('der Abgleich ordnet zu und gleicht die neuen Kurse im selben Lauf ab', async () => {
    await start();
    const run = await sync.run('manuell');
    expect(run).toMatchObject({ ok: true, courses: 6, files_imported: 1 });
    const links = await listLinks();
    expect(links.get(C.marketing)?.auto).toBe('angelegt');
    // Aus Moodle übernommenes Material zählt nicht als Inhalt: Das Modul lässt sich weiter entfernen
    expect(links.get(C.marketing)?.module_removable).toBe(true);
  });

  it('„Lösen“ verhindert eine erneute Automatik, von Hand zuordnen geht weiter', async () => {
    await start();
    await autoAssign();
    expect((await req('DELETE', `/moodle/links/${C.marketing}`)).status).toBe(204);
    expect((await req('DELETE', `/moodle/links/${C.wi}`)).status).toBe(204);

    // Weder der nächste Anstoß noch der nächste Abgleich ordnen wieder zu
    expect(await autoAssign()).toEqual({ assigned: 0, created: 0 });
    await sync.run('manuell');
    const byId = await listCourses();
    expect(byId.get(C.marketing)?.module_id).toBeNull();
    expect(byId.get(C.wi)?.module_id).toBeNull();
    // Das Modul bleibt als Vorschlag, es entsteht kein zweites
    expect(byId.get(C.wi)?.suggested_module_id).toBe(wiModule.id);
    expect(await semesterModules()).toHaveLength(6);

    // Von Hand: wieder zugeordnet, ohne Vermerk der Automatik
    const put = await req<MoodleCourseLink>('PUT', `/moodle/links/${C.wi}`, { module_id: wiModule.id });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ auto: null, module_removable: false });
  });

  it('module_removable in PUT /moodle/links/{id} ignoriert fremde Sessions und zählt weitere Kurse des Moduls (#158)', async () => {
    await start();
    await autoAssign();
    const marketing = (await listLinks()).get(C.marketing);
    const own = marketing?.module_id ?? '';
    // Eine Session eines ANDEREN Moduls: darf das automatisch angelegte, leere Modul nicht blockieren
    const [foreign] = await t.handle.db.execute<{ id: string }>(
      sql`INSERT INTO session (id, user_id, module_id) VALUES (gen_random_uuid(), ${SINGLE_USER_ID}, ${wiModule.id}) RETURNING id`,
    );
    try {
      const same = await req<MoodleCourseLink>('PUT', `/moodle/links/${C.marketing}`, { module_id: own });
      expect(same.status).toBe(200);
      expect(same.body).toMatchObject({ auto: 'angelegt', module_removable: true });

      // Ein zweiter Kurs im selben Modul: für ihn (von Hand) und für den ersten ist es nicht mehr entfernbar
      const second = await req<MoodleCourseLink>('PUT', `/moodle/links/${C.mathe}`, { module_id: own });
      expect(second.body).toMatchObject({ auto: null, module_removable: false });
      expect((await listLinks()).get(C.marketing)?.module_removable).toBe(false);
      const again = await req<MoodleCourseLink>('PUT', `/moodle/links/${C.marketing}`, { module_id: own });
      expect(again.body).toMatchObject({ auto: 'angelegt', module_removable: false });
    } finally {
      await t.handle.db.execute(sql`DELETE FROM session WHERE id = ${foreign?.id ?? null}`);
    }
  });

  it('Modul wechseln von Hand löscht den Vermerk, der Schalter „Abgleichen“ nicht', async () => {
    await start();
    await autoAssign();
    const links = await listLinks();
    const own = links.get(C.marketing)?.module_id ?? '';
    const off = await req<MoodleCourseLink>('PUT', `/moodle/links/${C.marketing}`, {
      module_id: own,
      sync_enabled: false,
    });
    expect(off.body).toMatchObject({ auto: 'angelegt', sync_enabled: false, module_removable: true });
    const moved = await req<MoodleCourseLink>('PUT', `/moodle/links/${C.marketing}`, {
      module_id: wiModule.id,
    });
    expect(moved.body).toMatchObject({ auto: null, module_removable: false });
  });

  it('„Modul entfernen“ legt ein leeres automatisch angelegtes Modul in den Papierkorb, ohne erneute Automatik', async () => {
    await start();
    await autoAssign();
    const moduleId = (await listLinks()).get(C.programmierung)?.module_id ?? '';
    expect((await req('DELETE', `/moodle/links/${C.programmierung}/module`)).status).toBe(204);
    expect((await req<Module>('GET', `/modules/${moduleId}`)).status).toBe(404);
    const trash = await req<{ items: { id: string }[] }>('GET', '/trash?kind=module');
    expect(trash.body.items.map((item) => item.id)).toContain(moduleId);

    await sync.run('manuell');
    await autoAssign();
    const byId = await listCourses();
    expect(byId.get(C.programmierung)?.module_id).toBeNull();
    expect((await semesterModules()).map((m) => m.name)).not.toContain('Grundlagen der Programmierung');

    // Wiederherstellen bringt Modul und Zuordnung zurück (R15)
    expect((await req('POST', `/trash/${moduleId}/restore`)).status).toBe(200);
    expect((await listCourses()).get(C.programmierung)?.module_id).toBe(moduleId);

    // Endgültig gelöscht (Papierkorb geleert): Die Zuordnung fällt mit dem Modul weg, die Entscheidung gilt weiter
    expect((await req('DELETE', `/moodle/links/${C.programmierung}/module`)).status).toBe(204);
    expect((await req('DELETE', `/trash/${moduleId}`)).status).toBe(204);
    await sync.run('manuell');
    await autoAssign();
    expect((await listCourses()).get(C.programmierung)?.module_id).toBeNull();
    expect((await semesterModules()).map((m) => m.name)).not.toContain('Grundlagen der Programmierung');
  });

  it('ein endgültig gelöschtes Modul kommt nie zurück, auch ohne „Modul entfernen“ (B3)', async () => {
    await start();
    await autoAssign();
    const moduleId = (await listLinks()).get(C.marketing)?.module_id ?? '';
    // Über die Modulseite gelöscht und den Papierkorb geleert
    expect((await req('DELETE', `/modules/${moduleId}`)).status).toBe(204);
    expect((await req('DELETE', `/trash/${moduleId}`)).status).toBe(204);
    expect(await autoAssign()).toEqual({ assigned: 0, created: 0 });
    await sync.run('manuell');
    expect((await listCourses()).get(C.marketing)?.module_id).toBeNull();
    expect((await semesterModules()).map((m) => m.name)).not.toContain('Einführung in das Marketing');
  });

  it('„Modul entfernen“ nur für automatisch angelegte, leere Module', async () => {
    await start();
    await autoAssign();
    // Zugeordnet, nicht angelegt
    const assigned = await req<{ error: { code: string } }>('DELETE', `/moodle/links/${C.wi}/module`);
    expect(assigned.status).toBe(409);
    expect(assigned.body.error.code).toBe('moodle_module_not_removable');
    // Mit eigenem Inhalt (ein freies Notizbuch)
    const moduleId = (await listLinks()).get(C.mathe)?.module_id ?? '';
    await t.handle.db.execute(
      sql`INSERT INTO notebook (id, user_id, module_id, title, kind) VALUES (gen_random_uuid(), ${SINGLE_USER_ID}, ${moduleId}, 'Eigene Notizen', 'frei')`,
    );
    expect((await listLinks()).get(C.mathe)?.module_removable).toBe(false);
    expect((await req('DELETE', `/moodle/links/${C.mathe}/module`)).status).toBe(409);
    // Mit einem von Hand zugeordneten Termin (B5); ein automatisch zugeordneter zählt nicht
    const bwlModule = (await listLinks()).get(C.bwl)?.module_id ?? '';
    const event = (assignedBy: string) =>
      t.handle.db.execute(
        sql`INSERT INTO calendar_event (id, user_id, module_id, title, starts_at, ends_at, all_day, kind, assigned_by)
            VALUES (gen_random_uuid(), ${SINGLE_USER_ID}, ${bwlModule}, 'Vorlesung', now(), now() + interval '1 hour', false, 'vorlesung', ${assignedBy})`,
      );
    await event('auto');
    expect((await listLinks()).get(C.bwl)?.module_removable).toBe(true);
    await event('manuell');
    expect((await listLinks()).get(C.bwl)?.module_removable).toBe(false);
    expect((await req('DELETE', `/moodle/links/${C.bwl}/module`)).status).toBe(409);
    // Zwei Kurse im selben Modul
    const praktikumModule = (await listLinks()).get(C.praktikum)?.module_id;
    expect((await req('PUT', `/moodle/links/${C.marketing}`, { module_id: praktikumModule })).status).toBe(
      200,
    );
    expect((await listLinks()).get(C.praktikum)?.module_removable).toBe(false);
    // Nicht zugeordnet
    expect((await req('DELETE', `/moodle/links/${C.pruefungsamt}/module`)).status).toBe(404);
  });

  it('unsichere Treffer, Mehrdeutiges und andere Stufen bleiben Vorschlag, ohne neues Modul (B1)', async () => {
    const fixture: FakeCourse[] = [
      { id: 2101, fullname: 'Marketing und Controlling WiSe 26/27', shortname: 'MC' },
      { id: 2102, fullname: 'Statistik II WiSe 26/27', shortname: 'ST2' },
      { id: 2103, fullname: 'Statistik Teil B', shortname: 'STB' },
      { id: 2104, fullname: 'Bilanzierung', shortname: 'BIL' },
      { id: 2105, fullname: 'Wirtschaftsrecht', shortname: 'REC' },
      { id: 2106, fullname: 'Statik', shortname: 'STA' },
      { id: 2107, fullname: 'Mikrobiologie', shortname: 'MB' },
      { id: 2108, fullname: 'Infrastrukturrecht', shortname: 'IR' },
    ];
    await start(fixture);
    for (const [name, short_name] of [
      ['Marketing', null],
      ['Controlling', null],
      ['Statistik', null],
      ['Betriebswirtschaftslehre', null],
      ['Rechnungswesen', null],
      ['Mikroökonomie', 'Mikro'],
      ['Informatik', 'Inf'],
    ]) {
      expect((await req('POST', '/modules', { semester_id: semester.id, name, short_name })).status).toBe(
        201,
      );
    }
    expect(await autoAssign()).toEqual({ assigned: 0, created: 0 });
    const byId = await listCourses();
    for (const course of fixture) {
      expect(byId.get(course.id)?.module_id, course.fullname).toBeNull();
    }
    // Der Vorschlag bleibt, wo er vorher war
    const statistik = (await semesterModules()).find((m) => m.name === 'Statistik');
    expect(byId.get(2102)?.suggested_module_id).toBe(statistik?.id);
    expect(await semesterModules()).toHaveLength(8);
    expect((await listLinks()).size).toBe(0);
  });

  it('Terminarten zählen nicht: „Statistik“ und „Übung Statistik“ ergeben ein Modul (B6)', async () => {
    await start([
      { id: 2201, fullname: 'Statistik WiSe 26/27', shortname: 'STAT' },
      { id: 2202, fullname: 'Übung Statistik WiSe 26/27', shortname: 'STAT-UE' },
      { id: 2203, fullname: 'Tutorium Statistik (WiSe 26/27)', shortname: 'STAT-TUT' },
    ]);
    expect(await autoAssign()).toEqual({ assigned: 0, created: 1 });
    const byId = await listCourses();
    const statistik = (await semesterModules()).find((m) => m.name === 'Statistik');
    expect(statistik).toBeDefined();
    for (const id of [2201, 2202, 2203]) expect(byId.get(id)?.module_id, String(id)).toBe(statistik?.id);
  });

  it('bleibt nach der Bereinigung nichts übrig, entsteht kein Modul (B2)', async () => {
    await start([
      { id: 2301, fullname: '-', shortname: 'X1' },
      { id: 2302, fullname: '.', shortname: 'X2' },
      { id: 2303, fullname: '–', shortname: 'X3' },
      { id: 2304, fullname: '???', shortname: 'X4' },
      { id: 2305, fullname: 'Übung WiSe 26/27', shortname: 'X5' },
    ]);
    expect(await autoAssign()).toEqual({ assigned: 0, created: 0 });
    expect(await semesterModules()).toHaveLength(1);
    expect((await listLinks()).size).toBe(0);
  });

  it('ohne aktuelles Semester entstehen keine Module und nichts wird zugeordnet', async () => {
    await start();
    expect((await req('PATCH', `/semesters/${semester.id}`, { is_current: false })).status).toBe(200);
    expect(await autoAssign()).toEqual({ assigned: 0, created: 0 });
    await sync.run('manuell');
    expect(await semesterModules()).toHaveLength(1);
    expect((await listLinks()).size).toBe(0);
  });
});
