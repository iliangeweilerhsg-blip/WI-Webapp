// Hilfen für Tests mit dem Schlüsselbund-Fake (fake-security.mjs)
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const FIXTURE = resolve(import.meta.dirname, 'fake-security.mjs');

export interface FakeSecurity {
  dir: string;
  store: string;
  log: string;
  /** argv aller Aufrufe von `security`, so wie `ps` sie zeigen würde */
  calls(): string[][];
  items(): { service: string; account: string; password: string }[];
  restore(): void;
}

/** Legt ein Programm `security` (Schlüsselbund-Fake) vorne in PATH */
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
  return {
    dir,
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
    restore: () => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
