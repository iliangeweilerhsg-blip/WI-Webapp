// Hilfen für Tests mit dem Schlüsselbund-Fake (fake-security.mjs)
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const FIXTURE = resolve(import.meta.dirname, 'fake-security.mjs');

/**
 * Dienstname für Tests. Tests nutzen nie den echten Dienst `studiengehirn-moodle`: Fände ein Mac doch
 * /usr/bin/security statt des Fakes, bliebe der echte Token des Owners trotzdem unberührt.
 */
export const TEST_SERVICE = 'studiengehirn-moodle-test';

export interface FakeSecurity {
  dir: string;
  /** Absoluter Pfad des Fakes */
  bin: string;
  store: string;
  log: string;
  /** argv aller Aufrufe von `security`, so wie `ps` sie zeigen würde */
  calls(): string[][];
  items(): { service: string; account: string; password: string }[];
  restore(): void;
}

/**
 * Bricht ab, wenn `security` über PATH nicht genau der Fake `bin` ist (z. B. /usr/bin/security auf dem Mac).
 * Schutz, damit kein Test den echten Schlüsselbund berührt.
 */
export function assertFakeSecurityFirst(bin: string): void {
  const found = spawnSync('sh', ['-c', 'command -v security'], { env: process.env, encoding: 'utf8' });
  const path = (found.stdout ?? '').trim();
  if (path !== bin) {
    throw new Error(
      `Schlüsselbund-Fake ist nicht das erste "security" in PATH (gefunden: ${path || 'nichts'}). ` +
        'Abbruch, damit kein Test den echten Schlüsselbund berührt.',
    );
  }
}

/** Legt ein Programm `security` (Schlüsselbund-Fake) vorne in PATH und prüft, dass es gefunden wird */
export function installFakeSecurity(): FakeSecurity {
  const dir = mkdtempSync(join(tmpdir(), 'sg-fake-security-'));
  const bin = join(dir, 'security');
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FIXTURE}" "$@"\n`);
  chmodSync(bin, 0o755);
  const saved = {
    PATH: process.env.PATH,
    FAKE_KEYCHAIN_FILE: process.env.FAKE_KEYCHAIN_FILE,
    FAKE_SECURITY_LOG: process.env.FAKE_SECURITY_LOG,
  };
  const store = join(dir, 'keychain.json');
  const log = join(dir, 'calls.log');
  process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ''}`;
  process.env.FAKE_KEYCHAIN_FILE = store;
  process.env.FAKE_SECURITY_LOG = log;
  const restore = (): void => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    assertFakeSecurityFirst(bin);
  } catch (error) {
    restore();
    throw error;
  }
  return {
    dir,
    bin,
    store,
    log,
    calls: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as string[])
        : [],
    items: () => (existsSync(store) ? JSON.parse(readFileSync(store, 'utf8')) : []),
    restore,
  };
}
