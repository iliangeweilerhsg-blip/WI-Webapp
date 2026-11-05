// T1-23: Regeln des Moodle-Abgleichs (Einordnung, Anzeigename, Kursart, Modulvorschlag). Nur erfundene Namen.
import { describe, expect, it } from 'vitest';
import {
  classifyFile,
  courseCategory,
  displayFilename,
  sheetNumber,
  suggestModule,
} from '../../src/moodle/classify.ts';

describe('classifyFile (08 §9.4, F-MDL-04)', () => {
  it.each([
    ['VL07_Normalisierung.pdf', 'Material', 'folien'],
    ['Vorlesung 3.pdf', 'Dateien', 'folien'],
    ['Vorlesungsfolien-Kapitel2.pdf', 'Woche 2', 'folien'],
    ['lecture-05.pdf', 'Week 5', 'folien'],
    ['Slides_Intro.pdf', 'Week 1', 'folien'],
    ['Übungsblatt 3.pdf', 'Woche 3', 'uebung'],
    ['Uebung_04.pdf', 'Woche 4', 'uebung'],
    ['u05.pdf', 'Woche 5', 'uebung'],
    ['Ü 06.pdf', 'Woche 6', 'uebung'],
    ['Blatt02.pdf', 'Woche 2', 'uebung'],
    ['exercise-sheet-1.pdf', 'Week 1', 'uebung'],
    ['Hausaufgabe 2.pdf', 'Woche 2', 'uebung'],
  ] as const)('%s → %s', (filename, activity, expected) => {
    expect(classifyFile(filename, activity)).toBe(expected);
  });

  it('nimmt die Aktivität, wenn der Dateiname nichts hergibt', () => {
    expect(classifyFile('kapitel-3.pdf', 'Folien zur Vorlesung')).toBe('folien');
    expect(classifyFile('woche-4.pdf', 'Übung 4')).toBe('uebung');
  });

  it('der Dateiname entscheidet vor der Aktivität', () => {
    expect(classifyFile('Blatt 3.pdf', 'Vorlesung und Übung')).toBe('uebung');
  });

  it('unklare Fälle landen in der Inbox (null)', () => {
    expect(classifyFile('Skript.pdf', 'Material')).toBeNull();
    expect(classifyFile('Merkblatt.pdf', 'Allgemeines')).toBeNull();
    // Beides zugleich
    expect(classifyFile('VL3_Uebung.pdf', 'Woche 3')).toBeNull();
    // Musterlösungen sind kein Übungsblatt
    expect(classifyFile('Lösung Blatt 3.pdf', 'Übung')).toBeNull();
    expect(classifyFile('blatt3.pdf', 'Musterlösungen')).toBeNull();
  });

  it('Wortanfänge zählen nicht als VL bzw. Ü', () => {
    expect(classifyFile('vlan-konfiguration.pdf', 'Netze')).toBeNull();
    expect(classifyFile('ueberblick.pdf', 'Allgemeines')).toBeNull();
  });
});

describe('Namen in NFD (macOS) und fremde Ziffern (Review #133, S1/H4)', () => {
  const nfd = (text: string) => text.normalize('NFD');

  it('NFD-Namen werden wie NFC eingeordnet', () => {
    expect(nfd('Musterlösung Blatt 4.pdf')).not.toBe('Musterlösung Blatt 4.pdf');
    expect(classifyFile(nfd('Musterlösung Blatt 4.pdf'), 'Material')).toBeNull();
    expect(classifyFile('Blatt 4.pdf', nfd('Lösungen'))).toBeNull();
    expect(classifyFile(nfd('Übungsblatt 4.pdf'), 'Woche 4')).toBe('uebung');
    expect(classifyFile(nfd('Ü 05.pdf'), 'Woche 5')).toBe('uebung');
    expect(sheetNumber(nfd('Übungsblatt 7'))).toBe(7);
  });

  it('nur ASCII-Ziffern zählen als Nummer', () => {
    // Arabisch-indische bzw. Devanagari-Ziffern, als Escape geschrieben
    expect(sheetNumber('Blatt ٣')).toBeNull();
    expect(classifyFile('u\u0967\u0968.pdf', 'Material')).toBeNull();
    expect(sheetNumber('Blatt 3')).toBe(3);
  });

  it('organisatorische Kurse auch in NFD', () => {
    expect(
      courseCategory(
        { full_name: nfd('Prüfungsamt Beispielfakultät'), short_name: '', start_date: null, end_date: null },
        null,
        '2026-11-05',
      ),
    ).toBe('organisatorisch');
  });
});

describe('sheetNumber', () => {
  it.each([
    ['Blatt 03.pdf', 3],
    ['u05.pdf', 5],
    ['Übungsblatt 2', 2],
    ['Abgabe Übungsblatt 12', 12],
    ['Hausaufgabe 1', 1],
    ['Skript 3', null],
  ] as const)('%s → %s', (text, expected) => {
    expect(sheetNumber(text)).toBe(expected);
  });
});

describe('displayFilename (Hinweis aus #93)', () => {
  it('lässt kurze Namen unverändert', () => {
    expect(displayFilename('01-Einführung.pdf')).toBe('01-Einführung.pdf');
  });

  it('kürzt auf 255 Byte und behält die Endung', () => {
    const name = `${'ä'.repeat(200)}.pdf`;
    const short = displayFilename(name);
    expect(Buffer.byteLength(short, 'utf8')).toBeLessThanOrEqual(255);
    expect(short.endsWith('.pdf')).toBe(true);
    expect(short.startsWith('ää')).toBe(true);
  });

  it('trennt keine Zeichen außerhalb der BMP (keine halben Surrogate)', () => {
    const short = displayFilename(`${'😀'.repeat(100)}.pdf`);
    expect(Buffer.byteLength(short, 'utf8')).toBeLessThanOrEqual(255);
    expect(short).not.toMatch(/[\uD800-\uDFFF](?![\uDC00-\uDFFF])/u);
    expect([...short.slice(0, -4)].every((char) => char === '😀')).toBe(true);
  });
});

describe('courseCategory (F-MDL-03)', () => {
  const course = (full_name: string, start_date: string | null, end_date: string | null = null) => ({
    full_name,
    short_name: '',
    start_date,
    end_date,
  });

  it('organisatorische Kurse', () => {
    expect(courseCategory(course('Klausurtermine Fakultät', '2026-10-01'), '2026-10-01', '2026-11-05')).toBe(
      'organisatorisch',
    );
    expect(courseCategory(course('Fachschaft Beispiel', '2026-10-01'), '2026-10-01', '2026-11-05')).toBe(
      'organisatorisch',
    );
  });

  it('alte Kurse: Start mehr als 30 Tage vor dem aktuellen Semester', () => {
    expect(courseCategory(course('Statistik I', '2026-04-01'), '2026-10-01', '2026-11-05')).toBe('alt');
    expect(courseCategory(course('Statistik II', '2026-09-15'), '2026-10-01', '2026-11-05')).toBe('aktuell');
  });

  it('ohne Semesterbeginn: beendete Kurse sind alt', () => {
    expect(courseCategory(course('Statistik I', '2026-04-01', '2026-09-30'), null, '2026-11-05')).toBe('alt');
    expect(courseCategory(course('Statistik II', null, null), null, '2026-11-05')).toBe('aktuell');
  });
});

describe('suggestModule (wie F-KAL-02)', () => {
  const modules = [
    { id: 'm1', name: 'Datenbanksysteme', shortName: 'DBS', lecturer: null },
    { id: 'm2', name: 'Statistik I', shortName: null, lecturer: null },
    { id: 'm3', name: 'Statistik II', shortName: null, lecturer: null },
    { id: 'm4', name: 'Operations Research', shortName: null, lecturer: null },
  ];
  const course = (full_name: string, short_name = '') => ({
    full_name,
    short_name,
    start_date: null,
    end_date: null,
  });

  it('Name bzw. Kürzel im Kursnamen', () => {
    expect(suggestModule(course('Datenbanksysteme (WiSe 26/27)'), modules)).toBe('m1');
    expect(suggestModule(course('Statistik II – Vorlesung'), modules)).toBe('m3');
  });

  it('Abkürzungen', () => {
    expect(suggestModule(course('Grundlagen', 'DBS'), modules)).toBe('m1');
    expect(suggestModule(course('OR', 'OR-26'), modules)).toBe('m4');
  });

  it('kein oder kein eindeutiger Treffer → null', () => {
    expect(suggestModule(course('Kunstgeschichte'), modules)).toBeNull();
  });
});
