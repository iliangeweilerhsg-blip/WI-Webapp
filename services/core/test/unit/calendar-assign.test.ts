// Zuordnung: Terminart, Modul, Modulvorschlag (VERTRAEGE §8 „Zuordnung“, F-KAL-02)
import { describe, expect, it } from 'vitest';
import {
  detectKind,
  isAbbreviation,
  matchModule,
  suggestModuleName,
  suggestionKey,
  tokenize,
  type ModuleCandidate,
} from '../../src/services/calendar-assign.ts';

const text = (title: string, location: string | null = null, description: string | null = null) => ({
  title,
  location,
  description,
});

describe('detectKind', () => {
  it.each([
    ['Mikroökonomie I – Vorlesung', 'vorlesung'],
    ['Datenbanksysteme (VL)', 'vorlesung'],
    ['Lecture: Databases', 'vorlesung'],
    ['DBS Übung Gr. 2', 'uebung'],
    ['MikroÖk I Ü', 'uebung'],
    ['Stat I UE', 'uebung'],
    ['Tutorium Mikro', 'tutorium'],
    ['WI Tut', 'tutorium'],
    ['Klausur Datenbanksysteme', 'pruefung'],
    ['Prüfung Mikroökonomie I', 'pruefung'],
    ['Pruefung Makro', 'pruefung'],
    ['Final Exam', 'pruefung'],
  ])('%s → %s', (title, kind) => {
    expect(detectKind(text(title), false, true)).toBe(kind);
  });

  it('bei mehreren Schlüsselwörtern gewinnt Prüfung vor Tutorium vor Übung vor Vorlesung', () => {
    expect(detectKind(text('Klausur zur Vorlesung'), false, true)).toBe('pruefung');
    expect(detectKind(text('Tutorium zur Übung'), false, true)).toBe('tutorium');
    expect(detectKind(text('Übung zur Vorlesung'), false, true)).toBe('uebung');
  });

  it('der Titel entscheidet, die Beschreibung nur als Rückfall', () => {
    expect(detectKind(text('Statistik', null, 'Wöchentliche Übung'), false, true)).toBe('uebung');
    expect(detectKind(text('Statistik Vorlesung', null, 'Bitte Übungsblätter mitbringen'), false, true)).toBe(
      'vorlesung',
    );
  });

  it('ohne Schlüsselwort: ganztägig ohne Modul = fest, sonst Vorlesung', () => {
    // „Vorlesungsfrei“ ist keine Vorlesung
    expect(detectKind(text('Allerheiligen (Vorlesungsfrei)'), true, false)).toBe('fest');
    expect(detectKind(text('Feiertag'), true, false)).toBe('fest');
    expect(detectKind(text('Feiertag'), true, true)).toBe('vorlesung');
    expect(detectKind(text('Lerngruppe'), false, false)).toBe('vorlesung');
  });
});

describe('tokenize', () => {
  it('ist unabhängig von Groß-/Kleinschreibung und Umlautschreibweise', () => {
    expect(tokenize('Ökonometrie')).toEqual(tokenize('oekonometrie'));
    expect(tokenize('Größe, Maß & Gü-Test')).toEqual(['groesse', 'mass', 'gue', 'test']);
    expect(tokenize('Größe')).toEqual(['groesse']);
    expect(tokenize('Café')).toEqual(['cafe']);
    expect(tokenize(null)).toEqual([]);
  });
});

const modules: ModuleCandidate[] = [
  { id: 'mikro', name: 'Mikroökonomie I', shortName: 'Mikro', lecturer: 'Prof. Dr. Anna Berger' },
  { id: 'makro', name: 'Makroökonomie I', shortName: 'Makro', lecturer: 'Prof. Dr. Peter Keller' },
  { id: 'dbs', name: 'Datenbanksysteme', shortName: 'DBS', lecturer: 'Dr. Lena Meier' },
  { id: 'stat1', name: 'Statistik I', shortName: 'Stat I', lecturer: null },
  { id: 'stat2', name: 'Statistik II', shortName: null, lecturer: null },
  { id: 'wi', name: 'Wirtschaftsinformatik', shortName: 'WI', lecturer: 'Prof. Dr. Thomas Brunner' },
];

describe('matchModule', () => {
  it('Name als Wortfolge im Titel', () => {
    expect(matchModule(text('Mikroökonomie I – Vorlesung'), modules)).toBe('mikro');
    expect(matchModule(text('Datenbanksysteme (VL)'), modules)).toBe('dbs');
  });

  it('ignoriert Groß-/Kleinschreibung und Umlautschreibweise', () => {
    expect(matchModule(text('MIKROOEKONOMIE I vorlesung'), modules)).toBe('mikro');
    expect(matchModule(text('makroökonomie i'), modules)).toBe('makro');
  });

  it('Kürzel als ganzes Wort', () => {
    expect(matchModule(text('DBS Übung Gr. 2'), modules)).toBe('dbs');
    expect(matchModule(text('WI Tutorium'), modules)).toBe('wi');
    expect(matchModule(text('Stat I – Übung'), modules)).toBe('stat1');
  });

  it('Kürzel ab 4 Zeichen auch als Wortanfang („Mikro“ in „MikroÖk“)', () => {
    expect(matchModule(text('MikroÖk I Ü'), modules)).toBe('mikro');
  });

  it('ein Name steckt nicht in einem anderen: Statistik I ist nicht Statistik II', () => {
    expect(matchModule(text('Statistik II – Vorlesung'), modules)).toBe('stat2');
    expect(matchModule(text('Statistik I Vorlesung'), modules)).toBe('stat1');
  });

  it('der Titel zählt vor Ort und Beschreibung', () => {
    expect(matchModule(text('Datenbanksysteme', null, 'Voraussetzung: Mikroökonomie I'), modules)).toBe(
      'dbs',
    );
  });

  it('Ort und Beschreibung, wenn der Titel nichts hergibt', () => {
    expect(matchModule(text('Vorlesung', 'Hörsaal A', 'Kurs Datenbanksysteme'), modules)).toBe('dbs');
  });

  it('Dozent in Ort oder Beschreibung, nur als letzte Stufe', () => {
    expect(matchModule(text('Vorlesung', 'Hörsaal 3', 'Dozentin: Anna Berger'), modules)).toBe('mikro');
    expect(matchModule(text('Vorlesung bei Keller'), modules)).toBe('makro');
    // Name im Titel schlägt den Dozenten einer anderen Veranstaltung in der Beschreibung
    expect(matchModule(text('Datenbanksysteme', null, 'Gast: Prof. Berger'), modules)).toBe('dbs');
  });

  it('der genauere Name gewinnt: „Statistik“ steckt in „Statistik II“', () => {
    const nested: ModuleCandidate[] = [
      { id: 'basis', name: 'Statistik', shortName: null, lecturer: null },
      { id: 'zwei', name: 'Statistik II', shortName: null, lecturer: null },
    ];
    expect(matchModule(text('Statistik II – Vorlesung'), nested)).toBe('zwei');
    expect(matchModule(text('Statistik – Vorlesung'), nested)).toBe('basis');
    // Zwei verschiedene Module, von denen keines im anderen steckt, bleiben mehrdeutig
    const apart: ModuleCandidate[] = [
      { id: 'a', name: 'Statistik', shortName: null, lecturer: null },
      { id: 'b', name: 'Vorlesung Statistik', shortName: 'Statistik', lecturer: null },
    ];
    expect(matchModule(text('Statistik'), apart)).toBeNull();
  });

  it('mehrdeutig oder kein Treffer: kein Modul', () => {
    expect(matchModule(text('Mikroökonomie I und Makroökonomie I'), modules)).toBeNull();
    expect(matchModule(text('Freie Lerngruppe im Café'), modules)).toBeNull();
    expect(matchModule(text('Datenbanksysteme'), [])).toBeNull();
  });

  it('ein Dozent mit zwei Modulen ist nicht eindeutig', () => {
    const shared: ModuleCandidate[] = [
      { id: 'a', name: 'Recht I', shortName: null, lecturer: 'Prof. Dr. Hans Vogel' },
      { id: 'b', name: 'Recht II', shortName: null, lecturer: 'Prof. Dr. Hans Vogel' },
    ];
    expect(matchModule(text('Vorlesung', null, 'bei Vogel'), shared)).toBeNull();
  });

  it('ein kurzer Nachname allein (unter 4 Zeichen) löst nichts aus, der ganze Name schon', () => {
    const short: ModuleCandidate[] = [{ id: 'a', name: 'Recht', shortName: null, lecturer: 'Li Wu' }];
    expect(matchModule(text('Wu Tang Clan'), short)).toBeNull();
    expect(matchModule(text('Vorlesung', null, 'bei Li Wu'), short)).toBe('a');
  });
});

describe('suggestModuleName', () => {
  it.each([
    ['Mikroökonomie I – Vorlesung', 'Mikroökonomie I'],
    ['Datenbanksysteme (VL)', 'Datenbanksysteme'],
    ['DBS Übung Gr. 2', 'DBS'],
    ['Stat I – Übung', 'Stat I'],
    ['Übung Makro I', 'Makro I'],
    ['MikroÖk I Ü', 'MikroÖk I'],
    ['Tutorium Mikro', 'Mikro'],
    ['Makroökonomie I - VL', 'Makroökonomie I'],
    ['Klausur Datenbanksysteme', 'Datenbanksysteme'],
    ['Operations Research (Vorlesung)', 'Operations Research'],
    ['Software Engineering – Übung (Zusatztermin)', 'Software Engineering'],
    [
      'Einführung in die Ökonometrie – Vorlesung: Schätzer, Tests; Modellwahl & Überprüfung',
      'Einführung in die Ökonometrie',
    ],
    ['Vorlesung', 'Vorlesung'],
  ])('%s → %s', (title, name) => {
    expect(suggestModuleName(title)).toBe(name);
  });

  it('gleicher Name, gleicher Schlüssel (egal wie geschrieben)', () => {
    expect(suggestionKey('Ökonometrie I')).toBe(suggestionKey('oekonometrie  i'));
  });
});

describe('isAbbreviation', () => {
  it.each([
    ['Stat I', 'Statistik I'],
    ['WI', 'Wirtschaftsinformatik'],
    ['OR', 'Operations Research'],
    ['DBS', 'Datenbanksysteme'],
    ['MikroÖk I', 'Mikroökonomie I'],
    ['Makro I', 'Makroökonomie I'],
  ])('%s kürzt %s ab', (short, long) => {
    expect(isAbbreviation(short, long)).toBe(true);
  });

  it.each([
    ['Stat I', 'Statistik II'],
    ['Statistik I', 'Statistik I'],
    ['Mikro', 'Makroökonomie I'],
    ['Datenbanksysteme', 'DBS'],
    ['X', 'Statistik'],
    ['Recht', 'Wirtschaftsrecht'],
  ])('%s kürzt %s nicht ab', (short, long) => {
    expect(isAbbreviation(short, long)).toBe(false);
  });
});
