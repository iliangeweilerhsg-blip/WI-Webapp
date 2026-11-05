import { describe, expect, it } from 'vitest';
import { RejectionLog, sourceKey } from '../../src/plugins/rejection-log.ts';

interface Line {
  obj: Record<string, unknown>;
  msg: string;
}

function setup(options: { maxSources?: number; maxLinesPerFlush?: number } = {}) {
  const lines: Line[] = [];
  let time = Date.parse('2026-11-05T10:00:00Z');
  const log = new RejectionLog({
    logger: { info: ((obj: Record<string, unknown>, msg: string) => void lines.push({ obj, msg })) as never },
    now: () => time,
    ...options,
  });
  return {
    log,
    lines,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('sourceKey', () => {
  it('IPv4 bleibt, IPv4-mapped wird IPv4, IPv6 wird auf /64 gekürzt', () => {
    expect(sourceKey('192.168.1.23')).toBe('192.168.1.23');
    expect(sourceKey('::ffff:192.168.1.23')).toBe('192.168.1.23');
    expect(sourceKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(sourceKey('2001:db8:1:2:1::1')).toBe('2001:db8:1:2::/64');
    expect(sourceKey('2001:0db8:0001:0002::7')).toBe('2001:db8:1:2::/64');
    expect(sourceKey('fe80::1%en0')).toBe('fe80:0:0:0::/64');
    expect(sourceKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(sourceKey(undefined)).toBe('unbekannt');
  });
});

describe('RejectionLog', () => {
  it('fasst eine Quelle in einer Minute zu einer Zeile zusammen', () => {
    const { log, lines, advance } = setup();
    for (let i = 0; i < 1000; i++) log.record('192.168.1.23', i % 2 ? 401 : 421);
    advance(30_000);
    log.record('192.168.1.23', 403);
    expect(lines).toHaveLength(0);
    advance(31_000);
    log.flush();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.obj).toMatchObject({
      source: '192.168.1.23',
      count: 1001,
      statuses: { '401': 500, '421': 500, '403': 1 },
      first: '2026-11-05T10:00:00.000Z',
      last: '2026-11-05T10:00:30.000Z',
    });
  });

  it('IPv6-Adressen desselben /64 zählen zusammen', () => {
    const { log, lines } = setup();
    for (let i = 0; i < 50; i++) log.record(`2001:db8:1:2::${i.toString(16)}`, 401);
    log.flush(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.obj).toMatchObject({ source: '2001:db8:1:2::/64', count: 50 });
  });

  it('abgelaufene Fenster vieler Quellen: höchstens maxLinesPerFlush Zeilen je Minute, nichts geht verloren', () => {
    const { log, lines, advance } = setup({ maxLinesPerFlush: 10 });
    const sources = Array.from({ length: 3000 }, (_, i) => `10.${i >> 8}.${i & 255}.1`);
    for (const source of sources) log.record(source, 401);
    advance(61_000);
    // Jede Quelle meldet sich nach Ablauf ihres Fensters erneut: record() darf nicht je Quelle eine Zeile schreiben
    for (const source of sources) log.record(source, 401);
    expect(lines.length).toBeLessThanOrEqual(10);
    log.flush(true);
    const total = lines.reduce((sum, line) => sum + (line.obj.count as number), 0);
    expect(total).toBe(6000);
    expect(lines.length).toBeLessThanOrEqual(10 + 1 + 10 + 1);
  });

  it('die Tabelle bleibt begrenzt, nichts geht verloren und die Zeilenzahl bleibt klein', () => {
    const { log, lines } = setup({ maxSources: 100, maxLinesPerFlush: 10 });
    for (let i = 0; i < 5000; i++) log.record(`10.${i >> 8}.${i & 255}.1`, 401);
    expect(log.size).toBeLessThanOrEqual(100);
    log.flush(true);
    const total = lines.reduce((sum, line) => sum + (line.obj.count as number), 0);
    expect(total).toBe(5000);
    expect(lines.length).toBeLessThanOrEqual(11);
  });
});
