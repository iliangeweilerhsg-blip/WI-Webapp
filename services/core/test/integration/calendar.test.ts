// Kalender: ICS-Import, Abgleich, Zuordnung, Endpunkte (VERTRAEGE §7.1, §8)
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiErrorSchema,
  CalendarEventListSchema,
  CalendarEventSchema,
  CalendarReassignResultSchema,
  CalendarSourceListSchema,
  IcsImportResultSchema,
  SINGLE_USER_ID,
  type CalendarEvent,
  type IcsImportResult,
  type Module,
  type Semester,
} from '@sg/shared';
import { session } from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { calendarHooks, setCalendarHooks, syncAllUrlSources } from '../../src/services/calendar.ts';
import { IcsFetchError } from '../../src/services/calendar-fetch.ts';
import { occupyPort, startTestApp, type TestApp } from './helpers.ts';

const FIXTURES = fileURLToPath(new URL('../../../../tests/fixtures/ics/', import.meta.url));
const API = '/api/v1';
const NOW = new Date('2026-11-04T08:00:00Z');

/** Die Funktion, die ohne Mock läuft (vor dem Ersetzen merken) */
const defaultEnsure = calendarHooks.ensurePlannedSessions;
let t: TestApp;
let restoreHooks: () => void;
const ensure = vi.fn(async (_tx: unknown, _ids: string[]) => {});
const fetchMock = vi.fn<(url: string) => Promise<string>>();

beforeAll(async () => {
  restoreHooks = setCalendarHooks({
    ensurePlannedSessions: ensure as never,
    fetchIcs: fetchMock,
    now: () => NOW,
    defaultTimeZone: () => 'Europe/Zurich',
  });
  t = await startTestApp();
});
afterAll(async () => {
  await truncate();
  restoreHooks();
  await t.close();
});
beforeEach(async () => {
  await truncate();
  ensure.mockClear();
  fetchMock.mockReset();
});

async function truncate() {
  // Andere Testdateien teilen sich die Datenbank und erwarten leere Tabellen
  await t.handle.sql`TRUNCATE semester, module, calendar_source, calendar_event, session CASCADE`;
  await t.handle.sql`TRUNCATE idempotency_key`;
}

const fixture = (name: string) => readFileSync(`${FIXTURES}${name}`, 'utf8');

// ---------------------------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------------------------

interface Part {
  name: string;
  value: string | Buffer;
  filename?: string;
}

function multipart(parts: Part[]) {
  const boundary = `----sgtest${randomBytes(8).toString('hex')}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const file = part.filename !== undefined ? `; filename="${part.filename}"` : '';
    const type = part.filename !== undefined ? 'Content-Type: text/calendar\r\n' : '';
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${file}\r\n${type}\r\n`,
      ),
    );
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const filePart = (content: string | Buffer, filename = 'plan.ics'): Part => ({
  name: 'file',
  value: content,
  filename,
});

async function postFile(content: string | Buffer, extra: Part[] = [], headers: Record<string, string> = {}) {
  const body = multipart([filePart(content), ...extra]);
  return t.request({
    method: 'POST',
    url: `${API}/calendar/sources`,
    payload: body.payload,
    headers: { ...body.headers, ...headers },
  });
}

async function importFile(content: string, extra: Part[] = []): Promise<IcsImportResult> {
  const res = await postFile(content, extra);
  expect(res.statusCode, res.body).toBe(201);
  return IcsImportResultSchema.parse(res.json());
}

async function syncFile(sourceId: string, content: string): Promise<IcsImportResult> {
  const body = multipart([filePart(content)]);
  const res = await t.request({
    method: 'POST',
    url: `${API}/calendar/sources/${sourceId}/sync`,
    payload: body.payload,
    headers: body.headers,
  });
  expect(res.statusCode, res.body).toBe(200);
  return IcsImportResultSchema.parse(res.json());
}

async function postJson(url: string, payload: object, headers: Record<string, string> = {}) {
  return t.request({ method: 'POST', url: `${API}${url}`, payload, headers });
}

async function errorOf(res: { statusCode: number; json: () => unknown }, status: number) {
  expect(res.statusCode).toBe(status);
  return ApiErrorSchema.parse(res.json()).error;
}

async function allEvents(query = 'include_cancelled=true'): Promise<CalendarEvent[]> {
  const items: CalendarEvent[] = [];
  let cursor: string | null = null;
  do {
    const res = await t.request({
      method: 'GET',
      url: `${API}/calendar/events?${query}&limit=200${cursor ? `&cursor=${cursor}` : ''}`,
    });
    expect(res.statusCode, res.body).toBe(200);
    const page = CalendarEventListSchema.parse(res.json());
    items.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return items;
}

async function createSemester(body: object = {}): Promise<Semester> {
  const res = await postJson('/semesters', {
    name: 'HS 2026',
    starts_on: '2026-09-01',
    ends_on: '2027-03-31',
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Semester;
}

async function createModule(semesterId: string, name: string, extra: object = {}): Promise<Module> {
  const res = await postJson('/modules', { semester_id: semesterId, name, ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Module;
}

const wrap = (body: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//\r\n${body}END:VCALENDAR\r\n`;
const weekly = (uid: string, title: string, count: number, extra = '') =>
  wrap(
    `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;TZID=Europe/Zurich:20261109T101500\r\nDTEND;TZID=Europe/Zurich:20261109T120000\r\n` +
      `RRULE:FREQ=WEEKLY;COUNT=${count}\r\nSUMMARY:${title}\r\n${extra}END:VEVENT\r\n`,
  );

// ---------------------------------------------------------------------------------------------
// Alle 13 Testdateien
// ---------------------------------------------------------------------------------------------

/** Kürzel, wie sie die Titel in den Testdaten benutzen (F-KAL-02) */
const SHORT_NAMES: Record<string, string> = {
  'Mikroökonomie I': 'Mikro',
  Datenbanksysteme: 'DBS',
  Wirtschaftsinformatik: 'WI',
  'Makroökonomie I': 'Makro',
  'Statistik I': 'Stat I',
  'Operations Research': 'OR',
};

interface ExpectedEvent {
  external_uid: string;
  recurrence_id: string | null;
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  cancelled: boolean;
  kind_erwartet: string | null;
  modul_erwartet: string | null;
}

const icsFiles = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.ics'))
  .sort();

describe('Import der Testdaten (tests/fixtures/ics)', () => {
  for (const file of icsFiles) {
    it(`${file}: Termine, Art und Modul wie erwartet`, async () => {
      const expected = (JSON.parse(fixture(file.replace(/\.ics$/, '.json'))) as { termine: ExpectedEvent[] })
        .termine;
      const semester = await createSemester();
      const names = [
        ...new Set(expected.map((e) => e.modul_erwartet).filter((n): n is string => n !== null)),
      ];
      const modules = new Map<string, Module>();
      for (const name of names) {
        modules.set(
          name,
          await createModule(semester.id, name, SHORT_NAMES[name] ? { short_name: SHORT_NAMES[name] } : {}),
        );
      }

      const result = await importFile(fixture(file), [{ name: 'name', value: file }]);
      expect(result.warnings).toEqual([]);
      expect(result.source).toMatchObject({
        kind: 'ics_file',
        name: file,
        url: null,
        readonly: true,
        last_error: null,
      });
      expect(result.source.event_count).toBe(expected.length);
      expect(result.counts).toMatchObject({
        neu: expected.length,
        geaendert: 0,
        entfallen: 0,
        unveraendert: 0,
      });
      expect(result.neu).toHaveLength(expected.length);

      const events = await allEvents();
      expect(events).toHaveLength(expected.length);
      const byKey = new Map(events.map((e) => [`${e.external_uid}|${e.recurrence_id ?? ''}`, e]));
      for (const want of expected) {
        const got = byKey.get(`${want.external_uid}|${want.recurrence_id ?? ''}`);
        const label = `${want.external_uid} ${want.recurrence_id ?? want.starts_at}`;
        expect(got, label).toBeDefined();
        expect(got).toMatchObject({
          title: want.title,
          location: want.location,
          all_day: want.all_day,
          cancelled: want.cancelled,
          source_id: result.source.id,
          assigned_by: 'auto',
          session_id: null,
        });
        expect(Date.parse(got?.starts_at ?? ''), label).toBe(Date.parse(want.starts_at));
        expect(Date.parse(got?.ends_at ?? ''), label).toBe(Date.parse(want.ends_at));
        if (want.kind_erwartet) expect(got?.kind, label).toBe(want.kind_erwartet);
        const wantedModule = want.modul_erwartet ? modules.get(want.modul_erwartet)?.id : null;
        expect(got?.module_id, label).toBe(wantedModule ?? null);
      }
      const withModule = expected.filter((e) => e.modul_erwartet !== null).length;
      expect(result.counts.zugeordnet).toBe(withModule);
      expect(result.zugeordnet).toHaveLength(withModule);
      expect(result.counts.ohne_modul).toBe(
        expected.filter((e) => e.modul_erwartet === null && !e.cancelled).length,
      );
      // Sessions werden für alle neuen Termine nachgeführt, in einem Aufruf
      expect(ensure).toHaveBeenCalledTimes(1);
      expect(new Set(ensure.mock.calls[0]?.[1])).toEqual(new Set(events.map((e) => e.id)));
    });
  }
});

describe('Abgleich (Fall 11)', () => {
  const expectation = JSON.parse(fixture('11-abgleich-erwartung.json')) as {
    geaendert: { external_uid: string; recurrence_id: string | null }[];
    entfallen: { external_uid: string; recurrence_id: string | null }[];
    neu: { external_uid: string; recurrence_id: string | null }[];
  };
  const keys = (refs: { external_uid: string; recurrence_id: string | null }[]) =>
    refs.map((r) => ({ external_uid: r.external_uid, recurrence_id: r.recurrence_id }));

  it('neu, geändert und entfallen wie in 11-abgleich-erwartung.json', async () => {
    const first = await importFile(fixture('11a-abgleich-vorher.ics'));
    const second = await syncFile(first.source.id, fixture('11b-abgleich-nachher.ics'));
    expect(keys(second.neu)).toEqual(expectation.neu);
    expect(keys(second.geaendert)).toEqual(expectation.geaendert);
    expect(keys(second.entfallen)).toEqual(expectation.entfallen);
    expect(second.counts).toMatchObject({
      neu: expectation.neu.length,
      geaendert: expectation.geaendert.length,
      entfallen: expectation.entfallen.length,
    });
    expect(second.counts.unveraendert).toBe(
      first.counts.neu - expectation.geaendert.length - expectation.entfallen.length,
    );
    expect(second.source.event_count).toBe(first.source.event_count + 1);

    const events = await allEvents();
    const gone = events.find((e) => e.recurrence_id === expectation.entfallen[0]?.recurrence_id);
    // Entfallen heißt abgesagt, nie gelöscht (F-KAL-01)
    expect(gone).toMatchObject({ cancelled: true, deleted_at: null });
    const moved = events.find((e) => e.recurrence_id === expectation.geaendert[0]?.recurrence_id);
    const before = first.neu.find((e) => e.recurrence_id === expectation.geaendert[0]?.recurrence_id);
    expect(moved?.starts_at).not.toBe(before?.starts_at);
    expect(moved?.cancelled).toBe(false);
  });

  it('kommt ein entfallener Termin wieder, ist er wieder aktiv (geändert)', async () => {
    const first = await importFile(fixture('11a-abgleich-vorher.ics'));
    await syncFile(first.source.id, fixture('11b-abgleich-nachher.ics'));
    const back = await syncFile(first.source.id, fixture('11a-abgleich-vorher.ics'));
    expect(keys(back.geaendert)).toEqual(expect.arrayContaining(expectation.geaendert));
    expect(back.geaendert.map((e) => e.recurrence_id)).toContain(expectation.entfallen[0]?.recurrence_id);
    // Der Zusatztermin fehlt jetzt in der Quelle
    expect(keys(back.entfallen)).toEqual(expectation.neu);
    const events = await allEvents();
    expect(events.filter((e) => e.cancelled).map((e) => e.external_uid)).toEqual(
      expectation.neu.map((e) => e.external_uid),
    );
  });

  it('Termine, die in der Quelle fehlen, werden abgesagt und nie gelöscht; Sessions werden benachrichtigt', async () => {
    const first = await importFile(weekly('serie@test', 'Mikroökonomie I', 4));
    ensure.mockClear();
    const second = await syncFile(first.source.id, weekly('serie@test', 'Mikroökonomie I', 2));
    expect(second.counts).toMatchObject({ neu: 0, geaendert: 0, entfallen: 2, unveraendert: 2 });
    const events = await allEvents();
    expect(events).toHaveLength(4);
    expect(events.filter((e) => e.cancelled)).toHaveLength(2);
    expect(events.every((e) => e.deleted_at === null)).toBe(true);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure.mock.calls[0]?.[1]).toHaveLength(2);
    // Ohne `include_cancelled` fehlen sie
    expect(await allEvents('include_cancelled=false')).toHaveLength(2);
  });
});

describe('erneuter Import ist idempotent', () => {
  it('derselbe Stand ändert nichts: keine Duplikate, keine neuen Zeitstempel, kein Aufruf für Sessions', async () => {
    const semester = await createSemester();
    await createModule(semester.id, 'Datenbanksysteme', { short_name: 'DBS' });
    const first = await importFile(fixture('10-mini-semester-6-module.ics'));
    const before = await allEvents();
    ensure.mockClear();

    const second = await syncFile(first.source.id, fixture('10-mini-semester-6-module.ics'));
    expect(second.counts).toMatchObject({
      neu: 0,
      geaendert: 0,
      entfallen: 0,
      zugeordnet: 0,
      unveraendert: before.length,
    });
    const after = await allEvents();
    expect(after).toEqual(before);
    expect(ensure).not.toHaveBeenCalled();
    const rows = await t.handle.sql`SELECT count(*)::int AS n FROM calendar_event`;
    expect(rows[0]?.n).toBe(before.length);
    expect(second.source.last_synced_at).toBe(NOW.toISOString());
  });

  it('mehrere Läufe hintereinander und gleichzeitig ergeben keine Duplikate', async () => {
    const created = await importFile(weekly('x@test', 'Statistik I', 5));
    await Promise.all([1, 2, 3].map(() => syncFile(created.source.id, weekly('x@test', 'Statistik I', 5))));
    const rows = await t.handle.sql`SELECT count(*)::int AS n FROM calendar_event`;
    expect(rows[0]?.n).toBe(5);
  });

  it('dieselbe Anfrage mit demselben Idempotency-Key legt keine zweite Quelle an', async () => {
    const key = uuidv7();
    const content = weekly('k@test', 'Statistik I', 2);
    const a = await postFile(content, [], { 'idempotency-key': key });
    const b = await postFile(content, [], { 'idempotency-key': key });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(b.json()).toEqual(a.json());
    const sources = await t.handle.sql`SELECT count(*)::int AS n FROM calendar_source`;
    expect(sources[0]?.n).toBe(1);
    const other = await postFile(weekly('k2@test', 'Anderes', 2), [], { 'idempotency-key': key });
    expect((await errorOf(other, 422)).code).toBe('idempotency_key_reused');
  });
});

describe('Änderungen aus der Quelle und Zuordnung', () => {
  it('ein verschobenes Vorkommen (RECURRENCE-ID) wird übernommen, Schlüssel und Zuordnung bleiben', async () => {
    const semester = await createSemester();
    const mod = await createModule(semester.id, 'Statistik I');
    const first = await importFile(weekly('v@test', 'Statistik I – Vorlesung', 3));
    expect(first.counts.zugeordnet).toBe(3);
    const moved = weekly('v@test', 'Statistik I – Vorlesung', 3, '').replace(
      'END:VCALENDAR',
      'BEGIN:VEVENT\r\nUID:v@test\r\nRECURRENCE-ID;TZID=Europe/Zurich:20261116T101500\r\n' +
        'DTSTART;TZID=Europe/Zurich:20261117T141500\r\nDTEND;TZID=Europe/Zurich:20261117T160000\r\n' +
        'SUMMARY:Statistik I – Vorlesung\r\nEND:VEVENT\r\nEND:VCALENDAR',
    );
    const second = await syncFile(first.source.id, moved);
    expect(second.counts).toMatchObject({
      geaendert: 1,
      neu: 0,
      entfallen: 0,
      zugeordnet: 0,
      unveraendert: 2,
    });
    expect(second.geaendert[0]).toMatchObject({
      recurrence_id: '2026-11-16T10:15:00+01:00',
      starts_at: '2026-11-17T13:15:00.000Z',
    });
    const events = await allEvents();
    expect(events.map((e) => e.starts_at)).toEqual([
      '2026-11-09T09:15:00.000Z',
      '2026-11-17T13:15:00.000Z',
      '2026-11-23T09:15:00.000Z',
    ]);
    expect(events.every((e) => e.module_id === mod.id)).toBe(true);
  });

  it('ändert sich die Startzeit der ganzen Serie, ändert sich die Kennung der Vorkommen: neu und entfallen', async () => {
    const first = await importFile(weekly('serie@test', 'Statistik I', 2));
    const shifted = weekly('serie@test', 'Statistik I', 2).replace('T101500', 'T141500');
    const second = await syncFile(first.source.id, shifted);
    expect(second.counts).toMatchObject({ neu: 2, entfallen: 2, geaendert: 0 });
  });

  it('eine geänderte Beschreibung wird still übernommen (nicht „geändert“) und kann die Zuordnung auslösen', async () => {
    const semester = await createSemester();
    const mod = await createModule(semester.id, 'Statistik I');
    const first = await importFile(weekly('d@test', 'Vorlesung', 2, 'DESCRIPTION:Irgendein Kurs\r\n'));
    expect(first.counts.zugeordnet).toBe(0);
    ensure.mockClear();
    const second = await syncFile(
      first.source.id,
      weekly('d@test', 'Vorlesung', 2, 'DESCRIPTION:Kurs Statistik I\r\n'),
    );
    expect(second.counts).toMatchObject({ geaendert: 0, neu: 0, entfallen: 0, zugeordnet: 2 });
    expect((await allEvents()).every((e) => e.module_id === mod.id)).toBe(true);
    // Nur die Beschreibung ändert sich: geschrieben, aber ohne Aufruf für Sessions
    ensure.mockClear();
    const third = await syncFile(
      first.source.id,
      weekly('d@test', 'Vorlesung', 2, 'DESCRIPTION:Kurs Statistik I, Raum 5\r\n'),
    );
    expect(third.counts).toMatchObject({ geaendert: 0, unveraendert: 2 });
    expect(ensure).not.toHaveBeenCalled();
    expect((await allEvents())[0]?.description).toBe('Kurs Statistik I, Raum 5');
  });

  it('Titel- und Ortsänderungen sind „geändert“; Absage durch STATUS:CANCELLED zählt als „entfallen“', async () => {
    const first = await importFile(weekly('c@test', 'Alt', 2, 'LOCATION:Raum 1\r\n'));
    const renamed = await syncFile(first.source.id, weekly('c@test', 'Neu', 2, 'LOCATION:Raum 2\r\n'));
    expect(renamed.counts.geaendert).toBe(2);
    expect(renamed.geaendert.map((e) => e.title)).toEqual(['Neu', 'Neu']);
    const cancelled = await syncFile(
      first.source.id,
      weekly('c@test', 'Neu', 2, 'LOCATION:Raum 2\r\nSTATUS:CANCELLED\r\n'),
    );
    expect(cancelled.counts).toMatchObject({ entfallen: 2, geaendert: 0 });
  });

  it('Module aus einem anderen Semester zählen, wenn das Semester den Termin nicht enthält, nicht', async () => {
    const hs = await createSemester({ name: 'HS 2026', is_current: false });
    const fs = await createSemester({
      name: 'FS 2027',
      starts_on: '2027-02-15',
      ends_on: '2027-06-30',
      is_current: true,
    });
    const inHs = await createModule(hs.id, 'Statistik I');
    await createModule(fs.id, 'Statistik I');
    const result = await importFile(weekly('s@test', 'Statistik I', 1)); // 9. November 2026: im HS
    expect(result.neu[0]?.module_id).toBe(inHs.id);
  });

  it('ohne passendes Semester gelten die Module des aktuellen Semesters', async () => {
    const current = await createSemester({ name: 'Ohne Datum', starts_on: null, ends_on: null });
    const mod = await createModule(current.id, 'Statistik I');
    const result = await importFile(weekly('r@test', 'Statistik I', 1));
    expect(result.neu[0]?.module_id).toBe(mod.id);
  });

  it('archivierte und gelöschte Semester zählen nicht', async () => {
    const old = await createSemester({ is_current: false });
    await createModule(old.id, 'Statistik I');
    const archived = await t.request({
      method: 'PATCH',
      url: `${API}/semesters/${old.id}`,
      payload: { archived: true },
    });
    expect(archived.statusCode).toBe(200);
    const result = await importFile(weekly('a@test', 'Statistik I', 1));
    expect(result.neu[0]?.module_id).toBeNull();
    expect(result.counts.ohne_modul).toBe(1);
  });

  it('mehrdeutige Titel bleiben ohne Modul und tauchen als Vorschlag auf', async () => {
    const semester = await createSemester();
    await createModule(semester.id, 'Mikroökonomie I');
    await createModule(semester.id, 'Makroökonomie I');
    const result = await importFile(weekly('m@test', 'Mikroökonomie I und Makroökonomie I', 2));
    expect(result.counts).toMatchObject({ zugeordnet: 0, ohne_modul: 2 });
    expect(result.module_suggestions).toHaveLength(1);
  });
});

describe('Modulvorschläge', () => {
  it('fasst unbekannte Titel zu Vorschlägen zusammen, je Serie ein Termin; Feiertage nicht', async () => {
    const result = await importFile(fixture('10-mini-semester-6-module.ics'));
    expect(result.counts.zugeordnet).toBe(0);
    const names = result.module_suggestions.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Mikroökonomie I',
        'Datenbanksysteme',
        'Wirtschaftsinformatik',
        'Statistik I',
        'Operations Research',
      ]),
    );
    const mikro = result.module_suggestions.find((s) => s.name === 'Mikroökonomie I');
    const events = await allEvents();
    // „MikroÖk I Ü“ ist dasselbe Modul abgekürzt und steckt im selben Vorschlag
    const mikroEvents = events.filter(
      (e) => e.title.startsWith('Mikroökonomie I') || e.title.startsWith('MikroÖk I'),
    );
    expect(mikro?.event_count).toBe(mikroEvents.length);
    expect(mikro?.kind).toBe('vorlesung');
    expect(mikro?.short).toBe('MikroÖk I');
    // Ein Termin je Serie (UID), und zwar der früheste
    const uids = new Set(mikroEvents.map((e) => e.external_uid));
    expect(mikro?.series_event_ids).toHaveLength(uids.size);
    for (const id of mikro?.series_event_ids ?? []) {
      const event = events.find((e) => e.id === id);
      const earliest = mikroEvents
        .filter((e) => e.external_uid === event?.external_uid)
        .map((e) => e.starts_at)
        .sort()[0];
      expect(event?.starts_at).toBe(earliest);
    }
    // Kürzel und Langname werden ein Vorschlag, das Kürzel steht in `short`
    const shortOf = (name: string) => result.module_suggestions.find((x) => x.name === name)?.short;
    expect(shortOf('Statistik I')).toBe('Stat I');
    expect(shortOf('Wirtschaftsinformatik')).toBe('WI');
    expect(shortOf('Operations Research')).toBe('OR');
    expect(shortOf('Datenbanksysteme')).toBe('DBS');
    for (const abbreviated of ['Stat I', 'WI', 'OR', 'DBS', 'MikroÖk I'])
      expect(names).not.toContain(abbreviated);
    expect(result.module_suggestions.every((s) => s.event_count >= 1 && s.series_event_ids.length >= 1)).toBe(
      true,
    );
  });

  it('Feiertage (fest) schlagen kein Modul vor', async () => {
    const result = await importFile(fixture('08-ganztaegige-termine.ics'));
    expect(result.neu.map((e) => e.kind).sort()).toEqual(['fest', 'pruefung']);
    expect(result.module_suggestions.map((s) => s.name)).toEqual(['Mikroökonomie I']);
  });

  it('Modul anlegen und Serie zuordnen, danach kein Vorschlag mehr', async () => {
    const first = await importFile(weekly('neu@test', 'Ökonometrie – Vorlesung', 3));
    const suggestion = first.module_suggestions[0];
    expect(suggestion).toMatchObject({ name: 'Ökonometrie', kind: 'vorlesung', event_count: 3 });
    const semester = await createSemester();
    const mod = await createModule(semester.id, suggestion?.name ?? '');
    const patched = await t.request({
      method: 'PATCH',
      url: `${API}/calendar/events/${suggestion?.series_event_ids[0]}`,
      payload: { module_id: mod.id, scope: 'serie' },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(CalendarEventListSchema.parse(patched.json()).items).toHaveLength(3);
    const again = await syncFile(first.source.id, weekly('neu@test', 'Ökonometrie – Vorlesung', 3));
    expect(again.module_suggestions).toEqual([]);
    expect(again.counts).toMatchObject({ ohne_modul: 0, unveraendert: 3 });
  });
});

describe('PATCH /calendar/events/{id}', () => {
  async function setup() {
    const semester = await createSemester();
    const a = await createModule(semester.id, 'Statistik I');
    const b = await createModule(semester.id, 'Mikroökonomie I');
    const first = await importFile(weekly('p@test', 'Unbekannt', 3));
    const events = await allEvents();
    return { a, b, first, events };
  }
  const patch = (id: string, payload: object) =>
    t.request({ method: 'PATCH', url: `${API}/calendar/events/${id}`, payload });

  it('Standard ist die Serie: alle Termine mit gleicher UID, assigned_by = manuell', async () => {
    const { a, events, first } = await setup();
    ensure.mockClear();
    const res = await patch(events[1]?.id ?? '', { module_id: a.id, kind: 'uebung' });
    expect(res.statusCode, res.body).toBe(200);
    const list = CalendarEventListSchema.parse(res.json());
    expect(list.next_cursor).toBeNull();
    expect(list.items).toHaveLength(3);
    expect(
      list.items.every((e) => e.module_id === a.id && e.kind === 'uebung' && e.assigned_by === 'manuell'),
    ).toBe(true);
    expect(list.items.map((e) => e.starts_at)).toEqual(events.map((e) => e.starts_at));
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(new Set(ensure.mock.calls[0]?.[1])).toEqual(new Set(events.map((e) => e.id)));
    // Der Abgleich ändert eine manuelle Zuordnung nie mehr
    await createModule(
      (
        await createSemester({
          name: 'FS 2028',
          starts_on: '2028-02-01',
          ends_on: '2028-06-30',
          is_current: false,
        })
      ).id,
      'Unbekannt',
    );
    const again = await syncFile(first.source.id, weekly('p@test', 'Unbekannt', 3));
    expect(again.counts).toMatchObject({ unveraendert: 3, zugeordnet: 0 });
    expect((await allEvents()).every((e) => e.module_id === a.id && e.kind === 'uebung')).toBe(true);
  });

  it('scope = einzeln ändert nur diesen Termin', async () => {
    const { a, b, events } = await setup();
    const res = await patch(events[0]?.id ?? '', { module_id: a.id, scope: 'einzeln' });
    const list = CalendarEventListSchema.parse(res.json());
    expect(list.items.map((e) => e.id)).toEqual([events[0]?.id]);
    const after = await allEvents();
    expect(after.map((e) => [e.module_id, e.assigned_by])).toEqual([
      [a.id, 'manuell'],
      [null, 'auto'],
      [null, 'auto'],
    ]);
    // und ein später hinzukommendes Vorkommen erbt das nicht
    const grown = await syncFile((await allEvents())[0]?.source_id ?? '', weekly('p@test', 'Unbekannt', 5));
    expect(grown.counts.neu).toBe(2);
    expect(b.id).toBeDefined();
    const final = await allEvents();
    expect(final.slice(3).every((e) => e.module_id === null && e.assigned_by === 'auto')).toBe(true);
  });

  it('eine manuelle Zuordnung der Serie gilt auch für später hinzukommende Vorkommen', async () => {
    const { a, events, first } = await setup();
    await patch(events[2]?.id ?? '', { module_id: a.id, kind: 'tutorium' });
    const grown = await syncFile(first.source.id, weekly('p@test', 'Unbekannt', 5));
    expect(grown.counts.neu).toBe(2);
    expect(grown.zugeordnet).toEqual([]); // geerbt, nicht automatisch
    const final = await allEvents();
    expect(final).toHaveLength(5);
    expect(
      final.every((e) => e.module_id === a.id && e.kind === 'tutorium' && e.assigned_by === 'manuell'),
    ).toBe(true);
  });

  it('module_id: null nimmt das Modul weg (manuell)', async () => {
    const { a, events } = await setup();
    await patch(events[0]?.id ?? '', { module_id: a.id });
    const res = await patch(events[0]?.id ?? '', { module_id: null });
    const list = CalendarEventListSchema.parse(res.json());
    expect(list.items.every((e) => e.module_id === null && e.assigned_by === 'manuell')).toBe(true);
    // Manuell leer gelassen: kein Vorschlag mehr
    const sync = await syncFile(events[0]?.source_id ?? '', weekly('p@test', 'Unbekannt', 3));
    expect(sync.module_suggestions).toEqual([]);
  });

  it('Fehler: unbekannter Termin, unbekanntes Modul, ungültige Werte, leerer Body', async () => {
    const { events } = await setup();
    expect((await errorOf(await patch(uuidv7(), { kind: 'uebung' }), 404)).code).toBe(
      'calendar_event_not_found',
    );
    expect((await errorOf(await patch(events[0]?.id ?? '', { module_id: uuidv7() }), 404)).code).toBe(
      'module_not_found',
    );
    expect((await errorOf(await patch(events[0]?.id ?? '', { kind: 'party' }), 400)).code).toBe(
      'validation_failed',
    );
    expect(
      (await errorOf(await patch(events[0]?.id ?? '', { scope: 'alle', kind: 'uebung' }), 400)).code,
    ).toBe('validation_failed');
    expect((await errorOf(await patch(events[0]?.id ?? '', {}), 400)).code).toBe('validation_failed');
    expect((await errorOf(await patch('keine-uuid', { kind: 'uebung' }), 400)).code).toBe(
      'validation_failed',
    );
    // Nichts davon hat etwas geändert
    expect((await allEvents()).every((e) => e.assigned_by === 'auto')).toBe(true);
  });

  it('ein Fehler beim Nachführen der Sessions macht die Änderung rückgängig', async () => {
    const { a, events } = await setup();
    ensure.mockRejectedValueOnce(new Error('kaputt'));
    const res = await patch(events[0]?.id ?? '', { module_id: a.id });
    expect(res.statusCode).toBe(500);
    expect((await allEvents()).every((e) => e.module_id === null && e.assigned_by === 'auto')).toBe(true);
  });
});

describe('Quellen', () => {
  it('GET /calendar/sources: Liste mit event_count, ohne gelöschte', async () => {
    const a = await importFile(weekly('l1@test', 'Eins', 3), [{ name: 'name', value: 'Plan A' }]);
    await importFile(weekly('l2@test', 'Zwei', 2), [{ name: 'name', value: 'Plan B' }]);
    const res = await t.request({ method: 'GET', url: `${API}/calendar/sources` });
    const list = CalendarSourceListSchema.parse(res.json());
    expect(list.items.map((s) => [s.name, s.event_count])).toEqual([
      ['Plan A', 3],
      ['Plan B', 2],
    ]);
    const page = CalendarSourceListSchema.parse(
      (await t.request({ method: 'GET', url: `${API}/calendar/sources?limit=1` })).json(),
    );
    expect(page.items).toHaveLength(1);
    expect(page.next_cursor).not.toBeNull();
    const next = CalendarSourceListSchema.parse(
      (
        await t.request({ method: 'GET', url: `${API}/calendar/sources?limit=1&cursor=${page.next_cursor}` })
      ).json(),
    );
    expect(next.items[0]?.name).toBe('Plan B');
    expect(a.source.id).toBe(list.items[0]?.id);
  });

  it('Name: Standard ist der Dateiname, sonst das Feld name', async () => {
    const unnamed = await importFile(weekly('n1@test', 'x', 1));
    expect(unnamed.source.name).toBe('plan.ics');
    const named = await importFile(weekly('n2@test', 'x', 1), [{ name: 'name', value: '  Mein Plan ' }]);
    expect(named.source.name).toBe('Mein Plan');
  });

  it('eigene ID: 409 calendar_source_exists, wenn sie vergeben ist; ungültige ID: 400', async () => {
    const id = uuidv7();
    const first = await importFile(weekly('i1@test', 'x', 1), [{ name: 'id', value: id }]);
    expect(first.source.id).toBe(id);
    const again = await postFile(weekly('i2@test', 'x', 1), [{ name: 'id', value: id }]);
    const error = await errorOf(again, 409);
    expect(error).toMatchObject({ code: 'calendar_source_exists', details: { id } });
    expect(
      (await errorOf(await postFile(weekly('i3@test', 'x', 1), [{ name: 'id', value: 'ABC' }]), 400)).code,
    ).toBe('validation_failed');
  });

  it('DELETE löscht die Quelle samt Terminen weich (Papierkorb), nichts wird entfernt', async () => {
    const created = await importFile(weekly('d@test', 'Löschen', 3));
    const res = await t.request({ method: 'DELETE', url: `${API}/calendar/sources/${created.source.id}` });
    expect(res.statusCode).toBe(204);
    expect(await allEvents()).toEqual([]);
    expect(
      CalendarSourceListSchema.parse(
        (await t.request({ method: 'GET', url: `${API}/calendar/sources` })).json(),
      ).items,
    ).toEqual([]);
    const rows = await t.handle
      .sql`SELECT count(*)::int AS n, count(deleted_at)::int AS gone FROM calendar_event`;
    expect(rows[0]).toMatchObject({ n: 3, gone: 3 });
    const sources = await t.handle.sql`SELECT deleted_at FROM calendar_source`;
    expect(sources[0]?.deleted_at).not.toBeNull();
    expect(
      (
        await errorOf(
          await t.request({ method: 'DELETE', url: `${API}/calendar/sources/${created.source.id}` }),
          404,
        )
      ).code,
    ).toBe('calendar_source_not_found');
    const sync = await t.request({
      method: 'POST',
      url: `${API}/calendar/sources/${created.source.id}/sync`,
    });
    expect((await errorOf(sync, 404)).code).toBe('calendar_source_not_found');
  });

  it('Datei-Quelle ohne neue Datei: 400 file_missing; unbekannte Quelle: 404', async () => {
    const created = await importFile(weekly('f@test', 'x', 1));
    const res = await t.request({ method: 'POST', url: `${API}/calendar/sources/${created.source.id}/sync` });
    expect((await errorOf(res, 400)).code).toBe('file_missing');
    expect(
      (
        await errorOf(
          await t.request({ method: 'POST', url: `${API}/calendar/sources/${uuidv7()}/sync` }),
          404,
        )
      ).code,
    ).toBe('calendar_source_not_found');
    expect(
      (await errorOf(await t.request({ method: 'POST', url: `${API}/calendar/sources/xyz/sync` }), 400)).code,
    ).toBe('validation_failed');
  });
});

describe('Dateien: Grenzen und Fehler', () => {
  it('über 5 MB: 413 file_too_large, nichts wird angelegt', async () => {
    const big = Buffer.concat([
      Buffer.from(weekly('big@test', 'x', 1)),
      Buffer.alloc(5 * 1024 * 1024 + 10, 'a'),
    ]);
    expect((await errorOf(await postFile(big), 413)).code).toBe('file_too_large');
    const rows = await t.handle.sql`SELECT count(*)::int AS n FROM calendar_source`;
    expect(rows[0]?.n).toBe(0);
  });

  it('genau 5 MB gehen noch', async () => {
    const head = weekly('five@test', 'x', 1).replace('END:VCALENDAR', '');
    const padding = `X-PAD:${'a'.repeat(5 * 1024 * 1024 - head.length - 'END:VCALENDAR\r\n'.length - 10)}\r\n`;
    const content = `${head}${padding}END:VCALENDAR\r\n`;
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(5 * 1024 * 1024);
    const res = await postFile(content);
    expect(res.statusCode, res.body.slice(0, 300)).toBe(201);
  });

  it('kein Kalender: 422 ics_invalid, nichts wird angelegt', async () => {
    for (const bad of ['Hallo', '<html></html>', '', 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n']) {
      const res = await postFile(bad);
      expect((await errorOf(res, 422)).code, bad).toBe('ics_invalid');
    }
    const rows = await t.handle.sql`SELECT count(*)::int AS n FROM calendar_source`;
    expect(rows[0]?.n).toBe(0);
  });

  it('ohne Datei, falsches Feld, zwei Dateien, kein multipart', async () => {
    const none = multipart([{ name: 'name', value: 'x' }]);
    const res1 = await t.request({
      method: 'POST',
      url: `${API}/calendar/sources`,
      payload: none.payload,
      headers: none.headers,
    });
    expect((await errorOf(res1, 400)).code).toBe('file_missing');
    const wrong = multipart([{ name: 'datei', value: weekly('w@test', 'x', 1), filename: 'a.ics' }]);
    const res2 = await t.request({
      method: 'POST',
      url: `${API}/calendar/sources`,
      payload: wrong.payload,
      headers: wrong.headers,
    });
    expect((await errorOf(res2, 400)).code).toBe('unexpected_file');
    const two = multipart([filePart(weekly('w@test', 'x', 1)), filePart(weekly('w2@test', 'x', 1))]);
    const res3 = await t.request({
      method: 'POST',
      url: `${API}/calendar/sources`,
      payload: two.payload,
      headers: two.headers,
    });
    expect((await errorOf(res3, 400)).code).toBe('unexpected_file');
    const res4 = await t.request({
      method: 'POST',
      url: `${API}/calendar/sources`,
      payload: 'url=x',
      headers: { 'content-type': 'text/plain' },
    });
    expect(res4.statusCode).toBeGreaterThanOrEqual(400);
    expect(res4.statusCode).toBeLessThan(500);
    const rows = await t.handle.sql`SELECT count(*)::int AS n FROM calendar_source`;
    expect(rows[0]?.n).toBe(0);
  });

  it('Umlaute im Dateinamen und in den Texten bleiben erhalten', async () => {
    const res = await importFile(fixture('09-faltung-umlaute-escaping.ics'), []);
    expect((await allEvents())[0]?.title).toBe(
      'Einführung in die Ökonometrie – Vorlesung: Schätzer, Tests; Modellwahl & Überprüfung',
    );
    expect(res.source.name).toBe('plan.ics');
    const named = await postFile(
      fixture('09-faltung-umlaute-escaping.ics').replace('hs26-oekonometrie', 'hs27-oekonometrie'),
    );
    expect(named.statusCode).toBe(201);
  });

  it('ensurePlannedSessions-Fehler: der ganze Import wird zurückgenommen', async () => {
    ensure.mockRejectedValueOnce(new Error('kaputt'));
    const res = await postFile(weekly('rb@test', 'x', 2));
    expect(res.statusCode).toBe(500);
    const rows = await t.handle
      .sql`SELECT (SELECT count(*) FROM calendar_source)::int AS s, (SELECT count(*) FROM calendar_event)::int AS e`;
    expect(rows[0]).toMatchObject({ s: 0, e: 0 });
  });

  it('mit der echten Funktion aus sessions.ts (bisher nur ein Gerüst) scheitert der Import nicht', async () => {
    const restore = setCalendarHooks({ ensurePlannedSessions: defaultEnsure });
    try {
      const res = await postFile(weekly('real@test', 'x', 2));
      expect(res.statusCode, res.body).toBe(201);
      expect(await allEvents()).toHaveLength(2);
    } finally {
      restore();
    }
  });
});

describe('URL-Quellen', () => {
  const URL_A = 'https://stundenplan.example.edu/plan.ics';

  it('webcal:// wird als https:// gespeichert, Name ist der Host; 201 mit IcsImportResult', async () => {
    fetchMock.mockResolvedValue(weekly('u@test', 'Statistik I', 3));
    const res = await postJson('/calendar/sources', { url: 'webcal://stundenplan.example.edu/plan.ics' });
    expect(res.statusCode, res.body).toBe(201);
    const result = IcsImportResultSchema.parse(res.json());
    expect(fetchMock).toHaveBeenCalledWith(URL_A);
    expect(result.source).toMatchObject({
      kind: 'ics_url',
      url: URL_A,
      name: 'stundenplan.example.edu',
      readonly: true,
      event_count: 3,
      last_error: null,
    });
    expect(result.counts.neu).toBe(3);
  });

  it('eigener Name und eigene ID', async () => {
    fetchMock.mockResolvedValue(weekly('u@test', 'x', 1));
    const id = uuidv7();
    const result = IcsImportResultSchema.parse(
      (await postJson('/calendar/sources', { id, url: URL_A, name: 'HSG Stundenplan' })).json(),
    );
    expect(result.source).toMatchObject({ id, name: 'HSG Stundenplan' });
  });

  it('dieselbe URL zweimal: 409 calendar_source_exists mit details.id (auch webcal und http-Schreibweise derselben Adresse)', async () => {
    fetchMock.mockResolvedValue(weekly('u@test', 'x', 1));
    const first = IcsImportResultSchema.parse((await postJson('/calendar/sources', { url: URL_A })).json());
    const again = await postJson('/calendar/sources', { url: URL_A });
    expect(await errorOf(again, 409)).toMatchObject({
      code: 'calendar_source_exists',
      details: { id: first.source.id },
    });
    const webcal = await postJson('/calendar/sources', { url: 'webcal://stundenplan.example.edu/plan.ics' });
    expect((await errorOf(webcal, 409)).code).toBe('calendar_source_exists');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('nach dem Löschen lässt sich dieselbe URL wieder anlegen', async () => {
    fetchMock.mockResolvedValue(weekly('u@test', 'x', 2));
    const first = IcsImportResultSchema.parse((await postJson('/calendar/sources', { url: URL_A })).json());
    await t.request({ method: 'DELETE', url: `${API}/calendar/sources/${first.source.id}` });
    const second = await postJson('/calendar/sources', { url: URL_A });
    expect(second.statusCode, second.body).toBe(201);
    expect(await allEvents()).toHaveLength(2);
  });

  it.each([
    [{ url: 'ftp://stundenplan.example.edu/plan.ics' }],
    [{ url: 'file:///etc/passwd' }],
    [{ url: 'javascript:alert(1)' }],
    [{ url: 'stundenplan.example.edu/plan.ics' }],
    [{ url: 'https://nutzer:geheim@stundenplan.example.edu/plan.ics' }],
    [{ url: '' }],
    [{}],
    [{ url: 'https://stundenplan.example.edu/plan.ics', name: '' }],
    [{ url: 'https://stundenplan.example.edu/plan.ics', extra: 1 }],
    [{ url: 'https://stundenplan.example.edu/plan.ics', id: 'ABC' }],
  ])('ungültiger Body %j: 400 validation_failed, kein Abruf', async (body) => {
    expect((await errorOf(await postJson('/calendar/sources', body), 400)).code).toBe('validation_failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Abruf scheitert beim Anlegen: 502 ics_fetch_failed mit details.reason, es entsteht keine Quelle', async () => {
    for (const reason of ['timeout', 'too_large', 'too_many_redirects', 'status_404'] as const) {
      fetchMock.mockRejectedValueOnce(new IcsFetchError(reason, 'x'));
      const res = await postJson('/calendar/sources', { url: URL_A });
      expect(await errorOf(res, 502)).toMatchObject({ code: 'ics_fetch_failed', details: { reason } });
    }
    const rows = await t.handle.sql`SELECT count(*)::int AS n FROM calendar_source`;
    expect(rows[0]?.n).toBe(0);
  });

  it('die URL liefert keinen Kalender: 422 ics_invalid', async () => {
    fetchMock.mockResolvedValue('<html>Login</html>');
    expect((await errorOf(await postJson('/calendar/sources', { url: URL_A }), 422)).code).toBe(
      'ics_invalid',
    );
  });

  it('Sync: ruft die URL neu ab, übernimmt Änderungen und setzt last_error zurück', async () => {
    fetchMock.mockResolvedValueOnce(weekly('u@test', 'Statistik I', 3));
    const created = IcsImportResultSchema.parse((await postJson('/calendar/sources', { url: URL_A })).json());
    fetchMock.mockRejectedValueOnce(new IcsFetchError('timeout', 'zu langsam'));
    const failed = await postJson(`/calendar/sources/${created.source.id}/sync`, {});
    expect(await errorOf(failed, 502)).toMatchObject({
      code: 'ics_fetch_failed',
      details: { reason: 'timeout' },
    });
    const afterFail = CalendarSourceListSchema.parse(
      (await t.request({ method: 'GET', url: `${API}/calendar/sources` })).json(),
    );
    expect(afterFail.items[0]?.last_error).toContain('timeout');
    // Die Termine bleiben unberührt
    expect(await allEvents()).toHaveLength(3);

    fetchMock.mockResolvedValueOnce(weekly('u@test', 'Statistik I', 4));
    const ok = await postJson(`/calendar/sources/${created.source.id}/sync`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    const result = IcsImportResultSchema.parse(ok.json());
    expect(result.counts).toMatchObject({ neu: 1, unveraendert: 3 });
    expect(result.source.last_error).toBeNull();
    expect(result.source.last_synced_at).toBe(NOW.toISOString());
  });

  it('Sync: ungültiger Inhalt setzt last_error und lässt die Termine in Ruhe', async () => {
    fetchMock.mockResolvedValueOnce(weekly('u@test', 'x', 2));
    const created = IcsImportResultSchema.parse((await postJson('/calendar/sources', { url: URL_A })).json());
    fetchMock.mockResolvedValueOnce('Wartungsarbeiten');
    const res = await postJson(`/calendar/sources/${created.source.id}/sync`, {});
    expect((await errorOf(res, 422)).code).toBe('ics_invalid');
    const sources = await t.handle.sql`SELECT last_error FROM calendar_source`;
    expect(sources[0]?.last_error).toContain('lässt sich nicht lesen');
    expect((await allEvents()).filter((e) => !e.cancelled)).toHaveLength(2);
  });

  it('zwei Quellen mit demselben UID-Schlüssel stören sich nicht (Schlüssel enthält die Quelle)', async () => {
    fetchMock.mockResolvedValueOnce(weekly('gleich@test', 'Eins', 2));
    await postJson('/calendar/sources', { url: URL_A });
    fetchMock.mockResolvedValueOnce(weekly('gleich@test', 'Zwei', 2));
    await postJson('/calendar/sources', { url: 'https://zweite.example.edu/plan.ics' });
    const events = await allEvents();
    expect(events).toHaveLength(4);
    expect(new Set(events.map((e) => e.source_id)).size).toBe(2);
  });
});

describe('URL-Quellen: Schutz vor Abrufen ins lokale Netz (SSRF), mit dem echten Abruf', () => {
  let original: typeof calendarHooks.fetchIcs;
  beforeEach(async () => {
    const real = await import('../../src/services/calendar-fetch.ts');
    original = calendarHooks.fetchIcs;
    calendarHooks.fetchIcs = (url) => real.fetchIcs(url, { timeoutMs: 3000 });
  });
  afterEach(() => {
    calendarHooks.fetchIcs = original;
  });

  it.each([
    'http://127.0.0.1/plan.ics',
    'http://localhost:4710/api/v1/health',
    'https://[::1]/plan.ics',
    'http://10.0.0.1/plan.ics',
    'http://192.168.178.1/plan.ics',
    'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/plan.ics',
    'webcal://127.0.0.1/plan.ics',
  ])('%s: 502 ics_fetch_failed (blocked_address), keine Quelle', async (url) => {
    const res = await postJson('/calendar/sources', { url });
    expect(await errorOf(res, 502)).toMatchObject({
      code: 'ics_fetch_failed',
      details: { reason: 'blocked_address' },
    });
    const rows = await t.handle.sql`SELECT count(*)::int AS n FROM calendar_source`;
    expect(rows[0]?.n).toBe(0);
  });

  it('eine schon gespeicherte Quelle, deren Adresse später ins lokale Netz zeigt, wird nicht abgerufen und meldet den Fehler', async () => {
    const id = uuidv7();
    await t.handle.sql`INSERT INTO calendar_source (id, user_id, kind, name, url, readonly)
      VALUES (${id}, ${SINGLE_USER_ID}, 'ics_url', 'intern', 'http://127.0.0.1/plan.ics', true)`;
    const res = await postJson(`/calendar/sources/${id}/sync`, {});
    expect(await errorOf(res, 502)).toMatchObject({ details: { reason: 'blocked_address' } });
    const rows = await t.handle.sql`SELECT last_error FROM calendar_source WHERE id = ${id}`;
    expect(rows[0]?.last_error).toContain('blocked_address');
  });
});

describe('Zeitplan: beim Start und alle 6 h', () => {
  it('syncAllUrlSources gleicht jede URL-Quelle ab, Fehler einer Quelle stoppen die anderen nicht; Datei-Quellen bleiben', async () => {
    fetchMock.mockResolvedValueOnce(weekly('s1@test', 'Eins', 2));
    const one = IcsImportResultSchema.parse(
      (await postJson('/calendar/sources', { url: 'https://a.example.edu/a.ics' })).json(),
    );
    fetchMock.mockResolvedValueOnce(weekly('s2@test', 'Zwei', 2));
    const two = IcsImportResultSchema.parse(
      (await postJson('/calendar/sources', { url: 'https://b.example.edu/b.ics' })).json(),
    );
    const file = await importFile(weekly('s3@test', 'Drei', 2));
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('a.example.edu')) throw new IcsFetchError('status_503', 'down');
      return weekly('s2@test', 'Zwei', 3);
    });
    const log = { warn: vi.fn(), info: vi.fn() };
    await syncAllUrlSources(t.handle.db, log);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(1);
    const rows = await t.handle.sql`SELECT id, last_error FROM calendar_source ORDER BY created_at`;
    expect(rows.find((r) => r.id === one.source.id)?.last_error).toContain('status_503');
    expect(rows.find((r) => r.id === two.source.id)?.last_error).toBeNull();
    expect(rows.find((r) => r.id === file.source.id)?.last_error).toBeNull();
    expect((await allEvents()).filter((e) => e.external_uid === 's2@test')).toHaveLength(3);
  });

  it('beim Start des Core werden URL-Quellen abgeglichen', async () => {
    const id = uuidv7();
    await t.handle.sql`INSERT INTO calendar_source (id, user_id, kind, name, url, readonly)
      VALUES (${id}, ${SINGLE_USER_ID}, 'ics_url', 'Start', 'https://start.example.edu/plan.ics', true)`;
    fetchMock.mockResolvedValue(weekly('start@test', 'Start', 2));
    const started = await startTestApp();
    try {
      // onReady (ready/inject) läuft vor dem Binden: noch kein Abgleich, erst nach erfolgreichem listen (#170)
      expect(fetchMock).not.toHaveBeenCalled();
      await started.app.listen({ port: 0, host: '127.0.0.1' });
      await vi.waitFor(async () => {
        expect(fetchMock).toHaveBeenCalledWith('https://start.example.edu/plan.ics');
        const rows = await t.handle
          .sql`SELECT count(*)::int AS n FROM calendar_event WHERE source_id = ${id}`;
        expect(rows[0]?.n).toBe(2);
      });
    } finally {
      await started.close();
    }
  });

  it('Port belegt (EADDRINUSE): kein Abgleich beim Start', async () => {
    const id = uuidv7();
    await t.handle.sql`INSERT INTO calendar_source (id, user_id, kind, name, url, readonly)
      VALUES (${id}, ${SINGLE_USER_ID}, 'ics_url', 'Start', 'https://start.example.edu/plan.ics', true)`;
    fetchMock.mockResolvedValue(weekly('start@test', 'Start', 2));
    const blocker = await occupyPort();
    const second = await startTestApp();
    try {
      await expect(second.app.listen({ port: blocker.port, host: '127.0.0.1' })).rejects.toThrow(
        /EADDRINUSE/,
      );
    } finally {
      await second.close(); // wartet auf einen laufenden Abgleich
      await blocker.close();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    const rows = await t.handle.sql`SELECT count(*)::int AS n FROM calendar_event WHERE source_id = ${id}`;
    expect(rows[0]?.n).toBe(0);
  });
});

const NEVER_RETURNS = wrap(
  'BEGIN:VEVENT\r\nUID:n@t\r\nDTSTART:20261110T100000Z\r\nDTEND:20261110T110000Z\r\nRRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30\r\nSUMMARY:x\r\nEND:VEVENT\r\n',
);

describe('Neu zuordnen: POST /calendar/reassign', () => {
  const reassign = (remoteAddress = '127.0.0.1') =>
    t.request({ method: 'POST', url: `${API}/calendar/reassign`, remoteAddress });

  it('ordnet automatisch zugeordnete Termine nach dem Anlegen eines Moduls neu zu; zweiter Aufruf ändert nichts', async () => {
    const semester = await createSemester();
    const result = await importFile(fixture('10-mini-semester-6-module.ics'));
    expect(result.counts.zugeordnet).toBe(0);
    const total = result.counts.neu;
    ensure.mockClear();

    const stat = result.module_suggestions.find((s) => s.name === 'Statistik I');
    const mod = await createModule(semester.id, 'Statistik I', { short_name: stat?.short });
    const res = await reassign();
    expect(res.statusCode, res.body).toBe(200);
    const first = res.json() as { changed: number; ohne_modul: number };
    const mine = (await allEvents()).filter((e) => e.module_id === mod.id);
    // Langname und Kürzel gehören beide dazu
    expect(mine.map((e) => e.title).sort()).toEqual(['Stat I – Übung', 'Statistik I Vorlesung'].sort());
    expect(first.changed).toBe(mine.length);
    expect(first.ohne_modul).toBe(total - mine.length);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(new Set(ensure.mock.calls[0]?.[1])).toEqual(new Set(mine.map((e) => e.id)));

    ensure.mockClear();
    const again = (await reassign()).json() as { changed: number };
    expect(again.changed).toBe(0);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('manuelle Zuordnungen bleiben unangetastet', async () => {
    const semester = await createSemester();
    await importFile(weekly('m@test', 'Statistik I', 3));
    const other = await createModule(semester.id, 'Datenbanksysteme');
    const [first] = await allEvents();
    await t.request({
      method: 'PATCH',
      url: `${API}/calendar/events/${first?.id}`,
      payload: { module_id: other.id, kind: 'tutorium', scope: 'einzeln' },
    });
    await createModule(semester.id, 'Statistik I');
    const res = (await reassign()).json() as { changed: number };
    expect(res.changed).toBe(2);
    const events = await allEvents();
    expect(events[0]).toMatchObject({ module_id: other.id, kind: 'tutorium', assigned_by: 'manuell' });
    expect(events.slice(1).every((e) => e.assigned_by === 'auto' && e.module_id !== null)).toBe(true);
  });

  it('nur lokal: aus dem Netz wird die Route abgewiesen', async () => {
    // Aus dem Netz mit dem Host des Macs (ein fremder Host wäre schon 421, VERTRAEGE §5)
    const res = await t.request({
      method: 'POST',
      url: `${API}/calendar/reassign`,
      remoteAddress: '192.168.1.20',
      headers: { host: '192.168.1.5:4710' },
    });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('ohne Termine: changed 0', async () => {
    expect(CalendarReassignResultSchema.parse((await reassign()).json())).toEqual({
      changed: 0,
      ohne_modul: 0,
    });
  });
});

describe('Review-Nachträge: Grenzen und Rennen', () => {
  it('Datei mit einer Regel, die nie zurückkehrt: 400 ics_too_complex, nichts wird angelegt', async () => {
    const restore = setCalendarHooks({ parseDeadlineMs: () => 300 });
    try {
      expect((await errorOf(await postFile(NEVER_RETURNS), 400)).code).toBe('ics_too_complex');
      const rows = await t.handle.sql`SELECT count(*)::int AS n FROM calendar_source`;
      expect(rows[0]?.n).toBe(0);
    } finally {
      restore();
    }
  });

  it('URL-Quelle mit zu komplexer Datei: last_error, Termine bleiben', async () => {
    fetchMock.mockResolvedValueOnce(weekly('c@t', 'Statistik I', 2));
    const created = IcsImportResultSchema.parse(
      (await postJson('/calendar/sources', { url: 'https://komplex.example.edu/a.ics' })).json(),
    );
    const restore = setCalendarHooks({ parseDeadlineMs: () => 300 });
    try {
      fetchMock.mockResolvedValueOnce(NEVER_RETURNS);
      const res = await postJson(`/calendar/sources/${created.source.id}/sync`, {});
      expect((await errorOf(res, 400)).code).toBe('ics_too_complex');
    } finally {
      restore();
    }
    const rows = await t.handle.sql`SELECT last_error FROM calendar_source`;
    expect(rows[0]?.last_error).toContain('zu komplex');
    expect((await allEvents()).filter((e) => !e.cancelled)).toHaveLength(2);
  });

  /** Hält die Sperre `source:<id>` aus einer zweiten Verbindung (wie ein laufender Abgleich) bis `release()` */
  async function holdSourceLock(sourceId: string) {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked: () => void = () => {};
    const ready = new Promise<void>((resolve) => (locked = resolve));
    const holder = t.handle.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(70070010, hashtext(${`source:${sourceId}`}))`;
      locked();
      await gate;
    });
    await ready;
    return { release, done: holder };
  }

  const pending = async (promise: Promise<unknown>, ms = 400) =>
    Promise.race([
      promise.then(() => 'fertig'),
      new Promise((resolve) => setTimeout(() => resolve('wartet'), ms)),
    ]);

  it('DELETE wartet auf die Quellen-Sperre (ein laufender Abgleich), erst danach wird gelöscht', async () => {
    const created = await importFile(weekly('race@t', 'Statistik I', 3));
    const lock = await holdSourceLock(created.source.id);
    const deleting = t.request({ method: 'DELETE', url: `${API}/calendar/sources/${created.source.id}` });
    expect(await pending(deleting)).toBe('wartet');
    const mid = await t.handle.sql`SELECT deleted_at FROM calendar_source WHERE id = ${created.source.id}`;
    expect(mid[0]?.deleted_at).toBeNull();
    lock.release();
    await lock.done;
    expect((await deleting).statusCode).toBe(204);
    const rows = await t.handle.sql`SELECT count(*)::int AS orphans FROM calendar_event e
      JOIN calendar_source s ON s.id = e.source_id WHERE s.deleted_at IS NOT NULL AND e.deleted_at IS NULL`;
    expect(rows[0]?.orphans).toBe(0);
  });

  it('POST /calendar/reassign wartet ebenfalls auf laufende Abgleiche', async () => {
    const created = await importFile(weekly('race2@t', 'Statistik I', 2));
    const lock = await holdSourceLock(created.source.id);
    const reassigning = t.request({ method: 'POST', url: `${API}/calendar/reassign` });
    expect(await pending(reassigning)).toBe('wartet');
    lock.release();
    await lock.done;
    const res = await reassigning;
    expect(res.statusCode).toBe(200);
    expect(CalendarReassignResultSchema.parse(res.json())).toEqual({ changed: 0, ohne_modul: 2 });
  });

  it('Termine endlicher Serien, die in der Quelle fehlen, werden auch vor dem Fenster abgesagt', async () => {
    const created = await importFile(weekly('alt2@t', 'Statistik I', 3));
    await t.handle
      .sql`UPDATE calendar_event SET starts_at = starts_at - interval '3 years', ends_at = ends_at - interval '3 years'`;
    const second = await syncFile(created.source.id, weekly('alt2@t', 'Statistik I', 1));
    // Das erste Vorkommen steht noch in der Quelle, die beiden anderen fehlen (und liegen vor dem Fenster)
    expect(second.counts.entfallen).toBe(2);
  });

  it('dieselbe id gleichzeitig: einmal 201, sonst 409 calendar_source_exists (kein 500)', async () => {
    const id = uuidv7();
    const responses = await Promise.all(
      [1, 2, 3].map((i) => postFile(weekly(`id${i}@t`, 'x', 1), [{ name: 'id', value: id }])),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
    const rows = await t.handle.sql`SELECT count(*)::int AS n FROM calendar_source`;
    expect(rows[0]?.n).toBe(1);
  });

  it('Datei an eine URL-Quelle: 400 unexpected_file, kein Abruf', async () => {
    fetchMock.mockResolvedValueOnce(weekly('u@t', 'x', 1));
    const created = IcsImportResultSchema.parse(
      (await postJson('/calendar/sources', { url: 'https://url.example.edu/a.ics' })).json(),
    );
    fetchMock.mockClear();
    const body = multipart([filePart(weekly('u@t', 'x', 2))]);
    const res = await t.request({
      method: 'POST',
      url: `${API}/calendar/sources/${created.source.id}/sync`,
      payload: body.payload,
      headers: body.headers,
    });
    expect((await errorOf(res, 400)).code).toBe('unexpected_file');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('viele Warnungen werden begrenzt und zusammengefasst', async () => {
    const bad = wrap(
      Array.from({ length: 40 }, (_, i) => `BEGIN:VEVENT\r\nUID:w${i}@t\r\nSUMMARY:x\r\nEND:VEVENT\r\n`).join(
        '',
      ),
    );
    const result = await importFile(bad);
    expect(result.warnings.length).toBe(6);
    expect(result.warnings.at(-1)?.message).toContain('insgesamt 40');
  });

  it('Termine älter als das Fenster (1 Jahr) einer offenen Serie werden nicht abgesagt', async () => {
    const created = await importFile(weekly('alt@t', 'Statistik I', 2));
    await t.handle
      .sql`UPDATE calendar_event SET starts_at = starts_at - interval '3 years', ends_at = ends_at - interval '3 years'`;
    const open = wrap(
      'BEGIN:VEVENT\r\nUID:alt@t\r\nDTSTART;TZID=Europe/Zurich:20261109T101500\r\nDTEND;TZID=Europe/Zurich:20261109T120000\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:Statistik I\r\nEND:VEVENT\r\n',
    );
    const second = await syncFile(created.source.id, open);
    expect(second.counts.entfallen).toBe(0);
  });
});

describe('Termine lesen', () => {
  it('GET /calendar/events: nach Beginn aufsteigend, Filter, Seiten', async () => {
    const semester = await createSemester();
    const stat = await createModule(semester.id, 'Statistik I');
    await importFile(weekly('e1@test', 'Statistik I', 4));
    await importFile(weekly('e2@test', 'Etwas anderes', 2));
    const all = await allEvents();
    expect(all).toHaveLength(6);
    expect(all.map((e) => e.starts_at)).toEqual([...all.map((e) => e.starts_at)].sort());
    expect(all[0]).toMatchObject({
      starts_at: '2026-11-09T09:15:00.000Z',
      ends_at: '2026-11-09T11:00:00.000Z',
    });
    CalendarEventSchema.array().parse(all);

    expect(await allEvents(`module_id=${stat.id}`)).toHaveLength(4);
    expect(await allEvents('unassigned=true')).toHaveLength(2);
    expect(await allEvents('unassigned=false')).toHaveLength(6);
    // Zeitraum: von (einschließlich) bis (ausschließlich)
    const week = await allEvents('from=2026-11-16T00:00:00Z&to=2026-11-23T00:00:00Z');
    expect(week).toHaveLength(2);
    expect(week.every((e) => e.starts_at.startsWith('2026-11-16'))).toBe(true);
    // ein Termin, der hineinreicht, zählt
    const overlap = await allEvents('from=2026-11-16T10:00:00Z&to=2026-11-16T10:30:00Z');
    expect(overlap).toHaveLength(2);
    // ein Termin, der gerade endet, nicht
    expect(await allEvents('from=2026-11-16T11:00:00Z&to=2026-11-16T12:00:00Z')).toHaveLength(0);
    expect(await allEvents('to=2026-11-09T09:15:00Z')).toHaveLength(0);

    const first = CalendarEventListSchema.parse(
      (await t.request({ method: 'GET', url: `${API}/calendar/events?limit=4` })).json(),
    );
    expect(first.items).toHaveLength(4);
    expect(first.next_cursor).not.toBeNull();
    const rest = CalendarEventListSchema.parse(
      (
        await t.request({ method: 'GET', url: `${API}/calendar/events?limit=4&cursor=${first.next_cursor}` })
      ).json(),
    );
    expect(rest.items).toHaveLength(2);
    expect(rest.next_cursor).toBeNull();
    expect([...first.items, ...rest.items].map((e) => e.id)).toEqual(all.map((e) => e.id));
  });

  it('abgesagte Termine fehlen ohne include_cancelled=true', async () => {
    await importFile(fixture('05-abgesagtes-einzelvorkommen.ics'));
    expect(await allEvents('include_cancelled=false')).toHaveLength(3);
    expect(await allEvents('')).toHaveLength(3);
    expect(await allEvents('include_cancelled=true')).toHaveLength(4);
  });

  it('GET /calendar/events/{id}: einer, 404, 400', async () => {
    await importFile(weekly('g@test', 'x', 1));
    const [event] = await allEvents();
    const res = await t.request({ method: 'GET', url: `${API}/calendar/events/${event?.id}` });
    expect(CalendarEventSchema.parse(res.json())).toEqual(event);
    expect(
      (await errorOf(await t.request({ method: 'GET', url: `${API}/calendar/events/${uuidv7()}` }), 404))
        .code,
    ).toBe('calendar_event_not_found');
    expect(
      (await errorOf(await t.request({ method: 'GET', url: `${API}/calendar/events/xyz` }), 400)).code,
    ).toBe('validation_failed');
  });

  it.each([
    'from=gestern',
    'to=2026-13-01',
    'module_id=abc',
    'unassigned=ja',
    'limit=0',
    'limit=201',
    'cursor=!!',
  ])('ungültige Abfrage %s: 400', async (query) => {
    const res = await t.request({ method: 'GET', url: `${API}/calendar/events?${query}` });
    expect(res.statusCode).toBe(400);
    expect(ApiErrorSchema.safeParse(res.json()).success).toBe(true);
  });

  it('session_id ist die nicht gelöschte Session zum Termin', async () => {
    const semester = await createSemester();
    const mod = await createModule(semester.id, 'Statistik I');
    await importFile(weekly('ss@test', 'Statistik I', 2));
    const [first, second] = await allEvents();
    const live = uuidv7();
    const dead = uuidv7();
    await t.handle.db.insert(session).values([
      { id: live, userId: SINGLE_USER_ID, moduleId: mod.id, calendarEventId: first?.id ?? null },
      {
        id: dead,
        userId: SINGLE_USER_ID,
        moduleId: mod.id,
        calendarEventId: second?.id ?? null,
        deletedAt: new Date(),
      },
    ]);
    const events = await allEvents();
    expect(events.map((e) => e.session_id)).toEqual([live, null]);
    const one = await t.request({ method: 'GET', url: `${API}/calendar/events/${first?.id}` });
    expect(CalendarEventSchema.parse(one.json()).session_id).toBe(live);
  });
});
