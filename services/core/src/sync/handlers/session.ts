// Op-Handler für Sessions, Folienwechsel und Marker (VERTRAEGE §9, §11.3). Den Eintrag in die Registry macht der Lead
// nach T1-08 über `registerSessionHandlers()`.
//
// Die Handler laufen in der Transaktion des Dispatchers (`handler(tx, op, ctx)`). Doppelte `op_id` fängt der Dispatcher
// zentral ab. Die Operation des Clients selbst legt der Dispatcher im Strom ab; Folgeübergänge (z. B. die automatisch
// beendete Session) schreibt `transitionSession` als Server-Operationen.
import { eq } from 'drizzle-orm';
import { SINGLE_USER_ID, type SyncOp } from '@sg/shared';
import type { Tx } from '../../db/client.ts';
import { marker, session, slideEvent } from '../../db/schema/index.ts';
import { HttpError } from '../../errors.ts';
import {
  lockSessionTransitions,
  transitionSession,
  type SessionAction,
  type TransitionInput,
} from '../../services/sessions.ts';
import { softDelete } from '../../services/trash.ts';
import { registerOpHandler, SyncOpError, type OpHandler } from '../handlers.ts';

/** Fachliche Fehler des Services als Sync-Fehler (nicht wiederholbar, §11.2) */
function toSyncError(error: unknown): unknown {
  if (error instanceof HttpError) {
    switch (error.code) {
      case 'session_not_found':
      case 'module_not_found':
      case 'session_transition_invalid':
      case 'session_superseded':
        return new SyncOpError(error.code, false, error.details);
    }
  }
  return error;
}

/** Strom der Operation muss `session:<session_id>` sein (§11.2) */
function requireStream(op: SyncOp, sessionId: string): void {
  if (op.stream !== `session:${sessionId}`) {
    throw new SyncOpError('stream_mismatch', false, { stream: op.stream, session_id: sessionId });
  }
}

/** Die Session, zu der Session-Daten gehören. Weich gelöscht: Daten kommen mit ihr zurück (§11.2) */
async function parentSession(tx: Tx, sessionId: string): Promise<{ deletedAt: Date | null }> {
  const [parent] = await tx
    .select({ deletedAt: session.deletedAt })
    .from(session)
    .where(eq(session.id, sessionId));
  if (!parent) throw new SyncOpError('session_not_found', false, { session_id: sessionId });
  return parent;
}

async function transition(
  tx: Tx,
  action: SessionAction,
  sessionId: string,
  input: TransitionInput,
): Promise<void> {
  try {
    await transitionSession(tx, sessionId, action, input);
  } catch (error) {
    throw toSyncError(error);
  }
}

/** `started_at` kommt aus den Daten, nicht aus der Serverzeit (§11.3) */
const sessionStart: OpHandler = async (tx, op, ctx) => {
  if (op.kind !== 'session.start') return;
  const { data } = op;
  requireStream(op, data.session_id);
  await transition(tx, 'start', data.session_id, {
    at: new Date(data.started_at),
    origin: ctx.origin,
    deviceId: ctx.deviceId,
    startedFrom: data.started_from,
    moduleId: data.module_id,
    calendarEventId: data.calendar_event_id,
    slideDeckId: data.slide_deck_id,
  });
};

function simpleTransition(kind: 'session.pause' | 'session.resume', action: SessionAction): OpHandler {
  return async (tx, op, ctx) => {
    if (op.kind !== kind) return;
    requireStream(op, op.data.session_id);
    await transition(tx, action, op.data.session_id, {
      at: new Date(op.at),
      origin: ctx.origin,
      deviceId: ctx.deviceId,
    });
  };
}

/** `ended_at = at` der Operation, nicht die Serverzeit (§11.3) */
const sessionStop: OpHandler = async (tx, op, ctx) => {
  if (op.kind !== 'session.stop') return;
  requireStream(op, op.data.session_id);
  await transition(tx, 'stop', op.data.session_id, {
    at: new Date(op.at),
    origin: ctx.origin,
    deviceId: ctx.deviceId,
    ...(op.data.reason ? { reason: op.data.reason } : {}),
  });
};

/** Folienwechsel: in jedem Zustand der Session angenommen, idempotent über `event_id` */
const slideChange: OpHandler = async (tx, op) => {
  if (op.kind !== 'slide.change') return;
  const { data } = op;
  requireStream(op, data.session_id);
  const parent = await parentSession(tx, data.session_id);
  await tx
    .insert(slideEvent)
    .values({
      id: data.event_id,
      userId: SINGLE_USER_ID,
      sessionId: data.session_id,
      slideId: data.slide_id,
      slideIndex: data.slide_index,
      tMs: data.t_ms,
      device: data.device,
      source: data.device === 'mac' ? 'manuell_mac' : 'manuell_ipad',
      deletedAt: parent.deletedAt,
    })
    .onConflictDoNothing();
};

/** Marker: in jedem Zustand der Session angenommen, idempotent über `marker_id` */
const markerAdd: OpHandler = async (tx, op) => {
  if (op.kind !== 'marker.add') return;
  const { data } = op;
  requireStream(op, data.session_id);
  const parent = await parentSession(tx, data.session_id);
  await tx
    .insert(marker)
    .values({
      id: data.marker_id,
      userId: SINGLE_USER_ID,
      sessionId: data.session_id,
      kind: data.kind,
      tMs: data.t_ms,
      pageId: data.page_id,
      position: data.position,
      source: data.source,
      note: data.note,
      deletedAt: parent.deletedAt,
    })
    .onConflictDoNothing();
};

/** Marker entfernen (weich, über `softDelete`). Unbekannt oder schon entfernt: bestätigen */
const markerRemove: OpHandler = async (tx, op) => {
  if (op.kind !== 'marker.remove') return;
  const [found] = await tx
    .select({ sessionId: marker.sessionId })
    .from(marker)
    .where(eq(marker.id, op.data.marker_id));
  if (!found) return;
  requireStream(op, found.sessionId);
  try {
    await softDelete(tx, 'marker', op.data.marker_id);
  } catch (error) {
    if (error instanceof HttpError && error.code === 'marker_not_found') return;
    throw error;
  }
};

export const SESSION_HANDLERS: Readonly<Record<string, OpHandler>> = {
  'session.start': sessionStart,
  'session.pause': simpleTransition('session.pause', 'pause'),
  'session.resume': simpleTransition('session.resume', 'resume'),
  'session.stop': sessionStop,
  'slide.change': slideChange,
  'marker.add': markerAdd,
  'marker.remove': markerRemove,
};

/**
 * `preLock` je Operationsart (VERTRAEGE §16.2, Sperrreihenfolge): Der Dispatcher ruft `preLock(tx, op)` VOR `appendOp`
 * der Client-Operation auf. So sperrt er die Zustandswechsel-Sperre vor `sync_stream`, wie `transitionSession`,
 * und ein gleichzeitiger REST-Stopp ergibt keinen Deadlock (40P01).
 */
export const SESSION_PRELOCKS: Readonly<Record<string, (tx: Tx, op: SyncOp) => Promise<void>>> = {
  'session.start': (tx) => lockSessionTransitions(tx),
  'session.pause': (tx) => lockSessionTransitions(tx),
  'session.resume': (tx) => lockSessionTransitions(tx),
  'session.stop': (tx) => lockSessionTransitions(tx),
};

/** Meldet die Handler dieses Tickets in der Registry an (T1-08) */
export function registerSessionHandlers(): void {
  for (const [kind, handler] of Object.entries(SESSION_HANDLERS)) {
    // TODO(T1-08-Rebase): registerOpHandler(kind, handler, { preLock: SESSION_PRELOCKS[kind] }) aufrufen, sobald die
    // Registry von T1-08 den dritten Parameter kennt. Bis dahin hängt der Lead SESSION_PRELOCKS im Dispatcher ein.
    registerOpHandler(kind as SyncOp['kind'], handler);
  }
}
