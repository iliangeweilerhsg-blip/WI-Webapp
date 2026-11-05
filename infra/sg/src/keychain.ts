// Zugriff auf den macOS-Schlüsselbund über das Systemprogramm `security` (08 §9.1).
//
// Das Geheimnis steht nie in argv (sonst wäre es in `ps` sichtbar): `security add-generic-password -w <wert>`
// scheidet aus. Stattdessen läuft `security -i` (interaktiver Modus). Er liest Befehle zeilenweise von stdin,
// der Befehl mit dem Wert geht also über eine Pipe. Gelesen wird wie im Core mit
// `security find-generic-password -s <dienst> -w`, der Wert kommt über stdout.
import { spawn } from 'node:child_process';

export interface Keychain {
  /** Legt den Eintrag (Dienst + Konto) an oder ersetzt ihn */
  store(service: string, account: string, secret: string): Promise<void>;
  /** Liest den Wert genau so, wie der Core ihn liest (nur Dienst, erster Treffer). null = kein Eintrag */
  read(service: string): Promise<string | null>;
  /** true, wenn es einen Eintrag zum Dienst gibt. Liest den Wert nicht */
  exists(service: string): Promise<boolean>;
  /** Löscht alle Einträge zum Dienst, Rückgabe: Anzahl */
  removeAll(service: string): Promise<number>;
}

export class KeychainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeychainError';
  }
}

export interface RunOutput {
  code: number;
  stdout: string;
  stderr: string;
}

/** Startet `security` mit Argumenten und optionaler Eingabe über stdin */
export type SecurityRunner = (args: string[], stdin?: string) => Promise<RunOutput>;

/** Erlaubte Zeichen für Dienst, Konto und Wert im interaktiven Modus (kein Quoting nötig, keine Injektion) */
const PLAIN = /^[A-Za-z0-9._@-]{1,128}$/;
/** Schutz gegen Endlosschleifen beim Löschen */
const MAX_DELETES = 50;
/** `security` meldet „Eintrag nicht gefunden“ mit Exit-Code 44 */
export const SECURITY_NOT_FOUND = 44;

/** Ersetzt Geheimnisse und alles, was wie ein Moodle-Token aussieht, und kürzt den Text */
export function redact(text: string, secrets: readonly string[] = []): string {
  let result = text;
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join('***');
  }
  result = result.replace(/[A-Fa-f0-9]{32,}/g, '***').trim();
  return result.length > 300 ? `${result.slice(0, 300)} …` : result;
}

export function spawnSecurity(bin = 'security', timeoutMs = 60_000): SecurityRunner {
  return (args, stdin) =>
    new Promise<RunOutput>((resolve) => {
      const child = spawn(bin, args, { stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const done = (output: RunOutput): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(output);
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        done({ code: 124, stdout: '', stderr: 'Zeitlimit überschritten' });
      }, timeoutMs);
      child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
      child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
      child.once('error', (error: NodeJS.ErrnoException) =>
        done({
          code: 127,
          stdout: '',
          stderr: `security konnte nicht gestartet werden (${error.code ?? 'Fehler'})`,
        }),
      );
      child.once('close', (code) => done({ code: code ?? 1, stdout, stderr }));
      if (stdin !== undefined && child.stdin) {
        // EPIPE, falls `security` vorzeitig endet: der Exit-Code sagt dann genug
        child.stdin.on('error', () => {});
        child.stdin.end(stdin);
      }
    });
}

export class SecurityKeychain implements Keychain {
  private readonly run: SecurityRunner;

  constructor(run: SecurityRunner = spawnSecurity()) {
    this.run = run;
  }

  async store(service: string, account: string, secret: string): Promise<void> {
    if (!PLAIN.test(service) || !PLAIN.test(account) || !PLAIN.test(secret)) {
      throw new KeychainError('Dienst, Konto oder Wert enthält unerlaubte Zeichen.');
    }
    // Der Wert geht über stdin an `security -i`, nie als Argument (Gegenprobe in test/keychain.test.ts)
    const command = `add-generic-password -a ${account} -s ${service} -U -w ${secret}\n`;
    const result = await this.run(['-i'], command);
    if (result.code !== 0) {
      throw new KeychainError(
        `Schlüsselbund: Speichern fehlgeschlagen (Exit ${result.code}). ${redact(result.stderr, [secret])}`.trim(),
      );
    }
  }

  async read(service: string): Promise<string | null> {
    const result = await this.run(['find-generic-password', '-s', service, '-w']);
    if (result.code === SECURITY_NOT_FOUND) return null;
    if (result.code !== 0) {
      throw new KeychainError(
        `Schlüsselbund: Lesen fehlgeschlagen (Exit ${result.code}). ${redact(result.stderr)}`.trim(),
      );
    }
    return result.stdout.replace(/\r?\n$/, '');
  }

  async exists(service: string): Promise<boolean> {
    // Ohne -w und ohne -g gibt `security` nur die Attribute aus, nicht den Wert
    const result = await this.run(['find-generic-password', '-s', service]);
    if (result.code === 0) return true;
    if (result.code === SECURITY_NOT_FOUND) return false;
    throw new KeychainError(
      `Schlüsselbund: Abfrage fehlgeschlagen (Exit ${result.code}). ${redact(result.stderr)}`.trim(),
    );
  }

  async removeAll(service: string): Promise<number> {
    let removed = 0;
    for (let i = 0; i < MAX_DELETES; i += 1) {
      const result = await this.run(['delete-generic-password', '-s', service]);
      if (result.code === SECURITY_NOT_FOUND) return removed;
      if (result.code !== 0) {
        throw new KeychainError(
          `Schlüsselbund: Löschen fehlgeschlagen (Exit ${result.code}). ${redact(result.stderr)}`.trim(),
        );
      }
      removed += 1;
    }
    throw new KeychainError(`Schlüsselbund: Mehr als ${MAX_DELETES} Einträge, Abbruch.`);
  }
}
