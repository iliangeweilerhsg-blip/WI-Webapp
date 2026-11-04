// Kalender: Quellen, Termine, ICS-Import und Abgleich (VERTRAEGE §7.1, §8, F-KAL-01/02).
//
// Der Abgleich läuft synchron im Core, nicht als Job. Ablauf:
// 1. ICS holen (URL) bzw. aus dem Upload lesen und auflösen (`calendar-ics.ts`, ohne Datenbank)
// 2. In einer Transaktion mit Sperre je Quelle: neu / geändert / entfallen bestimmen, per Upsert schreiben,
//    `ensurePlannedSessions` aufrufen
import { and, asc, eq, gt, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  SINGLE_USER_ID,
  type CalendarAssignment,
  type CalendarEvent,
  type CalendarEventKind,
  type CalendarEventUpdate,
  type CalendarSource,
  type IcsEventRef,
  type IcsImportResult,
  type IcsModuleSuggestion,
} from '@sg/shared';
import type { Db, DbOrTx, Tx } from '../db/client.ts';
import { calendarEvent, calendarSource, courseModule, semester, session } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { afterCursor, cursorTs, decodeCursor, keysetOrder, toPage, type Page } from '../lib/pagination.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import {
  detectKind,
  matchModule,
  suggestionKey,
  suggestModuleName,
  type ModuleCandidate,
} from './calendar-assign.ts';
import { fetchIcs, IcsFetchError, InvalidIcsUrlError, normalizeIcsUrl } from './calendar-fetch.ts';
import { IcsParseError, parseIcs, type ParsedEvent, type ParseResult } from './calendar-ics.ts';
import { ensurePlannedSessions as ensureSessionsImpl } from './sessions.ts';
import { softDelete } from './trash.ts';

type SourceRow = typeof calendarSource.$inferSelect;
type EventRow = typeof calendarEvent.$inferSelect;

// ---------------------------------------------------------------------------------------------
// Indirektionen (im Test ersetzbar)
// ---------------------------------------------------------------------------------------------

export interface CalendarHooks {
  /** Sessions zu Terminen nachführen. Gerüst in `sessions.ts`, gefüllt von T1-02 (VERTRAEGE §16.2). */
  ensurePlannedSessions: (tx: Tx, eventIds: string[]) => Promise<void>;
  /** ICS-Text von einer URL laden (SSRF-geschützt, `calendar-fetch.ts`) */
  fetchIcs: (url: string) => Promise<string>;
  now: () => Date;
  /** Zeitzone für Termine ohne Zone (`TZ` des Systems) */
  defaultTimeZone: () => string;
}

/** Solange T1-02 `ensurePlannedSessions` nicht gefüllt hat, wirft das Gerüst diesen Fehler. Der Import soll daran nicht scheitern. */
const SCAFFOLD_MESSAGE = 'nicht umgesetzt';

export const calendarHooks: CalendarHooks = {
  ensurePlannedSessions: async (tx, eventIds) => {
    try {
      await ensureSessionsImpl(tx, eventIds);
    } catch (error) {
      if (error instanceof Error && error.message === SCAFFOLD_MESSAGE) return;
      throw error;
    }
  },
  fetchIcs: (url) => fetchIcs(url),
  now: () => new Date(),
  defaultTimeZone: () => process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
};

/** Ersetzt Teile der Indirektion (Tests). Gibt eine Funktion zurück, die den vorigen Stand wiederherstellt. */
export function setCalendarHooks(overrides: Partial<CalendarHooks>): () => void {
  const previous = { ...calendarHooks };
  Object.assign(calendarHooks, overrides);
  return () => Object.assign(calendarHooks, previous);
}

// ---------------------------------------------------------------------------------------------
// API-Form
// ---------------------------------------------------------------------------------------------

export function toApiSource(row: SourceRow, eventCount: number): CalendarSource {
  return {
    id: row.id,
    user_id: row.userId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
    kind: row.kind as CalendarSource['kind'],
    name: row.name,
    url: row.url,
    last_synced_at: row.lastSyncedAt?.toISOString() ?? null,
    last_error: row.lastError,
    readonly: row.readonly,
    event_count: eventCount,
  };
}

export function toApiEvent(row: EventRow, sessionId: string | null): CalendarEvent {
  return {
    id: row.id,
    user_id: row.userId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
    source_id: row.sourceId,
    external_uid: row.externalUid,
    recurrence_id: row.recurrenceId,
    module_id: row.moduleId,
    kind: row.kind as CalendarEventKind,
    assigned_by: row.assignedBy as CalendarAssignment,
    title: row.title,
    location: row.location,
    description: row.description,
    starts_at: row.startsAt.toISOString(),
    ends_at: row.endsAt.toISOString(),
    all_day: row.allDay,
    cancelled: row.cancelled,
    session_id: sessionId,
  };
}

const sourceNotFound = () =>
  new HttpError(404, 'calendar_source_not_found', 'Diese Kalenderquelle gibt es nicht.');
const eventNotFound = () => new HttpError(404, 'calendar_event_not_found', 'Diesen Termin gibt es nicht.');

// ---------------------------------------------------------------------------------------------
// Quellen lesen und löschen
// ---------------------------------------------------------------------------------------------

async function eventCounts(db: DbOrTx, sourceIds: string[]): Promise<Map<string, number>> {
  if (sourceIds.length === 0) return new Map();
  const rows = await db
    .select({ sourceId: calendarEvent.sourceId, n: sql<number>`count(*)::int` })
    .from(calendarEvent)
    .where(and(inArray(calendarEvent.sourceId, sourceIds), isNull(calendarEvent.deletedAt)))
    .groupBy(calendarEvent.sourceId);
  return new Map(rows.map((row) => [row.sourceId as string, row.n]));
}

async function loadSource(db: DbOrTx, id: string): Promise<SourceRow | undefined> {
  const [row] = await db
    .select()
    .from(calendarSource)
    .where(and(eq(calendarSource.id, id), isNull(calendarSource.deletedAt)));
  return row;
}

async function sourceView(db: DbOrTx, row: SourceRow): Promise<CalendarSource> {
  const counts = await eventCounts(db, [row.id]);
  return toApiSource(row, counts.get(row.id) ?? 0);
}

export async function listSources(
  db: DbOrTx,
  options: { cursor?: string | undefined; limit: number },
): Promise<Page<CalendarSource>> {
  const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;
  const rows = await db
    .select({ row: calendarSource, ts: cursorTs(calendarSource.createdAt) })
    .from(calendarSource)
    .where(
      and(
        isNull(calendarSource.deletedAt),
        afterCursor(calendarSource.createdAt, calendarSource.id, cursor, 'asc'),
      ),
    )
    .orderBy(...keysetOrder(calendarSource.createdAt, calendarSource.id, 'asc'))
    .limit(options.limit + 1);
  const counts = await eventCounts(
    db,
    rows.map((r) => r.row.id),
  );
  return toPage(
    rows,
    options.limit,
    (r) => ({ ts: r.ts, id: r.row.id }),
    (r) => toApiSource(r.row, counts.get(r.row.id) ?? 0),
  );
}

/** Quelle weich löschen. Die Kaskade (Termine, nie gestartete Sessions) macht `softDelete` (VERTRAEGE §13). */
export async function deleteSource(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await softDelete(tx, 'calendar_source', id);
  });
}

// ---------------------------------------------------------------------------------------------
// Import: Einstiegspunkte
// ---------------------------------------------------------------------------------------------

/** Namensraum der Advisory-Locks dieses Moduls */
const LOCK_NS = 70070010;

async function lockKey(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_NS}, hashtext(${key}))`);
}

function parseOrThrow(text: string): ParseResult {
  try {
    return parseIcs(text, { now: calendarHooks.now(), defaultTimeZone: calendarHooks.defaultTimeZone() });
  } catch (error) {
    if (error instanceof IcsParseError) throw new HttpError(422, 'ics_invalid', error.message);
    throw error;
  }
}

async function fetchOrThrow(url: string): Promise<string> {
  try {
    return await calendarHooks.fetchIcs(url);
  } catch (error) {
    if (error instanceof IcsFetchError) {
      throw new HttpError(502, 'ics_fetch_failed', error.message, { reason: error.reason });
    }
    throw error;
  }
}

function checkUrl(raw: string): URL {
  try {
    return normalizeIcsUrl(raw);
  } catch (error) {
    if (error instanceof InvalidIcsUrlError) {
      throw new HttpError(400, 'validation_failed', error.message, {
        in: 'body',
        issues: [{ path: 'url', message: error.message }],
      });
    }
    throw error;
  }
}

function defaultNameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

async function assertIdFree(db: DbOrTx, id: string | undefined): Promise<void> {
  if (!id) return;
  const [taken] = await db
    .select({ id: calendarSource.id })
    .from(calendarSource)
    .where(eq(calendarSource.id, id));
  if (taken) {
    throw new HttpError(409, 'calendar_source_exists', 'Eine Kalenderquelle mit dieser ID gibt es schon.', {
      id,
    });
  }
}

export interface CreateUrlSourceInput {
  id?: string | undefined;
  url: string;
  name?: string | undefined;
}

/** `POST /calendar/sources` mit URL (201 `IcsImportResult`) */
export async function createUrlSource(db: Db, input: CreateUrlSourceInput): Promise<IcsImportResult> {
  const url = checkUrl(input.url);
  const href = url.toString();
  const findDuplicate = async (conn: DbOrTx) => {
    const [row] = await conn
      .select({ id: calendarSource.id })
      .from(calendarSource)
      .where(
        and(
          eq(calendarSource.url, href),
          eq(calendarSource.kind, 'ics_url'),
          isNull(calendarSource.deletedAt),
        ),
      );
    return row;
  };
  const duplicate = await findDuplicate(db);
  if (duplicate) {
    throw new HttpError(409, 'calendar_source_exists', 'Diese Kalender-URL gibt es schon.', {
      id: duplicate.id,
    });
  }
  await assertIdFree(db, input.id);

  const text = await fetchOrThrow(href);
  const parsed = parseOrThrow(text);

  return db.transaction(async (tx) => {
    await lockKey(tx, `url:${href}`);
    const again = await findDuplicate(tx);
    if (again) {
      throw new HttpError(409, 'calendar_source_exists', 'Diese Kalender-URL gibt es schon.', {
        id: again.id,
      });
    }
    await assertIdFree(tx, input.id);
    const [source] = await tx
      .insert(calendarSource)
      .values({
        id: input.id ?? uuidv7(),
        userId: SINGLE_USER_ID,
        kind: 'ics_url',
        name: input.name?.trim() || defaultNameOf(url),
        url: href,
        readonly: true,
      })
      .returning();
    return applyParsed(tx, source as SourceRow, parsed);
  });
}

export interface CreateFileSourceInput {
  id?: string | undefined;
  name?: string | undefined;
  filename: string;
  content: string;
}

/** `POST /calendar/sources` mit Datei (201 `IcsImportResult`) */
export async function createFileSource(db: Db, input: CreateFileSourceInput): Promise<IcsImportResult> {
  await assertIdFree(db, input.id);
  const parsed = parseOrThrow(input.content);
  return db.transaction(async (tx) => {
    const [source] = await tx
      .insert(calendarSource)
      .values({
        id: input.id ?? uuidv7(),
        userId: SINGLE_USER_ID,
        kind: 'ics_file',
        name: input.name?.trim() || input.filename.trim() || 'Stundenplan',
        url: null,
        readonly: true,
      })
      .returning();
    return applyParsed(tx, source as SourceRow, parsed);
  });
}

/** Fehler des Abrufs an der Quelle vermerken (`last_error`), ohne den Abgleich zu starten */
async function recordError(db: Db, id: string, message: string): Promise<void> {
  await db
    .update(calendarSource)
    .set({ lastError: message.slice(0, 500), updatedAt: sql`now()` as unknown as Date })
    .where(eq(calendarSource.id, id));
}

/**
 * `POST /calendar/sources/{id}/sync`. URL-Quelle: neu abrufen. Datei-Quelle: `fileContent` ist die neue Fassung.
 * Ein Fehler beim Abruf oder Lesen einer URL-Quelle steht danach in `last_error`.
 */
export async function syncSource(db: Db, id: string, fileContent?: string): Promise<IcsImportResult> {
  const source = await loadSource(db, id);
  if (!source) throw sourceNotFound();

  let text: string;
  if (source.kind === 'ics_url' && source.url) {
    try {
      text = await fetchOrThrow(source.url);
    } catch (error) {
      if (error instanceof HttpError) {
        const reason = typeof error.details?.reason === 'string' ? ` (${error.details.reason})` : '';
        await recordError(db, id, `Abruf fehlgeschlagen${reason}: ${error.message}`);
      }
      throw error;
    }
  } else if (source.kind === 'ics_file') {
    if (fileContent === undefined) {
      throw new HttpError(
        400,
        'file_missing',
        'Für eine Datei-Quelle fehlt die neue Fassung im Feld „file“.',
      );
    }
    text = fileContent;
  } else {
    throw new HttpError(400, 'source_not_syncable', 'Diese Quelle lässt sich nicht abgleichen.');
  }

  let parsed: ParseResult;
  try {
    parsed = parseOrThrow(text);
  } catch (error) {
    if (error instanceof HttpError && source.kind === 'ics_url') {
      await recordError(db, id, `Die Datei lässt sich nicht lesen: ${error.message}`);
    }
    throw error;
  }

  return db.transaction(async (tx) => {
    await lockKey(tx, `source:${id}`);
    const current = await loadSource(tx, id);
    if (!current) throw sourceNotFound();
    return applyParsed(tx, current, parsed);
  });
}

/** Alle URL-Quellen abgleichen (beim Start und alle 6 h). Fehler stehen je Quelle in `last_error`. */
export async function syncAllUrlSources(
  db: Db,
  log: { warn: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void },
): Promise<void> {
  const sources = await db
    .select({ id: calendarSource.id })
    .from(calendarSource)
    .where(and(eq(calendarSource.kind, 'ics_url'), isNull(calendarSource.deletedAt)))
    .orderBy(asc(calendarSource.createdAt));
  for (const { id } of sources) {
    try {
      const result = await syncSource(db, id);
      log.info({ source: id, counts: result.counts }, 'Kalender abgeglichen');
    } catch (error) {
      log.warn({ source: id, err: error }, 'Kalender-Abgleich fehlgeschlagen');
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Abgleich
// ---------------------------------------------------------------------------------------------

const keyOf = (uid: string | null, recurrenceId: string | null) => `${uid ?? ''}\u0000${recurrenceId ?? ''}`;
const CHUNK = 400;

interface Assignment {
  moduleId: string | null;
  kind: CalendarEventKind;
  assignedBy: CalendarAssignment;
}

interface ModuleScope {
  /** Module, deren Semester den Tag enthält (starts_on ≤ Tag ≤ ends_on) */
  bySemester: { startsOn: string | null; endsOn: string | null; modules: ModuleCandidate[] }[];
  /** Rückfall: Module des aktuellen Semesters */
  current: ModuleCandidate[];
}

async function loadModuleScope(tx: DbOrTx): Promise<ModuleScope> {
  const semesters = await tx
    .select()
    .from(semester)
    .where(and(isNull(semester.deletedAt), isNull(semester.archivedAt)));
  const modules = await tx.select().from(courseModule).where(isNull(courseModule.deletedAt));
  const candidatesOf = (semesterId: string): ModuleCandidate[] =>
    modules
      .filter((m) => m.semesterId === semesterId)
      .map((m) => ({ id: m.id, name: m.name, shortName: m.shortName, lecturer: m.lecturer }));
  return {
    bySemester: semesters
      // Ein Semester ganz ohne Datum kann keinen Tag „enthalten“
      .filter((s) => s.startsOn !== null || s.endsOn !== null)
      .map((s) => ({ startsOn: s.startsOn, endsOn: s.endsOn, modules: candidatesOf(s.id) })),
    current: semesters.filter((s) => s.isCurrent).flatMap((s) => candidatesOf(s.id)),
  };
}

/** Kalendertag (JJJJ-MM-TT) des Termins: ganztägig das Datum selbst, sonst in der Zeitzone des Systems */
function dayOf(event: ParsedEvent, timeZone: string): string {
  if (event.allDay) return event.startsAt.toISOString().slice(0, 10);
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(event.startsAt);
  } catch {
    return event.startsAt.toISOString().slice(0, 10);
  }
}

function candidatesFor(scope: ModuleScope, day: string): ModuleCandidate[] {
  const containing = scope.bySemester.filter(
    (s) => (s.startsOn === null || s.startsOn <= day) && (s.endsOn === null || day <= s.endsOn),
  );
  if (containing.length > 0) return containing.flatMap((s) => s.modules);
  return scope.current;
}

function autoAssignment(event: ParsedEvent, scope: ModuleScope, timeZone: string): Assignment {
  const moduleId = matchModule(textOf(event), candidatesFor(scope, dayOf(event, timeZone)));
  return { moduleId, kind: detectKind(textOf(event), event.allDay, moduleId !== null), assignedBy: 'auto' };
}

const textOf = (event: ParsedEvent) => ({
  title: event.title,
  location: event.location,
  description: event.description,
});

const sameTime = (a: Date, b: Date) => a.getTime() === b.getTime();

/** Ändert sich etwas, das der Nutzer als „Termin geändert“ sieht? Die Beschreibung allein zählt nicht (wird still übernommen). */
function fieldsDiffer(existing: EventRow, parsed: ParsedEvent): boolean {
  return (
    existing.title !== parsed.title ||
    existing.location !== parsed.location ||
    !sameTime(existing.startsAt, parsed.startsAt) ||
    !sameTime(existing.endsAt, parsed.endsAt) ||
    existing.allDay !== parsed.allDay ||
    existing.cancelled !== parsed.cancelled
  );
}

/**
 * Eine manuelle Zuordnung gilt für die ganze Serie, auch für später hinzukommende Vorkommen (F-KAL-02): Neue Vorkommen
 * erben sie, wenn **alle** vorhandenen Termine der Serie manuell und gleich zugeordnet sind. Hat jemand nur einen
 * Termin einzeln geändert (`scope = einzeln`), erbt kein neues Vorkommen davon.
 */
function inheritedAssignment(siblings: EventRow[]): Assignment | null {
  const first = siblings[0];
  if (!first) return null;
  const uniform = siblings.every(
    (row) => row.assignedBy === 'manuell' && row.moduleId === first.moduleId && row.kind === first.kind,
  );
  return uniform
    ? { moduleId: first.moduleId, kind: first.kind as CalendarEventKind, assignedBy: 'manuell' }
    : null;
}

function refOf(row: {
  id: string;
  externalUid: string | null;
  recurrenceId: string | null;
  title: string;
  startsAt: Date;
  moduleId: string | null;
  kind: string;
}): IcsEventRef {
  return {
    event_id: row.id,
    external_uid: row.externalUid ?? '',
    recurrence_id: row.recurrenceId,
    title: row.title,
    starts_at: row.startsAt.toISOString(),
    module_id: row.moduleId,
    kind: row.kind as CalendarEventKind,
  };
}

/** Schreibt den aufgelösten Kalender in die Quelle (VERTRAEGE §8 „Abgleich“). Läuft in `tx` unter der Quellen-Sperre. */
async function applyParsed(tx: Tx, source: SourceRow, parsed: ParseResult): Promise<IcsImportResult> {
  const timeZone = calendarHooks.defaultTimeZone();
  const scope = await loadModuleScope(tx);
  const existingRows = await tx
    .select()
    .from(calendarEvent)
    .where(and(eq(calendarEvent.sourceId, source.id), isNull(calendarEvent.deletedAt)));
  const existing = new Map(existingRows.map((row) => [keyOf(row.externalUid, row.recurrenceId), row]));
  const siblingsByUid = new Map<string, EventRow[]>();
  for (const row of existingRows) {
    const list = siblingsByUid.get(row.externalUid ?? '') ?? [];
    list.push(row);
    siblingsByUid.set(row.externalUid ?? '', list);
  }

  const neu: IcsEventRef[] = [];
  const geaendert: IcsEventRef[] = [];
  const entfallen: IcsEventRef[] = [];
  const zugeordnet: IcsEventRef[] = [];
  let unveraendert = 0;
  const writes: (typeof calendarEvent.$inferInsert)[] = [];
  const touched = new Set<string>();
  const seen = new Set<string>();

  for (const event of parsed.events) {
    const key = keyOf(event.uid, event.recurrenceId);
    seen.add(key);
    const row = existing.get(key);

    let assignment: Assignment;
    if (row && row.assignedBy === 'manuell') {
      assignment = { moduleId: row.moduleId, kind: row.kind as CalendarEventKind, assignedBy: 'manuell' };
    } else if (!row) {
      assignment =
        inheritedAssignment(siblingsByUid.get(event.uid) ?? []) ?? autoAssignment(event, scope, timeZone);
    } else {
      assignment = autoAssignment(event, scope, timeZone);
    }

    const base = {
      userId: SINGLE_USER_ID,
      sourceId: source.id,
      externalUid: event.uid,
      recurrenceId: event.recurrenceId,
      moduleId: assignment.moduleId,
      kind: assignment.kind,
      assignedBy: assignment.assignedBy,
      title: event.title,
      location: event.location,
      description: event.description,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      cancelled: event.cancelled,
    };

    if (!row) {
      const id = uuidv7();
      writes.push({ ...base, id });
      touched.add(id);
      const ref = refOf({ ...base, id });
      neu.push(ref);
      if (assignment.moduleId && assignment.assignedBy === 'auto') zugeordnet.push(ref);
      continue;
    }

    const fieldsChanged = fieldsDiffer(row, event);
    const assignmentChanged = row.moduleId !== assignment.moduleId || row.kind !== assignment.kind;
    const descriptionChanged = row.description !== event.description;
    if (!fieldsChanged && !assignmentChanged && !descriptionChanged) {
      unveraendert += 1;
      continue;
    }
    writes.push({ ...base, id: row.id });
    if (fieldsChanged || assignmentChanged) touched.add(row.id);
    const ref = refOf({ ...base, id: row.id });
    if (fieldsChanged) {
      // Wie in tests/fixtures/ics/pruefen.py: Absagen zählen als „entfallen“, nicht als „geändert“
      if (event.cancelled && !row.cancelled) entfallen.push(ref);
      else geaendert.push(ref);
    } else {
      unveraendert += 1;
    }
    if (row.moduleId === null && assignment.moduleId !== null && assignment.assignedBy === 'auto') {
      zugeordnet.push(ref);
    }
  }

  // Fehlt in der Quelle: abgesagt, nie gelöscht. Bei abgeschnittener Quelle (zu viele Termine) fehlt Wissen: nichts absagen.
  const vanished = parsed.truncated
    ? []
    : existingRows.filter((row) => !row.cancelled && !seen.has(keyOf(row.externalUid, row.recurrenceId)));
  for (const row of vanished) {
    touched.add(row.id);
    entfallen.push(refOf(row));
  }

  // Upsert (VERTRAEGE §6.1): Konfliktziel ist der partielle Index calendar_event_sync_uq. Modul und Art ändert er nur bei
  // assigned_by = 'auto', eine manuelle Zuordnung bleibt auch bei einem gleichzeitigen PATCH erhalten.
  for (let i = 0; i < writes.length; i += CHUNK) {
    await tx
      .insert(calendarEvent)
      .values(writes.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [calendarEvent.sourceId, calendarEvent.externalUid, calendarEvent.recurrenceId],
        targetWhere: sql`${calendarEvent.sourceId} IS NOT NULL`,
        set: {
          title: sql`excluded.title`,
          location: sql`excluded.location`,
          description: sql`excluded.description`,
          startsAt: sql`excluded.starts_at`,
          endsAt: sql`excluded.ends_at`,
          allDay: sql`excluded.all_day`,
          cancelled: sql`excluded.cancelled`,
          moduleId: sql`CASE WHEN ${calendarEvent.assignedBy} = 'auto' THEN excluded.module_id ELSE ${calendarEvent.moduleId} END`,
          kind: sql`CASE WHEN ${calendarEvent.assignedBy} = 'auto' THEN excluded.kind ELSE ${calendarEvent.kind} END`,
          updatedAt: sql`now()`,
        },
      });
  }
  const vanishedIds = vanished.map((row) => row.id);
  for (let i = 0; i < vanishedIds.length; i += CHUNK) {
    await tx
      .update(calendarEvent)
      .set({ cancelled: true, updatedAt: sql`now()` as unknown as Date })
      .where(inArray(calendarEvent.id, vanishedIds.slice(i, i + CHUNK)));
  }

  if (touched.size > 0) await calendarHooks.ensurePlannedSessions(tx, [...touched]);

  const now = calendarHooks.now();
  const [updated] = await tx
    .update(calendarSource)
    .set({ lastSyncedAt: now, lastError: null, updatedAt: sql`now()` as unknown as Date })
    .where(eq(calendarSource.id, source.id))
    .returning();

  const open = await tx
    .select()
    .from(calendarEvent)
    .where(
      and(
        eq(calendarEvent.sourceId, source.id),
        isNull(calendarEvent.deletedAt),
        eq(calendarEvent.cancelled, false),
      ),
    )
    .orderBy(asc(calendarEvent.startsAt), asc(calendarEvent.id));
  const withoutModule = open.filter((row) => row.moduleId === null);

  return {
    source: await sourceView(tx, updated as SourceRow),
    counts: {
      neu: neu.length,
      geaendert: geaendert.length,
      entfallen: entfallen.length,
      unveraendert,
      zugeordnet: zugeordnet.length,
      ohne_modul: withoutModule.length,
    },
    neu,
    geaendert,
    entfallen,
    zugeordnet,
    module_suggestions: suggestModules(withoutModule),
    warnings: parsed.warnings,
  };
}

/**
 * „Neues Modul anlegen?“ für unbekannte Titel (F-KAL-02): Termine ohne Modul, die der Abgleich zugeordnet hat (nicht manuell
 * freigelassen), zusammengefasst nach bereinigtem Namen. Feste Termine (Feiertage) schlagen kein Modul vor.
 */
function suggestModules(rows: EventRow[]): IcsModuleSuggestion[] {
  const groups = new Map<string, IcsModuleSuggestion & { uids: Set<string> }>();
  for (const row of rows) {
    if (row.assignedBy !== 'auto' || row.kind === 'fest' || row.kind === 'lernblock_export') continue;
    const name = suggestModuleName(row.title);
    const key = suggestionKey(name);
    if (key === '') continue;
    let group = groups.get(key);
    if (!group) {
      group = {
        name,
        kind: row.kind as CalendarEventKind,
        event_count: 0,
        series_event_ids: [],
        uids: new Set(),
      };
      groups.set(key, group);
    }
    group.event_count += 1;
    // Je Serie ein Termin: der früheste (die Zeilen sind nach Beginn sortiert)
    const seriesKey = row.externalUid ?? row.id;
    if (!group.uids.has(seriesKey)) {
      group.uids.add(seriesKey);
      group.series_event_ids.push(row.id);
    }
  }
  return [...groups.values()].map(({ uids: _uids, ...suggestion }) => suggestion);
}

// ---------------------------------------------------------------------------------------------
// Termine lesen und ändern
// ---------------------------------------------------------------------------------------------

export interface ListEventsOptions {
  from?: string | undefined;
  to?: string | undefined;
  moduleId?: string | undefined;
  unassigned?: boolean | undefined;
  includeCancelled?: boolean | undefined;
  cursor?: string | undefined;
  limit: number;
}

function sessionIdOf(): SQL<string | null> {
  // Spaltennamen ausgeschrieben: Drizzle lässt den Tabellennamen weg, sobald nur eine Tabelle im FROM steht
  return sql<
    string | null
  >`(SELECT s.id FROM ${session} s WHERE s.calendar_event_id = calendar_event.id AND s.deleted_at IS NULL LIMIT 1)`;
}

/** Termine nach Beginn aufsteigend. `from`/`to`: Termine, die in diesem Zeitraum liegen oder hineinreichen. */
export async function listEvents(db: DbOrTx, options: ListEventsOptions): Promise<Page<CalendarEvent>> {
  const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;
  const conditions: (SQL | undefined)[] = [
    isNull(calendarEvent.deletedAt),
    options.includeCancelled ? undefined : eq(calendarEvent.cancelled, false),
    options.from
      ? or(
          gt(calendarEvent.endsAt, new Date(options.from)),
          gte(calendarEvent.startsAt, new Date(options.from)),
        )
      : undefined,
    options.to ? lt(calendarEvent.startsAt, new Date(options.to)) : undefined,
    options.moduleId ? eq(calendarEvent.moduleId, options.moduleId) : undefined,
    options.unassigned ? isNull(calendarEvent.moduleId) : undefined,
    afterCursor(calendarEvent.startsAt, calendarEvent.id, cursor, 'asc'),
  ];
  const rows = await db
    .select({ row: calendarEvent, ts: cursorTs(calendarEvent.startsAt), sessionId: sessionIdOf() })
    .from(calendarEvent)
    .where(and(...conditions))
    .orderBy(...keysetOrder(calendarEvent.startsAt, calendarEvent.id, 'asc'))
    .limit(options.limit + 1);
  return toPage(
    rows,
    options.limit,
    (r) => ({ ts: r.ts, id: r.row.id }),
    (r) => toApiEvent(r.row, r.sessionId),
  );
}

async function eventsByIds(db: DbOrTx, ids: string[]): Promise<CalendarEvent[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ row: calendarEvent, sessionId: sessionIdOf() })
    .from(calendarEvent)
    .where(and(inArray(calendarEvent.id, ids), isNull(calendarEvent.deletedAt)))
    .orderBy(asc(calendarEvent.startsAt), asc(calendarEvent.id));
  return rows.map((r) => toApiEvent(r.row, r.sessionId));
}

export async function getEvent(db: DbOrTx, id: string): Promise<CalendarEvent> {
  const [event] = await eventsByIds(db, [id]);
  if (!event) throw eventNotFound();
  return event;
}

/**
 * `PATCH /calendar/events/{id}`: Modul und/oder Art setzen, `assigned_by = manuell`. `scope = serie` (Standard) gilt für alle
 * Termine mit gleicher Quelle und `external_uid`, `einzeln` nur für diesen. Antwort: alle geänderten Termine.
 */
export async function updateEvent(db: Db, id: string, update: CalendarEventUpdate): Promise<CalendarEvent[]> {
  if (update.module_id === undefined && update.kind === undefined) {
    throw new HttpError(400, 'validation_failed', 'Gib module_id oder kind an.', {
      in: 'body',
      issues: [{ path: '', message: 'module_id oder kind fehlt' }],
    });
  }
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(calendarEvent)
      .where(and(eq(calendarEvent.id, id), isNull(calendarEvent.deletedAt)));
    if (!target) throw eventNotFound();
    if (update.module_id) {
      const [found] = await tx
        .select({ id: courseModule.id })
        .from(courseModule)
        .where(and(eq(courseModule.id, update.module_id), isNull(courseModule.deletedAt)));
      if (!found) throw new HttpError(404, 'module_not_found', 'Dieses Modul gibt es nicht.');
    }
    const wholeSeries =
      (update.scope ?? 'serie') === 'serie' && target.sourceId !== null && target.externalUid !== null;
    // Sperre wie beim Abgleich: ein gleichzeitiger Import sieht entweder den alten oder den neuen Stand
    if (target.sourceId) await lockKey(tx, `source:${target.sourceId}`);
    const rows = wholeSeries
      ? await tx
          .select({ id: calendarEvent.id })
          .from(calendarEvent)
          .where(
            and(
              eq(calendarEvent.sourceId, target.sourceId as string),
              eq(calendarEvent.externalUid, target.externalUid as string),
              isNull(calendarEvent.deletedAt),
            ),
          )
      : [{ id: target.id }];
    const ids = rows.map((row) => row.id);
    await tx
      .update(calendarEvent)
      .set({
        assignedBy: 'manuell',
        ...(update.module_id !== undefined ? { moduleId: update.module_id } : {}),
        ...(update.kind !== undefined ? { kind: update.kind } : {}),
        updatedAt: sql`now()` as unknown as Date,
      })
      .where(inArray(calendarEvent.id, ids));
    await calendarHooks.ensurePlannedSessions(tx, ids);
    return eventsByIds(tx, ids);
  });
}
