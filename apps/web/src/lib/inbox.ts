'use client';

// Inbox der Vorschläge (VERTRAEGE §20.6, §20.10, F-NAC-06): Abfragen, Entscheidungen und Texte.
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import {
  ApiErrorSchema,
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
import { ApiRequestError, apiBase, apiGet, friendlyMessage, type Parser } from './api.ts';
import { CONCEPTS_KEY, relationSentence } from './concepts.ts';
import { useHydrationSafe } from './hydrated.ts';
import { useActiveSession } from './sessions.ts';
import { useSyncClient } from './sync/SyncProvider.tsx';

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
};

export const INBOX_KIND_FILTERS: readonly { kind: InboxKind; label: string }[] = [
  { kind: 'concept_new', label: 'Neue Konzepte' },
  { kind: 'concept_merge', label: 'Zusammenführen' },
  { kind: 'relation', label: 'Beziehungen' },
];

/** Typ-Symbol je Art (rein dekorativ, die Art steht zusätzlich als Text für Screenreader da) */
export const INBOX_KIND_SYMBOLS: Record<InboxKind, string> = {
  concept_new: '◆',
  concept_merge: '⇄',
  relation: '↗',
};

// ---------------------------------------------------------------------------------------------
// Fehler: `lib/api.ts` reicht `details` nicht durch und kennt die Codes aus §20.11 nicht
// ---------------------------------------------------------------------------------------------

const INBOX_MESSAGES: Record<string, string> = {
  inbox_item_not_found: 'Diesen Vorschlag gibt es nicht mehr.',
  concept_not_found: 'Dieses Konzept gibt es nicht mehr.',
  inbox_item_decided: 'Dieser Vorschlag ist schon entschieden.',
  inbox_item_not_decided: 'Dieser Vorschlag ist noch offen.',
  inbox_reopen_conflict: 'Rückgängig geht nicht mehr: Darauf baut inzwischen anderes auf.',
  concept_exists: 'Ein Konzept mit diesem Namen gibt es schon.',
  merge_target_invalid: 'Mit diesem Konzept lässt sich nicht zusammenführen. Wähle ein anderes Ziel.',
  relation_endpoint_pending: 'Erst die beiden Konzepte annehmen, dann die Beziehung.',
  relation_cycle: 'Das würde einen Kreis bilden.',
  inbox_action_invalid: 'Das passt nicht zu dieser Art von Vorschlag.',
  inbox_busy: 'Gerade beschäftigt, bitte gleich nochmal.',
  session_not_found: 'Diese Vorlesung gibt es nicht mehr.',
};

/** Fehler einer Inbox-Aktion samt `details` des Core (`concept_id`, `path`, `triggered_by`, …) */
export class InboxRequestError extends ApiRequestError {
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown>) {
    super({
      kind: 'api',
      status,
      code,
      message: `${code}: ${message}`,
      userMessage:
        INBOX_MESSAGES[code] ??
        (status >= 500 ? 'Im Core ist etwas schiefgegangen.' : 'Das hat nicht geklappt.'),
    });
    this.name = 'InboxRequestError';
    this.details = details;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** POST mit `Idempotency-Key` (08 §1); Fehler behalten ihre `details` */
async function inboxPost<T>(path: string, schema: Parser<T>, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Idempotency-Key': globalThis.crypto.randomUUID(),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    throw new ApiRequestError({
      kind: 'unreachable',
      message: `Core nicht erreichbar: ${String(cause)}`,
      userMessage: 'Core nicht erreichbar',
    });
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // Kein JSON: unten als Fehler behandelt
  }
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    const raw = isRecord(json) && isRecord(json.error) ? json.error : null;
    if (parsed.success || (raw && typeof raw.code === 'string')) {
      const code = parsed.success ? parsed.data.error.code : String(raw?.code);
      const message = parsed.success ? parsed.data.error.message : String(raw?.message ?? '');
      throw new InboxRequestError(res.status, code, message, isRecord(raw?.details) ? raw.details : {});
    }
    throw new ApiRequestError({
      kind: 'api',
      status: res.status,
      message: `HTTP ${res.status}`,
      userMessage: res.status >= 500 ? 'Im Core ist etwas schiefgegangen.' : 'Core antwortet unerwartet',
    });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiRequestError({
      kind: 'invalid',
      status: res.status,
      message: `Antwort passt nicht zum Schema: ${parsed.error.message}`,
      userMessage: 'Der Core hat unerwartet geantwortet.',
    });
  }
  return parsed.data;
}

/** Code eines Fehlers aus dem Core, sonst `null` */
export function errorCode(error: unknown): string | null {
  return error instanceof ApiRequestError ? error.code : null;
}

/** `details.<key>` als Text (z. B. `concept_id`), sonst `null` */
export function errorDetail(error: unknown, key: string): string | null {
  const value = error instanceof InboxRequestError ? error.details[key] : null;
  return typeof value === 'string' ? value : null;
}

/** „Das würde einen Kreis bilden: A → B → A“ (F-BIB-03); ohne bekannte Namen nur der erste Satz */
export function cycleMessage(error: unknown, names: ReadonlyMap<string, string>): string {
  const path = error instanceof InboxRequestError ? error.details.path : null;
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
  if (code !== null && INBOX_MESSAGES[code]) return INBOX_MESSAGES[code];
  return friendlyMessage(error);
}

// ---------------------------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------------------------

const MAX_PAGES = 10;

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
    return sync.onEvent('session.updated', (session) => {
      if (session.processing['concepts.resolve'] === 'fertig') {
        void client.invalidateQueries({ queryKey: INBOX_KEY });
      }
    });
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
  return inboxPost(itemPath(id, 'accept'), InboxDecisionResultSchema, request);
}

export function rejectItem(id: string): Promise<InboxDecisionResult> {
  return inboxPost(itemPath(id, 'reject'), InboxDecisionResultSchema);
}

export function reopenItem(id: string): Promise<InboxDecisionResult> {
  return inboxPost(itemPath(id, 'reopen'), InboxDecisionResultSchema);
}

export function bulkInbox(request: InboxBulkRequest): Promise<InboxBulkResult> {
  return inboxPost('/inbox/bulk', InboxBulkResultSchema, request);
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
  return { ids: visible.map((item) => item.id) };
}

/** „Rückgängig“ nach einer Massenaktion: `reopen` in umgekehrter Reihenfolge (§20.6) */
export function undoBulk(decided: readonly string[]): Promise<InboxBulkResult> {
  return bulkInbox({ action: 'reopen', ids: [...decided].reverse() });
}

// ---------------------------------------------------------------------------------------------
// Anzeige
// ---------------------------------------------------------------------------------------------

/** Namen der Konzepte, die in offenen Einträgen vorkommen (Vorschläge und Ziele) */
export function conceptNames(items: readonly InboxItem[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const item of items) {
    if (item.payload.kind === 'relation') continue;
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
