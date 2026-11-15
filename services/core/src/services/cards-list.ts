// Karten verwalten (VERTRAEGE §21.14): `GET /cards` und `POST /cards/bulk`. Ticket „Karten verwalten“ (F-LRN-16, schmal).
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type {
  CardBulkAction,
  CardBulkResult,
  CardBulkSkipped,
  CardKind,
  CardListItem,
  CardListSort,
  CardListStatus,
  CardOrigin,
  CardPage,
  SearchModuleRef,
} from '@sg/shared';
import type { Db, DbOrTx } from '../db/client.ts';
import { card, cardState, concept, notDeleted } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { HARD_DIFFICULTY, HARD_LAPSES } from '../learning/params.ts';
import { afterCursor, cursorTs, decodeCursor } from '../lib/pagination.ts';
import { loadApiCards } from './cards.ts';
import { softDelete } from './trash.ts';

/** Höchstzahl der Module je Karte in der Liste */
export const CARD_LIST_MODULE_LIMIT = 10;

export interface ListCardsOptions {
  moduleId?: string | undefined;
  conceptId?: string | undefined;
  kinds?: readonly CardKind[] | undefined;
  origin?: CardOrigin | undefined;
  status: CardListStatus;
  q?: string | undefined;
  sort: CardListSort;
  cursor?: string | undefined;
  limit: number;
}

const invalidCursor = () => new HttpError(400, 'invalid_cursor', 'Der Cursor ist ungültig.');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INT_MAX = 2147483647;
const INT_RE = /^\d{1,10}$/;
const FLOAT_RE = /^\d+(\.\d+)?([eE][+-]?\d+)?$/;
const FLOAT_MAX_LENGTH = 32;

/** Präfix im Cursor je Sortierung: ein Cursor einer anderen Sortierung ergibt `400 invalid_cursor` */
const CURSOR_PREFIX: Record<CardListSort, string> = { neu: 'n', faellig: 'f', schwer: 's' };

const encodeCardCursor = (sort: CardListSort, ...parts: string[]): string =>
  Buffer.from(JSON.stringify([CURSOR_PREFIX[sort], ...parts]), 'utf8').toString('base64url');

/** Cursor lesen, Präfix der Sortierung prüfen; liefert die Teile nach dem Präfix */
function parseCardCursor(raw: string, sort: CardListSort, parts: number): string[] {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === parts + 1 &&
      parsed[0] === CURSOR_PREFIX[sort] &&
      parsed.every((p) => typeof p === 'string')
    ) {
      return (parsed as string[]).slice(1);
    }
  } catch {
    // unten
  }
  throw invalidCursor();
}

/** Cursor von `neu` und `faellig`: `[Präfix, Zeit als Datenbank-Text, id]` (Zeit und id prüft `decodeCursor`) */
function decodeTimeCursor(raw: string, sort: CardListSort) {
  const [ts, id] = parseCardCursor(raw, sort, 2);
  return decodeCursor(Buffer.from(JSON.stringify([ts, id]), 'utf8').toString('base64url'));
}

/** Cursor der Sortierung `schwer`: `[s, lapses, difficulty, id]`, alles als Text (Gleitkommazahl verlustfrei) */
function decodeHardCursor(raw: string): { lapses: string; difficulty: string; id: string } {
  const [lapses, difficulty, id] = parseCardCursor(raw, 'schwer', 3) as [string, string, string];
  if (
    INT_RE.test(lapses) &&
    Number(lapses) <= INT_MAX &&
    difficulty.length <= FLOAT_MAX_LENGTH &&
    FLOAT_RE.test(difficulty) &&
    Number.isFinite(Number(difficulty)) &&
    UUID_RE.test(id)
  ) {
    return { lapses, difficulty, id };
  }
  throw invalidCursor();
}

/** `%`, `_` und `\` in Teilwort-Suchen wörtlich nehmen (wie `GET /concepts`, §20.6) */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

/** Module des Konzepts (nach Name, höchstens 10) als JSON-Array, ohne zweite Abfrage */
const modulesJson = sql<SearchModuleRef[]>`COALESCE((
  SELECT json_agg(json_build_object('id', m.id, 'name', m.name, 'short_name', m.short_name) ORDER BY m.name, m.id)
  FROM (
    SELECT cmod.id, cmod.name, cmod.short_name
    FROM concept_module cm
    JOIN module cmod ON cmod.id = cm.module_id AND cmod.deleted_at IS NULL
    WHERE cm.concept_id = ${concept.id} AND cm.deleted_at IS NULL
    ORDER BY cmod.name, cmod.id
    LIMIT ${CARD_LIST_MODULE_LIMIT}
  ) m
), '[]'::json)`;

/**
 * `GET /cards` (§21.14): Karten aktiver, nicht gelöschter Konzepte mit Filtern, Suche und Sortierung. Eine Abfrage je Seite
 * (Konzeptname und Module kommen per Unterabfrage mit), danach nur noch die gebündelte Prüfung der Belege (`missing`).
 */
export async function listCards(db: DbOrTx, options: ListCardsOptions): Promise<CardPage> {
  const conditions: (SQL | undefined)[] = [
    notDeleted(card),
    notDeleted(cardState),
    notDeleted(concept),
    eq(concept.status, 'aktiv'),
  ];
  if (options.conceptId) conditions.push(eq(card.conceptId, options.conceptId));
  if (options.moduleId) {
    conditions.push(sql`EXISTS (SELECT 1 FROM concept_module cm WHERE cm.concept_id = ${concept.id}
      AND cm.module_id = ${options.moduleId} AND cm.deleted_at IS NULL)`);
  }
  if (options.kinds && options.kinds.length > 0) conditions.push(inArray(card.kind, [...options.kinds]));
  if (options.origin) conditions.push(eq(card.origin, options.origin));
  switch (options.status) {
    case 'aktiv':
      conditions.push(eq(card.suspended, false));
      break;
    case 'pausiert':
      conditions.push(eq(card.suspended, true));
      break;
    case 'neu':
      conditions.push(eq(cardState.state, 'new'));
      break;
    case 'schwer':
      conditions.push(
        sql`${cardState.state} <> 'new' AND (${cardState.lapses} >= ${HARD_LAPSES} OR ${cardState.difficulty} >= ${HARD_DIFFICULTY})`,
      );
      break;
    case 'alle':
      break;
  }
  if (options.q !== undefined) {
    const pattern = likePattern(options.q);
    conditions.push(sql`(
      ${card.front}->>'text_md' ILIKE ${pattern}
      OR ${card.back}->>'text_md' ILIKE ${pattern}
      OR ${card.back}->>'explanation_md' ILIKE ${pattern}
      OR EXISTS (
        SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(${card.back}->'answers') = 'object' THEN ${card.back}->'answers' ELSE '{}'::jsonb END) AS gap(key, solutions)
        CROSS JOIN LATERAL jsonb_array_elements_text(gap.solutions) AS solution(text)
        WHERE solution.text ILIKE ${pattern}
      )
    )`);
  }

  // Sortierung und Cursor: `neu` über `(created_at, id)` absteigend (Zeit und id prüft `decodeCursor` aus lib/pagination), `faellig` über
  // `(due, id)` aufsteigend (mit `due::text`), `schwer` mit `[lapses, difficulty, id]`; jeder Cursor trägt ein Präfix der Sortierung.
  const keyTs = sql<string>`${cardState.due}::text`;
  const keyDifficulty = sql<string>`${cardState.difficulty}::text`;
  let orderBy: SQL[];
  if (options.sort === 'neu') {
    conditions.push(
      afterCursor(
        card.createdAt,
        card.id,
        options.cursor ? decodeTimeCursor(options.cursor, 'neu') : undefined,
        'desc',
      ),
    );
    orderBy = [sql`${card.createdAt} DESC`, sql`${card.id} DESC`];
  } else if (options.sort === 'faellig') {
    if (options.cursor) {
      const c = decodeTimeCursor(options.cursor, 'faellig');
      conditions.push(sql`(${cardState.due}, ${card.id}) > (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    orderBy = [sql`${cardState.due} ASC`, sql`${card.id} ASC`];
  } else {
    if (options.cursor) {
      const c = decodeHardCursor(options.cursor);
      conditions.push(sql`(
        ${cardState.lapses} < ${c.lapses}::int
        OR (${cardState.lapses} = ${c.lapses}::int AND ${cardState.difficulty} < ${c.difficulty}::float8)
        OR (${cardState.lapses} = ${c.lapses}::int AND ${cardState.difficulty} = ${c.difficulty}::float8 AND ${card.id} > ${c.id}::uuid)
      )`);
    }
    orderBy = [sql`${cardState.lapses} DESC`, sql`${cardState.difficulty} DESC`, sql`${card.id} ASC`];
  }

  const rows = await db
    .select({
      card,
      state: cardState,
      conceptName: concept.name,
      modules: modulesJson,
      createdKey: cursorTs(card.createdAt),
      dueKey: keyTs,
      difficultyKey: keyDifficulty,
    })
    .from(card)
    .innerJoin(cardState, eq(cardState.cardId, card.id))
    .innerJoin(concept, eq(concept.id, card.conceptId))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(options.limit + 1);

  const hasMore = rows.length > options.limit;
  const visible = hasMore ? rows.slice(0, options.limit) : rows;
  const apiCards = await loadApiCards(db, visible);
  const items: CardListItem[] = visible.map((row, i) => ({
    card: apiCards[i]!,
    concept: { id: row.card.conceptId, name: row.conceptName },
    modules: row.modules,
  }));
  const last = visible.at(-1);
  let nextCursor: string | null = null;
  if (hasMore && last) {
    if (options.sort === 'neu') nextCursor = encodeCardCursor('neu', last.createdKey, last.card.id);
    else if (options.sort === 'faellig') nextCursor = encodeCardCursor('faellig', last.dueKey, last.card.id);
    else {
      nextCursor = encodeCardCursor('schwer', String(last.state.lapses), last.difficultyKey, last.card.id);
    }
  }
  return { items, next_cursor: nextCursor };
}

/** Sperr-Abfrage des Bulk: `ORDER BY id` vor `FOR NO KEY UPDATE` (ohne die Reihenfolge drohen Verklemmungen); getrennt, damit ein Test das SQL prüft */
export const lockCardsQuery = (tx: DbOrTx, ids: readonly string[]) =>
  tx
    .select({ id: card.id, suspended: card.suspended })
    .from(card)
    .where(and(inArray(card.id, [...ids]), notDeleted(card)))
    .orderBy(card.id)
    .for('no key update');

/**
 * `POST /cards/bulk` (§21.14): Pausieren, Fortsetzen oder Löschen mehrerer Karten in einer Transaktion.
 *
 * Sperren: alle vorhandenen, nicht gelöschten Karten werden aufsteigend nach ID `FOR NO KEY UPDATE` gesperrt (kein 40P01
 * zwischen zwei Aufrufen mit überlappenden IDs), `card` immer vor `card_state` (§21.7). Löschen läuft je Karte über
 * `softDelete` (Papierkorb, §21.8) und sperrt dieselbe Zeile erneut (schon gehalten). Unbekannte oder gelöschte IDs und
 * Karten, die schon im Zielzustand sind, stehen in `skipped`. Doppelte IDs fängt das Schema ab (`400 validation_failed`).
 */
export async function bulkCards(
  db: Db,
  request: { ids: readonly string[]; action: CardBulkAction },
): Promise<CardBulkResult> {
  const ids = [...new Set(request.ids)].sort();
  return db.transaction(async (tx) => {
    const locked = await lockCardsQuery(tx, ids);
    const found = new Map(locked.map((r) => [r.id, r.suspended]));

    const changed: string[] = [];
    const skipped: CardBulkSkipped[] = [];
    for (const id of ids) {
      const suspended = found.get(id);
      if (suspended === undefined) skipped.push({ id, code: 'card_not_found' });
      else if ((request.action === 'suspend' && suspended) || (request.action === 'resume' && !suspended)) {
        skipped.push({ id, code: 'unchanged' });
      } else changed.push(id);
    }

    if (changed.length > 0) {
      if (request.action === 'delete') {
        for (const id of changed) await softDelete(tx, 'card', id);
      } else {
        await tx
          .update(card)
          .set({ suspended: request.action === 'suspend', updatedAt: sql`now()` })
          .where(inArray(card.id, changed));
      }
    }
    return { changed, skipped };
  });
}
