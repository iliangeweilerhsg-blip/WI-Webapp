// Regeln des Konzeptgraphen (VERTRAEGE §20.3 „Gemeinsame Regeln“, §20.6). Ticket T2-22b.
//
// Normieren und Namensgleichheit, Kreisprüfung für `baut_auf` und die Annahmen A1–A3 samt Rücknahme. Dieselben
// Regeln stehen im Worker (T2-21b, Automatik); beide Umsetzungen prüfen gegen `packages/schemas/fixtures/concepts/`.
//
// Alle schreibenden Funktionen laufen in der Transaktion des Aufrufers und setzen voraus, dass dieser die Sperren
// aus §20.6 hält: Session des Eintrags (`FOR SHARE`) → Eintrag (`FOR UPDATE`) → `lockConceptGraph`. Die Konzepte
// (`FOR NO KEY UPDATE`, nach ID sortiert) sperren die Funktionen selbst.
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type {
  AutoAcceptMode,
  ConceptEdit,
  ConceptKind,
  ConceptRelationKind,
  InboxDecision,
  InboxPayload,
  InboxStatus,
} from '@sg/shared';
import type { Tx } from '../db/client.ts';
import {
  concept,
  conceptModule,
  conceptRelation,
  evidence,
  inboxItem,
  notDeleted,
  setting,
} from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { CONCEPT_GRAPH_LOCK_KEY } from '../lib/locks.ts';
import { uuidv7 } from '../lib/uuid7.ts';

// --- Normieren und Namensgleichheit (§20.3) -------------------------------------------------------------

/** Steuerzeichen (Cc) außer Leerraum, wie `_CONTROL` im Worker (§19.3) */
// eslint-disable-next-line no-control-regex -- genau diese Zeichen werden entfernt
const CONTROL_RE = /[\u0000-\u0008\u000e-\u001b\u007f-\u0084\u0086-\u009f]/g;
const FORMAT_RE = /\p{Cf}/gu;
/** Leerraum wie `\s` in Python: JS-`\s` kennt U+001C–U+001F und U+0085 nicht */
// eslint-disable-next-line no-control-regex -- Leerraum wie in Python
const SPACE_RE = /[\s\u001c-\u001f\u0085]+/g;
const SUFFIX_RE = /\s*\([^()]*\)$/;

/** Normform: Steuer- und Formatzeichen entfernen, NFC, Leerraum zusammenfassen, trimmen */
export function normName(input: string): string {
  return input.replace(CONTROL_RE, '').replace(FORMAT_RE, '').normalize('NFC').replace(SPACE_RE, ' ').trim();
}

/** Vergleichsform: Normform in Kleinbuchstaben nach Unicode, ohne Gebietsschema (wie `str.lower()`) */
export function nameKey(input: string): string {
  return normName(input).toLowerCase();
}

/** Basisform: `key` ohne einen Klammerzusatz am Ende (einmal). Bleibt nichts übrig, gilt `key` */
export function nameBase(input: string): string {
  const key = nameKey(input);
  const base = key.replace(SUFFIX_RE, '');
  return base === '' ? key : base;
}

export interface Named {
  name: string;
  aliases?: readonly string[] | null | undefined;
}

function forms(named: Named, form: (value: string) => string): Set<string> {
  return new Set([named.name, ...(named.aliases ?? [])].map(form));
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

/** Namensgleich: ein `key` eines Namens oder Alias von `a` gleich einem `key` von `b` */
export function sameName(a: Named, b: Named): boolean {
  return intersects(forms(a, nameKey), forms(b, nameKey));
}

/** Namensähnlich: dasselbe mit `key` oder `base` */
export function similarName(a: Named, b: Named): boolean {
  const both = (named: Named) => new Set([...forms(named, nameKey), ...forms(named, nameBase)]);
  return intersects(both(a), both(b));
}

// --- Beziehungen: symmetrische Arten und Kreisprüfung (§20.1, Invariante 4) --------------------------------

export const SYMMETRIC_KINDS: readonly string[] = ['gegensatz', 'verwandt'];

/** Symmetrische Arten stehen immer mit `from_id < to_id` */
export function orderEndpoints(kind: string, fromId: string, toId: string): [string, string] {
  return SYMMETRIC_KINDS.includes(kind) && fromId > toId ? [toId, fromId] : [fromId, toId];
}

export interface Edge {
  from: string;
  to: string;
}

/**
 * Kreis, den die neue Kante `from baut_auf to` über die (bestätigten) Kanten `edges` schließen würde: kürzester
 * Weg von `to` nach `from` (Breitensuche ab `to`, Nachbarn nach ID aufsteigend), als `[from, to, …, from]`.
 * `null`, wenn `to` `from` nicht erreicht.
 */
export function findCycle(edges: readonly Edge[], from: string, to: string): string[] | null {
  if (from === to) return [from, from];
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const list = next.get(edge.from);
    if (list) list.push(edge.to);
    else next.set(edge.from, [edge.to]);
  }
  for (const list of next.values()) list.sort();
  const parent = new Map<string, string | null>([[to, null]]);
  const queue = [to];
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head]!;
    for (const neighbour of next.get(node) ?? []) {
      if (parent.has(neighbour)) continue;
      parent.set(neighbour, node);
      if (neighbour === from) {
        const back: string[] = [];
        for (let at: string | null = neighbour; at !== null; at = parent.get(at) ?? null) back.push(at);
        return [from, ...back.reverse()];
      }
      queue.push(neighbour);
    }
  }
  return null;
}

/** W-05: `importance` 1 | 2 | 3 → 0,8 | 1,0 | 1,3 */
export function importanceBase(importance: number): number {
  if (importance <= 1) return 0.8;
  return importance >= 3 ? 1.3 : 1.0;
}

// --- Sperren und Lesen ---------------------------------------------------------------------------------

/** Ein Eintrag oder eine Zeile ist gerade von einer anderen Transaktion gesperrt: alles zurück, neu versuchen */
export class BusyError extends Error {
  constructor() {
    super('Inbox-Eintrag ist gerade gesperrt');
    this.name = 'BusyError';
  }
}

/** Sperre für jede Annahme und jede Rücknahme (§20.6): nie zwei namensgleiche aktive Konzepte, nie ein Kreis */
export async function lockConceptGraph(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${CONCEPT_GRAPH_LOCK_KEY})`);
}

const conceptCols = {
  id: concept.id,
  userId: concept.userId,
  createdAt: concept.createdAt,
  updatedAt: concept.updatedAt,
  deletedAt: concept.deletedAt,
  name: concept.name,
  aliases: concept.aliases,
  kind: concept.kind,
  oneLiner: concept.oneLiner,
  status: concept.status,
  mergedInto: concept.mergedInto,
  proposalSessionId: concept.proposalSessionId,
  examRelevant: concept.examRelevant,
  importanceBase: concept.importanceBase,
};

export type ConceptRow = Awaited<ReturnType<typeof lockConcepts>> extends Map<string, infer R> ? R : never;
export type ItemRow = typeof inboxItem.$inferSelect;
type RelationRow = typeof conceptRelation.$inferSelect;

/** Konzepte nach ID sortiert mit `FOR NO KEY UPDATE` sperren (nie `FOR UPDATE`, §20.6). Auch gelöschte Zeilen */
export async function lockConcepts(tx: Tx, ids: readonly string[]) {
  const unique = [...new Set(ids)].sort();
  if (unique.length === 0) return new Map<string, never>();
  const rows = await tx
    .select(conceptCols)
    .from(concept)
    .where(inArray(concept.id, unique))
    .orderBy(asc(concept.id))
    .for('no key update');
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Weitere Einträge (Folgen einer Entscheidung) sperren, nach ID sortiert, mit `SKIP LOCKED`: Warten könnte sich mit
 * einem gleichzeitigen Einzel-Accept oder einer Massenaktion verklemmen (die halten ihren Eintrag und warten auf
 * die Graph-Sperre). `skip`: gesperrte Einträge fehlen im Ergebnis. `require`: `BusyError`, der Aufrufer rollt
 * zurück und versucht es neu.
 */
export async function lockItems(
  tx: Tx,
  ids: readonly string[],
  mode: 'skip' | 'require',
): Promise<Map<string, ItemRow>> {
  const unique = [...new Set(ids)].sort();
  if (unique.length === 0) return new Map();
  const where = and(inArray(inboxItem.id, unique), notDeleted(inboxItem));
  const locked = await tx
    .select()
    .from(inboxItem)
    .where(where)
    .orderBy(asc(inboxItem.id))
    .for('update', { skipLocked: true });
  if (mode === 'require' && locked.length < unique.length) {
    const visible = await tx.select({ id: inboxItem.id }).from(inboxItem).where(where);
    if (visible.length > locked.length) throw new BusyError();
  }
  return new Map(locked.map((row) => [row.id, row]));
}

const AUTO_ACCEPT_MODES: readonly AutoAcceptMode[] = ['aus', 'nur_beziehungen', 'alles_ab_0_9'];

/** `ai.auto_accept` direkt aus `setting` (§20.7). Fehlt oder ungültig: `aus` */
export async function readAutoAccept(tx: Tx): Promise<AutoAcceptMode> {
  const [row] = await tx
    .select({ value: setting.value })
    .from(setting)
    .where(and(eq(setting.key, 'ai'), notDeleted(setting)));
  const value = (row?.value as { auto_accept?: unknown } | null | undefined)?.auto_accept;
  return AUTO_ACCEPT_MODES.includes(value as AutoAcceptMode) ? (value as AutoAcceptMode) : 'aus';
}

export function emptyDecision(action: InboxDecision['action']): InboxDecision {
  return {
    action,
    concept_id: null,
    merged_into: null,
    moved_evidence_ids: [],
    added_aliases: [],
    added_module_ids: [],
    previous: null,
    relation_kind_before: null,
    cascade_item_ids: [],
    duplicate_of: null,
    triggered_by: null,
  };
}

/** Eintrag entscheiden (`decision` gesetzt) oder wieder öffnen (`decision = null`) */
export async function markItem(
  tx: Tx,
  id: string,
  status: InboxStatus,
  decision: InboxDecision | null,
): Promise<void> {
  const open = status === 'offen';
  await tx
    .update(inboxItem)
    .set({ status, decidedAt: open ? null : sql`now()`, decision: open ? null : decision })
    .where(eq(inboxItem.id, id));
}

const stale = (status: string) =>
  new HttpError(409, 'inbox_item_decided', 'Der Vorschlag ist nicht mehr offen.', { status });
const itemGone = () => new HttpError(404, 'inbox_item_not_found', 'Der Eintrag wurde nicht gefunden.');
const targetInvalid = () =>
  new HttpError(409, 'merge_target_invalid', 'Das Ziel der Zusammenführung ist kein aktives Konzept.');
const reopenConflict = (message: string, details?: Record<string, unknown>) =>
  new HttpError(409, 'inbox_reopen_conflict', message, details);

function live<T extends { deletedAt: Date | null }>(row: T | undefined): T | undefined {
  return row && !row.deletedAt ? row : undefined;
}

/** Vorschlag `P` eines offenen Konzept-Eintrags unter der Sperre */
function requireProposal(row: ConceptRow | undefined): ConceptRow {
  const found = live(row);
  if (!found) throw itemGone();
  if (found.status !== 'vorschlag') throw stale(found.status);
  return found;
}

// --- A1: neues Konzept annehmen ------------------------------------------------------------------------

function invalid(message: string): HttpError {
  return new HttpError(400, 'validation_failed', message);
}

const chars = (value: string): number => [...value].length;

/** Aliase normieren: leere weg, keine Dubletten, nicht der Name selbst */
function cleanAliases(aliases: readonly string[], name: string): string[] {
  const seen = new Set([nameKey(name)]);
  const result: string[] = [];
  for (const raw of aliases) {
    const alias = normName(raw);
    const key = alias.toLowerCase();
    if (alias === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
  }
  return result;
}

interface EditedFields {
  name: string;
  aliases: string[];
  oneLiner: string | null;
  kind: string | null;
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/** Vorschlag in der Fassung nach `edit`, dazu die alten Werte der geänderten Felder (`decision.previous`) */
function applyEdit(
  p: ConceptRow,
  edit: ConceptEdit | undefined,
): { next: EditedFields; previous: ConceptEdit | null; textChanged: boolean } {
  const next: EditedFields = { name: p.name, aliases: p.aliases, oneLiner: p.oneLiner, kind: p.kind };
  if (edit) {
    if (edit.name !== undefined) {
      next.name = normName(edit.name);
      if (next.name === '' || chars(next.name) > 200) throw invalid('Der Name ist leer oder zu lang.');
    }
    if (edit.name !== undefined || edit.aliases !== undefined) {
      next.aliases = cleanAliases(edit.aliases ?? p.aliases, next.name);
      if (next.aliases.some((alias) => chars(alias) > 200)) throw invalid('Ein Alias ist zu lang.');
    }
    if (edit.one_liner !== undefined) {
      const text = edit.one_liner === null ? '' : edit.one_liner.trim();
      if (chars(text) > 500) throw invalid('Der Satz ist zu lang.');
      next.oneLiner = text === '' ? null : text;
    }
    if (edit.kind !== undefined) next.kind = edit.kind;
  }
  const previous: ConceptEdit = {};
  if (next.name !== p.name) previous.name = p.name;
  if (!sameList(next.aliases, p.aliases)) previous.aliases = p.aliases;
  if (next.oneLiner !== p.oneLiner) previous.one_liner = p.oneLiner;
  if (next.kind !== p.kind) previous.kind = p.kind as ConceptKind | null;
  const textChanged = 'name' in previous || 'aliases' in previous || 'one_liner' in previous;
  return { next, previous: Object.keys(previous).length > 0 ? previous : null, textChanged };
}

/** Anderes aktives, nicht gelöschtes Konzept, das namensgleich mit `named` ist (das mit der kleinsten ID) */
async function findSameNameActive(tx: Tx, named: Named, exceptId: string): Promise<string | null> {
  // Vergleich in JS, nicht mit `lower()` in SQL: Worker und Core rechnen `key` gleich, die Datenbank je nach
  // Sortierung anders. Bei einem Nutzer sind es wenige tausend Zeilen
  const rows = await tx
    .select({ id: concept.id, name: concept.name, aliases: concept.aliases })
    .from(concept)
    .where(and(eq(concept.status, 'aktiv'), notDeleted(concept), ne(concept.id, exceptId)))
    .orderBy(asc(concept.id));
  return rows.find((row) => sameName(named, row))?.id ?? null;
}

interface OpenRelationItem {
  itemId: string;
  fromId: string;
  toId: string;
  confidence: number | null;
}

/** Offene `relation`-Einträge mit diesem Konzept als Endpunkt, nach `priority` */
async function openRelationItems(tx: Tx, conceptId: string): Promise<OpenRelationItem[]> {
  return tx
    .select({
      itemId: inboxItem.id,
      fromId: conceptRelation.fromId,
      toId: conceptRelation.toId,
      confidence: conceptRelation.confidence,
    })
    .from(inboxItem)
    .innerJoin(conceptRelation, eq(conceptRelation.id, inboxItem.relationId))
    .where(
      and(
        eq(inboxItem.status, 'offen'),
        notDeleted(inboxItem),
        notDeleted(conceptRelation),
        eq(conceptRelation.confirmed, false),
        or(eq(conceptRelation.fromId, conceptId), eq(conceptRelation.toId, conceptId)),
      ),
    )
    .orderBy(asc(inboxItem.priority), asc(inboxItem.id));
}

function proposalOf(item: ItemRow): { importance: number; exam_hint: boolean } {
  const payload = item.payload as InboxPayload;
  if (payload.kind === 'relation') throw new Error('Eintrag ohne Konzept-Vorschlag');
  return payload.proposal;
}

/**
 * A1: `concept_new` annehmen (auch `concept_merge` mit `as_new`). Prüft die Namensgleichheit in der Fassung nach
 * `edit` (`409 concept_exists`), aktiviert das Konzept und bestätigt danach nach `ai.auto_accept` die offenen
 * Beziehungen, deren Endpunkte jetzt beide aktiv sind (A3). Scheitert eine davon, bleibt ihr Eintrag offen.
 */
export async function acceptNew(
  tx: Tx,
  item: ItemRow,
  edit: ConceptEdit | undefined,
  autoAccept: AutoAcceptMode,
): Promise<InboxDecision> {
  const conceptId = item.conceptId!;
  const p = requireProposal((await lockConcepts(tx, [conceptId])).get(conceptId));
  const { next, previous, textChanged } = applyEdit(p, edit);

  const existing = await findSameNameActive(tx, next, conceptId);
  if (existing) {
    throw new HttpError(409, 'concept_exists', 'Es gibt schon ein aktives Konzept mit diesem Namen.', {
      concept_id: existing,
    });
  }

  const proposal = proposalOf(item);
  await tx
    .update(concept)
    .set({
      name: next.name,
      aliases: next.aliases,
      oneLiner: next.oneLiner,
      kind: next.kind,
      status: 'aktiv',
      proposalSessionId: null,
      importanceBase: importanceBase(proposal.importance),
      examRelevant: p.examRelevant || proposal.exam_hint,
      // Der Vektor passt nicht mehr zum Text: der nächste Abgleich holt ihn nach (§20.3 Schritt 3)
      ...(textChanged ? { embedding: null, embeddingModel: null } : {}),
    })
    .where(eq(concept.id, conceptId));

  const cascade: string[] = [];
  if (autoAccept !== 'aus') {
    for (const candidate of await openRelationItems(tx, conceptId)) {
      if (autoAccept === 'alles_ab_0_9' && !((candidate.confidence ?? 0) >= 0.9)) continue;
      const relationItem = (await lockItems(tx, [candidate.itemId], 'skip')).get(candidate.itemId);
      if (!relationItem || relationItem.status !== 'offen') continue;
      try {
        // Wirft vor dem ersten Schreiben (Endpunkt noch nicht aktiv, Kreis): der Eintrag bleibt offen
        const decision = await confirmRelation(tx, relationItem, undefined);
        await markItem(tx, relationItem.id, 'angenommen', { ...decision, triggered_by: item.id });
        cascade.push(relationItem.id);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
      }
    }
  }

  return { ...emptyDecision('angenommen_neu'), concept_id: conceptId, previous, cascade_item_ids: cascade };
}

/** A1 zurücknehmen (§20.6 „Rückgängig“). Der Eintrag selbst wird vom Aufrufer wieder geöffnet */
export async function undoAcceptNew(tx: Tx, item: ItemRow, decision: InboxDecision): Promise<void> {
  const conceptId = decision.concept_id ?? item.conceptId!;
  const sessionId = item.sessionId!;
  const cascadeItems = await lockItems(tx, decision.cascade_item_ids, 'require');
  const c = live((await lockConcepts(tx, [conceptId])).get(conceptId));
  if (!c) throw itemGone();
  if (c.status !== 'aktiv') throw reopenConflict('Das Konzept ist nicht mehr aktiv.');

  const cascadeRelationIds = [...cascadeItems.values()]
    .filter((row) => row.decision?.triggered_by === item.id && row.relationId)
    .map((row) => row.relationId!);

  const [foreignEvidence] = await tx
    .select({ id: evidence.id })
    .from(evidence)
    .where(
      and(
        eq(evidence.conceptId, conceptId),
        notDeleted(evidence),
        sql`${evidence.sessionId} IS DISTINCT FROM ${sessionId}`,
      ),
    )
    .limit(1);
  if (foreignEvidence) throw reopenConflict('Das Konzept hat inzwischen Belege aus anderen Vorlesungen.');

  const confirmed = await tx
    .select({ id: conceptRelation.id })
    .from(conceptRelation)
    .where(
      and(
        eq(conceptRelation.confirmed, true),
        notDeleted(conceptRelation),
        or(eq(conceptRelation.fromId, conceptId), eq(conceptRelation.toId, conceptId)),
      ),
    );
  if (confirmed.some((row) => !cascadeRelationIds.includes(row.id))) {
    throw reopenConflict('Das Konzept hat inzwischen bestätigte Beziehungen.');
  }

  // Hüllen und Einträge anderer Sessions zählen auch gelöscht: sie können wiederhergestellt werden
  const [mergedShell] = await tx
    .select({ id: concept.id })
    .from(concept)
    .where(eq(concept.mergedInto, conceptId))
    .limit(1);
  if (mergedShell) throw reopenConflict('In das Konzept wurde inzwischen ein anderes zusammengeführt.');

  const [foreignItem] = await tx
    .select({ id: inboxItem.id })
    .from(inboxItem)
    .leftJoin(conceptRelation, eq(conceptRelation.id, inboxItem.relationId))
    .where(
      and(
        sql`${inboxItem.sessionId} IS DISTINCT FROM ${sessionId}`,
        or(
          eq(inboxItem.targetConceptId, conceptId),
          eq(conceptRelation.fromId, conceptId),
          eq(conceptRelation.toId, conceptId),
        ),
      ),
    )
    .limit(1);
  if (foreignItem) throw reopenConflict('Vorschläge anderer Vorlesungen hängen an diesem Konzept.');

  const previous = decision.previous ?? {};
  const textChanged = 'name' in previous || 'aliases' in previous || 'one_liner' in previous;
  await tx
    .update(concept)
    .set({
      status: 'vorschlag',
      proposalSessionId: sessionId,
      ...(previous.name !== undefined ? { name: previous.name } : {}),
      ...(previous.aliases !== undefined ? { aliases: previous.aliases } : {}),
      ...(previous.one_liner !== undefined ? { oneLiner: previous.one_liner } : {}),
      ...(previous.kind !== undefined ? { kind: previous.kind } : {}),
      ...(textChanged ? { embedding: null, embeddingModel: null } : {}),
    })
    .where(eq(concept.id, conceptId));

  for (const row of cascadeItems.values()) {
    if (row.decision?.triggered_by !== item.id || row.status === 'offen') continue;
    if (row.relationId) await unconfirmRelation(tx, row.relationId, row.sessionId ?? sessionId);
    await markItem(tx, row.id, 'offen', null);
  }
}

// --- A2: zusammenführen ------------------------------------------------------------------------------------

function replaceId(value: string, from: string, to: string): string {
  return value === from ? to : value;
}

/** `from_concept_id`/`to_concept_id` in der Nutzlast eines Beziehungs-Eintrags umhängen */
async function retargetPayload(tx: Tx, row: ItemRow, from: string, to: string): Promise<void> {
  const payload = row.payload as InboxPayload;
  if (payload.kind !== 'relation') return;
  await tx
    .update(inboxItem)
    .set({
      payload: {
        ...payload,
        from_concept_id: replaceId(payload.from_concept_id, from, to),
        to_concept_id: replaceId(payload.to_concept_id, from, to),
      },
    })
    .where(eq(inboxItem.id, row.id));
}

async function findRelation(
  tx: Tx,
  fromId: string,
  toId: string,
  kind: string,
  exceptId: string,
): Promise<RelationRow | undefined> {
  const [row] = await tx
    .select()
    .from(conceptRelation)
    .where(
      and(
        eq(conceptRelation.fromId, fromId),
        eq(conceptRelation.toId, toId),
        eq(conceptRelation.kind, kind),
        notDeleted(conceptRelation),
        ne(conceptRelation.id, exceptId),
      ),
    );
  return row;
}

/** Unbestätigte, nicht gelöschte Beziehungen mit diesem Konzept als Endpunkt, samt ihrem Eintrag */
async function proposedRelations(tx: Tx, conceptId: string) {
  return tx
    .select({ relation: conceptRelation, itemId: inboxItem.id })
    .from(conceptRelation)
    .innerJoin(inboxItem, and(eq(inboxItem.relationId, conceptRelation.id), notDeleted(inboxItem)))
    .where(
      and(
        eq(conceptRelation.confirmed, false),
        notDeleted(conceptRelation),
        or(eq(conceptRelation.fromId, conceptId), eq(conceptRelation.toId, conceptId)),
      ),
    )
    .orderBy(asc(conceptRelation.id));
}

/**
 * A2: Vorschlag `P` in das aktive Konzept `T` zusammenführen. Belege, Aliase, Module und unbestätigte Beziehungen
 * gehen an `T`; `P` bleibt als Hülle `zusammengefuehrt`. Nichts wird hart gelöscht außer Belegen, die es an `T`
 * schon gibt (`evidence_dedupe_uq`).
 */
export async function acceptMerge(tx: Tx, item: ItemRow, targetId: string): Promise<InboxDecision> {
  const pId = item.conceptId!;
  if (targetId === pId) throw targetInvalid();
  const concepts = await lockConcepts(tx, [pId, targetId]);
  const p = requireProposal(concepts.get(pId));
  const t = live(concepts.get(targetId));
  if (!t || t.status !== 'aktiv') throw targetInvalid();

  // Belege: Dubletten an T weichen, der Rest zieht um
  await tx.execute(sql`
    DELETE FROM evidence e
     WHERE e.concept_id = ${pId} AND e.deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM evidence x
          WHERE x.concept_id = ${targetId} AND x.deleted_at IS NULL
            AND x.kind = e.kind AND x.ref_id = e.ref_id
            AND coalesce(x.t_start_ms, -1) = coalesce(e.t_start_ms, -1)
            AND coalesce(x.t_end_ms, -1) = coalesce(e.t_end_ms, -1)
            AND x.session_id IS NOT DISTINCT FROM e.session_id)`);
  const moved = await tx
    .update(evidence)
    .set({ conceptId: targetId })
    .where(and(eq(evidence.conceptId, pId), notDeleted(evidence)))
    .returning({ id: evidence.id });

  // Aliase: Name und Aliase von P, ohne namensgleiche, höchstens 20 insgesamt
  const keys = new Set([t.name, ...t.aliases].map(nameKey));
  const addedAliases: string[] = [];
  for (const raw of [p.name, ...p.aliases]) {
    const alias = normName(raw);
    const key = alias.toLowerCase();
    if (alias === '' || keys.has(key) || t.aliases.length + addedAliases.length >= 20) continue;
    keys.add(key);
    addedAliases.push(alias);
  }

  // Module von P, die T fehlen (eine weich gelöschte Zuordnung an T bleibt, wie sie ist)
  const pModules = await tx
    .select({ moduleId: conceptModule.moduleId })
    .from(conceptModule)
    .where(and(eq(conceptModule.conceptId, pId), notDeleted(conceptModule)))
    .orderBy(asc(conceptModule.moduleId));
  const addedModules: string[] = [];
  for (const { moduleId } of pModules) {
    const inserted = await tx
      .insert(conceptModule)
      .values({ id: uuidv7(), userId: t.userId, conceptId: targetId, moduleId })
      .onConflictDoNothing({ target: [conceptModule.conceptId, conceptModule.moduleId] })
      .returning({ id: conceptModule.id });
    if (inserted.length > 0) addedModules.push(moduleId);
  }

  // Unbestätigte Beziehungen von P an T hängen. Selbstbezug oder Dublette: Eintrag ablehnen, Zeile bleibt an P
  const relations = await proposedRelations(tx, pId);
  const relationItems = await lockItems(
    tx,
    relations.map((row) => row.itemId),
    'require',
  );
  const cascade: string[] = [];
  for (const { relation, itemId } of relations) {
    const relationItem = relationItems.get(itemId);
    if (!relationItem) continue;
    const from = replaceId(relation.fromId, pId, targetId);
    const to = replaceId(relation.toId, pId, targetId);
    const [fromId, toId] = orderEndpoints(relation.kind, from, to);
    const duplicate =
      from === to ? undefined : await findRelation(tx, fromId, toId, relation.kind, relation.id);
    if (from === to || duplicate) {
      if (relationItem.status !== 'offen') continue;
      await markItem(tx, relationItem.id, 'abgelehnt', {
        ...emptyDecision('abgelehnt'),
        triggered_by: item.id,
        duplicate_of: duplicate?.id ?? null,
      });
    } else {
      await tx.update(conceptRelation).set({ fromId, toId }).where(eq(conceptRelation.id, relation.id));
      await retargetPayload(tx, relationItem, pId, targetId);
    }
    cascade.push(relationItem.id);
  }

  const proposal = proposalOf(item);
  await tx
    .update(concept)
    .set({
      aliases: [...t.aliases, ...addedAliases],
      examRelevant: t.examRelevant || proposal.exam_hint,
      ...(addedAliases.length > 0 ? { embedding: null, embeddingModel: null } : {}),
    })
    .where(eq(concept.id, targetId));
  // Invariante 5. `proposal_session_id` bleibt: das Löschen der Session nimmt die Hülle mit
  await tx
    .update(concept)
    .set({ status: 'zusammengefuehrt', mergedInto: targetId })
    .where(eq(concept.id, pId));

  return {
    ...emptyDecision('zusammengefuehrt'),
    concept_id: pId,
    merged_into: targetId,
    moved_evidence_ids: moved.map((row) => row.id).sort(),
    added_aliases: addedAliases,
    added_module_ids: addedModules,
    cascade_item_ids: cascade,
  };
}

/** A2 zurücknehmen. Wirft `inbox_reopen_conflict`, wenn eine umgehängte Beziehung inzwischen bestätigt ist */
export async function undoMerge(tx: Tx, item: ItemRow, decision: InboxDecision): Promise<void> {
  const pId = decision.concept_id ?? item.conceptId!;
  const targetId = decision.merged_into;
  if (!targetId) throw reopenConflict('Die Entscheidung nennt kein Ziel.');
  const cascadeItems = await lockItems(tx, decision.cascade_item_ids, 'require');
  const concepts = await lockConcepts(tx, [pId, targetId]);
  const p = live(concepts.get(pId));
  const t = live(concepts.get(targetId));
  if (!p) throw itemGone();
  if (!t || p.status !== 'zusammengefuehrt' || p.mergedInto !== targetId) {
    throw reopenConflict('Die Zusammenführung besteht nicht mehr.');
  }

  // Erst prüfen, dann schreiben: bei einem Konflikt ändert sich nichts
  const movedBack: { row: ItemRow; relation: RelationRow }[] = [];
  const reopened: ItemRow[] = [];
  for (const row of cascadeItems.values()) {
    if (row.decision?.triggered_by === item.id) {
      reopened.push(row);
      continue;
    }
    if (!row.relationId) continue;
    const [relation] = await tx.select().from(conceptRelation).where(eq(conceptRelation.id, row.relationId));
    if (!relation) continue;
    if (relation.confirmed) throw reopenConflict('Eine umgehängte Beziehung ist inzwischen bestätigt.');
    if (relation.fromId === targetId || relation.toId === targetId) movedBack.push({ row, relation });
  }

  if (decision.moved_evidence_ids.length > 0) {
    await tx
      .update(evidence)
      .set({ conceptId: pId })
      .where(and(inArray(evidence.id, decision.moved_evidence_ids), eq(evidence.conceptId, targetId)));
  }

  const aliases = t.aliases.filter((alias) => !decision.added_aliases.includes(alias));
  if (aliases.length !== t.aliases.length) {
    await tx
      .update(concept)
      .set({ aliases, embedding: null, embeddingModel: null })
      .where(eq(concept.id, targetId));
  }
  if (decision.added_module_ids.length > 0) {
    await tx
      .delete(conceptModule)
      .where(
        and(
          eq(conceptModule.conceptId, targetId),
          inArray(conceptModule.moduleId, decision.added_module_ids),
        ),
      );
  }

  for (const { row, relation } of movedBack) {
    const [fromId, toId] = orderEndpoints(
      relation.kind,
      replaceId(relation.fromId, targetId, pId),
      replaceId(relation.toId, targetId, pId),
    );
    await tx.update(conceptRelation).set({ fromId, toId }).where(eq(conceptRelation.id, relation.id));
    await retargetPayload(tx, row, targetId, pId);
  }
  for (const row of reopened) {
    if (row.status !== 'offen') await markItem(tx, row.id, 'offen', null);
  }

  await tx
    .update(concept)
    .set({
      status: 'vorschlag',
      mergedInto: null,
      proposalSessionId: p.proposalSessionId ?? item.sessionId,
    })
    .where(eq(concept.id, pId));
}

// --- A3: Beziehung bestätigen ------------------------------------------------------------------------------

async function requireRelation(tx: Tx, item: ItemRow): Promise<RelationRow> {
  const [relation] = await tx
    .select()
    .from(conceptRelation)
    .where(and(eq(conceptRelation.id, item.relationId!), notDeleted(conceptRelation)));
  if (!relation) throw itemGone();
  return relation;
}

/** Bestätigte `baut_auf`-Kanten zwischen aktiven, nicht gelöschten Konzepten */
async function confirmedPrerequisiteEdges(tx: Tx): Promise<Edge[]> {
  const rows = await tx.execute<{ from_id: string; to_id: string }>(sql`
    SELECT r.from_id, r.to_id
      FROM concept_relation r
      JOIN concept a ON a.id = r.from_id AND a.status = 'aktiv' AND a.deleted_at IS NULL
      JOIN concept b ON b.id = r.to_id AND b.status = 'aktiv' AND b.deleted_at IS NULL
     WHERE r.kind = 'baut_auf' AND r.confirmed AND r.deleted_at IS NULL`);
  return [...rows].map((row) => ({ from: row.from_id, to: row.to_id }));
}

async function assertNoCycle(tx: Tx, fromId: string, toId: string): Promise<void> {
  const path = findCycle(await confirmedPrerequisiteEdges(tx), fromId, toId);
  if (path) throw new HttpError(409, 'relation_cycle', 'Das würde einen Kreis bilden.', { path });
}

/**
 * A3: Beziehung des Eintrags bestätigen, optional mit anderer Art. Wirft vor dem ersten Schreiben
 * (`relation_endpoint_pending`, `relation_cycle`). Gibt es die Beziehung mit der neuen Art schon, bleibt die Zeile
 * des Eintrags unverändert (`duplicate_of`); ist die vorhandene ein offener Vorschlag, wird stattdessen sie bestätigt.
 */
export async function confirmRelation(
  tx: Tx,
  item: ItemRow,
  relationKind: ConceptRelationKind | undefined,
): Promise<InboxDecision> {
  const relation = await requireRelation(tx, item);
  const concepts = await lockConcepts(tx, [relation.fromId, relation.toId]);
  for (const id of [relation.fromId, relation.toId]) {
    if (live(concepts.get(id))?.status !== 'aktiv') {
      throw new HttpError(
        409,
        'relation_endpoint_pending',
        'Ein Endpunkt der Beziehung ist noch kein aktives Konzept.',
        { concept_id: id },
      );
    }
  }

  const kind = relationKind ?? relation.kind;
  const changed = kind !== relation.kind;
  const [fromId, toId] = orderEndpoints(kind, relation.fromId, relation.toId);
  const decision = emptyDecision('beziehung_bestaetigt');
  if (changed) decision.relation_kind_before = relation.kind as ConceptRelationKind;

  const existing = changed ? await findRelation(tx, fromId, toId, kind, relation.id) : undefined;
  if (existing) {
    decision.duplicate_of = existing.id;
    if (existing.confirmed) return decision;
    // Nur greifen, wenn frei: Warten könnte sich mit einem gleichzeitigen Einzel-Accept verklemmen (§20.6)
    const [existingItem] = await tx
      .select()
      .from(inboxItem)
      .where(and(eq(inboxItem.relationId, existing.id), eq(inboxItem.status, 'offen'), notDeleted(inboxItem)))
      .for('update', { skipLocked: true });
    if (!existingItem) return decision;
    if (kind === 'baut_auf') await assertNoCycle(tx, fromId, toId);
    await tx
      .update(conceptRelation)
      .set({ confirmed: true, proposalSessionId: null })
      .where(eq(conceptRelation.id, existing.id));
    await markItem(tx, existingItem.id, 'angenommen', {
      ...emptyDecision('beziehung_bestaetigt'),
      triggered_by: item.id,
    });
    decision.cascade_item_ids = [existingItem.id];
    return decision;
  }

  if (kind === 'baut_auf') await assertNoCycle(tx, fromId, toId);
  await tx
    .update(conceptRelation)
    .set({ kind, fromId, toId, confirmed: true, proposalSessionId: null })
    .where(eq(conceptRelation.id, relation.id));
  return decision;
}

/** Bestätigung zurücknehmen: wieder Vorschlag der Session */
async function unconfirmRelation(tx: Tx, relationId: string, sessionId: string): Promise<void> {
  await tx
    .update(conceptRelation)
    .set({ confirmed: false, proposalSessionId: sessionId })
    .where(and(eq(conceptRelation.id, relationId), eq(conceptRelation.confirmed, true)));
}

/** A3 zurücknehmen */
export async function undoRelation(tx: Tx, item: ItemRow, decision: InboxDecision): Promise<void> {
  const sessionId = item.sessionId!;
  const cascadeItems = await lockItems(tx, decision.cascade_item_ids, 'require');

  if (decision.duplicate_of) {
    // Diese Beziehung wurde nie bestätigt. Wurde dabei die vorhandene bestätigt, geht sie zurück
    for (const row of cascadeItems.values()) {
      if (row.decision?.triggered_by !== item.id || row.status === 'offen') continue;
      if (row.relationId) await unconfirmRelation(tx, row.relationId, row.sessionId ?? sessionId);
      await markItem(tx, row.id, 'offen', null);
    }
    return;
  }

  const relation = await requireRelation(tx, item);
  await lockConcepts(tx, [relation.fromId, relation.toId]);
  let { kind, fromId, toId } = relation;
  if (decision.relation_kind_before && decision.relation_kind_before !== relation.kind) {
    kind = decision.relation_kind_before;
    // Die Richtung des Vorschlags steht in der Nutzlast (eine symmetrische Art hat sie beim Annehmen sortiert)
    const payload = item.payload as InboxPayload;
    const endpoints = new Set([relation.fromId, relation.toId]);
    if (
      payload.kind === 'relation' &&
      endpoints.has(payload.from_concept_id) &&
      endpoints.has(payload.to_concept_id) &&
      payload.from_concept_id !== payload.to_concept_id
    ) {
      fromId = payload.from_concept_id;
      toId = payload.to_concept_id;
    }
    [fromId, toId] = orderEndpoints(kind, fromId, toId);
    if (await findRelation(tx, fromId, toId, kind, relation.id)) {
      throw reopenConflict('Die Beziehung gibt es mit der früheren Art inzwischen schon.');
    }
  }
  await tx
    .update(conceptRelation)
    .set({ kind, fromId, toId, confirmed: false, proposalSessionId: sessionId })
    .where(eq(conceptRelation.id, relation.id));
}

// --- Ablehnen ----------------------------------------------------------------------------------------------

/**
 * Eintrag ablehnen. Bei einem Konzept-Vorschlag werden die offenen Beziehungs-Einträge mit ihm als Endpunkt mit
 * abgelehnt. Vorschlag und Beziehungen bleiben liegen (§20.6). Ist einer davon gerade gesperrt, rollt das Ablehnen
 * zurück und läuft neu (`require`): sonst bliebe er offen, obwohl sein Endpunkt abgelehnt ist.
 */
export async function rejectItem(tx: Tx, item: ItemRow): Promise<InboxDecision> {
  const cascade: string[] = [];
  if (item.conceptId) {
    const candidates = await openRelationItems(tx, item.conceptId);
    const locked = await lockItems(
      tx,
      candidates.map((row) => row.itemId),
      'require',
    );
    for (const { itemId } of candidates) {
      const row = locked.get(itemId);
      if (!row || row.status !== 'offen') continue;
      await markItem(tx, row.id, 'abgelehnt', { ...emptyDecision('abgelehnt'), triggered_by: item.id });
      cascade.push(row.id);
    }
  }
  return { ...emptyDecision('abgelehnt'), cascade_item_ids: cascade };
}

/** Ablehnung zurücknehmen: die mit abgelehnten Einträge wieder öffnen */
export async function undoReject(tx: Tx, item: ItemRow, decision: InboxDecision): Promise<void> {
  const cascadeItems = await lockItems(tx, decision.cascade_item_ids, 'require');
  for (const row of cascadeItems.values()) {
    if (row.decision?.triggered_by !== item.id || row.status === 'offen') continue;
    await markItem(tx, row.id, 'offen', null);
  }
}
