// Prüft nach dem Build, dass das Theme-Skript im <head> als Zeichenkette im RSC-Payload steht und nicht als Modulreferenz
// (`"__html":"$2"`). Eine Referenz lässt den <head> an einem noch ladenden Chunk hängen, die Hydration scheitert sporadisch
// (React #418, siehe test/hydration.test.tsx).
// Aufruf: node scripts/check-theme-init.mjs [--strict] [out-Ordner]
// Als postbuild nur Warnung (Exit 0): Die Prüfung hängt am internen Payload-Format von Next und darf auf dem Mac
// des Nutzers keinen „Build fehlgeschlagen“-Fehlalarm in `pnpm sg start` auslösen. Hart (--strict) prüft die CI.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const out = args.find((a) => a !== '--strict') ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
const pages = readdirSync(out).filter((f) => f.endsWith('.html') && f !== '404.html');
if (pages.length === 0) {
  console.error(`check-theme-init: keine Seiten in ${out}`);
  process.exit(strict ? 1 : 0);
}

let failed = false;
for (const page of pages) {
  const html = readFileSync(join(out, page), 'utf8');
  const marker = '\\"head\\"';
  const at = html.indexOf(marker);
  const head = at < 0 ? '' : html.slice(at, at + 600);
  const literal = head.includes('__html\\":\\"try{var d=document.documentElement');
  if (!literal) {
    failed = true;
    console.error(
      `check-theme-init: ${page}: Theme-Skript steht nicht als Literal im <head> des RSC-Payloads`,
    );
  }
}
if (failed) {
  if (strict) process.exit(1);
  console.warn('check-theme-init: nur Warnung (ohne --strict). Bitte melden, die CI prüft das hart.');
  process.exit(0);
}
console.log(`check-theme-init: ok (${pages.length} Seiten)`);
