// Strich-Testdaten aus tests/fixtures/strokes (7 Dateien, 299 Striche).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Stroke } from '@sg/shared';

export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../tests/fixtures/strokes');

export interface FixtureFile {
  name: string;
  strokes: Stroke[];
}

export function loadFixtures(): FixtureFile[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((name) => ({
      name,
      strokes: JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as Stroke[],
    }));
}
