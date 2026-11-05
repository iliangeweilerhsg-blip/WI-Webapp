// Bestätigungscodes für endgültige und öffentliche Aktionen (F-MDL-06, 08 §9.3)
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const CONFIRMATION_TTL_MS = 5 * 60 * 1000;
/** Mehr offene Codes braucht ein einzelner Nutzer nie. Älteste fliegen zuerst raus */
const MAX_OPEN_CODES = 100;

/** JSON mit sortierten Schlüsseln (rekursiv). `undefined` in Objekten fällt weg wie bei JSON.stringify */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** SHA-256 über Aktion und kanonische Parameter */
export function paramsHash(actionId: string, params: unknown): Buffer {
  return createHash('sha256')
    .update(`${actionId}\n${canonicalJson(params)}`)
    .digest();
}

interface OpenCode {
  hash: Buffer;
  expiresAt: number;
}

export interface ConfirmationStoreOptions {
  ttlMs?: number;
  now?: () => number;
}

/**
 * Codes leben nur im Speicher (ein Neustart macht alle ungültig), gelten `ttlMs` lang, einmal und nur
 * für genau diese Aktion mit genau diesen Parametern.
 */
export class ConfirmationStore {
  private readonly open = new Map<string, OpenCode>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: ConfirmationStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? CONFIRMATION_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  issue(actionId: string, params: unknown): { token: string; expiresAt: Date } {
    this.prune();
    // 128 bit, base64url
    const token = randomBytes(16).toString('base64url');
    const expiresAt = this.now() + this.ttlMs;
    this.open.set(token, { hash: paramsHash(actionId, params), expiresAt });
    while (this.open.size > MAX_OPEN_CODES) {
      const oldest = this.open.keys().next().value;
      if (oldest === undefined) break;
      this.open.delete(oldest);
    }
    return { token, expiresAt: new Date(expiresAt) };
  }

  /**
   * Löst einen Code ein. Jeder Versuch verbraucht den Code, auch ein fehlgeschlagener: So lässt sich
   * ein Code nicht für andere Parameter durchprobieren.
   */
  consume(token: string, actionId: string, params: unknown): boolean {
    const entry = this.open.get(token);
    if (!entry) return false;
    this.open.delete(token);
    if (entry.expiresAt <= this.now()) return false;
    return timingSafeEqual(entry.hash, paramsHash(actionId, params));
  }

  /** Anzahl offener Codes (für Tests) */
  get size(): number {
    return this.open.size;
  }

  private prune(): void {
    const now = this.now();
    for (const [token, entry] of this.open) {
      if (entry.expiresAt <= now) this.open.delete(token);
    }
  }
}
