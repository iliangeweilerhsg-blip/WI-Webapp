// Reine Regeln des Moodle-Abgleichs (F-MDL-03/-04, T1-23): Einordnung von Dateien, Anzeigename,
// Kursart und Modulvorschlag. Keine Datenbank, kein Netz.
import { isAbbreviation, matchModule, tokenize, type ModuleCandidate } from '../services/calendar-assign.ts';

export type FileKind = 'folien' | 'uebung';

/**
 * Zerlegt Wörter zusätzlich an Grenzen zwischen Buchstaben und Ziffern: „vl07“ → „vl“, „07“. Vorher NFC: Namen aus
 * macOS kommen oft zerlegt (NFD), „ö“ als „o“ plus Trema. Nur NFC, nie NFKC (Review #125, #133 S1). Ziffern nur
 * ASCII `[0-9]` (H4), sonst würden z. B. arabisch-indische Ziffern als Blattnummer gelten
 */
function words(text: string): string[] {
  return tokenize(text.normalize('NFC')).flatMap((token) =>
    token.split(/(?<=\p{L})(?=[0-9])|(?<=[0-9])(?=\p{L})/u),
  );
}

/** Ganze Wörter, die auf Folien bzw. eine Übung hindeuten (08 §9.4, F-MDL-04), normalisiert (ü → ue) */
const EXACT: Record<FileKind, ReadonlySet<string>> = {
  folien: new Set([
    'folie',
    'folien',
    'vorlesung',
    'vorlesungen',
    'vl',
    'slide',
    'slides',
    'lecture',
    'lectures',
  ]),
  uebung: new Set([
    'uebung',
    'uebungen',
    'blatt',
    'blaetter',
    'aufgabe',
    'aufgaben',
    'exercise',
    'exercises',
    'sheet',
    'sheets',
  ]),
};

/** Wortteile in zusammengesetzten Wörtern: „Vorlesungsfolien“, „Übungsblatt“, „Aufgabenblatt“ */
const PART: Record<FileKind, readonly string[]> = {
  folien: ['folien', 'vorlesung', 'slides', 'lecture'],
  uebung: ['uebung', 'aufgabe', 'exercise'],
};

/** Musterlösungen sind kein Übungsblatt (F-ORG-05 kommt später): Sie landen in der Inbox */
const SOLUTION_PARTS = ['loesung', 'solution'];

function hints(text: string): Set<FileKind> {
  const found = new Set<FileKind>();
  const tokens = words(text);
  for (const [index, token] of tokens.entries()) {
    for (const kind of ['folien', 'uebung'] as const) {
      if (
        EXACT[kind].has(token) ||
        PART[kind].some((part) => token.length > part.length && token.includes(part))
      ) {
        found.add(kind);
      }
    }
    // Muster wie `u05.pdf`, `ue3`, `Ü 05`
    if ((token === 'u' || token === 'ue') && /^[0-9]{1,3}$/.test(tokens[index + 1] ?? ''))
      found.add('uebung');
  }
  return found;
}

function isSolution(text: string): boolean {
  return words(text).some((token) => SOLUTION_PARTS.some((part) => token.includes(part)));
}

/**
 * Einordnung nach 08 §9.4 bzw. F-MDL-04 Schritt 2: zuerst der Dateiname, dann der Name der Aktivität. Eindeutig
 * Folien oder Übung → diese Art. Beides, nichts oder eine Musterlösung → `null` (Inbox).
 */
export function classifyFile(filename: string, activityName: string): FileKind | null {
  if (isSolution(filename) || isSolution(activityName)) return null;
  for (const text of [filename, activityName]) {
    const found = hints(text);
    if (found.size === 1) return [...found][0] as FileKind;
    if (found.size > 1) return null;
  }
  return null;
}

/** Nummer eines Übungsblatts aus Name bzw. Titel: „Blatt 03“, „u05.pdf“, „Übungsblatt 2“ → 3, 5, 2 */
export function sheetNumber(text: string): number | null {
  const tokens = words(text);
  for (const [index, token] of tokens.entries()) {
    const next = tokens[index + 1] ?? '';
    const isKeyword =
      token === 'u' ||
      token === 'ue' ||
      EXACT.uebung.has(token) ||
      PART.uebung.some((part) => token.includes(part));
    if (isKeyword && /^[0-9]{1,3}$/.test(next)) {
      const number = Number(next);
      if (number >= 1 && number <= 999) return number;
    }
  }
  return null;
}

/** Größte Länge des Anzeigenamens in Byte (UTF-8), wie bei Dateisystemen üblich (Hinweis aus #93) */
export const MAX_FILENAME_BYTES = 255;
const utf8Length = (text: string) => Buffer.byteLength(text, 'utf8');

/**
 * Dateiname zur Anzeige: höchstens 255 Byte, die Endung bleibt erhalten. Gekürzt wird nach ganzen Zeichen
 * (Codepoints), nie mitten in einer UTF-8-Folge. Der Name dient nur der Anzeige, gespeichert wird über IDs.
 */
export function displayFilename(name: string, maxBytes = MAX_FILENAME_BYTES): string {
  if (utf8Length(name) <= maxBytes) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
  const budget = maxBytes - utf8Length(extension);
  let base = '';
  let used = 0;
  for (const char of name.slice(0, name.length - extension.length)) {
    const size = utf8Length(char);
    if (used + size > budget) break;
    base += char;
    used += size;
  }
  return `${base.trimEnd()}${extension}`;
}

// ---------------------------------------------------------------------------------------------
// Kurse (F-MDL-03)
// ---------------------------------------------------------------------------------------------

export type CourseCategory = 'aktuell' | 'organisatorisch' | 'alt';

/** Wortteile organisatorischer Kurse („Klausurtermine …“, Fachschaft, Info-Kurse) */
const ORGANISATIONAL_PARTS = [
  'klausurtermin',
  'pruefungstermin',
  'pruefungsamt',
  'pruefungsanmeldung',
  'fachschaft',
  'orientierung',
  'organisatorisch',
  'studienorganisation',
  'informationen',
  'ankuendigung',
  'sandbox',
  'testkurs',
  'spielwiese',
];

/** Kurse, die bis zu so viele Tage vor Semesterbeginn starten, zählen noch zum Semester */
export const SEMESTER_START_TOLERANCE_DAYS = 30;

export interface CourseInfo {
  full_name: string;
  short_name: string;
  start_date: string | null;
  end_date: string | null;
}

/**
 * Art des Kurses. organisatorisch: Name deutet auf Organisation. alt: Start mehr als 30 Tage vor dem aktuellen
 * Semester bzw. (ohne Semesterbeginn) schon beendet.
 */
export function courseCategory(
  course: CourseInfo,
  semesterStartsOn: string | null,
  today: string,
): CourseCategory {
  const tokens = [...words(course.full_name), ...words(course.short_name)];
  if (tokens.some((token) => ORGANISATIONAL_PARTS.some((part) => token.includes(part))))
    return 'organisatorisch';
  if (semesterStartsOn && course.start_date) {
    const limit = new Date(`${semesterStartsOn}T00:00:00Z`);
    limit.setUTCDate(limit.getUTCDate() - SEMESTER_START_TOLERANCE_DAYS);
    if (course.start_date < limit.toISOString().slice(0, 10)) return 'alt';
  } else if (course.end_date && course.end_date < today) {
    return 'alt';
  }
  return 'aktuell';
}

/**
 * Modulvorschlag über Titelähnlichkeit wie beim Kalender (F-KAL-02): erst Name bzw. Kürzel im Kursnamen, dann
 * Abkürzungen („DBS“ ↔ „Datenbanksysteme“, „OR“ ↔ „Operations Research“). Nur ein eindeutiger Treffer zählt.
 */
export function suggestModule(course: CourseInfo, candidates: readonly ModuleCandidate[]): string | null {
  const direct = matchModule(
    { title: course.full_name, location: course.short_name, description: null },
    candidates,
  );
  if (direct) return direct;
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
  return hits.length === 1 ? (hits[0]?.id ?? null) : null;
}
