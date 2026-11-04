import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE_ENTRY, coreCommand } from '../src/commands.ts';
import type { SgConfig } from '../src/config.ts';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const cfg = { repoRoot } as SgConfig;

describe('Core-Start ohne pnpm', () => {
  it('startet mit Node im Ordner des Core', () => {
    const c = coreCommand(cfg);
    expect(c.cmd).toBe(process.execPath);
    expect(c.args).toEqual([CORE_ENTRY]);
    expect(c.cwd).toBe(join(repoRoot, 'services', 'core'));
  });

  it('entspricht dem start-Skript von @sg/core (kein stiller Auseinanderlauf)', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'services', 'core', 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.start).toBe(`node ${CORE_ENTRY}`);
  });
});
