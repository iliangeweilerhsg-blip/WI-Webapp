'use client';

// Karten und Wiederholung (VERTRAEGE §21.4, §21.10): Abfragen, Bewerten mit Wiederholung bei Netzfehlern, Texte.
// Karteninhalte sind reiner Text (§21.2), nie Markdown oder HTML.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import {
  CardListSchema,
  CardSchema,
  ReviewQueueSchema,
  ReviewResultSchema,
  type Card,
  type CardContent,
  type CardCreate,
  type CardUpdate,
  type ReviewQueue,
  type ReviewQueueItem,
  type ReviewRating,
  type ReviewResult,
} from '@sg/shared';
import { watchReconnect } from '../components/dashboard/reconnect.ts';
import { ApiRequestError, apiGet, apiSend, friendlyMessage, isUnreachable, type Parser } from './api.ts';
import { useConceptDetail } from './concepts.ts';
import { useHydrationSafe } from './hydrated.ts';
import { useSyncClient } from './sync/SyncProvider.tsx';
import { uuidv7 } from './uuid.ts';

// ---------------------------------------------------------------------------------------------
// Abfragen
// ---------------------------------------------------------------------------------------------

export const REVIEW_KEY = ['review'] as const;
export const reviewQueueKey = (extraMinutes: number) => ['review', 'queue', extraMinutes] as const;
export const CARDS_KEY = ['cards'] as const;
export const conceptCardsKey = (conceptId: string) => ['cards', 'concept', conceptId] as const;

/** „Weitere 10 min“ (§21.10): `extra_minutes` wächst in Schritten von 10 bis höchstens 120 */
export const EXTRA_STEP_MINUTES = 10;
export const EXTRA_MAX_MINUTES = 120;

/**
 * `extra_minutes` für „Weitere 10 min“: so viele Zehnerschritte, dass nach der heute schon verbrauchten Zeit wieder
 * mindestens 10 min frei sind, höchstens 120. Ein Abruf genügt, kein Herantasten in Schritten. `null`: Die Grenze ist
 * erreicht.
 */
export function nextExtraMinutes(
  queue: Pick<ReviewQueue, 'budget_minutes' | 'used_seconds'>,
  extraMinutes: number,
): number | null {
  const overMinutes = queue.used_seconds / 60 - queue.budget_minutes;
  const needed = Math.ceil((overMinutes + EXTRA_STEP_MINUTES) / EXTRA_STEP_MINUTES) * EXTRA_STEP_MINUTES;
  const next = Math.min(EXTRA_MAX_MINUTES, Math.max(extraMinutes + EXTRA_STEP_MINUTES, needed));
  return next > extraMinutes ? next : null;
}

export function fetchReviewQueue(extraMinutes: number, signal?: AbortSignal): Promise<ReviewQueue> {
  const query = extraMinutes > 0 ? `?extra_minutes=${extraMinutes}` : '';
  return apiGet(`/review/queue${query}`, ReviewQueueSchema, { signal });
}

/**
 * `GET /review/queue`: beim Öffnen, wenn das Fenster wieder sichtbar wird und nach dem Neuverbinden (§21.9).
 * `enabled = false` lädt nichts (etwa auf Heute, solange eine Session läuft).
 */
export function useReviewQueue(extraMinutes = 0, options: { enabled?: boolean } = {}) {
  const client = useQueryClient();
  const sync = useSyncClient();
  const enabled = options.enabled ?? true;
  const query = useQuery({
    queryKey: reviewQueueKey(extraMinutes),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: ({ signal }) => fetchReviewQueue(extraMinutes, signal),
  });
  useEffect(() => {
    if (!sync || !enabled) return;
    return watchReconnect(sync, () => void client.invalidateQueries({ queryKey: REVIEW_KEY }));
  }, [sync, client, enabled]);
  return useHydrationSafe(query);
}

/** „≈ n min“, aufgerundet; mindestens 1, solange es etwas zu tun gibt */
export function queueMinutes(queue: Pick<ReviewQueue, 'estimated_seconds' | 'items'>): number {
  if (queue.items.length === 0) return 0;
  return Math.max(1, Math.ceil(queue.estimated_seconds / 60));
}

/** `GET /concepts/{id}/cards` */
export function useConceptCards(conceptId: string, enabled = true) {
  const query = useQuery({
    queryKey: conceptCardsKey(conceptId),
    enabled,
    queryFn: ({ signal }) =>
      apiGet(`/concepts/${encodeURIComponent(conceptId)}/cards`, CardListSchema, { signal }),
  });
  return useHydrationSafe(query);
}

/** `POST /cards`: Karte von Hand (§21.4). Die `id` vergibt der Client, damit ein Wiederholen keine zweite Karte anlegt. */
export function createCard(body: CardCreate): Promise<Card> {
  return apiSend('POST', '/cards', CardSchema, { body });
}

/** `GET /cards/{id}` */
export function fetchCard(id: string): Promise<Card> {
  return apiGet(`/cards/${encodeURIComponent(id)}`, CardSchema);
}

export function patchCard(id: string, update: CardUpdate): Promise<Card> {
  return apiSend('PATCH', `/cards/${encodeURIComponent(id)}`, CardSchema, { body: update });
}

export function deleteCard(id: string): Promise<void> {
  return apiSend('DELETE', `/cards/${encodeURIComponent(id)}`, null);
}

/**
 * „Rückgängig“ nach dem Löschen: `POST /trash/{id}/restore`. Die Antwort wird nicht gelesen. `TrashKind` kennt `card`
 * erst mit dem Core-Teil des Schnitts (§21.8), darum prüft die Web-App sie hier nicht.
 */
export function restoreCard(id: string): Promise<unknown> {
  const anything: Parser<unknown> = { safeParse: (data) => ({ success: true, data }) };
  return apiSend('POST', `/trash/${encodeURIComponent(id)}/restore`, anything);
}

/**
 * Das wirksame Konzept eines Kartenvorschlags (§21.7): der aktuelle Name, bei einer Hülle das Ziel (`merged_into`).
 * Bis der Name da ist (oder wenn das Konzept nicht zu laden ist), gilt der Name aus der Nutzlast.
 */
export function useEffectiveConcept(
  conceptId: string,
  fallbackName: string,
): { id: string; name: string; examRelevant: boolean } {
  const first = useConceptDetail(conceptId);
  const merged =
    first.data?.concept.status === 'zusammengefuehrt' ? (first.data.concept.merged_into ?? null) : null;
  const target = useConceptDetail(merged);
  const concept = merged ? target.data?.concept : first.data?.concept;
  return {
    id: merged ?? conceptId,
    name: concept?.name ?? fallbackName,
    examRelevant: concept?.exam_relevant ?? false,
  };
}

// ---------------------------------------------------------------------------------------------
// Anzeige: Lücken, Zustand, Quellen
// ---------------------------------------------------------------------------------------------

export interface ClozePart {
  text: string;
  /** Nummer der Lücke (1–3), `null` für normalen Text */
  gap: number | null;
}

const GAP = /\{\{c(\d+)::([\s\S]*?)\}\}/g;

/** Zerlegt `{{c1::Lösung}}` in Text und Lücken */
export function clozeParts(text: string): ClozePart[] {
  const parts: ClozePart[] = [];
  let last = 0;
  for (const match of text.matchAll(GAP)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), gap: null });
    parts.push({ text: (match[2] ?? '').trim(), gap: Number(match[1]) });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), gap: null });
  return parts;
}

/** Vorderseite als Text: Lücken verdeckt (`[…]`), alle zusammen (§21.2) */
export function cardFrontText(content: CardContent): string {
  if (content.kind === 'basic') return content.front.text_md;
  return clozeParts(content.front.text_md)
    .map((part) => (part.gap === null ? part.text : '[…]'))
    .join('');
}

export const CARD_KIND_LABELS: Record<CardContent['kind'], string> = {
  basic: 'Frage',
  cloze: 'Lückentext',
};

const dueFormat = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' });

/** Zustand in Worten (§21.10): „neu“, „fällig am 12. November“, „pausiert“ */
export function cardStateText(card: Pick<Card, 'suspended' | 'state'>): string {
  if (card.suspended) return 'pausiert';
  if (card.state.state === 'new') return 'neu';
  return `fällig am ${dueFormat.format(new Date(card.state.due))}`;
}

// ---------------------------------------------------------------------------------------------
// Bearbeiten: Entwurf ↔ Inhalt
// ---------------------------------------------------------------------------------------------

export interface CardDraft {
  kind: CardContent['kind'];
  front: string;
  /** `basic`: Antwort. Bei `cloze` nicht genutzt */
  back: string;
  /** `basic`: Erklärung (leer = keine) */
  explanation: string;
}

export const CARD_LIMITS = { front: 500, back: 1000, explanation: 1000 } as const;

export function draftFromContent(content: CardContent): CardDraft {
  if (content.kind === 'basic') {
    return {
      kind: 'basic',
      front: content.front.text_md,
      back: content.back.text_md,
      explanation: content.back.explanation_md ?? '',
    };
  }
  return { kind: 'cloze', front: content.front.text_md, back: '', explanation: '' };
}

export type DraftResult = { ok: true; content: CardContent } | { ok: false; message: string };

const REASON_MESSAGES: Record<string, string> = {
  empty: 'Ein Feld ist leer.',
  too_long: 'Ein Text ist zu lang. Bitte kürze ihn.',
  cloze_syntax: 'Die Lücken sind nicht richtig geschrieben. So geht es: {{c1::Begriff}}.',
  cloze_none: 'Es fehlt eine Lücke. So geht es: {{c1::Begriff}}.',
  cloze_numbers: 'Die Lücken müssen bei c1 beginnen und lückenlos zählen.',
  cloze_answers: 'Die Lösungen passen nicht zu den Lücken.',
};

/**
 * Baut den Inhalt aus dem Entwurf. Bei `cloze` ergeben sich die Lösungen aus den Lücken im Text; gleichwertige
 * Schreibweisen bleiben erhalten, solange die Lücke dieselbe ist. Der Core prüft danach noch einmal (§21.2).
 */
export function contentFromDraft(draft: CardDraft, previous: CardContent): DraftResult {
  const front = draft.front.trim();
  if (front === '') return { ok: false, message: REASON_MESSAGES.empty ?? '' };
  if (draft.kind === 'basic') {
    const back = draft.back.trim();
    if (back === '') return { ok: false, message: REASON_MESSAGES.empty ?? '' };
    const explanation = draft.explanation.trim();
    return {
      ok: true,
      content: {
        kind: 'basic',
        front: { text_md: front },
        back: { text_md: back, explanation_md: explanation === '' ? null : explanation },
      },
    };
  }
  const gaps = clozeParts(front).filter((part) => part.gap !== null);
  if (gaps.length === 0) return { ok: false, message: REASON_MESSAGES.cloze_none ?? '' };
  const numbers = gaps.map((part) => part.gap as number);
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  const contiguous = unique.every((n, i) => n === i + 1) && unique.length <= 3;
  if (!contiguous || unique.length !== numbers.length) {
    return { ok: false, message: REASON_MESSAGES.cloze_numbers ?? '' };
  }
  const old = previous.kind === 'cloze' ? previous.back.answers : null;
  const answers: Record<string, string[]> = {};
  for (const part of gaps) {
    const key = `c${part.gap}`;
    const before = old ? ((old as unknown as Record<string, string[] | undefined>)[key] ?? []) : [];
    answers[key] = before[0] === part.text ? before : [part.text];
  }
  return {
    ok: true,
    content: {
      kind: 'cloze',
      front: { text_md: front },
      back: { answers: answers as { c1: string[]; c2?: string[]; c3?: string[] } },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Fehlertexte
// ---------------------------------------------------------------------------------------------

const CARD_MESSAGES: Record<string, string> = {
  card_not_found: 'Diese Karte gibt es nicht mehr.',
  card_suspended: 'Diese Karte ist pausiert.',
  card_source_invalid: 'Einen Beleg dieser Karte gibt es nicht mehr.',
  card_concept_pending: 'Erst das Konzept annehmen, dann die Karten.',
  concept_not_active:
    'Zu diesem Konzept lassen sich keine Karten anlegen. Es ist noch nicht angenommen oder wurde zusammengeführt.',
  concept_not_found: 'Dieses Konzept gibt es nicht mehr.',
  card_exists: 'Diese Karte gibt es schon.',
};

/** Text für die Oberfläche zu einem Fehler rund um Karten */
export function cardErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.code !== null) {
    if (error.code === 'card_invalid') {
      const reason = error.details.reason;
      return (
        (typeof reason === 'string' ? REASON_MESSAGES[reason] : undefined) ??
        'Der Inhalt der Karte passt so nicht.'
      );
    }
    if (error.code === 'card_source_invalid') {
      const index = error.details.index;
      return typeof index === 'number'
        ? `Den Beleg ${index + 1} gibt es nicht mehr. Wähle einen anderen.`
        : (CARD_MESSAGES.card_source_invalid ?? '');
    }
    const known = CARD_MESSAGES[error.code];
    if (known) return known;
  }
  return friendlyMessage(error);
}

// ---------------------------------------------------------------------------------------------
// Bewerten: Postausgang mit Wiederholung (§21.4 „idempotent über id“, §21.10)
// ---------------------------------------------------------------------------------------------

export interface RatingJob {
  /** UUIDv7 des Clients, je Bewertung einmal; jede Wiederholung sendet dieselbe */
  id: string;
  cardId: string;
  rating: ReviewRating;
  durationMs: number;
}

export interface OutboxSnapshot {
  /** Werden gerade gesendet oder warten auf den nächsten Versuch */
  pending: number;
  /** Alle Versuche sind gescheitert, „Erneut versuchen“ sendet sie noch einmal */
  failed: number;
}

interface OutboxEntry {
  job: RatingJob;
  status: 'sending' | 'waiting' | 'failed';
  attempts: number;
  done: (result: ReviewResult | null, error?: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Netzfehler, 5xx und unlesbare Antworten kann ein erneutes Senden beheben; 4xx nicht */
function isRetryable(error: unknown): boolean {
  if (isUnreachable(error)) return true;
  if (!(error instanceof ApiRequestError)) return false;
  return error.kind === 'invalid' || (error.kind === 'api' && (error.status ?? 0) >= 500);
}

const clampDuration = (ms: number) => Math.min(3_600_000, Math.max(0, Math.round(ms)));

/**
 * Sendet Bewertungen im Hintergrund, damit die nächste Karte sofort erscheint. Scheitert eine Anfrage am Netz, geht sie
 * mit **derselben** `id` noch zweimal hinaus (nach 1,5 s und 4 s); der Core zählt sie dank `id` nie doppelt. Danach steht
 * sie als `failed` da und wartet auf „Erneut versuchen“. Lebt außerhalb der Ansicht, damit ein Seitenwechsel nichts verliert.
 */
export class RatingOutbox {
  retryDelaysMs: number[] = [1500, 4000];
  private entries = new Map<string, OutboxEntry>();
  private listeners = new Set<() => void>();
  private snapshot: OutboxSnapshot = { pending: 0, failed: 0 };

  submit(job: RatingJob, done: OutboxEntry['done']): void {
    const entry: OutboxEntry = {
      job: { ...job, durationMs: clampDuration(job.durationMs) },
      status: 'sending',
      attempts: 0,
      done,
      timer: null,
    };
    this.entries.set(job.id, entry);
    this.update();
    void this.attempt(entry);
  }

  /** Alle gescheiterten Bewertungen noch einmal senden (mit ihren `id`) */
  retryFailed(): void {
    for (const entry of this.entries.values()) {
      if (entry.status !== 'failed') continue;
      entry.status = 'sending';
      entry.attempts = 0;
      void this.attempt(entry);
    }
    this.update();
  }

  /** Karten mit einer Bewertung, die noch nicht beim Core ist: Sie kommen nicht in einen neuen Block (sonst zweimal bewertet) */
  unsentCardIds(): Set<string> {
    return new Set([...this.entries.values()].map((entry) => entry.job.cardId));
  }

  /** Verwirft alles (nur für Tests) */
  reset(): void {
    for (const entry of this.entries.values()) if (entry.timer) clearTimeout(entry.timer);
    this.entries.clear();
    this.retryDelaysMs = [1500, 4000];
    this.update();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): OutboxSnapshot => this.snapshot;

  private update(): void {
    let pending = 0;
    let failed = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === 'failed') failed += 1;
      else pending += 1;
    }
    if (pending === this.snapshot.pending && failed === this.snapshot.failed) return;
    this.snapshot = { pending, failed };
    for (const listener of this.listeners) listener();
  }

  private async attempt(entry: OutboxEntry): Promise<void> {
    const { job } = entry;
    entry.status = 'sending';
    entry.attempts += 1;
    let result: ReviewResult;
    try {
      result = await apiSend('POST', `/cards/${encodeURIComponent(job.cardId)}/review`, ReviewResultSchema, {
        body: { id: job.id, rating: job.rating, duration_ms: job.durationMs },
        // Eine Bewertung, die beim Neuladen oder Schließen der Seite unterwegs ist, kommt trotzdem an
        keepalive: true,
      });
    } catch (error) {
      if (!isRetryable(error)) {
        // Etwa eine inzwischen pausierte oder gelöschte Karte: Es gibt nichts mehr zu senden
        this.settle(entry, null, error);
        return;
      }
      const delay = this.retryDelaysMs[entry.attempts - 1];
      if (delay === undefined) {
        entry.status = 'failed';
        this.update();
        return;
      }
      entry.status = 'waiting';
      this.update();
      entry.timer = setTimeout(() => {
        entry.timer = null;
        void this.attempt(entry);
      }, delay);
      return;
    }
    this.settle(entry, result);
  }

  /** Erst die Folgen der Antwort (etwa `requeue`), dann der neue Stand: So sieht die Ansicht nie „nichts mehr offen“, bevor die Karte wieder hinten im Block steht */
  private settle(entry: OutboxEntry, result: ReviewResult | null, error?: unknown): void {
    this.entries.delete(entry.job.id);
    try {
      entry.done(result, error);
    } finally {
      this.update();
    }
  }
}

/** Der gemeinsame Postausgang der Web-App */
export const ratingOutbox = new RatingOutbox();

export function useRatingOutbox(): OutboxSnapshot {
  return useSyncExternalStore(ratingOutbox.subscribe, ratingOutbox.getSnapshot, ratingOutbox.getSnapshot);
}

/** Neue Bewertung: Client-`id` (UUIDv7) je Bewertung */
export function newRatingJob(cardId: string, rating: ReviewRating, durationMs: number): RatingJob {
  return { id: uuidv7(), cardId, rating, durationMs };
}

// ---------------------------------------------------------------------------------------------
// Block: Zustand der laufenden Wiederholung
// ---------------------------------------------------------------------------------------------

export interface BlockState {
  phase: 'overview' | 'running' | 'finished';
  /** Alle Karten des Blocks in der Reihenfolge der Anzeige, vorgezogene Karten hängen hinten an */
  deck: ReviewQueueItem[];
  index: number;
  revealed: boolean;
  /** Seit wann die Vorderseite steht (ms, Uhr des Browsers); Grundlage von `duration_ms` */
  shownAt: number;
  rated: number;
  spentMs: number;
  /** Mit Esc beendet, obwohl noch Karten übrig waren */
  endedEarly: boolean;
}

export const INITIAL_BLOCK: BlockState = {
  phase: 'overview',
  deck: [],
  index: 0,
  revealed: false,
  shownAt: 0,
  rated: 0,
  spentMs: 0,
  endedEarly: false,
};

export type BlockAction =
  | { type: 'start'; items: ReviewQueueItem[]; now: number }
  | { type: 'reveal' }
  | { type: 'rate'; durationMs: number; now: number }
  /** Die Karte kommt noch einmal dran (`requeue`): ans Ende des Blocks */
  | { type: 'append'; item: ReviewQueueItem }
  /** Neue Fassung einer Karte (bearbeitet) */
  | { type: 'replace'; card: Card }
  /** Karte aus dem Rest des Blocks nehmen (pausiert, gelöscht) */
  | { type: 'remove'; cardId: string; now: number }
  | { type: 'end'; early: boolean }
  | { type: 'reset' };

export function blockReducer(state: BlockState, action: BlockAction): BlockState {
  switch (action.type) {
    case 'start':
      return { ...INITIAL_BLOCK, phase: 'running', deck: action.items, shownAt: action.now };
    case 'reveal':
      return state.phase === 'running' && !state.revealed ? { ...state, revealed: true } : state;
    case 'rate':
      if (state.phase !== 'running' || !state.revealed || state.index >= state.deck.length) return state;
      return {
        ...state,
        index: state.index + 1,
        revealed: false,
        shownAt: action.now,
        rated: state.rated + 1,
        spentMs: state.spentMs + action.durationMs,
      };
    case 'append':
      return state.phase === 'overview' ? state : { ...state, deck: [...state.deck, action.item] };
    case 'replace':
      return {
        ...state,
        deck: state.deck.map((item) =>
          item.card.id === action.card.id ? { ...item, card: action.card } : item,
        ),
      };
    case 'remove': {
      const at = state.deck.findIndex((item, i) => i >= state.index && item.card.id === action.cardId);
      if (at === -1) return state;
      return {
        ...state,
        deck: state.deck.filter((_, i) => i !== at),
        // War es die aktuelle Karte, steht die nächste vorn und die Zeit beginnt neu
        ...(at === state.index ? { revealed: false, shownAt: action.now } : {}),
      };
    }
    case 'end':
      return state.phase === 'running'
        ? {
            ...state,
            phase: 'finished',
            revealed: false,
            endedEarly: action.early && state.index < state.deck.length,
          }
        : state;
    case 'reset':
      return INITIAL_BLOCK;
  }
}

/** „1 Karte“, „14 Karten“ */
export function cardsCount(n: number): string {
  return n === 1 ? '1 Karte' : `${n} Karten`;
}

/** „Für heute geschafft · 14 Karten in 6 min“ */
export function blockSummary(state: Pick<BlockState, 'rated' | 'spentMs' | 'endedEarly'>): string {
  if (state.rated === 0) return 'Block beendet';
  const minutes = Math.max(1, Math.round(state.spentMs / 60_000));
  const lead = state.endedEarly ? 'Block beendet' : 'Für heute geschafft';
  return `${lead} · ${cardsCount(state.rated)} in ${minutes} min`;
}
