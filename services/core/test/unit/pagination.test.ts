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
