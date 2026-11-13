'use client';

// Inbox der Vorschläge (VERTRAEGE §20.6, §20.10, F-NAC-06): Abfragen, Entscheidungen und Texte.
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import {
  InboxBulkResultSchema,
  InboxDecisionResultSchema,
  InboxItemListSchema,
  InboxOverviewSchema,
  type InboxAcceptRequest,
  type InboxBulkRequest,
  type InboxBulkResult,
  type InboxDecisionResult,
  type InboxItem,
  type InboxKind,
  type InboxOverview,
} from '@sg/shared';
import { watchReconnect } from '../components/dashboard/reconnect.ts';
import { ApiRequestError, apiGet, apiSend, friendlyMessage, isUnreachable } from './api.ts';
import { cardErrorMessage } from './cards.ts';
import { CONCEPTS_KEY, relationSentence } from './concepts.ts';
import { useHydrationSafe } from './hydrated.ts';
import { useActiveSession } from './sessions.ts';
import { useSyncClient } from './sync/SyncProvider.tsx';

/** Vorschläge zu Konzepten und Beziehungen (VERTRAEGE §20.6) */
export type ConceptInboxItem = InboxItem & {
  payload: Exclude<InboxItem['payload'], { kind: 'card_batch' }>;
};

/** Kartenvorschlag zu einem Konzept (`card_batch`, VERTRAEGE §21.7) */
export type CardBatchItem = InboxItem & {
  payload: Extract<InboxItem['payload'], { kind: 'card_batch' }>;
};

export function isConceptItem(item: InboxItem): item is ConceptInboxItem {
  return item.payload.kind !== 'card_batch';
}

export function isCardBatch(item: InboxItem): item is CardBatchItem {
  return item.payload.kind === 'card_batch';
}

export const INBOX_KEY = ['inbox'] as const;
export const INBOX_OVERVIEW_KEY = ['inbox', 'overview'] as const;
export const INBOX_OPEN_KEY = ['inbox', 'open'] as const;

/** Ab diesem Alter stehen offene Einträge gesammelt unter „ältere Vorschläge“ (F-NAC-06) */
export const OLDER_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
/** „Rückgängig“ bleibt 10 s (R15) */
export const UNDO_MS = 10_000;

export const INBOX_KIND_LABELS: Record<InboxKind, string> = {
  concept_new: 'Neues Konzept',
  concept_merge: 'Zusammenführen',
  relation: 'Beziehung',
  card_batch: 'Karten',
};

export const INBOX_KIND_FILTERS: readonly { kind: InboxKind; label: string }[] = [
  { kind: 'concept_new', label: 'Neue Konzepte' },
  { kind: 'concept_merge', label: 'Zusammenführen' },
  { kind: 'relation', label: 'Beziehungen' },
  { kind: 'card_batch', label: 'Karten' },
];

/** Typ-Symbol je Art (rein dekorativ, die Art steht zusätzlich als Text für Screenreader da) */
export const INBOX_KIND_SYMBOLS: Record<InboxKind, string> = {
  concept_new: '◆',
  concept_merge: '⇄',
  relation: '↗',
  card_batch: '▤',
};

// ---------------------------------------------------------------------------------------------
// Fehler: Codes und `details` kommen aus `lib/api.ts`
// ---------------------------------------------------------------------------------------------

/** Texte, die in der Inbox von `lib/api.ts` abweichen */
const INBOX_MESSAGES: Record<string, string> = {
  session_not_found: 'Diese Vorlesung gibt es nicht mehr.',
};

/** Code eines Fehlers aus dem Core, sonst `null` */
export function errorCode(error: unknown): string | null {
  return error instanceof ApiRequestError ? error.code : null;
}

/** `details.<key>` als Text (z. B. `concept_id`), sonst `null` */
export function errorDetail(error: unknown, key: string): string | null {
  const value = error instanceof ApiRequestError ? error.details[key] : null;
  return typeof value === 'string' ? value : null;
}

/** „Das würde einen Kreis bilden: A → B → A“ (F-BIB-03); ohne bekannte Namen nur der erste Satz */
export function cycleMessage(error: unknown, names: ReadonlyMap<string, string>): string {
  const path = error instanceof ApiRequestError ? error.details.path : null;
  const labels = Array.isArray(path)
    ? path.map((id) => (typeof id === 'string' ? names.get(id) : undefined))
    : [];
  if (labels.length < 2 || labels.some((label) => label === undefined))
    return 'Das würde einen Kreis bilden.';
  const closed = labels[0] === labels.at(-1) ? labels : [...labels, labels[0]];
  return `Das würde einen Kreis bilden: ${closed.join(' → ')}`;
}

/** Text für die Oberfläche zu einem Fehler einer Inbox-Aktion */
export function inboxErrorMessage(error: unknown, names: ReadonlyMap<string, string> = new Map()): string {
  const code = errorCode(error);
  if (code === 'relation_cycle') return cycleMessage(error, names);
  if (code === 'relation_endpoint_pending') {
    const name = names.get(errorDetail(error, 'concept_id') ?? '');
    if (name) return `Erst „${name}“ annehmen, dann die Beziehung.`;
  }
  if (code === 'card_concept_pending') {
    const name = names.get(errorDetail(error, 'concept_id') ?? '');
    return name ? `Erst „${name}“ annehmen, dann die Karten.` : cardErrorMessage(error);
  }
  if (code === 'card_invalid' || code === 'card_source_invalid') return cardErrorMessage(error);
  if (code !== null && INBOX_MESSAGES[code]) return INBOX_MESSAGES[code];
  return friendlyMessage(error);
}

// ---------------------------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------------------------

const MAX_PAGES = 10;
/** So viele offene Einträge lädt die Inbox höchstens; darüber steht ein Hinweis */
export const INBOX_OPEN_CAP = MAX_PAGES * 200;

/** Alle offenen Einträge (`GET /inbox?status=offen`, Seiten zu 200) */
export async function fetchOpenItems(signal?: AbortSignal): Promise<InboxItem[]> {
  const items: InboxItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ status: 'offen', limit: '200' });
    if (cursor) params.set('cursor', cursor);
    const list = await apiGet(`/inbox?${params.toString()}`, InboxItemListSchema, { signal });
    items.push(...list.items);
    cursor = list.next_cursor;
    if (!cursor) break;
  }
  return items;
}

/**
 * Läuft gerade eine Session (`laeuft`/`pausiert`)? Dann lädt die Web-App weder den Zähler noch neue Vorschläge (R1).
 * `null`, solange das noch nicht feststeht.
 */
export function useSessionRunning(): boolean | null {
  const active = useActiveSession();
  if (active.data !== undefined) return active.data !== null;
  // Lässt sich das nicht klären (Core nicht erreichbar), blockiert es nichts
  return active.isError ? false : null;
}

/**
 * `GET /inbox/overview`. Während eine Session läuft, wird nicht (neu) geladen; danach holt die App den Stand nach.
 * Neue Vorschläge kündigt `session.updated` an (Abgleich fertig).
 */
export function useInboxOverview() {
  const client = useQueryClient();
  const sync = useSyncClient();
  const running = useSessionRunning();
  const enabled = running === false;
  const query = useQuery({
    queryKey: INBOX_OVERVIEW_KEY,
    enabled,
    queryFn: ({ signal }): Promise<InboxOverview> =>
      apiGet('/inbox/overview', InboxOverviewSchema, { signal }),
  });
  useEffect(() => {
    if (!sync) return;
    const offUpdated = sync.onEvent('session.updated', (session) => {
      // Mit `cards.generate` kommen Kartenvorschläge dazu (§21.9)
      if (
        session.processing['concepts.resolve'] === 'fertig' ||
        session.processing['cards.generate'] === 'fertig'
      ) {
        void client.invalidateQueries({ queryKey: INBOX_KEY });
      }
    });
    // Nach dem Neuverbinden nachladen: Ereignisse aus der Lücke kommen nicht nach (§20.9, §11.6)
    const offReconnect = watchReconnect(sync, () => void client.invalidateQueries({ queryKey: INBOX_KEY }));
    return () => {
      offUpdated();
      offReconnect();
    };
  }, [sync, client]);
  // Nach dem Ende der Session nachholen (nur beim Wechsel von „läuft“ auf „läuft nicht“)
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running === true) wasRunning.current = true;
    else if (running === false && wasRunning.current) {
      wasRunning.current = false;
      void client.invalidateQueries({ queryKey: INBOX_KEY });
    }
  }, [running, client]);
  return { ...useHydrationSafe(query), running };
}

/** Zahl offener Einträge für die Navigation (neutral grau, 07 §2); `null`, solange nichts geladen ist */
export function useInboxCount(): number | null {
  return useInboxOverview().data?.open_count ?? null;
}

export function useOpenInboxItems() {
  const running = useSessionRunning();
  const query = useQuery({
    queryKey: INBOX_OPEN_KEY,
    enabled: running === false,
    queryFn: ({ signal }) => fetchOpenItems(signal),
  });
  return { ...useHydrationSafe(query), running };
}

// ---------------------------------------------------------------------------------------------
// Entscheiden
// ---------------------------------------------------------------------------------------------

const itemPath = (id: string, action: 'accept' | 'reject' | 'reopen') =>
  `/inbox/${encodeURIComponent(id)}/${action}`;

export function acceptItem(id: string, request: InboxAcceptRequest = {}): Promise<InboxDecisionResult> {
  return apiSend('POST', itemPath(id, 'accept'), InboxDecisionResultSchema, { body: request });
}

export function rejectItem(id: string): Promise<InboxDecisionResult> {
  return apiSend('POST', itemPath(id, 'reject'), InboxDecisionResultSchema);
}

export function reopenItem(id: string): Promise<InboxDecisionResult> {
  return apiSend('POST', itemPath(id, 'reopen'), InboxDecisionResultSchema);
}

export function bulkInbox(request: InboxBulkRequest): Promise<InboxBulkResult> {
  return apiSend('POST', '/inbox/bulk', InboxBulkResultSchema, { body: request });
}

/** Höchstzahl der `ids` je `POST /inbox/bulk` (Schema `InboxBulkRequest`) */
export const BULK_MAX_IDS = 500;

/**
 * `POST /inbox/bulk` mit beliebig vielen `ids`: in Blöcken zu höchstens 500, nacheinander, Ergebnisse zusammengeführt.
 * Scheitert ein späterer Block, landen seine und alle folgenden IDs mit dem Fehlercode in `skipped`, damit das schon
 * Entschiedene rückgängig gemacht werden kann. Scheitert der erste Block, kommt der Fehler durch.
 *
 * Folge-Einträge (§20.6) können über die Blockgrenze hinweg in einem Block mitentschieden werden und in einem anderen
 * scheitern: `accept` bestätigt im ersten Block eine Beziehung mit, die im zweiten dann `inbox_item_decided` meldet;
 * `reopen` scheitert im ersten Block an einem Folge-Eintrag (`inbox_reopen_conflict`), den sein Auslöser im zweiten
 * mit öffnet. Was am Ende in `decided` steht, fällt darum aus `skipped` heraus.
 */
export async function bulkInChunks(request: InboxBulkRequest): Promise<InboxBulkResult> {
  const ids = request.ids;
  if (ids === undefined || ids.length <= BULK_MAX_IDS) return bulkInbox(request);
  const merged: InboxBulkResult = { decided: [], skipped: [] };
  for (let at = 0; at < ids.length; at += BULK_MAX_IDS) {
    try {
      const part = await bulkInbox({ action: request.action, ids: ids.slice(at, at + BULK_MAX_IDS) });
      merged.decided.push(...part.decided);
      merged.skipped.push(...part.skipped);
    } catch (error) {
      if (at === 0) throw error;
      const code = errorCode(error) ?? (isUnreachable(error) ? 'unreachable' : 'failed');
      merged.skipped.push(...ids.slice(at).map((id) => ({ id, code })));
      break;
    }
  }
  const done = new Set(merged.decided);
  merged.skipped = merged.skipped.filter((entry) => !done.has(entry.id));
  return merged;
}

/**
 * Nimmt entschiedene Einträge sofort aus der Liste und lädt Inbox und Konzepte neu. Mitentschiedene Folge-Einträge
 * (`InboxItem` zeigt `decision` nicht) verschwinden mit dem Neuladen.
 */
export function applyDecided(client: QueryClient, ids: readonly string[]): void {
  const gone = new Set(ids);
  client.setQueryData<InboxItem[]>(INBOX_OPEN_KEY, (old) => old?.filter((item) => !gone.has(item.id)));
  refreshInbox(client);
}

export function refreshInbox(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: INBOX_KEY });
  void client.invalidateQueries({ queryKey: CONCEPTS_KEY });
}

/**
 * Ziel von „Alle annehmen“: die Session, wenn die Gruppe alle ihre offenen Einträge zeigt, sonst genau die
 * sichtbaren Einträge (Filter nach Art, ältere Einträge stehen gesammelt woanders, Einträge ohne Session).
 */
export function bulkTarget(
  visible: readonly InboxItem[],
  sessionId: string | null,
  sessionOpenCount: number,
): Pick<InboxBulkRequest, 'ids' | 'session_id'> {
  if (sessionId !== null && visible.length === sessionOpenCount) return { session_id: sessionId };
  // Reihenfolge wie im Core (§20.6, §21.7): erst Konzepte nach `priority`, dann Beziehungen, dann Karten. So bleibt sie auch über die
  // Blöcke zu 500 hinweg erhalten.
  const rank = (item: InboxItem) => (item.kind === 'relation' ? 1 : item.kind === 'card_batch' ? 2 : 0);
  const ordered = [...visible].sort((a, b) => rank(a) - rank(b) || a.priority - b.priority);
  return { ids: ordered.map((item) => item.id) };
}

/**
 * „Rückgängig“ nach einer Massenaktion: `reopen` in umgekehrter Reihenfolge (§20.6). `decided` enthält auch die
 * mitentschiedenen Folge-Einträge (§20.6: „geänderte Einträge“); der Core öffnet sie zusammen mit ihrem Auslöser,
 * auch über die Blöcke zu 500 hinweg (`bulkInChunks`). `inbox_item_not_decided` heißt: schon wieder offen (etwa aus
 * einem anderen Tab), also kein Fehler.
 */
export async function undoBulk(decided: readonly string[]): Promise<InboxBulkResult> {
  const result = await bulkInChunks({ action: 'reopen', ids: [...decided].reverse() });
  return {
    decided: result.decided,
    skipped: result.skipped.filter((entry) => entry.code !== 'inbox_item_not_decided'),
  };
}

// ---------------------------------------------------------------------------------------------
// Anzeige
// ---------------------------------------------------------------------------------------------

/** Namen der Konzepte, die in offenen Einträgen vorkommen (Vorschläge und Ziele) */
export function conceptNames(items: readonly InboxItem[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const item of items) {
    if (item.payload.kind === 'relation' || item.payload.kind === 'card_batch') continue;
    if (item.concept_id) names.set(item.concept_id, item.payload.proposal.name);
    if (item.payload.kind === 'concept_merge') {
      names.set(item.payload.target.concept_id, item.payload.target.name);
    }
  }
  return names;
}

/** IDs der Endpunkte von Beziehungen, deren Name aus den offenen Einträgen nicht hervorgeht */
export function unknownEndpoints(items: readonly InboxItem[], names: ReadonlyMap<string, string>): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.payload.kind !== 'relation') continue;
    for (const id of [item.payload.from_concept_id, item.payload.to_concept_id]) {
      if (!names.has(id)) ids.add(id);
    }
  }
  return [...ids].sort();
}

/** Kurzbeschreibung einer Beziehung: „A baut auf B auf“ */
export function relationText(item: InboxItem, names: ReadonlyMap<string, string>): string {
  if (item.payload.kind !== 'relation') return '';
  const from = names.get(item.payload.from_concept_id) ?? 'Ein Konzept';
  const to = names.get(item.payload.to_concept_id) ?? 'ein anderes Konzept';
  return relationSentence(item.payload.relation_kind, from, to);
}

/** Hinweis einer blockierten Beziehung: „wartet auf *Konzept*“ */
export function blockedHint(
  item: InboxItem,
  names: ReadonlyMap<string, string>,
  pending: ReadonlySet<string>,
): string | null {
  if (item.blocked === null || item.payload.kind !== 'relation') return null;
  const ends = [item.payload.from_concept_id, item.payload.to_concept_id];
  if (item.blocked === 'endpunkt_offen') {
    const waiting = ends.filter((id) => pending.has(id)).map((id) => names.get(id));
    const known = waiting.filter((name): name is string => name !== undefined);
    return known.length > 0 ? `wartet auf ${known.join(' und ')}` : 'wartet auf ein Konzept';
  }
  return 'ein Konzept dazu wurde verworfen';
}

/** Konzepte, die noch als offener Vorschlag in der Inbox liegen */
export function pendingConcepts(items: readonly InboxItem[]): Set<string> {
  return new Set(
    items.flatMap((item) => (item.kind !== 'relation' && item.concept_id ? [item.concept_id] : [])),
  );
}

export function isOlder(item: Pick<InboxItem, 'created_at'>, now: number): boolean {
  return now - Date.parse(item.created_at) > OLDER_AFTER_MS;
}

/** „12 ältere Vorschläge“ */
export function olderLabel(count: number): string {
  return count === 1 ? '1 älterer Vorschlag' : `${count} ältere Vorschläge`;
}

/** Aliase aus einem Eingabefeld: durch Komma getrennt, ohne Leere und Doppelte, höchstens 20 */
export function parseAliases(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(',')) {
    const alias = part.trim().replace(/\s+/g, ' ');
    if (alias === '' || seen.has(alias.toLowerCase())) continue;
    seen.add(alias.toLowerCase());
    out.push(alias.slice(0, 200));
  }
  return out.slice(0, 20);
}
