// Datenmenge und Anfragen des Lasttests ⌘K (lasttest-suche.ts). Alles erfunden.
//
// Menge aus der Anforderung (09-NFA: „⌘K erste Ergebnisse < 300 ms bei 5 000 Folien, 200 h Transkript“):
// 2 Semester, 10 Module, 125 Foliensätze à 40 Folien (5 000 Folien), 134 Sessions à 90 Minuten (90 Fenster à 60 s,
// wie der Suchindex sie schneidet, VERTRAEGE §19.3; zusammen 201 h). Zusammen etwa 17 000 Einträge in
// `search_chunk`. Gesucht wird nur in Folien und Gesagtem; Konzepte sind nicht Teil des Suchindex (VERTRAEGE §19).

export interface Counts {
  semesters: number;
  modules: number;
  decks: number;
  slidesPerDeck: number;
  sessions: number;
  windowsPerSession: number;
}

/** Menge bei `--faktor 1` (09-NFA); der Faktor skaliert Foliensätze und Sessions (mindestens 10 Sessions und 4 Foliensätze) */
export function planCounts(factor: number): Counts {
  return {
    semesters: 2,
    modules: 10,
    decks: Math.max(4, Math.round(125 * factor)),
    slidesPerDeck: 40,
    sessions: Math.max(10, Math.round(134 * factor)),
    windowsPerSession: 90,
  };
}

export type QueryGroup = 'Präfix' | 'kurz' | 'lang' | 'gefiltert';

export interface PerfQuery {
  group: QueryGroup;
  q: string;
}

/**
 * Typische Eingaben in ⌘K. Die Fachwörter kommen in den erzeugten Texten vor (4 % der Wörter), die Silbenwörter sind
 * häufig bzw. selten (schiefe Verteilung). Ein Wort ohne Leerzeichen am Ende wird als Präfix gesucht (`:*`).
 */
export const QUERIES: readonly PerfQuery[] = [
  { group: 'Präfix', q: 'nor' },
  { group: 'Präfix', q: 'trans' },
  { group: 'Präfix', q: 'ver' }, // kurzes Präfix, sehr viele Treffer (ungünstigster Fall)
  { group: 'Präfix', q: 'kaka' },
  { group: 'kurz', q: 'Index' },
  { group: 'kurz', q: 'Isolation' },
  { group: 'kurz', q: 'Heuristik' },
  { group: 'lang', q: 'Normalform Transaktion' },
  { group: 'lang', q: 'Transaktion Isolation Kardinalität' },
  { group: 'lang', q: 'Wertschöpfung Bilanzierung Heuristik Algorithmus' },
  { group: 'gefiltert', q: 'fach:M1 normalform' },
  { group: 'gefiltert', q: 'typ:gesagtes isolation' },
  { group: 'gefiltert', q: 'typ:folie fach:M2 algorithmus' },
];
