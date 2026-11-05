// ICS auflösen: alle Testdaten aus tests/fixtures/ics gegen ihre JSON-Erwartung (VERTRAEGE §8, Abnahme T1-01)
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IcsParseError, parseIcs, type ParsedEvent } from '../../src/services/calendar-ics.ts';

const FIXTURES = fileURLToPath(new URL('../../../../tests/fixtures/ics/', import.meta.url));
const ZURICH = 'Europe/Zurich';
const NOW = new Date('2026-11-04T08:00:00Z');

interface Expected {
  external_uid: string;
  recurrence_id: string | null;
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  cancelled: boolean;
}

export function readFixture(name: string): string {
  return readFileSync(`${FIXTURES}${name}`, 'utf8');
}

const parse = (name: string, overrides: { defaultTimeZone?: string; now?: Date } = {}) =>
  parseIcs(readFixture(name), { now: NOW, defaultTimeZone: ZURICH, ...overrides });

function simplify(event: ParsedEvent): Expected {
  return {
    external_uid: event.uid,
    recurrence_id: event.recurrenceId,
    title: event.title,
    location: event.location,
    starts_at: event.startsAt.toISOString().replace('.000Z', 'Z'),
    ends_at: event.endsAt.toISOString().replace('.000Z', 'Z'),
    all_day: event.allDay,
    cancelled: event.cancelled,
  };
}

function sorted<T extends { starts_at: string; external_uid: string; recurrence_id: string | null }>(
  list: T[],
) {
  return [...list].sort((a, b) =>
    `${a.starts_at}|${a.external_uid}|${a.recurrence_id ?? ''}`.localeCompare(
      `${b.starts_at}|${b.external_uid}|${b.recurrence_id ?? ''}`,
    ),
  );
}

function expectedOf(jsonName: string): {
  termine: (Expected & Record<string, unknown>)[];
  zeitraum: { von: string; bis: string };
} {
  return JSON.parse(readFixture(jsonName)) as never;
}

const icsFiles = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.ics'))
  .sort();

describe('ICS-Testdaten (tests/fixtures/ics)', () => {
  it('es gibt alle 13 Dateien', () => {
    expect(icsFiles).toHaveLength(13);
  });

  for (const file of icsFiles) {
    it(`${file}: Termine stimmen mit der JSON-Erwartung überein`, () => {
      const { termine, zeitraum } = expectedOf(file.replace(/\.ics$/, '.json'));
      const result = parse(file);
      expect(result.warnings).toEqual([]);
      expect(result.truncated).toBe(false);
      // pruefen.py löst nur im Zeitraum auf; unsere Auflösung liefert alles, darum auf den Zeitraum begrenzen
      const from = Date.parse(`${zeitraum.von}T00:00:00Z`) - 86_400_000;
      const to = Date.parse(`${zeitraum.bis}T00:00:00Z`) + 2 * 86_400_000;
      const inRange = result.events.filter((e) => e.startsAt.getTime() >= from && e.startsAt.getTime() < to);
      const actual = sorted(inRange.map(simplify));
      const wanted = sorted(
        termine.map((t) => ({
          external_uid: t.external_uid,
          recurrence_id: t.recurrence_id,
          title: t.title,
          location: t.location,
          starts_at: t.starts_at,
          ends_at: t.ends_at,
          all_day: t.all_day,
          cancelled: t.cancelled,
        })),
      );
      expect(actual).toEqual(wanted);
    });
  }

  it('06a: die Ortszeit bleibt über die Zeitumstellung gleich, die UTC-Zeit springt um eine Stunde', () => {
    const events = parse('06a-sommerzeit-mit-vtimezone.ics').events;
    const hours = new Set(events.map((e) => e.recurrenceId?.slice(11, 16)));
    expect(hours.size).toBeGreaterThan(0);
    const utcHours = new Set(events.map((e) => e.startsAt.getUTCHours()));
    expect(utcHours.size).toBeGreaterThan(1);
  });

  it('06b: TZID ohne VTIMEZONE gilt als IANA-Name, nicht als UTC oder floating', () => {
    // Auch wenn das System in einer anderen Zone läuft
    const events = parse('06b-sommerzeit-ohne-vtimezone.ics', { defaultTimeZone: 'America/New_York' }).events;
    expect(events.map((e) => e.startsAt.toISOString())).toEqual([
      '2026-10-20T06:15:00.000Z', // CEST
      '2026-10-27T07:15:00.000Z', // CET
      '2026-11-03T07:15:00.000Z',
    ]);
  });

  it('07: Termine ohne Zone gelten in der Zeitzone des Systems', () => {
    const inZurich = parse('07-utc-und-floating-time.ics').events;
    const inNewYork = parse('07-utc-und-floating-time.ics', { defaultTimeZone: 'America/New_York' }).events;
    const byUid = (list: ParsedEvent[], part: string) =>
      list.find((e) => e.uid.includes(part))?.startsAt.toISOString();
    expect(byUid(inZurich, 'tut-floating')).toBe('2026-09-22T12:15:00.000Z');
    expect(byUid(inNewYork, 'tut-floating')).toBe('2026-09-22T18:15:00.000Z');
    // UTC bleibt UTC
    expect(byUid(inNewYork, 'vl-utc')).toBe('2026-09-21T08:15:00.000Z');
  });

  it('07: UTC-Einzeltermine und floating-Einzeltermine haben keine recurrence_id', () => {
    expect(parse('07-utc-und-floating-time.ics').events.every((e) => e.recurrenceId === null)).toBe(true);
  });

  it('04: das verschobene Vorkommen behält die Kennung des ursprünglichen Beginns', () => {
    const moved = parse('04-verschobenes-einzelvorkommen.ics').events.find((e) =>
      e.title.includes('Ausweichtermin'),
    );
    expect(moved?.recurrenceId).toBe('2026-09-24T08:15:00+02:00');
    expect(moved?.startsAt.toISOString()).toBe('2026-09-24T12:15:00.000Z');
    expect(moved?.location).toBe('Audimax');
  });

  it('05: das abgesagte Vorkommen bleibt erhalten und ist cancelled', () => {
    const events = parse('05-abgesagtes-einzelvorkommen.ics').events;
    expect(events).toHaveLength(4);
    expect(events.filter((e) => e.cancelled).map((e) => e.recurrenceId)).toEqual([
      '2026-10-02T10:15:00+02:00',
    ]);
  });
});

const wrap = (body: string, extra = '') =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//\r\n${extra}${body}END:VCALENDAR\r\n`;

describe('Auflösen: Grenzen und Sonderfälle', () => {
  const open = wrap(
    'BEGIN:VEVENT\r\nUID:offen@test\r\nDTSTART;TZID=Europe/Zurich:20261102T101500\r\nDTEND;TZID=Europe/Zurich:20261102T120000\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:Offene Serie\r\nEND:VEVENT\r\n',
  );

  it('Serien ohne UNTIL/COUNT werden bis heute + 180 Tage aufgelöst', () => {
    const result = parseIcs(open, { now: NOW, defaultTimeZone: ZURICH });
    const last = result.events.at(-1)?.startsAt.getTime() ?? 0;
    const horizon = NOW.getTime() + 180 * 86_400_000;
    expect(last).toBeLessThanOrEqual(horizon);
    expect(last).toBeGreaterThan(horizon - 7 * 86_400_000);
    expect(result.events.length).toBeGreaterThan(24);
  });

  it('wird bei einem späteren Abgleich fortgeschrieben (weiter in die Zukunft)', () => {
    const later = new Date(NOW.getTime() + 60 * 86_400_000);
    const a = parseIcs(open, { now: NOW, defaultTimeZone: ZURICH }).events;
    const b = parseIcs(open, { now: later, defaultTimeZone: ZURICH }).events;
    expect(b.length).toBeGreaterThan(a.length);
    expect(b.slice(0, a.length).map((e) => e.recurrenceId)).toEqual(a.map((e) => e.recurrenceId));
  });

  it('höchstens 5000 Termine, darüber Warnung too_many_events und truncated', () => {
    const daily = wrap(
      'BEGIN:VEVENT\r\nUID:viele@test\r\nDTSTART:20200101T080000Z\r\nDTEND:20200101T090000Z\r\nRRULE:FREQ=DAILY;COUNT=9000\r\nSUMMARY:Täglich\r\nEND:VEVENT\r\n',
    );
    const result = parseIcs(daily, { now: NOW, defaultTimeZone: ZURICH });
    expect(result.events).toHaveLength(5000);
    expect(result.truncated).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(['too_many_events']);
  });

  it('unbekannte Zone: Warnung timezone_unknown und Zone des Systems', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:zone@test\r\nDTSTART;TZID=Mars/Olympus:20261110T100000\r\nDTEND;TZID=Mars/Olympus:20261110T110000\r\nSUMMARY:Marstermin\r\nEND:VEVENT\r\n',
    );
    const result = parseIcs(ics, { now: NOW, defaultTimeZone: ZURICH });
    expect(result.events[0]?.startsAt.toISOString()).toBe('2026-11-10T09:00:00.000Z');
    expect(result.warnings).toEqual([
      {
        code: 'timezone_unknown',
        message: expect.stringContaining('Mars/Olympus'),
        external_uid: 'zone@test',
      },
    ]);
  });

  it('RDATE und EXDATE', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:rdate@test\r\nDTSTART:20261102T080000Z\r\nDTEND:20261102T090000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nRDATE:20261120T080000Z\r\nEXDATE:20261109T080000Z\r\nSUMMARY:Mit RDATE\r\nEND:VEVENT\r\n',
    );
    const ids = parseIcs(ics, { now: NOW, defaultTimeZone: ZURICH }).events.map((e) => e.recurrenceId);
    expect(ids).toEqual(['2026-11-02T08:00:00Z', '2026-11-16T08:00:00Z', '2026-11-20T08:00:00Z']);
  });

  it('eine Ausnahme ohne Serie wird ein eigener Termin mit der Kennung aus RECURRENCE-ID', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:nur-ausnahme@test\r\nRECURRENCE-ID;TZID=Europe/Zurich:20261110T100000\r\nDTSTART;TZID=Europe/Zurich:20261110T140000\r\nDTEND;TZID=Europe/Zurich:20261110T150000\r\nSUMMARY:Verschoben\r\nEND:VEVENT\r\n',
    );
    const result = parseIcs(ics, { now: NOW, defaultTimeZone: ZURICH });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      recurrenceId: '2026-11-10T10:00:00+01:00',
      startsAt: new Date('2026-11-10T13:00:00Z'),
    });
  });

  it('Termin ohne UID wird übersprungen (Warnung), Termin ohne Titel bekommt einen Ersatz', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nDTSTART:20261110T100000Z\r\nDTEND:20261110T110000Z\r\nSUMMARY:Ohne UID\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:ohne-titel@test\r\nDTSTART:20261110T100000Z\r\nEND:VEVENT\r\n',
    );
    const result = parseIcs(ics, { now: NOW, defaultTimeZone: ZURICH });
    expect(result.warnings.map((w) => w.code)).toEqual(['uid_missing']);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.title).toBe('(ohne Titel)');
    // Ohne Ende endet der Termin, wo er beginnt
    expect(result.events[0]?.endsAt).toEqual(result.events[0]?.startsAt);
  });

  it('ein kaputter Termin stoppt den Rest nicht', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:kaputt@test\r\nSUMMARY:Ohne Beginn\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:gut@test\r\nDTSTART:20261110T100000Z\r\nDTEND:20261110T110000Z\r\nSUMMARY:Gut\r\nEND:VEVENT\r\n',
    );
    const result = parseIcs(ics, { now: NOW, defaultTimeZone: ZURICH });
    expect(result.events.map((e) => e.uid)).toEqual(['gut@test']);
    expect(result.warnings.map((w) => [w.code, w.external_uid])).toEqual([['event_invalid', 'kaputt@test']]);
  });

  it('Text, der kein Kalender ist, wirft IcsParseError', () => {
    expect(() => parseIcs('Hallo Welt', { now: NOW, defaultTimeZone: ZURICH })).toThrow(IcsParseError);
    expect(() => parseIcs('<html>BEGIN</html>', { now: NOW, defaultTimeZone: ZURICH })).toThrow(
      IcsParseError,
    );
    expect(() => parseIcs('', { now: NOW, defaultTimeZone: ZURICH })).toThrow(IcsParseError);
  });

  it('eine Byte-Order-Mark am Anfang stört nicht', () => {
    const ics = `${String.fromCharCode(0xfeff)}${wrap('BEGIN:VEVENT\r\nUID:bom@test\r\nDTSTART:20261110T100000Z\r\nDTEND:20261110T110000Z\r\nSUMMARY:BOM\r\nEND:VEVENT\r\n')}`;
    expect(parseIcs(ics, { now: NOW, defaultTimeZone: ZURICH }).events).toHaveLength(1);
  });
});
