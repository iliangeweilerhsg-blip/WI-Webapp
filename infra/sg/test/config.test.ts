import { describe, expect, it } from 'vitest';
import {
  appUrl,
  childEnv,
  expandHome,
  healthUrl,
  parsePort,
  parseSwitch,
  resolveConfig,
} from '../src/config.ts';

const REPO = '/repo';

describe('resolveConfig', () => {
  it('nutzt die Standardwerte aus docs/VERTRAEGE.md', () => {
    const cfg = resolveConfig({}, '/home/u', REPO);
    expect(cfg.dataDir).toBe('/home/u/StudienGehirn');
    expect(cfg.databaseUrl).toBe('postgres://sg:sg@127.0.0.1:5432/sg');
    expect(cfg.corePort).toBe(4710);
    expect(cfg.webDir).toBe('/repo/apps/web/out');
    expect(cfg.composeFile).toBe('/repo/infra/docker-compose.yml');
    expect(cfg.runDir).toBe('/home/u/StudienGehirn/run');
  });

  it('liest Umgebungsvariablen', () => {
    const cfg = resolveConfig(
      { SG_DATA_DIR: '~/Daten', SG_CORE_PORT: '5000', DATABASE_URL: 'postgres://x', SG_WEB_DIR: '/w' },
      '/home/u',
      REPO,
    );
    expect(cfg).toMatchObject({
      dataDir: '/home/u/Daten',
      corePort: 5000,
      databaseUrl: 'postgres://x',
      webDir: '/w',
    });
  });

  it('behandelt leere Variablen wie nicht gesetzt', () => {
    const cfg = resolveConfig({ SG_DATA_DIR: ' ', SG_CORE_PORT: '' }, '/home/u', REPO);
    expect(cfg.dataDir).toBe('/home/u/StudienGehirn');
    expect(cfg.corePort).toBe(4710);
  });
});

describe('Tunnel-Einstellungen (UX-12)', () => {
  it('Standard: Tunnel und Peer-to-peer an, Pfade im Datenordner und im Repo', () => {
    const cfg = resolveConfig({}, '/home/u', REPO);
    expect(cfg.tunnel).toBe(true);
    expect(cfg.tunnelP2p).toBe(true);
    expect(cfg.tunnelPackageDir).toBe('/repo/apps/mac-tunnel');
    expect(cfg.tunnelKeysFile).toBe('/home/u/StudienGehirn/secrets/tunnel-keys.json');
    expect(cfg.tunnelSocket).toBe('/home/u/StudienGehirn/run/tunnel.sock');
    expect(cfg.tunnelStateFile).toBe('/home/u/StudienGehirn/run/tunnel-state.json');
  });

  it('SG_TUNNEL und SG_TUNNEL_P2P schalten mit 0, false, off, nein aus (wie im Core)', () => {
    for (const off of ['0', 'false', 'off', 'nein', ' 0 ', 'OFF']) {
      expect(resolveConfig({ SG_TUNNEL: off }, '/h', REPO).tunnel, off).toBe(false);
      expect(resolveConfig({ SG_TUNNEL_P2P: off }, '/h', REPO).tunnelP2p, off).toBe(false);
    }
    for (const on of ['', '1', 'an', 'true']) {
      expect(parseSwitch(on), on).toBe(true);
    }
    expect(parseSwitch(undefined)).toBe(true);
    // Die beiden Schalter sind unabhängig
    const cfg = resolveConfig({ SG_TUNNEL_P2P: '0' }, '/h', REPO);
    expect(cfg.tunnel).toBe(true);
    expect(cfg.tunnelP2p).toBe(false);
  });

  it('der Datenordner bestimmt die Pfade', () => {
    const cfg = resolveConfig({ SG_DATA_DIR: '~/Daten' }, '/home/u', REPO);
    expect(cfg.tunnelKeysFile).toBe('/home/u/Daten/secrets/tunnel-keys.json');
    expect(cfg.tunnelSocket).toBe('/home/u/Daten/run/tunnel.sock');
  });
});

describe('parsePort', () => {
  it('lehnt ungültige Ports ab', () => {
    expect(() => parsePort('abc', 1)).toThrow(/Ungültiger Port/);
    expect(() => parsePort('70000', 1)).toThrow();
    expect(() => parsePort('0', 1)).toThrow();
  });
});

describe('expandHome', () => {
  it('ersetzt nur ein führendes ~', () => {
    expect(expandHome('~', '/h')).toBe('/h');
    expect(expandHome('~/a', '/h')).toBe('/h/a');
    expect(expandHome('/a/~/b', '/h')).toBe('/a/~/b');
  });
});

describe('childEnv / URLs', () => {
  it('setzt die Variablen für Core und Worker, behält Shell-Werte', () => {
    const cfg = resolveConfig({}, '/home/u', REPO);
    const env = childEnv(cfg, { PATH: '/bin', SG_LOG_LEVEL: 'debug', LEER: undefined });
    expect(env).toMatchObject({
      PATH: '/bin',
      SG_LOG_LEVEL: 'debug',
      SG_DATA_DIR: '/home/u/StudienGehirn',
      DATABASE_URL: 'postgres://sg:sg@127.0.0.1:5432/sg',
      SG_CORE_PORT: '4710',
      SG_WEB_DIR: '/repo/apps/web/out',
    });
    expect('LEER' in env).toBe(false);
  });

  it('baut die Health- und App-URL', () => {
    const cfg = resolveConfig({ SG_CORE_PORT: '4999' }, '/h', REPO);
    expect(healthUrl(cfg)).toBe('http://127.0.0.1:4999/api/v1/health');
    expect(appUrl(cfg)).toBe('http://localhost:4999');
  });
});
