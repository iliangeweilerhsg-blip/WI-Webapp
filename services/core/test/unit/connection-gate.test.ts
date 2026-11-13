// Verbindungswächter (#84 M-1, #185): Vorrang für Geräte mit gültigem Token, Verdrängen statt Abweisen,
// kurze Fristen ohne Token. Logik ohne echte Sockets, mit gestellter Uhr
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkConnectionGate, type ConnectionGateLimits } from '../../src/plugins/security.ts';

class FakeSocket extends EventEmitter {
  destroyed = false;
  readonly remoteAddress: string;
  constructor(remoteAddress: string) {
    super();
    this.remoteAddress = remoteAddress;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Wie bei `net.Socket`: `close` kommt asynchron
    queueMicrotask(() => this.emit('close'));
  }
}

function setup(overrides: Partial<ConnectionGateLimits> = {}) {
  let time = Date.parse('2026-11-11T10:00:00Z');
  const warnings: Array<Record<string, unknown>> = [];
  const limits: ConnectionGateLimits = {
    maxPerSource: 3,
    maxNetwork: 4,
    firstRequestTimeoutMs: 15_000,
    tokenlessRequestTimeoutMs: 10_000,
    trustedAddressTtlMs: 15 * 60_000,
    maxTrustedAddresses: 64,
    ...overrides,
  };
  const gate = new NetworkConnectionGate(
    limits,
    { warn: (fields) => void warnings.push(fields as Record<string, unknown>) },
    { now: () => time },
  );
  const open = (address: string) => {
    const socket = new FakeSocket(address);
    gate.admit(socket);
    return socket;
  };
  return {
    gate,
    limits,
    warnings,
    open,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('NetworkConnectionGate', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Loopback zählt nie und wird nie geschlossen', () => {
    const { gate, open } = setup({ maxPerSource: 1, maxNetwork: 1 });
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.1'].map(open);
    expect(local.some((s) => s.destroyed)).toBe(false);
    expect(gate.openConnections).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(local.some((s) => s.destroyed)).toBe(false);
  });

  it('über maxPerSource wird die neue Verbindung abgewiesen (eigenes Budget der Quelle), ohne Verdrängen', () => {
    const { gate, open, warnings } = setup();
    const first = [open('10.0.0.5'), open('10.0.0.5'), open('10.0.0.5')];
    const extra = open('10.0.0.5');
    expect(extra.destroyed).toBe(true);
    expect(first.some((s) => s.destroyed)).toBe(false);
    expect(gate.openConnections).toBe(3);
    expect(warnings).toEqual([{ source: '10.0.0.5', dropped: 1, evicted: 0 }]);
  });

  it('ist maxNetwork voll, verdrängt die neue Verbindung die älteste aus der Quelle mit den meisten', async () => {
    const { gate, open } = setup();
    const a1 = open('10.0.0.1');
    const b1 = open('10.0.0.2');
    const b2 = open('10.0.0.2');
    const b3 = open('10.0.0.2');
    expect(gate.openConnections).toBe(4);
    const ipad = open('10.0.0.9');
    expect(ipad.destroyed).toBe(false);
    // Die älteste der größten Quelle, nicht die insgesamt älteste (a1)
    expect([a1, b1, b2, b3].map((s) => s.destroyed)).toEqual([false, true, false, false]);
    expect(gate.openConnections).toBe(4);
    await flush();
    // Das spätere `close` des Verdrängten zählt nicht doppelt
    expect(gate.openConnections).toBe(4);
  });

  it('bei Gleichstand trifft es die älteste Verbindung, nicht die gerade angenommene', () => {
    const { open } = setup({ maxPerSource: 1, maxNetwork: 3 });
    const [x, y, z] = [open('10.0.0.1'), open('10.0.0.2'), open('10.0.0.3')];
    const ipad = open('10.0.0.9');
    expect([x, y, z, ipad].map((s) => s.destroyed)).toEqual([true, false, false, false]);
    const next = open('10.0.0.4');
    expect([y, z, ipad, next].map((s) => s.destroyed)).toEqual([true, false, false, false]);
  });

  it('eine authentifizierte Verbindung zählt nicht mehr gegen maxNetwork und wird nie verdrängt', () => {
    const { gate, open } = setup({ maxPerSource: 10, maxNetwork: 2 });
    const ipad = open('10.0.0.9');
    gate.authenticate(ipad);
    expect(gate.openConnections).toBe(0);
    const attacker = Array.from({ length: 10 }, () => open('10.0.0.66'));
    expect(ipad.destroyed).toBe(false);
    // Der Angreifer verdrängt nur sich selbst
    expect(attacker.filter((s) => !s.destroyed)).toHaveLength(2);
    expect(gate.openConnections).toBe(2);
  });

  it('Adresse mit gültigem Token: neue Verbindungen kommen ohne Verdrängen an der vollen Grenze vorbei', () => {
    const { gate, open } = setup({ maxPerSource: 2, maxNetwork: 4 });
    const first = open('10.0.0.9');
    gate.authenticate(first);
    const attacker = [open('10.0.0.1'), open('10.0.0.1'), open('10.0.0.2'), open('10.0.0.2')];
    expect(gate.openConnections).toBe(4);
    const second = open('10.0.0.9');
    expect(second.destroyed).toBe(false);
    expect(attacker.some((s) => s.destroyed)).toBe(false);
    // Je Adresse mit Vorrang höchstens maxPerSource, danach normaler Weg (verdrängt dann einen Angreifer)
    const third = open('10.0.0.9');
    expect(third.destroyed).toBe(false);
    expect(attacker.filter((s) => s.destroyed)).toHaveLength(1);
  });

  it('der Vorrang gilt für die genaue Adresse: Nachbarn im selben IPv6-/64 bekommen ihn nicht', () => {
    const { gate, open } = setup({ maxPerSource: 2, maxNetwork: 2 });
    gate.authenticate(new FakeSocket('2001:db8:1:2::9'));
    const neighbours = [open('2001:db8:1:2::66'), open('2001:db8:1:2::66')];
    const blocked = open('2001:db8:1:2::67');
    // Gleiche /64-Quelle über maxPerSource: abgewiesen, kein Vorrang für den Nachbarn
    expect(blocked.destroyed).toBe(true);
    expect(neighbours.some((s) => s.destroyed)).toBe(false);
    // Das Gerät selbst kommt trotz voller Quelle durch
    expect(open('2001:db8:1:2::9').destroyed).toBe(false);
    // IPv4-mapped zählt als dieselbe IPv4-Adresse
    gate.authenticate(new FakeSocket('::ffff:10.0.0.9'));
    expect(open('10.0.0.9').destroyed).toBe(false);
    expect(gate.openConnections).toBe(2);
  });

  it('der Vorrang einer Adresse läuft nach trustedAddressTtlMs ab, jede Anfrage mit Token verlängert ihn', () => {
    const { gate, open, advance } = setup({ maxPerSource: 10, maxNetwork: 10, trustedAddressTtlMs: 1000 });
    gate.authenticate(new FakeSocket('10.0.0.9'));
    advance(900);
    // Mit Vorrang: zählt nicht gegen maxNetwork
    open('10.0.0.9');
    expect(gate.openConnections).toBe(0);
    gate.authenticate(new FakeSocket('10.0.0.9'));
    advance(900);
    open('10.0.0.9');
    expect(gate.openConnections).toBe(0);
    advance(200);
    // Abgelaufen: wieder der normale Weg
    open('10.0.0.9');
    expect(gate.openConnections).toBe(1);
  });

  it('höchstens maxTrustedAddresses Adressen, die am längsten nicht bestätigte fällt heraus', () => {
    const { gate, open } = setup({ maxPerSource: 5, maxNetwork: 1, maxTrustedAddresses: 2 });
    gate.authenticate(new FakeSocket('10.0.0.1'));
    gate.authenticate(new FakeSocket('10.0.0.2'));
    gate.authenticate(new FakeSocket('10.0.0.1'));
    gate.authenticate(new FakeSocket('10.0.0.3'));
    // 10.0.0.2 ist herausgefallen und geht über den normalen Weg
    open('10.0.0.2');
    expect(gate.openConnections).toBe(1);
    open('10.0.0.1');
    open('10.0.0.3');
    expect(gate.openConnections).toBe(1);
  });

  it('ohne Header binnen firstRequestTimeoutMs wird geschlossen, eine Anfrage oder ein Token stoppt die Frist', () => {
    const { gate, open } = setup({ firstRequestTimeoutMs: 500 });
    const idle = open('10.0.0.1');
    const talking = open('10.0.0.2');
    const paired = open('10.0.0.3');
    gate.requestStarted(talking);
    gate.authenticate(paired);
    vi.advanceTimersByTime(499);
    expect(idle.destroyed).toBe(false);
    vi.advanceTimersByTime(1);
    expect([idle.destroyed, talking.destroyed, paired.destroyed]).toEqual([true, false, false]);
  });

  it('auch Verbindungen mit Adress-Vorrang müssen ihre ersten Header schnell senden', () => {
    const { gate, open } = setup({ firstRequestTimeoutMs: 500 });
    gate.authenticate(new FakeSocket('10.0.0.9'));
    const spoofed = open('10.0.0.9');
    vi.advanceTimersByTime(500);
    expect(spoofed.destroyed).toBe(true);
  });

  it('eine Anfrage ohne Token (Kopplung) muss binnen tokenlessRequestTimeoutMs fertig sein', () => {
    const { gate, open } = setup({ tokenlessRequestTimeoutMs: 1000 });
    const slow = open('10.0.0.1');
    const quick = open('10.0.0.2');
    gate.requestStarted(slow);
    gate.requestStarted(quick);
    const slowResponse = new EventEmitter();
    const quickResponse = new EventEmitter();
    gate.limitTokenlessRequest(slow, slowResponse);
    gate.limitTokenlessRequest(quick, quickResponse);
    quickResponse.emit('close');
    vi.advanceTimersByTime(1000);
    expect([slow.destroyed, quick.destroyed]).toEqual([true, false]);
  });

  it('nach einer Antwort ohne Token gilt die Header-Frist wieder (kein Halten mit tröpfelnden Folge-Headern)', () => {
    const { gate, open } = setup({ firstRequestTimeoutMs: 500, tokenlessRequestTimeoutMs: 1000 });
    const holder = open('10.0.0.1');
    const next = open('10.0.0.2');
    const paired = open('10.0.0.3');
    for (const socket of [holder, next, paired]) gate.requestStarted(socket);
    const responses = [new EventEmitter(), new EventEmitter(), new EventEmitter()];
    gate.limitTokenlessRequest(holder, responses[0]!);
    gate.limitTokenlessRequest(next, responses[1]!);
    gate.limitTokenlessRequest(paired, responses[2]!);
    for (const response of responses) response.emit('close');
    // `next` schickt rechtzeitig die Header der Folgeanfrage, `paired` zeigt danach ein gültiges Token
    vi.advanceTimersByTime(400);
    gate.requestStarted(next);
    gate.authenticate(paired);
    vi.advanceTimersByTime(100);
    expect([holder.destroyed, next.destroyed, paired.destroyed]).toEqual([true, false, false]);
  });

  it('geschlossene Verbindungen geben ihren Platz frei', async () => {
    const { gate, open } = setup({ maxPerSource: 2, maxNetwork: 2 });
    const a = open('10.0.0.1');
    const b = open('10.0.0.1');
    a.destroy();
    await flush();
    expect(gate.openConnections).toBe(1);
    const c = open('10.0.0.1');
    expect([b.destroyed, c.destroyed]).toEqual([false, false]);
    gate.authenticate(b);
    expect(gate.openConnections).toBe(1);
    b.destroy();
    await flush();
    // b zählte schon nicht mehr gegen maxNetwork
    expect(gate.openConnections).toBe(1);
  });
});
