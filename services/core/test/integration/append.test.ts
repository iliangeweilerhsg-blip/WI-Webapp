// appendOp (VERTRAEGE §11.2, §16.2): lückenlose seq, Idempotenz über op_id, Hook nach dem Commit.
import net from 'node:net';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.restoreAllMocks();
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wartet, bis `predicate` stimmt (Hook läuft asynchron nach NOTIFY) */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Zeitüberschreitung beim Warten');
    await sleep(10);
  }
}

/** Ausgelieferte Operationen (`<stream>#<seq>`) eines Stroms, in Auslieferungsreihenfolge */
const ofStream = (received: string[], stream: string) => received.filter((r) => r.startsWith(`${stream}#`));

interface Gate {
  promise: Promise<void>;
  open: () => void;
}
function gate(): Gate {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/**
 * Eigene LISTEN-Verbindung mit zwei Schleusen, um den Wettlauf beim Neuverbinden (#143) gezielt herzustellen:
 * - `holdConnect()`: Der nächste Verbindungsaufbau wartet (`connectRequested`), bis `releaseConnect()` kommt.
 *   Solange ist der Listener sicher getrennt, Benachrichtigungen gehen verloren.
 * - `holdOnlisten()`: postgres.js meldet das erneute LISTEN (`onlistenRequested`), der Rückruf `onlisten` läuft aber
 *   erst nach `releaseOnlisten()`. Das bildet ab, was ohne Schleuse von selbst passiert: Benachrichtigungen kommen
 *   vor oder im selben Lesevorgang wie das ReadyForQuery des LISTEN an, und postgres.js ruft `onlisten` erst nach
 *   dem Ergebnis des LISTEN auf. Gemessen: unter Dauerlast in etwa jedem zweiten Neuverbinden.
 *   Der Test, der diese Schleusen nutzt, schreibt den Wettlauf bewusst fest (`[s#1, f#1, s#2]`). Wer die Reihenfolge
 *   über Ströme hinweg später herstellt, passt seine erste Erwartung an, die Prüfung je Strom bleibt.
 * `terminate()` beendet nur das Backend dieser Verbindung (eigener `application_name`).
 */
function gatedListenClient(url: string) {
  const target = new URL(url);
  const appName = `sg-it-listen-${uuidv7().slice(-12)}`;
  let connectGate: Gate | null = null;
  let connectSeen = gate();
  let onlistenGate: Gate | null = null;
  let onlistenSeen = gate();

  const sql = postgres(url, {
    max: 1,
    onnotice: () => {},
    connection: { application_name: appName },
    socket: async () => {
      if (connectGate) {
        connectSeen.open();
        await connectGate.promise;
      }
      return new Promise<postgres.SocketLike>((resolve, reject) => {
        const socket = net.connect({ host: target.hostname, port: Number(target.port || 5432) });
        socket.once('error', reject);
        socket.once('connect', () => {
          socket.off('error', reject);
          // net.Socket erfüllt SocketLike, nur die Überladungen von `end` passen nicht zum Typ
          resolve(socket as unknown as postgres.SocketLike);
        });
      });
    },
  });
  // listenCommittedOps braucht von der Verbindung nur `listen`
  const client = {
    listen: (channel: string, fn: (payload: string) => void, onlisten?: () => void) =>
      sql.listen(channel, fn, () => {
        const held = onlistenGate;
        if (!held) return onlisten?.();
        onlistenSeen.open();
        void held.promise.then(() => onlisten?.());
      }),
  } as unknown as postgres.Sql;

  return {
    client,
    holdConnect() {
      connectGate = gate();
      connectSeen = gate();
    },
    connectRequested: () => connectSeen.promise,
    releaseConnect() {
      connectGate?.open();
      connectGate = null;
    },
    holdOnlisten() {
      onlistenGate = gate();
      onlistenSeen = gate();
    },
    onlistenRequested: () => onlistenSeen.promise,
    releaseOnlisten() {
      onlistenGate?.open();
      onlistenGate = null;
    },
    async terminate(): Promise<number> {
      const rows = await handle.sql`SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = ${appName}`;
      return rows.length;
    },
    end: () => sql.end({ timeout: 1 }),
  };
}

/** Startet den Listener und setzt danach den Hook (Reihenfolge wie in T1-08) */
async function listen(hook: (op: CommittedOp) => void | Promise<void>, onError?: (e: unknown) => void) {
  const stop = await listenCommittedOps(handle.sql, handle.db, onError);
  setOnOpCommitted(hook);
  return stop;
}

describe('appendOp', () => {
  it('vergibt seq pro Strom lückenlos ab 1 und schreibt sync_op vollständig', async () => {
    const a = sessionStream();
    const b = `notebook:${uuidv7()}`;
    const deviceId = uuidv7();
    expect(await append(a, markerOp())).toMatchObject({ seq: 1, duplicate: false });
    expect((await append(a, markerOp())).seq).toBe(2);
    expect((await append(b, markerOp({ kind: 'page.delete', data: { page_id: uuidv7() } }))).seq).toBe(1);
    const third = await append(a, markerOp({ deviceId, clockUncertain: true, at: 42 }));
    expect(third.seq).toBe(3);
    expect(third.opId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const stored = await findOpById(handle.db, third.opId);
    expect(stored).toMatchObject({
      stream: a,
      seq: 3,
      opId: third.opId,
      kind: 'marker.add',
      at: 42,
      clockUncertain: true,
      origin: 'ipad',
      deviceId,
    });
    expect(await findOpById(handle.db, uuidv7())).toBeNull();
    const heads = await handle.sql`SELECT stream, head_seq FROM sync_stream ORDER BY stream`;
    expect(Object.fromEntries(heads.map((h) => [h.stream, Number(h.head_seq)]))).toEqual({ [a]: 3, [b]: 1 });
    await expect(append('notizbuch:1', markerOp())).rejects.toThrow(/Strom/);
    await expect(append(`session:${uuidv7().toUpperCase()}`, markerOp())).rejects.toThrow(/Strom/);
  });

  it('ist idempotent über op_id (duplicate = true); andere Daten, Art oder Strom ergeben op_id_reused', async () => {
    const stream = sessionStream();
    const op = markerOp({ opId: uuidv7(), data: { b: 2, a: [1, { c: null }] } });
    const first = await append(stream, op);
    expect(first.duplicate).toBe(false);
    await append(stream, markerOp());
    // Gleiche Daten in anderer Schlüsselreihenfolge, anderes at: das ursprüngliche ack
    const again = await append(stream, { ...op, data: { a: [1, { c: null }], b: 2 }, at: 1 });
    expect(again).toEqual({ ...first, duplicate: true });
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

  it('gleiche op_id gleichzeitig: im selben Strom ein Duplikat, in zwei Strömen internal_error (wiederholbar)', async () => {
    const stream = sessionStream();
    const op = markerOp({ opId: uuidv7() });
    const same = await Promise.all([append(stream, op), append(stream, op)]);
    expect(same.map((r) => r.seq)).toEqual([1, 1]);
    expect(same.map((r) => r.duplicate).sort()).toEqual([false, true]);

    // Zwei Ströme: die zweite Transaktion wartet auf den Unique-Index und scheitert dann
    const other = markerOp({ opId: uuidv7() });
    const results = await Promise.allSettled([
      handle.db.transaction(async (tx) => {
        const r = await appendOp(tx, sessionStream(), other);
        await tx.execute('SELECT pg_sleep(0.1)');
        return r;
      }),
      (async () => {
        await sleep(30);
        return append(sessionStream(), other);
      })(),
    ]);
    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'internal_error', retryable: true },
    });
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
});

describe('listenCommittedOps', () => {
  it('ruft den Hook nach dem Commit auf, in seq-Reihenfolge und nie nach Rollback', async () => {
    const received: CommittedOp[] = [];
    const stop = await listen((op) => {
      received.push(op);
    });
    try {
      const stream = sessionStream();
      let seenInsideTx = -1;
      await handle.db.transaction(async (tx) => {
        await appendOp(tx, stream, markerOp());
        await appendOp(tx, stream, markerOp({ origin: 'server' }));
        await sleep(50);
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
      await sleep(50);
      expect(received.map((o) => [o.seq, o.origin])).toEqual([
        [1, 'ipad'],
        [2, 'server'],
        [3, 'web'],
      ]);
      expect(received.every((o) => o.kind === 'marker.add' && o.stream === stream)).toBe(true);

      // Standard-Hook: nichts tun
      setOnOpCommitted(null);
      await append(stream, markerOp());
      await sleep(50);
      expect(received).toHaveLength(3);
    } finally {
      await stop();
    }
  });

  it('holt nach einem Abbruch der LISTEN-Verbindung Verpasstes nach (pg_terminate_backend)', async () => {
    const received: string[] = [];
    const stop = await listen((op) => {
      received.push(`${op.stream}#${op.seq}`);
    });
    try {
      const stream = sessionStream();
      await append(stream, markerOp());
      await waitFor(() => received.length === 1);

      const listeners = await handle.sql`SELECT pid FROM pg_stat_activity
        WHERE datname = current_database() AND query ILIKE 'listen %' AND pid <> pg_backend_pid()`;
      expect(listeners.length).toBeGreaterThan(0);
      for (const l of listeners) await handle.sql`SELECT pg_terminate_backend(${l.pid})`;
      // Während der Unterbrechung: zwei Operationen, eine davon in einem neuen Strom
      const fresh = sessionStream();
      await append(stream, markerOp());
      await append(fresh, markerOp());

      await waitFor(() => received.length === 3, 15_000);
      // Zugesagt ist die Reihenfolge je Strom (VERTRAEGE §16.2), nicht über Ströme hinweg: Je nachdem, wann das
      // erneute LISTEN steht, kommt `fresh#1` per Benachrichtigung vor oder per Abgleich nach `stream#2` (#143,
      // gezielt hergestellt im nächsten Test)
      expect(ofStream(received, stream)).toEqual([`${stream}#1`, `${stream}#2`]);
      expect(ofStream(received, fresh)).toEqual([`${fresh}#1`]);
      // Danach läuft der Listener normal weiter
      await append(stream, markerOp());
      await waitFor(() => received.length === 4, 5000);
      expect(received[3]).toBe(`${stream}#3`);
    } finally {
      await stop();
    }
  }, 30_000);

  it('Neuverbinden: Benachrichtigung der neuen Verbindung vor dem Abgleich, je Strom trotzdem lückenlos (#143)', async () => {
    const listener = gatedListenClient(testDatabaseUrl());
    const received: string[] = [];
    const stop = await listenCommittedOps(listener.client, handle.db);
    setOnOpCommitted((op) => {
      received.push(`${op.stream}#${op.seq}`);
    });
    try {
      const stream = sessionStream();
      await append(stream, markerOp());
      await waitFor(() => received.length === 1);

      // 1. Verbindung trennen und den Neuaufbau anhalten: stream#2 wird ohne Zuhörer committet
      listener.holdConnect();
      listener.holdOnlisten();
      expect(await listener.terminate()).toBe(1);
      await listener.connectRequested();
      await append(stream, markerOp());

      // 2. Neu verbinden. Das LISTEN steht, der Abgleich (onlisten) ist noch nicht eingereiht
      listener.releaseConnect();
      await listener.onlistenRequested();
      const fresh = sessionStream();
      await append(fresh, markerOp());
      await waitFor(() => received.length === 2);

      // 3. Abgleich: holt stream#2 nach, nachdem fresh#1 schon ausgeliefert ist
      listener.releaseOnlisten();
      await waitFor(() => received.length === 3);
      expect(received).toEqual([`${stream}#1`, `${fresh}#1`, `${stream}#2`]);
      expect(ofStream(received, stream)).toEqual([`${stream}#1`, `${stream}#2`]);

      await append(stream, markerOp());
      await append(fresh, markerOp());
      await waitFor(() => received.length === 5);
      expect(ofStream(received, stream)).toEqual([`${stream}#1`, `${stream}#2`, `${stream}#3`]);
      expect(ofStream(received, fresh)).toEqual([`${fresh}#1`, `${fresh}#2`]);
    } finally {
      listener.releaseConnect();
      listener.releaseOnlisten();
      await stop();
      await listener.end();
    }
  }, 30_000);

  it('schiebt den Cursor nicht weiter, wenn der Hook wirft, und liefert später lückenlos nach', async () => {
    const received: number[] = [];
    const errors: unknown[] = [];
    let fail = true;
    const stop = await listen(
      (op) => {
        if (fail && op.seq === 2) throw new Error('Versand gescheitert');
        received.push(op.seq);
      },
      (e) => errors.push(e),
    );
    try {
      const stream = sessionStream();
      await append(stream, markerOp());
      await append(stream, markerOp());
      await append(stream, markerOp());
      await waitFor(() => errors.length >= 1);
      await sleep(50);
      expect(received).toEqual([1]);
      fail = false;
      await append(stream, markerOp()); // nächste Benachrichtigung des Stroms
      await waitFor(() => received.length === 4);
      expect(received).toEqual([1, 2, 3, 4]);
    } finally {
      await stop();
    }
  });

  it('warnt, wenn der Hook ohne laufenden Listener gesetzt wird', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setOnOpCommitted(() => {});
    expect(warn).toHaveBeenCalledTimes(1);
    const stop = await listenCommittedOps(handle.sql, handle.db);
    setOnOpCommitted(() => {});
    expect(warn).toHaveBeenCalledTimes(1);
    await stop();
  });
});
