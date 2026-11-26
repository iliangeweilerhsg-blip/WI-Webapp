// `GET /search` (VERTRAEGE §19.6, F-SUC-01): Wortsuche und Bedeutungssuche über `search_chunk`, gemischt per
// Reciprocal Rank Fusion. Ticket T2-12.
//
// Ablauf: Präfixe auflösen → Wörter → Wortsuche (Top 50) und, parallel gestartet, der Vektor der Anfrage über den
// Worker → Bedeutungssuche (Top 50) → RRF → Details mit Ausschnitt nur für die besten `limit` Treffer.
// Das Modul kommt immer über den Join `slide_deck.module_id` bzw. `session.module_id` (nie aus einer Kopie).
import { sql, type SQL } from 'drizzle-orm';
import type { SearchHit, SearchKind, SearchResponse, SearchSnippetPart } from '@sg/shared';
import type { Db } from '../db/client.ts';
import { HttpError } from '../errors.ts';
import { WorkerError, type WorkerClient, type WorkerErrorCode } from '../lib/worker-client.ts';
import { isoTs } from './sessions.ts';

/** Kandidaten je Teil (§19.6 Schritte 3 und 4) */
export const CANDIDATES = 50;
/** Mindest-Cosinus-Ähnlichkeit der Bedeutungssuche (§19.6 Schritt 4) */
export const MIN_VECTOR_SIM = 0.45;
/** Konstante der Reciprocal Rank Fusion (§19.6 Schritt 5) */
export const RRF_K = 60;
/** Höchstens so viele Wörter gehen in die Anfrage (§19.6 Schritt 2) */
export const MAX_WORDS = 8;
/** `hnsw.ef_search` der Suche ohne Filter (§19.6 Schritt 4) */
export const HNSW_EF_SEARCH = 100;

/** Markierungen für `ts_headline`. Echte Steuerzeichen, als Parameter übergeben (§19.6 Schritt 7) */
const START_SEL = '\u0001';
const STOP_SEL = '\u0002';
export const HEADLINE_OPTIONS = `StartSel=${START_SEL}, StopSel=${STOP_SEL}, MaxWords=30, MinWords=12, ShortWord=2, MaxFragments=1`;
const ELLIPSIS = '…';

const WORD_RE = /[\p{L}\p{N}]+/gu;
const HAS_WORD_RE = /[\p{L}\p{N}]/u;
const PREFIX_RE = /^(fach|typ|semester):(.*)$/isu;

const TYP_VALUES: Record<string, SearchKind> = { folie: 'slide', gesagtes: 'transcript' };
/** Reihenfolge der Arten in `filters.kinds` */
const KIND_ORDER: readonly SearchKind[] = ['slide', 'transcript'];

// ---------------------------------------------------------------------------------------------
// Anfrage zerlegen (rein, ohne Datenbank)
// ---------------------------------------------------------------------------------------------

export interface FachFilter {
  /** Präfix wörtlich, wie getippt (nach NFC), z. B. `fach:DBS` */
  token: string;
  /** Wert nach `fach:` */
  value: string;
}

export interface ParsedQuery {
  /** Suchtext ohne Präfixe (Tokens mit einem Leerzeichen verbunden) */
  text: string;
  fach: FachFilter[];
  kinds: SearchKind[];
  /** Präfixe, die schon ohne Datenbank nichts treffen (leeres `fach:`, unbekannter `typ:`, `semester:`) */
  unresolved: string[];
  /** Wörter des Suchtexts, höchstens `MAX_WORDS` */
  words: string[];
  /** `:*` am letzten Wort (`q` endet nicht auf Leerraum) */
  prefixLast: boolean;
}

/** §19.6 Schritte 0–2: NFC, Präfixe, Wörter */
export function parseSearchQuery(q: string): ParsedQuery {
  const normalized = q.normalize('NFC');
  const prefixLast = !/\s$/u.test(normalized);
  const tokens = normalized.trim().split(/\s+/u).filter(Boolean);
  const rest: string[] = [];
  const fach: FachFilter[] = [];
  const kinds = new Set<SearchKind>();
  const unresolved: string[] = [];
  for (const token of tokens) {
    const match = PREFIX_RE.exec(token);
    if (!match) {
      rest.push(token);
      continue;
    }
    const name = match[1]!.toLowerCase();
    const value = match[2]!;
    if (name === 'fach') {
      if (value === '') unresolved.push(token);
      else fach.push({ token, value });
    } else if (name === 'typ') {
      const kind = TYP_VALUES[value.toLowerCase()];
      if (kind) kinds.add(kind);
      else unresolved.push(token);
    } else {
      // `semester:` gibt es in diesem Schnitt noch nicht (§19, „Nicht Teil dieses Schnitts“)
      unresolved.push(token);
    }
  }
  const text = rest.join(' ');
  const words = (text.match(WORD_RE) ?? []).slice(0, MAX_WORDS);
  return {
    text,
    fach,
    kinds: KIND_ORDER.filter((k) => kinds.has(k)),
    unresolved,
    words,
    prefixLast,
  };
}

/**
 * Text für `to_tsquery` (§19.6 Schritt 3): `w1 & w2 & … & wn:*`. Die Wörter bestehen nur aus Buchstaben und Ziffern,
 * die Syntax von `to_tsquery` kann so nicht verletzt werden. `null` ohne Wörter.
 */
export function tsQueryText(words: string[], prefixLast: boolean): string | null {
  if (words.length === 0) return null;
  return words.map((w, i) => (prefixLast && i === words.length - 1 ? `${w}:*` : w)).join(' & ');
}

/** Bedeutungssuche nur mit mindestens einem Wort ab 2 Zeichen (§19.6 Schritt 4) */
export function wantsVectorSearch(words: string[]): boolean {
  return words.some((w) => [...w].length >= 2);
}

export interface FusedHit {
  id: string;
  score: number;
}

/**
 * Reciprocal Rank Fusion (§19.6 Schritt 5): `score = Σ 1 / (k + rang)` über beide Listen (Rang ab 1).
 * Absteigend nach `score`, bei Gleichstand nach `chunk_id` aufsteigend.
 */
export function fuseRrf(lists: string[][], k = RRF_K): FusedHit[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Ergebnis von `ts_headline` in Teile zerlegen (§19.6 Schritt 7). Leere Teile entfallen. Liegt der Ausschnitt nicht am
 * Anfang von `text`, beginnt er mit `… `, liegt er nicht am Ende, endet er mit ` …` (jeweils als Teil ohne `hit`,
 * mit einem angrenzenden Teil ohne `hit` zusammengelegt). „Am Anfang/Ende“ heißt: davor bzw. danach steht kein
 * Buchstabe und keine Ziffer mehr. `ts_headline` lässt Satzzeichen am Rand weg; die werden dann wieder angefügt.
 */
export function splitHeadline(headline: string, text: string): SearchSnippetPart[] {
  const parts: SearchSnippetPart[] = [];
  let hit = false;
  let current = '';
  const flush = () => {
    if (current) parts.push({ text: current, hit });
    current = '';
  };
  for (const char of headline) {
    if (char === START_SEL) {
      flush();
      hit = true;
    } else if (char === STOP_SEL) {
      flush();
      hit = false;
    } else {
      current += char;
    }
  }
  flush();

  const plain = parts.map((p) => p.text).join('');
  // Bekannter Randfall: Kommt derselbe Ausschnitt mehrfach im Text vor, nimmt `indexOf` das erste Vorkommen. Stammt
  // der Ausschnitt aus einem späteren, fehlt dann ggf. das `… ` vorn bzw. steht ein `… ` hinten zu viel. Nur die
  // Anzeige ist betroffen; bei echten Texten mit 12–30 Wörtern je Ausschnitt praktisch ausgeschlossen. Kommt der
  // Ausschnitt gar nicht wörtlich vor, gibt es kein `…`.
  const at = plain ? text.indexOf(plain) : -1;
  let before = '';
  let after = '';
  if (at >= 0) {
    const head = text.slice(0, at);
    const tail = text.slice(at + plain.length);
    before = HAS_WORD_RE.test(head) ? `${ELLIPSIS} ` : head;
    after = HAS_WORD_RE.test(tail) ? ` ${ELLIPSIS}` : tail;
  }
  if (before) {
    if (parts[0] && !parts[0].hit) parts[0] = { text: before + parts[0].text, hit: false };
    else parts.unshift({ text: before, hit: false });
  }
  if (after) {
    const last = parts[parts.length - 1];
    if (last && !last.hit) parts[parts.length - 1] = { text: last.text + after, hit: false };
    else parts.push({ text: after, hit: false });
  }
  return parts;
}

// ---------------------------------------------------------------------------------------------
// Datenbank
// ---------------------------------------------------------------------------------------------

export interface SearchInput {
  q: string;
  moduleId?: string | undefined;
  limit: number;
}

export interface SearchDeps {
  db: Db;
  worker: Pick<WorkerClient, 'embed'>;
  /** `max_parallel_workers_per_gather` der Suche (0–4, Standard 2) */
  parallelWorkers?: number | undefined;
  /** `statement_timeout` je Such-Abfrage in ms (Standard 2000) */
  statementTimeoutMs?: number | undefined;
}

interface SearchTuning {
  workers: number;
  timeoutMs: number;
}

export interface ResolvedFilters {
  /** `null`: alle Module */
  moduleIds: string[] | null;
  kinds: SearchKind[];
  unresolved: string[];
}

async function modulesFor(db: Db, value: string): Promise<string[]> {
  const byShort = await db.execute<{ id: string }>(
    sql`SELECT id FROM module WHERE deleted_at IS NULL AND lower(short_name) = lower(${value}) ORDER BY id`,
  );
  if (byShort.length > 0) return byShort.map((r) => r.id);
  const byName = await db.execute<{ id: string }>(
    sql`SELECT id FROM module WHERE deleted_at IS NULL AND starts_with(lower(name), lower(${value})) ORDER BY id`,
  );
  return byName.map((r) => r.id);
}

/** §19.6 Schritt 1: `fach:` und `module_id` gegen die Datenbank auflösen */
async function resolveFilters(
  db: Db,
  parsed: ParsedQuery,
  moduleId: string | undefined,
): Promise<ResolvedFilters> {
  const unresolved = [...parsed.unresolved];
  let fachIds: Set<string> | null = null;
  const resolvedFach: string[] = [];
  for (const filter of parsed.fach) {
    const ids = await modulesFor(db, filter.value);
    if (ids.length === 0) {
      unresolved.push(filter.token);
      continue;
    }
    resolvedFach.push(filter.token);
    // Mehrere `fach:` vereinigen sich (wie `typ:`)
    fachIds ??= new Set<string>();
    for (const id of ids) fachIds.add(id);
  }

  let moduleIds: string[] | null = fachIds ? [...fachIds].sort() : null;
  if (moduleId !== undefined) {
    const [row] = await db.execute<{ id: string }>(
      sql`SELECT id FROM module WHERE id = ${moduleId} AND deleted_at IS NULL`,
    );
    if (!row) {
      unresolved.push(`module_id:${moduleId}`);
    } else if (fachIds) {
      // Schnittmenge leer → der `fach:`-Filter ist nicht aufgelöst (nie `module_ids: []`, das hieße „alle“)
      if (fachIds.has(moduleId)) moduleIds = [moduleId];
      else {
        unresolved.push(...resolvedFach);
        moduleIds = [];
      }
    } else {
      moduleIds = [moduleId];
    }
  }
  return { moduleIds, kinds: parsed.kinds, unresolved };
}

/** Die drei Konfigurationen, direkt in der Abfrage (keine CTE, §19.6 Schritt 3) */
function tsQuery(text: string): SQL {
  return sql`(to_tsquery('german'::regconfig, ${text}) || to_tsquery('english'::regconfig, ${text}) || to_tsquery('simple'::regconfig, ${text}))`;
}

/** Einträge mit Foliensatz bzw. Session und Modul. LEFT JOIN: genau eine der Spalten `deck_id`/`session_id` ist gesetzt */
const FROM_CHUNKS = sql`search_chunk c
  LEFT JOIN slide_deck d ON d.id = c.deck_id
  LEFT JOIN session s ON s.id = c.session_id
  JOIN module m ON m.id = coalesce(d.module_id, s.module_id)`;

/** §19.6 Schritt 6: nichts Gelöschtes (Eintrag, Foliensatz bzw. Session, Modul) */
const ALIVE = sql`c.deleted_at IS NULL AND d.deleted_at IS NULL AND s.deleted_at IS NULL AND m.deleted_at IS NULL`;

function filterSql(filters: ResolvedFilters): SQL {
  const parts: SQL[] = [ALIVE];
  if (filters.kinds.length > 0) {
    parts.push(
      sql`c.source_kind IN (${sql.join(
        filters.kinds.map((k) => sql`${k}`),
        sql`, `,
      )})`,
    );
  }
  if (filters.moduleIds) {
    const ids = sql.join(
      filters.moduleIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    // Über die btree-Indizes auf `deck_id`/`session_id` (§19.6 Schritt 4, „Mit Filter“)
    parts.push(
      sql`(c.deck_id IN (SELECT dd.id FROM slide_deck dd WHERE dd.module_id IN (${ids}))
           OR c.session_id IN (SELECT ss.id FROM session ss WHERE ss.module_id IN (${ids})))`,
    );
  }
  return sql.join(parts, sql` AND `);
}

const hasFilter = (filters: ResolvedFilters): boolean =>
  filters.kinds.length > 0 || filters.moduleIds !== null;

/** Obergrenze für eine einzelne Such-Abfrage; danach bricht Postgres sie ab (SQLSTATE 57014) */
export const STATEMENT_TIMEOUT_MS = 2000;
/** Standard für `max_parallel_workers_per_gather` der Suche (`SG_SEARCH_WORKERS`) */
export const DEFAULT_PARALLEL_WORKERS = 2;

type Setting = readonly [name: string, value: string];

/**
 * Planer-Einstellungen für die beiden Abfragen, die bei großem Bestand fast jede Zeile von `search_chunk` anfassen
 * (#334): Der Planer kennt die Kosten nicht, `tsv` (und `embedding`) aus TOAST zu holen, und wählt für häufige Begriffe
 * einen Seq Scan auf einer einzigen Verbindung. Parallele Worker verteilen das Auspacken auf mehrere Kerne. Die
 * Ergebnisse bleiben gleich (nur der Plan ändert sich). Die Einstellungen gelten nur bis zum Ende der Transaktion
 * (`set_config(…, true)` = `SET LOCAL`). Die Obergrenze der Worker setzt man ausdrücklich, damit der Postgres-Standard
 * (2) sie nicht stillschweigend bestimmt.
 */
export function parallelSettings(workers: number): Setting[] {
  return [
    ['max_parallel_workers_per_gather', String(workers)],
    ['parallel_setup_cost', '0'],
    ['parallel_tuple_cost', '0'],
    ['min_parallel_table_scan_size', '0'],
    ['min_parallel_index_scan_size', '0'],
  ];
}

/**
 * Wortsuche zusätzlich ohne Seq Scan: Über den GIN-Index (Bitmap Heap Scan) wird `tsv` nur einmal ausgepackt. Beim
 * Seq Scan geschähe das zweimal, einmal für `@@` und einmal für `ts_rank_cd`. Ohne passenden Index bleibt der Seq Scan
 * möglich (`enable_seqscan = off` verteuert ihn nur).
 */
export function textSettings(workers: number): Setting[] {
  return [['enable_seqscan', 'off'], ...parallelSettings(workers)];
}

/** SQLSTATE 57014 (`query_canceled`, auch bei `statement_timeout`). drizzle verpackt den Fehler von postgres.js in `cause`. */
function isStatementTimeout(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth += 1) {
    if ((e as { code?: unknown }).code === '57014') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Eine Transaktion mit allen Einstellungen in einem einzigen Aufruf (`set_config(…, true)`: ein Roundtrip statt je
 * einem `SET LOCAL`) und dem Zeitlimit `statement_timeout`. Läuft eine Abfrage darüber hinaus, wird sie abgebrochen:
 * `503 search_timeout` ohne SQL-Text oder sonstige Einzelheiten.
 */
export async function withSettings<T>(
  db: Db,
  settings: readonly Setting[],
  timeoutMs: number,
  fn: (tx: Pick<Db, 'execute'>) => Promise<T>,
): Promise<T> {
  const all: Setting[] = [['statement_timeout', `${timeoutMs}ms`], ...settings];
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT ${sql.join(
          all.map(([name, value]) => sql`set_config(${name}, ${value}, true)`),
          sql`, `,
        )}`,
      );
      return fn(tx);
    });
  } catch (error) {
    if (isStatementTimeout(error)) {
      throw new HttpError(
        503,
        'search_timeout',
        'Die Suche hat zu lange gedauert. Bitte später erneut versuchen.',
      );
    }
    throw error;
  }
}

/** Abfrage der Wortsuche, exportiert für den Plan-Test: die besten `CANDIDATES` nach `ts_rank_cd` (Gleichstand nach ID) */
export function textQuery(tsText: string, filters: ResolvedFilters): SQL {
  return sql`SELECT c.id FROM ${FROM_CHUNKS}
        WHERE ${filterSql(filters)} AND c.tsv @@ ${tsQuery(tsText)}
        ORDER BY ts_rank_cd(c.tsv, ${tsQuery(tsText)}) DESC, c.id
        LIMIT ${CANDIDATES}`;
}

/** Wortsuche */
async function textCandidates(
  db: Db,
  tsText: string,
  filters: ResolvedFilters,
  tuning: SearchTuning,
): Promise<string[]> {
  const rows = await withSettings(db, textSettings(tuning.workers), tuning.timeoutMs, (tx) =>
    tx.execute<{ id: string }>(textQuery(tsText, filters)),
  );
  return rows.map((r) => r.id);
}

/**
 * Abfrage der Bedeutungssuche (§19.6 Schritt 4), exportiert für den Plan-Test. Ohne Filter über HNSW (der Aufrufer
 * setzt `SET LOCAL hnsw.ef_search` in derselben Transaktion), mit Filter exakt (MATERIALIZED: der Planer kann die
 * Sortierung nicht an den HNSW-Index geben, der erst nach dem Suchen filtert und dann zu wenige Treffer liefert).
 */
export function vectorQuery(vector: number[], model: string, filters: ResolvedFilters): SQL {
  const literal = `[${vector.join(',')}]`;
  if (hasFilter(filters)) {
    return sql`WITH cand AS MATERIALIZED (
        SELECT c.id, c.embedding <=> ${literal}::vector AS dist FROM ${FROM_CHUNKS}
        WHERE ${filterSql(filters)} AND c.embedding IS NOT NULL AND c.embedding_model = ${model}
      )
      SELECT id, dist FROM cand WHERE dist <= ${1 - MIN_VECTOR_SIM} ORDER BY dist, id LIMIT ${CANDIDATES}`;
  }
  return sql`SELECT c.id, c.embedding <=> ${literal}::vector AS dist FROM ${FROM_CHUNKS}
      WHERE ${ALIVE} AND c.embedding_model = ${model}
      ORDER BY c.embedding <=> ${literal}::vector
      LIMIT ${CANDIDATES}`;
}

/** Bedeutungssuche: die `CANDIDATES` nächsten mit gleichem Modell und Ähnlichkeit ≥ `MIN_VECTOR_SIM` */
async function vectorCandidates(
  db: Db,
  vector: number[],
  model: string,
  filters: ResolvedFilters,
  tuning: SearchTuning,
): Promise<string[]> {
  const maxDistance = 1 - MIN_VECTOR_SIM;
  const query = vectorQuery(vector, model, filters);
  const settings: Setting[] = hasFilter(filters)
    ? parallelSettings(tuning.workers)
    : [['hnsw.ef_search', String(HNSW_EF_SEARCH)]];
  const rows = await withSettings(db, settings, tuning.timeoutMs, (tx) =>
    tx.execute<{ id: string; dist: number }>(query),
  );
  return rows
    .map((r) => ({ id: r.id, dist: Number(r.dist) }))
    .filter((r) => Number.isFinite(r.dist) && r.dist <= maxDistance)
    .sort((a, b) => a.dist - b.dist || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => r.id);
}

type DetailRow = {
  id: string;
  source_kind: SearchKind;
  deck_id: string | null;
  session_id: string | null;
  slide_index: number | null;
  title: string | null;
  t_ms: string | number | null;
  t_end_ms: string | number | null;
  text: string;
  module_id: string;
  module_name: string;
  module_short_name: string | null;
  deck_title: string | null;
  session_number: number | null;
  session_title: string | null;
  session_started_at: Date | string | null;
  headline: string;
};

async function details(db: Db, ids: string[], tsText: string): Promise<Map<string, DetailRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db.execute<DetailRow>(
    sql`SELECT c.id, c.source_kind, c.deck_id, c.session_id, c.slide_index, c.title, c.t_ms, c.t_end_ms, c.text,
               m.id AS module_id, m.name AS module_name, m.short_name AS module_short_name,
               d.title AS deck_title, s.number AS session_number, s.title AS session_title,
               s.started_at AS session_started_at,
               ts_headline(c.ts_config::regconfig, c.text, ${tsQuery(tsText)}, ${HEADLINE_OPTIONS}) AS headline
        FROM ${FROM_CHUNKS}
        WHERE c.id IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) AND ${ALIVE}`,
  );
  return new Map(rows.map((r) => [r.id, r]));
}

function toHit(row: DetailRow, score: number): SearchHit {
  const base = {
    chunk_id: row.id,
    score,
    module: { id: row.module_id, name: row.module_name, short_name: row.module_short_name },
    snippet: splitHeadline(row.headline, row.text),
  };
  if (row.source_kind === 'slide') {
    return {
      kind: 'slide',
      ...base,
      deck_id: row.deck_id!,
      deck_title: row.deck_title ?? '',
      slide_index: row.slide_index!,
      slide_title: row.title,
    };
  }
  const started = row.session_started_at;
  return {
    kind: 'transcript',
    ...base,
    session_id: row.session_id!,
    session_number: row.session_number,
    session_title: row.session_title,
    session_started_at: started ? isoTs(started instanceof Date ? started : new Date(started)) : null,
    t_ms: Number(row.t_ms),
    t_end_ms: Number(row.t_end_ms),
  };
}

/** `GET /search` (§19.6) */
export async function search(deps: SearchDeps, input: SearchInput): Promise<SearchResponse> {
  const started = performance.now();
  const parsed = parseSearchQuery(input.q);
  const filters = await resolveFilters(deps.db, parsed, input.moduleId);
  const response = (
    hits: SearchHit[],
    mode: SearchResponse['mode'],
    degraded: SearchResponse['degraded'],
  ): SearchResponse => ({
    query: parsed.text,
    mode,
    degraded,
    filters: { module_ids: filters.moduleIds ?? [], kinds: filters.kinds, unresolved: filters.unresolved },
    hits,
    took_ms: Math.max(0, Math.round(performance.now() - started)),
  });

  const tsText = tsQueryText(parsed.words, parsed.prefixLast);
  // Ein Präfix, das nichts trifft, macht die Trefferliste leer; ohne Wörter gibt es nichts zu suchen
  if (filters.unresolved.length > 0 || tsText === null) return response([], 'text', null);

  const tuning: SearchTuning = {
    workers: deps.parallelWorkers ?? DEFAULT_PARALLEL_WORKERS,
    timeoutMs: deps.statementTimeoutMs ?? STATEMENT_TIMEOUT_MS,
  };
  // Vektor parallel zur Wortsuche holen (Zeitlimit 800 ms im Client)
  const embedding: Promise<{ vector: number[]; model: string } | WorkerErrorCode> | null = wantsVectorSearch(
    parsed.words,
  )
    ? deps.worker.embed([parsed.words.join(' ')]).then(
        (r) => ({ vector: r.vectors[0]!, model: r.model }),
        (error: unknown) => (error instanceof WorkerError ? error.code : 'embedder_unavailable'),
      )
    : null;

  // Wort- und Bedeutungssuche laufen nebeneinander (eigene Verbindungen aus dem Pool)
  type VectorPart = { ids: string[] } | { degraded: WorkerErrorCode } | null;
  const vectorPart: Promise<VectorPart> = embedding
    ? embedding.then(async (result) =>
        typeof result === 'string'
          ? { degraded: result }
          : { ids: await vectorCandidates(deps.db, result.vector, result.model, filters, tuning) },
      )
    : Promise.resolve(null);
  const [textIds, vector] = await Promise.all([textCandidates(deps.db, tsText, filters, tuning), vectorPart]);
  const vectorIds = vector && 'ids' in vector ? vector.ids : [];
  const mode: SearchResponse['mode'] = vector && 'ids' in vector ? 'hybrid' : 'text';
  const degraded: SearchResponse['degraded'] = vector && 'degraded' in vector ? vector.degraded : null;

  const fused = fuseRrf([textIds, vectorIds]).slice(0, input.limit);
  const rows = await details(
    deps.db,
    fused.map((f) => f.id),
    tsText,
  );
  const hits = fused.flatMap((f) => {
    const row = rows.get(f.id);
    return row ? [toHit(row, f.score)] : [];
  });
  return response(hits, mode, degraded);
}
