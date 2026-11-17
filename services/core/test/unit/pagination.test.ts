import { describe, expect, it } from 'vitest';
import { HttpError } from '../../src/errors.ts';
import { decodeCursor, encodeCursor, PageQuerySchema, toPage } from '../../src/lib/pagination.ts';

const ID = '0190f6a2-0000-7000-8000-000000000001';
const TS = '2026-11-04 08:25:12.123456+00';

describe('Cursor', () => {
  it('lässt sich hin und zurück umwandeln', () => {
    expect(decodeCursor(encodeCursor({ ts: TS, id: ID }))).toEqual({ ts: TS, id: ID });
  });

  it.each([
    ['kein Base64-JSON', '%%%'],
    ['kein Array', Buffer.from('{"a":1}').toString('base64url')],
    ['falsche Länge', Buffer.from('["x"]').toString('base64url')],
    ['ungültiger Zeitstempel', Buffer.from(JSON.stringify(['gestern', ID])).toString('base64url')],
    [
      'SQL im Zeitstempel',
      Buffer.from(JSON.stringify(["2026-11-04'; DROP TABLE job;--", ID])).toString('base64url'),
    ],
    ['Datum 30. Februar', Buffer.from(JSON.stringify(['2026-02-30 10:00:00+00', ID])).toString('base64url')],
    [
      '29. Februar ohne Schaltjahr',
      Buffer.from(JSON.stringify(['2026-02-29 10:00:00+00', ID])).toString('base64url'),
    ],
    ['29. Februar 1900', Buffer.from(JSON.stringify(['1900-02-29 10:00:00+00', ID])).toString('base64url')],
    ['Monat 13', Buffer.from(JSON.stringify(['2026-13-01 10:00:00+00', ID])).toString('base64url')],
    ['Monat 00', Buffer.from(JSON.stringify(['2026-00-10 10:00:00+00', ID])).toString('base64url')],
    ['Tag 31 im April', Buffer.from(JSON.stringify(['2026-04-31 10:00:00+00', ID])).toString('base64url')],
    ['Tag 00', Buffer.from(JSON.stringify(['2026-04-00 10:00:00+00', ID])).toString('base64url')],
    ['Stunde 99', Buffer.from(JSON.stringify(['2026-11-04 99:00:00+00', ID])).toString('base64url')],
    ['Stunde 24', Buffer.from(JSON.stringify(['2026-11-04 24:00:00+00', ID])).toString('base64url')],
    ['Minute 60', Buffer.from(JSON.stringify(['2026-11-04 10:60:00+00', ID])).toString('base64url')],
    ['Sekunde 60', Buffer.from(JSON.stringify(['2026-11-04 10:00:60+00', ID])).toString('base64url')],
    ['Jahr 0000', Buffer.from(JSON.stringify(['0000-01-01 00:00:00+00', ID])).toString('base64url')],
    ['Offset +99', Buffer.from(JSON.stringify(['2026-11-04 10:00:00+99', ID])).toString('base64url')],
    ['Offset +16:00', Buffer.from(JSON.stringify(['2026-11-04 10:00:00+16:00', ID])).toString('base64url')],
    [
      'Offset-Minuten 60',
      Buffer.from(JSON.stringify(['2026-11-04 10:00:00+05:60', ID])).toString('base64url'),
    ],
    ['ungültige ID', Buffer.from(JSON.stringify([TS, 'abc'])).toString('base64url')],
  ])('weist %s mit 400 invalid_cursor ab', (_name, raw) => {
    try {
      decodeCursor(raw);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).statusCode).toBe(400);
      expect((error as HttpError).code).toBe('invalid_cursor');
    }
  });
});

describe('Cursor: gültige Zeitstempel', () => {
  it.each([
    '2028-02-29 12:00:00+00',
    '2000-02-29 00:00:00+00',
    '2026-11-04 08:25:12.123456+00',
    '2026-11-04 08:25:12.1+00',
    '2026-11-04 08:25:12.000001+05:30',
    '2026-11-04 08:25:12-03:00',
    '2026-12-31 23:59:59.999999+15:59',
    '0001-01-01 00:00:00-15:59',
    '9999-12-31 23:59:59.999999+00',
  ])('behält %s unverändert', (ts) => {
    expect(decodeCursor(encodeCursor({ ts, id: ID }))).toEqual({ ts, id: ID });
  });
});

describe('toPage', () => {
  const rows = [1, 2, 3].map((n) => ({ n, ts: TS, id: `0190f6a2-0000-7000-8000-00000000000${n}` }));
  const key = (r: (typeof rows)[number]) => ({ ts: r.ts, id: r.id });

  it('liefert next_cursor, wenn mehr Zeilen da sind als limit', () => {
    const page = toPage(rows, 2, key, (r) => r.n);
    expect(page.items).toEqual([1, 2]);
    expect(decodeCursor(page.next_cursor!)).toEqual({ ts: TS, id: rows[1]!.id });
  });

  it('liefert next_cursor = null auf der letzten Seite', () => {
    expect(toPage(rows, 3, key, (r) => r.n)).toEqual({ items: [1, 2, 3], next_cursor: null });
    expect(toPage([], 3, key, (r) => r)).toEqual({ items: [], next_cursor: null });
  });
});

describe('PageQuerySchema', () => {
  it('nutzt Standard-Limit 50 und wandelt Strings um', () => {
    expect(PageQuerySchema.parse({}).limit).toBe(50);
    expect(PageQuerySchema.parse({ limit: '10' }).limit).toBe(10);
  });

  it('weist Limits außerhalb von 1..200 ab', () => {
    expect(PageQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(PageQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
  });
});
