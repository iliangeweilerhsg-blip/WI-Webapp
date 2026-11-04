// Registry der Op-Handler (VERTRAEGE §16.2). Gerüst aus T1-DB, Registry aus T1-08,
// die Handler liefern die Fachtickets (T1-02: session.*, slide.change, marker.*; Core-Ink: Rest).
import type { SyncErrorCode, SyncOp, SyncOrigin } from '@sg/shared';
import type { Tx } from '../db/client.ts';

export interface OpHandlerContext {
  /** Gerät aus dem Token der Verbindung, `null` bei lokalen Clients und Server-Operationen */
  deviceId: string | null;
  origin: SyncOrigin;
}

export type OpHandler = (tx: Tx, op: SyncOp, ctx: OpHandlerContext) => Promise<void>;

/**
 * Sperren, die der Handler braucht, **vor** `appendOp` nehmen (z. B. Advisory-Lock und Session-Zeile in T1-02).
 * `appendOp` sperrt die `sync_stream`-Zeile. Nimmt der Handler seine Sperren erst danach, entsteht mit einer
 * Transaktion, die in der Reihenfolge Advisory → `sync_stream` sperrt, ein Deadlock (40P01).
 */
export type OpPreLock = (tx: Tx, op: SyncOp) => Promise<void>;

export interface OpHandlerOptions {
  preLock?: OpPreLock;
}

export interface OpRegistration {
  handler: OpHandler;
  preLock: OpPreLock | undefined;
}

/**
 * Fachlicher Fehler einer Operation. Der Sync-Server macht daraus eine `error`-Nachricht (§11.2).
 *
 * - `retryable = true` gilt immer als fatal für die Verbindung (Code 4503).
 * - `session_superseded` ist immer fatal (Code 4409), auch ohne `fatal`.
 * - `fatal = true` bei anderen nicht wiederholbaren Fehlern: `error` mit `fatal = true`, dann Schließen
 *   (`device_token_invalid` mit 4401, sonst 1008).
 */
export class SyncOpError extends Error {
  readonly code: SyncErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;
  readonly fatal: boolean;

  constructor(
    code: SyncErrorCode,
    retryable: boolean,
    details?: Record<string, unknown>,
    options: { fatal?: boolean } = {},
  ) {
    super(code);
    this.name = 'SyncOpError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
    this.fatal = retryable || code === 'session_superseded' || options.fatal === true;
  }
}

const handlers = new Map<SyncOp['kind'], OpRegistration>();

/**
 * Operationen, die nur der Core selbst schreibt (§11.2). Von einem Client: `op_not_allowed`.
 * **Liste von Hand:** Neue Server-Operationen hier eintragen. Ein Unit-Test vergleicht sie mit den Schema-Varianten,
 * deren Beschreibung mit „Nur vom Server“ beginnt.
 */
export const SERVER_ONLY_KINDS: ReadonlySet<SyncOp['kind']> = new Set([
  'notebook.update',
  'notebook.delete',
  'notebook.restore',
  'page.restore',
]);

/**
 * Handler für eine Operationsart registrieren (VERTRAEGE §16.2).
 *
 * Der Dispatcher (`sync/connection.ts`) prüft vorher das Schema und Duplikate (`findOpById`, gleiche
 * Operation → ursprüngliches `ack`). Dann in **einer** Transaktion:
 *   1. `opts.preLock` (falls gesetzt): Sperren des Handlers,
 *   2. `appendOp` (die Client-Operation steht vor allen Server-Operationen, die der Handler schreibt),
 *      bei `duplicate = true` Rollback und ursprüngliches `ack`,
 *   3. der Handler.
 * Handler prüfen Duplikate nie selbst und rufen `appendOp` für die Client-Operation nicht auf.
 * Pro Art gibt es genau einen Handler, ein zweiter wirft.
 */
export function registerOpHandler(
  kind: SyncOp['kind'],
  handler: OpHandler,
  opts: OpHandlerOptions = {},
): void {
  // Server-Operationen (SERVER_ONLY_KINDS) dürfen registriert werden, der Dispatcher lehnt sie von Clients aber
  // immer vorher mit op_not_allowed ab: Ihr Handler läuft nie für eine Client-Operation
  if (handlers.has(kind)) throw new Error(`Für ${kind} ist schon ein Handler registriert`);
  handlers.set(kind, { handler, preLock: opts.preLock });
}

/** Handler abmelden (z. B. beim Beenden der App, damit eine neue Instanz im selben Prozess neu registrieren kann) */
export function unregisterOpHandler(kind: SyncOp['kind'], handler?: OpHandler): void {
  const current = handlers.get(kind);
  if (current && (handler === undefined || current.handler === handler)) handlers.delete(kind);
}

/** Registrierter Handler oder `undefined` */
export function getOpHandler(kind: SyncOp['kind']): OpHandler | undefined {
  return handlers.get(kind)?.handler;
}

/** Handler samt `preLock` oder `undefined` */
export function getOpRegistration(kind: SyncOp['kind']): OpRegistration | undefined {
  return handlers.get(kind);
}

/** Alle registrierten Arten mit ihrem Handler (Momentaufnahme) */
export function registeredOpHandlers(): Map<SyncOp['kind'], OpHandler> {
  return new Map([...handlers].map(([kind, r]) => [kind, r.handler]));
}
