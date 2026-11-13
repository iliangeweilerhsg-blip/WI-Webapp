// Konstanten für Karten, FSRS und Tageswarteschlange (VERTRAEGE §21.5). Alle Zahlen stehen hier und sind über
// Tests abgesichert (`test/unit/learning-params.test.ts`), damit eine Änderung nie unbemerkt bleibt.
import { fsrs, generatorParameters, type FSRS } from 'ts-fsrs';

// --- FSRS (06 §1) ------------------------------------------------------------------------------

/** Zielbehaltensquote, fest. Die Einstellung dazu kommt mit Phase 3 */
export const REQUEST_RETENTION = 0.9;
/** Längstes Intervall in Tagen (Standard der Bibliothek wäre 36 500) */
export const MAXIMUM_INTERVAL_DAYS = 365;
/** Zufallsstreuung an. Sie ist deterministisch: gleiche Karte, gleicher Zeitpunkt, gleiche Bewertung, gleiche `due` */
export const ENABLE_FUZZ = true;

/**
 * Der FSRS-Planer des Core. Startparameter und Lernschritte sind die Standards von `ts-fsrs` 5
 * (`enable_short_term = true`, `learning_steps` `['1m', '10m']`, `relearning_steps` `['10m']`, §21.5).
 * Tests mit festen Erwartungswerten übergeben `enableFuzz: false`.
 */
export function createScheduler(options: { enableFuzz?: boolean } = {}): FSRS {
  return fsrs(
    generatorParameters({
      request_retention: REQUEST_RETENTION,
      maximum_interval: MAXIMUM_INTERVAL_DAYS,
      enable_fuzz: options.enableFuzz ?? ENABLE_FUZZ,
    }),
  );
}

// --- Lerntag (§21.5) ---------------------------------------------------------------------------

/** Der Lerntag wechselt um 04:00 Ortszeit des Macs */
export const LEARN_DAY_START_HOUR = 4;

// --- Einstellungen und Zeitbudget (§21.5, §21.9) -------------------------------------------------

export const DEFAULT_REVIEW_BUDGET_MINUTES = 20;
export const DEFAULT_NEW_CARDS_PER_DAY = 20;
/** `budget_minutes` einer Anfrage */
export const BUDGET_MINUTES_RANGE = { min: 1, max: 240 } as const;
/** `extra_minutes` einer Anfrage („Weitere 10 min“) */
export const EXTRA_MINUTES_RANGE = { min: 0, max: 120 } as const;

/** Je Bewertung zählen höchstens so viele Millisekunden (fängt Pausen ab) */
export const REVIEW_TIME_CAP_MS = 120_000;
/** Schätzung je Kartentyp: Median der letzten so vielen Bewertungen … */
export const ESTIMATE_SAMPLE_SIZE = 200;
/** … erst ab so vielen Bewertungen, sonst gelten die Startwerte */
export const ESTIMATE_MIN_SAMPLES = 20;
/** Grenzen der Schätzung in Sekunden */
export const ESTIMATE_BOUNDS_SECONDS = { min: 5, max: 60 } as const;
/** Startwerte in Sekunden (06 §3.1) */
export const ESTIMATE_DEFAULT_SECONDS = { basic: 12, cloze: 20 } as const;

// --- Auswahl und Reihenfolge (§21.5) ---------------------------------------------------------------

/** Eine neue Karte kostet am ersten Tag etwa das Dreifache einer Wiederholung */
export const NEW_CARD_COST_FACTOR = 3;
/** Faktor der Priorität bei `concept.exam_relevant` */
export const EXAM_RELEVANT_FACTOR = 1.5;
/** Zuschlag der Priorität je Tag Überfälligkeit … */
export const OVERDUE_WEIGHT = 0.1;
/** … bis zu so vielen Tagen */
export const OVERDUE_CAP_DAYS = 10;
/** Nachkommastellen, auf die die Priorität vor dem Vergleich gerundet wird */
export const PRIORITY_DECIMALS = 6;
/** Höchstzahl der Karten im Block */
export const QUEUE_MAX_ITEMS = 500;
