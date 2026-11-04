#!/usr/bin/env node
// Einstieg der sg-CLI. Prüft die Node-Version, bevor main.ts (TypeScript, Type-Stripping) geladen wird.
// Ältere Node-Versionen würden sonst mit einer unverständlichen Fehlermeldung abbrechen.
const MIN_MAJOR = 22;
const MIN_MINOR = 18;

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major < MIN_MAJOR || (major === MIN_MAJOR && minor < MIN_MINOR)) {
  console.error(
    `[sg] Node.js ${MIN_MAJOR}.${MIN_MINOR} oder neuer wird benötigt, gefunden: v${process.versions.node}.\n` +
      '     Installieren z. B. mit "nvm install 22" (die Version steht in .nvmrc) und "pnpm sg doctor" erneut ausführen.',
  );
  process.exit(1);
}

// Pakete vor dem ersten Import aus node_modules aktualisieren (nach git pull). Nicht bei reiner Hilfe.
const args = process.argv.slice(2);
if (args.length > 0 && !args.includes('--help') && !args.includes('-h') && args[0] !== 'help') {
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { syncDeps } = await import('./deps.mjs');
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (!syncDeps(repoRoot)) process.exit(1);
}

await import('./src/main.ts');
