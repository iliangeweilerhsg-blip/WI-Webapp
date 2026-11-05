// Sessions: Zustandsautomat F-SES-01, Sessions aus dem Kalender, Auto-Stopp-Rückfallebene, Abfragen (VERTRAEGE §7.2, §9, §16.2).
//
// Alle Zustandswechsel laufen durch `transitionSession`. Sie nimmt eine globale Advisory-Sperre pro Transaktion,
// damit zwei gleichzeitige Starts nacheinander laufen und die Invariante „höchstens eine aktive Session“
// (`session_one_active_uq`) nie über einen Unique-Fehler, sondern über die Regeln aus §9 durchgesetzt wird.
// Sperrreihenfolge: erst die Advisory-Sperre, dann Session-Zeilen, dann `sync_stream` (in `appendOp`).
import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import {
  SINGLE_USER_ID,
  type ClientDevice,
  type Marker,
  type Photo,
  type Recording,
  type Session,
  type SessionSnapshot,
  type SessionState,
  type SlideEvent,
  type StopReason,
  type SyncEvent,
  type SyncOrigin,
} from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db, DbOrTx, Tx } from '../db/client.ts';
import {
  audioChunk,
  calendarEvent,
  courseModule,
  marker,
  notDeleted,
  photo,
  job,
  recording,
  session,
  slideDeck,
  slideEvent,
  syncOp,
  syncStream,
} from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { decodeCursor, toPage, type Page } from '../lib/pagination.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import { appendOp } from '../sync/append.ts';
import { publishAfterCommit, publishEvent } from '../sync/events.ts';
import { autoStopBoundary, autoStopReason, type AutoStopLimits, type AutoStopSession } from './auto-stop.ts';
import { ensureFinalizeOnStop } from './recordings.ts';
import { getSettings } from './settings.ts';
import { softDelete } from './trash.ts';
import { softDeleteWithOps } from './trash-ops.ts';

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
  /** Uhr für Folgezeiten (Job-Verzögerung). Standard: Systemzeit. Tests und Takt reichen ihre Zeit durch */
  now?: Date;
}

type SessionRow = typeof session.$inferSelect;

/** Session-Zeile mit den Terminzeiten des Kalendertermins (abgeleitete Felder `planned_*`) */
interface Loaded {
  row: SessionRow;
  plannedStartsAt: Date | null;
  plannedEndsAt: Date | null;
}

const MINUTE_MS = 60_000;
/** `geplant` → `bereit` so lange vor dem geplanten Beginn (§9.1) */
const READY_BEFORE_START_MS = 15 * MINUTE_MS;

const NEVER_STARTED_STATES = ['geplant', 'bereit', 'verpasst'] as const;
const ACTIVE_STATES = ['laeuft', 'pausiert'] as const;
/** Gründe, die der Core selbst (Takt, Start einer späteren Session) oder ein Browser-Auto-Stopp setzt und die ein Gerät korrigieren darf */
const CORRECTABLE_REASONS: readonly StopReason[] = [
  'kalenderende',
  'maximaldauer',
  'absturz_wiederhergestellt',
];

// --- Ereignisse --------------------------------------------------------------------------------

export type EventPublisher = (tx: Tx, event: SyncEvent) => Promise<void>;

/**
 * Indirektion zu `publishAfterCommit` (T1-08). Tests ersetzen sie über `setSessionEventPublisher`,
 * solange der Sync-Server noch ein Gerüst ist.
 */
let publisher: EventPublisher = (tx, event) => publishAfterCommit(tx, event);

export function setSessionEventPublisher(next: EventPublisher | null): void {
  publisher = next ?? ((tx, event) => publishAfterCommit(tx, event));
}

// --- Abbildung auf die API -----------------------------------------------------------------------

/** ISO 8601 UTC mit `Z`, Millisekunden nur, wenn sie nicht 0 sind (VERTRAEGE §6) */
export function isoTs(date: Date): string {
  return date.toISOString().replace(/\.000Z$/, 'Z');
}

export function toApiSession(loaded: Loaded): Session {
  const { row } = loaded;
  return {
    id: row.id,
    user_id: row.userId,
    created_at: isoTs(row.createdAt),
    updated_at: isoTs(row.updatedAt),
    deleted_at: row.deletedAt ? isoTs(row.deletedAt) : null,
    calendar_event_id: row.calendarEventId,
    module_id: row.moduleId,
    slide_deck_id: row.slideDeckId,
    number: row.number,
    title: row.title,
    state: row.state as SessionState,
    started_at: row.startedAt ? isoTs(row.startedAt) : null,
    ended_at: row.endedAt ? isoTs(row.endedAt) : null,
    stop_reason: row.stopReason as StopReason | null,
    started_from: row.startedFrom as ClientDevice | null,
    processing: (row.processing ?? {}) as Session['processing'],
    review_state: row.reviewState as Session['review_state'],
    planned_starts_at: loaded.plannedStartsAt ? isoTs(loaded.plannedStartsAt) : null,
    planned_ends_at: loaded.plannedEndsAt ? isoTs(loaded.plannedEndsAt) : null,
    auto_stop_extended_until: row.autoStopExtendedUntil ? isoTs(row.autoStopExtendedUntil) : null,
    start_offsets: row.startOffsets,
  };
}

const sessionSelect = {
  row: session,
  plannedStartsAt: calendarEvent.startsAt,
  plannedEndsAt: calendarEvent.endsAt,
};

/** Session samt Terminzeiten. `lock`: Zeile der Session mit FOR UPDATE sperren. Auch gelöschte Sessions */
async function loadSession(tx: DbOrTx, id: string, lock = false): Promise<Loaded | null> {
  const query = tx
    .select(sessionSelect)
    .from(session)
    .leftJoin(calendarEvent, eq(calendarEvent.id, session.calendarEventId))
    .where(eq(session.id, id));
  const [found] = await (lock ? query.for('no key update', { of: session }) : query);
  return found ?? null;
}

/**
 * `updated_at` einer Session strikt monoton: Clients verwerfen ältere Fassungen über `updated_at`. Zwei Änderungen
 * innerhalb derselben Millisekunde (die API gibt Millisekunden aus) hätten sonst denselben Wert.
 */
const bumpedAt = (): SQL => sql`greatest(clock_timestamp(), ${session.updatedAt} + interval '1 millisecond')`;

const notFound = () => new HttpError(404, 'session_not_found', 'Die Session wurde nicht gefunden.');

/** Nicht gelöschte Session oder 404 (REST) */
export async function requireSession(tx: DbOrTx, id: string): Promise<Loaded> {
  const loaded = await loadSession(tx, id);
  if (!loaded || loaded.row.deletedAt) throw notFound();
  return loaded;
}

export async function getSession(db: DbOrTx, id: string): Promise<Session> {
  return toApiSession(await requireSession(db, id));
}

/** Kanal, auf dem der Worker Änderungen am Fortschritt meldet: `pg_notify('sg_session', <session_id>)` (§3) */
export const SESSION_NOTIFY_CHANNEL = 'sg_session';

/**
 * Meldung des Workers auf `sg_session`: `session.updated` mit dem aktuellen Stand an alle Clients (§11.6).
 * Nutzlast ungültig oder Session endgültig gelöscht: nichts senden.
 */
export async function notifySessionUpdated(db: Db, payload: string): Promise<void> {
  const id = payload.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return;
  const loaded = await loadSession(db, id);
  if (loaded) publishEvent({ type: 'event', name: 'session.updated', data: toApiSession(loaded) });
}

/** `session.updated` für den aktuellen Stand der Session (auch gelöscht) nach dem Commit senden */
async function emitUpdated(tx: Tx, id: string): Promise<void> {
  const loaded = await loadSession(tx, id);
  if (loaded) await publisher(tx, { type: 'event', name: 'session.updated', data: toApiSession(loaded) });
}

function transitionInvalid(state: string, action: SessionAction): HttpError {
  return new HttpError(
    409,
    'session_transition_invalid',
    'Dieser Zustandswechsel ist für die Session nicht erlaubt.',
    { state, action },
  );
}

/**
 * Sperrreihenfolge (VERTRAEGE §16.2): erst diese Advisory-Sperre, dann Session-Zeilen nur mit `FOR NO KEY UPDATE`
 * (Ops mit FK auf die Session, z. B. `marker.add`, halten `sync_stream` und brauchen `KEY SHARE`), dann `sync_stream`.
 * Der Dispatcher ruft sie als `preLock` VOR `appendOp` der Client-Operation auf (siehe `SESSION_PRELOCKS`).
 * Eine Transaktion lang die Zustandswechsel aller Sessions serialisieren (ein Nutzer, selten, kurz) */
export async function lockSessionTransitions(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('sg:session-transition', 0))`);
}

// --- Server-Operationen -----------------------------------------------------------------------

type SessionOpKind = 'session.start' | 'session.pause' | 'session.resume' | 'session.stop';

async function appendServerOp(
  tx: Tx,
  sessionId: string,
  kind: SessionOpKind,
  data: Record<string, unknown>,
  at: Date,
): Promise<void> {
  await appendOp(tx, `session:${sessionId}`, {
    kind,
    data: { session_id: sessionId, ...data },
    at: at.getTime(),
    clockUncertain: false,
    origin: 'server',
    deviceId: null,
  });
}

// --- Stopp -----------------------------------------------------------------------------------

/**
 * Session beenden: Server-Operation (`serverOp`), Jobs über `ensureFinalizeOnStop` (T1-06, je Aufnahme in ID-Reihenfolge),
 * Zeile aktualisieren, Ereignis senden. `ended_at` ist nie vor `started_at`.
 * Sperrreihenfolge (§16.2): Session-Zeile (`FOR NO KEY UPDATE`) → `sync_stream` → `lockRecording` → Job-Zeilen.
 * Zielzustand: `beendet`, solange danach ein Job der Session in `wartet`/`laeuft` ist, sonst gleich `verarbeitet`
 * (geprüft NACH den Aufrufen: ein Job, der kurz vorher fertig wurde, lässt die Session nicht auf `beendet` hängen).
 */
async function finishSession(
  tx: Tx,
  loaded: Loaded,
  endedAt: Date,
  reason: StopReason,
  serverOp: boolean,
  now: Date,
): Promise<void> {
  const { row } = loaded;
  const ended = row.startedAt && endedAt < row.startedAt ? row.startedAt : endedAt;
  if (serverOp) await appendServerOp(tx, row.id, 'session.stop', { reason }, ended);
  const recordings = await tx
    .select({ id: recording.id })
    .from(recording)
    .where(and(eq(recording.sessionId, row.id), notDeleted(recording)))
    .orderBy(asc(recording.id));
  for (const rec of recordings) await ensureFinalizeOnStop(tx, rec.id, now);
  const [pending] = await tx
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.sessionId, row.id), inArray(job.state, ['wartet', 'laeuft']), notDeleted(job)))
    .limit(1);
  await tx
    .update(session)
    .set({
      state: pending ? 'beendet' : 'verarbeitet',
      endedAt: ended,
      stopReason: reason,
      updatedAt: bumpedAt(),
    })
    .where(eq(session.id, row.id));
  await emitUpdated(tx, row.id);
}

// --- Foliensatz ------------------------------------------------------------------------------

/** Foliensatz existiert (nicht gelöscht) und gehört zum Modul. Sonst 404 bzw. 400 */
async function requireDeck(tx: DbOrTx, deckId: string, moduleId: string): Promise<void> {
  const [deck] = await tx
    .select({ moduleId: slideDeck.moduleId })
    .from(slideDeck)
    .where(and(eq(slideDeck.id, deckId), notDeleted(slideDeck)));
  if (!deck) throw new HttpError(404, 'slide_deck_not_found', 'Der Foliensatz wurde nicht gefunden.');
  if (deck.moduleId !== moduleId) {
    throw new HttpError(400, 'slide_deck_module_mismatch', 'Der Foliensatz gehört zu einem anderen Modul.');
  }
}

/** Foliensatz zeigt auf die Session, falls er noch an keiner hängt */
async function linkDeckToSession(tx: Tx, deckId: string, sessionId: string): Promise<void> {
  await tx
    .update(slideDeck)
    .set({ sessionId, updatedAt: sql`now()` })
    .where(and(eq(slideDeck.id, deckId), isNull(slideDeck.sessionId), notDeleted(slideDeck)));
}

/**
 * Folien-Upload mit `session_id` (VERTRAEGE §9.2): Hat die Session noch keinen Foliensatz, wird er gesetzt.
 * `slide_deck.session_id` setzt der Upload selbst bzw. dieser Aufruf, falls der Satz noch an keiner Session hängt.
 */
export async function attachDeckToSession(tx: Tx, sessionId: string, deckId: string): Promise<void> {
  await linkDeckToSession(tx, deckId, sessionId);
  const changed = await tx
    .update(session)
    .set({ slideDeckId: deckId, updatedAt: sql`now()` })
    .where(and(eq(session.id, sessionId), isNull(session.slideDeckId), notDeleted(session)))
    .returning({ id: session.id });
  if (changed.length > 0) await emitUpdated(tx, sessionId);
}

/** Wie `requireDeck`, aber ohne Fehler: unbekannte oder fremde Sätze aus dem Sync werden verworfen */
async function usableDeckId(
  tx: Tx,
  deckId: string | null | undefined,
  moduleId: string,
): Promise<string | null> {
  if (!deckId) return null;
  const [deck] = await tx
    .select({ moduleId: slideDeck.moduleId })
    .from(slideDeck)
    .where(and(eq(slideDeck.id, deckId), notDeleted(slideDeck)));
  return deck && deck.moduleId === moduleId ? deckId : null;
}

// --- Nummer (VL 7) -------------------------------------------------------------------------------

/** Position des Termins unter den nicht abgesagten Vorlesungsterminen seines Moduls, sonst `null` (§9.2) */
async function lectureNumber(
  tx: DbOrTx,
  event: { id: string; moduleId: string | null; kind: string; cancelled: boolean; startsAt: Date },
): Promise<number | null> {
  if (event.kind !== 'vorlesung' || event.cancelled || !event.moduleId) return null;
  const [row] = await tx.execute<{ n: string }>(
    sql`SELECT count(*)::text AS n FROM calendar_event e
        WHERE e.module_id = ${event.moduleId} AND e.kind = 'vorlesung' AND NOT e.cancelled
          AND e.deleted_at IS NULL
          AND (e.starts_at, e.id) < (${event.startsAt.toISOString()}::timestamptz, ${event.id}::uuid)`,
  );
  return Number(row?.n ?? 0) + 1;
}

// --- Offline angelegte Session (§9.2) -----------------------------------------------------------------

/**
 * `session.start` mit unbekannter ID: Session anlegen. Zum Termin gibt es schon eine nie gestartete Session →
 * die neue ersetzt sie. Eine laufende oder beendete → `session_superseded`.
 */
async function createOfflineSession(tx: Tx, sessionId: string, input: TransitionInput): Promise<void> {
  const moduleId = input.moduleId;
  if (!moduleId) throw notFound();
  const [mod] = await tx
    .select({ id: courseModule.id, deletedAt: courseModule.deletedAt })
    .from(courseModule)
    .where(eq(courseModule.id, moduleId));
  if (!mod) throw new HttpError(404, 'module_not_found', 'Das Modul wurde nicht gefunden.');

  let event: typeof calendarEvent.$inferSelect | undefined;
  if (input.calendarEventId && !mod.deletedAt) {
    // Gelöschtes Modul: Die Session bleibt ohne Termin, sonst scheitert die Wiederherstellung an `session_event_uq`
    // Ein Termin, den der Core nicht kennt, wird nicht verknüpft (FK): die Session ist dann spontan
    [event] = await tx.select().from(calendarEvent).where(eq(calendarEvent.id, input.calendarEventId));
  }

  let number: number | null = null;
  let slideDeckId = await usableDeckId(tx, input.slideDeckId, moduleId);
  let replaced: SessionRow | undefined;
  if (event) {
    [replaced] = await tx
      .select()
      .from(session)
      .where(and(eq(session.calendarEventId, event.id), notDeleted(session)))
      .for('no key update');
    if (replaced) {
      const neverStarted =
        replaced.startedAt === null && (NEVER_STARTED_STATES as readonly string[]).includes(replaced.state);
      if (!neverStarted) {
        throw new HttpError(
          409,
          'session_superseded',
          'Zu diesem Termin gibt es schon eine gestartete Session.',
          { session_id: replaced.id },
        );
      }
      // Ersetzen erst nach der Prüfung wie bei jedem Start: ein verpasster Termin braucht `started_at < Terminende`
      if (replaced.state === 'verpasst' && !(input.at < event.endsAt)) {
        throw transitionInvalid(replaced.state, 'start');
      }
      number = replaced.number;
      slideDeckId ??= replaced.slideDeckId;
      await softDelete(tx, 'session', replaced.id);
    } else {
      number = await lectureNumber(tx, event);
    }
  }

  await tx.insert(session).values({
    id: sessionId,
    userId: SINGLE_USER_ID,
    calendarEventId: event?.id ?? null,
    moduleId,
    slideDeckId,
    number,
    state: 'bereit',
    // Weich gelöschtes Modul: Die Session kommt mit ihm aus dem Papierkorb zurück (§11.2)
    deletedAt: mod.deletedAt,
  });
  if (replaced) {
    await tx
      .update(slideDeck)
      .set({ sessionId, updatedAt: sql`now()` })
      .where(and(eq(slideDeck.sessionId, replaced.id), notDeleted(slideDeck)));
    await emitUpdated(tx, replaced.id);
  }
  if (slideDeckId) await linkDeckToSession(tx, slideDeckId, sessionId);
}

// --- Zustandsübergänge ---------------------------------------------------------------------------

/** Abweichender Offline-Start: Eintrag in `start_offsets`, falls das Gerät noch keinen hat (§9.3). `true`: geändert */
async function recordStartOffset(tx: Tx, row: SessionRow, input: TransitionInput): Promise<boolean> {
  if (!input.deviceId || !row.startedAt) return false;
  const offsetMs = input.at.getTime() - row.startedAt.getTime();
  if (offsetMs === 0 || row.startOffsets.some((entry) => entry.device_id === input.deviceId)) return false;
  await tx
    .update(session)
    .set({
      startOffsets: [...row.startOffsets, { device_id: input.deviceId, offset_ms: offsetMs }],
      updatedAt: bumpedAt(),
    })
    .where(eq(session.id, row.id));
  return true;
}

async function startSession(
  tx: Tx,
  loaded: Loaded,
  input: TransitionInput,
): Promise<{ endedId: string | null }> {
  const { row } = loaded;
  const at = input.at;

  if (row.state === 'laeuft' || row.state === 'pausiert') {
    if (await recordStartOffset(tx, row, input)) await emitUpdated(tx, row.id);
    return { endedId: null };
  }
  if (row.state === 'beendet' || row.state === 'verarbeitet') {
    // Gerät startete offline: bestätigen, Offset merken. REST-Start auf eine beendete Session bleibt ungültig (§9.1)
    if (input.origin === 'server') throw transitionInvalid(row.state, 'start');
    if (await recordStartOffset(tx, row, input)) await emitUpdated(tx, row.id);
    return { endedId: null };
  }
  if (row.state === 'verpasst' && loaded.plannedEndsAt && !(at < loaded.plannedEndsAt)) {
    throw transitionInvalid(row.state, 'start');
  }

  let slideDeckId = row.slideDeckId;
  if (input.slideDeckId) {
    if (input.origin === 'server') await requireDeck(tx, input.slideDeckId, row.moduleId);
    slideDeckId = (await usableDeckId(tx, input.slideDeckId, row.moduleId)) ?? slideDeckId;
  }

  // Andere aktive Session? (Invariante 1)
  const [other] = await tx
    .select(sessionSelect)
    .from(session)
    .leftJoin(calendarEvent, eq(calendarEvent.id, session.calendarEventId))
    .where(and(inArray(session.state, [...ACTIVE_STATES]), notDeleted(session), ne(session.id, row.id)))
    .for('no key update', { of: session });

  const startFields = {
    startedAt: at,
    startedFrom: input.startedFrom ?? row.startedFrom,
    slideDeckId,
    updatedAt: bumpedAt(),
  };

  // Ein REST-Start ist immer „jetzt“; nur Geräte liefern Starts nach
  if (input.origin !== 'server' && other?.row.startedAt && other.row.startedAt > at) {
    // Nachgelieferter Start beendet nie eine später gestartete Session: starten und sofort wieder beenden (§9.2)
    // Der Zustand bleibt bis zum Ende unverändert: `laeuft` neben der aktiven Session verletzt `session_one_active_uq`
    await tx.update(session).set(startFields).where(eq(session.id, row.id));
    if (slideDeckId) await linkDeckToSession(tx, slideDeckId, row.id);
    const started = await loadSession(tx, row.id);
    if (!started) throw notFound();
    await finishSession(tx, started, other.row.startedAt, 'kalenderende', true, input.now ?? new Date());
    return { endedId: null };
  }

  let endedId: string | null = null;
  if (other) {
    // Früher gestartete aktive Session endet am Kalenderende, spätestens jetzt (§9.1)
    const planned = other.plannedEndsAt;
    const endedAt = planned && planned < at ? planned : at;
    await finishSession(tx, other, endedAt, 'kalenderende', true, input.now ?? new Date());
    endedId = other.row.id;
  }

  await tx
    .update(session)
    .set({ ...startFields, state: 'laeuft' })
    .where(eq(session.id, row.id));
  if (slideDeckId) await linkDeckToSession(tx, slideDeckId, row.id);
  if (input.origin === 'server') await appendStartOp(tx, row.id, row, input, slideDeckId);
  await emitUpdated(tx, row.id);
  return { endedId };
}

async function appendStartOp(
  tx: Tx,
  id: string,
  row: SessionRow,
  input: TransitionInput,
  slideDeckId: string | null,
): Promise<void> {
  await appendServerOp(
    tx,
    id,
    'session.start',
    {
      module_id: row.moduleId,
      calendar_event_id: row.calendarEventId,
      slide_deck_id: slideDeckId,
      started_from: input.startedFrom ?? row.startedFrom ?? 'mac',
      started_at: input.at.getTime(),
    },
    input.at,
  );
}

/**
 * Zustandsübergang nach §9.1. Schreibt die Server-Operationen selbst (`appendOp`):
 * - für den angefragten Übergang nur bei `origin = 'server'` (REST, Takt). Bei Operationen von Geräten legt der
 *   Dispatcher die Operation des Clients im Strom ab,
 * - für Folgeübergänge anderer Sessions (Start beendet die aktive) immer.
 * Gleicher Zielzustand liefert den Stand ohne Änderung. Eine weich gelöschte Session bleibt unverändert.
 * Sendet `session.updated` (nach dem Commit) für jede geänderte Session.
 *
 * Fehler (HttpError): 404 `session_not_found`, 404 `module_not_found` (Offline-Start), 409 `session_transition_invalid`
 * (`details: { state, action }`), 409 `session_superseded` (`details: { session_id }`).
 */
export async function transitionSession(
  tx: Tx,
  sessionId: string,
  action: SessionAction,
  input: TransitionInput,
): Promise<{ session: Session; endedSession: Session | null }> {
  await lockSessionTransitions(tx);
  let loaded = await loadSession(tx, sessionId, true);
  if (!loaded) {
    if (action !== 'start') throw notFound();
    await createOfflineSession(tx, sessionId, input);
    loaded = await loadSession(tx, sessionId, true);
    if (!loaded) throw notFound();
  }
  const { row } = loaded;
  const result = (endedId: string | null = null) => finalResult(tx, sessionId, endedId);

  // Weich gelöscht: bestätigen, nichts ändern (§9.2)
  if (row.deletedAt) return result();

  switch (action) {
    case 'start': {
      const { endedId } = await startSession(tx, loaded, input);
      return result(endedId);
    }
    case 'pause': {
      if (row.state === 'pausiert') return result();
      if (row.state !== 'laeuft') {
        if (lateAfterCoreStop(row, input)) return result();
        throw transitionInvalid(row.state, action);
      }
      await tx
        .update(session)
        .set({ state: 'pausiert', updatedAt: bumpedAt() })
        .where(eq(session.id, row.id));
      if (input.origin === 'server') await appendServerOp(tx, row.id, 'session.pause', {}, input.at);
      await emitUpdated(tx, row.id);
      return result();
    }
    case 'resume': {
      if (row.state === 'laeuft') return result();
      if (row.state !== 'pausiert') {
        if (lateAfterCoreStop(row, input)) return result();
        throw transitionInvalid(row.state, action);
      }
      await tx.update(session).set({ state: 'laeuft', updatedAt: bumpedAt() }).where(eq(session.id, row.id));
      if (input.origin === 'server') await appendServerOp(tx, row.id, 'session.resume', {}, input.at);
      await emitUpdated(tx, row.id);
      return result();
    }
    case 'stop': {
      const reason = input.reason ?? 'manuell';
      if (row.state === 'laeuft' || row.state === 'pausiert') {
        await finishSession(tx, loaded, input.at, reason, input.origin === 'server', input.now ?? new Date());
        return result();
      }
      if (row.state === 'beendet' || row.state === 'verarbeitet') {
        // Nachgelieferter Stopp eines Geräts mit früherem `at` korrigiert den Stopp durch den Core (§9.1)
        if (
          input.origin !== 'server' &&
          row.endedAt &&
          input.at < row.endedAt &&
          row.stopReason &&
          (CORRECTABLE_REASONS as readonly string[]).includes(row.stopReason)
        ) {
          const corrected = row.startedAt && input.at < row.startedAt ? row.startedAt : input.at;
          await tx
            .update(session)
            .set({ endedAt: corrected, stopReason: reason, updatedAt: bumpedAt() })
            .where(eq(session.id, row.id));
          await emitUpdated(tx, row.id);
        }
        return result();
      }
      throw transitionInvalid(row.state, action);
    }
  }
}

/** Nachgelieferte pause/resume eines Geräts (`at` vor dem Ende) auf eine vom Core beendete Session: nur bestätigen (§9.1) */
function lateAfterCoreStop(row: SessionRow, input: TransitionInput): boolean {
  return (
    input.origin !== 'server' &&
    (row.state === 'beendet' || row.state === 'verarbeitet') &&
    row.endedAt !== null &&
    input.at < row.endedAt &&
    row.stopReason !== null &&
    (CORRECTABLE_REASONS as readonly string[]).includes(row.stopReason)
  );
}

async function finalResult(
  tx: Tx,
  sessionId: string,
  endedId: string | null,
): Promise<{ session: Session; endedSession: Session | null }> {
  const current = await loadSession(tx, sessionId);
  if (!current) throw notFound();
  const ended = endedId ? await loadSession(tx, endedId) : null;
  return { session: toApiSession(current), endedSession: ended ? toApiSession(ended) : null };
}

// --- Auto-Stopp (§9.4) ----------------------------------------------------------------------------

export { autoStopBoundary, type AutoStopLimits } from './auto-stop.ts';

/**
 * Greift Auto-Stopp-Regel 2 (Kalenderende + Hardlimit) oder 4 (Maximaldauer)? `at` ist die Grenze `G`
 * (`autoStopBoundary`, bei Verlängerung `auto_stop_extended_until`, falls später). Vor `G` stoppt keine Regel.
 * Sind beide Regeln fällig, gilt die zuerst erreichte; bei Gleichstand das Kalenderende.
 */
export function autoStopDecision(
  s: AutoStopSession,
  limits: AutoStopLimits,
  now: Date,
): { at: Date; reason: 'kalenderende' | 'maximaldauer' } | null {
  const at = autoStopBoundary(s, limits);
  return at <= now ? { at, reason: autoStopReason(s, limits) } : null;
}

/** Letzte Aktivität einer Session: Ende des letzten Chunks oder `at` der letzten Operation, mindestens `started_at` */
async function lastActivity(tx: Tx, row: SessionRow, now: Date): Promise<Date> {
  const startedAt = row.startedAt ?? now;
  const [chunk] = await tx
    .select({ endMs: sql<string | null>`max(${audioChunk.startMs} + ${audioChunk.durationMs})` })
    .from(audioChunk)
    .innerJoin(recording, eq(recording.id, audioChunk.recordingId))
    .where(eq(recording.sessionId, row.id));
  const [op] = await tx
    .select({ at: sql<string | null>`max(${syncOp.at})` })
    .from(syncOp)
    .where(eq(syncOp.stream, `session:${row.id}`));
  const times = [startedAt.getTime()];
  if (chunk?.endMs != null) times.push(startedAt.getTime() + Number(chunk.endMs));
  if (op?.at != null) times.push(Number(op.at));
  return new Date(Math.min(Math.max(...times), now.getTime()));
}

export interface SessionTickOptions {
  /** Core-Start: überschrittene Grenzen gelten als „Core lief nicht“ → `absturz_wiederhergestellt` */
  startup?: boolean;
}

/**
 * Ein Takt des Core (jede Minute und beim Start, §9.1): `geplant` → `bereit` → `verpasst` und die
 * Auto-Stopp-Rückfallebene (Regeln 2 und 4). Alles in einer Transaktion.
 */
export async function runSessionTick(
  db: Db,
  config: Pick<Config, 'dataDir'>,
  now: Date,
  options: SessionTickOptions = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockSessionTransitions(tx);

    // 1. Nie gestartete Sessions mit Termin
    const planned = await tx
      .select(sessionSelect)
      .from(session)
      .innerJoin(calendarEvent, eq(calendarEvent.id, session.calendarEventId))
      .where(
        and(inArray(session.state, ['geplant', 'bereit']), isNull(session.startedAt), notDeleted(session)),
      )
      .orderBy(asc(session.id))
      .for('no key update', { of: session });
    for (const p of planned) {
      const next = plannedState(now, p.plannedStartsAt, p.plannedEndsAt);
      if (next !== p.row.state) {
        await tx.update(session).set({ state: next, updatedAt: bumpedAt() }).where(eq(session.id, p.row.id));
        await emitUpdated(tx, p.row.id);
      }
    }

    // 2. Auto-Stopp-Rückfallebene
    const active = await tx
      .select(sessionSelect)
      .from(session)
      .leftJoin(calendarEvent, eq(calendarEvent.id, session.calendarEventId))
      .where(and(inArray(session.state, [...ACTIVE_STATES]), notDeleted(session)))
      .orderBy(asc(session.id))
      .for('no key update', { of: session });
    if (active.length === 0) return;
    const { lecture } = await getSettings(tx, config);
    for (const a of active) {
      if (!a.row.startedAt) continue;
      const decision = autoStopDecision(
        {
          startedAt: a.row.startedAt,
          plannedEndsAt: a.plannedEndsAt,
          extendedUntil: a.row.autoStopExtendedUntil,
        },
        {
          hardAfterEndMin: lecture.auto_stop_hard_after_end_min,
          maxDurationMin: lecture.auto_stop_max_duration_min,
        },
        now,
      );
      if (!decision) continue;
      if (options.startup) {
        await transitionSession(tx, a.row.id, 'stop', {
          at: await lastActivity(tx, a.row, now),
          origin: 'server',
          reason: 'absturz_wiederhergestellt',
          now,
        });
      } else {
        await transitionSession(tx, a.row.id, 'stop', {
          at: decision.at,
          origin: 'server',
          reason: decision.reason,
          now,
        });
      }
    }
  });
}

export interface SessionTicker {
  /** Takt sofort ausführen (wartet auf einen laufenden) */
  runOnce: (options?: SessionTickOptions) => Promise<void>;
  stop: () => Promise<void>;
}

export interface SessionTickerOptions {
  db: Db;
  config: Pick<Config, 'dataDir'>;
  onError: (error: unknown) => void;
  intervalMs?: number;
  now?: () => Date;
}

/** Startet den Core-Takt: sofort einmal mit `startup`, danach jede Minute. Fehler brechen den Takt nicht ab */
export function startSessionTicker(options: SessionTickerOptions): SessionTicker {
  const now = options.now ?? (() => new Date());
  let running: Promise<void> = Promise.resolve();
  const runOnce = (tickOptions: SessionTickOptions = {}): Promise<void> => {
    running = running
      .then(() => runSessionTick(options.db, options.config, now(), tickOptions))
      .catch(options.onError);
    return running;
  };
  void runOnce({ startup: true });
  const timer = setInterval(() => void runOnce(), options.intervalMs ?? MINUTE_MS);
  timer.unref();
  return {
    runOnce,
    stop: async () => {
      clearInterval(timer);
      await running;
    },
  };
}

/** Zielzustand einer nie gestarteten Session mit Termin zum Zeitpunkt `now` (§9.1) */
export function plannedState(
  now: Date,
  plannedStartsAt: Date | null,
  plannedEndsAt: Date | null,
): 'geplant' | 'bereit' | 'verpasst' {
  if (plannedEndsAt && now >= plannedEndsAt) return 'verpasst';
  if (plannedStartsAt && now.getTime() >= plannedStartsAt.getTime() - READY_BEFORE_START_MS) return 'bereit';
  return 'geplant';
}

// --- Verlängern (§9.4) ------------------------------------------------------------------------------

/**
 * `POST /sessions/{id}/extend`: `auto_stop_extended_until = max(now, bisheriger Wert) + minutes`.
 * 404 `session_not_found`, 409 `session_not_active` (nicht `laeuft` oder `pausiert`).
 */
export async function extendSession(
  tx: Tx,
  sessionId: string,
  minutes: number | undefined,
  config: Pick<Config, 'dataDir'>,
  now: Date,
): Promise<Session> {
  await lockSessionTransitions(tx);
  const loaded = await loadSession(tx, sessionId, true);
  if (!loaded || loaded.row.deletedAt) throw notFound();
  if (loaded.row.state !== 'laeuft' && loaded.row.state !== 'pausiert') {
    throw new HttpError(409, 'session_not_active', 'Die Session läuft nicht.', { state: loaded.row.state });
  }
  const add = minutes ?? (await getSettings(tx, config)).lecture.auto_stop_extend_min;
  const previous = loaded.row.autoStopExtendedUntil;
  const base = previous && previous > now ? previous : now;
  await tx
    .update(session)
    .set({ autoStopExtendedUntil: new Date(base.getTime() + add * MINUTE_MS), updatedAt: bumpedAt() })
    .where(eq(session.id, sessionId));
  await emitUpdated(tx, sessionId);
  return toApiSession((await loadSession(tx, sessionId)) as Loaded);
}

// --- Sessions aus dem Kalender (§9.2) -----------------------------------------------------------------

const SESSION_EVENT_KINDS = ['vorlesung', 'uebung', 'tutorium'];

/**
 * Sessions zu Kalenderterminen anlegen, löschen und nachführen (`module_id`, VL-Nummer, §9.2). Aufruf aus T1-01
 * nach dem Abgleich und wenn ein Termin ein Modul bekommt. Idempotent über `UNIQUE (calendar_event_id)`.
 * - Nicht abgesagter Termin der Art `vorlesung`/`uebung`/`tutorium` mit Modul: Session anlegen (`geplant`, `bereit`
 *   oder `verpasst` je nach Zeit). Eine nie gestartete folgt dem Modul und dem Termin.
 * - Abgesagt, ohne Modul, andere Art oder gelöscht: nie gestartete Session weich löschen. Gestartete bleiben.
 * - `number` wird für nie gestartete Sessions der betroffenen Module neu berechnet.
 * Sendet `session.updated` für jede angelegte, geänderte oder gelöschte Session (nach dem Commit).
 */
export async function ensurePlannedSessions(
  tx: Tx,
  eventIds: string[],
  now: Date = new Date(),
): Promise<void> {
  const ids = [...new Set(eventIds)];
  if (ids.length === 0) return;
  const modules = new Set<string>();
  const touched = new Set<string>();

  const events = await tx.select().from(calendarEvent).where(inArray(calendarEvent.id, ids));
  const sessions = await tx
    .select()
    .from(session)
    .where(and(inArray(session.calendarEventId, ids), notDeleted(session)))
    .orderBy(asc(session.id))
    .for('no key update');
  const byEvent = new Map(sessions.map((s) => [s.calendarEventId, s]));

  for (const event of events) {
    const existing = byEvent.get(event.id);
    const moduleId = event.moduleId;
    let moduleAlive = false;
    if (moduleId) {
      const [mod] = await tx
        .select({ id: courseModule.id })
        .from(courseModule)
        .where(and(eq(courseModule.id, moduleId), notDeleted(courseModule)));
      moduleAlive = Boolean(mod);
    }
    const qualifies =
      !event.deletedAt && !event.cancelled && SESSION_EVENT_KINDS.includes(event.kind) && moduleAlive;

    if (existing && existing.moduleId) modules.add(existing.moduleId);
    if (moduleId) modules.add(moduleId);

    const neverStarted = (s: SessionRow) =>
      s.startedAt === null && (NEVER_STARTED_STATES as readonly string[]).includes(s.state);

    // Gestartete Session: Der Termin kann verschoben worden sein (`planned_*` stammen aus dem Termin). Clients
    // verwerfen ältere Fassungen über `updated_at`, darum wird es mit angehoben und `session.updated` gesendet
    if (existing && !neverStarted(existing)) {
      await tx.update(session).set({ updatedAt: bumpedAt() }).where(eq(session.id, existing.id));
      touched.add(existing.id);
    }

    if (!qualifies) {
      if (existing && neverStarted(existing)) {
        await softDelete(tx, 'session', existing.id);
        touched.add(existing.id);
      }
      continue;
    }
    const state = plannedState(now, event.startsAt, event.endsAt);
    if (!existing) {
      const newId = uuidv7();
      const inserted = await tx
        .insert(session)
        .values({
          id: newId,
          userId: SINGLE_USER_ID,
          calendarEventId: event.id,
          moduleId: event.moduleId as string,
          state,
        })
        .onConflictDoNothing()
        .returning({ id: session.id });
      if (inserted.length > 0) touched.add(newId);
    } else if (neverStarted(existing) && (existing.moduleId !== event.moduleId || existing.state !== state)) {
      await tx
        .update(session)
        .set({ moduleId: event.moduleId as string, state, updatedAt: bumpedAt() })
        .where(eq(session.id, existing.id));
      touched.add(existing.id);
    }
  }

  // VL-Nummern der betroffenen Module neu rechnen, nur für nie gestartete Sessions
  for (const moduleId of modules) {
    const renumbered = await tx.execute<{ id: string }>(sql`
      WITH ranked AS (
        SELECT id, row_number() OVER (ORDER BY starts_at, id)::int AS n FROM calendar_event
        WHERE module_id = ${moduleId} AND kind = 'vorlesung' AND NOT cancelled AND deleted_at IS NULL
      )
      UPDATE session s SET number = r.n, updated_at = greatest(clock_timestamp(), s.updated_at + interval '1 millisecond') FROM ranked r
      WHERE s.calendar_event_id = r.id AND s.deleted_at IS NULL AND s.started_at IS NULL
        AND s.state IN ('geplant','bereit','verpasst') AND s.number IS DISTINCT FROM r.n
      RETURNING s.id`);
    for (const r of renumbered) touched.add(r.id);
    const cleared = await tx.execute<{ id: string }>(sql`
      UPDATE session s SET number = NULL, updated_at = greatest(clock_timestamp(), s.updated_at + interval '1 millisecond') FROM calendar_event e
      WHERE s.calendar_event_id = e.id AND s.module_id = ${moduleId} AND s.deleted_at IS NULL
        AND s.started_at IS NULL AND s.state IN ('geplant','bereit','verpasst') AND s.number IS NOT NULL
        AND (e.kind <> 'vorlesung' OR e.cancelled OR e.deleted_at IS NOT NULL)
      RETURNING s.id`);
    for (const r of cleared) touched.add(r.id);
  }
  for (const id of touched) await emitUpdated(tx, id);
}

// --- REST: Abfragen und Pflege -------------------------------------------------------------------------

export interface ListSessionsOptions {
  moduleId?: string | undefined;
  states?: SessionState[] | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  cursor?: string | undefined;
  limit: number;
}

/** Sortierzeitpunkt der Liste: `coalesce(started_at, planned_starts_at, created_at)` (§7.2) */
const sortKey = sql`coalesce(${session.startedAt}, ${calendarEvent.startsAt}, ${session.createdAt})`;

export async function listSessions(db: DbOrTx, options: ListSessionsOptions): Promise<Page<Session>> {
  const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;
  const conditions: (SQL | undefined)[] = [
    notDeleted(session),
    options.moduleId ? eq(session.moduleId, options.moduleId) : undefined,
    options.states?.length ? inArray(session.state, options.states) : undefined,
    options.from ? sql`${sortKey} >= ${options.from.toISOString()}::timestamptz` : undefined,
    options.to ? sql`${sortKey} < ${options.to.toISOString()}::timestamptz` : undefined,
    cursor ? sql`(${sortKey}, ${session.id}) > (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : undefined,
  ];
  const rows = await db
    .select({ ...sessionSelect, ts: sql<string>`${sortKey}::text` })
    .from(session)
    .leftJoin(calendarEvent, eq(calendarEvent.id, session.calendarEventId))
    .where(and(...conditions))
    .orderBy(asc(sortKey), asc(session.id))
    .limit(options.limit + 1);
  return toPage(
    rows,
    options.limit,
    (r) => ({ ts: r.ts, id: r.row.id }),
    (r) => toApiSession(r),
  );
}

export interface SessionCreateInput {
  id?: string | undefined;
  moduleId: string;
  slideDeckId?: string | null | undefined;
  title?: string | null | undefined;
}

/** `POST /sessions`: spontane Session im Zustand `bereit` (F-SES-04). 404 `module_not_found`, 409 `session_exists` */
export async function createSession(tx: Tx, input: SessionCreateInput): Promise<Session> {
  const [mod] = await tx
    .select({ id: courseModule.id })
    .from(courseModule)
    .where(and(eq(courseModule.id, input.moduleId), notDeleted(courseModule)));
  if (!mod) throw new HttpError(404, 'module_not_found', 'Das Modul wurde nicht gefunden.');
  const id = input.id ?? uuidv7();
  const [exists] = await tx.select({ id: session.id }).from(session).where(eq(session.id, id));
  if (exists) throw new HttpError(409, 'session_exists', 'Die Session gibt es schon.', { id });
  if (input.slideDeckId) await requireDeck(tx, input.slideDeckId, input.moduleId);
  await tx.insert(session).values({
    id,
    userId: SINGLE_USER_ID,
    moduleId: input.moduleId,
    slideDeckId: input.slideDeckId ?? null,
    title: input.title ?? null,
    state: 'bereit',
  });
  if (input.slideDeckId) await linkDeckToSession(tx, input.slideDeckId, id);
  await emitUpdated(tx, id);
  return toApiSession((await loadSession(tx, id)) as Loaded);
}

/** `PATCH /sessions/{id}`: Titel und Foliensatz */
export async function updateSession(
  tx: Tx,
  id: string,
  patch: { title?: string | null | undefined; slide_deck_id?: string | null | undefined },
): Promise<Session> {
  const loaded = await requireSession(tx, id);
  const set: Partial<typeof session.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.slide_deck_id !== undefined) {
    if (patch.slide_deck_id) await requireDeck(tx, patch.slide_deck_id, loaded.row.moduleId);
    set.slideDeckId = patch.slide_deck_id;
  }
  if (Object.keys(set).length > 0) {
    await tx
      .update(session)
      .set({ ...set, updatedAt: bumpedAt() })
      .where(eq(session.id, id));
    if (set.slideDeckId) await linkDeckToSession(tx, set.slideDeckId, id);
    await emitUpdated(tx, id);
  }
  return toApiSession((await loadSession(tx, id)) as Loaded);
}

/**
 * `DELETE /sessions/{id}`: Papierkorb mit Kaskade über `softDeleteWithOps` (§16.2). Zuerst `lockSessionTransitions`,
 * dann der Strom, dann die Zeilen. 404, 409 `session_active` kommen aus `softDelete`.
 */
export async function deleteSession(db: Db, id: string): Promise<void> {
  await softDeleteWithOps(db, 'session', id, lockSessionTransitions);
  await db.transaction((tx) => emitUpdated(tx, id));
}

// --- Snapshot (§7.2, §11.1) ---------------------------------------------------------------------------------

const byTime = <T extends { t_ms: number; created_at: string; id: string }>(a: T, b: T): number =>
  a.t_ms - b.t_ms || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/**
 * `GET /sessions/{id}/snapshot`: Live-Stand ohne gelöschte Objekte, nach `t_ms` sortiert, samt `stream_seq` und
 * `stream_op_id`. Alles in EINER Transaktion mit `REPEATABLE READ`, damit Daten und Strom zusammenpassen (§11.1).
 */
export async function getSessionSnapshot(db: Db, id: string): Promise<SessionSnapshot> {
  return db.transaction(
    async (tx) => {
      const loaded = await requireSession(tx, id);
      const events = await tx
        .select()
        .from(slideEvent)
        .where(and(eq(slideEvent.sessionId, id), notDeleted(slideEvent)));
      const markers = await tx
        .select()
        .from(marker)
        .where(and(eq(marker.sessionId, id), notDeleted(marker)));
      const photos = await tx
        .select()
        .from(photo)
        .where(and(eq(photo.sessionId, id), notDeleted(photo)));
      const recordings = await tx
        .select({
          row: recording,
          chunkCount: sql<number>`(SELECT count(*)::int FROM audio_chunk c WHERE c.recording_id = ${recording.id} AND c.deleted_at IS NULL)`,
          lastSeq: sql<
            number | null
          >`(SELECT max(c.seq)::int FROM audio_chunk c WHERE c.recording_id = ${recording.id} AND c.deleted_at IS NULL)`,
        })
        .from(recording)
        .where(and(eq(recording.sessionId, id), notDeleted(recording)))
        .orderBy(asc(recording.createdAt), asc(recording.id));

      const stream = `session:${id}`;
      const [head] = await tx
        .select({ headSeq: syncStream.headSeq })
        .from(syncStream)
        .where(eq(syncStream.stream, stream));
      const streamSeq = head?.headSeq ?? 0;
      let streamOpId: string | null = null;
      if (streamSeq > 0) {
        const [op] = await tx
          .select({ opId: syncOp.opId })
          .from(syncOp)
          .where(and(eq(syncOp.stream, stream), eq(syncOp.seq, streamSeq)));
        streamOpId = op?.opId ?? null;
      }

      const base = (r: {
        id: string;
        userId: string;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
      }) => ({
        id: r.id,
        user_id: r.userId,
        created_at: isoTs(r.createdAt),
        updated_at: isoTs(r.updatedAt),
        deleted_at: r.deletedAt ? isoTs(r.deletedAt) : null,
      });
      return {
        session: toApiSession(loaded),
        slide_events: events
          .map((r): SlideEvent => ({
            ...base(r),
            session_id: r.sessionId,
            slide_id: r.slideId,
            slide_index: r.slideIndex,
            t_ms: r.tMs,
            device: r.device as SlideEvent['device'],
            source: r.source as SlideEvent['source'],
          }))
          .sort(byTime),
        markers: markers
          .map((r): Marker => ({
            ...base(r),
            session_id: r.sessionId,
            kind: r.kind as Marker['kind'],
            t_ms: r.tMs,
            page_id: r.pageId,
            position: r.position,
            source: r.source as Marker['source'],
            note: r.note,
            resolved_at: r.resolvedAt ? isoTs(r.resolvedAt) : null,
          }))
          .sort(byTime),
        photos: photos
          .map((r): Photo => ({
            ...base(r),
            session_id: r.sessionId,
            t_ms: r.tMs,
            page_id: r.pageId,
            mime: r.mime as Photo['mime'],
            sha256: r.sha256,
            size_bytes: r.sizeBytes,
            has_file: r.filePath !== null,
            ocr_text: r.ocrText,
          }))
          .sort(byTime),
        recordings: recordings.map(({ row: r, chunkCount, lastSeq }): Recording => ({
          ...base(r),
          session_id: r.sessionId,
          mime: r.mime,
          codec: r.codec as Recording['codec'],
          started_ms: r.startedMs,
          duration_ms: r.durationMs,
          state: r.state as Recording['state'],
          chunks_independent: r.chunksIndependent,
          chunk_count: chunkCount,
          last_seq: lastSeq,
          completed_at: r.completedAt ? isoTs(r.completedAt) : null,
        })),
        stream_seq: streamSeq,
        stream_op_id: streamOpId,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
