import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.ts';
import {
  addScores,
  formatPercent,
  parseAlignArgs,
  parseGolden,
  scoreAlignment,
  type Span,
} from '../src/messen-ausrichtung.ts';
import {
  formatDuration,
  formatPipelineReport,
  parseJobRows,
  parsePipelineArgs,
  pipelineQuery,
  summarizePipeline,
  type JobRow,
} from '../src/messen-pipeline.ts';
import { messenCommand, type MessenDeps } from '../src/messen.ts';

const S1 = '11111111-1111-4111-8111-111111111111';
const T0 = Date.UTC(2026, 10, 10, 14, 0, 0);
const min = (n: number): number => n * 60_000;

let counter = 0;
function job(type: JobRow['type'], over: Partial<JobRow> = {}): JobRow {
  counter += 1;
  return {
    sessionId: S1,
    sessionLabel: 'M1 · Nr. 4 · 2026-11-10',
    jobId: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    type,
    state: 'fertig',
    createdMs: T0,
    updatedMs: T0 + min(1),
    runAfterMs: null,
    depEndMs: null,
    jobDurationMs: null,
    ...over,
  };
}

describe('parsePipelineArgs', () => {
  it('Standard ist --letzte 10', () => {
    expect(parsePipelineArgs([])).toEqual({ ok: true, last: 10 });
  });
  it('nimmt --session und --letzte, aber nicht beide', () => {
    expect(parsePipelineArgs(['--letzte', '3'])).toEqual({ ok: true, last: 3 });
    expect(parsePipelineArgs(['--session', S1])).toEqual({ ok: true, sessionId: S1, last: 10 });
    expect(parsePipelineArgs(['--session', S1, '--letzte', '3']).ok).toBe(false);
  });
  it('lehnt schlechte Werte ab', () => {
    expect(parsePipelineArgs(['--session', 'x']).ok).toBe(false);
    expect(parsePipelineArgs(['--session']).ok).toBe(false);
    expect(parsePipelineArgs(['--letzte', '0']).ok).toBe(false);
    expect(parsePipelineArgs(['--letzte', '1e3']).ok).toBe(false);
    expect(parsePipelineArgs(['--letzte', '201']).ok).toBe(false);
    expect(parsePipelineArgs(['--foo']).ok).toBe(false);
  });
});

describe('pipelineQuery', () => {
  it('liest nur, in einer schreibgeschützten Transaktion', () => {
    for (const args of [{ last: 5 }, { last: 5, sessionId: S1 }]) {
      const { sql } = pipelineQuery(args);
      expect(sql.startsWith('BEGIN READ ONLY;')).toBe(true);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
    }
  });
  it('reicht die Session-ID als Variable weiter, nicht im Text', () => {
    const { sql, vars } = pipelineQuery({ last: 5, sessionId: S1 });
    expect(vars).toEqual({ sid: S1 });
    expect(sql).toContain(":'sid'");
    expect(sql).not.toContain(S1);
  });
  it('setzt LIMIT als geprüfte Zahl', () => {
    expect(pipelineQuery({ last: 7 }).sql).toContain('LIMIT 7');
  });
});

describe('parseJobRows', () => {
  it('liest Zeilen und leere Felder als null', () => {
    const rows = parseJobRows([[S1, 'M1', 'j1', 'transcribe', 'fertig', '1000', '2000', '', '1500', '800']]);
    expect(rows[0]).toMatchObject({
      createdMs: 1000,
      updatedMs: 2000,
      runAfterMs: null,
      depEndMs: 1500,
      jobDurationMs: 800,
    });
  });
  it('meldet falsche Spaltenzahl', () => {
    expect(() => parseJobRows([['a']])).toThrow(/Spalten/);
  });
});

describe('summarizePipeline', () => {
  it('trennt Wartezeit von Laufzeit und rechnet die Gesamtzeit', () => {
    const fin = job('audio.finalize', { updatedMs: T0 + min(1), jobDurationMs: 40_000 });
    const tr = job('transcribe', {
      createdMs: T0,
      depEndMs: T0 + min(1),
      updatedMs: T0 + min(11),
      jobDurationMs: min(9),
    });
    const al = job('align.log', { depEndMs: T0 + min(1), updatedMs: T0 + min(12), jobDurationMs: 5000 });
    const [report] = summarizePipeline([fin, tr, al]);
    expect(report?.complete).toBe(true);
    expect(report?.totalMs).toBe(min(12));
    expect(report?.withinGoal).toBe(true);
    const transcribe = report?.steps.find((s) => s.type === 'transcribe');
    expect(transcribe).toMatchObject({ durationMs: min(10), runMs: min(9), waitMs: min(1) });
    const finalize = report?.steps.find((s) => s.type === 'audio.finalize');
    expect(finalize).toMatchObject({ durationMs: min(1), runMs: 40_000, waitMs: 20_000 });
  });

  it('ohne Laufzeitmeldung bleibt die Wartezeit offen', () => {
    const ex = job('concepts.extract', { depEndMs: T0 + min(2), updatedMs: T0 + min(5) });
    const [report] = summarizePipeline([ex]);
    expect(report?.steps[0]).toMatchObject({ durationMs: min(3), runMs: null, waitMs: null });
    expect(report?.stepsWithoutRunTime).toBe(1);
  });

  it('verfehlt das Ziel bei mehr als 45 min', () => {
    const sw = job('summary.write', { updatedMs: T0 + min(46) });
    expect(summarizePipeline([sw])[0]?.withinGoal).toBe(false);
  });

  it('Kette ist nicht fertig, solange ein Schritt nicht fertig ist', () => {
    const tr = job('transcribe', { state: 'laeuft' });
    const al = job('align.log');
    const [report] = summarizePipeline([tr, al]);
    expect(report?.complete).toBe(false);
    expect(report?.totalMs).toBeNull();
    expect(report?.withinGoal).toBeNull();
    expect(formatPipelineReport([report!]).join('\n')).toContain('noch nicht fertig');
  });

  it('nimmt je Typ nur den neuesten Job (erneute Verarbeitung) und summiert audio.finalize der Welle', () => {
    const oldTr = job('transcribe', { createdMs: T0 - min(600), updatedMs: T0 - min(590) });
    const oldFin = job('audio.finalize', { createdMs: T0 - min(600), updatedMs: T0 - min(599) });
    const fin1 = job('audio.finalize', { jobDurationMs: 10_000 });
    const fin2 = job('audio.finalize', { jobDurationMs: 20_000 });
    const tr = job('transcribe', { updatedMs: T0 + min(5) });
    const [report] = summarizePipeline([oldTr, oldFin, fin1, fin2, tr]);
    const finalize = report?.steps.find((s) => s.type === 'audio.finalize');
    expect(finalize).toMatchObject({ jobs: 2, runMs: 30_000 });
    expect(report?.startMs).toBe(T0);
    expect(report?.totalMs).toBe(min(5));
  });

  it('keine Gesamtzeit, wenn die Schritte aus verschiedenen Läufen stammen (erneut ab concepts.extract)', () => {
    const tr = job('transcribe', { updatedMs: T0 + min(5) });
    const ex = job('concepts.extract', { createdMs: T0 + min(600), updatedMs: T0 + min(603) });
    const [report] = summarizePipeline([tr, ex]);
    expect(report?.complete).toBe(true);
    expect(report?.mixedRuns).toBe(true);
    expect(report?.totalMs).toBeNull();
    expect(report?.withinGoal).toBeNull();
    expect(formatPipelineReport([report!]).join('\n')).toContain('nicht bestimmbar');
  });

  it('trennt Sessions', () => {
    const other = job('summary.write', { sessionId: '22222222-2222-4222-8222-222222222222' });
    expect(summarizePipeline([job('transcribe'), other])).toHaveLength(2);
  });
});

describe('formatDuration', () => {
  it('formatiert Sekunden, Minuten und Stunden', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(59_400)).toBe('59 s');
    expect(formatDuration(65_000)).toBe('1 min 05 s');
    expect(formatDuration(min(62))).toBe('1 h 02 min');
  });
});

describe('formatPipelineReport', () => {
  it('zeigt Tabelle, Gesamtzeit und Ziel', () => {
    const text = formatPipelineReport(
      summarizePipeline([job('transcribe', { updatedMs: T0 + min(10), jobDurationMs: min(9) })]),
    ).join('\n');
    expect(text).toContain('Schritt');
    expect(text).toContain('transcribe');
    expect(text).toContain('Gesamt: 10 min 00 s (Ziel ≤ 45 min: erreicht)');
  });
  it('meldet leere Ergebnisse', () => {
    expect(formatPipelineReport([])).toEqual(['Keine Jobs der Verarbeitungskette gefunden.']);
  });
});

describe('parseAlignArgs', () => {
  it('braucht eine Datei, Quelle ist log', () => {
    expect(parseAlignArgs([]).ok).toBe(false);
    expect(parseAlignArgs(['g.json'])).toEqual({ ok: true, file: 'g.json', source: 'log' });
    expect(parseAlignArgs(['g.json', '--quelle', 'ausrichtung'])).toEqual({
      ok: true,
      file: 'g.json',
      source: 'ausrichtung',
    });
    expect(parseAlignArgs(['g.json', '--quelle', 'x']).ok).toBe(false);
    expect(parseAlignArgs(['a', 'b']).ok).toBe(false);
    expect(parseAlignArgs(['--x']).ok).toBe(false);
  });
});

const golden = (segments: unknown, id: string = S1): string =>
  JSON.stringify({ version: 1, sessions: [{ session_id: id, segments }] });

describe('parseGolden', () => {
  const seg = (slide: number, a: number, b: number) => ({ slide_index: slide, start_ms: a, end_ms: b });
  it('liest ein gültiges Beispiel und sortiert', () => {
    const r = parseGolden(golden([seg(2, 1000, 2000), seg(1, 0, 1000)]));
    expect(r).toEqual({
      ok: true,
      sessions: [
        {
          sessionId: S1,
          spans: [
            { slide: 1, startMs: 0, endMs: 1000 },
            { slide: 2, startMs: 1000, endMs: 2000 },
          ],
        },
      ],
    });
  });
  it('lehnt Fehler mit Pfad ab', () => {
    const bad = (text: string) => {
      const r = parseGolden(text);
      return r.ok ? '' : r.message;
    };
    expect(bad('{')).toMatch(/JSON/);
    expect(bad('[]')).toMatch(/Objekt/);
    expect(bad('{"version":2,"sessions":[]}')).toMatch(/version/);
    expect(bad('{"version":1,"sessions":[]}')).toMatch(/sessions/);
    expect(bad(golden([], S1))).toMatch(/segments/);
    expect(bad(golden([seg(1, 0, 10)], 'ABC'))).toMatch(/session_id/);
    expect(bad(golden([seg(0, 0, 10)]))).toMatch(/segments\[0\]\.slide_index/);
    expect(bad(golden([seg(1, -1, 10)]))).toMatch(/start_ms/);
    expect(bad(golden([seg(1, 10, 10)]))).toMatch(/end_ms/);
    expect(bad(golden([{ slide_index: 1, start_ms: 0.5, end_ms: 10 }]))).toMatch(/start_ms/);
    expect(bad(golden([seg(1, 0, 100), seg(2, 50, 150)]))).toMatch(/überlappen/);
    expect(
      bad(
        JSON.stringify({
          version: 1,
          sessions: [
            { session_id: S1, segments: [seg(1, 0, 1)] },
            { session_id: S1, segments: [seg(1, 0, 1)] },
          ],
        }),
      ),
    ).toMatch(/doppelt/);
  });
});

describe('scoreAlignment', () => {
  const sp = (slide: number, startMs: number, endMs: number): Span => ({ slide, startMs, endMs });
  it('alles richtig', () => {
    const s = scoreAlignment([sp(1, 0, 100), sp(2, 100, 200)], [sp(1, 0, 100), sp(2, 100, 200)]);
    expect(s).toEqual({ goldenMs: 200, correctMs: 200, wrongMs: 0, missingMs: 0 });
  });
  it('Grenze verschoben: Teil richtig, Teil falsch', () => {
    const s = scoreAlignment([sp(1, 0, 100), sp(2, 100, 200)], [sp(1, 0, 120), sp(2, 120, 200)]);
    expect(s).toEqual({ goldenMs: 200, correctMs: 180, wrongMs: 20, missingMs: 0 });
  });
  it('Lücke zählt als ohne Zuordnung', () => {
    const s = scoreAlignment([sp(1, 0, 100)], [sp(1, 0, 40)]);
    expect(s).toEqual({ goldenMs: 100, correctMs: 40, wrongMs: 0, missingMs: 60 });
  });
  it('gemessene Segmente über den goldenen Bereich hinaus werden abgeschnitten', () => {
    const s = scoreAlignment([sp(3, 50, 100)], [sp(3, 0, 500)]);
    expect(s).toEqual({ goldenMs: 50, correctMs: 50, wrongMs: 0, missingMs: 0 });
  });
  it('überlappende gemessene Segmente zählen die Zeit nur einmal', () => {
    const s = scoreAlignment([sp(1, 0, 100)], [sp(1, 0, 80), sp(1, 40, 100)]);
    expect(s.correctMs).toBe(100);
  });
  it('addiert', () => {
    const a = { goldenMs: 1, correctMs: 1, wrongMs: 0, missingMs: 0 };
    expect(addScores(a, a)).toEqual({ goldenMs: 2, correctMs: 2, wrongMs: 0, missingMs: 0 });
  });
  it('formatiert Prozent mit Komma', () => {
    expect(formatPercent(913, 1000)).toBe('91,3 %');
    expect(formatPercent(0, 0)).toBe('–');
  });
});

describe('messenCommand', () => {
  const cfg = resolveConfig({}, '/home/x', '/repo');
  function makeDeps(
    rows: string[][] | ((sql: string, vars?: Record<string, string>) => string[][]),
    file = '',
  ) {
    const out: string[] = [];
    const err: string[] = [];
    const queries: Array<{ sql: string; vars?: Record<string, string> }> = [];
    const deps: MessenDeps = {
      openPg: async () => ({
        query: async (sql, vars) => {
          queries.push({ sql, ...(vars ? { vars } : {}) });
          return typeof rows === 'function' ? rows(sql, vars) : rows;
        },
      }),
      readGolden: () => file,
      io: { out: (l) => out.push(l), err: (l) => err.push(l) },
    };
    return { deps, out, err, queries };
  }

  it('verlangt einen Unterbefehl', async () => {
    const { deps, err } = makeDeps([]);
    expect(await messenCommand(cfg, [], deps)).toBe(1);
    expect(err.join('\n')).toContain('Unterbefehl fehlt');
    expect(await messenCommand(cfg, ['x'], deps)).toBe(1);
  });

  it('pipeline: gibt den Bericht aus', async () => {
    const row = [
      S1,
      'M1 · Nr. 1 · 2026-11-10',
      'j1',
      'summary.write',
      'fertig',
      String(T0),
      String(T0 + min(3)),
      '',
      '',
      '',
    ];
    const { deps, out, queries } = makeDeps([row]);
    expect(await messenCommand(cfg, ['pipeline', '--letzte', '2'], deps)).toBe(0);
    expect(out.join('\n')).toContain('Gesamt: 3 min 00 s');
    expect(queries).toHaveLength(1);
  });

  it('pipeline: unbekannte Session ist ein Fehler', async () => {
    const { deps, out } = makeDeps([]);
    expect(await messenCommand(cfg, ['pipeline', '--session', S1], deps)).toBe(1);
    expect(out.join('\n')).toContain('Keine Jobs');
  });

  it('pipeline: Datenbankfehler wird gemeldet', async () => {
    const { deps, err } = makeDeps(() => {
      throw new Error('Die Datenbank ist nicht erreichbar');
    });
    expect(await messenCommand(cfg, ['pipeline'], deps)).toBe(1);
    expect(err.join('\n')).toContain('nicht erreichbar');
  });

  it('ausrichtung: wertet gegen die Segmente aus', async () => {
    const text = golden([
      { slide_index: 1, start_ms: 0, end_ms: 100 },
      { slide_index: 2, start_ms: 100, end_ms: 200 },
    ]);
    const { deps, out, queries } = makeDeps(
      [
        ['1', '0', '100'],
        ['2', '100', '190'],
      ],
      text,
    );
    expect(await messenCommand(cfg, ['ausrichtung', 'g.json'], deps)).toBe(0);
    const joined = out.join('\n');
    expect(joined).toContain('Gesamt (nach Zeit gewichtet): 95,0 % richtig (Ziel ≥ 85 %: erreicht)');
    expect(queries[0]?.vars).toEqual({ sid: S1, src: 'log' });
  });

  it('ausrichtung: ohne Segmente und bei ungültiger Datei Fehler', async () => {
    const text = golden([{ slide_index: 1, start_ms: 0, end_ms: 100 }]);
    const none = makeDeps([], text);
    expect(await messenCommand(cfg, ['ausrichtung', 'g.json'], none.deps)).toBe(1);
    expect(none.out.join('\n')).toContain('keine gemessenen Segmente');
    const invalid = makeDeps([], '{}');
    expect(await messenCommand(cfg, ['ausrichtung', 'g.json'], invalid.deps)).toBe(1);
    expect(invalid.err.join('\n')).toContain('Goldener Datensatz ungültig');
    expect(await messenCommand(cfg, ['ausrichtung'], invalid.deps)).toBe(1);
  });
});
