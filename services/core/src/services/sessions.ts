// Sessions: Zustandsautomat und Sessions aus dem Kalender (VERTRAEGE §9, §16.2). Gerüst aus T1-DB, füllt T1-02.
import type { ClientDevice, Session, StopReason, SyncOrigin } from '@sg/shared';
import type { Tx } from '../db/client.ts';

export type SessionAction = 'start' | 'pause' | 'resume' | 'stop';

export interface TransitionInput {
  at: Date;
  origin: SyncOrigin;
  deviceId?: string | null;
  startedFrom?: ClientDevice;
  reason?: StopReason;
  moduleId?: string;
  calendarEventId?: string | null;
  slideDeckId?: string | null;
}

/** Zustandsübergang nach §9.1. Schreibt die Server-Operationen selbst (`appendOp`) */
export async function transitionSession(
  _tx: Tx,
  _sessionId: string,
  _action: SessionAction,
  _input: TransitionInput,
): Promise<{ session: Session; endedSession: Session | null }> {
  throw new Error('nicht umgesetzt');
}

/** Sessions zu Kalenderterminen anlegen, löschen und nachführen (`module_id`, VL-Nummer, §9.2). Aufruf aus T1-01 */
export async function ensurePlannedSessions(_tx: Tx, _eventIds: string[]): Promise<void> {
  throw new Error('nicht umgesetzt');
}
