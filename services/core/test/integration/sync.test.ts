// Sync-Server (T1-08, VERTRAEGE §11, §16.2): Anmeldung, Resume, Dispatcher, Reihenfolge, Grenzen, Ereignisse.
// Echte App auf einem freien Port, echter WebSocket-Client, Test-Handler statt der Fach-Handler.
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SyncEvent } from '@sg/shared';
import type { Tx } from '../../src/db/client.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { appendOp, findOpById, setOnOpCommitted, type AppendOpInput } from '../../src/sync/append.ts';
import { publishAfterCommit, publishEvent } from '../../src/sync/events.ts';
import { registerOpHandler, SyncOpError } from '../../src/sync/handlers.ts';
import { getActiveHub } from '../../src/sync/hub.ts';
import { syncLimits } from '../../src/sync/limits.ts';
import {
  markerOp,
  sessionStream,
  sleep,
  startSyncApp,
  TestClient,
  waitFor,
  type Msg,
  type SyncTestApp,
} from './sync-helpers.ts';

let app: SyncTestApp;
let url: string;
const clients: TestClient[] = [];
const defaults = { ...syncLimits };

// Test-Handler: Verhalten über `note` des Markers, Wirkung in einer eigenen Tabelle (Rollback sichtbar)
registerOpHandler('marker.add', async (tx, op, ctx) => {
  if (op.kind !== 'marker.add') throw new Error('falsche Art');
  await tx.execute(
    sql`INSERT INTO t108_effect (op_id, marker_id, origin, device_id) VALUES (${op.op_id}, ${op.data.marker_id}, ${ctx.origin}, ${ctx.deviceId})`,
  );
  const note = op.data.note ?? '';
  if (note.startsWith('slow:')) await sleep(Number(note.slice(5)));
  if (note === 'retry') throw new SyncOpError('internal_error', true);
  if (note === 'reject') throw new SyncOpError('module_not_found', false, { module_id: 'x' });
  if (note === 'superseded')
    throw new SyncOpError('session_superseded', false, { session_id: op.data.session_id });
  if (note === 'boom') throw new Error('Handler kaputt');
  if (note === 'fatal') throw new SyncOpError('module_not_found', false, undefined, { fatal: true });
});
registerOpHandler('marker.remove', async () => {});

// Wie T1-02: Advisory-Sperre vor sync_stream. Mit preLock (session.pause) bzw. erst im Handler (session.resume)
const ADVISORY_KEY = 108_108;
const lockAdvisory = async (tx: Tx) => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_KEY})`);
};
/** op_ids, deren Handler lief, und ob die Client-Operation dabei schon in sync_op stand */
const handlerSawOwnOp = new Map<string, boolean>();
registerOpHandler(
  'session.pause',
  async (tx, op) => {
    const [row] = await tx.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM sync_op WHERE op_id = ${op.op_id}`,
    );
    handlerSawOwnOp.set(op.op_id, Number(row!.n) === 1);
  },
  { preLock: async (tx) => lockAdvisory(tx) },
);
registerOpHandler('session.resume', async (tx) => lockAdvisory(tx));

beforeAll(async () => {
  app = await startSyncApp();
  url = `ws://127.0.0.1:${app.port}/sync`;
  await app.handle
    .sql`CREATE TABLE IF NOT EXISTS t108_effect (op_id uuid, marker_id uuid, origin text, device_id uuid)`;
});
afterEach(() => {
  Object.assign(syncLimits, defaults);
  for (const c of clients.splice(0)) c.close();
});
afterAll(async () => {
  for (const c of clients.splice(0)) c.close();
  await app.close();
});

async function connect(headers: Record<string, string> = {}): Promise<TestClient> {
  const client = await TestClient.open(url, headers);
  clients.push(client);
  return client;
}

/** Verbunden und angemeldet, `streams` ab Anfang abonniert */
async function ready(...streams: string[]): Promise<TestClient> {
  const client = await connect();
  const welcome = await client.hello(streams.map((stream) => ({ stream, last_seq: 0, last_op_id: null })));
  expect(welcome.type).toBe('welcome');
  return client;
}

const serverOp = (overrides: Partial<AppendOpInput> = {}): AppendOpInput => ({
  kind: 'marker.remove',
  data: { marker_id: uuidv7() },
  at: 1_793_800_000_000,
  clockUncertain: false,
  origin: 'server',
  ...overrides,
});

const append = (stream: string, op: AppendOpInput = serverOp()) =>
  app.handle.db.transaction((tx) => appendOp(tx, stream, op));

const effects = async (opId: string) =>
  (await app.handle.sql`SELECT * FROM t108_effect WHERE op_id = ${opId}`).length;
const storedOps = async (stream: string) =>
  Number((await app.handle.sql`SELECT count(*) AS n FROM sync_op WHERE stream = ${stream}`)[0]!.n);

/** Alle seq-tragenden Nachrichten (ack und Weitergabe) eines Stroms in Empfangsreihenfolge */
const seqsOf = (client: TestClient, stream: string) =>
  client.messages
    .filter((m) => (m.type === 'ack' || m.type === 'op') && m.stream === stream)
    .map((m) => m.seq as number);

describe('Anmeldung (§11.1)', () => {
  it('antwortet auf hello mit welcome (db_epoch aus sync_meta), ping und time.ping', async () => {
    const client = await connect();
    const welcome = await client.hello();
    const [meta] = await app.handle.sql`SELECT db_epoch FROM sync_meta`;
    expect(welcome).toMatchObject({
      type: 'welcome',
      protocol: 1,
      db_epoch: meta!.db_epoch,
      device_id: null,
      server_version: expect.any(String),
      resume: [],
    });
    expect(Math.abs((welcome.server_time as number) - Date.now())).toBeLessThan(5000);

    client.send({ type: 'ping' });
    expect(await client.next((m) => m.type === 'pong')).toEqual({ type: 'pong' });
    const t0 = Date.now() - 1000;
    client.send({ type: 'time.ping', t0 });
    const pong = await client.next((m) => m.type === 'time.pong');
    expect(pong.t0).toBe(t0);
    expect(Math.abs((pong.ts as number) - Date.now())).toBeLessThan(5000);
    // Lokale Web-App: time.offset wird angenommen, aber nicht gespeichert (kein Gerät)
    client.send({ type: 'time.offset', offset_ms: 0, rtt_ms: 2 });
    client.send({ type: 'ping' });
    await client.next((m) => m.type === 'pong');
    expect(client.of('error')).toEqual([]);
  });

  it('schließt ohne hello nach der Frist mit hello_required und 4408', async () => {
    syncLimits.helloTimeoutMs = 200;
    const client = await connect();
    const error = await client.next((m) => m.type === 'error');
    expect(error).toMatchObject({ code: 'hello_required', fatal: true });
    expect(await client.closed()).toBe(4408);
  });

  it('verlangt hello als erste Nachricht (4408), prüft protocol (4426) und Inhalt (hello_invalid)', async () => {
    const a = await connect();
    a.send({ type: 'ping' });
    expect(await a.next((m) => m.type === 'error')).toMatchObject({ code: 'hello_required', fatal: true });
    expect(await a.closed()).toBe(4408);

    const b = await connect();
    b.send({ type: 'hello', protocol: 2, client: 'web', app_version: 'x', streams: [] });
    expect(await b.next((m) => m.type === 'error')).toMatchObject({
      code: 'protocol_unsupported',
      fatal: true,
    });
    expect(await b.closed()).toBe(4426);

    const c = await connect();
    c.send({ type: 'hello', protocol: 1, client: 'web', streams: [] });
    expect(await c.next((m) => m.type === 'error')).toMatchObject({ code: 'hello_invalid', fatal: true });
    expect(await c.closed()).toBe(4408);

    const d = await connect();
    d.send('kein json');
    expect(await d.next((m) => m.type === 'error')).toMatchObject({ code: 'hello_required' });
    expect(await d.closed()).toBe(4408);
  });

  it('lehnt ein zweites hello und ungültige Nachrichten ab, ohne zu schließen', async () => {
    const client = await ready();
    client.send({ type: 'hello', protocol: 1, client: 'web', app_version: 'x', streams: [] });
    expect(await client.next((m) => m.type === 'error')).toMatchObject({
      code: 'message_invalid',
      fatal: false,
      retryable: false,
    });
    client.send('{kaputt');
    client.send({ type: 'gibt-es-nicht' });
    client.send({ type: 'presence', session_id: 'KEINE-UUID', notebook_id: null, page_id: null });
    for (let i = 0; i < 3; i += 1) {
      expect(await client.next((m) => m.type === 'error')).toMatchObject({
        code: 'message_invalid',
        fatal: false,
      });
    }
    client.send({ type: 'ping' });
    await client.next((m) => m.type === 'pong');
    expect(client.closeCode).toBeNull();
  });

  it('prüft beim Upgrade den Origin (403) und schließt Upgrades auf andere Pfade', async () => {
    const evil = new TestClient(url, { origin: 'https://boese.example' });
    clients.push(evil);
    await evil.closed();
    expect(evil.httpStatus).toBe(403);

    const own = await connect({ origin: `http://localhost:${app.port}` });
    expect((await own.hello()).type).toBe('welcome');

    const other = new TestClient(`ws://127.0.0.1:${app.port}/api/v1/health`);
    clients.push(other);
    await other.closed();
    expect(other.messages).toEqual([]);
  });
});

describe('Resume-Tabelle (§11.1)', () => {
  it('beantwortet jede Zeile der Tabelle und sendet bei reset nichts', async () => {
    const streams = Array.from({ length: 6 }, () => sessionStream());
    const ids: string[][] = [];
    for (const s of streams) {
      const row: string[] = [];
      for (let i = 0; i < 3; i += 1) row.push((await append(s)).opId);
      ids.push(row);
    }
    const [s1, s2, s3, s4, s5, s6] = streams as [string, string, string, string, string, string];
    const fresh = sessionStream();
    const client = await connect();
    const welcome = await client.hello([
      { stream: s1, last_seq: 0, last_op_id: null }, // Zeile 1
      { stream: s2, last_seq: 2, last_op_id: ids[1]![1] }, // Zeile 2
      { stream: s3, last_seq: 5, last_op_id: uuidv7() }, // Zeile 3: head_seq < n
      { stream: s4, last_seq: 2, last_op_id: uuidv7() }, // Zeile 3: andere op_id
      { stream: s5, last_seq: 0, last_op_id: ids[4]![0] }, // Lücke: 0 mit op_id → reset
      { stream: s6, last_seq: 2, last_op_id: null }, // n > 0 ohne op_id → reset
      { stream: fresh, last_seq: 0, last_op_id: null }, // unbekannter Strom
    ]);
    expect(welcome.resume).toEqual([
      { stream: s1, from_seq: 1, head_seq: 3, reset: false },
      { stream: s2, from_seq: 3, head_seq: 3, reset: false },
      { stream: s3, from_seq: 1, head_seq: 3, reset: true },
      { stream: s4, from_seq: 1, head_seq: 3, reset: true },
      { stream: s5, from_seq: 1, head_seq: 3, reset: true },
      { stream: s6, from_seq: 1, head_seq: 3, reset: true },
      { stream: fresh, from_seq: 1, head_seq: 0, reset: false },
    ]);

    await waitFor(() => client.of('op').length === 4);
    // Reihenfolge gilt pro Strom, die Ströme werden parallel nachgeliefert
    expect(seqsOf(client, s1)).toEqual([1, 2, 3]);
    expect(seqsOf(client, s2)).toEqual([3]);
    expect(client.of('op').find((m) => m.stream === s1 && m.seq === 1)).toEqual({
      type: 'op',
      op_id: ids[0]![0],
      stream: s1,
      kind: 'marker.remove',
      at: 1_793_800_000_000,
      clock_uncertain: false,
      data: expect.objectContaining({ marker_id: expect.any(String) }),
      seq: 1,
      origin: 'server',
    });

    // Neue Operationen: nur abonnierte Ströme, reset-Ströme bleiben still
    for (const s of [s3, s4, s5, s6, s1, fresh]) await append(s);
    await waitFor(() => client.of('op').length === 6);
    await sleep(100);
    expect(
      client
        .of('op')
        .slice(4)
        .map((m) => [m.stream, m.seq]),
    ).toEqual([
      [s1, 4],
      [fresh, 1],
    ]);
  });

  it('subscribe/unsubscribe ändern Abos ohne neue Verbindung', async () => {
    const a = sessionStream();
    const b = sessionStream();
    const first = await append(a);
    await append(a);
    const client = await ready(b);

    client.send({ type: 'subscribe', streams: [{ stream: a, last_seq: 1, last_op_id: first.opId }] });
    const subscribed = await client.next((m) => m.type === 'subscribed');
    expect(subscribed.resume).toEqual([{ stream: a, from_seq: 2, head_seq: 2, reset: false }]);
    await client.next((m) => m.type === 'op' && m.stream === a && m.seq === 2);

    client.send({ type: 'unsubscribe', streams: [a] });
    client.send({ type: 'ping' });
    await client.next((m) => m.type === 'pong');
    await append(a);
    await append(b);
    await client.next((m) => m.type === 'op' && m.stream === b);
    await sleep(100);
    expect(client.of('op').filter((m) => m.stream === a)).toEqual([]);

    // reset über subscribe: kein Abo, keine Nachlieferung
    client.send({ type: 'subscribe', streams: [{ stream: a, last_seq: 9, last_op_id: uuidv7() }] });
    expect((await client.next((m) => m.type === 'subscribed')).resume).toEqual([
      { stream: a, from_seq: 1, head_seq: 3, reset: true },
    ]);
    await append(a);
    await sleep(100);
    expect(client.of('op').filter((m) => m.stream === a)).toEqual([]);
  });

  it('begrenzt parallele Nachlieferungen und liefert trotzdem alle Ströme vollständig', async () => {
    syncLimits.maxCatchUpQueries = 1;
    syncLimits.catchUpBatch = 2;
    const streams = Array.from({ length: 20 }, () => sessionStream());
    for (const s of streams) for (let i = 0; i < 5; i += 1) await append(s);
    const client = await ready(...streams);
    await waitFor(() => client.of('op').length === 100, 15_000, 'alle Ströme');
    for (const s of streams) expect(seqsOf(client, s)).toEqual([1, 2, 3, 4, 5]);
  });

  it('liefert einen großen Rückstand aus einer Transaktion paketweise und lückenlos aus (Listener)', async () => {
    const s = sessionStream();
    const client = await ready(s);
    await app.handle.db.transaction(async (tx) => {
      for (let i = 0; i < 1200; i += 1) await appendOp(tx, s, serverOp());
    });
    await waitFor(() => seqsOf(client, s).length === 1200, 20_000, '1200 Operationen');
    expect(seqsOf(client, s)).toEqual(Array.from({ length: 1200 }, (_, i) => i + 1));
  }, 30_000);

  it('liefert große Ströme in Paketen lückenlos nach, auch wenn währenddessen neue Operationen kommen', async () => {
    syncLimits.catchUpBatch = 7;
    const s = sessionStream();
    for (let i = 0; i < 40; i += 1) await append(s);
    const client = await connect();
    client.send({
      type: 'hello',
      protocol: 1,
      client: 'web',
      app_version: 't',
      streams: [{ stream: s, last_seq: 0, last_op_id: null }],
    });
    for (let i = 0; i < 10; i += 1) await append(s);
    await waitFor(() => client.of('op').length === 50, 10_000);
    expect(seqsOf(client, s)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });
});

describe('Operationen, ack und Duplikate (§11.2, §16.2)', () => {
  it('bestätigt mit ack, gibt an Abonnenten weiter und nicht an den Absender zurück', async () => {
    const s = sessionStream();
    const a = await ready(s);
    const b = await ready(s);
    const op = markerOp(s);
    a.send(op);
    expect(await a.next((m) => m.type === 'ack')).toEqual({
      type: 'ack',
      op_id: op.op_id,
      stream: s,
      seq: 1,
    });
    const forwarded = await b.next((m) => m.type === 'op');
    expect(forwarded).toEqual({ ...op, seq: 1, origin: 'web' });
    await sleep(100);
    expect(a.of('op')).toEqual([]);
    expect(await effects(op.op_id as string)).toBe(1);
    const [row] = await app.handle
      .sql`SELECT origin, device_id FROM t108_effect WHERE op_id = ${op.op_id as string}`;
    expect(row).toEqual({ origin: 'web', device_id: null });
    expect(await findOpById(app.handle.db, op.op_id as string)).toMatchObject({
      seq: 1,
      origin: 'web',
      deviceId: null,
    });
  });

  it('beantwortet ein Duplikat mit dem ursprünglichen ack und eine abweichende op_id mit op_id_reused', async () => {
    const s = sessionStream();
    const client = await ready();
    const op = markerOp(s);
    client.send(op);
    const ack = await client.next((m) => m.type === 'ack');
    client.send(op);
    expect(await client.next((m) => m.type === 'ack')).toEqual(ack);
    expect(await effects(op.op_id as string)).toBe(1);
    expect(await storedOps(s)).toBe(1);

    // Schlüsselreihenfolge egal (jsonb sortiert um)
    const data = op.data as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(data).reverse());
    client.send({ ...op, data: reordered });
    expect(await client.next((m) => m.type === 'ack')).toEqual(ack);

    client.send({ ...op, data: { ...data, t_ms: 9999 } });
    expect(await client.next((m) => m.type === 'error')).toEqual({
      type: 'error',
      code: 'op_id_reused',
      message: expect.any(String),
      op_id: op.op_id,
      stream: s,
      retryable: false,
      fatal: false,
      details: { op_id: op.op_id },
    });
    client.send({ ...op, stream: sessionStream() });
    expect(await client.next((m) => m.type === 'error')).toMatchObject({ code: 'op_id_reused' });
    client.send({ type: 'ping' });
    await client.next((m) => m.type === 'pong');
    expect(client.closeCode).toBeNull();
  });

  it('fängt dieselbe op_id gleichzeitig auf zwei Verbindungen ab (Rollback des Handlers, gleiches ack)', async () => {
    const s = sessionStream();
    const a = await ready();
    const b = await ready();
    const op = markerOp(s);
    (op.data as Record<string, unknown>).note = 'slow:300';
    a.send(op);
    b.send(op);
    const ackA = await a.next((m) => m.type === 'ack');
    const ackB = await b.next((m) => m.type === 'ack');
    expect(ackA).toEqual({ type: 'ack', op_id: op.op_id, stream: s, seq: 1 });
    expect(ackB).toEqual(ackA);
    expect(await effects(op.op_id as string)).toBe(1);
    expect(await storedOps(s)).toBe(1);
    await sleep(100);
    expect([...a.of('ack'), ...b.of('ack'), ...a.of('error'), ...b.of('error')]).toEqual([]);
  });

  it('gleichzeitiges Duplikat bei abonniertem Absender: ack statt Weitergabe, Reihenfolge bleibt', async () => {
    const s = sessionStream();
    const a = await ready(s);
    const b = await ready(s);
    const op = markerOp(s);
    (op.data as Record<string, unknown>).note = 'slow:200';
    a.send(op);
    b.send(op);
    await a.next((m) => m.type === 'ack');
    await b.next((m) => m.type === 'ack');
    a.send(markerOp(s));
    await a.next((m) => m.type === 'ack');
    await b.next((m) => m.type === 'op' && m.seq === 2);
    expect(await storedOps(s)).toBe(2);
  });

  it('hält ack und Weitergaben über zwei Verbindungen in seq-Reihenfolge', async () => {
    const s = sessionStream();
    const other = sessionStream();
    const a = await ready(s);
    const b = await ready(s);
    const n = 30;
    for (let i = 0; i < n; i += 1) {
      a.send(markerOp(s));
      b.send(markerOp(s));
      if (i % 5 === 0) a.send(markerOp(other)); // anderer Strom dazwischen
    }
    await waitFor(() => seqsOf(a, s).length === 2 * n && seqsOf(b, s).length === 2 * n, 15_000, 'alle seq');
    const expected = Array.from({ length: 2 * n }, (_, i) => i + 1);
    expect(seqsOf(a, s)).toEqual(expected);
    expect(seqsOf(b, s)).toEqual(expected);
    expect(a.of('ack').filter((m) => m.stream === s)).toHaveLength(n);
    expect(b.of('ack').filter((m) => m.stream === s)).toHaveLength(n);
  });

  it('Duplikat-ack wartet auf den Cursor (Hook gebremst, aus dem Review von #66)', async () => {
    const s = sessionStream();
    const subscriber = await ready(s);
    const sender = await ready();
    const hub = getActiveHub()!;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // Versand des Stroms bremsen: Die Operationen sind committet, aber noch nicht ausgeliefert
    setOnOpCommitted(async (op) => {
      if (op.stream === s) await gate;
      hub.onOpCommitted(op);
    });
    try {
      await append(s);
      const op = markerOp(s);
      sender.send(op);
      for (let i = 0; i < 400; i += 1) {
        if ((await app.handle.sql`SELECT 1 FROM sync_op WHERE op_id = ${op.op_id as string}`).length) break;
        await sleep(2);
      }
      // Dieselbe Operation über die abonnierte Verbindung: findOpById findet sie, der Cursor steht aber bei 0
      subscriber.send(op);
      await sleep(300);
      expect(seqsOf(subscriber, s)).toEqual([]);
      release();
      await waitFor(() => seqsOf(subscriber, s).length >= 2, 10_000);
      await sleep(100);
      expect(seqsOf(subscriber, s)).toEqual([1, 2]);
      expect(subscriber.messages.filter((m) => m.stream === s).map((m) => m.type)).toEqual(['op', 'ack']);
      expect(seqsOf(sender, s)).toEqual([2]);
    } finally {
      release();
      setOnOpCommitted(hub.onOpCommitted);
    }
  }, 30_000);

  it('Duplikat-ack ohne Abo wartet ebenfalls auf den Cursor', async () => {
    const s = sessionStream();
    const watcher = await ready(s);
    const first = await ready();
    const second = await ready();
    const hub = getActiveHub()!;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setOnOpCommitted(async (op) => {
      if (op.stream === s) await gate;
      hub.onOpCommitted(op);
    });
    try {
      const op = markerOp(s);
      first.send(op);
      for (let i = 0; i < 400; i += 1) {
        if ((await app.handle.sql`SELECT 1 FROM sync_op WHERE op_id = ${op.op_id as string}`).length) break;
        await sleep(2);
      }
      second.send(op);
      await sleep(300);
      // Vor dem Versand von seq 1 darf kein ack raus (sonst käme es vor der Weitergabe beim Abonnenten an)
      expect(second.of('ack')).toEqual([]);
      expect(first.of('ack')).toEqual([]);
      release();
      await second.next((m) => m.type === 'ack');
      await first.next((m) => m.type === 'ack');
      await watcher.next((m) => m.type === 'op' && m.seq === 1);
    } finally {
      release();
      setOnOpCommitted(hub.onOpCommitted);
    }
  }, 30_000);

  it('schließt nach einem wiederholbaren Fehler mit 4503 und bearbeitet danach nichts mehr', async () => {
    const s = sessionStream();
    const client = await ready();
    const ok = markerOp(s);
    const failing = markerOp(s);
    (failing.data as Record<string, unknown>).note = 'retry';
    const after = markerOp(s);
    client.send(ok);
    client.send(failing);
    client.send(after);
    expect(await client.closed()).toBe(4503);
    // Reihenfolge: erst das ack der früheren Operation, dann der fatale Fehler, sonst nichts
    const answers = client.messages.filter((m) => m.type === 'ack' || m.type === 'error');
    expect(answers).toEqual([
      { type: 'ack', op_id: ok.op_id, stream: s, seq: 1 },
      expect.objectContaining({
        type: 'error',
        code: 'internal_error',
        op_id: failing.op_id,
        stream: s,
        retryable: true,
        fatal: true,
      }),
    ]);
    // Rollback: weder Wirkung noch sync_op für die gescheiterte, nichts für die folgende
    expect(await effects(failing.op_id as string)).toBe(0);
    expect(await effects(after.op_id as string)).toBe(0);
    expect(await storedOps(s)).toBe(1);
  });

  it('meldet nicht wiederholbare Fehler und lässt die Verbindung offen', async () => {
    const s = sessionStream();
    const client = await ready();
    const rejected = markerOp(s);
    (rejected.data as Record<string, unknown>).note = 'reject';
    client.send(rejected);
    const next = markerOp(s);
    client.send(next);
    expect(await client.next((m) => m.type === 'error')).toEqual({
      type: 'error',
      code: 'module_not_found',
      message: expect.any(String),
      op_id: rejected.op_id,
      stream: s,
      retryable: false,
      fatal: false,
      details: { module_id: 'x' },
    });
    expect(await client.next((m) => m.type === 'ack')).toMatchObject({ op_id: next.op_id, seq: 1 });
    expect(client.closeCode).toBeNull();
  });

  it('session_superseded: frühere Operationen bekommen ihr ack, dann error und 4409', async () => {
    const s = sessionStream();
    const client = await ready();
    const first = markerOp(s);
    (first.data as Record<string, unknown>).note = 'slow:50';
    const superseded = markerOp(s);
    (superseded.data as Record<string, unknown>).note = 'superseded';
    client.send(first);
    client.send(superseded);
    await client.closed();
    expect(client.closeCode).toBe(4409);
    const relevant = client.messages.filter((m) => m.type === 'ack' || m.type === 'error');
    expect(relevant.map((m) => m.type)).toEqual(['ack', 'error']);
    expect(relevant[1]).toMatchObject({
      code: 'session_superseded',
      op_id: superseded.op_id,
      retryable: false,
      fatal: true,
      details: { session_id: s.slice(8) },
    });
  });

  it('macht aus unerwarteten Handler-Fehlern internal_error (4503)', async () => {
    const client = await ready();
    const op = markerOp(sessionStream());
    (op.data as Record<string, unknown>).note = 'boom';
    client.send(op);
    expect(await client.next((m) => m.type === 'error')).toMatchObject({
      code: 'internal_error',
      retryable: true,
      fatal: true,
      op_id: op.op_id,
    });
    expect(await client.closed()).toBe(4503);
  });

  it('lehnt unbekannte kind, seq/origin vom Client und Server-Operationen ab', async () => {
    const s = sessionStream();
    const client = await ready();
    const unknown = markerOp(s, { kind: 'zauber.wirken' });
    client.send(unknown);
    expect(await client.next((m) => m.type === 'error')).toMatchObject({
      code: 'message_invalid',
      op_id: unknown.op_id,
      stream: s,
      retryable: false,
      fatal: false,
    });
    const withSeq = markerOp(s, { seq: 5 });
    client.send(withSeq);
    expect(await client.next((m) => m.type === 'error')).toMatchObject({
      code: 'message_invalid',
      op_id: withSeq.op_id,
    });
    const withOrigin = markerOp(s, { origin: 'server' });
    client.send(withOrigin);
    expect(await client.next((m) => m.type === 'error')).toMatchObject({ code: 'message_invalid' });
    const badData = markerOp(s, { data: { marker_id: 'x' } });
    client.send(badData);
    expect(await client.next((m) => m.type === 'error')).toMatchObject({
      code: 'message_invalid',
      op_id: badData.op_id,
    });
    const nb = `notebook:${uuidv7()}`;
    const serverOnly = {
      type: 'op',
      op_id: uuidv7(),
      stream: nb,
      kind: 'notebook.delete',
      at: 1,
      clock_uncertain: false,
      data: { notebook_id: nb.slice(9) },
    };
    client.send(serverOnly);
    expect(await client.next((m) => m.type === 'error')).toMatchObject({
      code: 'op_not_allowed',
      op_id: serverOnly.op_id,
      retryable: false,
      fatal: false,
    });
    client.send({ type: 'op' });
    expect(await client.next((m) => m.type === 'error')).toMatchObject({ code: 'message_invalid' });
    expect(await storedOps(s)).toBe(0);
    client.send({ type: 'ping' });
    await client.next((m) => m.type === 'pong');
    expect(client.closeCode).toBeNull();
  });

  it('ohne registrierten Handler: internal_error (wiederholbar), 4503', async () => {
    const nb = `notebook:${uuidv7()}`;
    const client = await ready();
    const op = {
      type: 'op',
      op_id: uuidv7(),
      stream: nb,
      kind: 'page.delete',
      at: 1,
      clock_uncertain: false,
      data: { page_id: uuidv7() },
    };
    client.send(op);
    expect(await client.next((m) => m.type === 'error')).toMatchObject({
      code: 'internal_error',
      retryable: true,
      fatal: true,
      details: { reason: 'handler_missing', kind: 'page.delete' },
    });
    expect(await client.closed()).toBe(4503);
  });

  it('too_many_pending: frühere Operationen laufen durch, dann error und 4503', async () => {
    syncLimits.maxPendingOps = 3;
    const s = sessionStream();
    const client = await ready();
    const ops = Array.from({ length: 5 }, () => {
      const op = markerOp(s);
      (op.data as Record<string, unknown>).note = 'slow:80';
      return op;
    });
    for (const op of ops) client.send(op);
    expect(await client.closed(10_000)).toBe(4503);
    expect(client.of('ack').map((m) => m.op_id)).toEqual(ops.slice(0, 3).map((o) => o.op_id));
    expect(client.of('error')).toEqual([
      expect.objectContaining({
        code: 'too_many_pending',
        op_id: ops[3]!.op_id,
        retryable: true,
        fatal: true,
      }),
    ]);
    expect(await storedOps(s)).toBe(3);
  });

  it('zählt nur unbeantwortete Operationen: 200 im Flug sind erlaubt', async () => {
    const s = sessionStream();
    const client = await ready();
    const ops = Array.from({ length: 200 }, () => markerOp(s));
    for (const op of ops) client.send(op);
    await waitFor(() => client.of('ack').length === 200, 20_000, '200 acks');
    expect(client.of('error')).toEqual([]);
    expect(seqsOf(client, s)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
  });
});

describe('preLock und fatal (§16.2)', () => {
  const sessionOp = (s: string, kind: 'session.pause' | 'session.resume'): Msg => ({
    type: 'op',
    op_id: uuidv7(),
    stream: s,
    kind,
    at: 1_793_800_000_000,
    clock_uncertain: false,
    data: { session_id: s.slice('session:'.length) },
  });

  /**
   * Zweite Transaktion wie T1-02: erst Advisory, dann appendOp im selben Strom. Dazwischen schickt der Client
   * seine Operation, deren Handler dieselbe Advisory-Sperre braucht.
   */
  async function race(kind: 'session.pause' | 'session.resume') {
    const s = sessionStream();
    const client = await ready();
    const op = sessionOp(s, kind);
    let parallelError: unknown = null;
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const parallel = app.handle.db
      .transaction(async (tx) => {
        await lockAdvisory(tx);
        locked();
        await sleep(200); // Dispatcher läuft inzwischen bis zur ersten Sperre
        await appendOp(tx, s, serverOp());
      })
      .catch((error: unknown) => {
        parallelError = error;
      });
    await isLocked;
    client.send(op);
    await parallel;
    const answer = await client.next((m) => m.type === 'ack' || m.type === 'error', 10_000);
    return { s, op, answer, parallelError, client };
  }

  it('nimmt die Sperren des Handlers vor appendOp: kein Deadlock, Handler läuft nach appendOp', async () => {
    for (let i = 0; i < 3; i += 1) {
      const { s, op, answer, parallelError } = await race('session.pause');
      expect(parallelError).toBeNull();
      expect(answer).toEqual({ type: 'ack', op_id: op.op_id, stream: s, seq: 2 });
      expect(handlerSawOwnOp.get(op.op_id as string)).toBe(true);
    }
  });

  it('Gegenprobe: Sperre erst im Handler führt zum Deadlock (40P01)', async () => {
    const { answer, parallelError, client } = await race('session.resume');
    const deadlocked =
      (parallelError as { code?: string; cause?: { code?: string } } | null)?.cause?.code === '40P01' ||
      (parallelError as { code?: string } | null)?.code === '40P01' ||
      (answer.type === 'error' && answer.code === 'internal_error');
    expect(deadlocked).toBe(true);
    if (answer.type === 'error') expect(await client.closed()).toBe(4503);
  });

  it('SyncOpError mit fatal: error mit fatal = true und Schließen (1008)', async () => {
    const client = await ready();
    const op = markerOp(sessionStream());
    (op.data as Record<string, unknown>).note = 'fatal';
    client.send(op);
    expect(await client.next((m) => m.type === 'error')).toMatchObject({
      code: 'module_not_found',
      op_id: op.op_id,
      retryable: false,
      fatal: true,
    });
    expect(await client.closed()).toBe(1008);
  });
});

describe('Grenzen und Keepalive (§11, §11.4)', () => {
  it('schließt bei Nachrichten über 1 MiB (1009) und bei Binär-Frames (1003)', async () => {
    const big = await ready();
    big.send(JSON.stringify({ type: 'ping', pad: 'x'.repeat(syncLimits.maxMessageBytes) }));
    expect(await big.closed()).toBe(1009);

    const binary = await ready();
    binary.ws.send(Buffer.from([1, 2, 3]));
    expect(await binary.next((m) => m.type === 'error')).toMatchObject({
      code: 'message_invalid',
      fatal: true,
    });
    expect(await binary.closed()).toBe(1003);
  });

  it('übersteht beliebigen Unsinn ohne Absturz', async () => {
    const client = await ready();
    const garbage = [
      'null',
      '42',
      '"text"',
      '[]',
      '[1,2,3]',
      '{}',
      '{"type":null}',
      '{"type":"op"}',
      '{"type":"op","op_id":5,"stream":[],"kind":{},"data":null}',
      '{"type":"op","op_id":"x","kind":"marker.add","seq":"a"}',
      '{"type":"subscribe","streams":"x"}',
      '{"type":"subscribe","streams":[{"stream":"user","last_seq":-1,"last_op_id":null}]}',
      '{"type":"unsubscribe","streams":[]}',
      '{"type":"time.ping","t0":"jetzt"}',
      '{"type":"time.offset","offset_ms":1e30,"rtt_ms":0}',
      '{"type":"presence"}',
      '{"type":"__proto__","__proto__":{"x":1}}',
      '['.repeat(10_000) + ']'.repeat(10_000),
      '{"type":"ping","x":' + '{"a":'.repeat(5000) + '1' + '}'.repeat(5000) + '}',
    ];
    for (const g of garbage) client.send(g);
    await waitFor(() => client.of('error').length === garbage.length, 5000, 'Fehler für jeden Unsinn');
    expect(client.of('error').every((m) => m.fatal === false && m.retryable === false)).toBe(true);
    client.send({ type: 'ping' });
    await client.next((m) => m.type === 'pong');
    expect(client.closeCode).toBeNull();
  });

  it('nimmt eine Nachricht knapp unter der Grenze an', async () => {
    const client = await ready();
    const op = markerOp(sessionStream());
    (op.data as Record<string, unknown>).note = 'y'.repeat(syncLimits.maxMessageBytes - 1000);
    client.send(op);
    expect(await client.next((m) => m.type === 'ack')).toMatchObject({ op_id: op.op_id });
  });

  it('schließt Verbindungen ohne Lebenszeichen nach der Leerlauffrist, ping hält sie offen', async () => {
    syncLimits.idleTimeoutMs = 400;
    const idle = await ready();
    const alive = await ready();
    const timer = setInterval(() => alive.send({ type: 'ping' }), 100);
    try {
      expect(await idle.closed(3000)).toBe(1001);
      await sleep(300);
      expect(alive.closeCode).toBeNull();
      expect(alive.of('pong').length).toBeGreaterThan(3);
    } finally {
      clearInterval(timer);
    }
  });

  it('begrenzt die Rate von Steuernachrichten', async () => {
    syncLimits.controlBurst = 20;
    syncLimits.controlPerSecond = 1;
    const client = await ready();
    for (let i = 0; i < 40; i += 1) client.send({ type: 'ping' });
    expect(await client.closed()).toBe(1008);
  });
});

describe('Ereignisse (§11.6, §16.2)', () => {
  const connectionEvent = (connected: boolean): SyncEvent => ({
    type: 'event',
    name: 'device.connection',
    data: { client: 'ipad', device_id: uuidv7(), connected },
  });

  it('meldet andere Clients mit device.connection und gibt presence weiter', async () => {
    const a = await ready();
    const b = await ready();
    expect(await a.next((m) => m.type === 'event' && m.name === 'device.connection')).toEqual({
      type: 'event',
      name: 'device.connection',
      data: { client: 'web', device_id: null, connected: true },
    });
    const session = uuidv7();
    b.send({ type: 'presence', session_id: session, notebook_id: null, page_id: null });
    expect(await a.next((m) => m.type === 'event' && m.name === 'presence')).toEqual({
      type: 'event',
      name: 'presence',
      data: {
        client: 'web',
        device_id: null,
        device_name: null,
        session_id: session,
        notebook_id: null,
        page_id: null,
      },
    });
    // Neuer Client bekommt den aktuellen Stand der anderen
    const c = await ready();
    await waitFor(() => c.of('event').filter((m) => m.name === 'device.connection').length >= 2);
    await c.next((m) => m.type === 'event' && m.name === 'presence');
    b.close();
    await a.next(
      (m) =>
        m.type === 'event' &&
        m.name === 'device.connection' &&
        (m.data as { connected: boolean }).connected === false,
    );
  });

  it('publishAfterCommit sendet nach dem Commit, nach den Operationen derselben Transaktion, nie bei Rollback', async () => {
    const s = sessionStream();
    const client = await ready(s);
    const event = connectionEvent(true);
    await app.handle.db.transaction(async (tx) => {
      await appendOp(tx, s, serverOp());
      await publishAfterCommit(tx, event);
    });
    const isEvent = (m: Msg) => JSON.stringify(m) === JSON.stringify(event);
    await waitFor(() => client.messages.some(isEvent));
    const opIndex = client.messages.findIndex((m) => m.type === 'op' && m.stream === s && m.seq === 1);
    expect(opIndex).toBeGreaterThanOrEqual(0);
    expect(opIndex).toBeLessThan(client.messages.findIndex(isEvent));

    const rolledBack = connectionEvent(false);
    await app.handle.db
      .transaction(async (tx) => {
        await publishAfterCommit(tx, rolledBack);
        throw new Error('Rollback');
      })
      .catch(() => {});
    const marker = connectionEvent(true);
    await app.handle.db.transaction((tx) => publishAfterCommit(tx, marker));
    await client.next((m) => m.type === 'event' && JSON.stringify(m) === JSON.stringify(marker));
    expect(client.messages.some((m) => JSON.stringify(m) === JSON.stringify(rolledBack))).toBe(false);
  });

  it('hält die Reihenfolge Operation vor Ereignis auch über viele Transaktionen', async () => {
    const s = sessionStream();
    const client = await ready(s);
    for (let i = 1; i <= 10; i += 1) {
      await app.handle.db.transaction(async (tx) => {
        await appendOp(tx, s, serverOp());
        await publishAfterCommit(tx, {
          type: 'event',
          name: 'presence',
          data: {
            client: 'ipad',
            device_id: null,
            device_name: `#${i}`,
            session_id: null,
            notebook_id: null,
            page_id: null,
          },
        });
      });
    }
    await waitFor(() => client.of('event').filter((m) => m.name === 'presence').length === 10);
    const sequence = client.messages
      .filter((m) => m.type === 'op' || (m.type === 'event' && m.name === 'presence'))
      .map((m) => (m.type === 'op' ? `op${m.seq}` : `ev${(m.data as { device_name: string }).device_name}`));
    // Kein Ereignis vor der Operation seiner Transaktion. Spätere Operationen dürfen früher kommen, weil der
    // Listener alle bis dahin committeten Operationen eines Stroms auf einmal liest
    expect(seqsOf(client, s)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    for (let i = 1; i <= 10; i += 1) {
      expect(sequence.indexOf(`op${i}`)).toBeLessThan(sequence.indexOf(`ev#${i}`));
    }
  });

  it('Ereignisse warten hinter einer laufenden Nachlieferung (aus dem Review von #66)', async () => {
    syncLimits.catchUpBatch = 5;
    const s = sessionStream();
    for (let i = 0; i < 300; i += 1) await append(s);
    const client = await ready();
    client.send({ type: 'subscribe', streams: [{ stream: s, last_seq: 0, last_op_id: null }] });
    await client.next((m) => m.type === 'subscribed');
    const event: SyncEvent = {
      type: 'event',
      name: 'device.connection',
      data: { client: 'ipad', device_id: uuidv7(), connected: true },
    };
    await app.handle.db.transaction(async (tx) => {
      await appendOp(tx, s, serverOp());
      await publishAfterCommit(tx, event);
    });
    const direct: SyncEvent = { ...event, data: { ...event.data, device_id: uuidv7() } } as SyncEvent;
    publishEvent(direct);
    await waitFor(() => seqsOf(client, s).length === 301, 10_000);
    const same = (e: SyncEvent) => (m: Msg) => JSON.stringify(m) === JSON.stringify(e);
    await waitFor(() => client.messages.some(same(event)) && client.messages.some(same(direct)));
    const opIndex = client.messages.findIndex((m) => m.type === 'op' && m.seq === 301);
    expect(client.messages.findIndex(same(event))).toBeGreaterThan(opIndex);
    expect(client.messages.findIndex(same(direct))).toBeGreaterThan(opIndex);
    expect(seqsOf(client, s)).toEqual(Array.from({ length: 301 }, (_, i) => i + 1));
  });

  it('publishAfterCommit wirft über 7000 Byte', async () => {
    const huge: SyncEvent = {
      type: 'event',
      name: 'presence',
      data: {
        client: 'ipad',
        device_id: null,
        device_name: 'ä'.repeat(3600),
        session_id: null,
        notebook_id: null,
        page_id: null,
      },
    };
    await expect(app.handle.db.transaction((tx) => publishAfterCommit(tx, huge))).rejects.toThrow(/zu groß/);
  });

  it('publishEvent erreicht alle lokalen Clients (localOnly: lokal = ohne Gerät)', async () => {
    const client = await ready();
    const event = connectionEvent(true);
    publishEvent(event, { localOnly: true });
    await client.next((m) => JSON.stringify(m) === JSON.stringify(event));
  });
});

describe('Ausfall der LISTEN-Verbindung', () => {
  it('liefert ack und Weitergaben trotzdem aus, sobald der Listener wieder steht', async () => {
    const s = sessionStream();
    const a = await ready(s);
    const b = await ready(s);
    const listeners = await app.handle.sql`SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND query ILIKE 'listen %' AND pid <> pg_backend_pid()`;
    expect(listeners.length).toBeGreaterThan(0);
    for (const l of listeners) await app.handle.sql`SELECT pg_terminate_backend(${l.pid})`;

    const ops = [markerOp(s), markerOp(s)];
    for (const op of ops) a.send(op);
    await append(s);
    await waitFor(
      () => seqsOf(a, s).length === 3 && seqsOf(b, s).length === 3,
      20_000,
      'Auslieferung nach Abbruch',
    );
    expect(seqsOf(a, s)).toEqual([1, 2, 3]);
    expect(seqsOf(b, s)).toEqual([1, 2, 3]);
    expect(a.of('ack').map((m: Msg) => m.op_id)).toEqual(ops.map((o) => o.op_id));
  }, 30_000);
});
