// Web-Sync-Client gegen den Fake-Server (VERTRAEGE §11)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncOp } from '@sg/shared';
import { SyncClient, SyncRejectedError } from '../src/lib/sync/client.ts';
import { MemoryQueueStore } from '../src/lib/sync/store.ts';
import type { SendOpInput } from '../src/lib/sync/types.ts';
import { FakeServer, nbStream, sessStream, uid, type FakeSocket } from './sync-fake-server.ts';

const settle = async () => {
  for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
};

const notebookCreate = (n: number, id?: string): SendOpInput =>
  ({
    ...(id ? { op_id: id } : {}),
    stream: nbStream(n),
    kind: 'notebook.create',
    data: { notebook_id: uid(n), module_id: uid(10), title: 'Skizzen', kind: 'frei', created_at: 1 },
  }) as SendOpInput;

const pageCreate = (page: number, nb: number, session: number | null = null): SendOpInput =>
  ({
    stream: nbStream(nb),
    kind: 'page.create',
    data: {
      page_id: uid(page),
      notebook_id: uid(nb),
      session_id: session === null ? null : uid(session),
      index: 1,
      template: 'blanko',
      width_pt: 595,
      height_pt: 842,
      background_slide_id: null,
      attached_slide_id: null,
    },
  }) as SendOpInput;

const sessionStart = (s: number): SendOpInput =>
  ({
    stream: sessStream(s),
    kind: 'session.start',
    data: {
      session_id: uid(s),
      module_id: uid(10),
      calendar_event_id: uid(20),
      slide_deck_id: null,
      started_from: 'ipad',
      started_at: 1000,
    },
  }) as SendOpInput;

const sessionPause = (s: number): SendOpInput =>
  ({ stream: sessStream(s), kind: 'session.pause', data: { session_id: uid(s) } }) as SendOpInput;

let server: FakeServer;
let store: MemoryQueueStore;
let clients: SyncClient[];

function make(opts: Partial<ConstructorParameters<typeof SyncClient>[0]> = {}): SyncClient {
  const c = new SyncClient({
    url: 'ws://test/sync',
    store,
    webSocketFactory: server.factory,
    random: () => 0,
    ...opts,
  });
  clients.push(c);
  return c;
}

const sentOpIds = (s: FakeSocket) => s.of('op').map((m) => m.op_id as string);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_762_240_000_000);
  server = new FakeServer();
  store = new MemoryQueueStore();
  clients = [];
});

afterEach(() => {
  for (const c of clients) c.disconnect();
  vi.useRealTimers();
});

describe('Verbindungsaufbau und Uhrabgleich', () => {
  it('sendet hello mit Positionen, gleicht die Uhr 5x ab und sendet die Warteschlange erst danach', async () => {
    const c = make();
    const got: SyncOp[] = [];
    c.subscribe(nbStream(1), { lastSeq: 0, lastOpId: null }, (op) => got.push(op));
    const cp = c.connect();
    const p = c.send(notebookCreate(1));
    await cp;
    await settle();
    const s = server.last;
    const hello = s.received[0]!;
    expect(hello).toMatchObject({
      type: 'hello',
      protocol: 1,
      client: 'web',
      streams: [{ stream: nbStream(1), last_seq: 0, last_op_id: null }],
    });
    expect(s.of('time.ping')).toHaveLength(5);
    const types = s.received.map((m) => m.type);
    expect(types.indexOf('time.offset')).toBeGreaterThan(-1);
    expect(types.indexOf('time.offset')).toBeLessThan(types.indexOf('op'));
    expect(c.connectionState).toBe('online');
    await expect(p).resolves.toMatchObject({ type: 'ack', seq: 1 });
    expect(c.pendingCount).toBe(0);
  });

  it('korrigiert unsichere Zeitstempel nach dem Abgleich (applyClockOffset)', async () => {
    server.skewMs = 5000;
    const c = make({ applyClockOffset: true });
    const cp = c.connect();
    const p = c.send({ ...notebookCreate(1), at: 1000 });
    await cp;
    await settle();
    const op = server.last.of('op')[0]!;
    expect(op.at).toBe(6000);
    expect(op.clock_uncertain).toBe(false);
    expect(server.last.of('time.offset')[0]).toMatchObject({ offset_ms: 5000 });
    await p;
  });

  it('Web-App nutzt Versatz 0, meldet aber den gemessenen Wert', async () => {
    server.skewMs = 5000;
    const c = make();
    const cp = c.connect();
    const p = c.send({ ...notebookCreate(1), at: 1000 });
    await cp;
    await settle();
    expect(server.last.of('op')[0]).toMatchObject({ at: 1000, clock_uncertain: false });
    expect(server.last.of('time.offset')[0]).toMatchObject({ offset_ms: 5000 });
    await p;
  });

  it('sendet alle 15 s ping und trennt nach 45 s Funkstille', async () => {
    const c = make();
    await c.connect();
    await settle();
    expect(server.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(server.last.of('ping')).toHaveLength(1);
    server.mute = true;
    await vi.advanceTimersByTimeAsync(45_000);
    expect(c.connectionState).toBe('backoff');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.sockets).toHaveLength(2);
  });

  it('sendet Präsenz und wiederholt sie nach dem Neuverbinden', async () => {
    const c = make();
    await c.connect();
    await settle();
    c.setPresence({ session_id: uid(1), notebook_id: null, page_id: null });
    server.last.serverClose(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(server.last.of('presence')).toHaveLength(1);
  });
});

describe('Resume-Tabelle (§11.1)', () => {
  const seed = () => {
    const ops = [1, 2, 3].map(() =>
      server.addForeign(nbStream(1), 'page.delete', { data: { page_id: uid(77) } }),
    );
    return ops;
  };

  it('Zeile 1: last_seq 0 liefert alles ab seq 1', async () => {
    seed();
    const c = make();
    const got: number[] = [];
    c.subscribe(nbStream(1), { lastSeq: 0, lastOpId: null }, (op) => got.push(op.seq!));
    await c.connect();
    await settle();
    expect(got).toEqual([1, 2, 3]);
  });

  it('Zeile 2: passendes Paar liefert ab n+1', async () => {
    const ops = seed();
    const c = make();
    const got: number[] = [];
    c.subscribe(nbStream(1), { lastSeq: 2, lastOpId: ops[1]!.op_id as string }, (op) => got.push(op.seq!));
    await c.connect();
    await settle();
    expect(got).toEqual([3]);
  });

  it('Zeile 3a: andere op_id -> reset, nichts geliefert, onReset-Ablauf mit neuem Abo', async () => {
    const ops = seed();
    const c = make();
    const got: number[] = [];
    const resets: unknown[] = [];
    c.onEvent('reset', (r) => resets.push(r));
    const onReset = vi.fn(async () => ({ lastSeq: 3, lastOpId: ops[2]!.op_id as string }));
    c.subscribe(nbStream(1), { lastSeq: 2, lastOpId: uid(999) }, (op) => got.push(op.seq!), { onReset });
    await c.connect();
    await settle();
    expect(resets).toEqual([{ stream: nbStream(1), reason: 'unknown_position', headSeq: 3 }]);
    expect(onReset).toHaveBeenCalledOnce();
    expect(got).toEqual([]);
    expect(server.last.of('subscribe')[0]).toMatchObject({
      streams: [{ stream: nbStream(1), last_seq: 3, last_op_id: ops[2]!.op_id }],
    });
    // danach laufen neue Operationen normal
    const fresh = server.addForeign(nbStream(1), 'page.delete', { data: { page_id: uid(78) } });
    server.last.push(fresh);
    await settle();
    expect(got).toEqual([4]);
  });

  it('Zeile 3b: seq über head_seq -> reset', async () => {
    seed();
    const c = make();
    const onReset = vi.fn(async () => ({ lastSeq: 0, lastOpId: null }));
    c.subscribe(nbStream(1), { lastSeq: 9, lastOpId: uid(1) }, () => undefined, { onReset });
    await c.connect();
    await settle();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('reset verwirft die Warteschlange nicht und sendet sie weiter', async () => {
    seed();
    const c = make();
    c.subscribe(nbStream(1), { lastSeq: 9, lastOpId: uid(1) }, () => undefined, {
      onReset: async () => ({ lastSeq: 3, lastOpId: server.streams.get(nbStream(1))![2]!.op_id }),
    });
    const cp = c.connect();
    const p = c.send(notebookCreate(2));
    await cp;
    await settle();
    await expect(p).resolves.toBeTruthy();
  });

  it('geänderte db_epoch behandelt alle Ströme als reset, auch solche ohne reset-Flag', async () => {
    const ops = seed();
    const c1 = make();
    c1.subscribe(nbStream(1), { lastSeq: 3, lastOpId: ops[2]!.op_id as string }, () => undefined);
    await c1.connect();
    await settle();
    c1.disconnect();
    server.dbEpoch = uid(9001);
    const c2 = make();
    const onReset = vi.fn(async () => ({ lastSeq: 3, lastOpId: ops[2]!.op_id as string }));
    c2.subscribe(nbStream(1), { lastSeq: 3, lastOpId: ops[2]!.op_id as string }, () => undefined, {
      onReset,
    });
    await c2.connect();
    await settle();
    expect(onReset).toHaveBeenCalledWith(expect.objectContaining({ reason: 'db_epoch_changed' }));
    expect(await store.getMeta('db_epoch')).toBe(uid(9001));
  });

  it('ohne onReset bleibt der Strom stumm und meldet reset.failed', async () => {
    seed();
    const c = make();
    const failed: string[] = [];
    c.onEvent('reset.failed', (f) => failed.push(f.stream));
    const got: number[] = [];
    c.subscribe(nbStream(1), { lastSeq: 9, lastOpId: uid(1) }, (op) => got.push(op.seq!));
    await c.connect();
    await settle();
    expect(failed).toEqual([nbStream(1)]);
    expect(got).toEqual([]);
  });
});

describe('Warteschlange', () => {
  it('behält nach Abbruch mitten in der Pipeline die Originalreihenfolge', async () => {
    const c = make();
    await c.connect();
    await settle();
    let n = 0;
    server.decide = () => (++n <= 2 ? { ack: true } : { ignore: true });
    const ids = [1, 2, 3, 4, 5].map((i) => uid(100 + i));
    const ps = ids.map((id, i) => c.send(notebookCreate(i + 1, id)));
    await settle();
    expect(sentOpIds(server.sockets[0]!)).toEqual(ids);
    expect(c.pendingCount).toBe(3);
    server.decide = () => ({ ack: true });
    server.sockets[0]!.serverClose(1006);
    const p6 = c.send(notebookCreate(6, uid(106)));
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(sentOpIds(server.sockets[1]!)).toEqual([ids[2], ids[3], ids[4], uid(106)]);
    await Promise.all([...ps, p6]);
    expect(c.pendingCount).toBe(0);
  });

  it('ignoriert doppelte Acks', async () => {
    const c = make();
    const got: number[] = [];
    c.subscribe(nbStream(1), { lastSeq: 0, lastOpId: null }, (op) => got.push(op.seq!));
    await c.connect();
    await settle();
    const id = uid(100);
    const p = c.send(notebookCreate(1, id));
    await settle();
    server.last.push({ type: 'ack', op_id: id, stream: nbStream(1), seq: 1 });
    server.last.push({ type: 'ack', op_id: id, stream: nbStream(1), seq: 1 });
    await settle();
    await expect(p).resolves.toMatchObject({ seq: 1 });
    expect(c.pendingCount).toBe(0);
    expect(got).toEqual([]); // eigene Operationen werden nicht zurückgegeben
  });

  it('sendet höchstens maxInFlight Operationen ohne Antwort', async () => {
    const c = make({ maxInFlight: 3 });
    await c.connect();
    await settle();
    server.decide = () => ({ ignore: true });
    for (let i = 1; i <= 5; i++) void c.send(notebookCreate(i)).catch(() => undefined);
    await settle();
    expect(server.last.of('op')).toHaveLength(3);
  });

  it('übersteht ein Neuladen: neuer Client mit derselben Store-Instanz sendet in Reihenfolge', async () => {
    server.decide = () => ({ ignore: true });
    const c1 = make();
    await c1.connect();
    await settle();
    const ids = [uid(101), uid(102), uid(103)];
    ids.forEach((id, i) => void c1.send(notebookCreate(i + 1, id)).catch(() => undefined));
    await settle();
    c1.disconnect();
    server.decide = () => ({ ack: true });
    const c2 = make();
    expect(await store.list()).toHaveLength(3);
    await c2.connect();
    await settle();
    expect(sentOpIds(server.last)).toEqual(ids);
    expect(c2.pendingCount).toBe(0);
    expect(await store.list()).toHaveLength(0);
  });

  it('weist Server-Operationen und seq/origin beim Senden ab', async () => {
    const c = make();
    await c.connect();
    await expect(
      c.send({
        stream: nbStream(1),
        kind: 'notebook.delete',
        data: { notebook_id: uid(1) },
      } as unknown as SendOpInput),
    ).rejects.toThrow(/Server/);
    await expect(c.send({ ...notebookCreate(1), seq: 4 } as unknown as SendOpInput)).rejects.toThrow(/seq/);
  });
});

describe('Fehler und Schließcodes', () => {
  it('4503: exponentielle Wartezeit 1, 2, 4 … höchstens 30 s, nach ack wieder von vorn', async () => {
    const c = make();
    await c.connect();
    await settle();
    server.decide = () => ({
      error: { code: 'too_many_pending', retryable: true, fatal: true },
      close: 4503,
    });
    void c.send(notebookCreate(1)).catch(() => undefined);
    await settle();
    expect(server.sockets).toHaveLength(1);
    for (const [i, wait] of [1000, 2000, 4000, 8000, 16000, 30000, 30000].entries()) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(server.sockets).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(server.sockets).toHaveLength(i + 2);
    }
    server.decide = () => ({ ack: true });
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(c.pendingCount).toBe(0);
    const before = server.sockets.length;
    server.decide = () => ({
      error: { code: 'too_many_pending', retryable: true, fatal: true },
      close: 4503,
    });
    void c.send(notebookCreate(2)).catch(() => undefined);
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(server.sockets).toHaveLength(before + 1);
  });

  it('Jitter wird zur Wartezeit addiert', async () => {
    const c = make({ random: () => 0.5 });
    await c.connect();
    await settle();
    const states: (number | null)[] = [];
    c.onEvent('connection', (s) => s.state === 'backoff' && states.push(s.retryInMs));
    server.last.serverClose(4503);
    await settle();
    expect(states).toEqual([875]); // Zufallsanteil verkürzt, verlängert nie
  });

  it('Poison-Op: nach 5x internal_error samt Abhängigen in die Fehlerablage, Rest läuft weiter', async () => {
    const c = make();
    await c.connect();
    await settle();
    const bad = uid(201);
    server.decide = (op) =>
      op.op_id === bad
        ? { error: { code: 'internal_error', retryable: true, fatal: true }, close: 4503 }
        : op.kind === 'page.create'
          ? { error: { code: 'notebook_not_found', retryable: false, fatal: false } }
          : { ack: true };
    const a = c.send(notebookCreate(1, bad));
    const b = c.send(pageCreate(50, 1));
    const other = c.send(notebookCreate(2, uid(202)));
    const rejected = Promise.all([a.catch((e: unknown) => e), b.catch((e: unknown) => e)]);
    await settle();
    for (const wait of [1000, 2000, 4000, 8000, 16000]) {
      await vi.advanceTimersByTimeAsync(wait);
      await settle();
    }
    const [ea, eb] = await rejected;
    expect(ea).toBeInstanceOf(SyncRejectedError);
    expect((ea as SyncRejectedError).kind).toBe('poison');
    expect((eb as SyncRejectedError).kind).toBe('dependent');
    await expect(other).resolves.toBeTruthy();
    const shelf = await c.listShelf();
    expect(shelf.map((s) => s.op.op_id)).toHaveLength(2);
    expect(shelf.map((s) => s.reason.kind)).toEqual(['poison', 'dependent']);
    expect(c.shelved).toBe(2);
    expect(c.pendingCount).toBe(0);
  });

  it('nicht wiederholbarer Fehler: Operation und abhängige in die Fehlerablage, unabhängige laufen weiter', async () => {
    const c = make();
    await c.connect();
    await settle();
    const bad = uid(301);
    server.decide = (op) =>
      op.op_id === bad || op.kind === 'page.create' ? { ignore: true } : { ack: true };
    const shelfEvents: number[] = [];
    c.onEvent('shelf', (e) => shelfEvents.push(e.count));
    const a = c.send(notebookCreate(1, bad)).catch((e: unknown) => e);
    const b = c.send(pageCreate(50, 1)).catch((e: unknown) => e);
    const free = c.send(notebookCreate(2));
    await settle();
    server.last.push({
      type: 'error',
      code: 'module_not_found',
      message: 'x',
      op_id: bad,
      stream: nbStream(1),
      retryable: false,
      fatal: false,
    });
    await settle();
    expect(await a).toBeInstanceOf(SyncRejectedError);
    // b ist schon gesendet: seine eigene Antwort entscheidet (hier Fehler -> abgelegt)
    expect(c.pendingCount).toBe(1);
    server.last.push({
      type: 'error',
      code: 'notebook_not_found',
      message: 'x',
      op_id: c.pendingOps()[0]!.op_id,
      stream: nbStream(1),
      retryable: false,
      fatal: false,
    });
    await settle();
    expect(await b).toBeInstanceOf(SyncRejectedError);
    await expect(free).resolves.toBeTruthy();
    expect(shelfEvents).toEqual([1, 2]);
    expect(c.connectionState).toBe('online');
  });

  it('4409 session_superseded: schreibt alle unbestätigten Operationen um und verbindet sofort neu', async () => {
    const c = make();
    await c.connect();
    await settle();
    const oldS = 30;
    const newS = 31;
    server.decide = (op, sock) =>
      op.kind === 'session.start' && sock === server.sockets[0]
        ? {
            error: {
              code: 'session_superseded',
              retryable: false,
              fatal: true,
              details: { session_id: uid(newS) },
            },
            close: 4409,
          }
        : { ack: true };
    const superseded: unknown[] = [];
    c.onEvent('session.superseded', (e) => superseded.push(e));
    const ps = [c.send(sessionStart(oldS)), c.send(pageCreate(60, 1, oldS)), c.send(sessionPause(oldS))];
    await settle();
    expect(superseded).toEqual([{ oldSessionId: uid(oldS), newSessionId: uid(newS) }]);
    expect(server.sockets).toHaveLength(2); // ohne Wartezeit
    const resent = server.sockets[1]!.of('op');
    expect(resent.map((m) => m.kind)).toEqual(['session.start', 'page.create', 'session.pause']);
    expect(resent[0]).toMatchObject({ stream: sessStream(newS), data: { session_id: uid(newS) } });
    expect(resent[1]).toMatchObject({ data: { session_id: uid(newS) } });
    expect(resent[2]).toMatchObject({ stream: sessStream(newS) });
    await Promise.all(ps);
    expect(JSON.stringify(await store.list())).not.toContain(uid(oldS));
  });

  it('4401: dauerhafter Fehler, kein Neuverbinden', async () => {
    const c = make();
    const fatal: string[] = [];
    c.onEvent('fatal', (f) => fatal.push(f.code));
    await c.connect();
    await settle();
    server.last.push({
      type: 'error',
      code: 'device_token_invalid',
      message: 'x',
      retryable: false,
      fatal: true,
    });
    server.last.serverClose(4401);
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(c.connectionState).toBe('failed');
    expect(server.sockets).toHaveLength(1);
    expect(fatal).toEqual(['device_token_invalid']);
  });

  it('page_version_conflict: Hook liefert Felder und aktuelle Version, Operation wird erneut gesendet', async () => {
    const hook = vi.fn(async () => ({
      fields: {
        index: 2,
        template: 'kariert' as const,
        session_id: null,
        background_slide_id: null,
        attached_slide_id: null,
      },
      version: 7,
    }));
    const c = make({ onPageVersionConflict: hook });
    await c.connect();
    await settle();
    server.decide = (op) => {
      const v = (op.data as { version: number }).version;
      return v === 7
        ? { ack: true }
        : { error: { code: 'page_version_conflict', retryable: false, fatal: false } };
    };
    const p = c.send({
      stream: nbStream(1),
      kind: 'page.update',
      data: {
        page_id: uid(50),
        version: 3,
        fields: {
          index: 1,
          template: 'blanko',
          session_id: null,
          background_slide_id: null,
          attached_slide_id: null,
        },
      },
    } as SendOpInput);
    await settle();
    await expect(p).resolves.toBeTruthy();
    expect(hook).toHaveBeenCalledOnce();
    const sent = server.last.of('op');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ data: { version: 7, fields: { index: 2, template: 'kariert' } } });
    expect(sent[1]!.op_id).toBe(sent[0]!.op_id);
  });

  it('page_version_conflict ohne Hook: Fehlerablage', async () => {
    const c = make();
    await c.connect();
    await settle();
    server.decide = () => ({ error: { code: 'page_version_conflict', retryable: false, fatal: false } });
    const p = c
      .send({
        stream: nbStream(1),
        kind: 'page.update',
        data: {
          page_id: uid(50),
          version: 1,
          fields: {
            index: 1,
            template: 'blanko',
            session_id: null,
            background_slide_id: null,
            attached_slide_id: null,
          },
        },
      } as SendOpInput)
      .catch((e: unknown) => e);
    await settle();
    expect(await p).toBeInstanceOf(SyncRejectedError);
    expect((await c.listShelf())[0]!.reason.kind).toBe('conflict_unresolved');
  });
});

describe('Eingehende Operationen', () => {
  it('überspringt unbekannte Operationen und Enum-Werte, zählt seq aber weiter', async () => {
    const known = (seq: number, extra = {}) => ({
      type: 'op',
      op_id: uid(400 + seq),
      stream: nbStream(1),
      kind: 'page.delete',
      at: 1,
      clock_uncertain: false,
      data: { page_id: uid(77) },
      seq,
      origin: 'ipad',
      ...extra,
    });
    server.afterWelcome = (s) => {
      s.push(known(1));
      s.push({ ...known(2), kind: 'future.thing', data: { x: 1 } });
      s.push({
        ...known(3),
        kind: 'page.create',
        data: {
          page_id: uid(1),
          notebook_id: uid(1),
          session_id: null,
          index: 1,
          template: 'hologramm',
          width_pt: 1,
          height_pt: 1,
          background_slide_id: null,
          attached_slide_id: null,
        },
      });
      s.push(known(4));
    };
    const c = make();
    const got: number[] = [];
    const skipped: number[] = [];
    c.onEvent('op.skipped', (e) => skipped.push(e.seq));
    c.subscribe(nbStream(1), { lastSeq: 0, lastOpId: null }, (op) => got.push(op.seq!));
    await c.connect();
    await settle();
    expect(got).toEqual([1, 4]);
    expect(skipped).toEqual([2, 3]);
    // seq steht auf 4: kein Neu-Abo wegen Lücke, hello meldet nach Neuverbinden last_seq 4
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.last.of('subscribe')).toHaveLength(0);
    server.afterWelcome = null;
    server.last.serverClose(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(server.last.received[0]).toMatchObject({
      streams: [{ stream: nbStream(1), last_seq: 4, last_op_id: uid(404) }],
    });
  });

  it('liefert in seq-Reihenfolge und abonniert bei bleibender Lücke neu', async () => {
    const c = make();
    const got: number[] = [];
    c.subscribe(nbStream(1), { lastSeq: 0, lastOpId: null }, (op) => got.push(op.seq!));
    await c.connect();
    await settle();
    const m1 = server.addForeign(nbStream(1), 'page.delete', { data: { page_id: uid(77) } });
    const m2 = server.addForeign(nbStream(1), 'page.delete', { data: { page_id: uid(77) } });
    server.last.push(m2);
    await settle();
    expect(got).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(server.last.of('subscribe')[0]).toMatchObject({ streams: [{ last_seq: 0, last_op_id: null }] });
    // der Fake-Server liefert beim Abo die fehlenden Operationen nach
    expect(got).toEqual([1, 2]);
    void m1;
  });

  it('gibt Server-Ereignisse an onEvent weiter', async () => {
    const c = make();
    const seen: unknown[] = [];
    c.onEvent('device.connection', (d) => seen.push(d));
    await c.connect();
    await settle();
    server.last.push({
      type: 'event',
      name: 'device.connection',
      data: { client: 'ipad', device_id: null, connected: true },
    });
    server.last.push({ type: 'event', name: 'noch.unbekannt', data: {} });
    await settle();
    expect(seen).toEqual([{ client: 'ipad', device_id: null, connected: true }]);
  });
});

describe('Abos zwischen hello und welcome', () => {
  const welcome = (resume: unknown[] = []) =>
    server.last.push({
      type: 'welcome',
      protocol: 1,
      server_time: Date.now(),
      server_version: 'fake',
      db_epoch: server.dbEpoch,
      device_id: null,
      resume,
    });

  it('ein spätes Abo wird nach welcome nachgemeldet, danach kommen Operationen an', async () => {
    const c = make();
    server.mute = true;
    void c.connect();
    await settle();
    expect(server.last.of('hello')).toHaveLength(1);
    const got: SyncOp[] = [];
    c.subscribe(nbStream(1), { lastSeq: 0, lastOpId: null }, (op) => got.push(op));
    server.mute = false;
    welcome();
    await settle();
    expect(server.last.of('subscribe')).toEqual([
      { type: 'subscribe', streams: [{ stream: nbStream(1), last_seq: 0, last_op_id: null }] },
    ]);
    server.last.push(server.addForeign(nbStream(1), 'page.delete', { data: { page_id: uid(77) } }));
    await settle();
    expect(got.map((o) => o.seq)).toEqual([1]);
  });

  it('ein Abo vor hello erzeugt kein zusätzliches subscribe', async () => {
    const c = make();
    c.subscribe(nbStream(1), { lastSeq: 0, lastOpId: null }, () => undefined);
    await c.connect();
    await settle();
    expect(server.last.of('subscribe')).toHaveLength(0);
  });

  it('geänderte db_epoch mit spätem Abo: genau ein subscribe, nach dem Reset', async () => {
    await store.setMeta('db_epoch', 'alte-epoche');
    const c = make();
    server.mute = true;
    void c.connect();
    await settle();
    const onReset = vi.fn(async () => ({ lastSeq: 0, lastOpId: null }));
    c.subscribe(nbStream(1), { lastSeq: 0, lastOpId: null }, () => undefined, { onReset });
    server.mute = false;
    welcome();
    await settle();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(server.last.of('subscribe')).toHaveLength(1);
  });

  it('devicePresence merkt die letzte presence und vergisst sie beim Trennen des Geräts', async () => {
    const c = make();
    await c.connect();
    await settle();
    expect(c.devicePresence('ipad')).toBeNull();
    const data = {
      client: 'ipad',
      device_id: uid(50),
      device_name: 'iPad',
      session_id: null,
      notebook_id: uid(1),
      page_id: uid(5),
    };
    server.last.push({ type: 'event', name: 'presence', data });
    await settle();
    expect(c.devicePresence('ipad')).toEqual(data);
    server.last.push({
      type: 'event',
      name: 'device.connection',
      data: { client: 'ipad', device_id: uid(50), connected: false },
    });
    await settle();
    expect(c.devicePresence('ipad')).toBeNull();
  });
});
