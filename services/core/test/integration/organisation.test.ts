import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  ModuleListSchema,
  ModuleSchema,
  SemesterListSchema,
  SemesterSchema,
  type Module,
  type Semester,
} from '@sg/shared';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { startTestApp, type TestApp } from './helpers.ts';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  // Andere Testdateien teilen sich die Datenbank und erwarten leere Tabellen
  await t.handle.sql`TRUNCATE semester, module CASCADE`;
  await t.handle.sql`TRUNCATE idempotency_key`;
  await t.close();
});
beforeEach(async () => {
  await t.handle.sql`TRUNCATE semester, module CASCADE`;
});

const API = '/api/v1';

async function post<T>(url: string, payload: unknown, expected = 201): Promise<T> {
  const res = await t.request({ method: 'POST', url: `${API}${url}`, payload: payload as object });
  expect(res.statusCode, res.body).toBe(expected);
  return res.json() as T;
}

async function patch<T>(url: string, payload: unknown, expected = 200): Promise<T> {
  const res = await t.request({ method: 'PATCH', url: `${API}${url}`, payload: payload as object });
  expect(res.statusCode, res.body).toBe(expected);
  return res.json() as T;
}

const createSemester = (body: object = { name: 'HS 2026' }) => post<Semester>('/semesters', body);
const createModule = (semesterId: string, body: object = {}) =>
  post<Module>('/modules', { semester_id: semesterId, name: 'Datenbanksysteme', ...body });

async function errorOf(res: { statusCode: number; json: () => unknown }, status: number) {
  expect(res.statusCode).toBe(status);
  return ApiErrorSchema.parse(res.json()).error;
}

describe('Semester', () => {
  it('legt ein Semester an (nur Name genügt) und liefert exakt den Typ Semester', async () => {
    const s = SemesterSchema.parse(await createSemester());
    expect(s).toMatchObject({
      name: 'HS 2026',
      starts_on: null,
      ends_on: null,
      archived_at: null,
      deleted_at: null,
    });
    const got = await t.request({ url: `${API}/semesters/${s.id}` });
    expect(got.statusCode).toBe(200);
    expect(SemesterSchema.parse(got.json())).toEqual(s);
  });

  it('übernimmt Zeitraum und Client-ID, doppelte ID → 409 conflict', async () => {
    const id = uuidv7();
    const s = await createSemester({ id, name: 'FS 2027', starts_on: '2027-02-15', ends_on: '2027-06-04' });
    expect(s).toMatchObject({ id, starts_on: '2027-02-15', ends_on: '2027-06-04' });
    const res = await t.request({
      method: 'POST',
      url: `${API}/semesters`,
      payload: { id, name: 'nochmal' },
    });
    expect((await errorOf(res, 409)).code).toBe('conflict');
  });

  it('das erste Semester wird automatisch aktuell, weitere nicht', async () => {
    const first = await createSemester({ name: 'HS 2026' });
    const second = await createSemester({ name: 'FS 2027' });
    expect(first.is_current).toBe(true);
    expect(second.is_current).toBe(false);
  });

  it('is_current: Setzen auf true setzt alle anderen zurück (Anlegen und PATCH)', async () => {
    const a = await createSemester({ name: 'A' });
    const b = await createSemester({ name: 'B' });
    const c = await createSemester({ name: 'C', is_current: true });
    expect(c.is_current).toBe(true);
    const currentIds = async () => {
      const list = SemesterListSchema.parse(
        (await t.request({ url: `${API}/semesters` })).json(),
      ).items.filter((s) => s.is_current);
      return list.map((s) => s.id);
    };
    expect(await currentIds()).toEqual([c.id]);

    const updated = await patch<Semester>(`/semesters/${b.id}`, { is_current: true });
    expect(updated.is_current).toBe(true);
    expect(await currentIds()).toEqual([b.id]);

    await patch(`/semesters/${a.id}`, { is_current: true });
    expect(await currentIds()).toEqual([a.id]);
  });

  it('PATCH ändert Name und Zeitraum und kann Datumswerte leeren', async () => {
    const s = await createSemester({ name: 'A', starts_on: '2026-09-14', ends_on: '2026-12-18' });
    const u = await patch<Semester>(`/semesters/${s.id}`, { name: 'HS 2026', ends_on: null });
    expect(u).toMatchObject({ name: 'HS 2026', starts_on: '2026-09-14', ends_on: null });
    expect(Date.parse(u.updated_at)).toBeGreaterThanOrEqual(Date.parse(s.updated_at));
  });

  it('archived:true setzt archived_at (und nimmt „aktuell“ weg), archived:false leert es', async () => {
    const s = await createSemester();
    expect(s.is_current).toBe(true);
    const archived = await patch<Semester>(`/semesters/${s.id}`, { archived: true });
    expect(archived.archived_at).not.toBeNull();
    expect(archived.is_current).toBe(false);

    // erneut archivieren ändert den Zeitpunkt nicht
    const again = await patch<Semester>(`/semesters/${s.id}`, { archived: true });
    expect(again.archived_at).toBe(archived.archived_at);

    const restored = await patch<Semester>(`/semesters/${s.id}`, { archived: false });
    expect(restored.archived_at).toBeNull();
  });

  it('ein archiviertes Semester kann nicht aktuell werden (409)', async () => {
    const s = await createSemester({ name: 'A' });
    await patch(`/semesters/${s.id}`, { archived: true });
    const res = await t.request({
      method: 'PATCH',
      url: `${API}/semesters/${s.id}`,
      payload: { is_current: true },
    });
    expect((await errorOf(res, 409)).code).toBe('semester_archived');
    // gemeinsam mit der Wiederherstellung geht es
    const ok = await patch<Semester>(`/semesters/${s.id}`, { archived: false, is_current: true });
    expect(ok.is_current).toBe(true);
  });

  it('archivierte Semester und ihre Module bleiben über die API vollständig lesbar', async () => {
    const s = await createSemester();
    const m = await createModule(s.id);
    await patch(`/semesters/${s.id}`, { archived: true });

    const got = await t.request({ url: `${API}/semesters/${s.id}` });
    expect(got.statusCode).toBe(200);
    expect(SemesterSchema.parse(got.json()).archived_at).not.toBeNull();

    const mods = await t.request({ url: `${API}/modules?semester_id=${s.id}` });
    expect(ModuleListSchema.parse(mods.json()).items.map((x) => x.id)).toEqual([m.id]);
    const one = await t.request({ url: `${API}/modules/${m.id}` });
    expect(one.statusCode).toBe(200);
  });

  it('?archived filtert die Liste, ohne Filter sind alle enthalten', async () => {
    const a = await createSemester({ name: 'A' });
    const b = await createSemester({ name: 'B' });
    await patch(`/semesters/${a.id}`, { archived: true });
    const ids = async (query: string) =>
      SemesterListSchema.parse((await t.request({ url: `${API}/semesters${query}` })).json())
        .items.map((s) => s.id)
        .sort();
    expect(await ids('')).toEqual([a.id, b.id].sort());
    expect(await ids('?archived=true')).toEqual([a.id]);
    expect(await ids('?archived=false')).toEqual([b.id]);
    const bad = await t.request({ url: `${API}/semesters?archived=vielleicht` });
    expect((await errorOf(bad, 400)).code).toBe('validation_failed');
  });

  it('paginiert (neueste zuerst) über next_cursor', async () => {
    const names = ['S1', 'S2', 'S3', 'S4', 'S5'];
    for (const name of names) await createSemester({ name });
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `${API}/semesters?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const page = SemesterListSchema.parse((await t.request({ url })).json());
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((s) => s.name));
      cursor = page.next_cursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual([...names].reverse());
  });

  it('404 semester_not_found und 400 bei ungültiger ID oder Body', async () => {
    const missing = await t.request({ url: `${API}/semesters/${uuidv7()}` });
    expect((await errorOf(missing, 404)).code).toBe('semester_not_found');
    const patchMissing = await t.request({
      method: 'PATCH',
      url: `${API}/semesters/${uuidv7()}`,
      payload: { name: 'x' },
    });
    expect((await errorOf(patchMissing, 404)).code).toBe('semester_not_found');

    const badId = await t.request({ url: `${API}/semesters/keine-uuid` });
    expect((await errorOf(badId, 400)).code).toBe('validation_failed');
    const badBody = await t.request({ method: 'POST', url: `${API}/semesters`, payload: { name: '' } });
    expect((await errorOf(badBody, 400)).code).toBe('validation_failed');
    const extra = await t.request({
      method: 'POST',
      url: `${API}/semesters`,
      payload: { name: 'x', unbekannt: 1 },
    });
    expect((await errorOf(extra, 400)).code).toBe('validation_failed');
  });
});

describe('Module', () => {
  it('legt ein Modul an (Name genügt) und liefert exakt den Typ Module', async () => {
    const s = await createSemester();
    const m = ModuleSchema.parse(await createModule(s.id, { name: 'Statistik' }));
    expect(m).toMatchObject({
      semester_id: s.id,
      name: 'Statistik',
      short_name: null,
      color: 'mod-01',
      ects: null,
      exam_type: null,
      lecturer: null,
      lang: null,
      description_md: null,
      deleted_at: null,
      settings: {},
    });
    const got = await t.request({ url: `${API}/modules/${m.id}` });
    expect(ModuleSchema.parse(got.json())).toEqual(m);
  });

  it('speichert alle optionalen Felder und akzeptiert eine Client-ID (doppelt → 409)', async () => {
    const s = await createSemester();
    const id = uuidv7();
    const m = await createModule(s.id, {
      id,
      name: 'Datenbanksysteme',
      short_name: 'DBS',
      color: 'mod-07',
      ects: 6,
      exam_type: 'Klausur',
      lecturer: 'Prof. Muster',
      lang: 'de',
      description_md: 'Relationale Modelle',
    });
    expect(m).toMatchObject({
      id,
      short_name: 'DBS',
      color: 'mod-07',
      ects: 6,
      exam_type: 'Klausur',
      lecturer: 'Prof. Muster',
      lang: 'de',
      description_md: 'Relationale Modelle',
    });
    const res = await t.request({
      method: 'POST',
      url: `${API}/modules`,
      payload: { id, semester_id: s.id, name: 'nochmal' },
    });
    expect((await errorOf(res, 409)).code).toBe('conflict');
  });

  it('Farbvergabe: nächste freie Palettenfarbe, danach zyklisch', async () => {
    const s = await createSemester();
    const colors: string[] = [];
    for (let i = 0; i < 14; i += 1) colors.push((await createModule(s.id, { name: `M${i}` })).color);
    expect(colors.slice(0, 12)).toEqual(
      Array.from({ length: 12 }, (_, i) => `mod-${String(i + 1).padStart(2, '0')}`),
    );
    expect(colors.slice(12)).toEqual(['mod-01', 'mod-02']);
  });

  it('Farbvergabe überspringt ausdrücklich gewählte Farben und gilt pro Semester', async () => {
    const s1 = await createSemester({ name: 'A' });
    const s2 = await createSemester({ name: 'B' });
    await createModule(s1.id, { color: 'mod-01' });
    expect((await createModule(s1.id)).color).toBe('mod-02');
    expect((await createModule(s2.id)).color).toBe('mod-01');
  });

  it('Farbvergabe: Farbe eines gelöschten Moduls wird wieder frei', async () => {
    const s = await createSemester();
    const a = await createModule(s.id);
    await createModule(s.id);
    const del = await t.request({ method: 'DELETE', url: `${API}/modules/${a.id}` });
    expect(del.statusCode).toBe(204);
    expect((await createModule(s.id)).color).toBe('mod-01');
  });

  it('Modul in unbekanntem Semester → 404 semester_not_found', async () => {
    const res = await t.request({
      method: 'POST',
      url: `${API}/modules`,
      payload: { semester_id: uuidv7(), name: 'X' },
    });
    expect((await errorOf(res, 404)).code).toBe('semester_not_found');
  });

  it('Validierung: leerer Name, ungültige Farbe, Sprache → 400 validation_failed', async () => {
    const s = await createSemester();
    for (const payload of [
      { semester_id: s.id, name: '' },
      { semester_id: s.id, name: 'X', color: 'mod-13' },
      { semester_id: s.id, name: 'X', lang: 'fr' },
      { semester_id: s.id, name: 'X', ects: -1 },
      { name: 'X' },
    ]) {
      const res = await t.request({ method: 'POST', url: `${API}/modules`, payload });
      expect((await errorOf(res, 400)).code).toBe('validation_failed');
    }
  });

  it('PATCH ändert Felder, leert mit null und prüft Farbe und Semester', async () => {
    const s1 = await createSemester({ name: 'A' });
    const s2 = await createSemester({ name: 'B' });
    const m = await createModule(s1.id, { short_name: 'DBS', ects: 6, lecturer: 'X' });
    const u = await patch<Module>(`/modules/${m.id}`, {
      name: 'Datenbanken',
      short_name: null,
      color: 'mod-09',
      ects: 5.5,
      exam_type: 'mündlich',
      semester_id: s2.id,
    });
    expect(u).toMatchObject({
      name: 'Datenbanken',
      short_name: null,
      color: 'mod-09',
      ects: 5.5,
      exam_type: 'mündlich',
      lecturer: 'X',
      semester_id: s2.id,
    });

    const badColor = await t.request({
      method: 'PATCH',
      url: `${API}/modules/${m.id}`,
      payload: { color: 'rot' },
    });
    expect((await errorOf(badColor, 400)).code).toBe('validation_failed');
    const badSemester = await t.request({
      method: 'PATCH',
      url: `${API}/modules/${m.id}`,
      payload: { semester_id: uuidv7() },
    });
    expect((await errorOf(badSemester, 404)).code).toBe('semester_not_found');
  });

  it('PATCH settings führt Schlüssel für Schlüssel zusammen, null entfernt (VERTRAEGE §14.2)', async () => {
    const s = await createSemester();
    const m = await createModule(s.id);
    // Web-App setzt Layout und Spalten, iPad den Schreibmodus: keiner überschreibt den anderen
    await patch<Module>(`/modules/${m.id}`, { settings: { layout: 'fokus', column_widths: [50, 20, 30] } });
    const both = await patch<Module>(`/modules/${m.id}`, { settings: { ink_mode: 'auf_folie' } });
    expect(ModuleSchema.parse(both).settings).toEqual({
      layout: 'fokus',
      column_widths: [50, 20, 30],
      ink_mode: 'auf_folie',
    });
    // Andere Felder lassen settings unverändert
    const renamed = await patch<Module>(`/modules/${m.id}`, { name: 'Neu' });
    expect(renamed.settings).toEqual(both.settings);
    // null entfernt einen Schlüssel, leeres Objekt ändert nichts
    const removed = await patch<Module>(`/modules/${m.id}`, {
      settings: { column_widths: null, layout: 'standard' },
    });
    expect(removed.settings).toEqual({ layout: 'standard', ink_mode: 'auf_folie' });
    const unchanged = await patch<Module>(`/modules/${m.id}`, { settings: {} });
    expect(unchanged.settings).toEqual(removed.settings);

    const bad = await t.request({
      method: 'PATCH',
      url: `${API}/modules/${m.id}`,
      payload: { settings: { layout: 'riesig' } },
    });
    expect((await errorOf(bad, 400)).code).toBe('validation_failed');
    const twoColumns = await t.request({
      method: 'PATCH',
      url: `${API}/modules/${m.id}`,
      payload: { settings: { column_widths: [50, 50] } },
    });
    expect((await errorOf(twoColumns, 400)).code).toBe('validation_failed');
    const wrongSum = await t.request({
      method: 'PATCH',
      url: `${API}/modules/${m.id}`,
      payload: { settings: { column_widths: [50, 30, 30] } },
    });
    expect((await errorOf(wrongSum, 400)).code).toBe('validation_failed');
    const thirds = await patch<Module>(`/modules/${m.id}`, {
      settings: { column_widths: [33.33, 33.33, 33.34] },
    });
    expect(thirds.settings.column_widths).toEqual([33.33, 33.33, 33.34]);
  });

  it('GET /modules?semester_id filtert, ohne Filter kommen alle', async () => {
    const s1 = await createSemester({ name: 'A' });
    const s2 = await createSemester({ name: 'B' });
    const a = await createModule(s1.id, { name: 'A1' });
    const b = await createModule(s2.id, { name: 'B1' });
    const ids = async (query: string) =>
      ModuleListSchema.parse((await t.request({ url: `${API}/modules${query}` })).json()).items.map(
        (m) => m.id,
      );
    expect(await ids(`?semester_id=${s1.id}`)).toEqual([a.id]);
    expect(await ids(`?semester_id=${s2.id}`)).toEqual([b.id]);
    expect(await ids('')).toEqual([a.id, b.id]);
  });

  it('Soft-Delete: 204, danach 404 in Einzelabruf, Liste und erneutem DELETE; Zeile bleibt erhalten', async () => {
    const s = await createSemester();
    const m = await createModule(s.id);
    const keep = await createModule(s.id, { name: 'Bleibt' });

    const del = await t.request({ method: 'DELETE', url: `${API}/modules/${m.id}` });
    expect(del.statusCode).toBe(204);
    expect(del.body).toBe('');

    const got = await t.request({ url: `${API}/modules/${m.id}` });
    expect((await errorOf(got, 404)).code).toBe('module_not_found');
    const again = await t.request({ method: 'DELETE', url: `${API}/modules/${m.id}` });
    expect((await errorOf(again, 404)).code).toBe('module_not_found');
    const patched = await t.request({
      method: 'PATCH',
      url: `${API}/modules/${m.id}`,
      payload: { name: 'x' },
    });
    expect((await errorOf(patched, 404)).code).toBe('module_not_found');

    const list = ModuleListSchema.parse((await t.request({ url: `${API}/modules` })).json());
    expect(list.items.map((x) => x.id)).toEqual([keep.id]);

    const [row] = await t.handle.sql`SELECT deleted_at FROM module WHERE id = ${m.id}`;
    expect(row?.deleted_at).not.toBeNull();
  });

  it('paginiert in Anlegereihenfolge über next_cursor', async () => {
    const s = await createSemester();
    const created: string[] = [];
    for (let i = 0; i < 5; i += 1) created.push((await createModule(s.id, { name: `M${i}` })).id);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `${API}/modules?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const page = ModuleListSchema.parse((await t.request({ url })).json());
      seen.push(...page.items.map((m) => m.id));
      cursor = page.next_cursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(created);
  });

  it('404 module_not_found und 400 bei ungültiger ID', async () => {
    const missing = await t.request({ url: `${API}/modules/${uuidv7()}` });
    expect((await errorOf(missing, 404)).code).toBe('module_not_found');
    const badId = await t.request({ method: 'DELETE', url: `${API}/modules/abc` });
    expect((await errorOf(badId, 400)).code).toBe('validation_failed');
  });

  it('POST ist über Idempotency-Key abgedeckt: Wiederholung legt kein zweites Modul an', async () => {
    const s = await createSemester();
    const key = uuidv7();
    const send = () =>
      t.request({
        method: 'POST',
        url: `${API}/modules`,
        headers: { 'idempotency-key': key },
        payload: { semester_id: s.id, name: 'Einmalig' },
      });
    const first = await send();
    const second = await send();
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json()).toEqual(first.json());
    const list = ModuleListSchema.parse((await t.request({ url: `${API}/modules` })).json());
    expect(list.items).toHaveLength(1);
  });
});

describe('Nebenläufigkeit', () => {
  it('is_current: gleichzeitige PATCHes und POSTs enden ohne Fehler mit genau einem aktuellen Semester', async () => {
    const seeds: Semester[] = [];
    for (const n of [1, 2, 3]) seeds.push(await createSemester({ name: `S${n}`, is_current: false }));
    const results = await Promise.all([
      ...seeds.map((s) =>
        t.request({ method: 'PATCH', url: `${API}/semesters/${s.id}`, payload: { is_current: true } }),
      ),
      ...[4, 5].map((n) =>
        t.request({ method: 'POST', url: `${API}/semesters`, payload: { name: `S${n}`, is_current: true } }),
      ),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 201, 201]);
    const list = SemesterListSchema.parse((await t.request({ url: `${API}/semesters` })).json());
    expect(list.items.filter((s) => s.is_current)).toHaveLength(1);
  });

  it('gleichzeitig mit gleicher Client-ID: ein 201, der Rest 409 conflict', async () => {
    const id = uuidv7();
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        t.request({ method: 'POST', url: `${API}/semesters`, payload: { id, name: `S${n}` } }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
  });
});
