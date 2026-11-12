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

/** Ergebnis von {@link ConfirmationStore.consume} */
export type ConsumeResult = 'ok' | 'invalid' | 'state_changed';

/**
 * Prüft, dass der Stand reines JSON ist (null, Wahrheitswert, Text, endliche Zahl, Liste, schlichtes Objekt).
 * `canonicalJson` machte aus `Date`, `Map` oder `Set` sonst still `{}` und aus `NaN` `null`: Dann sähe die Bindung
 * eine Änderung nicht. Ein Handler mit solchem Stand ist ein Programmierfehler, darum Fehler statt Code.
 */
function assertJsonState(value: unknown, depth = 0): void {
  if (depth > 64) throw new Error('Stand einer Moodle-Aktion ist zu tief verschachtelt');
  if (value === null || value === undefined) return;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return;
    case 'number':
      if (Number.isFinite(value)) return;
      break;
    case 'object': {
      if (Array.isArray(value)) {
        for (const item of value) assertJsonState(item, depth + 1);
        return;
      }
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto === Object.prototype || proto === null) {
        for (const item of Object.values(value as Record<string, unknown>)) assertJsonState(item, depth + 1);
        return;
      }
      break;
    }
    default:
      break;
  }
  throw new Error('Stand einer Moodle-Aktion ist kein reines JSON');
}

/** SHA-256 über den kanonischen Stand. Kein Stand zählt als `null`. Wirft bei einem Stand, der kein reines JSON ist */
export function stateHash(state: unknown): Buffer {
  assertJsonState(state);
  return createHash('sha256')
    .update(canonicalJson(state ?? null))
    .digest();
}

interface OpenCode {
  hash: Buffer;
  stateHash: Buffer;
  /** Geltungsbereich, z. B. `assign:42`. `revokeScope` verwirft alle Codes mit diesem Bereich */
  scope: string | null;
  expiresAt: number;
}

/** Bindung eines Codes über Aktion und Parameter hinaus (08 §9.3) */
export interface ConfirmationBinding {
  /** Stand in Moodle, den die Aktion verändert. Fehlt er, gilt `null` */
  state?: unknown;
  /** Geltungsbereich des Codes */
  scope?: string | null;
  /** Zählerstand von {@link ConfirmationStore.epoch}, gelesen **bevor** der Stand aus Moodle gelesen wurde */
  epoch?: number;
}

export interface ConfirmationStoreOptions {
  ttlMs?: number;
  now?: () => number;
}

/**
 * Codes leben nur im Speicher (ein Neustart macht alle ungültig), gelten `ttlMs` lang, einmal und nur
 * für genau diese Aktion mit genau diesen Parametern und, wenn gebunden, genau diesen Stand.
 */
export class ConfirmationStore {
  private readonly open = new Map<string, OpenCode>();
  /** Zähler je Bereich, steigt mit jedem `revokeScope`. Fehlt ein Bereich, steht er auf 0 */
  private readonly epochs = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: ConfirmationStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? CONFIRMATION_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Zählerstand des Bereichs. Die Vorschau liest ihn, **bevor** sie den Stand aus Moodle liest: Läuft dazwischen ein
   * `revokeScope`, ist der Zähler beim Ausgeben des Codes höher, und der Code wird gar nicht erst gültig.
   */
  epoch(scope: string): number {
    return this.epochs.get(scope) ?? 0;
  }

  issue(
    actionId: string,
    params: unknown,
    binding: ConfirmationBinding = {},
  ): { token: string; expiresAt: Date } {
    // Zuerst: Ein Stand, der kein reines JSON ist, wirft, bevor ein Code entsteht
    const boundState = stateHash(binding.state);
    this.prune();
    // 128 bit, base64url
    const token = randomBytes(16).toString('base64url');
    const expiresAt = this.now() + this.ttlMs;
    const scope = binding.scope ?? null;
    // Zwischen Lesen und Ausgeben hat ein `revokeScope` gewirkt: Code ausgeben, aber nie speichern → `invalid`
    const stale = scope !== null && binding.epoch !== undefined && binding.epoch !== this.epoch(scope);
    if (!stale) {
      this.open.set(token, {
        hash: paramsHash(actionId, params),
        stateHash: boundState,
        scope,
        expiresAt,
      });
      while (this.open.size > MAX_OPEN_CODES) {
        const oldest = this.open.keys().next().value;
        if (oldest === undefined) break;
        this.open.delete(oldest);
      }
    }
    return { token, expiresAt: new Date(expiresAt) };
  }

  /**
   * Löst einen Code ein. Jeder Versuch verbraucht den Code, auch ein fehlgeschlagener: So lässt sich
   * ein Code nicht für andere Parameter durchprobieren. Der Aufrufer liest den Stand **vor** dem Einlösen.
   * `state_changed`: Parameter stimmen, aber der Stand in Moodle ist ein anderer als bei der Vorschau.
   */
  consume(token: string, actionId: string, params: unknown, state?: unknown): ConsumeResult {
    // Vor dem Nachschlagen: Ein Stand, der kein reines JSON ist, wirft hier und verbraucht keinen Code
    const currentState = stateHash(state);
    const entry = this.open.get(token);
    if (!entry) return 'invalid';
    this.open.delete(token);
    // Beide Vergleiche immer ausführen, damit die Dauer nichts über den Grund verrät
    const sameParams = timingSafeEqual(entry.hash, paramsHash(actionId, params));
    const sameState = timingSafeEqual(entry.stateHash, currentState);
    if (entry.expiresAt <= this.now() || !sameParams) return 'invalid';
    return sameState ? 'ok' : 'state_changed';
  }

  /**
   * Erhöht den Zähler des Bereichs und verwirft alle offenen Codes mit diesem Bereich. Liefert die Anzahl der
   * verworfenen (noch nicht abgelaufenen) Codes.
   */
  revokeScope(scope: string): number {
    this.prune();
    this.epochs.set(scope, this.epoch(scope) + 1);
    let revoked = 0;
    for (const [token, entry] of this.open) {
      if (entry.scope === scope) {
        this.open.delete(token);
        revoked += 1;
      }
    }
    return revoked;
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
