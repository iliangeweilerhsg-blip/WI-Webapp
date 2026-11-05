#!/usr/bin/env node
// Einstiegspunkt der sg-CLI. Läuft ohne Build über Node-Type-Stripping (Node ≥ 22.18).
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { helpText, parseArgs } from './cli.ts';
import { dispatch } from './commands.ts';
import { resolveConfig, type SgConfig } from './config.ts';

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.kind === 'help') {
    console.log(helpText());
    return 0;
  }
  if (parsed.kind === 'error') {
    console.error(`${parsed.message}\n\n${helpText()}`);
    return 1;
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  let cfg: SgConfig;
  try {
    cfg = resolveConfig(process.env, homedir(), repoRoot);
  } catch (e) {
    console.error(`[sg] ${(e as Error).message}`);
    return 1;
  }
  return dispatch(parsed.command, cfg, parsed.rest);
}

process.exitCode = await main(process.argv.slice(2));
