// Moodle-Token aus dem macOS-Schlüsselbund (08 §9.1). Der Token bleibt nur im Speicher des Core.
import { execFile } from 'node:child_process';

/** Dienstname des Schlüsselbund-Eintrags (F-MDL-01, docs/anleitungen/MOODLE-TOKEN.md) */
export const KEYCHAIN_SERVICE = 'studiengehirn-moodle';

/** Moodle-Tokens sind 32 Hex-Zeichen. Alles andere gilt als „kein Token“ */
const TOKEN_RE = /^[a-f0-9]{32}$/;
/** „Kein Token“ nur kurz merken: Ein neu eingetragener Token wirkt so ohne Neustart */
export const MISSING_TOKEN_CACHE_MS = 30_000;

export interface MoodleTokenStore {
  /** Token oder null, wenn keiner hinterlegt ist. Wirft nie mit dem Token in der Meldung */
  getToken(): Promise<string | null>;
  /** Zwischenspeicher verwerfen, z. B. nachdem Moodle den Token abgelehnt hat */
  invalidate(): void;
}

export type ExecFileFn = (file: string, args: string[]) => Promise<{ stdout: string }>;

const defaultExec: ExecFileFn = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 5000, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error);
      else resolve({ stdout });
    });
  });

/**
 * Liest den Token mit `security find-generic-password -s studiengehirn-moodle -w`.
 * Fehlt der Eintrag (oder läuft der Core nicht auf macOS), ist das Ergebnis null.
 */
export class KeychainTokenStore implements MoodleTokenStore {
  private cached: string | null | undefined;
  private missingSince = 0;
  private readonly exec: ExecFileFn;
  private readonly service: string;
  private readonly now: () => number;

  constructor(options: { exec?: ExecFileFn; service?: string; now?: () => number } = {}) {
    this.exec = options.exec ?? defaultExec;
    this.service = options.service ?? KEYCHAIN_SERVICE;
    this.now = options.now ?? Date.now;
  }

  async getToken(): Promise<string | null> {
    if (typeof this.cached === 'string') return this.cached;
    if (this.cached === null && this.now() - this.missingSince < MISSING_TOKEN_CACHE_MS) return null;
    let token: string | null;
    try {
      const { stdout } = await this.exec('security', ['find-generic-password', '-s', this.service, '-w']);
      const value = stdout.trim();
      token = TOKEN_RE.test(value) ? value : null;
    } catch {
      // Kein Eintrag, kein macOS oder Schlüsselbund gesperrt: wie „nicht eingerichtet“ behandeln
      token = null;
    }
    this.cached = token;
    if (token === null) this.missingSince = this.now();
    return token;
  }

  invalidate(): void {
    this.cached = undefined;
  }
}

/** Fester Token, für Tests */
export class StaticTokenStore implements MoodleTokenStore {
  private readonly token: string | null;
  invalidations = 0;
  constructor(token: string | null) {
    this.token = token;
  }
  async getToken(): Promise<string | null> {
    return this.token;
  }
  invalidate(): void {
    this.invalidations += 1;
  }
}
