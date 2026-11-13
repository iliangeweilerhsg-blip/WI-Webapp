// Auswahl und Reihenfolge der Tageswarteschlange (VERTRAEGE §21.5), rein und deterministisch. Die Datenbank liefert
// nur die Kandidaten und die Zahlen (`services/review.ts`). Testfälle: `packages/schemas/fixtures/cards/queue.json`.
import type { CardKind, FsrsState, ReviewQueueGroup } from '@sg/shared';
import { learnDay, overdueDays } from './day.ts';
import {
  EXAM_RELEVANT_FACTOR,
  NEW_CARD_COST_FACTOR,
  OVERDUE_CAP_DAYS,
  OVERDUE_WEIGHT,
  PRIORITY_DECIMALS,
  QUEUE_MAX_ITEMS,
} from './params.ts';

/** Eine Karte, die für heute in Frage kommt (oder nicht: die Funktion filtert selbst) */
export interface QueueCandidate {
  id: string;
  /** Konzept-ID, für die Mischung */
  concept: string;
  kind: CardKind;
  state: FsrsState;
  due: Date;
  /** Abrufwahrscheinlichkeit jetzt, bei neuen Karten `null` (zählt als 0) */
  r: number | null;
  exam_relevant: boolean;
  suspended: boolean;
}

export interface QueueInput {
  now: Date;
  tz: string;
  /** Geschätzte Sekunden je Kartentyp */
  estimates: Record<CardKind, number>;
  /** Budget minus heute verbrauchte Zeit, mindestens 0 */
  remainingSeconds: number;
  /** `new_cards_per_day` minus heute begonnene neue Karten, mindestens 0 */
  newCardsLeft: number;
  cards: readonly QueueCandidate[];
  /** Höchstzahl der Karten (Standard {@link QUEUE_MAX_ITEMS}) */
  maxItems?: number;
}

export interface QueuePick {
  id: string;
  group: ReviewQueueGroup;
  estimate_seconds: number;
}

export interface QueueSelection {
  /** In Anzeige-Reihenfolge */
  items: QueuePick[];
  estimatedSeconds: number;
  moreDue: boolean;
}

interface Ranked {
  card: QueueCandidate;
  group: ReviewQueueGroup;
  cost: number;
  estimate: number;
  priority: number;
}

const round6 = (value: number): number => {
  const factor = 10 ** PRIORITY_DECIMALS;
  return Math.round(value * factor) / factor;
};

/** Kleinere ID zuerst (UUIDv7, also die ältere Karte). Reiner Zeichenvergleich, ohne Gebietsschema */
const byId = (a: QueueCandidate, b: QueueCandidate): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function byDue(a: Ranked, b: Ranked): number {
  return a.card.due.getTime() - b.card.due.getTime() || byId(a.card, b.card);
}

/** Priorität absteigend, dann frühere `due`, dann kleinere ID */
function byPriority(a: Ranked, b: Ranked): number {
  return b.priority - a.priority || byDue(a, b);
}

/**
 * Mischung (06 §3.2): Von vorn nach hinten wird jeweils die erste noch nicht gesetzte Karte genommen, deren Konzept ein
 * anderes ist als das der zuletzt gesetzten. Gibt es keine, die nächste.
 */
function interleave(list: readonly Ranked[]): Ranked[] {
  const rest = [...list];
  const result: Ranked[] = [];
  while (rest.length > 0) {
    const last = result.at(-1)?.card.concept;
    const index = rest.findIndex((entry) => entry.card.concept !== last);
    result.push(...rest.splice(index === -1 ? 0 : index, 1));
  }
  return result;
}

/**
 * Wählt den heutigen Block (§21.5, „Auswahl in dieser Reihenfolge“, Schritte 1 bis 7) und ordnet ihn für die Anzeige:
 * zuerst die Wiederholungen (angefangen nach `due`, dann fällig nach Priorität), danach die neuen Karten, die Mischung
 * gilt je Gruppe.
 */
export function selectQueue(input: QueueInput): QueueSelection {
  const { now, tz, estimates } = input;
  const maxItems = input.maxItems ?? QUEUE_MAX_ITEMS;
  const dayEnd = learnDay(now, tz).endsAt.getTime();

  const rank = (card: QueueCandidate, group: ReviewQueueGroup): Ranked => {
    const estimate = estimates[card.kind];
    const overdue = group === 'faellig' ? overdueDays(now, card.due, tz) : 0;
    const retrievability = group === 'neu' ? 0 : (card.r ?? 0);
    const priority = round6(
      (1 - retrievability) *
        (1 + OVERDUE_WEIGHT * Math.min(overdue, OVERDUE_CAP_DAYS)) *
        (card.exam_relevant ? EXAM_RELEVANT_FACTOR : 1),
    );
    return {
      card,
      group,
      estimate,
      cost: group === 'neu' ? NEW_CARD_COST_FACTOR * estimate : estimate,
      priority,
    };
  };

  // Kandidaten: nicht pausiert, heute fällig (gelöschte Karten und Konzepte filtert die Datenbank)
  const candidates = input.cards.filter((card) => !card.suspended && card.due.getTime() < dayEnd);
  const started = candidates
    .filter((card) => card.state === 'learning' || card.state === 'relearning')
    .map((card) => rank(card, 'angefangen'))
    .sort(byDue);
  const due = candidates
    .filter((card) => card.state === 'review')
    .map((card) => rank(card, 'faellig'))
    .sort(byPriority);
  const fresh = candidates
    .filter((card) => card.state === 'new')
    .map((card) => rank(card, 'neu'))
    .sort(byPriority)
    .slice(0, Math.max(0, input.newCardsLeft));

  const chosen = new Set<Ranked>();
  const sum = (entries: Iterable<Ranked>): number => {
    let total = 0;
    for (const entry of entries) total += entry.cost;
    return total;
  };
  const room = (): number => maxItems - chosen.size;

  // 1. Alle angefangenen, vor jeder Kappung (nur die Höchstzahl der Karten gilt)
  for (const entry of started) if (room() > 0) chosen.add(entry);
  const rest = Math.max(0, input.remainingSeconds - sum(chosen));

  // 2. Rest 0 schon zu Beginn: es kommt nichts dazu
  if (input.remainingSeconds > 0) {
    // 3. Reserve für neue Karten, solange Wiederholungen warten
    const reserve = Math.min(rest / 2, sum(fresh));
    let spent = 0;
    // 4. Fällige, solange die Summe in Rest minus Reserve passt (die erste, die nicht passt, beendet den Schritt)
    let nextDue = 0;
    for (; nextDue < due.length && room() > 0; nextDue += 1) {
      const entry = due[nextDue]!;
      if (spent + entry.cost > rest - reserve) break;
      spent += entry.cost;
      chosen.add(entry);
    }
    // 5. Neue, solange die Summe in den Rest passt
    for (const entry of fresh) {
      if (room() <= 0 || spent + entry.cost > rest) break;
      spent += entry.cost;
      chosen.add(entry);
    }
    // 6. Weitere fällige ab der Stelle aus Schritt 4
    for (; nextDue < due.length && room() > 0; nextDue += 1) {
      const entry = due[nextDue]!;
      if (spent + entry.cost > rest) break;
      spent += entry.cost;
      chosen.add(entry);
    }
    // 7. Bei knappem Rest nie ein leerer Block
    if (chosen.size === 0) {
      const first = due[0] ?? fresh[0];
      if (first) chosen.add(first);
    }
  }

  const moreDue = [...started, ...due, ...fresh].some((entry) => !chosen.has(entry));

  // Anzeige-Reihenfolge: Wiederholungen (angefangen, dann fällig), danach neue Karten. Mischung je Gruppe
  const reviews = interleave([...started, ...due].filter((entry) => chosen.has(entry)));
  const news = interleave(fresh.filter((entry) => chosen.has(entry)));
  const items: QueuePick[] = [...reviews, ...news].map((entry) => ({
    id: entry.card.id,
    group: entry.group,
    estimate_seconds: entry.cost,
  }));
  return {
    items,
    estimatedSeconds: items.reduce((total, item) => total + item.estimate_seconds, 0),
    moreDue,
  };
}
