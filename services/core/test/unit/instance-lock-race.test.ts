// Ein Core pro Datenordner (#174): Echte Prozesse starten gleichzeitig gegen dieselbe veraltete Sperrdatei.
// Genau einer darf gewinnen, egal wie das Betriebssystem sie verzahnt.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const MODULE = new URL('../../src/lib/instance-lock.ts', import.meta.url).href;
/** Liegt über `pid_max` von Linux und macOS: `kill(pid, 0)` meldet immer ESRCH */
const DEAD_PID = 999_999_999;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sg-lock-race-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const CHILD = `
import { existsSync } from 'node:fs';
import { acquireCoreLock } from ${JSON.stringify(MODULE)};
const [dataDir, go] = process.argv.slice(2);
while (!existsSync(go)) {}
let result;
try {
  acquireCoreLock(dataDir);
  result = 'gewonnen';
} catch (error) {
  result = error.name === 'CoreLockHeldError' ? 'abgelehnt' : 'fehler: ' + error.message;
}
process.stdout.write(result + '\\n');
// Am Leben bleiben, bis der Test beendet: Ein Gewinner gibt seine Sperre nicht frei
setInterval(() => {}, 1000);
`;

async function round(count: number): Promise<string[]> {
  const dataDir = join(dir, `daten-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dataDir, 'run'), { recursive: true });
  writeFileSync(join(dataDir, 'run', 'core.lock'), `${DEAD_PID}\n`);
  const go = join(dataDir, 'los');
  const script = join(dir, 'kind.mjs');
  writeFileSync(script, CHILD);
  const children = Array.from({ length: count }, () =>
    spawn(process.execPath, [script, dataDir, go], { stdio: ['ignore', 'pipe', 'inherit'] }),
  );
  try {
    const results = children.map(
      (child) =>
        new Promise<string>((resolve) => {
          let out = '';
          child.stdout.on('data', (chunk: Buffer) => {
            out += chunk.toString('utf8');
            if (out.includes('\n')) resolve(out.trim());
          });
          child.once('exit', (code) => resolve(out.trim() || `beendet mit ${code}`));
        }),
    );
    // Alle Kinder warten auf die Datei `los`; so beginnen sie möglichst gleichzeitig
    await new Promise((resolve) => setTimeout(resolve, 300));
    writeFileSync(go, '');
    const outcome = await Promise.all(results);
    expect(readdirSync(join(dataDir, 'run'))).toEqual(['core.lock']);
    return outcome;
  } finally {
    for (const child of children) child.kill('SIGKILL');
  }
}

describe('Core-Sperrdatei unter Wettlauf (#174)', () => {
  it('lässt bei gleichzeitigen Starts gegen eine veraltete Datei genau einen gewinnen', async () => {
    for (let i = 0; i < 5; i += 1) {
      const outcome = await round(8);
      expect(
        outcome.filter((r) => r === 'gewonnen'),
        outcome.join(', '),
      ).toHaveLength(1);
      expect(
        outcome.filter((r) => r === 'abgelehnt'),
        outcome.join(', '),
      ).toHaveLength(7);
    }
  }, 60_000);
});
