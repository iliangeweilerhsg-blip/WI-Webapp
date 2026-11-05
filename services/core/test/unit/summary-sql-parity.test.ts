// Gleichheitstest (VERTRAEGE §18.2): Das Referenz-SQL der Fortschrittszusammenfassung steht im Core
// (`summarizeProcessing` in pipeline.ts) und im Worker (`SUMMARY_SQL` in progress.py). Beide müssen
// nach Normalisierung der Parameter und des Leerraums gleich sein. Der Test liest beide Dateien nur.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CORE = new URL('../../src/services/pipeline.ts', import.meta.url);
const WORKER = new URL('../../../worker/src/sg_worker/progress.py', import.meta.url);

/**
 * Parameter vereinheitlichen (`%(sid)s`/`${sessionId}` → `?`), Leerraum zusammenfassen. Der Core benennt die
 * Ergebnisspalte (`END AS state`), der Worker liest sie nach Position: nur dieser Spaltenname wird abgeglichen.
 */
function normalize(sql: string): string {
  return sql
    .replace(/%\((?:sid|type)\)s/g, '?')
    .replace(/\$\{(?:sessionId|type)\}/g, '?')
    .replace(/\s+/g, ' ')
    .replace(/ END AS state FROM u$/, ' END FROM u')
    .trim();
}

function extractCoreSql(source: string): string {
  const m = /tx\.execute<\{ state: JobState \| null \}>\(sql`([\s\S]*?)`\)/.exec(source);
  if (!m) throw new Error('Referenz-SQL im Core nicht gefunden');
  return m[1]!;
}

function extractWorkerSql(source: string): string {
  const m = /^SUMMARY_SQL = """([\s\S]*?)"""/m.exec(source);
  if (!m) throw new Error('SUMMARY_SQL im Worker nicht gefunden');
  return m[1]!;
}

describe('Referenz-SQL Core ↔ Worker', () => {
  it('summarizeProcessing (Core) und SUMMARY_SQL (Worker) sind nach der Normalisierung gleich', () => {
    const core = normalize(extractCoreSql(readFileSync(CORE, 'utf8')));
    const worker = normalize(extractWorkerSql(readFileSync(WORKER, 'utf8')));
    expect(core.length).toBeGreaterThan(200);
    expect(core).toBe(worker);
  });

  it('erkennt eine Abweichung: ein Zeichen im Worker-SQL macht die Texte ungleich', () => {
    const workerSource = readFileSync(WORKER, 'utf8');
    const changed = workerSource.replace("WHEN bool_or(state = 'fehler')", "WHEN bool_or(state = 'fehlex')");
    expect(changed).not.toBe(workerSource);
    expect(normalize(extractCoreSql(readFileSync(CORE, 'utf8')))).not.toBe(
      normalize(extractWorkerSql(changed)),
    );
  });
});
