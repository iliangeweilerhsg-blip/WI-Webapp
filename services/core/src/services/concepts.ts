// Konzepte lesen (VERTRAEGE §20.6): `GET /concepts`, `GET /concepts/{id}`, `GET /sessions/{id}/concepts`.
// Ticket T2-22b. Geschrieben werden Konzepte vom Worker (`concepts.resolve`) und über die Inbox (`inbox.ts`).
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  Concept,
  ConceptDetail,
  ConceptKind,
  ConceptList,
  ConceptListItem,
  ConceptRelationKind,
  ConceptRelationSource,
  ConceptRelationView,
  ConceptStatus,
  EvidenceView,
  InboxStatus,
  SearchModuleRef,
  SessionConceptItem,
  SessionConcepts,
  SessionRef,
} from '@sg/shared';
import type { DbOrTx } from '../db/client.ts';
import {
  concept,
  conceptModule,
  conceptRelation,
  courseModule,
  evidence,
  inboxItem,
  notDeleted,
  session,
  slide,
  slideDeck,
} from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { isoTs, requireSession } from './sessions.ts';

/** `real`-Spalten (float4) ohne Rauschen ausgeben: 1,3 statt 1,2999999523162842 */
export function roundReal(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

export const conceptApiCols = {
  id: concept.id,
  createdAt: concept.createdAt,
  updatedAt: concept.updatedAt,
  name: concept.name,
  aliases: concept.aliases,
  kind: concept.kind,
  oneLiner: concept.oneLiner,
  status: concept.status,
  mergedInto: concept.mergedInto,
  examRelevant: concept.examRelevant,
  importanceBase: concept.importanceBase,
};

type ConceptApiRow = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  aliases: string[];
  kind: string | null;
  oneLiner: string | null;
  status: string;
  mergedInto: string | null;
  examRelevant: boolean;
  importanceBase: number;
};

export function toApiConcept(row: ConceptApiRow): Concept {
  return {
    id: row.id,
    created_at: isoTs(row.createdAt),
    updated_at: isoTs(row.updatedAt),
    name: row.name,
    aliases: row.aliases,
    kind: row.kind as ConceptKind | null,
    one_liner: row.oneLiner,
    status: row.status as ConceptStatus,
    merged_into: row.mergedInto,
    exam_relevant: row.examRelevant,
    importance_base: roundReal(row.importanceBase),
  };
}

/** Nicht gelöschtes Konzept als API-Objekt, sonst `null` */
export async function loadApiConcept(db: DbOrTx, id: string): Promise<Concept | null> {
  const [row] = await db
    .select(conceptApiCols)
    .from(concept)
    .where(and(eq(concept.id, id), notDeleted(concept)));
  return row ? toApiConcept(row) : null;
}

/** `SessionRef` je nicht gelöschter Session */
export async function loadSessionRefs(db: DbOrTx, ids: readonly string[]): Promise<Map<string, SessionRef>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      id: session.id,
      number: session.number,
      title: session.title,
      startedAt: session.startedAt,
      moduleId: courseModule.id,
      moduleName: courseModule.name,
      moduleShortName: courseModule.shortName,
    })
    .from(session)
    .innerJoin(courseModule, eq(courseModule.id, session.moduleId))
    .where(and(inArray(session.id, unique), notDeleted(session)));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        number: row.number,
        title: row.title,
        started_at: row.startedAt ? isoTs(row.startedAt) : null,
        module: { id: row.moduleId, name: row.moduleName, short_name: row.moduleShortName },
      },
    ]),
  );
}

/** Module je Konzept (nicht gelöschte Zuordnungen und Module), nach Name */
async function loadModules(
  db: DbOrTx,
  conceptIds: readonly string[],
): Promise<Map<string, SearchModuleRef[]>> {
  const result = new Map<string, SearchModuleRef[]>();
  if (conceptIds.length === 0) return result;
  const rows = await db
    .select({
      conceptId: conceptModule.conceptId,
      id: courseModule.id,
      name: courseModule.name,
      shortName: courseModule.shortName,
    })
    .from(conceptModule)
    .innerJoin(courseModule, eq(courseModule.id, conceptModule.moduleId))
    .where(
      and(
        inArray(conceptModule.conceptId, [...conceptIds]),
        notDeleted(conceptModule),
        notDeleted(courseModule),
      ),
    )
    .orderBy(asc(courseModule.name), asc(courseModule.id));
  for (const row of rows) {
    const list = result.get(row.conceptId) ?? [];
    list.push({ id: row.id, name: row.name, short_name: row.shortName });
    result.set(row.conceptId, list);
  }
  return result;
}

interface EvidenceEntry {
  conceptId: string;
  view: EvidenceView;
  slideIndex: number | null;
  tStartMs: number | null;
}

/**
 * Nicht gelöschte Belege der Arten dieses Schnitts (`slide`, `transcript`) mit Anzeigeangaben, neueste Session
 * zuerst. Ein Folien-Beleg, dessen Folie endgültig weg ist, lässt sich nicht mehr als `EvidenceRefSlide` ausdrücken
 * (ohne `deck_id`) und entfällt.
 */
async function loadEvidence(db: DbOrTx, where: SQL | undefined, limit?: number): Promise<EvidenceEntry[]> {
  const query = db
    .select({
      id: evidence.id,
      conceptId: evidence.conceptId,
      kind: evidence.kind,
      refId: evidence.refId,
      sessionId: evidence.sessionId,
      tStartMs: evidence.tStartMs,
      tEndMs: evidence.tEndMs,
      quote: evidence.quote,
      auto: evidence.auto,
      deckId: slide.deckId,
      slideIndex: slide.index,
      slideTitle: slide.title,
      slideGone: sql<boolean>`(${slide.deletedAt} IS NOT NULL OR ${slideDeck.deletedAt} IS NOT NULL)`,
    })
    .from(evidence)
    .leftJoin(slide, and(eq(evidence.kind, 'slide'), eq(slide.id, evidence.refId)))
    .leftJoin(slideDeck, eq(slideDeck.id, slide.deckId))
    .leftJoin(session, eq(session.id, evidence.sessionId))
    .where(and(notDeleted(evidence), inArray(evidence.kind, ['slide', 'transcript']), where))
    .orderBy(
      sql`${session.startedAt} DESC NULLS LAST`,
      sql`${evidence.sessionId} DESC NULLS LAST`,
      sql`${slide.index} ASC NULLS LAST`,
      sql`${evidence.tStartMs} ASC NULLS LAST`,
      asc(evidence.id),
    );
  const rows = await (limit === undefined ? query : query.limit(limit));
  const sessions = await loadSessionRefs(
    db,
    rows.flatMap((row) => (row.sessionId ? [row.sessionId] : [])),
  );
  const entries: EvidenceEntry[] = [];
  for (const row of rows) {
    const base = {
      id: row.id,
      session: (row.sessionId && sessions.get(row.sessionId)) || null,
      quote: row.quote,
      auto: row.auto,
    };
    if (row.kind === 'slide') {
      if (!row.deckId || row.slideIndex === null) continue;
      entries.push({
        conceptId: row.conceptId,
        slideIndex: row.slideIndex,
        tStartMs: null,
        view: {
          ...base,
          ref: { kind: 'slide', slide_id: row.refId, deck_id: row.deckId, slide_index: row.slideIndex },
          slide_title: row.slideTitle,
          missing: row.slideGone,
        },
      });
    } else if (row.sessionId && row.tStartMs !== null && row.tEndMs !== null) {
      entries.push({
        conceptId: row.conceptId,
        slideIndex: null,
        tStartMs: row.tStartMs,
        view: {
          ...base,
          ref: {
            kind: 'transcript',
            session_id: row.sessionId,
            t_start_ms: row.tStartMs,
            t_end_ms: row.tEndMs,
          },
          slide_title: null,
          missing: false,
        },
      });
    }
  }
  return entries;
}

// --- GET /concepts -----------------------------------------------------------------------------------------

export interface ListConceptsOptions {
  status: 'aktiv' | 'vorschlag' | 'alle';
  moduleId?: string | undefined;
  q?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function decodeNameCursor(raw: string): { name: string; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [name, id] = parsed as unknown[];
      if (typeof name === 'string' && typeof id === 'string' && UUID_RE.test(id)) return { name, id };
    }
  } catch {
    // unten
  }
  throw new HttpError(400, 'invalid_cursor', 'Der Cursor ist ungültig.');
}

/** Vorschlag mit offenem Eintrag */
const hasOpenItem = sql`EXISTS (SELECT 1 FROM inbox_item i WHERE i.concept_id = ${concept.id}
  AND i.status = 'offen' AND i.deleted_at IS NULL)`;

export async function listConcepts(db: DbOrTx, options: ListConceptsOptions): Promise<ConceptList> {
  const lowerName = sql<string>`lower(${concept.name})`;
  const conditions: (SQL | undefined)[] = [notDeleted(concept)];
  const proposal = and(eq(concept.status, 'vorschlag'), hasOpenItem);
  if (options.status === 'aktiv') conditions.push(eq(concept.status, 'aktiv'));
  else if (options.status === 'vorschlag') conditions.push(proposal);
  else conditions.push(or(eq(concept.status, 'aktiv'), proposal));

  if (options.moduleId) {
    conditions.push(sql`EXISTS (SELECT 1 FROM concept_module cm WHERE cm.concept_id = ${concept.id}
      AND cm.module_id = ${options.moduleId} AND cm.deleted_at IS NULL)`);
  }
  if (options.q !== undefined) {
    const pattern = `%${options.q.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(sql`(${concept.name} ILIKE ${pattern}
      OR EXISTS (SELECT 1 FROM unnest(${concept.aliases}) AS a(alias) WHERE a.alias ILIKE ${pattern}))`);
  }
  if (options.cursor) {
    const cursor = decodeNameCursor(options.cursor);
    conditions.push(sql`(${lowerName}, ${concept.id}) > (${cursor.name}, ${cursor.id}::uuid)`);
  }

  const rows = await db
    .select({ ...conceptApiCols, lowerName })
    .from(concept)
    .where(and(...conditions))
    .orderBy(lowerName, asc(concept.id))
    .limit(options.limit + 1);
  const hasMore = rows.length > options.limit;
  const visible = hasMore ? rows.slice(0, options.limit) : rows;
  const ids = visible.map((row) => row.id);

  const counts = new Map<string, { evidence: number; sessions: number }>();
  if (ids.length > 0) {
    const counted = await db
      .select({
        conceptId: evidence.conceptId,
        evidence: sql<number>`count(*)::int`,
        sessions: sql<number>`count(DISTINCT ${evidence.sessionId})::int`,
      })
      .from(evidence)
      .where(and(inArray(evidence.conceptId, ids), notDeleted(evidence)))
      .groupBy(evidence.conceptId);
    for (const row of counted) counts.set(row.conceptId, row);
  }
  const modules = await loadModules(db, ids);

  const items: ConceptListItem[] = visible.map((row) => ({
    concept: toApiConcept(row),
    modules: modules.get(row.id) ?? [],
    evidence_count: counts.get(row.id)?.evidence ?? 0,
    session_count: counts.get(row.id)?.sessions ?? 0,
  }));
  const last = visible.at(-1);
  return {
    items,
    next_cursor:
      hasMore && last
        ? Buffer.from(JSON.stringify([last.lowerName, last.id]), 'utf8').toString('base64url')
        : null,
  };
}

// --- GET /concepts/{id} --------------------------------------------------------------------------------------

const MAX_DETAIL_EVIDENCE = 200;

export async function getConceptDetail(db: DbOrTx, id: string): Promise<ConceptDetail> {
  const found = await loadApiConcept(db, id);
  if (!found) throw new HttpError(404, 'concept_not_found', 'Das Konzept wurde nicht gefunden.');

  const other = alias(concept, 'other');
  const relationRows = await db
    .select({
      id: conceptRelation.id,
      kind: conceptRelation.kind,
      fromId: conceptRelation.fromId,
      source: conceptRelation.source,
      confidence: conceptRelation.confidence,
      otherId: other.id,
      otherName: other.name,
      otherStatus: other.status,
      // Fächerbrücke (05 §P8.4): kein gemeinsames Modul
      crossModule: sql<boolean>`NOT EXISTS (
        SELECT 1 FROM concept_module m1 JOIN concept_module m2 ON m2.module_id = m1.module_id
         WHERE m1.concept_id = ${id} AND m2.concept_id = ${other.id}
           AND m1.deleted_at IS NULL AND m2.deleted_at IS NULL)`,
    })
    .from(conceptRelation)
    .innerJoin(
      other,
      sql`${other.id} = CASE WHEN ${conceptRelation.fromId} = ${id} THEN ${conceptRelation.toId}
        ELSE ${conceptRelation.fromId} END`,
    )
    .where(
      and(
        eq(conceptRelation.confirmed, true),
        notDeleted(conceptRelation),
        isNull(other.deletedAt),
        or(eq(conceptRelation.fromId, id), eq(conceptRelation.toId, id)),
      ),
    )
    .orderBy(asc(conceptRelation.kind), sql`lower(${other.name})`, asc(conceptRelation.id));
  const relations: ConceptRelationView[] = relationRows.map((row) => ({
    id: row.id,
    kind: row.kind as ConceptRelationKind,
    direction: row.fromId === id ? 'ausgehend' : 'eingehend',
    other: { id: row.otherId, name: row.otherName, status: row.otherStatus as ConceptStatus },
    source: row.source as ConceptRelationSource,
    confidence: row.confidence === null ? null : roundReal(row.confidence),
    cross_module: row.crossModule,
  }));

  const [openItem] = await db
    .select({ id: inboxItem.id })
    .from(inboxItem)
    .where(and(eq(inboxItem.conceptId, id), eq(inboxItem.status, 'offen'), notDeleted(inboxItem)));

  return {
    concept: found,
    modules: (await loadModules(db, [id])).get(id) ?? [],
    evidence: (await loadEvidence(db, eq(evidence.conceptId, id), MAX_DETAIL_EVIDENCE)).map((e) => e.view),
    relations,
    inbox_item_id: openItem?.id ?? null,
  };
}

// --- GET /sessions/{id}/concepts ---------------------------------------------------------------------------

export async function getSessionConcepts(db: DbOrTx, sessionId: string): Promise<SessionConcepts> {
  await requireSession(db, sessionId);
  const entries = await loadEvidence(db, eq(evidence.sessionId, sessionId));
  const conceptIds = [...new Set(entries.map((entry) => entry.conceptId))];
  if (conceptIds.length === 0) return { session_id: sessionId, items: [] };

  const concepts = await db
    .select(conceptApiCols)
    .from(concept)
    .where(
      and(
        inArray(concept.id, conceptIds),
        notDeleted(concept),
        inArray(concept.status, ['aktiv', 'vorschlag']),
      ),
    );
  // Eintrag des Konzepts: der eigene (Vorschlag bzw. daraus angenommen), sonst die Zusammenführung dieser Session
  // in das Konzept
  const itemRows = await db
    .select({
      id: inboxItem.id,
      status: inboxItem.status,
      conceptId: inboxItem.conceptId,
      mergedInto: sql<string | null>`${inboxItem.decision}->>'merged_into'`,
    })
    .from(inboxItem)
    .where(
      and(
        notDeleted(inboxItem),
        or(
          inArray(inboxItem.conceptId, conceptIds),
          and(
            eq(inboxItem.sessionId, sessionId),
            inArray(sql`${inboxItem.decision}->>'merged_into'`, conceptIds),
          ),
        ),
      ),
    )
    .orderBy(asc(inboxItem.priority), asc(inboxItem.id));
  const own = new Map<string, { id: string; status: string }>();
  const merged = new Map<string, { id: string; status: string }>();
  for (const row of itemRows) {
    if (row.conceptId && conceptIds.includes(row.conceptId) && !own.has(row.conceptId)) {
      own.set(row.conceptId, row);
    }
    if (row.mergedInto && row.status !== 'offen' && !merged.has(row.mergedInto)) {
      merged.set(row.mergedInto, row);
    }
  }

  interface Sortable {
    item: SessionConceptItem;
    slide: number;
    time: number;
  }
  const sortable: Sortable[] = [];
  for (const row of concepts) {
    const item = own.get(row.id) ?? merged.get(row.id) ?? null;
    // Abgelehntes zeigt der Rückblick nicht
    if (row.status === 'vorschlag' && own.get(row.id)?.status === 'abgelehnt') continue;
    const mine = entries.filter((entry) => entry.conceptId === row.id);
    sortable.push({
      item: {
        concept: toApiConcept(row),
        evidence: mine.map((entry) => entry.view),
        inbox_item_id: item?.id ?? null,
        inbox_status: (item?.status as InboxStatus | undefined) ?? null,
      },
      slide: Math.min(...mine.map((entry) => entry.slideIndex ?? Infinity)),
      time: Math.min(...mine.map((entry) => entry.tStartMs ?? Infinity)),
    });
  }
  const cmp = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);
  sortable.sort(
    (a, b) =>
      cmp(a.slide, b.slide) ||
      cmp(a.time, b.time) ||
      a.item.concept.name.localeCompare(b.item.concept.name, 'de') ||
      (a.item.concept.id < b.item.concept.id ? -1 : 1),
  );
  return { session_id: sessionId, items: sortable.map((entry) => entry.item) };
}
