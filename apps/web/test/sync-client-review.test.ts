// Nacharbeit nach dem Review von PR #60 (B1, B2, S1 bis S5, Kleinigkeiten)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncOp } from '@sg/shared';
import {
  SyncClient,
  SyncHandedOverError,
  SyncNotConnectedError,
  SyncNotLeaderError,
  SyncRejectedError,
} from '../src/lib/sync/client.ts';
import { MemoryQueueStore } from '../src/lib/sync/store.ts';
import type { LeaderLock, LeaderLockHandlers } from '../src/lib/sync/tabs.ts';
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

  it('N7: unbeantwortete abhängige Operation wird nach dem Trennen erneut gesendet, nicht abgelegt', async () => {
    const c = await setup();
    const bad = uid(313);
    server.decide = (op) =>
      op.op_id === bad || op.kind === 'page.create' ? { ignore: true } : { ack: true };
    const a = c.send(notebookCreate(1, bad)).catch((e: unknown) => e);
    const b = c.send(pageCreate(50, 1));
    await settle();
    server.last.push(errorMsg('module_not_found', bad, nbStream(1)));
    await settle();
    server.decide = () => ({ ack: true });
    server.last.serverClose(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(await a).toBeInstanceOf(SyncRejectedError);
    await expect(b).resolves.toBeTruthy(); // der Server entscheidet über die erneute Sendung
    expect(c.shelved).toBe(1);
  });

  it('N7: Server committet, unterdrückt das ack und schließt mit 1006 -> erneut senden, dann ack', async () => {
    const c = await setup();
    server.decide = () => ({ ack: true, withhold: true });
    const p = c.send(notebookCreate(1, uid(950)));
    await settle();
    server.decide = () => ({ ack: true });
    server.last.serverClose(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    await expect(p).resolves.toMatchObject({ op_id: uid(950), seq: 1 });
    expect(server.head(nbStream(1))).toBe(1);
    expect(c.shelved).toBe(0);
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
    const cp = c.connect();
    void c.send({ ...sessionStart(30), at: 1000 }).catch(() => undefined);
    await cp;
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

// ---------------------------------------------------------------- Mehrere Tabs: nur der Leader synchronisiert

class FakeLocks {
  holder: FakeLock | null = null;
  waiting: FakeLock[] = [];
  changed: FakeLock[] = [];

  create = (): LeaderLock => new FakeLock(this);
}

class FakeLock implements LeaderLock {
  handlers: LeaderLockHandlers | null = null;
  stopped = false;
  private readonly owner: FakeLocks;

  constructor(owner: FakeLocks) {
    this.owner = owner;
  }

  start(h: LeaderLockHandlers): void {
    this.handlers = h;
    this.owner.changed.push(this);
    this.enqueue();
  }

  enqueue(): void {
    if (!this.owner.holder) {
      this.owner.holder = this;
      this.handlers?.onLeader();
      for (const o of this.owner.changed) if (o !== this) o.handlers?.onChanged();
    } else {
      this.handlers?.onOtherTab();
      this.owner.waiting.push(this);
    }
  }

  steal(): void {
    const old = this.owner.holder;
    if (old === this || this.stopped) return;
    this.owner.waiting = this.owner.waiting.filter((w) => w !== this);
    this.owner.holder = this;
    old?.handlers?.onLost();
    old?.enqueue();
    this.handlers?.onLeader();
  }

  stop(): void {
    this.stopped = true;
    this.owner.changed = this.owner.changed.filter((o) => o !== this);
    this.owner.waiting = this.owner.waiting.filter((w) => w !== this);
    if (this.owner.holder === this) {
      this.owner.holder = null;
      const next = this.owner.waiting.shift();
      if (next) {
        this.owner.holder = next;
        next.handlers?.onLeader();
      }
    }
  }
}

describe('Mehrere Tabs: nur der Leader synchronisiert', () => {
  it('nur ein Tab verbindet; der zweite zeigt other_tab und send() wirft', async () => {
    const locks = new FakeLocks();
    const a = make({ leaderLock: locks.create });
    const b = make({ leaderLock: locks.create });
    await a.connect();
    await b.connect();
    await settle();
    expect(a.leader).toBe(true);
    expect(b.leader).toBe(false);
    expect(b.connectionState).toBe('other_tab');
    expect(server.sockets).toHaveLength(1);
    await expect(b.send(notebookCreate(1))).rejects.toBeInstanceOf(SyncNotLeaderError);
    expect(await store.list()).toHaveLength(0);
    await expect(a.send(notebookCreate(1))).resolves.toBeTruthy();
  });

  it('Hier übernehmen: Leader wechselt, der alte trennt sauber, die Warteschlange geht vom neuen Leader raus', async () => {
    const locks = new FakeLocks();
    server.decide = () => ({ ignore: true });
    const a = make({ leaderLock: locks.create });
    const b = make({ leaderLock: locks.create });
    await a.connect();
    await b.connect();
    await settle();
    const pa = a.send(notebookCreate(1, uid(960))).catch((e: unknown) => e);
    await settle();
    expect(server.opLog).toEqual([uid(960)]);
    server.decide = () => ({ ack: true });
    b.takeOver();
    await settle();
    expect(b.leader).toBe(true);
    expect(a.leader).toBe(false);
    expect(a.connectionState).toBe('other_tab');
    expect(server.sockets).toHaveLength(2);
    expect(server.sockets[0]!.closedByClient).toBe(1000);
    const handed = await pa;
    expect(handed).toBeInstanceOf(SyncHandedOverError);
    expect((handed as SyncHandedOverError).queued).toBe(true);
    expect(server.sockets[1]!.of('op').map((m) => m.op_id)).toEqual([uid(960)]);
    expect(b.pendingCount).toBe(0);
    expect(await store.list()).toHaveLength(0);
    await expect(a.send(notebookCreate(2))).rejects.toBeInstanceOf(SyncNotLeaderError);
  });

  it('keine Doppelsendungen im laufenden Betrieb', async () => {
    const locks = new FakeLocks();
    const a = make({ leaderLock: locks.create });
    await a.connect();
    await settle();
    await Promise.all([1, 2, 3, 4, 5].map((i) => a.send(notebookCreate(i, uid(970 + i)))));
    expect(server.opLog).toEqual([1, 2, 3, 4, 5].map((i) => uid(970 + i)));
  });

  it('übernimmt, wenn der Leader-Tab schließt', async () => {
    const locks = new FakeLocks();
    const a = make({ leaderLock: locks.create });
    const b = make({ leaderLock: locks.create });
    await a.connect();
    await b.connect();
    await settle();
    a.disconnect();
    await settle();
    expect(b.leader).toBe(true);
    expect(server.sockets).toHaveLength(2);
  });

  it('disconnect und connect im selben Tab funktionieren (auch direkt hintereinander, StrictMode)', async () => {
    const locks = new FakeLocks();
    const a = make({ leaderLock: locks.create });
    void a.connect();
    a.disconnect();
    await a.connect();
    await settle();
    expect(a.leader).toBe(true);
    expect(a.connectionState).toBe('online');
    expect(server.sockets).toHaveLength(1);
    a.disconnect();
    await a.connect();
    await settle();
    expect(a.connectionState).toBe('online');
    await expect(a.send(notebookCreate(1))).resolves.toBeTruthy();
  });

  it('meldet einen Leader-Wechsel an wartende Tabs als Ereignis', async () => {
    const locks = new FakeLocks();
    const a = make({ leaderLock: locks.create });
    const b = make({ leaderLock: locks.create });
    const seen: number[] = [];
    a.onEvent('leader.changed', () => seen.push(1));
    await a.connect(); // Leader
    await b.connect(); // wartet
    b.onEvent('leader.changed', () => seen.push(2));
    a.disconnect();
    await settle();
    expect(b.leader).toBe(true);
  });
});

describe('Rollenfindung und Schreibschutz', () => {
  it('B-a: send() direkt nach await connect() klappt im einzigen Tab, other_tab blitzt nie auf', async () => {
    const locks = new FakeLocks();
    const a = make({ leaderLock: locks.create });
    const states: string[] = [];
    a.onEvent('connection', (c) => states.push(c.state));
    await a.connect();
    await expect(a.send(notebookCreate(1))).resolves.toBeTruthy();
    expect(states[0]).toBe('acquiring');
    expect(states).not.toContain('other_tab');
  });

  it('B-a: send() ohne auf connect() zu warten wartet auf die Rollenfindung', async () => {
    const locks = new FakeLocks();
    const a = make({ leaderLock: locks.create });
    void a.connect();
    await expect(a.send(notebookCreate(1))).resolves.toBeTruthy();
  });

  it('B-b: send() ohne connect() oder nach disconnect() wirft SyncNotConnectedError, nichts in der IDB', async () => {
    const locks = new FakeLocks();
    const a = make({ leaderLock: locks.create });
    await expect(a.send(notebookCreate(1))).rejects.toBeInstanceOf(SyncNotConnectedError);
    await a.connect();
    a.disconnect();
    await expect(a.send(notebookCreate(2))).rejects.toBeInstanceOf(SyncNotConnectedError);
    expect(await store.list()).toHaveLength(0);
  });

  it('Folge-Tab: connect() löst auf, send() endet mit SyncNotLeaderError, nichts in der IDB', async () => {
    const locks = new FakeLocks();
    const a = make({ leaderLock: locks.create });
    const b = make({ leaderLock: locks.create });
    await a.connect();
    await b.connect();
    expect(b.connectionState).toBe('other_tab');
    await expect(b.send(notebookCreate(1))).rejects.toBeInstanceOf(SyncNotLeaderError);
    expect(await store.list()).toHaveLength(0);
  });

  it('der alte Leader schreibt nach dem Verlust der Rolle nichts mehr in den Speicher', async () => {
    const locks = new FakeLocks();
    const storeA = new MemoryQueueStore();
    const hook = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { fields: fields as never, version: 100 };
    });
    const a = make({ leaderLock: locks.create, store: storeA, onPageVersionConflict: hook as never });
    const b = make({ leaderLock: locks.create, store: new MemoryQueueStore() });
    await a.connect();
    await b.connect();
    await settle();
    server.decide = () => ({ error: { code: 'page_version_conflict', retryable: false, fatal: false } });
    void a.send(pageUpdate(1)).catch(() => undefined);
    await settle();
    expect(hook).toHaveBeenCalledOnce();
    b.takeOver();
    await settle();
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    const left = await storeA.list();
    expect(left).toHaveLength(1);
    expect((left[0]!.op.data as { version: number }).version).toBe(1);
  });
});
