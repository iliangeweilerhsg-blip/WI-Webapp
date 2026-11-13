// Inbox-Art `card_batch` (VERTRAEGE §21.7): Sichtbarkeit, Karten annehmen (A4), Verwerfen und Rückgängig. Ticket B3.
//
// Der Aufrufer (`inbox.ts`) hält die Sperren aus §21.7: Session `FOR SHARE`, Eintrag `FOR UPDATE`, Graph-Sperre
// (`lockConceptGraph`). Das wirksame Konzept (und die Hülle) sperren die Funktionen hier selbst `FOR NO KEY UPDATE`.
// `cards.generate` im Worker sperrt die Session `FOR NO KEY UPDATE` und liegt damit vor oder nach einer Entscheidung.
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type {
  Card,
  CardContent,
  EvidenceRef,
  InboxAcceptRequest,
  InboxCardChoice,
  InboxCardOutcome,
  InboxDecision,
  InboxPayload,
  InboxPayloadCardBatch,
} from '@sg/shared';
import type { Tx } from '../db/client.ts';
import { card, cardState, concept, notDeleted, reviewLog } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { cardFrontKey, cardInvalid, checkCardContent } from '../learning/content.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import { cardSourceInvalid, findInvalidCardSource, insertCardWithState, loadApiCards } from './cards.ts';
import { emptyDecision, lockConcepts, rejectedBatchDecision, type ItemRow } from './concept-graph.ts';

/**
 * Sichtbarkeit (§21.7): Ein **offener** Kartenvorschlag zählt erst, wenn sein wirksames Konzept `aktiv` und nicht
 * gelöscht ist. Wirksam ist das Konzept aus `card_concept_id`, bei einer Hülle (`zusammengefuehrt`) ihr `merged_into`.
 * Andere Arten und entschiedene Einträge sind nicht betroffen. Bezieht sich mit festen Namen auf die Tabelle `inbox_item` der äußeren Abfrage
 * (nicht über Spalten-Objekte: Eine Abfrage ohne Join schreibt sie ohne Tabellennamen, `kind` und `status` gibt es auch in `concept`).
 */
export const cardBatchVisible: SQL = sql.raw(`(inbox_item.kind <> 'card_batch' OR inbox_item.status <> 'offen'
  OR EXISTS (
    SELECT 1 FROM concept shell
      JOIN concept eff ON eff.id = CASE WHEN shell.status = 'zusammengefuehrt' THEN shell.merged_into ELSE shell.id END
     WHERE shell.id = inbox_item.card_concept_id
       AND eff.status = 'aktiv' AND eff.deleted_at IS NULL))`);

const invalid = (message: string, details: Record<string, unknown>) =>
  new HttpError(400, 'inbox_action_invalid', message, details);

function batchPayload(item: Pick<ItemRow, 'payload'>): InboxPayloadCardBatch {
  const payload = item.payload as InboxPayload;
  if (payload.kind !== 'card_batch') throw new Error('Eintrag ist kein Kartenvorschlag');
  return payload;
}

/**
 * Entscheidungen je Karte prüfen (§21.7 A4): unbekannter oder doppelter `key`, `content`/`sources` bei `accept: false`
 * → `400 inbox_action_invalid`. Rückgabe: `key` → Entscheidung. Nicht genannte Karten fehlen darin (= unverändert angenommen).
 */
export function planCardChoices(
  item: Pick<ItemRow, 'payload'>,
  choices: readonly InboxCardChoice[] | undefined,
): Map<string, InboxCardChoice> {
  const keys = new Set(batchPayload(item).cards.map((c) => c.key));
  const result = new Map<string, InboxCardChoice>();
  for (const choice of choices ?? []) {
    if (!keys.has(choice.key)) {
      throw invalid('Diese Karte gibt es im Vorschlag nicht.', { field: 'cards', key: choice.key });
    }
    if (result.has(choice.key)) {
      throw invalid('Die Karte ist doppelt genannt.', { field: 'cards', key: choice.key });
    }
    if (!choice.accept && (choice.content !== undefined || choice.sources !== undefined)) {
      throw invalid('Eine verworfene Karte kann nicht bearbeitet werden.', {
        field: 'cards',
        key: choice.key,
      });
    }
    result.set(choice.key, choice);
  }
  return result;
}

export const conceptPending = (conceptId: string) =>
  new HttpError(409, 'card_concept_pending', 'Das Konzept zu diesen Karten ist noch nicht angenommen.', {
    concept_id: conceptId,
  });

/**
 * Das wirksame Konzept des Eintrags, gesperrt (`FOR NO KEY UPDATE`, Hülle und Ziel zusammen nach ID sortiert).
 * Setzt die Graph-Sperre voraus: Erst damit ist `merged_into` stabil. `active = false`, wenn es fehlt, gelöscht ist
 * oder nicht `aktiv` (der Aufrufer entscheidet, ob das ein Fehler ist).
 */
export async function lockEffectiveConcept(tx: Tx, item: ItemRow): Promise<{ id: string; active: boolean }> {
  const shellId = item.cardConceptId!;
  const [peek] = await tx
    .select({ status: concept.status, mergedInto: concept.mergedInto })
    .from(concept)
    .where(eq(concept.id, shellId));
  const effectiveId = peek?.status === 'zusammengefuehrt' && peek.mergedInto ? peek.mergedInto : shellId;
  const locked = await lockConcepts(tx, [shellId, effectiveId]);
  const effective = locked.get(effectiveId);
  return { id: effectiveId, active: !!effective && !effective.deletedAt && effective.status === 'aktiv' };
}

/** Vorderseiten (Vergleichsform) der nicht gelöschten Karten des Konzepts */
async function existingFrontKeys(tx: Tx, conceptId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ kind: card.kind, front: card.front, back: card.back })
    .from(card)
    .where(and(eq(card.conceptId, conceptId), notDeleted(card)));
  return new Set(
    rows.map((row) => cardFrontKey({ kind: row.kind, front: row.front, back: row.back } as CardContent)),
  );
}

export interface AcceptedBatch {
  decision: InboxDecision;
  /** Die angelegten Karten (leer bei „alles verworfen“) */
  cards: Card[];
  /** `true`: alle Karten abgewählt, der Aufrufer behandelt den Eintrag wie „Ablehnen“ */
  rejected: boolean;
}

/**
 * A4 (§21.7): Karten annehmen. Nicht genannte Karten werden unverändert angenommen. Bearbeitete Karten werden gesäubert
 * und geprüft (`400 card_invalid` mit `details.key`), ihre geänderten Belege geprüft (`400 card_source_invalid` mit
 * `details.key`), unveränderte nicht. Dubletten (Vergleichsform der Vorderseite) entstehen nicht (`dublette`). Das
 * wirksame Konzept muss `aktiv` sein (`409 card_concept_pending`), außer wenn alles abgewählt ist.
 */
export async function acceptCardBatch(
  tx: Tx,
  item: ItemRow,
  body: InboxAcceptRequest,
  now: Date,
): Promise<AcceptedBatch> {
  const payload = batchPayload(item);
  const choices = planCardChoices(item, body.cards);
  const wanted = payload.cards.filter((c) => choices.get(c.key)?.accept !== false);

  if (wanted.length === 0) {
    return { decision: rejectedBatchDecision(item, null), cards: [], rejected: true };
  }

  const effective = await lockEffectiveConcept(tx, item);
  if (!effective.active) throw conceptPending(effective.id);

  // Erst alles prüfen (der erste Fehler in der Reihenfolge der Karten), dann schreiben
  const prepared = new Map<string, { content: CardContent; sources: EvidenceRef[] }>();
  for (const proposal of wanted) {
    const choice = choices.get(proposal.key);
    const checked = checkCardContent(choice?.content ?? proposal.content);
    if (!checked.ok) throw cardInvalid(checked.reason, { key: proposal.key });
    const sources = choice?.sources ?? proposal.sources;
    if (choice?.sources !== undefined) {
      const bad = await findInvalidCardSource(tx, sources);
      if (bad !== null) throw cardSourceInvalid(bad, { key: proposal.key });
    }
    prepared.set(proposal.key, { content: checked.content, sources });
  }

  const seen = await existingFrontKeys(tx, effective.id);
  const outcomes: InboxCardOutcome[] = [];
  const created = [];
  for (const proposal of payload.cards) {
    const ready = prepared.get(proposal.key);
    if (!ready) {
      outcomes.push({ key: proposal.key, outcome: 'verworfen', card_id: null });
      continue;
    }
    const frontKey = cardFrontKey(ready.content);
    if (seen.has(frontKey)) {
      outcomes.push({ key: proposal.key, outcome: 'dublette', card_id: null });
      continue;
    }
    seen.add(frontKey);
    const row = await insertCardWithState(tx, {
      id: uuidv7(),
      conceptId: effective.id,
      content: ready.content,
      sources: ready.sources,
      origin: 'ki',
      inboxItemId: item.id,
      now,
    });
    created.push(row);
    outcomes.push({ key: proposal.key, outcome: 'angenommen', card_id: row.card.id });
  }

  return {
    decision: { ...emptyDecision('karten_angenommen'), concept_id: effective.id, cards: outcomes },
    cards: await loadApiCards(tx, created),
    rejected: false,
  };
}

/**
 * `reopen` eines Kartenvorschlags (§21.7). `abgelehnt`: nichts zu tun. `karten_angenommen`: Die Karten aus
 * `decision.cards` werden **hart** gelöscht (auch aus dem Papierkorb), wenn keine von ihnen eine Bewertung hat, sonst
 * `409 inbox_reopen_conflict`. Eine schon endgültig gelöschte Karte ist kein Fehler (der DELETE trifft 0 Zeilen).
 * Der Zustand der Karten wird vorher `FOR UPDATE` gesperrt (wie `POST /cards/{id}/review`): Eine gleichzeitige
 * Bewertung wartet und findet die Karte danach nicht mehr.
 */
export async function undoCardBatch(tx: Tx, item: ItemRow, decision: InboxDecision): Promise<void> {
  if (decision.action !== 'karten_angenommen') return;
  const ids = [...new Set((decision.cards ?? []).flatMap((c) => (c.card_id ? [c.card_id] : [])))].sort();
  if (ids.length === 0) return;
  await lockEffectiveConcept(tx, item);
  await tx
    .select({ id: cardState.id })
    .from(cardState)
    .where(inArray(cardState.cardId, ids))
    .orderBy(asc(cardState.cardId))
    .for('update');
  const [reviewed] = await tx
    .select({ id: reviewLog.id })
    .from(reviewLog)
    .where(inArray(reviewLog.cardId, ids))
    .limit(1);
  if (reviewed) {
    throw new HttpError(409, 'inbox_reopen_conflict', 'Mindestens eine dieser Karten wurde schon bewertet.');
  }
  await tx.delete(card).where(and(inArray(card.id, ids), eq(card.inboxItemId, item.id)));
}
