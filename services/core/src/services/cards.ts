// Karten lesen, anlegen und ändern (VERTRAEGE §21.4). Ticket B2.
//
// Von B3 (Karten aus der Inbox annehmen, §21.7) genutzt und darum hier exportiert:
// - Säubern und Prüfen des Inhalts: `learning/content.ts` (`normalizeCardContent`, `checkCardContent`),
// - Prüfung der Belege: `findInvalidCardSource`, `assertCardSources`,
// - Anlegen von Karte samt Zustand: `insertCardWithState`,
// - Umwandlung in die API: `toApiCard`, `loadApiCards`, `loadApiCard`.
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  SINGLE_USER_ID,
  type Card,
  type CardContent,
  type CardCreate,
  type CardList,
  type CardOrigin,
  type CardSource,
  type CardUpdate,
  type EvidenceRef,
} from '@sg/shared';
import type { Db, DbOrTx, Tx } from '../db/client.ts';
import { card, cardState, concept, notDeleted, session, slide, slideDeck } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { normalizeCardContent } from '../learning/content.ts';
import { emptyCardState, toApiCardState, type CardStateRecord } from '../learning/fsrs.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import { isoTs } from './sessions.ts';

/** Höchstzahl der Karten in `GET /concepts/{id}/cards` */
export const CARD_LIST_LIMIT = 500;

type CardRow = typeof card.$inferSelect;
type StateRow = typeof cardState.$inferSelect;

/** Karte samt Zustand, wie sie die Abfragen liefern */
export interface CardWithState {
  card: CardRow;
  state: StateRow;
}

export function stateRecord(row: StateRow): CardStateRecord {
  return {
    state: row.state as CardStateRecord['state'],
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    learningSteps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    lastReview: row.lastReview,
  };
}

// --- Belege -----------------------------------------------------------------------------------

function sourceKey(ref: EvidenceRef): string {
  return ref.kind === 'slide'
    ? `slide:${ref.slide_id}`
    : `transcript:${ref.session_id}:${ref.t_start_ms}:${ref.t_end_ms}`;
}

/** Folien (nicht gelöscht, Foliensatz nicht gelöscht) unter den IDs */
async function liveSlides(
  db: DbOrTx,
  ids: string[],
): Promise<Map<string, { deckId: string; index: number }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: slide.id, deckId: slide.deckId, index: slide.index })
    .from(slide)
    .innerJoin(slideDeck, eq(slideDeck.id, slide.deckId))
    .where(and(inArray(slide.id, ids), notDeleted(slide), notDeleted(slideDeck)));
  return new Map(rows.map((r) => [r.id, { deckId: r.deckId, index: r.index }]));
}

/** Sessions (nicht gelöscht) unter den IDs */
async function liveSessions(db: DbOrTx, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: session.id })
    .from(session)
    .where(and(inArray(session.id, ids), notDeleted(session)));
  return new Set(rows.map((r) => r.id));
}

/**
 * Prüft die Belege einer Karte (§21.4, LP8): `slide` → die Folie existiert, ist nicht gelöscht, ihr Foliensatz auch, und
 * `deck_id` und `slide_index` passen zu ihr. `transcript` → die Session existiert und ist nicht gelöscht,
 * `t_start_ms ≤ t_end_ms`. Dubletten zählen als ungültig (der zweite Eintrag). Der Beleg muss kein Beleg des Konzepts sein.
 * Rückgabe: der Index des ersten ungültigen Belegs, sonst `null`.
 */
export async function findInvalidCardSource(
  db: DbOrTx,
  sources: readonly EvidenceRef[],
): Promise<number | null> {
  const slides = await liveSlides(
    db,
    sources.flatMap((s) => (s.kind === 'slide' ? [s.slide_id] : [])),
  );
  const sessions = await liveSessions(
    db,
    sources.flatMap((s) => (s.kind === 'transcript' ? [s.session_id] : [])),
  );
  const seen = new Set<string>();
  for (const [index, ref] of sources.entries()) {
    const key = sourceKey(ref);
    if (seen.has(key)) return index;
    seen.add(key);
    if (ref.kind === 'slide') {
      const found = slides.get(ref.slide_id);
      if (!found || found.deckId !== ref.deck_id || found.index !== ref.slide_index) return index;
    } else if (!sessions.has(ref.session_id) || ref.t_start_ms > ref.t_end_ms) {
      return index;
    }
  }
  return null;
}

/** `400 card_source_invalid` mit `details.index` (und weiteren Angaben wie `key` in der Inbox) */
export function cardSourceInvalid(index: number, extra: Record<string, unknown> = {}): HttpError {
  return new HttpError(
    400,
    'card_source_invalid',
    'Ein Beleg zeigt auf nichts Vorhandenes oder kommt doppelt vor.',
    { index, ...extra },
  );
}

/** Wie {@link findInvalidCardSource}, wirft aber `400 card_source_invalid` */
export async function assertCardSources(db: DbOrTx, sources: readonly EvidenceRef[]): Promise<void> {
  const invalid = await findInvalidCardSource(db, sources);
  if (invalid !== null) throw cardSourceInvalid(invalid);
}

// --- Umwandlung in die API ------------------------------------------------------------------------

/** Welche Belege (Schlüssel `sourceKey`) fehlen: Folie, Foliensatz oder Session gelöscht oder nicht vorhanden */
async function missingSources(db: DbOrTx, rows: readonly CardRow[]): Promise<Set<string>> {
  const refs = rows.flatMap((row) => row.sources);
  const slides = await liveSlides(
    db,
    refs.flatMap((s) => (s.kind === 'slide' ? [s.slide_id] : [])),
  );
  const sessions = await liveSessions(
    db,
    refs.flatMap((s) => (s.kind === 'transcript' ? [s.session_id] : [])),
  );
  const missing = new Set<string>();
  for (const ref of refs) {
    const gone = ref.kind === 'slide' ? !slides.has(ref.slide_id) : !sessions.has(ref.session_id);
    if (gone) missing.add(sourceKey(ref));
  }
  return missing;
}

/** Karte der API aus einer Zeile samt Zustand (`missing` kommt aus {@link loadApiCards}) */
export function toApiCard(row: CardWithState, missing: ReadonlySet<string> = new Set()): Card {
  const { card: c, state } = row;
  const sources: CardSource[] = c.sources.map((ref) => ({ ref, missing: missing.has(sourceKey(ref)) }));
  return {
    id: c.id,
    created_at: isoTs(c.createdAt),
    updated_at: isoTs(c.updatedAt),
    concept_id: c.conceptId,
    stage: c.stage,
    origin: c.origin as CardOrigin,
    suspended: c.suspended,
    content: { kind: c.kind, front: c.front, back: c.back } as CardContent,
    sources,
    state: toApiCardState(stateRecord(state)),
  };
}

/** Karten der API in der Reihenfolge der Zeilen, die Belege in einem Rutsch geprüft */
export async function loadApiCards(db: DbOrTx, rows: readonly CardWithState[]): Promise<Card[]> {
  const missing = await missingSources(
    db,
    rows.map((r) => r.card),
  );
  return rows.map((row) => toApiCard(row, missing));
}

/** Nicht gelöschte Karten mit Zustand zu den Bedingungen, `(created_at, id)` aufsteigend */
export async function selectCards(
  db: DbOrTx,
  where: SQL,
  options: { limit?: number; lock?: 'update' | 'share' } = {},
): Promise<CardWithState[]> {
  const query = db
    .select({ card, state: cardState })
    .from(card)
    .innerJoin(cardState, eq(cardState.cardId, card.id))
    .where(and(where, notDeleted(card), notDeleted(cardState)))
    .orderBy(asc(card.createdAt), asc(card.id));
  const limited = options.limit === undefined ? query : query.limit(options.limit);
  return options.lock ? limited.for(options.lock, { of: card }) : limited;
}

/** Eine nicht gelöschte Karte als API-Objekt, sonst `null` */
export async function loadApiCard(db: DbOrTx, id: string): Promise<Card | null> {
  const [row] = await selectCards(db, eq(card.id, id));
  if (!row) return null;
  const [api] = await loadApiCards(db, [row]);
  return api ?? null;
}

const cardNotFound = () =>
  new HttpError(404, 'card_not_found', 'Die Karte gibt es nicht oder sie ist gelöscht.');
const conceptNotFound = () =>
  new HttpError(404, 'concept_not_found', 'Das Konzept gibt es nicht oder es ist gelöscht.');

// --- Lesen --------------------------------------------------------------------------------------

/** `GET /cards/{id}` */
export async function getCard(db: DbOrTx, id: string): Promise<Card> {
  const found = await loadApiCard(db, id);
  if (!found) throw cardNotFound();
  return found;
}

/**
 * `GET /concepts/{id}/cards`: alle nicht gelöschten Karten des Konzepts, auch pausierte, `(created_at, id)`,
 * höchstens 500. Auch für Vorschläge und Hüllen (dann leer). `404 concept_not_found`, wenn das Konzept fehlt oder gelöscht ist.
 */
export async function listConceptCards(db: DbOrTx, conceptId: string): Promise<CardList> {
  const [found] = await db
    .select({ id: concept.id })
    .from(concept)
    .where(and(eq(concept.id, conceptId), notDeleted(concept)));
  if (!found) throw conceptNotFound();
  const rows = await selectCards(db, eq(card.conceptId, conceptId), { limit: CARD_LIST_LIMIT });
  return { items: await loadApiCards(db, rows) };
}

// --- Anlegen ------------------------------------------------------------------------------------

export interface NewCard {
  id: string;
  conceptId: string;
  /** Schon gesäubert und geprüft (`normalizeCardContent`) */
  content: CardContent;
  /** Schon geprüft (`assertCardSources`) */
  sources: EvidenceRef[];
  origin: CardOrigin;
  /** Nur bei `origin = ki`: der Inbox-Eintrag, aus dem die Karte stammt */
  inboxItemId?: string | null;
  now: Date;
}

/**
 * Legt `card` und `card_state` an, in der Transaktion des Aufrufers (§21.1: Eine Karte ohne Zustand gibt es nicht).
 * Zustand wie `createEmptyCard` von `ts-fsrs`: `new`, `due = now`, alle Zahlen 0. `stage` ist 2.
 * Prüfungen (Inhalt, Belege, Konzept) macht der Aufrufer vorher. Rückgabe: Karte und Zustand.
 */
export async function insertCardWithState(tx: Tx, input: NewCard): Promise<CardWithState> {
  const [cardRow] = await tx
    .insert(card)
    .values({
      id: input.id,
      userId: SINGLE_USER_ID,
      conceptId: input.conceptId,
      kind: input.content.kind,
      stage: 2,
      front: input.content.front,
      back: input.content.back,
      sources: input.sources,
      origin: input.origin,
      suspended: false,
      inboxItemId: input.origin === 'ki' ? (input.inboxItemId ?? null) : null,
    })
    .returning();
  const empty = emptyCardState(input.now);
  const [stateRow] = await tx
    .insert(cardState)
    .values({
      id: uuidv7(),
      userId: SINGLE_USER_ID,
      cardId: input.id,
      state: empty.state,
      due: empty.due,
      stability: empty.stability,
      difficulty: empty.difficulty,
      elapsedDays: empty.elapsedDays,
      scheduledDays: empty.scheduledDays,
      learningSteps: empty.learningSteps,
      reps: empty.reps,
      lapses: empty.lapses,
      lastReview: empty.lastReview,
    })
    .returning();
  return { card: cardRow!, state: stateRow! };
}

/** Name des verletzten Unique-Constraints (`pg` 23505), auch verpackt */
export function uniqueViolation(error: unknown): string | null {
  for (let e: unknown = error, depth = 0; e && depth < 3; depth += 1) {
    const info = e as { code?: unknown; constraint_name?: unknown };
    if (info.code === '23505')
      return typeof info.constraint_name === 'string' ? info.constraint_name : 'unbekannt';
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

const cardExists = () => new HttpError(409, 'card_exists', 'Diese Karten-ID ist schon vergeben.');

/**
 * `POST /cards` (von Hand, `origin = manuell`, §21.4). Das Konzept muss existieren (`404 concept_not_found`) und `aktiv` sein
 * (`409 concept_not_active` mit `details.status`, bei einer Hülle `details.merged_into`). Inhalt säubern und prüfen
 * (`400 card_invalid`), Belege prüfen (`400 card_source_invalid`), die ID darf nicht vergeben sein (`409 card_exists`).
 * Keine Dublettenprüfung: Wer von Hand anlegt, entscheidet selbst.
 */
export async function createCard(db: Db, input: CardCreate, now: Date): Promise<Card> {
  try {
    return await db.transaction(async (tx) => {
      // FOR SHARE: Ein gleichzeitiges Zurückstufen oder Zusammenführen des Konzepts wartet, bis die Karte steht (§21.7)
      const [target] = await tx
        .select({ id: concept.id, status: concept.status, mergedInto: concept.mergedInto })
        .from(concept)
        .where(and(eq(concept.id, input.concept_id), notDeleted(concept)))
        .for('share');
      if (!target) throw conceptNotFound();
      if (target.status !== 'aktiv') {
        throw new HttpError(409, 'concept_not_active', 'Karten gibt es nur zu aktiven Konzepten.', {
          status: target.status,
          ...(target.status === 'zusammengefuehrt' ? { merged_into: target.mergedInto } : {}),
        });
      }
      const content = normalizeCardContent(input.content);
      await assertCardSources(tx, input.sources);
      const id = input.id ?? uuidv7();
      const [taken] = await tx.select({ id: card.id }).from(card).where(eq(card.id, id));
      if (taken) throw cardExists();
      const created = await insertCardWithState(tx, {
        id,
        conceptId: input.concept_id,
        content,
        sources: input.sources,
        origin: 'manuell',
        now,
      });
      const [api] = await loadApiCards(tx, [created]);
      return api!;
    });
  } catch (error) {
    if (uniqueViolation(error) === 'card_pkey') throw cardExists();
    throw error;
  }
}

// --- Ändern -------------------------------------------------------------------------------------

/**
 * `PATCH /cards/{id}`: `content` ersetzt Vorder- und Rückseite (auch mit anderem `kind`), `sources` ersetzt die Belege,
 * `suspended` pausiert bzw. setzt fort. FSRS-Zustand, `review_log` und `origin` bleiben. Mindestens ein Feld, sonst
 * `400 validation_failed`. Die letzte Änderung gilt (kein `version`-Feld).
 */
export async function updateCard(db: Db, id: string, update: CardUpdate): Promise<Card> {
  if (update.content === undefined && update.sources === undefined && update.suspended === undefined) {
    throw new HttpError(400, 'validation_failed', 'Mindestens ein Feld muss angegeben werden.');
  }
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: card.id })
      .from(card)
      .where(and(eq(card.id, id), notDeleted(card)))
      .for('update');
    if (!existing) throw cardNotFound();
    const set: Partial<typeof card.$inferInsert> = {};
    if (update.content !== undefined) {
      const content = normalizeCardContent(update.content);
      set.kind = content.kind;
      set.front = content.front;
      set.back = content.back;
    }
    if (update.sources !== undefined) {
      await assertCardSources(tx, update.sources);
      set.sources = update.sources;
    }
    if (update.suspended !== undefined) set.suspended = update.suspended;
    await tx
      .update(card)
      .set({ ...set, updatedAt: sql`now()` })
      .where(eq(card.id, id));
    const api = await loadApiCard(tx, id);
    return api!;
  });
}

/** Zeile der nicht gelöschten Karte (für Routen und Tests), sonst `null` */
export async function findCardRow(db: DbOrTx, id: string): Promise<CardRow | null> {
  const [row] = await db
    .select()
    .from(card)
    .where(and(eq(card.id, id), isNull(card.deletedAt)));
  return row ?? null;
}
