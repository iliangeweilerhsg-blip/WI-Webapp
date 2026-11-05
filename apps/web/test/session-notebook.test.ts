// Notizbuch der Session aus dem Termin (Issue #107, Punkt 1): reine Funktion, alle Fälle
import { describe, expect, it } from 'vitest';
import type { CalendarEvent, Notebook } from '@sg/shared';
import { pickSessionNotebook, wantedNotebookKind } from '../src/lib/session-notebook.ts';

const nb = (
  id: string,
  kind: Notebook['kind'],
  created: string,
  deleted: string | null = null,
): Notebook => ({
  id,
  user_id: 'u',
  created_at: created,
  updated_at: created,
  deleted_at: deleted,
  module_id: 'm',
  title: id,
  kind,
  page_count: 0,
});
const VL = nb('vl', 'vorlesung', '2026-11-01T08:00:00Z');
const VL_OLD = nb('vl-alt', 'vorlesung', '2026-10-01T08:00:00Z');
const UE = nb('ue', 'uebung', '2026-11-02T08:00:00Z');
const FREI = nb('frei', 'frei', '2026-09-01T08:00:00Z');
const DELETED = '2026-11-03T00:00:00Z';
const withEvent = { calendar_event_id: 'e1' };
const noEvent = { calendar_event_id: null };
const ev = (kind: CalendarEvent['kind']) => ({ kind });
const id = (n: Notebook | null) => n?.id ?? null;

describe('wantedNotebookKind', () => {
  it('Übung und Tutorium: „uebung“, alles andere und fehlender Termin: „vorlesung“', () => {
    expect(wantedNotebookKind(ev('uebung'))).toBe('uebung');
    expect(wantedNotebookKind(ev('tutorium'))).toBe('uebung');
    for (const kind of ['vorlesung', 'pruefung', 'fest', 'lernblock_export'] as const) {
      expect(wantedNotebookKind(ev(kind))).toBe('vorlesung');
    }
    expect(wantedNotebookKind(null)).toBe('vorlesung');
    expect(wantedNotebookKind(undefined)).toBe('vorlesung');
  });
});

describe('pickSessionNotebook', () => {
  it('Termin vom Typ Übung oder Tutorium: Notizbuch „Übung“', () => {
    expect(id(pickSessionNotebook(withEvent, ev('uebung'), [VL, UE]))).toBe('ue');
    expect(id(pickSessionNotebook(withEvent, ev('tutorium'), [UE, VL]))).toBe('ue');
  });

  it('Termin vom Typ Vorlesung oder ein anderer Typ: Notizbuch „Vorlesung“', () => {
    expect(id(pickSessionNotebook(withEvent, ev('vorlesung'), [UE, VL]))).toBe('vl');
    expect(id(pickSessionNotebook(withEvent, ev('pruefung'), [UE, VL]))).toBe('vl');
  });

  it('Session ohne Termin: „Vorlesung“, auch wenn ein Termin übergeben wird', () => {
    expect(id(pickSessionNotebook(noEvent, null, [UE, VL]))).toBe('vl');
    expect(id(pickSessionNotebook(noEvent, ev('uebung'), [UE, VL]))).toBe('vl');
  });

  it('Termin noch unbekannt (nicht geladen oder nicht erreichbar): „Vorlesung“', () => {
    expect(id(pickSessionNotebook(withEvent, undefined, [UE, VL]))).toBe('vl');
  });

  it('fehlt das gewünschte Notizbuch: „Vorlesung“, sonst das älteste', () => {
    expect(id(pickSessionNotebook(withEvent, ev('uebung'), [VL, FREI]))).toBe('vl');
    const frei2 = nb('frei2', 'frei', '2026-10-01T00:00:00Z');
    expect(id(pickSessionNotebook(withEvent, ev('uebung'), [frei2, FREI]))).toBe('frei');
    expect(id(pickSessionNotebook(withEvent, ev('vorlesung'), [UE, FREI]))).toBe('frei');
  });

  it('mehrere gleicher Art: das älteste; gelöschte zählen nicht', () => {
    expect(id(pickSessionNotebook(noEvent, null, [VL, VL_OLD]))).toBe('vl-alt');
    const goneVl = nb('vl-alt', 'vorlesung', '2026-10-01T08:00:00Z', DELETED);
    expect(id(pickSessionNotebook(noEvent, null, [goneVl, VL]))).toBe('vl');
    const goneUe = nb('ue', 'uebung', '2026-11-02T08:00:00Z', DELETED);
    expect(id(pickSessionNotebook(withEvent, ev('uebung'), [goneUe, VL]))).toBe('vl');
  });

  it('ohne Notizbücher: null', () => {
    expect(pickSessionNotebook(withEvent, ev('uebung'), [])).toBeNull();
    expect(
      pickSessionNotebook(noEvent, null, [nb('x', 'vorlesung', '2026-11-01T08:00:00Z', DELETED)]),
    ).toBeNull();
  });
});
