// Fake-Core für Karten und Wiederholung (VERTRAEGE §21.4, §21.5, §21.7): die Routen, die die Web-App braucht, mit den
// Regeln des echten Core in schmaler Form. Alle Karten und Namen sind erfunden.
import type {
  Card,
  CardContent,
  CardProposal,
  CardState,
  EvidenceRef,
  InboxItem,
  ReviewConceptRef,
  ReviewLogEntry,
  ReviewQueue,
  ReviewQueueItem,
} from '@sg/shared';
import type { FakeCore } from './fake-core.ts';

const NOW = '2026-11-12T10:00:00Z';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, details?: Record<string, unknown>) =>
  json({ error: { code, message: 'x', ...(details ? { details } : {}) } }, status);

export interface FakeCardsState {
  /** Karten in `GET /concepts/{id}/cards` und in der Warteschlange (ohne gelöschte) */
  cards: Card[];
  /** Gelöschte Karten (Papierkorb), `POST /trash/{id}/restore` holt sie zurück */
  trashed: Card[];
  /** Bewertungen nach ihrer Client-`id` */
  reviews: Map<string, ReviewLogEntry>;
  /** Zeitbudget ohne `extra_minutes`, wenn die Anfrage keines nennt (Standard 20) */
  budgetMinutes: number;
  /** Die nächste Bewertung scheitert wie bei abgerissener Verbindung; `after` = der Core hat sie davor verarbeitet */
  failNextReview: null | 'before' | 'after';
  /** So viele Bewertungen scheitern noch vor der Verarbeitung (Netzfehler) */
  failReviews: number;
  /** Erfundene Namen der Konzepte, falls kein Konzept in `core.concepts` steht */
  conceptNames: Record<string, string>;
  /** Je Eintrag `card_batch`: die beim Annehmen angelegten Karten (für `reopen`) */
  batchCards: Record<string, string[]>;
  /** Belege, die es nicht (mehr) gibt: `POST /cards` antwortet mit `card_source_invalid` (§21.4) */
  goneRefs: EvidenceRef[];
  /** Die nächste Anlage von Hand scheitert wie bei abgerissener Verbindung; `after` = der Core hat sie davor angelegt */
  failNextCreate: null | 'before' | 'after';
}

export function makeFakeCardsState(): FakeCardsState {
  return {
    cards: [],
    trashed: [],
    reviews: new Map(),
    budgetMinutes: 20,
    failNextReview: null,
    failReviews: 0,
    conceptNames: {},
    batchCards: {},
    goneRefs: [],
    failNextCreate: null,
  };
}

let counter = 0;
export const cardId = (n: number) => `0190f6a2-0000-7000-8000-${String(900_000 + n).padStart(12, '0')}`;

export function makeCardState(overrides: Partial<CardState> = {}): CardState {
  return {
    state: 'new',
    due: NOW,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    last_review: null,
    ...overrides,
  };
}

export const DECK_ID = '0190f6a2-0000-7000-8000-000000000700';

export const slideRef = (deckId: string, index: number): EvidenceRef => ({
  kind: 'slide',
  slide_id: `0190f6a2-0000-7000-8000-${String(5000 + index).padStart(12, '0')}`,
  deck_id: deckId,
  slide_index: index,
});

export const timeRef = (sessionId: string, ms: number): EvidenceRef => ({
  kind: 'transcript',
  session_id: sessionId,
  t_start_ms: ms,
  t_end_ms: ms + 10_000,
});

export const BASIC: CardContent = {
  kind: 'basic',
  front: { text_md: 'Wann ist eine Relation in dritter Normalform?' },
  back: {
    text_md: 'Wenn sie in 2NF ist und kein Nichtschlüsselattribut transitiv vom Schlüssel abhängt.',
    explanation_md: 'Transitive Abhängigkeiten wandern in eine eigene Tabelle.',
  },
};

export const CLOZE: CardContent = {
  kind: 'cloze',
  front: { text_md: 'Eine Relation in 3NF ist immer auch in {{c1::2NF}}.' },
  back: { answers: { c1: ['2NF', 'zweite Normalform'] } },
};

/** Eine Karte; `concept_id` und `sources` gehören dem Test */
export function makeCard(overrides: Partial<Card> & { concept_id: string }): Card {
  counter += 1;
  return {
    id: cardId(counter),
    created_at: NOW,
    updated_at: NOW,
    stage: 2,
    origin: 'ki',
    suspended: false,
    content: BASIC,
    // Schema: mindestens ein Beleg (LP8)
    sources: [{ ref: slideRef(DECK_ID, 14), missing: false }],
    state: makeCardState(),
    ...overrides,
  };
}

/** Kartenvorschlag in der Inbox (`card_batch`, §21.7) */
export function makeCardProposal(
  key: string,
  content: CardContent,
  sources: EvidenceRef[] = [],
): CardProposal {
  return { key, content, sources };
}

/** Wie lange eine Karte im Fake-Core schätzungsweise dauert (§21.5: Startwerte) */
const estimate = (card: Card) => (card.content.kind === 'cloze' ? 20 : 12);

const isDueToday = (card: Card) =>
  card.state.state === 'new' || Date.parse(card.state.due) < Date.now() + 12 * 3600_000;

function conceptRef(core: FakeCore, id: string): ReviewConceptRef {
  const found = core.concepts.find((c) => c.concept.id === id)?.concept;
  return {
    id,
    name: found?.name ?? core.cards.conceptNames[id] ?? 'Konzept',
    exam_relevant: found?.exam_relevant ?? false,
  };
}

function buildQueue(core: FakeCore, budgetMinutes: number, extraMinutes: number): ReviewQueue {
  const live = core.cards.cards;
  const candidates = live.filter((card) => !card.suspended && isDueToday(card));
  const group = (card: Card): ReviewQueueItem['group'] =>
    card.state.state === 'new' ? 'neu' : card.state.state === 'review' ? 'faellig' : 'angefangen';
  const cost = (card: Card) => (group(card) === 'neu' ? 3 * estimate(card) : estimate(card));
  const used = [...core.cards.reviews.values()].reduce(
    (sum, r) => sum + Math.min(r.duration_ms, 120_000) / 1000,
    0,
  );
  let rest = Math.max(0, (budgetMinutes + extraMinutes) * 60 - Math.round(used));
  const ordered = [
    ...candidates.filter((c) => group(c) === 'angefangen'),
    ...candidates.filter((c) => group(c) === 'faellig'),
    ...candidates.filter((c) => group(c) === 'neu'),
  ];
  const picked: Card[] = [];
  const started = ordered.filter((c) => group(c) === 'angefangen');
  for (const card of started) {
    picked.push(card);
    rest = Math.max(0, rest - cost(card));
  }
  const open = (budgetMinutes + extraMinutes) * 60 - Math.round(used) > 0;
  if (open) {
    for (const card of ordered.filter((c) => group(c) !== 'angefangen')) {
      if (cost(card) > rest) break;
      picked.push(card);
      rest -= cost(card);
    }
    if (picked.length === 0 && ordered[0]) picked.push(ordered[0]);
  }
  const items: ReviewQueueItem[] = picked.map((card) => ({
    card,
    concept: conceptRef(core, card.concept_id),
    group: group(card),
    estimate_seconds: cost(card),
  }));
  return {
    day: '2026-11-12',
    day_ends_at: new Date(Date.now() + 12 * 3600_000).toISOString(),
    generated_at: new Date().toISOString(),
    budget_minutes: budgetMinutes,
    used_seconds: Math.round(used),
    estimated_seconds: items.reduce((sum, item) => sum + item.estimate_seconds, 0),
    reviewed_today: core.cards.reviews.size,
    items,
    more_due: candidates.some((c) => !picked.includes(c)),
    // §21.5: nur nicht gelöschte Karten zählen
    has_cards: live.length > 0,
  };
}

/** Kleinste Prüfung des Inhalts (§21.2): leer, Lücken */
function contentProblem(content: unknown): string | null {
  const c = content as CardContent | null;
  if (!c || (c.kind !== 'basic' && c.kind !== 'cloze')) return 'empty';
  if (c.front.text_md.trim() === '') return 'empty';
  if (c.kind === 'basic') return c.back.text_md.trim() === '' ? 'empty' : null;
  return /\{\{c1::[^}]+\}\}/.test(c.front.text_md) ? null : 'cloze_none';
}

/** `POST /cards` (§21.4): von Hand, `origin = manuell`, `stage = 2`, Beleg ist Pflicht (LP8) */
function createManual(
  core: FakeCore,
  body: Record<string, unknown> | null,
): { failure: { status: number; code: string; details?: Record<string, unknown> } } | { card: Card } {
  const allowed = ['id', 'concept_id', 'content', 'sources'];
  if (
    !body ||
    Object.keys(body).some((k) => !allowed.includes(k)) ||
    typeof body.concept_id !== 'string' ||
    !Array.isArray(body.sources) ||
    body.sources.length < 1 ||
    body.sources.length > 6 ||
    (body.id !== undefined && (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.id)))
  ) {
    return { failure: { status: 400, code: 'validation_failed' } };
  }
  const concept = core.concepts.find((c) => c.concept.id === body.concept_id)?.concept;
  if (!concept) return { failure: { status: 404, code: 'concept_not_found' } };
  if (concept.status !== 'aktiv') {
    return {
      failure: {
        status: 409,
        code: 'concept_not_active',
        details: {
          status: concept.status,
          ...(concept.merged_into ? { merged_into: concept.merged_into } : {}),
        },
      },
    };
  }
  const problem = contentProblem(body.content);
  if (problem) return { failure: { status: 400, code: 'card_invalid', details: { reason: problem } } };
  const refs = body.sources as EvidenceRef[];
  for (const [index, ref] of refs.entries()) {
    const text = JSON.stringify(ref);
    const duplicate = refs.findIndex((r) => JSON.stringify(r) === text) !== index;
    const gone = core.cards.goneRefs.some((r) => JSON.stringify(r) === text);
    const badTime = ref.kind === 'transcript' && ref.t_start_ms > ref.t_end_ms;
    if (duplicate || gone || badTime) {
      return { failure: { status: 400, code: 'card_source_invalid', details: { index } } };
    }
  }
  if (
    typeof body.id === 'string' &&
    [...core.cards.cards, ...core.cards.trashed].some((c) => c.id === body.id)
  ) {
    return { failure: { status: 409, code: 'card_exists' } };
  }
  const card = makeCard({
    ...(typeof body.id === 'string' ? { id: body.id } : {}),
    concept_id: concept.id,
    origin: 'manuell',
    content: body.content as CardContent,
    sources: refs.map((ref) => ({ ref, missing: false })),
  });
  core.cards.cards.push(card);
  return { card };
}

/** Neuer Zustand nach einer Bewertung, ohne FSRS: 1 und 2 bleiben im Lernschritt (noch heute), 3 und 4 gehen auf Tage */
function nextState(card: Card, rating: number): { state: CardState; requeue: boolean } {
  const now = Date.now();
  const before = card.state;
  const base = { ...before, reps: before.reps + 1, last_review: new Date(now).toISOString() };
  if (rating === 1 || rating === 2) {
    return {
      requeue: true,
      state: {
        ...base,
        state: before.state === 'review' ? 'relearning' : 'learning',
        due: new Date(now + (rating === 1 ? 60_000 : 360_000)).toISOString(),
        lapses: before.lapses + (rating === 1 && before.state === 'review' ? 1 : 0),
        stability: 0.5,
        difficulty: 6,
      },
    };
  }
  const days = rating === 3 ? 3 : 7;
  return {
    requeue: false,
    state: {
      ...base,
      state: 'review',
      due: new Date(now + days * 86_400_000).toISOString(),
      scheduled_days: days,
      stability: days,
      difficulty: 5,
    },
  };
}

function wirksam(core: FakeCore, conceptId: string) {
  const first = core.concepts.find((c) => c.concept.id === conceptId)?.concept;
  if (first?.status === 'zusammengefuehrt' && first.merged_into) {
    return core.concepts.find((c) => c.concept.id === first.merged_into)?.concept ?? null;
  }
  return first ?? null;
}

/** Ein Kartenvorschlag ist erst sichtbar, wenn sein wirksames Konzept `aktiv` ist (§21.7) */
export function cardBatchVisible(core: FakeCore, item: InboxItem): boolean {
  if (item.payload.kind !== 'card_batch') return true;
  return wirksam(core, item.payload.concept_id)?.status === 'aktiv';
}

/** Annehmen eines Kartenvorschlags (A4, §21.7); liefert den Fehler oder die angelegten Karten */
export function acceptCardBatch(
  core: FakeCore,
  item: InboxItem,
  request: Record<string, unknown>,
): { failure: { status: number; code: string; details?: Record<string, unknown> } } | { cards: Card[] } {
  const payload = item.payload;
  if (payload.kind !== 'card_batch') return { failure: { status: 400, code: 'inbox_action_invalid' } };
  if (
    request.edit !== undefined ||
    request.merge_into !== undefined ||
    request.as_new !== undefined ||
    request.relation_kind !== undefined
  ) {
    return { failure: { status: 400, code: 'inbox_action_invalid' } };
  }
  const choices = (request.cards ?? []) as { key: string; accept: boolean; content?: CardContent }[];
  const keys = new Set(payload.cards.map((c) => c.key));
  const seen = new Set<string>();
  for (const choice of choices) {
    if (!keys.has(choice.key) || seen.has(choice.key)) {
      return { failure: { status: 400, code: 'inbox_action_invalid' } };
    }
    seen.add(choice.key);
    if (
      !choice.accept &&
      (choice.content !== undefined || (choice as { sources?: unknown }).sources !== undefined)
    ) {
      return { failure: { status: 400, code: 'inbox_action_invalid' } };
    }
  }
  const effective = wirksam(core, payload.concept_id);
  if (effective?.status !== 'aktiv') {
    return {
      failure: { status: 409, code: 'card_concept_pending', details: { concept_id: payload.concept_id } },
    };
  }
  const created: Card[] = [];
  for (const proposal of payload.cards) {
    const choice = choices.find((c) => c.key === proposal.key);
    if (choice?.accept === false) continue;
    const content = choice?.content ?? proposal.content;
    const problem = contentProblem(content);
    if (problem)
      return {
        failure: { status: 400, code: 'card_invalid', details: { key: proposal.key, reason: problem } },
      };
    created.push(
      makeCard({
        concept_id: effective.id,
        origin: 'ki',
        content,
        sources: proposal.sources.map((ref) => ({ ref, missing: false })),
      }),
    );
  }
  core.cards.cards.push(...created);
  core.cards.batchCards[item.id] = created.map((c) => c.id);
  return { cards: created };
}

/** `reopen` eines angenommenen Kartenvorschlags: die Karten verschwinden, außer sie haben eine Bewertung */
export function reopenCardBatch(core: FakeCore, item: InboxItem): { status: number; code: string } | null {
  const ids = core.cards.batchCards[item.id] ?? [];
  const rated = [...core.cards.reviews.values()].some((r) => ids.includes(r.card_id));
  if (rated) return { status: 409, code: 'inbox_reopen_conflict' };
  core.cards.cards = core.cards.cards.filter((c) => !ids.includes(c.id));
  delete core.cards.batchCards[item.id];
  return null;
}

/** Karten, Wiederholung und Papierkorb für Karten */
export function handleCards(
  core: FakeCore,
  path: string,
  method: string,
  url: URL,
  body: Record<string, unknown> | null,
): Response | null {
  if (path === '/review/queue' && method === 'GET') {
    const budget = url.searchParams.get('budget_minutes');
    const extra = url.searchParams.get('extra_minutes');
    const budgetN = budget === null ? core.cards.budgetMinutes : Number(budget);
    const extraN = extra === null ? 0 : Number(extra);
    if (!(budgetN >= 1 && budgetN <= 240) || !(extraN >= 0 && extraN <= 120)) {
      return fail(400, 'validation_failed');
    }
    return json(buildQueue(core, budgetN, extraN));
  }

  const review = /^\/cards\/([^/]+)\/review$/.exec(path);
  if (review && method === 'POST') {
    if (core.cards.failReviews > 0) {
      core.cards.failReviews -= 1;
      throw new TypeError('Failed to fetch');
    }
    if (core.cards.failNextReview === 'before') {
      core.cards.failNextReview = null;
      throw new TypeError('Failed to fetch');
    }
    const id = body?.id;
    const rating = body?.rating;
    const duration = body?.duration_ms;
    if (
      typeof id !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(id) ||
      !(rating === 1 || rating === 2 || rating === 3 || rating === 4) ||
      typeof duration !== 'number' ||
      !(duration >= 0 && duration <= 3_600_000)
    ) {
      return fail(400, 'validation_failed');
    }
    const card = core.cards.cards.find((c) => c.id === review[1]);
    if (!card) return fail(404, 'card_not_found');
    const known = core.cards.reviews.get(id);
    if (known) {
      if (known.card_id !== card.id || known.rating !== rating) return fail(409, 'review_exists');
      return json({ review: known, card, requeue: card.state.state !== 'review' });
    }
    if (card.suspended) return fail(409, 'card_suspended');
    const next = nextState(card, rating);
    const entry: ReviewLogEntry = {
      id,
      card_id: card.id,
      reviewed_at: new Date().toISOString(),
      rating,
      duration_ms: Math.round(duration),
    };
    core.cards.reviews.set(id, entry);
    card.state = next.state;
    card.updated_at = entry.reviewed_at;
    if (core.cards.failNextReview === 'after') {
      core.cards.failNextReview = null;
      throw new TypeError('Failed to fetch');
    }
    return json({ review: entry, card, requeue: next.requeue });
  }

  if (path === '/cards' && method === 'POST') {
    if (core.cards.failNextCreate === 'before') {
      core.cards.failNextCreate = null;
      throw new TypeError('Failed to fetch');
    }
    const created = createManual(core, body);
    if ('failure' in created)
      return fail(created.failure.status, created.failure.code, created.failure.details);
    if (core.cards.failNextCreate === 'after') {
      core.cards.failNextCreate = null;
      throw new TypeError('Failed to fetch');
    }
    return json(created.card, 201);
  }

  const ofConcept = /^\/concepts\/([^/]+)\/cards$/.exec(path);
  if (ofConcept && method === 'GET') {
    const id = ofConcept[1] ?? '';
    if (!core.concepts.some((c) => c.concept.id === id)) return fail(404, 'concept_not_found');
    const items = core.cards.cards
      .filter((c) => c.concept_id === id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    return json({ items });
  }

  const one = /^\/cards\/([^/]+)$/.exec(path);
  if (one) {
    const card = core.cards.cards.find((c) => c.id === one[1]);
    if (!card) return fail(404, 'card_not_found');
    if (method === 'GET') return json(card);
    if (method === 'PATCH') {
      const keys = Object.keys(body ?? {}).filter((k) => ['content', 'sources', 'suspended'].includes(k));
      if (keys.length === 0) return fail(400, 'validation_failed');
      if (body?.content !== undefined) {
        const problem = contentProblem(body.content);
        if (problem) return fail(400, 'card_invalid', { reason: problem });
        card.content = body.content as CardContent;
      }
      if (typeof body?.suspended === 'boolean') card.suspended = body.suspended;
      card.updated_at = new Date().toISOString();
      return json(card);
    }
    if (method === 'DELETE') {
      core.cards.cards = core.cards.cards.filter((c) => c !== card);
      core.cards.trashed.push(card);
      return new Response(null, { status: 204 });
    }
  }

  const restore = /^\/trash\/([^/]+)\/restore$/.exec(path);
  if (restore && method === 'POST') {
    const card = core.cards.trashed.find((c) => c.id === restore[1]);
    if (card) {
      core.cards.trashed = core.cards.trashed.filter((c) => c !== card);
      core.cards.cards.push(card);
      return json({ id: card.id, kind: 'card', restored_count: 3 });
    }
  }
  return null;
}
