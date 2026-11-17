// F3a (VERTRAEGE 17.8, Testfall 7): `activeCourseIdsOfModule` gegen Postgres. Erfundene Kurs-IDs, keine echten Namen.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Module, Semester } from '@sg/shared';
import { LectureSync, type LectureSyncOptions } from '../../src/moodle/lecture.ts';
import { activeCourseIdsOfModule } from '../../src/moodle/store.ts';
import { startTestApp, type TestApp } from './helpers.ts';

// Hohe, erfundene Kurs-IDs: Andere Testdateien teilen sich die Datenbank (eindeutig je Kurs)
const BASE = 8_800_000 + Math.floor(Math.random() * 90_000);
const COURSE = { zwei: BASE + 2, eins: BASE + 1, aus: BASE + 3, fremd: BASE + 4, geloescht: BASE + 5 };

let t: TestApp;
let semester: Semester;
let modA: Module;
let modB: Module;
let modGone: Module;

async function req<T>(method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  const res = await t.request({ method, url: `/api/v1${url}`, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: (res.body ? res.json() : null) as T };
}

const link = async (courseId: number, moduleId: string, syncEnabled = true) => {
  const res = await req('PUT', `/moodle/links/${courseId}`, {
    module_id: moduleId,
    sync_enabled: syncEnabled,
  });
  expect(res.status).toBe(200);
};

beforeAll(async () => {
  t = await startTestApp();
  semester = (
    await req<Semester>('POST', '/semesters', {
      name: 'HS 2026',
      starts_on: '2026-09-14',
      ends_on: '2027-02-28',
      is_current: true,
    })
  ).body;
  const mk = async (name: string) =>
    (await req<Module>('POST', '/modules', { semester_id: semester.id, name })).body;
  modA = await mk('Beispielmodul A');
  modB = await mk('Beispielmodul B');
  modGone = await mk('Beispielmodul gelöscht');
  // Absichtlich nicht aufsteigend angelegt
  await link(COURSE.zwei, modA.id);
  await link(COURSE.eins, modA.id);
  await link(COURSE.aus, modA.id, false);
  await link(COURSE.fremd, modB.id);
  await link(COURSE.geloescht, modGone.id);
  expect((await req('DELETE', `/modules/${modGone.id}`)).status).toBe(204);
});

afterAll(async () => {
  const db = t.handle.db;
  await db.execute(
    sql`DELETE FROM moodle_course_link WHERE moodle_course_id IN (${COURSE.zwei}, ${COURSE.eins}, ${COURSE.aus}, ${COURSE.fremd}, ${COURSE.geloescht})`,
  );
  await db.execute(sql`UPDATE module SET deleted_at = now() WHERE semester_id = ${semester.id}`);
  await db.execute(sql`UPDATE semester SET deleted_at = now(), is_current = false WHERE id = ${semester.id}`);
  await t.close();
});

describe('activeCourseIdsOfModule (F3a, 17.8)', () => {
  it('zwei Kurse, aufsteigend; der Kurs mit sync_enabled = false und der Kurs eines anderen Moduls fehlen', async () => {
    expect(await activeCourseIdsOfModule(t.handle.db, modA.id)).toEqual([COURSE.eins, COURSE.zwei]);
    expect(await activeCourseIdsOfModule(t.handle.db, modB.id)).toEqual([COURSE.fremd]);
  });

  it('ein gelöschtes Modul und ein unbekanntes Modul ergeben eine leere Liste', async () => {
    expect(await activeCourseIdsOfModule(t.handle.db, modGone.id)).toEqual([]);
    expect(await activeCourseIdsOfModule(t.handle.db, randomUUID())).toEqual([]);
  });

  it('gleiche Filter wie activeLinks: nach dem Abschalten von sync_enabled fällt der Kurs weg', async () => {
    await link(COURSE.zwei, modA.id, false);
    expect(await activeCourseIdsOfModule(t.handle.db, modA.id)).toEqual([COURSE.eins]);
    await link(COURSE.zwei, modA.id, true);
    expect(await activeCourseIdsOfModule(t.handle.db, modA.id)).toEqual([COURSE.eins, COURSE.zwei]);
  });

  it('LectureSync.request mit der echten Kursabfrage: Kurse aufsteigend; gelöscht und unbekannt ergeben kein_kurs', async () => {
    const runForLecture = vi.fn(() => 'gestartet' as const);
    const lecture = new LectureSync({
      db: t.handle.db,
      sync: { runForLecture },
      status: { getStatus: async () => ({ state: 'ok' }) } as unknown as LectureSyncOptions['status'],
    });
    expect(await lecture.request(modA.id)).toBe('gestartet');
    expect(runForLecture).toHaveBeenCalledWith([COURSE.eins, COURSE.zwei]);
    expect(await lecture.request(modGone.id)).toBe('kein_kurs');
    expect(await lecture.request(randomUUID())).toBe('kein_kurs');
    expect(runForLecture).toHaveBeenCalledTimes(1);
  });
});
