// Automatische Kurszuordnung (#141), reine Regeln: Modulname aus dem Kursnamen und eindeutiger Treffer.
// Keine Datenbank, kein Netz, keine KI. Regexe und Umlaute im Code nur als ASCII-Escapes.
import {
  isAbbreviation,
  KIND_WORD_RE,
  matchModule,
  suggestionKey,
  tokenize,
  type ModuleCandidate,
} from '../services/calendar-assign.ts';
import type { CourseInfo } from './classify.ts';

/** Längster Modulname, der automatisch entsteht (wie beim Vorschlag aus dem Kalender), in Zeichen (Codepoints) */
export const MAX_AUTO_NAME_LENGTH = 120;
/** Jahrespaare gelten nur in diesem Bereich als Semester („Kapitel 12/13“ bleibt) */
export const SEMESTER_YEAR_MIN = 2015;
export const SEMESTER_YEAR_MAX = 2040;

/** Wortgrenzen für Unicode (`\b` kennt nur ASCII) */
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const YEAR = '(?:[0-9]{4}|[0-9]{2})';
const YEARS = `${YEAR}(?:\\s*/\\s*${YEAR})*`;

/**
 * Semesterzusatz: WiSe/SoSe (auch ausgeschrieben) mit oder ohne Jahr, WS/SS und Winter/Sommer nur mit Jahr
 * („WS 26/27“, „SS27“, „Winter 2026/27“). Groß- und Kleinschreibung zählt: „wise“ oder „ss“ mitten im Namen bleiben.
 */
const TERM_RE = new RegExp(
  `${B}(?:(?:WiSe|WISE|SoSe|SOSE|Wintersemester|Sommersemester)(?:[\\s.\\-]*${YEARS})?|(?:WS|SS|Winter|Sommer)[\\s.\\-]*${YEARS})${E}`,
  'gu',
);
/** Jahresfolge allein: `JJ/JJ`, `JJJJ/JJ`, `JJJJ/JJJJ`, auch länger („2026/2027/2028“) */
const YEAR_CHAIN_RE = new RegExp(`${B}${YEAR}(?:\\s*/\\s*${YEAR})+${E}`, 'gu');
/** Führender Kurs-Code: Großbuchstaben mit Ziffern („BMBWL110“), danach Leerzeichen, Doppelpunkt oder Strich */
const LEADING_CODE_RE = /^[A-Z]{2,}[0-9]+[A-Z0-9]*[\s:\u2013\u2014-]+(?=\S)/u;
const SEPARATORS = '[\\s,;:/|.\u2013\u2014-]';
/** Trennzeichen direkt hinter einer öffnenden bzw. vor einer schließenden Klammer: „( , Gruppe 1)“ */
const BRACKET_OPEN_RE = new RegExp(`([([])${SEPARATORS}+`, 'gu');
const BRACKET_CLOSE_RE = new RegExp(`${SEPARATORS}+([)\\]])`, 'gu');
/** Klammern, die nach dem Entfernen leer sind */
const EMPTY_BRACKETS_RE = /[([]\s*[)\]]/gu;
/** Trennzeichen am Anfang bzw. Ende */
const EDGE_SEPARATORS_RE = new RegExp(`^${SEPARATORS}+|${SEPARATORS}+$`, 'gu');
const UMLAUT_RE = /[\u00c4\u00d6\u00dc\u00e4\u00f6\u00fc\u00df]/u;
const UMLAUT_LOWER_RE = /[\u00e4\u00f6\u00fc]/gu;

/** Jahr als vierstellige Zahl: „26“ → 2026 */
const fullYear = (text: string) => (text.length === 2 ? 2000 + Number(text) : Number(text));

/**
 * Ist „26/27“, „2026/27“, „2026/2027/2028“ eine Folge von Semesterjahren? Jedes Jahr folgt auf das vorige, alle
 * liegen zwischen 2015 und 2040. Auf eine zweistellige Angabe folgt keine vierstellige („26/2027“ bleibt).
 */
function isYearChain(chain: string): boolean {
  const parts = chain.split('/').map((part) => part.trim());
  const years = parts.map(fullYear);
  if (years.some((year) => year < SEMESTER_YEAR_MIN || year > SEMESTER_YEAR_MAX)) return false;
  for (let i = 1; i < parts.length; i += 1) {
    if ((parts[i - 1] ?? '').length === 2 && (parts[i] ?? '').length === 4) return false;
    if (years[i] !== (years[i - 1] ?? 0) + 1) return false;
  }
  return true;
}

function stripSemester(text: string): string {
  return text
    .replace(TERM_RE, ' ')
    .replace(YEAR_CHAIN_RE, (chain: string) => (isYearChain(chain) ? ' ' : chain));
}

/** Klammerreste aufräumen: „( , Gruppe 1)“ → „(Gruppe 1)“, „( )“ → nichts */
function tidyBrackets(text: string): string {
  return text.replace(BRACKET_OPEN_RE, '$1').replace(BRACKET_CLOSE_RE, '$1').replace(EMPTY_BRACKETS_RE, ' ');
}

/**
 * Häufige Wortstämme mit Umlaut (#141). Nur diese werden aus ae/oe/ue zurückverwandelt, und nur in Wörtern ohne
 * Umlaut. Lieber konservativ: „Steuer“, „aktuell“ oder „Quelle“ bleiben, wie sie sind.
 */
export const UMLAUT_STEMS: readonly string[] = [
  'einf\u00fchrung',
  'f\u00fchrung',
  '\u00fcbung',
  'pr\u00fcfung',
  '\u00f6konom',
  'gesch\u00e4ft',
  'k\u00fcnstlich',
  '\u00f6ffentlich',
  'gr\u00fcndung',
  '\u00fcberblick',
  '\u00fcbersicht',
];
const DIGRAPH: Readonly<Record<string, string>> = { '\u00e4': 'ae', '\u00f6': 'oe', '\u00fc': 'ue' };
const asciiStem = (stem: string) => stem.replace(UMLAUT_LOWER_RE, (char) => DIGRAPH[char] ?? char);

/** „Einfuehrung“ → „Einführung“, „UEBUNG“ → „ÜBUNG“. Die Schreibweise des ersten Buchstabens bleibt */
export function restoreUmlauts(word: string): string {
  if (UMLAUT_RE.test(word)) return word;
  // Nur, wenn Kleinschreibung die Länge nicht ändert (sonst stimmen die Positionen nicht)
  if (word.toLowerCase().length !== word.length) return word;
  let result = word;
  for (const stem of UMLAUT_STEMS) {
    const ascii = asciiStem(stem);
    let at = result.toLowerCase().indexOf(ascii);
    while (at !== -1) {
      let out = result.slice(0, at);
      let source = at;
      for (const char of stem) {
        const first = result[source] ?? '';
        if (DIGRAPH[char]) {
          out += first !== first.toLowerCase() ? char.toUpperCase() : char;
          source += 2;
        } else {
          out += first;
          source += 1;
        }
      }
      result = out + result.slice(source);
      at = result.toLowerCase().indexOf(ascii);
    }
  }
  return result;
}

function tidy(text: string): string {
  return text.replace(/\s+/gu, ' ').replace(EDGE_SEPARATORS_RE, '').trim();
}

/** Höchstens `max` Zeichen, gezählt in Codepoints: kein Surrogat-Paar wird zerschnitten */
function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('').trim() : text;
}

/**
 * Modulname aus dem Moodle-Kursnamen (#141): Semesterzusätze und Terminarten („Übung“, „Tutorium“, „Vorlesung“ …)
 * weg, Unterstriche als Leerzeichen, führender Kurs-Code weg, ae/oe/ue nur in bekannten Wortstämmen zurück zu
 * Umlauten. Sonst bleibt der Name, wie Moodle ihn schreibt (auch Tippfehler). Bleibt nichts übrig: leerer Text, dann
 * entsteht kein Modul.
 */
export function cleanCourseName(fullName: string): string {
  let name = tidy(fullName.normalize('NFC').replaceAll('_', ' '));
  name = tidy(stripSemester(name));
  const withoutCode = tidy(name.replace(LEADING_CODE_RE, ''));
  if (withoutCode !== '') name = withoutCode;
  name = tidy(tidyBrackets(name.replace(KIND_WORD_RE, ' ')));
  name = name.replace(/\p{L}+/gu, restoreUmlauts);
  return truncate(name, MAX_AUTO_NAME_LENGTH);
}

/** Schlüssel, unter dem gleiche Modulnamen zusammenfallen (Groß-/Kleinschreibung, Umlaute, Satzzeichen egal) */
export const moduleNameKey = suggestionKey;

export type AutoMatch = { kind: 'eindeutig'; id: string } | { kind: 'mehrdeutig' } | { kind: 'keiner' };

/** Stufe im Namen: römische Zahl, Zahl oder einzelner Buchstabe A–F als eigenes Wort („Statistik II“, „Teil B“) */
const LEVEL_TOKEN_RE = /^(?:i{1,3}|iv|v|vi{1,3}|ix|x|[0-9]{1,2}|[a-f])$/u;

/**
 * Hat der Kurs eine Stufe, die das Modul nicht hat? „Statistik II“ passt dem Wortlaut nach zu „Statistik“, ist aber
 * ein anderes Modul. Dann keine Automatik, der Kurs bleibt ein Vorschlag.
 */
function levelMismatch(course: CourseInfo, candidate: ModuleCandidate): boolean {
  const own = new Set([...tokenize(candidate.name), ...tokenize(candidate.shortName)]);
  return tokenize(cleanCourseName(course.full_name)).some(
    (token) => LEVEL_TOKEN_RE.test(token) && !own.has(token),
  );
}

function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((word, offset) => haystack[i + offset] === word)) return true;
  }
  return false;
}

/**
 * Stufe 1 aus F-KAL-02: Name bzw. Kürzel des Moduls als ganze Wortfolge im Kursnamen. Bei mehreren Treffern gewinnt
 * der genauere („Statistik“ steckt in „Statistik II“). `null` = kein Treffer, `mehrdeutig` = mehrere.
 */
function nameInTitle(title: readonly string[], candidates: readonly ModuleCandidate[]): string | 'mehrdeutig' | null {
  const hits: { id: string; words: string[] }[] = [];
  for (const candidate of candidates) {
    let best: string[] | null = null;
    for (const needle of [tokenize(candidate.name), tokenize(candidate.shortName)]) {
      if (containsSequence(title, needle) && (!best || needle.length > best.length)) best = needle;
    }
    if (best) hits.push({ id: candidate.id, words: best });
  }
  if (hits.length === 0) return null;
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
  return ids.size === 1 ? ([...ids][0] as string) : 'mehrdeutig';
}

/**
 * Passt der Kurs eindeutig zu genau einem Modul (#141, Lead-Review B1)? Automatisch zählen nur zwei sichere Wege:
 * 1. Name bzw. Kürzel des Moduls als ganze Wortfolge im Kursnamen (Stufe 1 aus F-KAL-02)
 * 2. Moodle-Kürzel gleich dem Kürzel des Moduls
 * Alles Unsichere, das der Vorschlag noch findet (Abkürzungen wie „STA“ → „Statistik“, Wortanfänge, Ort), gilt als
 * `mehrdeutig`: keine Automatik, der Kurs bleibt Vorschlag, und es entsteht auch kein neues Modul. `keiner` nur, wenn
 * nicht einmal der Vorschlag etwas findet.
 */
export function matchForAuto(course: CourseInfo, candidates: readonly ModuleCandidate[]): AutoMatch {
  const sure = (id: string): AutoMatch => {
    const candidate = candidates.find((entry) => entry.id === id);
    if (!candidate || levelMismatch(course, candidate)) return { kind: 'mehrdeutig' };
    return { kind: 'eindeutig', id };
  };
  const inTitle = nameInTitle(tokenize(course.full_name), candidates);
  if (inTitle === 'mehrdeutig') return { kind: 'mehrdeutig' };
  if (inTitle) return sure(inTitle);

  const courseShort = tokenize(course.short_name).join(' ');
  const sameShort = candidates.filter(
    (candidate) => courseShort !== '' && tokenize(candidate.shortName).join(' ') === courseShort,
  );
  if (sameShort.length > 1) return { kind: 'mehrdeutig' };
  if (sameShort[0]) return sure(sameShort[0].id);

  // Unsichere Treffer wie beim Vorschlag (suggestModule): nur Vorschlag, keine Automatik
  const event = { title: course.full_name, location: course.short_name, description: null };
  const unsure = candidates.some((candidate) => {
    const short = candidate.shortName ?? '';
    return (
      matchModule(event, [candidate]) !== null ||
      (course.short_name !== '' && isAbbreviation(course.short_name, candidate.name)) ||
      isAbbreviation(course.full_name, candidate.name) ||
      (short !== '' && isAbbreviation(short, course.full_name))
    );
  });
  return unsure ? { kind: 'mehrdeutig' } : { kind: 'keiner' };
}
