// Registry der Op-Handler (VERTRAEGE §16.2). Gerüst aus T1-DB; die Registry baut T1-08,
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

/** Handler für eine Operationsart registrieren. Füllt T1-08. */
export function registerOpHandler(_kind: SyncOp['kind'], _handler: OpHandler): void {
  throw new Error('nicht umgesetzt');
}
