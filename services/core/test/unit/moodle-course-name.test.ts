// #141: Modulname aus dem Moodle-Kursnamen und eindeutiger Treffer für die automatische Zuordnung. Reine Funktionen.
// Kursnamen nach dem Screenshot des Owners nachgebaut, alles andere erfunden.
import { describe, expect, it } from 'vitest';
import { courseCategory } from '../../src/moodle/classify.ts';
import {
  cleanCourseName,
  cleanShortName,
  matchForAuto,
  restoreUmlauts,
  UMLAUT_STEMS,
} from '../../src/moodle/course-name.ts';
import type { ModuleCandidate } from '../../src/services/calendar-assign.ts';

const course = (full_name: string, short_name = '') => ({
  full_name,
  short_name,
  start_date: '2026-09-14',
  end_date: null,
});
const module = (id: string, name: string, shortName: string | null = null): ModuleCandidate => ({
  id,
  name,
  shortName,
  lecturer: null,
});

describe('cleanCourseName', () => {
  it.each([
    ['Einführung in das Marketing WiSe 26/27', 'Einführung in das Marketing'],
    ['Grundlagen der Programmierung 26/27', 'Grundlagen der Programmierung'],
    ['Mathematik für Wirtschaftinformatik WiSe 2026/27', 'Mathematik für Wirtschaftinformatik'],
    ['BMBWL110_Einfuehrung_in_die_Betriebswirtschaftslehre', 'Einführung in die Betriebswirtschaftslehre'],
    ['Einführung in die Wirtschaftsinformatik WiSe 26/27', 'Einführung in die Wirtschaftsinformatik'],
    ['Betriebspraktikum Wirtschaftswissenschaften', 'Betriebspraktikum Wirtschaftswissenschaften'],
  ])('Screenshot: %s → %s', (input, expected) => {
    expect(cleanCourseName(input)).toBe(expected);
  });

  it('entfernt Semesterzusätze in allen Schreibweisen, auch in Klammern', () => {
    expect(cleanCourseName('Statistik (WiSe 26/27)')).toBe('Statistik');
    expect(cleanCourseName('Statistik [SoSe 2027]')).toBe('Statistik');
    expect(cleanCourseName('Statistik - WS 2026/27')).toBe('Statistik');
    expect(cleanCourseName('Statistik SS27')).toBe('Statistik');
    expect(cleanCourseName('Statistik WiSe2026/2027')).toBe('Statistik');
    expect(cleanCourseName('Statistik Wintersemester 2026/27')).toBe('Statistik');
    expect(cleanCourseName('Statistik 2026/27')).toBe('Statistik');
    expect(cleanCourseName('Statistik (2026/2027)')).toBe('Statistik');
  });

  it('lässt Ähnliches stehen: Zahlenpaare, die keine Jahresfolge sind, WS/SS ohne Jahr, Kleinschreibung', () => {
    expect(cleanCourseName('Kapitel 10/12')).toBe('Kapitel 10/12');
    expect(cleanCourseName('Geschichte 26/2027')).toBe('Geschichte 26/2027');
    expect(cleanCourseName('Grundlagen WS')).toBe('Grundlagen WS');
    expect(cleanCourseName('Otherwise wise')).toBe('Otherwise wise');
  });

  it('ersetzt Unterstriche und entfernt führende Kurs-Codes, aber nur mit Text dahinter', () => {
    expect(cleanCourseName('WI101: Datenbanksysteme')).toBe('Datenbanksysteme');
    expect(cleanCourseName('BMBWL110 - Rechnungswesen')).toBe('Rechnungswesen');
    expect(cleanCourseName('BMBWL110')).toBe('BMBWL110');
    // Nur Großbuchstaben mit Ziffern: „SAP S4“ oder „Big Data“ bleiben
    expect(cleanCourseName('SAP S4 Grundlagen')).toBe('SAP S4 Grundlagen');
    expect(cleanCourseName('Data_Science_Projekt')).toBe('Data Science Projekt');
  });

  it('normalisiert auf NFC (zerlegte Umlaute aus macOS), nie NFKC', () => {
    const decomposed = 'Einführung in das Marketing WiSe 26/27';
    expect(cleanCourseName(decomposed)).toBe('Einführung in das Marketing');
    // NFKC würde „²“ zu „2“ machen
    expect(cleanCourseName('Analysis²')).toBe('Analysis²');
  });

  it('fällt auf den ursprünglichen Namen zurück, wenn nichts übrig bleibt', () => {
    expect(cleanCourseName('WiSe 26/27')).toBe('WiSe 26/27');
  });

  it('kürzt sehr lange Namen auf 120 Zeichen', () => {
    expect(cleanCourseName('A'.repeat(300))).toHaveLength(120);
  });
});

describe('restoreUmlauts', () => {
  it('wandelt nur bekannte Wortstämme zurück und behält die Schreibweise', () => {
    expect(restoreUmlauts('Einfuehrung')).toBe('Einführung');
    expect(restoreUmlauts('Uebungen')).toBe('Übungen');
    expect(restoreUmlauts('UEBUNG')).toBe('ÜBUNG');
    expect(restoreUmlauts('Pruefungsvorbereitung')).toBe('Prüfungsvorbereitung');
    expect(restoreUmlauts('Unternehmensfuehrung')).toBe('Unternehmensführung');
    expect(restoreUmlauts('Mikrooekonomik')).toBe('Mikroökonomik');
    expect(restoreUmlauts('Geschaeftsprozesse')).toBe('Geschäftsprozesse');
  });

  it('lässt andere Wörter und Wörter mit Umlaut in Ruhe (lieber konservativ)', () => {
    for (const word of ['Steuerlehre', 'Quelle', 'aktuell', 'Feuer', 'Grundlagen', 'Michael', 'Poesie']) {
      expect(restoreUmlauts(word), word).toBe(word);
    }
    // Hat das Wort schon einen Umlaut, bleibt es ganz
    expect(restoreUmlauts('Übungsfuehrung')).toBe('Übungsfuehrung');
  });

  it('die Liste ist klein und hat in jedem Stamm genau einen Umlaut', () => {
    expect(UMLAUT_STEMS.length).toBeLessThanOrEqual(12);
    for (const stem of UMLAUT_STEMS) expect(stem.match(/[äöü]/gu), stem).toHaveLength(1);
  });
});

describe('cleanShortName', () => {
  it('übernimmt das Moodle-Kürzel ohne Semesterzusatz', () => {
    expect(cleanShortName('EiM-WS2627', 'Einführung in das Marketing')).toBe('EiM');
    expect(cleanShortName('MathWI WS26/27', 'Mathematik')).toBe('MathWI');
    expect(cleanShortName('BMBWL110', 'Einführung in die Betriebswirtschaftslehre')).toBe('BMBWL110');
    expect(cleanShortName('GdP-2627', 'Grundlagen der Programmierung')).toBe('GdP');
    // Keine Jahresfolge: bleibt
    expect(cleanShortName('Labor-1830', 'Labor')).toBe('Labor-1830');
  });

  it('kein Kürzel, wenn es leer, zu lang oder schon der Name ist', () => {
    expect(cleanShortName('', 'Statistik')).toBeNull();
    expect(cleanShortName('WiSe 26/27', 'Statistik')).toBeNull();
    expect(cleanShortName('BMBWL110_Einfuehrung_in_die_BWL', 'Einführung in die BWL')).toBeNull();
    expect(cleanShortName('statistik', 'Statistik')).toBeNull();
  });
});

describe('matchForAuto', () => {
  const wi = module('m-wi', 'Einführung in die Wirtschaftsinformatik');

  it('eindeutig: der WI-Kurs passt zum bestehenden Modul', () => {
    expect(matchForAuto(course('Einführung in die Wirtschaftsinformatik WiSe 26/27', 'EWI'), [wi])).toEqual({
      kind: 'eindeutig',
      id: 'm-wi',
    });
  });

  it('keiner: die übrigen Kurse des Screenshots passen zu keinem Modul', () => {
    for (const name of [
      'Einführung in das Marketing WiSe 26/27',
      'Grundlagen der Programmierung 26/27',
      'Mathematik für Wirtschaftinformatik WiSe 2026/27',
      'BMBWL110_Einfuehrung_in_die_Betriebswirtschaftslehre',
      'Betriebspraktikum Wirtschaftswissenschaften',
    ]) {
      expect(matchForAuto(course(name), [wi]), name).toEqual({ kind: 'keiner' });
    }
  });

  it('mehrdeutig: zwei Module, die nicht ineinander stecken', () => {
    const candidates = [module('m-mkt', 'Marketing'), module('m-ctl', 'Controlling')];
    expect(matchForAuto(course('Marketing und Controlling'), candidates)).toEqual({ kind: 'mehrdeutig' });
  });

  it('mehrdeutig auch über Abkürzungen', () => {
    const candidates = [module('m-1', 'Datenbanksysteme'), module('m-2', 'Digitale Business Systeme')];
    expect(matchForAuto(course('DBS'), candidates)).toEqual({ kind: 'mehrdeutig' });
  });

  it('der genauere Treffer gewinnt wie beim Vorschlag („Statistik“ steckt in „Statistik II“)', () => {
    const candidates = [module('m-1', 'Statistik'), module('m-2', 'Statistik II')];
    expect(matchForAuto(course('Statistik II WiSe 26/27'), candidates)).toEqual({
      kind: 'eindeutig',
      id: 'm-2',
    });
  });

  it('andere Stufe: „Statistik II“ wird nicht automatisch „Statistik“ zugeordnet', () => {
    expect(matchForAuto(course('Statistik II WiSe 26/27'), [module('m-1', 'Statistik')])).toEqual({
      kind: 'mehrdeutig',
    });
    // Das Semester („26/27“) ist keine Stufe
    expect(matchForAuto(course('Statistik WiSe 26/27'), [module('m-1', 'Statistik')])).toEqual({
      kind: 'eindeutig',
      id: 'm-1',
    });
  });
});

describe('Betriebspraktikum (#141)', () => {
  it('greift die Regel für organisatorische Kurse nicht: der Kurs ist ein normaler, aktueller Kurs', () => {
    expect(
      courseCategory(
        course('Betriebspraktikum Wirtschaftswissenschaften', 'BPWW'),
        '2026-09-14',
        '2026-11-05',
      ),
    ).toBe('aktuell');
  });
});
