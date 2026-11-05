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
    expect(config.moodleUrl).toBe('');
  });

  it('liest SG_MOODLE_URL und lehnt unsichere Adressen ab', () => {
    expect(loadConfig({ SG_MOODLE_URL: 'https://moodle.example.org/' }).moodleUrl).toBe(
      'https://moodle.example.org',
    );
    expect(loadConfig({ SG_MOODLE_URL: 'https://lms.example.org/moodle' }).moodleUrl).toBe(
      'https://lms.example.org/moodle',
    );
    expect(() => loadConfig({ SG_MOODLE_URL: 'http://moodle.example.org' })).toThrow(/https/);
    expect(() => loadConfig({ SG_MOODLE_URL: 'https://u:p@moodle.example.org' })).toThrow(/https/);
    expect(() => loadConfig({ SG_MOODLE_URL: 'https://nutzer:geheim@moodle.example.org' })).not.toThrow(
      /geheim/,
    );
    expect(() => loadConfig({ SG_MOODLE_URL: 'https://moodle.example.org/?x=1' })).toThrow(/https/);
    expect(() => loadConfig({ SG_MOODLE_URL: 'nicht-url' })).toThrow(/g\u00fcltige/);
  });

  it('lehnt Backslash, Leer- und Steuerzeichen in SG_MOODLE_URL ab (wie die CLI)', () => {
    // Der URL-Parser deutet diese Zeichen still um: der Host wäre evil.test
    for (const raw of [
      'https://evil.test\\@moodle.example.org',
      'https://moodle.example.org/a b',
      'https://moodle.example.org/\tx',
      'https://moodle.exam\nple.org',
      'https://moodle.example.org/\u0000',
      'https://moodle.example.org/\u0085',
      'kein url',
    ]) {
      expect(() => loadConfig({ SG_MOODLE_URL: raw }), JSON.stringify(raw)).toThrow(/Backslash/);
    }
    // Umgebender Leerraum ist erlaubt (wird abgeschnitten)
    expect(loadConfig({ SG_MOODLE_URL: '  https://moodle.example.org/  ' }).moodleUrl).toBe(
      'https://moodle.example.org',
    );
  });

  it('speichert SG_MOODLE_URL in normalisierter Form (origin + pathname)', () => {
    expect(loadConfig({ SG_MOODLE_URL: 'HTTPS://Moodle.Example.org:443/lms//' }).moodleUrl).toBe(
      'https://moodle.example.org/lms',
    );
    expect(loadConfig({ SG_MOODLE_URL: 'https://moodle.example.org:8443' }).moodleUrl).toBe(
      'https://moodle.example.org:8443',
    );
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

  it('Bonjour ist standardmäßig an und lässt sich mit SG_BONJOUR=0 abschalten (VERTRAEGE §12)', () => {
    expect(loadConfig({}).bonjour).toBe(true);
    expect(loadConfig({ SG_BONJOUR: '1' }).bonjour).toBe(true);
    for (const off of ['0', 'false', 'OFF', ' nein '])
      expect(loadConfig({ SG_BONJOUR: off }).bonjour).toBe(false);
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
