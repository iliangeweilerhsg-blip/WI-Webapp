// Suche (T2-13): reine Funktionen aus lib/search.ts und das Rendern der Ausschnitte (nie als HTML).
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SearchResponseSchema, type SearchHit, type SearchResponse } from '@sg/shared';
import {
  GROUP_LIMIT,
  degradedLine,
  flatHits,
  formatMmSs,
  groupHits,
  hitHref,
  parseJumpMs,
  sessionLabel,
  slideLabel,
  type SlideHit,
  type SpokenHit,
} from '../src/lib/search.ts';
import { Snippet } from '../src/components/search/Snippet.tsx';
import { SEARCH_FIXTURE, fixtureSearch } from './fake-core.ts';

const MOD = { id: '0190f6a2-0000-7000-8000-0000000000a3', name: 'Datenbanksysteme', short_name: 'DBS' };
const id = (n: number) => `0190f6a2-0000-7000-8000-${String(9000 + n).padStart(12, '0')}`;

function slide(n: number, score: number, extra: Partial<SlideHit> = {}): SlideHit {
  return {
    kind: 'slide',
    chunk_id: id(n),
    score,
    module: MOD,
    snippet: [{ text: `Folie ${n}`, hit: false }],
    deck_id: id(500),
    deck_title: 'VL 7 Normalisierung',
    slide_index: n,
    slide_title: `Titel ${n}`,
    ...extra,
  };
}
function spoken(n: number, score: number, extra: Partial<SpokenHit> = {}): SpokenHit {
  return {
    kind: 'transcript',
    chunk_id: id(100 + n),
    score,
    module: MOD,
    snippet: [{ text: `Gesagt ${n}`, hit: false }],
    session_id: id(600),
    session_number: 7,
    session_title: 'Normalisierung',
    session_started_at: '2026-11-03T07:15:00Z',
    t_ms: 61_000 * n,
    t_end_ms: 61_000 * n + 30_000,
    ...extra,
  };
}

describe('groupHits', () => {
  it('trennt Folien und Gesagtes, sortiert nach score und begrenzt jede Gruppe auf 8', () => {
    const hits: SearchHit[] = [];
    for (let n = 1; n <= 12; n++) hits.push(slide(n, n / 100));
    for (let n = 1; n <= 10; n++) hits.push(spoken(n, n / 200));
    const groups = groupHits(hits);
    expect(GROUP_LIMIT).toBe(8);
    expect(groups.slides).toHaveLength(8);
    expect(groups.spoken).toHaveLength(8);
    // absteigend nach score: die zwölf Folien haben 0,12 … 0,01, es bleiben 12 … 5
    expect(groups.slides.map((h) => h.slide_index)).toEqual([12, 11, 10, 9, 8, 7, 6, 5]);
    expect(groups.spoken.map((h) => h.t_ms / 61_000)).toEqual([10, 9, 8, 7, 6, 5, 4, 3]);
  });

  it('behält bei gleichem score die Reihenfolge der Antwort', () => {
    const groups = groupHits([slide(1, 0.5), slide(2, 0.5), slide(3, 0.5)]);
    expect(groups.slides.map((h) => h.slide_index)).toEqual([1, 2, 3]);
  });

  it('Anzeigereihenfolge ist fest: erst Folien, dann Gesagtes, egal wie die Antwort sortiert war', () => {
    const groups = groupHits([spoken(1, 0.9), slide(1, 0.1), spoken(2, 0.8), slide(2, 0.2)]);
    expect(flatHits(groups).map((h) => h.kind)).toEqual(['slide', 'slide', 'transcript', 'transcript']);
  });

  it('leere Gruppen bleiben leer', () => {
    expect(groupHits([])).toEqual({ slides: [], spoken: [] });
    expect(groupHits([slide(1, 1)]).spoken).toEqual([]);
  });
});

describe('Ziele (§19.7)', () => {
  it('Folie führt in die PDF-Anzeige, Seite 1 ohne Parameter', () => {
    expect(hitHref(slide(14, 1))).toBe(`/dokument?typ=folien&id=${id(500)}&seite=14`);
    expect(hitHref(slide(1, 1))).toBe(`/dokument?typ=folien&id=${id(500)}`);
  });

  it('Gesagtes führt in den Rückblick mit t in ms', () => {
    expect(hitHref(spoken(1, 1, { t_ms: 2_512_000 }))).toBe(`/rueckblick?id=${id(600)}&t=2512000`);
    expect(hitHref(spoken(1, 1, { t_ms: 0 }))).toBe(`/rueckblick?id=${id(600)}&t=0`);
  });

  it('t des Rückblicks: nur ganze Zahlen', () => {
    expect(parseJumpMs('2512000')).toBe(2_512_000);
    expect(parseJumpMs('0')).toBe(0);
    for (const bad of [null, '', '-5', '1.5', 'abc', '12 ', '1e3']) expect(parseJumpMs(bad)).toBeNull();
  });
});

describe('Anzeige', () => {
  it('mm:ss aus Millisekunden', () => {
    expect(formatMmSs(0)).toBe('00:00');
    expect(formatMmSs(999)).toBe('00:00');
    expect(formatMmSs(5_000)).toBe('00:05');
    expect(formatMmSs(2_512_000)).toBe('41:52');
    expect(formatMmSs(3_599_000)).toBe('59:59');
    expect(formatMmSs(5_000_000)).toBe('83:20');
    expect(formatMmSs(-10)).toBe('00:00');
  });

  it('Gesagtes: „VL n · Titel“, sonst Nummer, Titel oder Datum', () => {
    expect(sessionLabel(spoken(1, 1))).toBe('VL 7 · Normalisierung');
    expect(sessionLabel(spoken(1, 1, { session_title: null }))).toBe('VL 7');
    expect(sessionLabel(spoken(1, 1, { session_number: null }))).toBe('Normalisierung');
    const dated = sessionLabel(spoken(1, 1, { session_number: null, session_title: null }));
    expect(dated).toMatch(/2026/);
    expect(
      sessionLabel(spoken(1, 1, { session_number: null, session_title: ' ', session_started_at: null })),
    ).toBe('Vorlesung');
  });

  it('Folie: Foliensatz · Folie n · Titel', () => {
    expect(slideLabel(slide(14, 1, { slide_title: '3NF' }))).toBe('VL 7 Normalisierung · Folie 14 · 3NF');
    expect(slideLabel(slide(3, 1, { slide_title: null }))).toBe('VL 7 Normalisierung · Folie 3');
  });

  it('Zeile bei reiner Wortsuche', () => {
    const base = fixtureSearch('normalform', 50, SEARCH_FIXTURE);
    expect(degradedLine(base)).toBeNull();
    const notReady: SearchResponse = { ...base, mode: 'text', degraded: 'embedder_not_ready' };
    expect(degradedLine(notReady)).toBe('Nur Wortsuche · Bedeutungssuche startet noch');
    const gone: SearchResponse = { ...base, mode: 'text', degraded: 'embedder_unavailable' };
    expect(degradedLine(gone)).toBe('Nur Wortsuche · Bedeutungssuche nicht verfügbar');
    // mode = text ohne degraded (keine Wörter ≥ 2 Zeichen): keine Zeile
    expect(degradedLine({ ...base, mode: 'text', degraded: null })).toBeNull();
  });
});

describe('Snippet', () => {
  it('rendert Treffer als <mark>, den Rest als Text', () => {
    const { container } = render(
      <p>
        <Snippet
          parts={[
            { text: 'Die dritte ', hit: false },
            { text: 'Normalform', hit: true },
            { text: ' verbietet', hit: false },
          ]}
        />
      </p>,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent('Normalform');
    expect(container).toHaveTextContent('Die dritte Normalform verbietet');
  });

  it('interpretiert nie HTML: Tags und Entitäten bleiben sichtbarer Text', () => {
    const { container } = render(
      <p>
        <Snippet
          parts={[
            { text: '<img src=x onerror=alert(1)> &amp; ', hit: false },
            { text: '<b>fett</b>', hit: true },
          ]}
        />
      </p>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelectorAll('mark')).toHaveLength(1);
    expect(container.textContent).toBe('<img src=x onerror=alert(1)> &amp; <b>fett</b>');
  });
});

describe('Beispieldaten des Fake-Core', () => {
  it('entsprechen dem Schema und den Regeln aus §19.6', () => {
    const all = fixtureSearch('normalform', 50, SEARCH_FIXTURE);
    expect(SearchResponseSchema.safeParse(all).success).toBe(true);
    expect(all.hits.length).toBe(4);
    expect(all.hits.every((h) => h.snippet.some((p) => p.hit))).toBe(true);
    // Präfix nur am letzten Wort und nur ohne Leerzeichen am Ende
    expect(fixtureSearch('normalf', 50, SEARCH_FIXTURE).hits.length).toBe(4);
    expect(fixtureSearch('normalf ', 50, SEARCH_FIXTURE).hits.length).toBe(0);
    // Filter
    expect(
      fixtureSearch('normalform typ:folie', 50, SEARCH_FIXTURE).hits.every((h) => h.kind === 'slide'),
    ).toBe(true);
    const unknown = fixtureSearch('normalform fach:XYZ', 50, SEARCH_FIXTURE);
    expect(unknown.hits).toEqual([]);
    expect(unknown.filters.unresolved).toEqual(['fach:XYZ']);
    expect(fixtureSearch('normalform fach:dbs', 50, SEARCH_FIXTURE).hits.length).toBe(4);
    expect(fixtureSearch('normalform', 2, SEARCH_FIXTURE).hits.length).toBe(2);
  });
});
