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

// Pakete vor dem ersten Import aus node_modules aktualisieren (nach git pull).
// start/migrate brauchen aktuelle Pakete und brechen sonst ab. stop braucht keine neuen Pakete und
// muss auch offline funktionieren (kein Install, während die App läuft). Übrige Befehle (doctor …)
// versuchen es und laufen bei einem Fehlschlag mit Warnung weiter.
const [command] = process.argv.slice(2);
const isHelp =
  command === undefined ||
  command === 'help' ||
  process.argv.includes('--help') ||
  process.argv.includes('-h');
if (!isHelp && command !== 'stop') {
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { syncDeps } = await import('./deps.mjs');
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (!syncDeps(repoRoot)) {
    if (command === 'start' || command === 'migrate') process.exit(1);
    console.error('[sg] Weiter mit den bisher installierten Paketen.');
  }
}

await import('./src/main.ts');
