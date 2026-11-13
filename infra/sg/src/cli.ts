// Argumente der CLI (reine Logik, gut testbar).

export const COMMANDS = {
  start: 'Datenbank, Core, Worker und Tunnel-Helfer starten und die Web-App öffnen',
  stop: 'Tunnel-Helfer, Core, Worker und Datenbank anhalten',
  migrate: 'Datenbank-Migrationen ausführen, vorher Backup (--ohne-backup überspringt es)',
  doctor:
    'Voraussetzungen prüfen (Node, pnpm, uv, ffmpeg, Docker, Ports, Datenordner, freier Speicher, Tunnel-Helfer)',
  backup: 'Datensicherung in das Ziel aus den Einstellungen (pg_dump + media/ + vault/)',
  restore:
    'Stand wiederherstellen: restore <stand> | restore --test <stand> | restore --automatisch (Monatstest, nur eigene Stände) | restore (Liste)',
  moodle:
    'Moodle-Zugang: moodle login [--token-stdin] [--gueltig-bis JJJJ-MM-TT] | moodle status | moodle logout (Token im Schlüsselbund)',
  messen:
    'Abnahme messen (nur lesend): messen pipeline [--session <id> | --letzte <n>] | messen ausrichtung <datei.json>',
  ipad: 'iPad-App: ipad (aktuell oder neu aufspielen?) | ipad aufgespielt (nach dem Aufspielen bestätigen)',
} as const;

export type CommandName = keyof typeof COMMANDS;

export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'command'; command: CommandName; rest: string[] }
  | { kind: 'error'; message: string };

export function isCommandName(value: string): value is CommandName {
  return Object.hasOwn(COMMANDS, value);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [first, ...rest] = argv;
  if (first === undefined || first === '--help' || first === '-h' || first === 'help') {
    return { kind: 'help' };
  }
  if (!isCommandName(first)) {
    return { kind: 'error', message: `Unbekannter Befehl "${first}".` };
  }
  if (rest.includes('--help') || rest.includes('-h')) return { kind: 'help' };
  return { kind: 'command', command: first, rest };
}

export function helpText(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((c) => c.length));
  const lines = Object.entries(COMMANDS).map(([name, text]) => `  ${name.padEnd(width)}  ${text}`);
  return [
    'sg – Steuerung des Studien-Gehirns',
    '',
    'Aufruf: pnpm sg <befehl>',
    '',
    'Befehle:',
    ...lines,
    '',
    'Umgebungsvariablen: SG_DATA_DIR (Standard ~/StudienGehirn), DATABASE_URL, SG_CORE_PORT (Standard 4710), SG_WEB_DIR, SG_MOODLE_URL, SG_TUNNEL und SG_TUNNEL_P2P (0 schaltet aus)',
    'Hinweis: Backups sind nicht signiert. Spiele mit "restore" nur eigene Backups ein, einem fremden Stand wird vertraut.',
    'Hilfe: pnpm sg --help',
  ].join('\n');
}
