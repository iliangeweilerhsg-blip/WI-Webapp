// Strich-Testdaten aus tests/fixtures/strokes: 8 Dateien mit 308 Strichen.
// 01 bis 07 sind Format v1 (ohne `sizes`, 299 Striche), 08 ist Format v2 (mit `sizes`, 9 Striche).
// Tests, die „v1 unverändert“ prüfen, nehmen `loadV1Fixtures()`, also nur die Dateien 01 bis 07.
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

/** Nur die Dateien 01 bis 07 (Format v1, 299 Striche). */
export function loadV1Fixtures(): FixtureFile[] {
  return loadFixtures().filter((f) => /^0[1-7]-/.test(f.name));
}

/** Nur die Datei 08 (Format v2, mit `sizes`). */
export function loadV2Fixtures(): FixtureFile[] {
  return loadFixtures().filter((f) => f.name.startsWith('08-'));
}
