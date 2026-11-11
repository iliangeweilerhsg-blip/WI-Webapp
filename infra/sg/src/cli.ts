// Argumente der CLI (reine Logik, gut testbar).

export const COMMANDS = {
  start: 'Datenbank, Core und Worker starten und die Web-App öffnen',
  stop: 'Core, Worker und Datenbank anhalten',
  migrate: 'Datenbank-Migrationen ausführen, vorher Backup (--ohne-backup überspringt es)',
  doctor: 'Voraussetzungen prüfen (Node, pnpm, uv, ffmpeg, Docker, Ports, Datenordner, freier Speicher)',
  backup: 'Datensicherung in das Ziel aus den Einstellungen (pg_dump + media/ + vault/)',
  restore:
    'Stand wiederherstellen: restore <stand> | restore --test <stand> | restore --automatisch (Monatstest, nur eigene Stände) | restore (Liste)',
  moodle:
    'Moodle-Zugang: moodle login [--token-stdin] [--gueltig-bis JJJJ-MM-TT] | moodle status | moodle logout (Token im Schlüsselbund)',
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
    'Umgebungsvariablen: SG_DATA_DIR (Standard ~/StudienGehirn), DATABASE_URL, SG_CORE_PORT (Standard 4710), SG_WEB_DIR, SG_MOODLE_URL',
    'Hinweis: Backups sind nicht signiert. Spiele mit "restore" nur eigene Backups ein, einem fremden Stand wird vertraut.',
    'Hilfe: pnpm sg --help',
  ].join('\n');
}
