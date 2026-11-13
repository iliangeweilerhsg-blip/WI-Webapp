// T2-22b: gemeinsame Regeln von Worker und Core (VERTRAEGE §20.3, §20.12) gegen die Testfälle in
// `packages/schemas/fixtures/concepts/`: Normieren, Namensgleichheit, Kreisprüfung. Die Annahmen A1–A3
// (`decisions.json`) brauchen die Datenbank und stehen in `test/integration/inbox-fixtures.test.ts`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  findCycle,
  importanceBase,
  nameBase,
  nameKey,
  normName,
  orderEndpoints,
  sameName,
  similarName,
  type Named,
} from '../../src/services/concept-graph.ts';
import { planAccept } from '../../src/services/inbox.ts';

function fixture<T>(name: string): T {
  const url = new URL(`../../../../packages/schemas/fixtures/concepts/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

describe('Normieren (normalize.json)', () => {
  const { cases } = fixture<{ cases: { input: string; norm: string; key: string; base: string }[] }>(
    'normalize.json',
  );
  it('hat Testfälle', () => expect(cases.length).toBeGreaterThanOrEqual(9));
  it.each(cases)('$input', ({ input, norm, key, base }) => {
    expect(normName(input)).toBe(norm);
    expect(nameKey(input)).toBe(key);
    expect(nameBase(input)).toBe(base);
  });

  it('entfernt Steuerzeichen, behält Leerraum als Trenner, ist idempotent', () => {
    expect(normName('A\u0001B\u0002C')).toBe('ABC');
    expect(normName('A\u001fB\u0085C D')).toBe('A B C D');
    expect(normName('﻿BOM')).toBe('BOM');
    // NFC: a + Kombinationszeichen wird ä
    expect(normName('ä')).toBe('ä');
    const once = normName('  Erste ​ Normalform\t(1NF) ');
    expect(normName(once)).toBe(once);
  });

  it('key ohne casefold: ß bleibt ß', () => {
    expect(nameKey('STRASSE')).toBe('strasse');
    expect(nameKey('Straße')).not.toBe(nameKey('Strasse'));
  });
});

describe('Namensgleichheit (name-match.json)', () => {
  const { cases } = fixture<{
    cases: { a: Named; b: Named; namensgleich: boolean; namensaehnlich: boolean }[];
  }>('name-match.json');
  it('hat Testfälle', () => expect(cases.length).toBeGreaterThanOrEqual(7));
  it.each(cases)('$a.name / $b.name', ({ a, b, namensgleich, namensaehnlich }) => {
    expect(sameName(a, b)).toBe(namensgleich);
    expect(sameName(b, a)).toBe(namensgleich);
    expect(similarName(a, b)).toBe(namensaehnlich);
    expect(similarName(b, a)).toBe(namensaehnlich);
  });
});

describe('Kreisprüfung (cycle.json)', () => {
  interface Case {
    name: string;
    edges: { from: string; to: string; confirmed: boolean }[];
    new: { from: string; to: string };
    path: string[] | null;
  }
  const { cases } = fixture<{ cases: Case[] }>('cycle.json');
  it('hat Testfälle', () => expect(cases.length).toBeGreaterThanOrEqual(6));
  it.each(cases)('$name', (c) => {
    // Unbestätigte Kanten zählen nicht: der Aufrufer reicht nur bestätigte herein
    const edges = c.edges.filter((edge) => edge.confirmed);
    expect(findCycle(edges, c.new.from, c.new.to)).toEqual(c.path);
  });

  it('findet den kürzesten Kreis, auch wenn ein längerer zuerst in der Liste steht', () => {
    const edges = [
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
      { from: 'd', to: 'a' },
      { from: 'b', to: 'e' },
      { from: 'e', to: 'a' },
    ];
    expect(findCycle(edges, 'a', 'b')).toEqual(['a', 'b', 'e', 'a']);
  });

  it('endet auch in einem Graphen, der schon einen Kreis hat', () => {
    const edges = [
      { from: 'b', to: 'c' },
      { from: 'c', to: 'b' },
    ];
    expect(findCycle(edges, 'a', 'b')).toBeNull();
  });
});

describe('kleine Regeln', () => {
  it('W-05: importance → importance_base', () => {
    expect([1, 2, 3].map(importanceBase)).toEqual([0.8, 1.0, 1.3]);
  });

  it('symmetrische Arten stehen mit from < to, gerichtete bleiben', () => {
    expect(orderEndpoints('verwandt', 'b', 'a')).toEqual(['a', 'b']);
    expect(orderEndpoints('gegensatz', 'a', 'b')).toEqual(['a', 'b']);
    expect(orderEndpoints('baut_auf', 'b', 'a')).toEqual(['b', 'a']);
  });
});

describe('planAccept: welche Felder zu welcher Art passen (§20.6)', () => {
  const T = '01960a3c-7b10-7c4e-9a01-3f2b5c6d7e32';
  const X = '01960a3c-7b10-7c4e-9a01-3f2b5c6d7e33';
  const item = (kind: string, targetConceptId: string | null = null) => ({ kind, targetConceptId });
  const code = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return (error as { code?: string }).code;
    }
    return null;
  };

  it('concept_new: neu, mit edit, oder zusammenführen mit merge_into', () => {
    expect(planAccept(item('concept_new'), {})).toEqual({ type: 'new', edit: undefined });
    expect(planAccept(item('concept_new'), { edit: { name: 'A' } })).toEqual({
      type: 'new',
      edit: { name: 'A' },
    });
    expect(planAccept(item('concept_new'), { merge_into: T })).toEqual({ type: 'merge', targetId: T });
  });

  it('concept_merge: Ziel des Eintrags, anderes Ziel, oder als neues Konzept', () => {
    expect(planAccept(item('concept_merge', T), {})).toEqual({ type: 'merge', targetId: T });
    expect(planAccept(item('concept_merge', T), { as_new: false })).toEqual({ type: 'merge', targetId: T });
    expect(planAccept(item('concept_merge', T), { merge_into: X })).toEqual({ type: 'merge', targetId: X });
    expect(planAccept(item('concept_merge', T), { as_new: true, edit: { name: 'A' } })).toEqual({
      type: 'new',
      edit: { name: 'A' },
    });
  });

  it('relation: nur relation_kind', () => {
    expect(planAccept(item('relation'), {})).toEqual({ type: 'relation', relationKind: undefined });
    expect(planAccept(item('relation'), { relation_kind: 'verwandt' })).toEqual({
      type: 'relation',
      relationKind: 'verwandt',
    });
  });

  it('card_batch (A4, §21.7): mit und ohne cards', () => {
    expect(planAccept(item('card_batch'), {})).toEqual({ type: 'cards' });
    expect(planAccept(item('card_batch'), { cards: [{ key: 'k1', accept: false }] })).toEqual({
      type: 'cards',
    });
  });

  it.each([
    ['relation', { edit: {} }],
    ['relation', { merge_into: T }],
    ['relation', { as_new: true }],
    ['concept_new', { relation_kind: 'verwandt' as const }],
    ['concept_new', { as_new: true }],
    ['concept_new', { as_new: false }],
    ['concept_new', { merge_into: T, edit: { name: 'A' } }],
    ['concept_merge', { relation_kind: 'verwandt' as const }],
    ['concept_merge', { as_new: true, merge_into: X }],
    ['concept_merge', { edit: { name: 'A' } }],
    // §21.7: `cards` gibt es nur beim Kartenvorschlag, und dort nichts von den Konzept-Feldern
    ['concept_new', { cards: [{ key: 'k1', accept: true }] }],
    ['concept_merge', { cards: [{ key: 'k1', accept: true }] }],
    ['relation', { cards: [{ key: 'k1', accept: true }] }],
    ['card_batch', { edit: { name: 'A' } }],
    ['card_batch', { merge_into: T }],
    ['card_batch', { as_new: true }],
    ['card_batch', { as_new: false }],
    ['card_batch', { relation_kind: 'verwandt' as const }],
  ])('%s mit %j → inbox_action_invalid', (kind, body) => {
    expect(code(() => planAccept(item(kind, T), body))).toBe('inbox_action_invalid');
  });
});
