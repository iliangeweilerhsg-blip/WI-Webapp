import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatChecks, doctorExitCode, type CheckResult } from '../src/doctor.ts';
import { resolveConfig } from '../src/config.ts';
import {
  inspectKeyFile,
  parseFirewallBlocked,
  parseFirewallEnabled,
  parseTunnelState,
  runTunnelChecks,
  TUNNEL_MANY_FAILED_HANDSHAKES,
  TUNNEL_STATE_MAX_AGE_MS,
  type FirewallInfo,
  type KeyFileInfo,
  type TunnelDoctorIo,
  type TunnelStateRead,
} from '../src/tunnel-doctor.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'sg-tdoc-test-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const cfg = resolveConfig({ SG_DATA_DIR: '/data' }, '/home/u', '/repo');

const GOOD_FILE: KeyFileInfo = {
  exists: true,
  isSymlink: false,
  isRegularFile: true,
  mode: 0o600,
  dirExists: true,
  dirIsSymlink: false,
  dirMode: 0o700,
  ownerOk: true,
  deviceIds: ['dev-1'],
};

function goodState(over: Record<string, unknown> = {}): unknown {
  return {
    pid: 1,
    version: '0.1.0',
    updated_at: '2026-11-12T12:00:00Z',
    core: 'ok',
    p2p: true,
    keys: 'ok',
    listeners: [
      {
        service_name: 'sg-0123456789abcdef',
        advertised_name: 'sg-0123456789abcdef',
        state: 'ready',
        connections: 0,
        handshakes_pending: 0,
        handshakes_failed: 0,
      },
    ],
    ...over,
  };
}

function io(over: Partial<TunnelDoctorIo> = {}): TunnelDoctorIo {
  const state: TunnelStateRead = { kind: 'ok', state: goodState(), ageMs: 2000 };
  const firewall: FirewallInfo = { enabled: false, blocked: null };
  return {
    platform: 'darwin',
    hasSwift: async () => true,
    binaryExists: () => true,
    fingerprint: () => 'abc',
    stamp: () => 'abc',
    helperRunning: () => true,
    coreRunning: () => true,
    readState: () => state,
    keyFile: () => GOOD_FILE,
    pairedDeviceIds: async () => ['dev-1'],
    firewall: async () => firewall,
    ...over,
  };
}

const byName = (results: CheckResult[], part: string): CheckResult => {
  const r = results.find((x) => x.name.includes(part));
  if (!r) throw new Error(`Prüfung "${part}" fehlt: ${results.map((x) => x.name).join(', ')}`);
  return r;
};

describe('runTunnelChecks', () => {
  it('meldet alles grün, wenn alles stimmt', async () => {
    const results = await runTunnelChecks(cfg, io());
    expect(results.filter((r) => r.status === 'fail')).toEqual([]);
    expect(byName(results, 'Swift').status).toBe('ok');
    expect(byName(results, 'Programm').status).toBe('ok');
    expect(byName(results, 'Prozess').status).toBe('ok');
    expect(byName(results, 'Zustand').status).toBe('ok');
    expect(byName(results, 'Core').status).toBe('ok');
    expect(byName(results, 'Dienste').detail).toBe('1 von 1 bereit');
    expect(byName(results, 'Peer-to-peer').detail).toMatch(/an/);
    expect(byName(results, 'Schlüsseldatei').status).toBe('ok');
    expect(byName(results, 'Geräte ohne Schlüssel').status).toBe('ok');
    expect(byName(results, 'Firewall').status).toBe('ok');
  });

  it('SG_TUNNEL=0 und andere Systeme als macOS: nur ein Hinweis', async () => {
    const off = resolveConfig({ SG_DATA_DIR: '/data', SG_TUNNEL: '0' }, '/home/u', '/repo');
    const a = await runTunnelChecks(off, io());
    expect(a).toHaveLength(1);
    expect(a[0]?.status).toBe('info');
    const b = await runTunnelChecks(cfg, io({ platform: 'linux' }));
    expect(b).toHaveLength(1);
    expect(b[0]?.status).toBe('info');
  });

  it('Swift fehlt: Fehler mit Hinweis', async () => {
    const r = byName(await runTunnelChecks(cfg, io({ hasSwift: async () => false })), 'Swift');
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/xcode-select --install/);
  });

  it('Programm nicht gebaut oder veraltet: nur ein Hinweis, "sg start" baut es', async () => {
    const missing = byName(await runTunnelChecks(cfg, io({ binaryExists: () => false })), 'Programm');
    expect(missing.status).toBe('info');
    expect(missing.detail).toMatch(/noch nicht gebaut/);
    const old = byName(await runTunnelChecks(cfg, io({ stamp: () => 'alt' })), 'Programm');
    expect(old.status).toBe('info');
    expect(old.detail).toMatch(/veraltet/);
  });

  it('Prozess läuft nicht: Fehler, wenn der Core läuft, sonst nur Hinweis', async () => {
    const withCore = await runTunnelChecks(cfg, io({ helperRunning: () => false }));
    expect(byName(withCore, 'Prozess').status).toBe('fail');
    expect(byName(withCore, 'Prozess').hint).toMatch(/\[tunnel\]/);
    const withoutCore = await runTunnelChecks(
      cfg,
      io({ helperRunning: () => false, coreRunning: () => false }),
    );
    expect(byName(withoutCore, 'Prozess').status).toBe('info');
    // Ohne laufenden Prozess wird die Zustandsdatei nicht beurteilt
    expect(withoutCore.some((r) => r.name.includes('Zustand'))).toBe(false);
  });

  it('Zustandsdatei fehlt, ist kaputt oder zu alt: Fehler', async () => {
    const missing = byName(
      await runTunnelChecks(cfg, io({ readState: () => ({ kind: 'missing' }) })),
      'Zustand',
    );
    expect(missing.status).toBe('fail');
    const broken = byName(
      await runTunnelChecks(cfg, io({ readState: () => ({ kind: 'broken' }) })),
      'Zustand',
    );
    expect(broken.status).toBe('fail');
    const shape = byName(
      await runTunnelChecks(cfg, io({ readState: () => ({ kind: 'ok', state: { core: 1 }, ageMs: 1 }) })),
      'Zustand',
    );
    expect(shape.status).toBe('fail');
    const old = byName(
      await runTunnelChecks(
        cfg,
        io({ readState: () => ({ kind: 'ok', state: goodState(), ageMs: TUNNEL_STATE_MAX_AGE_MS + 1000 }) }),
      ),
      'Zustand',
    );
    expect(old.status).toBe('fail');
    expect(old.detail).toMatch(/16 s alt/);
    const edge = await runTunnelChecks(
      cfg,
      io({ readState: () => ({ kind: 'ok', state: goodState(), ageMs: TUNNEL_STATE_MAX_AGE_MS }) }),
    );
    expect(byName(edge, 'Zustand').status).toBe('ok');
  });

  it('Core nicht erreichbar: Fehler mit Hinweis', async () => {
    const results = await runTunnelChecks(
      cfg,
      io({ readState: () => ({ kind: 'ok', state: goodState({ core: 'nicht erreichbar' }), ageMs: 1 }) }),
    );
    expect(byName(results, 'Core').status).toBe('fail');
    expect(byName(results, 'Core').hint).toMatch(/SG_TUNNEL=0/);
  });

  it('kein Dienst bereit, obwohl Geräte gekoppelt sind: Fehler', async () => {
    const listeners = [
      { service_name: 'sg-aaaaaaaaaaaaaaaa', advertised_name: null, state: 'failed', handshakes_failed: 0 },
    ];
    const results = await runTunnelChecks(
      cfg,
      io({ readState: () => ({ kind: 'ok', state: goodState({ listeners }), ageMs: 1 }) }),
    );
    expect(byName(results, 'Dienste').status).toBe('fail');
    expect(byName(results, 'Dienste').detail).toMatch(/failed/);
  });

  it('keine Geräte oder keine Schlüsseldatei: Hinweis, kein Fehler', async () => {
    const none = await runTunnelChecks(
      cfg,
      io({ readState: () => ({ kind: 'ok', state: goodState({ listeners: [] }), ageMs: 1 }) }),
    );
    expect(byName(none, 'Dienste').status).toBe('info');
    const noFile = await runTunnelChecks(
      cfg,
      io({
        readState: () => ({ kind: 'ok', state: goodState({ keys: 'fehlt', listeners: [] }), ageMs: 1 }),
        keyFile: () => ({ ...GOOD_FILE, exists: false, deviceIds: null }),
        pairedDeviceIds: async () => [],
      }),
    );
    expect(noFile.filter((r) => r.status === 'fail')).toEqual([]);
    expect(byName(noFile, 'Schlüsseldatei').status).toBe('info');
  });

  it('der Helfer lehnt die Schlüsseldatei ab (unsicher, kaputt): Fehler mit dem Grund', async () => {
    const results = await runTunnelChecks(
      cfg,
      io({
        readState: () => ({
          kind: 'ok',
          state: goodState({
            keys: 'unsicher',
            listeners: [],
            last_error: 'Die Schlüsseldatei hat andere Rechte als 0600.',
          }),
          ageMs: 1,
        }),
      }),
    );
    const r = byName(results, 'Schlüssel');
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/andere Rechte als 0600/);
    expect(r.hint).toMatch(/chmod 600/);
  });

  it('Peer-to-peer aus wird angezeigt', async () => {
    const results = await runTunnelChecks(
      cfg,
      io({ readState: () => ({ kind: 'ok', state: goodState({ p2p: false }), ageMs: 1 }) }),
    );
    expect(byName(results, 'Peer-to-peer').detail).toMatch(/aus \(SG_TUNNEL_P2P=0\)/);
  });

  it('Namenskonflikt (advertised_name ≠ service_name): Fehler', async () => {
    const listeners = [
      {
        service_name: 'sg-0123456789abcdef',
        advertised_name: 'sg-0123456789abcdef (2)',
        state: 'ready',
        handshakes_failed: 0,
      },
    ];
    const results = await runTunnelChecks(
      cfg,
      io({ readState: () => ({ kind: 'ok', state: goodState({ listeners }), ageMs: 1 }) }),
    );
    const r = byName(results, 'Dienstname');
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/\(2\)/);
  });

  it('viele gescheiterte Handshakes: Hinweis mit Rat', async () => {
    const listeners = [
      {
        service_name: 'sg-0123456789abcdef',
        advertised_name: 'sg-0123456789abcdef',
        state: 'ready',
        handshakes_failed: TUNNEL_MANY_FAILED_HANDSHAKES,
      },
    ];
    const results = await runTunnelChecks(
      cfg,
      io({ readState: () => ({ kind: 'ok', state: goodState({ listeners }), ageMs: 1 }) }),
    );
    const r = byName(results, 'Handshakes');
    expect(r.status).toBe('info');
    expect(r.detail).toMatch(/neu koppeln/);
    const few = await runTunnelChecks(
      cfg,
      io({
        readState: () => ({
          kind: 'ok',
          state: goodState({
            listeners: [{ ...listeners[0], handshakes_failed: TUNNEL_MANY_FAILED_HANDSHAKES - 1 }],
          }),
          ageMs: 1,
        }),
      }),
    );
    expect(few.some((x) => x.name.includes('Handshakes'))).toBe(false);
  });

  it('gekoppelte Geräte ohne Tunnel-Schlüssel: Fehler "neu koppeln"', async () => {
    const results = await runTunnelChecks(cfg, io({ pairedDeviceIds: async () => ['dev-1', 'dev-alt'] }));
    const r = byName(results, 'Geräte ohne Schlüssel');
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/1 gekoppelte/);
    expect(r.hint).toMatch(/neu koppeln/);
    // Core antwortet nicht: nicht prüfbar, kein Fehler
    const offline = await runTunnelChecks(cfg, io({ pairedDeviceIds: async () => null }));
    expect(byName(offline, 'Geräte ohne Schlüssel').status).toBe('info');
    // Gerät gekoppelt, aber keine Schlüsseldatei
    const noFile = await runTunnelChecks(
      cfg,
      io({
        keyFile: () => ({ ...GOOD_FILE, exists: false, deviceIds: null }),
        pairedDeviceIds: async () => ['dev-1'],
      }),
    );
    expect(byName(noFile, 'Geräte ohne Schlüssel').status).toBe('fail');
  });

  it('Schlüsseldatei mit falschen Rechten, Symlink, fremdem Besitzer: Fehler', async () => {
    const cases: [Partial<KeyFileInfo>, RegExp][] = [
      [{ mode: 0o644 }, /0644/],
      [{ mode: 0o640 }, /0640/],
      [{ dirMode: 0o755 }, /0755/],
      [{ isSymlink: true, isRegularFile: false }, /Symlink/],
      [{ dirIsSymlink: true }, /Symlink/],
      [{ isRegularFile: false }, /keine reguläre Datei/],
      [{ ownerOk: false }, /anderen Benutzer/],
      [{ deviceIds: null }, /unlesbar/],
    ];
    for (const [over, pattern] of cases) {
      const r = byName(
        await runTunnelChecks(cfg, io({ keyFile: () => ({ ...GOOD_FILE, ...over }) })),
        'Schlüsseldatei',
      );
      expect(r.status, JSON.stringify(over)).toBe('fail');
      expect(r.detail).toMatch(pattern);
      expect(r.hint).toMatch(/chmod/);
    }
  });

  it('Firewall: aus, an und blockiert, an und frei, an und unklar, nicht feststellbar', async () => {
    const fw = async (f: FirewallInfo) =>
      byName(await runTunnelChecks(cfg, io({ firewall: async () => f })), 'Firewall');
    expect((await fw({ enabled: false, blocked: null })).status).toBe('ok');
    const blocked = await fw({ enabled: true, blocked: true });
    expect(blocked.status).toBe('fail');
    expect(blocked.hint).toMatch(/Firewall → Optionen/);
    expect((await fw({ enabled: true, blocked: false })).status).toBe('ok');
    const unclear = await fw({ enabled: true, blocked: null });
    expect(unclear.status).toBe('info');
    expect(unclear.detail).toMatch(/Erlauben/);
    expect((await fw({ enabled: null, blocked: null })).status).toBe('info');
  });

  it('die Ausgabe nennt keinen Schlüssel und passt in formatChecks/doctorExitCode', async () => {
    const results = await runTunnelChecks(cfg, io({ pairedDeviceIds: async () => ['dev-1', 'dev-2'] }));
    const text = formatChecks(results);
    expect(text).toContain('✗ Tunnel-Helfer · Geräte ohne Schlüssel');
    expect(text).toContain('→ Neu koppeln');
    expect(doctorExitCode(results)).toBe(1);
  });
});

describe('parseTunnelState', () => {
  it('nimmt die Form der Zustandsdatei an, alles andere nicht', () => {
    expect(parseTunnelState(goodState())).toMatchObject({ core: 'ok', p2p: true, keys: 'ok' });
    expect(parseTunnelState(null)).toBeNull();
    expect(parseTunnelState('x')).toBeNull();
    expect(parseTunnelState(goodState({ listeners: 'x' }))).toBeNull();
    expect(parseTunnelState(goodState({ listeners: [null] }))).toBeNull();
    expect(parseTunnelState(goodState({ core: 1 }))).toBeNull();
    expect(parseTunnelState(goodState({ last_error: 'Fehler' }))?.last_error).toBe('Fehler');
  });
});

describe('Firewall-Ausgaben', () => {
  it('erkennt an und aus', () => {
    expect(parseFirewallEnabled('Firewall is enabled. (State = 1)')).toBe(true);
    expect(parseFirewallEnabled('Firewall is disabled. (State = 0)')).toBe(false);
    expect(parseFirewallEnabled('Firewall is enabled. (State = 2)')).toBe(true);
    expect(parseFirewallEnabled('???')).toBeNull();
  });

  it('erkennt „blockiert“ nur eindeutig', () => {
    expect(parseFirewallBlocked('Application is blocked')).toBe(true);
    expect(parseFirewallBlocked('The application is not blocked')).toBe(false);
    expect(parseFirewallBlocked('')).toBeNull();
    expect(parseFirewallBlocked('irgendwas')).toBeNull();
  });
});

describe('inspectKeyFile', () => {
  const uid = process.getuid?.();

  function setup(): { dir: string; file: string; secrets: string } {
    const dir = tmp();
    const secrets = join(dir, 'secrets');
    mkdirSync(secrets, { mode: 0o700 });
    chmodSync(secrets, 0o700);
    return { dir, secrets, file: join(secrets, 'tunnel-keys.json') };
  }

  /** Eine Datei mit zufälligen Schlüsseln (zur Laufzeit, nie als Literal) */
  function keyFileText(ids: string[]): string {
    return JSON.stringify({
      v: 1,
      devices: ids.map((id) => ({ device_id: id, tunnel_key: randomBytes(32).toString('base64url') })),
    });
  }

  it('liest nur Rechte und Geräte-IDs', () => {
    const { file } = setup();
    writeFileSync(file, keyFileText(['dev-a', 'dev-b']), { mode: 0o600 });
    chmodSync(file, 0o600);
    const info = inspectKeyFile(file, uid);
    expect(info).toMatchObject({
      exists: true,
      isRegularFile: true,
      isSymlink: false,
      mode: 0o600,
      dirMode: 0o700,
      ownerOk: true,
      deviceIds: ['dev-a', 'dev-b'],
    });
    expect(JSON.stringify(info)).not.toMatch(/tunnel_key/);
  });

  it('fehlender Ordner und fehlende Datei', () => {
    const { dir, file } = setup();
    expect(inspectKeyFile(file, uid).exists).toBe(false);
    expect(inspectKeyFile(file, uid).dirExists).toBe(true);
    expect(inspectKeyFile(join(dir, 'nichts', 'tunnel-keys.json'), uid).dirExists).toBe(false);
  });

  it('falsche Rechte, Symlink (wird nicht gelesen), fremder Besitzer, kaputtes Format', () => {
    const { dir, file } = setup();
    writeFileSync(file, keyFileText(['dev-a']));
    chmodSync(file, 0o644);
    expect(inspectKeyFile(file, uid).mode).toBe(0o644);

    const real = join(dir, 'real.json');
    writeFileSync(real, keyFileText(['dev-x']));
    rmSync(file);
    symlinkSync(real, file);
    const link = inspectKeyFile(file, uid);
    expect(link.isSymlink).toBe(true);
    expect(link.deviceIds).toBeNull();

    rmSync(file);
    writeFileSync(file, keyFileText(['dev-a']), { mode: 0o600 });
    chmodSync(file, 0o600);
    expect(inspectKeyFile(file, uid === undefined ? undefined : uid + 1).ownerOk).toBe(uid === undefined);

    writeFileSync(file, '{kaputt');
    expect(inspectKeyFile(file, uid).deviceIds).toBeNull();
    writeFileSync(file, JSON.stringify({ v: 1, devices: [{ nope: 1 }] }));
    expect(inspectKeyFile(file, uid).deviceIds).toBeNull();
  });
});
