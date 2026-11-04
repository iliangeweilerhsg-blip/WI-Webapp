import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, loadDotEnv } from '../../src/config.ts';

describe('loadConfig', () => {
  it('nutzt die Standardwerte aus VERTRAEGE §1', () => {
    const config = loadConfig({});
    expect(config.port).toBe(4710);
    expect(config.host).toBe('0.0.0.0');
    expect(config.databaseUrl).toBe('postgres://sg:sg@127.0.0.1:5432/sg');
    expect(config.dataDir).toBe(join(homedir(), 'StudienGehirn'));
    expect(config.webDir.endsWith(join('apps', 'web', 'out'))).toBe(true);
    expect(config.devWebOrigin).toBe('');
    expect(config.logLevel).toBe('info');
  });

  it('liest Umgebungsvariablen und entfernt den Schrägstrich am Ende des Dev-Origins', () => {
    const config = loadConfig({
      SG_CORE_PORT: '5000',
      SG_CORE_HOST: '127.0.0.1',
      SG_DATA_DIR: '~/Daten',
      SG_DEV_WEB_ORIGIN: 'http://localhost:3000/',
      SG_LOG_LEVEL: 'debug',
      DATABASE_URL: 'postgres://x',
    });
    expect(config).toMatchObject({
      port: 5000,
      host: '127.0.0.1',
      dataDir: join(homedir(), 'Daten'),
      devWebOrigin: 'http://localhost:3000',
      logLevel: 'debug',
      databaseUrl: 'postgres://x',
    });
  });

  it('weist ungültige Ports und Log-Level ab', () => {
    expect(() => loadConfig({ SG_CORE_PORT: 'abc' })).toThrow(/SG_CORE_PORT/);
    expect(() => loadConfig({ SG_CORE_PORT: '70000' })).toThrow(/SG_CORE_PORT/);
    expect(() => loadConfig({ SG_LOG_LEVEL: 'laut' })).toThrow(/SG_LOG_LEVEL/);
  });
});

describe('loadDotEnv', () => {
  it('lädt fehlende Variablen aus config/.env, gesetzte bleiben unangetastet', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'sg-core-env-'));
    mkdirSync(join(dataDir, 'config'));
    writeFileSync(join(dataDir, 'config', '.env'), 'GEHEIM=aus-datei\nSCHON_DA=aus-datei\n');
    const env: NodeJS.ProcessEnv = { SG_DATA_DIR: dataDir, SCHON_DA: 'aus-umgebung' };
    expect(loadDotEnv(env)).toBe(join(dataDir, 'config', '.env'));
    expect(env.GEHEIM).toBe('aus-datei');
    expect(env.SCHON_DA).toBe('aus-umgebung');
  });

  it('tut nichts, wenn die Datei fehlt', () => {
    const env: NodeJS.ProcessEnv = { SG_DATA_DIR: mkdtempSync(join(tmpdir(), 'sg-core-env-')) };
    expect(loadDotEnv(env)).toBeNull();
  });
});
