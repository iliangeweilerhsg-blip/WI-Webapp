// Auflösen: Laufzeit-Grenzen, Sonderfälle der Zeit und Warnungen (Review PR #67)
import { describe, expect, it } from 'vitest';
import { parseIcsIsolated } from '../../src/services/calendar-parse.ts';
import {
  IcsParseError,
  IcsTooComplexError,
  MAX_WARNINGS_PER_CODE,
  parseIcs,
  zonedWallToUtc,
} from '../../src/services/calendar-ics.ts';

const NOW = new Date('2026-11-04T08:00:00Z');
const opts = { now: NOW, defaultTimeZone: 'Europe/Zurich' };
const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//\r\n${body}END:VCALENDAR\r\n`;
const vevent = (uid: string, extra: string, start = '20261110T100000Z') =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${start}\r\nDTEND:${start}\r\nSUMMARY:${uid}\r\n${extra}END:VEVENT\r\n`;

describe('Laufzeit', () => {
  it('16 000 Termine: schnell, die Obergrenze bricht vor der Arbeit ab', { timeout: 30_000 }, () => {
    const many = wrap(Array.from({ length: 16_000 }, (_, i) => vevent(`u${i}@t`, '')).join(''));
    // Bestzeit aus drei Läufen: robust, wenn andere Tests gleichzeitig die Maschine auslasten
    let best = Infinity;
    let result = parseIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', opts);
    for (let run = 0; run < 3; run += 1) {
      const started = Date.now();
      result = parseIcs(many, opts);
      best = Math.min(best, Date.now() - started);
    }
    expect(best).toBeLessThan(2000);
    expect(result.events).toHaveLength(5000);
    expect(result.truncated).toBe(true);
  });

  it('4 000 Einzeltermine (unter der Obergrenze) lösen nicht quadratisch auf', { timeout: 30_000 }, () => {
    const many = wrap(Array.from({ length: 4000 }, (_, i) => vevent(`u${i}@t`, '')).join(''));
    let best = Infinity;
    for (let run = 0; run < 3; run += 1) {
      const started = Date.now();
      expect(parseIcs(many, opts).events).toHaveLength(4000);
      best = Math.min(best, Date.now() - started);
    }
    expect(best).toBeLessThan(2000);
  });

  it.each(['SECONDLY', 'MINUTELY', 'HOURLY'])(
    'FREQ=%s wird nicht aufgelöst (Warnung, nur der erste Termin)',
    (freq) => {
      const ics = wrap(vevent('s@t', `RRULE:FREQ=${freq};BYMONTH=12;BYMONTHDAY=31\r\n`));
      const started = Date.now();
      const result = parseIcs(ics, opts);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(result.events).toHaveLength(1);
      expect(result.warnings.map((w) => w.code)).toEqual(['rrule_unsupported']);
    },
  );

  it('eine Regel, die in ical.js nie zurückkehrt, wird nach dem Zeitbudget abgebrochen (Worker-Thread)', async () => {
    // FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30 blockiert ical.js im ersten Schritt dauerhaft
    const never = wrap(vevent('n@t', 'RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30\r\n'));
    const started = Date.now();
    await expect(parseIcsIsolated(never, { ...opts, deadlineMs: 300 })).rejects.toThrow(IcsTooComplexError);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('der Core bleibt währenddessen ansprechbar (der Event-Loop wird nicht blockiert)', async () => {
    const never = wrap(vevent('n@t', 'RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30\r\n'));
    let longestGap = 0;
    let last = Date.now();
    const ticker = setInterval(() => {
      longestGap = Math.max(longestGap, Date.now() - last);
      last = Date.now();
    }, 20);
    await expect(parseIcsIsolated(never, { ...opts, deadlineMs: 400 })).rejects.toThrow(IcsTooComplexError);
    clearInterval(ticker);
    expect(longestGap).toBeLessThan(300);
  });

  it('der Worker liefert dasselbe Ergebnis wie parseIcs und meldet ungültige Dateien', async () => {
    const ics = wrap(vevent('w@t', 'RRULE:FREQ=WEEKLY;COUNT=3\r\n'));
    const viaWorker = await parseIcsIsolated(ics, opts);
    expect(viaWorker).toEqual(parseIcs(ics, opts));
    expect(viaWorker.events[0]?.startsAt).toBeInstanceOf(Date);
    await expect(parseIcsIsolated('Hallo', opts)).rejects.toThrow(IcsParseError);
  });

  it('das Zeitbudget gilt für die ganze Datei, auch für viele harmlose Serien', () => {
    const series = wrap(
      Array.from({ length: 3000 }, (_, i) => vevent(`w${i}@t`, 'RRULE:FREQ=DAILY;COUNT=200\r\n')).join(''),
    );
    expect(() => parseIcs(series, { ...opts, deadlineMs: 50 })).toThrow(IcsTooComplexError);
  });
});

describe('Serien', () => {
  it('RDATE ohne RRULE: auch DTSTART ist ein Vorkommen', () => {
    const ics = wrap(vevent('r@t', 'RDATE:20261117T100000Z,20261124T100000Z\r\n'));
    expect(parseIcs(ics, opts).events.map((e) => e.recurrenceId)).toEqual([
      '2026-11-10T10:00:00Z',
      '2026-11-17T10:00:00Z',
      '2026-11-24T10:00:00Z',
    ]);
  });

  it('EXDATE auf DTSTART bei RDATE ohne RRULE', () => {
    const ics = wrap(vevent('r@t', 'RDATE:20261117T100000Z\r\nEXDATE:20261110T100000Z\r\n'));
    expect(parseIcs(ics, opts).events.map((e) => e.recurrenceId)).toEqual(['2026-11-17T10:00:00Z']);
  });

  it('offene Serien liefern nur Vorkommen ab heute − 1 Jahr', () => {
    const ics = wrap(vevent('o@t', 'RRULE:FREQ=WEEKLY\r\n', '20230103T100000Z'));
    const result = parseIcs(ics, opts);
    const first = result.events[0]?.startsAt.getTime() ?? 0;
    expect(first).toBeGreaterThanOrEqual(result.windowStart.getTime());
    expect(result.windowStart.toISOString()).toBe('2025-11-04T08:00:00.000Z');
    expect(first).toBeLessThan(result.windowStart.getTime() + 8 * 86_400_000);
  });

  it('endliche Serien liefern alles, auch vor dem Fenster', () => {
    const ics = wrap(vevent('f@t', 'RRULE:FREQ=WEEKLY;COUNT=3\r\n', '20230103T100000Z'));
    expect(parseIcs(ics, opts).events).toHaveLength(3);
  });

  it('mehrere VCALENDAR in einer Datei werden alle gelesen', () => {
    const one = wrap(vevent('a@t', ''));
    const two = wrap(vevent('b@t', ''));
    expect(parseIcs(`${one}${two}`, opts).events.map((e) => e.uid)).toEqual(['a@t', 'b@t']);
  });
});

describe('Zeit', () => {
  it('mehrdeutige Ortszeit am Ende der Sommerzeit: das erste Vorkommen', () => {
    // 25. Oktober 2026, 02:30 gibt es zweimal in Zürich: 00:30 UTC (Sommerzeit) und 01:30 UTC
    expect(new Date(zonedWallToUtc('Europe/Zurich', 2026, 10, 25, 2, 30, 0)).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
    expect(new Date(zonedWallToUtc('Europe/Zurich', 2026, 10, 25, 3, 30, 0)).toISOString()).toBe(
      '2026-10-25T02:30:00.000Z',
    );
  });

  it('Lücke am Beginn der Sommerzeit: die Zeit nach dem Sprung', () => {
    // 29. März 2026, 02:30 gibt es nicht: 03:30 CEST = 01:30 UTC
    expect(new Date(zonedWallToUtc('Europe/Zurich', 2026, 3, 29, 2, 30, 0)).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    expect(new Date(zonedWallToUtc('Europe/Zurich', 2026, 3, 29, 1, 30, 0)).toISOString()).toBe(
      '2026-03-29T00:30:00.000Z',
    );
  });

  it('gewöhnliche Zeiten, auch in Zonen östlich und westlich', () => {
    expect(new Date(zonedWallToUtc('Europe/Zurich', 2026, 7, 1, 12, 0, 0)).toISOString()).toBe(
      '2026-07-01T10:00:00.000Z',
    );
    expect(new Date(zonedWallToUtc('America/New_York', 2026, 1, 15, 8, 0, 0)).toISOString()).toBe(
      '2026-01-15T13:00:00.000Z',
    );
    expect(new Date(zonedWallToUtc('Asia/Tokyo', 2026, 1, 15, 8, 0, 0)).toISOString()).toBe(
      '2026-01-14T23:00:00.000Z',
    );
  });
});

describe('Warnungen', () => {
  it(`je Code höchstens ${MAX_WARNINGS_PER_CODE}, danach eine Sammelzeile mit der Gesamtzahl`, () => {
    const bad = wrap(
      Array.from({ length: 50 }, (_, i) => `BEGIN:VEVENT\r\nUID:k${i}@t\r\nSUMMARY:x\r\nEND:VEVENT\r\n`).join(
        '',
      ),
    );
    const result = parseIcs(bad, opts);
    expect(result.events).toHaveLength(0);
    expect(result.warnings).toHaveLength(MAX_WARNINGS_PER_CODE + 1);
    expect(result.warnings.at(-1)).toEqual({
      code: 'event_invalid',
      message: '45 weitere Hinweise dieser Art (insgesamt 50).',
      external_uid: null,
    });
  });
});
