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
 * Fachlicher Fehler einer Operation. Der Sync-Server macht daraus eine `error`-Nachricht (§11.2).
 * `retryable = true` gilt immer als fatal für die Verbindung (Code 4503).
 */
export class SyncOpError extends Error {
  readonly code: SyncErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: SyncErrorCode, retryable: boolean, details?: Record<string, unknown>) {
    super(code);
    this.name = 'SyncOpError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

const handlers = new Map<SyncOp['kind'], OpHandler>();

/** Operationen, die nur der Core selbst schreibt (§11.2). Von einem Client: `op_not_allowed` */
export const SERVER_ONLY_KINDS: ReadonlySet<SyncOp['kind']> = new Set([
  'notebook.update',
  'notebook.delete',
  'notebook.restore',
  'page.restore',
]);

/**
 * Handler für eine Operationsart registrieren (VERTRAEGE §16.2).
 *
 * Der Dispatcher (`sync/connection.ts`) prüft vorher das Schema und Duplikate (`findOpById`), ruft dann den
 * Handler und `appendOp` in **einer** Transaktion auf. Handler prüfen Duplikate nie selbst und rufen
 * `appendOp` nicht auf. Pro Art gibt es genau einen Handler, ein zweiter wirft.
 */
export function registerOpHandler(kind: SyncOp['kind'], handler: OpHandler): void {
  if (SERVER_ONLY_KINDS.has(kind)) {
    throw new Error(`${kind} ist eine Server-Operation und hat keinen Client-Handler`);
  }
  if (handlers.has(kind)) throw new Error(`Für ${kind} ist schon ein Handler registriert`);
  handlers.set(kind, handler);
}

/** Registrierter Handler oder `undefined` */
export function getOpHandler(kind: SyncOp['kind']): OpHandler | undefined {
  return handlers.get(kind);
}
