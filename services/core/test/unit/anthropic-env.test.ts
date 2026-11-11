// T2-22a: Schlüssel-Schutz im Core (VERTRAEGE §20.5). Der Core liest den KI-Schlüssel nie: `loadDotEnv` überspringt
// `ANTHROPIC_*`, und beim Start verschwinden solche Variablen aus der Umgebung, damit Kindprozesse sie nicht erben.
// Alle Werte hier sind erfundene Platzhalter, keine echten Schlüssel.
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isAnthropicEnvKey, loadDotEnv, scrubAnthropicEnv } from '../../src/config.ts';

const FILE_VALUE = 'platzhalter-aus-datei';
const ENV_VALUE = 'platzhalter-aus-umgebung';

function dataDirWithEnv(content: string): string {
  const dataDir = mkdtempSync(join(tmpdir(), 'sg-core-ki-env-'));
  mkdirSync(join(dataDir, 'config'));
  const file = join(dataDir, 'config', '.env');
  writeFileSync(file, content);
  chmodSync(file, 0o600);
  return dataDir;
}

describe('loadDotEnv überspringt ANTHROPIC_*', () => {
  it('trägt keinen Schlüssel ein, der mit ANTHROPIC_ beginnt, alle anderen wie bisher', () => {
    const dataDir = dataDirWithEnv(
      [
        `ANTHROPIC_API_KEY=${FILE_VALUE}`,
        `ANTHROPIC_AUTH_TOKEN=${FILE_VALUE}`,
        'ANTHROPIC_BASE_URL=http://127.0.0.1:9',
        'ANTHROPIC_LOG=debug',
        'SG_LLM=fake',
        'SG_MODEL_FAST=modell-x',
        'NICHT_ANTHROPIC_API_KEY=bleibt',
        '',
      ].join('\n'),
    );
    const env: NodeJS.ProcessEnv = { SG_DATA_DIR: dataDir };
    expect(loadDotEnv(env)).toBe(join(dataDir, 'config', '.env'));
    expect(Object.keys(env).filter((key) => key.startsWith('ANTHROPIC_'))).toEqual([]);
    expect(JSON.stringify(env)).not.toContain(FILE_VALUE);
    // Der Rest der Datei gilt weiter
    expect(env).toMatchObject({
      SG_LLM: 'fake',
      SG_MODEL_FAST: 'modell-x',
      NICHT_ANTHROPIC_API_KEY: 'bleibt',
    });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('fasst eine schon gesetzte Variable nicht an (das Entfernen ist Sache von scrubAnthropicEnv)', () => {
    const dataDir = dataDirWithEnv(`ANTHROPIC_API_KEY=${FILE_VALUE}\n`);
    const env: NodeJS.ProcessEnv = { SG_DATA_DIR: dataDir, ANTHROPIC_API_KEY: ENV_VALUE };
    loadDotEnv(env);
    expect(env.ANTHROPIC_API_KEY).toBe(ENV_VALUE);
    rmSync(dataDir, { recursive: true, force: true });
  });
});

describe('scrubAnthropicEnv', () => {
  it('entfernt alle ANTHROPIC_*-Variablen und nennt nur ihre Namen', () => {
    const env: NodeJS.ProcessEnv = {
      ANTHROPIC_API_KEY: ENV_VALUE,
      ANTHROPIC_AUTH_TOKEN: ENV_VALUE,
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
      SG_LLM: 'anthropic',
      PATH: '/usr/bin',
      MEIN_ANTHROPIC_API_KEY: 'bleibt',
    };
    const removed = scrubAnthropicEnv(env);
    expect(removed).toEqual(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']);
    expect(JSON.stringify(removed)).not.toContain(ENV_VALUE);
    expect(env).toEqual({ SG_LLM: 'anthropic', PATH: '/usr/bin', MEIN_ANTHROPIC_API_KEY: 'bleibt' });
    // ohne solche Variablen ändert sich nichts
    expect(scrubAnthropicEnv(env)).toEqual([]);
    expect(Object.keys(env)).toHaveLength(3);
  });

  it('isAnthropicEnvKey: nur das Präfix ANTHROPIC_', () => {
    expect(isAnthropicEnvKey('ANTHROPIC_API_KEY')).toBe(true);
    expect(isAnthropicEnvKey('ANTHROPIC_')).toBe(true);
    expect(isAnthropicEnvKey('ANTHROPIC')).toBe(false);
    expect(isAnthropicEnvKey('SG_ANTHROPIC_API_KEY')).toBe(false);
    expect(isAnthropicEnvKey('SG_LLM')).toBe(false);
  });
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('Core-Start (main.ts)', () => {
  it('entfernt ANTHROPIC_* aus der eigenen Umgebung, übernimmt nichts aus .env und loggt nie einen Wert', async () => {
    const dataDir = dataDirWithEnv(`ANTHROPIC_API_KEY=${FILE_VALUE}\nSG_LOG_LEVEL=info\n`);
    const main = fileURLToPath(new URL('../../src/main.ts', import.meta.url));
    const child = spawn(process.execPath, [main], {
      env: {
        PATH: process.env.PATH,
        HOME: dataDir,
        ANTHROPIC_API_KEY: ENV_VALUE,
        ANTHROPIC_AUTH_TOKEN: ENV_VALUE,
        SG_DATA_DIR: dataDir,
        SG_CORE_HOST: '127.0.0.1',
        SG_CORE_PORT: String(await freePort()),
        SG_BONJOUR: '0',
        // Keine Datenbank nötig: Der Port ist zu, der Core loggt das und läuft weiter
        DATABASE_URL: 'postgres://x:y@127.0.0.1:1/keine',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Core-Start ohne Log-Zeile:\n${output}`)), 15_000);
        const onData = (chunk: Buffer) => {
          output += chunk.toString('utf8');
          // Bis zur zweiten Zeile lesen: Die erste nennt die entfernten Variablen
          if (output.includes('Konfiguration aus .env geladen')) {
            clearTimeout(timer);
            resolve();
          }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } finally {
      child.kill('SIGKILL');
      rmSync(dataDir, { recursive: true, force: true });
    }
    const line = output.split('\n').find((l) => l.includes('KI-Variablen'));
    expect(line, output).toBeDefined();
    // Nur die Variablen aus der Umgebung: Die aus der Datei kam gar nicht erst hinein
    expect((JSON.parse(line!) as { variables: string[] }).variables).toEqual([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
    ]);
    expect(output).not.toContain(ENV_VALUE);
    expect(output).not.toContain(FILE_VALUE);
  }, 20_000);
});
