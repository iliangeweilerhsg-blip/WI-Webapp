// Karteninhalt säubern und prüfen (VERTRAEGE §21.2). Gemeinsame Testfälle mit dem Worker (B1):
// `packages/schemas/fixtures/cards/content.json`. Dieselben Regeln gelten für `POST /cards`, `PATCH /cards/{id}` und
// das Annehmen eines Kartenvorschlags (B3). Die Funktionen sind rein und werfen nichts: B3 hängt `details.key` selbst an.
import type { CardContent } from '@sg/shared';
import { HttpError } from '../errors.ts';
import { nameKey } from '../services/concept-graph.ts';

/** Erster Verstoß beim Prüfen (`details.reason` von `400 card_invalid`) */
export type CardInvalidReason =
  'empty' | 'cloze_syntax' | 'cloze_none' | 'cloze_numbers' | 'cloze_answers' | 'too_long';

/**
 * Zeichengrenzen des Schemas (§21.2), nach dem Säubern noch einmal geprüft wie im Worker (B1, `too_long`): NFC kann einen
 * Text verlängern (etwa U+0958 → zwei Zeichen), und eine zu lange Karte ließe sich nicht mehr ausliefern. Gezählt wird wie
 * im Schema der Antwort (`zod`, UTF-16-Einheiten).
 */
const MAX_LENGTH = { front: 500, back: 1000, explanation: 1000, solution: 200 } as const;

/** Ergebnis von {@link checkCardContent} */
export type CardContentCheck =
  | {
      ok: true;
      /** Gespeicherte Fassung (gesäubert, Lücken am Rand getrimmt) */
      content: CardContent;
      /** Wörter der Vorderseite (cloze: mit eingesetzten Lücken), für die Längenregeln aus §21.6 */
      frontWords: number;
      /** Wörter der Antwort (cloze: die längste Lücke) */
      answerWords: number;
      /** Anzeige der Vorderseite (cloze: Lücken als `[…]`) */
      plain: string;
    }
  | { ok: false; reason: CardInvalidReason };

/**
 * Säubern (§21.2): Zeilenenden zu `\n`, Tab zu Leerzeichen, Steuerzeichen (`Cc` außer `\n`) und Formatzeichen (`Cf`)
 * entfernen, dann NFC, trimmen. NFC kommt nach dem Entfernen (wie im Worker): Ein entferntes Formatzeichen zwischen Buchstabe und
 * Akzent (`e` + ZWJ + U+0301) ergäbe sonst einen Text, der nicht in NFC ist.
 */
export function sanitizeCardText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, (char) => (char === '\n' ? char : ''))
    .normalize('NFC')
    .trim();
}

/** Wörter: Folgen von Zeichen ohne Leerraum */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/u).length;
}

interface Gap {
  n: number;
  text: string;
}

// Bis zum ersten `}}` wie im Worker: Eine Lücke mit `{` oder `}` im Text ist `cloze_syntax`, nicht `cloze_none`
const GAP_RE = /\{\{c(\d+)::([\s\S]*?)\}\}/gu;

/** Lücken `{{cN::Text}}` des Textes in der Reihenfolge ihres Auftretens (Text noch nicht getrimmt) */
function findGaps(text: string): Gap[] {
  return [...text.matchAll(GAP_RE)].map((m) => ({ n: Number(m[1]), text: m[2]! }));
}

/** Text mit getrimmten Lücken: `{{c1:: Tupel }}` wird zu `{{c1::Tupel}}` */
function trimGaps(text: string): string {
  return text.replace(GAP_RE, (_all, n: string, inner: string) => `{{c${n}::${inner.trim()}}}`);
}

/** Text mit anderen Ersetzungen für jede Lücke */
function replaceGaps(text: string, replacement: (gap: Gap) => string): string {
  return text.replace(GAP_RE, (_all, n: string, inner: string) =>
    replacement({ n: Number(n), text: inner.trim() }),
  );
}

/**
 * Prüft den Inhalt einer Karte und liefert die gespeicherte Fassung (§21.2). Erster Verstoß als `reason`, in der
 * Reihenfolge: `empty` (nach dem Säubern leer), `cloze_syntax` (Lücke mit `::`, Klammern oder leerem Text), `cloze_none`,
 * `cloze_syntax` (offene oder lose Klammern außerhalb gültiger Lücken), `cloze_numbers`, `cloze_answers`, zuletzt
 * `too_long` (Zeichengrenzen des Schemas nach dem Säubern, wie im Worker).
 */
export function checkCardContent(input: CardContent): CardContentCheck {
  const frontText = sanitizeCardText(input.front.text_md);
  if (frontText === '') return { ok: false, reason: 'empty' };

  if (input.kind === 'basic') {
    const answer = sanitizeCardText(input.back.text_md);
    const explanation =
      input.back.explanation_md === null ? null : sanitizeCardText(input.back.explanation_md);
    if (answer === '' || explanation === '') return { ok: false, reason: 'empty' };
    if (
      frontText.length > MAX_LENGTH.front ||
      answer.length > MAX_LENGTH.back ||
      (explanation !== null && explanation.length > MAX_LENGTH.explanation)
    ) {
      return { ok: false, reason: 'too_long' };
    }
    return {
      ok: true,
      content: {
        kind: 'basic',
        front: { text_md: frontText },
        back: { text_md: answer, explanation_md: explanation },
      },
      frontWords: countWords(frontText),
      answerWords: countWords(answer),
      plain: frontText,
    };
  }

  // cloze: Lösungen säubern
  const answers: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(input.back.answers) as [string, string[] | undefined][]) {
    if (list === undefined) continue;
    const cleaned: string[] = list.map(sanitizeCardText);
    if (cleaned.some((answer) => answer === '')) return { ok: false, reason: 'empty' };
    answers[key] = cleaned;
  }

  const gaps = findGaps(frontText);
  // 1. Syntax einer Lücke: kein Hinweis (`::`), keine Klammern, Text nicht leer
  if (gaps.some((gap) => /::|[{}]/u.test(gap.text) || gap.text.trim() === '')) {
    return { ok: false, reason: 'cloze_syntax' };
  }
  // 2. keine Lücke
  if (gaps.length === 0) return { ok: false, reason: 'cloze_none' };
  // 3. außerhalb gültiger Lücken weder `{{` noch `}}`
  const outside = frontText.replace(GAP_RE, '');
  if (outside.includes('{{') || outside.includes('}}')) return { ok: false, reason: 'cloze_syntax' };
  // 4. Nummern: 1 bis 3, lückenlos ab 1, jede genau einmal
  const numbers = gaps.map((gap) => gap.n);
  if (
    numbers.length > 3 ||
    !numbers
      .slice()
      .sort((a, b) => a - b)
      .every((n, index) => n === index + 1)
  ) {
    return { ok: false, reason: 'cloze_numbers' };
  }
  // 5. Lösungen: genau die Schlüssel der Lücken, erste Lösung = Text der Lücke, 1 bis 5 Einträge
  const expectedKeys = numbers.map((n) => `c${n}`).sort();
  const actualKeys = Object.keys(answers).sort();
  if (expectedKeys.length !== actualKeys.length || expectedKeys.some((key, i) => key !== actualKeys[i])) {
    return { ok: false, reason: 'cloze_answers' };
  }
  for (const gap of gaps) {
    const list = answers[`c${gap.n}`]!;
    if (list.length < 1 || list.length > 5 || list[0] !== gap.text.trim()) {
      return { ok: false, reason: 'cloze_answers' };
    }
  }

  const front = trimGaps(frontText);
  if (
    front.length > MAX_LENGTH.front ||
    Object.values(answers).some((list) => list.some((answer) => answer.length > MAX_LENGTH.solution))
  ) {
    return { ok: false, reason: 'too_long' };
  }
  const longestGap = Math.max(...gaps.map((gap) => countWords(gap.text)));
  return {
    ok: true,
    content: {
      kind: 'cloze',
      front: { text_md: front },
      back: { answers: answers as unknown as typeof input.back.answers },
    },
    frontWords: countWords(replaceGaps(front, (gap) => gap.text)),
    answerWords: longestGap,
    plain: replaceGaps(front, () => '[…]'),
  };
}

const INVALID_MESSAGE: Record<CardInvalidReason, string> = {
  empty: 'Die Karte hat einen leeren Text.',
  cloze_syntax:
    'Eine Lücke ist falsch geschrieben. Erlaubt ist {{c1::Text}} ohne Hinweis und ohne Klammern im Text.',
  cloze_none: 'Der Lückentext enthält keine Lücke.',
  cloze_numbers:
    'Die Lücken müssen bei c1 beginnen, lückenlos sein und je Nummer einmal vorkommen (höchstens c3).',
  cloze_answers: 'Die Lösungen passen nicht zu den Lücken.',
  too_long: 'Ein Text der Karte ist nach dem Säubern zu lang.',
};

/** `400 card_invalid` mit `details.reason` (und bei Bedarf weiteren Angaben wie `key` in der Inbox) */
export function cardInvalid(reason: CardInvalidReason, extra: Record<string, unknown> = {}): HttpError {
  return new HttpError(400, 'card_invalid', INVALID_MESSAGE[reason], { reason, ...extra });
}

/**
 * Säubert und prüft den Inhalt, sonst `400 card_invalid`. Für `POST /cards`, `PATCH /cards/{id}` und das Annehmen
 * (B3 fängt den Fehler und ergänzt `details.key`).
 */
export function normalizeCardContent(input: CardContent): CardContent {
  const checked = checkCardContent(input);
  if (!checked.ok) throw cardInvalid(checked.reason);
  return checked.content;
}

/**
 * Vergleichsform `key` der Vorderseite für die Dublettenprüfung beim Annehmen (§21.7, §20.3): bei `cloze` mit `[…]`
 * statt der Lücken, dann wie `nameKey` (Normform in Kleinbuchstaben).
 */
export function cardFrontKey(content: CardContent): string {
  const checked = checkCardContent(content);
  return nameKey(checked.ok ? checked.plain : content.front.text_md);
}
