// Nacharbeit nach dem Review von PR #60 (B1, B2, S1 bis S5, Kleinigkeiten)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncOp } from '@sg/shared';
import { SyncClient, SyncRejectedError } from '../src/lib/sync/client.ts';
import { MemoryQueueStore } from '../src/lib/sync/store.ts';
import type { TabCoordinator, TabMessage } from '../src/lib/sync/tabs.ts';
import type { SendOpInput } from '../src/lib/sync/types.ts';
import { FakeServer, nbStream, sessStream, uid } from './sync-fake-server.ts';

const settle = async () => {
  for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(0);
};

const notebookCreate = (n: number, id?: string): SendOpInput =>
  ({
    ...(id ? { op_id: id } : {}),
    stream: nbStream(n),
    kind: 'notebook.create',
    data: { notebook_id: uid(n), module_id: uid(10), title: 'T', kind: 'frei', created_at: 1 },
  }) as SendOpInput;

const pageCreate = (page: number, nb: number): SendOpInput =>
  ({
    stream: nbStream(nb),
    kind: 'page.create',
    data: {
      page_id: uid(page),
      notebook_id: uid(nb),
      session_id: null,
      index: 1,
      template: 'blanko',
      width_pt: 595,
      height_pt: 842,
      background_slide_id: null,
      attached_slide_id: null,
    },
  }) as SendOpInput;

const fields = {
  index: 1,
  template: 'blanko',
  session_id: null,
  background_slide_id: null,
  attached_slide_id: null,
};
const pageUpdate = (version: number): SendOpInput =>
  ({ stream: nbStream(1), kind: 'page.update', data: { page_id: uid(50), version, fields } }) as SendOpInput;

const sessionStart = (s: number): SendOpInput =>
  ({
    stream: sessStream(s),
    kind: 'session.start',
    data: {
      session_id: uid(s),
      module_id: uid(10),
      calendar_event_id: null,
      slide_deck_id: null,
      started_from: 'ipad',
      started_at: 1000,
    },
  }) as SendOpInput;

const errorMsg = (code: string, opId: string, stream: string, extra = {}) => ({
  type: 'error',
  code,
  message: code,
  op_id: opId,
  stream,
  retryable: false,
  fatal: false,
  ...extra,
});

let server: FakeServer;
let store: MemoryQueueStore;
let clients: SyncClient[];

function make(opts: Partial<ConstructorParameters<typeof SyncClient>[0]> = {}): SyncClient {
  const c = new SyncClient({
    url: 'ws://test/sync',
    store,
    webSocketFactory: server.factory,
    random: () => 0,
    tabs: null,
    ...opts,
  });
  clients.push(c);
  return c;
}

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

describe('B1: erneutes Abo während eines laufenden Resets', () => {
  it('ruft den Handler des zweiten Abos auf und der Strom bleibt nicht stumm', async () => {
    const ops = [1, 2, 3].map(() =>
      server.addForeign(nbStream(1), 'page.delete', { data: { page_id: uid(77) } }),
    );
    const last = ops[2]!.op_id as string;
    const c = make();
    let release: (p: { lastSeq: number; lastOpId: string }) => void = () => undefined;
    let calls = 0;
    const onReset1 = vi.fn(() => {
      if (++calls > 1) return Promise.resolve({ lastSeq: 3, lastOpId: last });
      return new Promise<{ lastSeq: number; lastOpId: string }>((resolve) => {
        release = resolve;
      });
    });
    const onReset2 = vi.fn(async () => ({ lastSeq: 3, lastOpId: last }));
    const got1: number[] = [];
    const got2: number[] = [];
    c.subscribe(nbStream(1), { lastSeq: 9, lastOpId: uid(1) }, (o) => got1.push(o.seq!), {
      onReset: onReset1,
    });
    await c.connect();
    await settle();
    expect(onReset1).toHaveBeenCalledOnce();
    c.subscribe(nbStream(1), { lastSeq: 3, lastOpId: last }, (o) => got2.push(o.seq!), { onReset: onReset2 });
    release({ lastSeq: 3, lastOpId: last });
    await settle();
    expect(onReset2).toHaveBeenCalledOnce();
    // Strom läuft wieder: neue Operation geht an beide Empfänger
    const fresh = server.addForeign(nbStream(1), 'page.delete', { data: { page_id: uid(78) } });
    server.last.push(fresh);
    await settle();
    expect(got1).toEqual([4]);
    expect(got2).toEqual([4]);
  });

  it('mehrere Abos je Strom: eigene Abmeldung je Empfänger, unsubscribe erst beim letzten', async () => {
    const c = make();
    await c.connect();
    await settle();
    const a: number[] = [];
    const b: number[] = [];
    const offA = c.subscribe(nbStream(1), { lastSeq: 0, lastOpId: null }, (o) => a.push(o.seq!));
    const offB = c.subscribe(nbStream(1), { lastSeq: 0, lastOpId: null }, (o) => b.push(o.seq!));
    await settle();
    server.last.push(server.addForeign(nbStream(1), 'page.delete', { data: { page_id: uid(77) } }));
    await settle();
    expect([a, b]).toEqual([[1], [1]]);
    offA();
    server.last.push(server.addForeign(nbStream(1), 'page.delete', { data: { page_id: uid(77) } }));
    await settle();
    expect([a, b]).toEqual([[1], [1, 2]]);
    expect(server.last.of('unsubscribe')).toHaveLength(0);
    offB();
    expect(server.last.of('unsubscribe')).toHaveLength(1);
  });
});

describe('B2: Wartezeit höchstens 30 s', () => {
  it('überschreitet 30 s auch mit maximalem Zufallsanteil nie', async () => {
    const c = make({ random: () => 0.999 });
    const waits: number[] = [];
    c.onEvent('connection', (s) => s.state === 'backoff' && waits.push(s.retryInMs ?? -1));
    await c.connect();
    await settle();
    for (let i = 0; i < 9; i++) {
      server.last.serverClose(4503);
      await vi.advanceTimersByTimeAsync(31_000);
      await settle();
    }
    expect(waits.length).toBeGreaterThanOrEqual(9);
    expect(Math.max(...waits)).toBeLessThanOrEqual(30_000);
  });
});

describe('S1: bereits gesendete abhängige Operationen', () => {
  const setup = async () => {
    const c = make();
    await c.connect();
    await settle();
    return c;
  };

  it('bestätigte abhängige Operation bleibt bestätigt', async () => {
    const c = await setup();
    const bad = uid(311);
    server.decide = (op) => (op.op_id === bad ? { ignore: true } : { ack: true });
    const a = c.send(notebookCreate(1, bad)).catch((e: unknown) => e);
    const b = c.send(pageCreate(50, 1));
    await settle();
    server.last.push(errorMsg('module_not_found', bad, nbStream(1)));
    await settle();
    expect(await a).toBeInstanceOf(SyncRejectedError);
    await expect(b).resolves.toBeTruthy();
    expect(c.shelved).toBe(1);
  });

  it('abhängige Operation mit eigenem Fehler wird abgelegt', async () => {
    const c = await setup();
    const bad = uid(312);
    server.decide = (op) =>
      op.op_id === bad || op.kind === 'page.create' ? { ignore: true } : { ack: true };
    const a = c.send(notebookCreate(1, bad)).catch((e: unknown) => e);
    const b = c.send(pageCreate(50, 1)).catch((e: unknown) => e);
    await settle();
    server.last.push(errorMsg('module_not_found', bad, nbStream(1)));
    await settle();
    const bId = c.pendingOps()[0]!.op_id;
    server.last.push(errorMsg('notebook_not_found', bId, nbStream(1)));
    await settle();
    expect(await a).toBeInstanceOf(SyncRejectedError);
    expect(((await b) as SyncRejectedError).kind).toBe('dependent');
    expect(c.shelved).toBe(2);
  });

  it('unbeantwortete abhängige Operation wird beim Trennen abgelegt', async () => {
    const c = await setup();
    const bad = uid(313);
    server.decide = (op) =>
      op.op_id === bad || op.kind === 'page.create' ? { ignore: true } : { ack: true };
    const a = c.send(notebookCreate(1, bad)).catch((e: unknown) => e);
    const b = c.send(pageCreate(50, 1)).catch((e: unknown) => e);
    await settle();
    server.last.push(errorMsg('module_not_found', bad, nbStream(1)));
    await settle();
    server.last.serverClose(1006);
    await settle();
    expect(await a).toBeInstanceOf(SyncRejectedError);
    expect(((await b) as SyncRejectedError).kind).toBe('dependent');
    expect(c.pendingCount).toBe(0);
  });

  it('session.start mit session_transition_invalid: Nachfolger sind nicht abhängig', async () => {
    const c = await setup();
    const bad = uid(314);
    server.decide = (op) =>
      op.op_id === bad
        ? { error: { code: 'session_transition_invalid', retryable: false, fatal: false } }
        : { ack: true };
    const a = c.send({ ...sessionStart(30), op_id: bad }).catch((e: unknown) => e);
    const b = c.send({
      stream: sessStream(30),
      kind: 'session.pause',
      data: { session_id: uid(30) },
    } as SendOpInput);
    await settle();
    expect(await a).toBeInstanceOf(SyncRejectedError);
    await expect(b).resolves.toBeTruthy();
    expect(c.shelved).toBe(1);
  });
});

describe('S2: page_version_conflict je Seite nacheinander', () => {
  it('löst in Warteschlangenreihenfolge auf, auch wenn der Hook für die ältere Operation langsamer ist', async () => {
    const hook = vi.fn(async ({ op }: { op: { data: { version: number } } }) => {
      if (op.data.version === 1) await new Promise((r) => setTimeout(r, 100));
      return { fields: fields as never, version: 100 + op.data.version };
    });
    const c = make({ onPageVersionConflict: hook as never });
    await c.connect();
    await settle();
    server.decide = (op) =>
      (op.data as { version: number }).version >= 100
        ? { ack: true }
        : { error: { code: 'page_version_conflict', retryable: false, fatal: false } };
    const p1 = c.send(pageUpdate(1));
    const p2 = c.send(pageUpdate(2));
    await settle();
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    await Promise.all([p1, p2]);
    const versions = server.last.of('op').map((m) => (m.data as { version: number }).version);
    expect(versions.filter((v) => v >= 100)).toEqual([101, 102]);
  });
});

describe('S3: gesendete Operationen werden nicht nachträglich uhrkorrigiert', () => {
  it('sendet nach dem Neuverbinden dieselbe Operation unverändert', async () => {
    server.skewMs = 5000;
    server.muteTime = true;
    server.decide = () => ({ ignore: true });
    const c = make({ applyClockOffset: true });
    void c.send({ ...sessionStart(30), at: 1000 }).catch(() => undefined);
    await c.connect();
    await vi.advanceTimersByTimeAsync(10_000); // Abgleich-Timeout, Warteschlange geht trotzdem raus
    await settle();
    const first = server.sockets[0]!.of('op')[0]!;
    expect(first).toMatchObject({ at: 1000, clock_uncertain: true });
    server.muteTime = false;
    server.last.serverClose(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    const again = server.last.of('op')[0]!;
    expect(again).toEqual(first);
  });
});

describe('Kleinigkeiten', () => {
  it('verlorenes time.pong: neuer Versuch nach Timeout, begrenzt', async () => {
    server.muteTime = true;
    const c = make();
    await c.connect();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(server.last.of('time.ping').length).toBeGreaterThanOrEqual(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.last.of('time.ping').length).toBeLessThanOrEqual(6);
    expect(c.connectionState).toBe('online');
  });

  it('kein welcome: nach dem Zeitlimit trennen und neu verbinden', async () => {
    server.mute = true;
    const c = make();
    await c.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(c.connectionState).toBe('backoff');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.sockets).toHaveLength(2);
  });

  it('4409 in Folge: ab dem zweiten Mal mit Wartezeit', async () => {
    const c = make();
    await c.connect();
    await settle();
    server.last.serverClose(4409);
    await settle();
    expect(server.sockets).toHaveLength(2);
    server.last.serverClose(4409);
    await settle();
    expect(server.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.sockets).toHaveLength(3);
  });

  it('whenOnline räumt seinen Listener bei Abbruch auf', async () => {
    const c = make();
    const ac = new AbortController();
    const p = c.whenOnline(ac.signal);
    ac.abort();
    await expect(p).rejects.toThrow();
    await c.connect();
    await settle();
    expect(c.connectionState).toBe('online');
  });

  it('disconnect macht späte Nachrichten wirkungslos', async () => {
    const c = make();
    const got: SyncOp[] = [];
    c.subscribe(nbStream(1), { lastSeq: 0, lastOpId: null }, (o) => got.push(o));
    await c.connect();
    await settle();
    const s = server.last;
    c.disconnect();
    s.push(server.addForeign(nbStream(1), 'page.delete', { data: { page_id: uid(77) } }));
    await settle();
    expect(got).toEqual([]);
    expect(c.connectionState).toBe('closed');
  });
});

// ---------------------------------------------------------------- S5: mehrere Tabs

class FakeBus {
  members = new Set<{ handlers: Set<(m: TabMessage) => void> }>();
  leader: object | null = null;
  waiting: { me: object; onLeader: () => void }[] = [];
}

function coordinator(bus: FakeBus): TabCoordinator {
  const me = { handlers: new Set<(m: TabMessage) => void>() };
  bus.members.add(me);
  return {
    acquire(onLeader) {
      if (!bus.leader) {
        bus.leader = me;
        onLeader();
      } else bus.waiting.push({ me, onLeader });
    },
    release() {
      bus.members.delete(me);
      bus.waiting = bus.waiting.filter((w) => w.me !== me);
      if (bus.leader === me) {
        bus.leader = null;
        const next = bus.waiting.shift();
        if (next) {
          bus.leader = next.me;
          next.onLeader();
        }
      }
    },
    post(msg) {
      for (const m of bus.members) {
        if (m !== me) queueMicrotask(() => m.handlers.forEach((f) => f(msg)));
      }
    },
    onMessage(fn) {
      me.handlers.add(fn);
      return () => me.handlers.delete(fn);
    },
  };
}

describe('S5: mehrere Tabs', () => {
  it('nur der Leader verbindet; Operationen des Folge-Tabs gehen über die gemeinsame Warteschlange raus', async () => {
    const bus = new FakeBus();
    const a = make({ tabs: coordinator(bus) });
    const b = make({ tabs: coordinator(bus) });
    await a.connect();
    await b.connect();
    await settle();
    expect(a.leader).toBe(true);
    expect(b.leader).toBe(false);
    expect(server.sockets).toHaveLength(1);
    const ack = await Promise.all([b.send(notebookCreate(1, uid(900))), settle()]).then(([r]) => r);
    expect(ack).toMatchObject({ op_id: uid(900), seq: 1 });
    expect(server.opLog).toEqual([uid(900)]);
    expect(b.pendingCount).toBe(0);
    expect(await store.list()).toHaveLength(0);
  });

  it('verteilt eingehende Operationen und Ereignisse an den Folge-Tab', async () => {
    const bus = new FakeBus();
    const a = make({ tabs: coordinator(bus) });
    const b = make({ tabs: coordinator(bus) });
    await a.connect();
    await b.connect();
    await settle();
    const got: number[] = [];
    const events: unknown[] = [];
    b.onEvent('device.connection', (d) => events.push(d));
    b.subscribe(nbStream(1), { lastSeq: 0, lastOpId: null }, (o) => got.push(o.seq!));
    await settle();
    expect(server.sockets[0]!.of('subscribe')).toHaveLength(1);
    server.last.push(server.addForeign(nbStream(1), 'page.delete', { data: { page_id: uid(77) } }));
    server.last.push({
      type: 'event',
      name: 'device.connection',
      data: { client: 'ipad', device_id: null, connected: true },
    });
    await settle();
    expect(got).toEqual([1]);
    expect(events).toHaveLength(1);
  });

  it('übernimmt als Leader, wenn der Leader-Tab schließt, und sendet die gemeinsame Warteschlange', async () => {
    const bus = new FakeBus();
    server.decide = () => ({ ignore: true });
    const a = make({ tabs: coordinator(bus) });
    const b = make({ tabs: coordinator(bus) });
    await a.connect();
    await b.connect();
    await settle();
    void b.send(notebookCreate(1, uid(901))).catch(() => undefined);
    await settle();
    expect(server.opLog).toEqual([uid(901)]);
    server.decide = () => ({ ack: true });
    a.disconnect();
    await settle();
    expect(b.leader).toBe(true);
    expect(server.sockets).toHaveLength(2);
    expect(server.opLog).toEqual([uid(901), uid(901)]);
    expect(b.pendingCount).toBe(0);
  });
});
