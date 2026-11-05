// Zuordnung von Terminen zu Modulen und Terminart (VERTRAEGE §8 „Zuordnung“, F-KAL-02). Reine Funktionen.
import type { CalendarEventKind } from '@sg/shared';

export interface ModuleCandidate {
  id: string;
  name: string;
  shortName: string | null;
  lecturer: string | null;
}

export interface EventText {
  title: string;
  location: string | null;
  description: string | null;
}

// ---------------------------------------------------------------------------------------------
// Normalisieren
// ---------------------------------------------------------------------------------------------

/** Kleinschreibung, Umlaute als ae/oe/ue/ss, Akzente weg. „Ökonometrie“ und „Oekonometrie“ sind gleich. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '');
}

/** Wörter (Buchstaben und Ziffern) in normalisierter Schreibweise */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== '');
}

/** Kommt `needle` als zusammenhängende Wortfolge in `haystack` vor? */
function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((word, offset) => haystack[i + offset] === word)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Art des Termins
// ---------------------------------------------------------------------------------------------

/**
 * Schlüsselwörter je Art, jeweils die ganzen Wörter (normalisiert). Wortanfänge zählen bewusst nicht:
 * „Vorlesungsfrei“ ist keine Vorlesung.
 */
const KIND_WORDS: { kind: CalendarEventKind; words: string[] }[] = [
  { kind: 'pruefung', words: ['pruefung', 'pruefungen', 'klausur', 'klausuren', 'exam', 'exams'] },
  { kind: 'tutorium', words: ['tutorium', 'tutorien', 'tutorial', 'tut'] },
  { kind: 'uebung', words: ['uebung', 'uebungen', 'ue', 'exercise', 'exercises'] },
  { kind: 'vorlesung', words: ['vorlesung', 'vorlesungen', 'vl', 'lecture', 'lectures'] },
];

function kindIn(tokens: readonly string[]): CalendarEventKind | null {
  for (const { kind, words } of KIND_WORDS) {
    if (tokens.some((token) => words.includes(token))) return kind;
  }
  return null;
}

/**
 * Art aus Schlüsselwörtern (Prüfung/Klausur/Exam, Tutorium/Tut, Übung/UE/Ü, Vorlesung/VL/Lecture).
 * Der Titel entscheidet, die Beschreibung nur, wenn der Titel nichts hergibt.
 * Ohne Treffer: ganztägig ohne Modul `fest`, sonst `vorlesung`.
 */
export function detectKind(event: EventText, allDay: boolean, hasModule: boolean): CalendarEventKind {
  const found = kindIn(tokenize(event.title)) ?? kindIn(tokenize(event.description));
  if (found) return found;
  return allDay && !hasModule ? 'fest' : 'vorlesung';
}

// ---------------------------------------------------------------------------------------------
// Modul
// ---------------------------------------------------------------------------------------------

/** Akademische Titel, die beim Dozenten nicht zählen */
const LECTURER_NOISE = new Set([
  'prof',
  'dr',
  'med',
  'phd',
  'dipl',
  'ing',
  'mag',
  'lic',
  'iur',
  'rer',
  'nat',
  'pd',
  'em',
]);

interface Needles {
  /** Name und Kürzel als exakte Wortfolge */
  strong: string[][];
  /** Kürzel (≥ 4 Zeichen, ein Wort) als Wortanfang: „Mikro“ in „MikroÖk“ */
  weak: string[];
  /** Dozent: ganzer Name und Nachname */
  lecturer: string[][];
}

function needlesOf(candidate: ModuleCandidate): Needles {
  const strong: string[][] = [];
  const name = tokenize(candidate.name);
  if (name.length > 0) strong.push(name);
  const weak: string[] = [];
  const short = tokenize(candidate.shortName);
  if (short.length > 0) {
    strong.push(short);
    if (short.length === 1 && (short[0]?.length ?? 0) >= 4) weak.push(short[0] as string);
  }
  const lecturer: string[][] = [];
  const words = tokenize(candidate.lecturer).filter((word) => !LECTURER_NOISE.has(word));
  if (words.length >= 2) lecturer.push(words);
  const surname = words.at(-1);
  if (surname && surname.length >= 4) lecturer.push([surname]);
  return { strong, weak, lecturer };
}

/** Der längste Suchtext, der in `haystack` vorkommt (als Wortfolge), oder `null` */
function longestHit(
  haystacks: readonly (readonly string[])[],
  needles: readonly (readonly string[])[],
): string[] | null {
  let best: string[] | null = null;
  for (const needle of needles) {
    if (
      haystacks.some((haystack) => containsSequence(haystack, needle)) &&
      (!best || needle.length > best.length)
    ) {
      best = [...needle];
    }
  }
  return best;
}

interface Hit {
  id: string;
  /** Der Treffer als Wortfolge, bei Wortanfängen das Kürzel */
  words: string[];
}

/**
 * Aus mehreren Treffern bleibt nur der genauere: „Statistik“ steckt in „Statistik II“. Ein Modul, dessen Treffer
 * ein Teil des Treffers eines anderen Moduls ist, fällt weg. Übrig muss genau eines sein.
 */
function resolve(hits: Hit[]): string | null | undefined {
  if (hits.length === 0) return undefined;
  const specific = hits.filter(
    (hit) =>
      !hits.some(
        (other) =>
          other.id !== hit.id &&
          other.words.length > hit.words.length &&
          containsSequence(other.words, hit.words),
      ),
  );
  const ids = new Set(specific.map((hit) => hit.id));
  return ids.size === 1 ? ([...ids][0] as string) : null;
}

/**
 * Modul über Name, Kürzel und Dozent in Titel, Ort oder Beschreibung. Es zählt nur ein eindeutiger Treffer.
 * Die Stufen laufen von sicher nach unsicher; die erste Stufe mit Treffern entscheidet:
 * 1. Name/Kürzel als Wortfolge im Titel
 * 2. Kürzel als Wortanfang im Titel
 * 3. Name/Kürzel im Ort oder in der Beschreibung
 * 4. Dozent in Titel, Ort oder Beschreibung
 * Gibt es in der entscheidenden Stufe mehrere Module (die nicht Teil voneinander sind), bleibt das Modul leer und die
 * Serie erscheint als Vorschlag.
 */
export function matchModule(event: EventText, candidates: readonly ModuleCandidate[]): string | null {
  const title = tokenize(event.title);
  const rest = [...tokenize(event.location), ...tokenize(event.description)];
  const all = [...title, ...rest];
  const prepared = candidates.map((candidate) => ({ id: candidate.id, needles: needlesOf(candidate) }));

  const stages: ((needles: Needles) => string[] | null)[] = [
    (n) => longestHit([title], n.strong),
    (n) => {
      const word = n.weak.find((w) => title.some((token) => token.startsWith(w)));
      return word ? [word] : null;
    },
    (n) => longestHit([rest], n.strong),
    (n) => longestHit([all], n.lecturer),
  ];
  for (const stage of stages) {
    const hits: Hit[] = [];
    for (const p of prepared) {
      const words = stage(p.needles);
      if (words) hits.push({ id: p.id, words });
    }
    const result = resolve(hits);
    if (result !== undefined) return result;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Modulvorschlag
// ---------------------------------------------------------------------------------------------

/** Wortgrenzen für Unicode (`\b` kennt nur ASCII) */
const WB_START = '(?<![\\p{L}\\p{N}])';
const WB_END = '(?![\\p{L}\\p{N}])';
const KIND_WORD_RE = new RegExp(
  `${WB_START}(vorlesung(en)?|vl|übung(en)?|uebung(en)?|ü|ue|tutorium|tutorien|tut|prüfung|pruefung|klausur|exam|lecture)${WB_END}`,
  'giu',
);
const GROUP_RE = new RegExp(`${WB_START}(gr\\.?|gruppe|group)\\s*\\p{N}{1,3}${WB_END}`, 'giu');

/** Vorgeschlagener Modulname aus dem Titel: ohne Terminart, Gruppenangabe und Zusätze in Klammern */
export function suggestModuleName(title: string): string {
  const original = title.trim();
  let name = original.replace(/\([^)]*\)/g, ' ');
  // Bei „Name – Zusatz“ oder „Name: Zusatz“ zählt der erste Teil, der mehr als nur eine Terminart ist
  const parts = name
    .split(/\s[–—-]\s|:/u)
    .map((part) => part.replace(KIND_WORD_RE, ' ').replace(GROUP_RE, ' '))
    .map((part) => part.replace(/[\s,;.–—-]+/gu, ' ').trim())
    .filter((part) => part !== '');
  name = parts[0] ?? '';
  if (name === '') name = original;
  return name.length > 120 ? name.slice(0, 120).trim() : name;
}

/** Schlüssel zum Zusammenfassen gleicher Vorschläge */
export function suggestionKey(name: string): string {
  return tokenize(name).join(' ');
}

/** Kommen alle Zeichen von `short` in dieser Reihenfolge in `long` vor? */
function isSubsequence(short: string, long: string): boolean {
  let at = 0;
  for (const char of long) if (char === short[at]) at += 1;
  return at === short.length;
}

/**
 * Ist `short` eine Abkürzung von `long`? Beispiele: „Stat I“ / „Statistik I“, „WI“ / „Wirtschaftsinformatik“,
 * „OR“ / „Operations Research“, „DBS“ / „Datenbanksysteme“, „MikroÖk I“ / „Mikroökonomie I“.
 * - gleiche Wortzahl, das erste Wort ein Wortanfang, alle weiteren Wörter gleich („Stat I“ ist nicht „Statistik II“)
 * - ein Wort, das die Anfangsbuchstaben der Wörter von `long` ist
 * - ein Wort (3 bis 5 Zeichen), dessen Buchstaben in einem einzigen längeren Wort in dieser Reihenfolge vorkommen
 */
export function isAbbreviation(short: string, long: string): boolean {
  const s = tokenize(short);
  const l = tokenize(long);
  if (s.length === 0 || l.length === 0 || s.join(' ') === l.join(' ')) return false;
  if (s.length === l.length) {
    const first = s[0] as string;
    const firstLong = l[0] as string;
    const restEqual = s.slice(1).every((word, i) => word === l[i + 1]);
    if (restEqual && first.length >= 2 && firstLong.startsWith(first)) return true;
  }
  if (s.length === 1) {
    const word = s[0] as string;
    if (l.length >= 2 && word.length >= 2 && word === l.map((w) => w[0]).join('')) return true;
    if (l.length === 1) {
      const full = l[0] as string;
      if (
        word.length >= 3 &&
        word.length <= 5 &&
        full.length > word.length &&
        full[0] === word[0] &&
        isSubsequence(word, full)
      ) {
        return true;
      }
    }
  }
  return false;
}
