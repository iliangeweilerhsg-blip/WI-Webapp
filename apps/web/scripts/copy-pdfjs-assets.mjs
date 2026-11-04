// Kopiert das Beiwerk von pdf.js (wasm, Standardschriften, CMaps, Farbprofile) nach public/pdfjs/<version>/,
// damit der Static Export es lokal ausliefert (kein CDN). Läuft vor `next build` und `next dev`.
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgPath = require.resolve('pdfjs-dist/package.json');
const root = dirname(pkgPath);
const { version } = JSON.parse(await readFile(pkgPath, 'utf8'));
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'pdfjs');

await rm(target, { recursive: true, force: true });
for (const name of ['wasm', 'standard_fonts', 'cmaps', 'iccs']) {
  await mkdir(join(target, version), { recursive: true });
  // Die .js-Dateien (Fallbacks ohne wasm, QuickJS für PDF-Skripte) braucht kein aktueller Browser; sie
  // würden außerdem vom Linting erfasst.
  await cp(join(root, name), join(target, version, name), {
    recursive: true,
    filter: (src) => !src.endsWith('.js'),
  });
}
console.log(`pdf.js ${version}: Beiwerk nach public/pdfjs/${version}/ kopiert`);
