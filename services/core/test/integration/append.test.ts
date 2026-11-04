// appendOp (VERTRAEGE §11.2, §16.2): lückenlose seq, Idempotenz über op_id, Hook nach dem Commit.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import {
  appendOp,
  findOpById,
  listenCommittedOps,
  setOnOpCommitted,
  type AppendOpInput,
  type CommittedOp,
} from '../../src/sync/append.ts';
import { SyncOpError } from '../../src/sync/handlers.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { testDatabaseUrl } from './helpers.ts';

let handle: DbHandle;
beforeAll(() => {
  handle = createDb(testDatabaseUrl());
});
afterAll(async () => {
  await handle.sql`TRUNCATE sync_stream, sync_op`;
  await handle.close();
});
beforeEach(async () => {
  await handle.sql`TRUNCATE sync_stream, sync_op`;
});
afterEach(() => {
  setOnOpCommitted(null);
});

const sessionStream = () => `session:${uuidv7()}`;
const markerOp = (overrides: Partial<AppendOpInput> = {}): AppendOpInput => ({
  kind: 'marker.add',
  data: { marker_id: uuidv7(), kind: 'frage', t_ms: 1200 },
  at: 1_793_800_000_000,
  clockUncertain: false,
  origin: 'ipad',
  ...overrides,
});

const append = (stream: string, op: AppendOpInput) => handle.db.transaction((tx) => appendOp(tx, stream, op));

/** Wartet, bis `predicate` stimmt (Hook läuft asynchron nach NOTIFY) */
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Zeitüberschreitung beim Warten');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('appendOp', () => {
  it('vergibt seq pro Strom lückenlos ab 1 und schreibt sync_op vollständig', async () => {
    const a = sessionStream();
    const b = `notebook:${uuidv7()}`;
    const deviceId = uuidv7();
    expect((await append(a, markerOp())).seq).toBe(1);
    expect((await append(a, markerOp())).seq).toBe(2);
    expect((await append(b, markerOp({ kind: 'page.delete', data: { page_id: uuidv7() } }))).seq).toBe(1);
    const third = await append(a, markerOp({ deviceId, clockUncertain: true, at: 42 }));
    expect(third.seq).toBe(3);
    expect(third.opId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const stored = await findOpById(handle.db, third.opId);
    expect(stored).toMatchObject({
      stream: a,
      seq: 3,
      kind: 'marker.add',
      at: 42,
      clockUncertain: true,
      origin: 'ipad',
      deviceId,
    });
    const heads = await handle.sql`SELECT stream, head_seq FROM sync_stream ORDER BY stream`;
    expect(Object.fromEntries(heads.map((h) => [h.stream, Number(h.head_seq)]))).toEqual({ [a]: 3, [b]: 1 });
    await expect(append('notizbuch:1', markerOp())).rejects.toThrow(/Strom/);
    await expect(append(`session:${uuidv7().toUpperCase()}`, markerOp())).rejects.toThrow(/Strom/);
  });

  it('ist idempotent über op_id; andere Daten, Art oder Strom ergeben op_id_reused', async () => {
    const stream = sessionStream();
    const op = markerOp({ opId: uuidv7(), data: { b: 2, a: [1, { c: null }] } });
    const first = await append(stream, op);
    await append(stream, markerOp());
    // Gleiche Daten in anderer Schlüsselreihenfolge, anderes at: das ursprüngliche ack
    const again = await append(stream, { ...op, data: { a: [1, { c: null }], b: 2 }, at: 1 });
    expect(again).toEqual(first);
    expect(await handle.sql`SELECT count(*)::int AS n FROM sync_op`).toEqual([{ n: 2 }]);

    for (const changed of [
      { ...op, data: { b: 3 } },
      { ...op, kind: 'marker.remove' as const },
    ]) {
      const error = await append(stream, changed).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SyncOpError);
      expect(error).toMatchObject({ code: 'op_id_reused', retryable: false });
    }
    await expect(append(sessionStream(), op)).rejects.toMatchObject({ code: 'op_id_reused' });
    expect((await append(stream, markerOp())).seq).toBe(3);
  });

  it('Rollback verbraucht keine seq', async () => {
    const stream = sessionStream();
    await append(stream, markerOp());
    await expect(
      handle.db.transaction(async (tx) => {
        await appendOp(tx, stream, markerOp());
        throw new Error('fachlicher Fehler');
      }),
    ).rejects.toThrow('fachlicher Fehler');
    expect((await append(stream, markerOp())).seq).toBe(2);
  });

  it('bleibt bei gleichzeitigen Transaktionen lückenlos (Zeilensperre auf sync_stream)', async () => {
    const stream = sessionStream();
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        handle.db.transaction(async (tx) => {
          const r = await appendOp(tx, stream, markerOp());
          await tx.execute('SELECT pg_sleep(0.005)');
          return r.seq;
        }),
      ),
    );
    expect([...results].sort((x, y) => x - y)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    const [head] = await handle.sql`SELECT head_seq FROM sync_stream WHERE stream = ${stream}`;
    expect(Number(head?.head_seq)).toBe(25);
  });

  it('ruft den Hook nach dem Commit auf, in seq-Reihenfolge und nie nach Rollback', async () => {
    const received: CommittedOp[] = [];
    setOnOpCommitted((op) => {
      received.push(op);
    });
    const stop = await listenCommittedOps(handle.sql, handle.db);
    try {
      const stream = sessionStream();
      let seenInsideTx = -1;
      await handle.db.transaction(async (tx) => {
        await appendOp(tx, stream, markerOp());
        await appendOp(tx, stream, markerOp({ origin: 'server' }));
        await new Promise((r) => setTimeout(r, 50));
        seenInsideTx = received.length; // vor dem Commit noch nichts
      });
      expect(seenInsideTx).toBe(0);
      await expect(
        handle.db.transaction(async (tx) => {
          await appendOp(tx, stream, markerOp({ kind: 'marker.remove', data: { marker_id: uuidv7() } }));
          throw new Error('Rollback');
        }),
      ).rejects.toThrow('Rollback');
      await append(stream, markerOp({ origin: 'web' }));
      await waitFor(() => received.length >= 3);
      await new Promise((r) => setTimeout(r, 50));
      expect(received.map((o) => [o.seq, o.origin])).toEqual([
        [1, 'ipad'],
        [2, 'server'],
        [3, 'web'],
      ]);
      expect(received.every((o) => o.kind === 'marker.add' && o.stream === stream)).toBe(true);

      // Standard-Hook: nichts tun
      setOnOpCommitted(null);
      await append(stream, markerOp());
      await new Promise((r) => setTimeout(r, 50));
      expect(received).toHaveLength(3);
    } finally {
      await stop();
    }
  });
});
