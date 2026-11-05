// Automatische Kurszuordnung (#141), reine Regeln: Modulname aus dem Kursnamen und eindeutiger Treffer.
// Keine Datenbank, kein Netz, keine KI. Regexe und Umlaute im Code nur als ASCII-Escapes.
import {
  isAbbreviation,
  matchModule,
  suggestionKey,
  tokenize,
  type ModuleCandidate,
} from '../services/calendar-assign.ts';
import type { CourseInfo } from './classify.ts';

/** Längster Modulname, der automatisch entsteht (wie beim Vorschlag aus dem Kalender) */
export const MAX_AUTO_NAME_LENGTH = 120;
/** Längeres Moodle-Kürzel wird nicht übernommen: Die Seitenleiste zeigt das Kürzel statt des Namens */
export const MAX_AUTO_SHORT_NAME_LENGTH = 20;

/** Wortgrenzen für Unicode (`\b` kennt nur ASCII) */
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const YEAR = '(?:[0-9]{4}|[0-9]{2})';
const YEARS = `${YEAR}(?:\\s*/\\s*${YEAR})?`;

/**
 * Semesterzusatz: WiSe/SoSe (auch ausgeschrieben) mit oder ohne Jahr, WS/SS nur mit Jahr („WS 26/27“, „SS27“).
 * Groß- und Kleinschreibung zählt: „wise“ oder „ss“ mitten im Namen bleiben stehen.
 */
const TERM_RE = new RegExp(
  `${B}(?:(?:WiSe|WISE|SoSe|SOSE|Wintersemester|Sommersemester)(?:[\\s.\\-]*${YEARS})?|(?:WS|SS)[\\s.\\-]*${YEARS})${E}`,
  'gu',
);
/** Jahresangabe allein: `JJ/JJ`, `JJJJ/JJ`, `JJJJ/JJJJ`. Gilt nur für zwei aufeinanderfolgende Jahre („26/27“) */
const RANGE_RE = new RegExp(`${B}([0-9]{4}|[0-9]{2})\\s*/\\s*([0-9]{4}|[0-9]{2})${E}`, 'gu');
/** Führender Kurs-Code: Großbuchstaben mit Ziffern („BMBWL110“), danach Leerzeichen, Doppelpunkt oder Strich */
const LEADING_CODE_RE = /^[A-Z]{2,}[0-9]+[A-Z0-9]*[\s:\u2013\u2014-]+(?=\S)/u;
/** Klammern, die nach dem Entfernen leer sind oder nur noch Trennzeichen enthalten */
const EMPTY_BRACKETS_RE = /[([][\s,;:/.\u2013\u2014-]*[)\]]/gu;
/** Trennzeichen am Anfang bzw. Ende */
const EDGE_SEPARATORS_RE = /^[\s,;:/|.\u2013\u2014-]+|[\s,;:/|.\u2013\u2014-]+$/gu;
const UMLAUT_RE = /[\u00c4\u00d6\u00dc\u00e4\u00f6\u00fc\u00df]/u;
const UMLAUT_LOWER_RE = /[\u00e4\u00f6\u00fc]/gu;

/** „26/27“, „2026/27“, „2026/2027“: zwei aufeinanderfolgende Jahre */
function consecutive(first: string, second: string): boolean {
  if (first.length === 2 && second.length === 4) return false;
  return (Number(first) + 1) % 100 === Number(second) % 100;
}

function stripSemester(text: string): string {
  return text
    .replace(TERM_RE, ' ')
    .replace(RANGE_RE, (match: string, first: string, second: string) =>
      consecutive(first, second) ? ' ' : match,
    )
    .replace(EMPTY_BRACKETS_RE, ' ');
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

/**
 * Modulname aus dem Moodle-Kursnamen (#141): Semesterzusätze weg, Unterstriche als Leerzeichen, führender Kurs-Code
 * weg, ae/oe/ue nur in bekannten Wortstämmen zurück zu Umlauten. Sonst bleibt der Name, wie Moodle ihn schreibt
 * (auch Tippfehler). Bleibt nichts übrig, gilt der ursprüngliche Name.
 */
export function cleanCourseName(fullName: string): string {
  const original = tidy(fullName.normalize('NFC'));
  let name = tidy(stripSemester(original.replaceAll('_', ' ')));
  const withoutCode = tidy(name.replace(LEADING_CODE_RE, ''));
  if (withoutCode !== '') name = withoutCode;
  name = name.replace(/\p{L}+/gu, restoreUmlauts);
  if (name === '') name = original;
  return name.length > MAX_AUTO_NAME_LENGTH ? name.slice(0, MAX_AUTO_NAME_LENGTH).trim() : name;
}

/** Kompakte Jahresfolge am Ende eines Kürzels: „GdP-2627“ (nur hinter einem Trennzeichen, nur aufeinanderfolgend) */
const COMPACT_YEARS_RE = /[\s-]+([0-9]{2})([0-9]{2})$/u;

/**
 * Kürzel für das neue Modul: das Moodle-Kürzel ohne Semesterzusatz, aber nur, wenn es kurz ist und nicht schon der
 * Name selbst. Sonst keins.
 */
export function cleanShortName(shortName: string, moduleName: string): string | null {
  let short = tidy(stripSemester(tidy(shortName.normalize('NFC')).replaceAll('_', ' ')));
  short = tidy(
    short.replace(COMPACT_YEARS_RE, (match: string, first: string, second: string) =>
      consecutive(first, second) ? '' : match,
    ),
  );
  if (short === '' || short.length > MAX_AUTO_SHORT_NAME_LENGTH) return null;
  if (suggestionKey(short) === suggestionKey(moduleName)) return null;
  return short;
}

/** Schlüssel, unter dem gleiche Modulnamen zusammenfallen (Groß-/Kleinschreibung, Umlaute, Satzzeichen egal) */
export const moduleNameKey = suggestionKey;

export type AutoMatch = { kind: 'eindeutig'; id: string } | { kind: 'mehrdeutig' } | { kind: 'keiner' };

/** Stufe im Namen: römische Zahl oder Zahl als eigenes Wort („Statistik II“, „Mathematik 2“) */
const LEVEL_TOKEN_RE = /^(?:i{1,3}|iv|v|vi{1,3}|ix|x|[0-9]{1,2})$/u;

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

/**
 * Passt der Kurs zu genau einem Modul? Gleiche Regeln wie der Vorschlag (`suggestModule`, F-MDL-03): zuerst Name bzw.
 * Kürzel im Kursnamen (wie F-KAL-02), dann Abkürzungen. Unterschied: `mehrdeutig` heißt ausdrücklich mehrdeutig
 * (keine Automatik), `keiner` heißt, dass ein neues Modul entstehen darf.
 */
export function matchForAuto(course: CourseInfo, candidates: readonly ModuleCandidate[]): AutoMatch {
  const event = { title: course.full_name, location: course.short_name, description: null };
  let id = matchModule(event, candidates);
  if (id === null) {
    // Kein eindeutiger Treffer: Trifft ein Modul für sich allein, waren es mehrere
    if (candidates.some((candidate) => matchModule(event, [candidate]) !== null))
      return { kind: 'mehrdeutig' };
    const courseShort = tokenize(course.short_name).join(' ');
    const hits = candidates.filter((candidate) => {
      const short = candidate.shortName ?? '';
      return (
        (courseShort !== '' && tokenize(short).join(' ') === courseShort) ||
        (course.short_name !== '' && isAbbreviation(course.short_name, candidate.name)) ||
        isAbbreviation(course.full_name, candidate.name) ||
        (short !== '' && isAbbreviation(short, course.full_name))
      );
    });
    if (hits.length === 0) return { kind: 'keiner' };
    if (hits.length > 1) return { kind: 'mehrdeutig' };
    id = hits[0]?.id ?? null;
  }
  const candidate = candidates.find((entry) => entry.id === id);
  if (!candidate) return { kind: 'keiner' };
  return levelMismatch(course, candidate) ? { kind: 'mehrdeutig' } : { kind: 'eindeutig', id: candidate.id };
}
