// `sg messen pipeline`: Laufzeit der Verarbeitung je Session aus der Tabelle `job` (Abnahme Phase 2: Pipeline ≤ 45 min,
// docs/spezifikation/10-UMSETZUNG.md §3). Nur lesend.
//
// Die Tabelle `job` hält keinen Startzeitpunkt (`locked_at` wird beim Abschluss gelöscht). Darum gilt:
// - Ende eines Schritts = `updated_at` des Jobs im Zustand `fertig`.
// - Bereit = späteres von `created_at`, `run_after` und Ende der Vorgänger (`depends_on`).
// - Dauer = Ende − bereit. Sie enthält die Zeit, die der Job auf den Worker wartete.
// - Laufzeit = `result.job_duration_ms`, das nur `audio.finalize`, `transcribe` und `align.log` melden (VERTRAEGE §18).
//   Nur bei diesen Schritten lässt sich die Wartezeit abtrennen (Dauer − Laufzeit).
// - Gesamtzeit = Ende des letzten Schritts − Anlegen des ersten Jobs.
import type { PgAccess } from './pg.ts';

export const PIPELINE_TYPES = [
  'audio.finalize',
  'transcribe',
  'align.log',
  'concepts.extract',
  'concepts.resolve',
  'summary.write',
] as const;
export type PipelineType = (typeof PIPELINE_TYPES)[number];

/** Ziel der Abnahme: ganze Kette je Session */
export const PIPELINE_GOAL_MS = 45 * 60 * 1000;
export const DEFAULT_LAST = 10;
export const MAX_LAST = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const PIPELINE_USAGE =
  'Aufruf: messen pipeline [--session <id> | --letzte <n>] (Standard: --letzte 10)';

export type PipelineArgs = { ok: true; sessionId?: string; last: number } | { ok: false; message: string };

export function parsePipelineArgs(rest: string[]): PipelineArgs {
  let sessionId: string | undefined;
  let last: number | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] as string;
    const value = rest[i + 1];
    if (arg === '--session') {
      if (!value || !UUID_RE.test(value)) {
        return { ok: false, message: '--session erwartet die ID einer Session (UUID, Kleinbuchstaben).' };
      }
      sessionId = value;
      i += 1;
    } else if (arg === '--letzte') {
      const n = Number(value);
      if (!value || !/^\d+$/.test(value) || n < 1 || n > MAX_LAST) {
        return { ok: false, message: `--letzte erwartet eine ganze Zahl von 1 bis ${MAX_LAST}.` };
      }
      last = n;
      i += 1;
    } else {
      return { ok: false, message: `Unbekannte Option "${arg}". Erlaubt: --session, --letzte.` };
    }
  }
  if (sessionId !== undefined && last !== undefined) {
    return { ok: false, message: '--session und --letzte schließen sich aus.' };
  }
  return { ok: true, ...(sessionId ? { sessionId } : {}), last: last ?? DEFAULT_LAST };
}

export interface JobRow {
  sessionId: string;
  /** Anzeigename: Modul, Nummer, Datum (UTC) */
  sessionLabel: string;
  jobId: string;
  type: PipelineType;
  state: string;
  createdMs: number;
  updatedMs: number;
  runAfterMs: number | null;
  /** Spätestes Ende der fertigen Vorgänger */
  depEndMs: number | null;
  jobDurationMs: number | null;
}

const epoch = (col: string): string => `(extract(epoch FROM ${col}) * 1000)::bigint`;
const TYPE_LIST = PIPELINE_TYPES.map((t) => `'${t}'`).join(', ');

/**
 * Liest die Jobs der Kette. Nur `SELECT` in einer schreibgeschützten Transaktion. `--session` geht als psql-Variable
 * `:'sid'` hinein (gequotet), `--letzte` ist eine geprüfte ganze Zahl.
 */
export function pipelineQuery(args: { sessionId?: string; last: number }): {
  sql: string;
  vars: Record<string, string>;
} {
  const pick =
    args.sessionId !== undefined
      ? `s.id = :'sid'::uuid`
      : `s.id IN (SELECT s2.id FROM session s2
           WHERE s2.deleted_at IS NULL
             AND EXISTS (SELECT 1 FROM job jj WHERE jj.session_id = s2.id AND jj.deleted_at IS NULL AND jj.type IN (${TYPE_LIST}))
           ORDER BY s2.started_at DESC, s2.id DESC LIMIT ${Math.trunc(args.last)})`;
  const sql = `BEGIN READ ONLY;
SELECT s.id,
       coalesce(m.short_name, m.name, '?') || ' · Nr. ' || coalesce(s.number::text, '?') || ' · '
         || to_char(s.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
       j.id, j.type, j.state,
       ${epoch('j.created_at')}, ${epoch('j.updated_at')}, ${epoch('j.run_after')},
       ${epoch(`(SELECT max(d.updated_at) FROM job d WHERE d.id = ANY(j.depends_on) AND d.state = 'fertig')`)},
       j.result->>'job_duration_ms'
FROM job j
JOIN session s ON s.id = j.session_id
LEFT JOIN module m ON m.id = s.module_id
WHERE j.deleted_at IS NULL AND s.deleted_at IS NULL AND j.type IN (${TYPE_LIST}) AND ${pick}
ORDER BY s.started_at DESC, s.id, j.created_at, j.id;
COMMIT;
`;
  return { sql, vars: args.sessionId !== undefined ? { sid: args.sessionId } : {} };
}

const num = (value: string | undefined): number | null => {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function parseJobRows(rows: string[][]): JobRow[] {
  const result: JobRow[] = [];
  for (const r of rows) {
    if (r.length !== 10)
      throw new Error(`Unerwartete Zeile aus der Datenbank (${r.length} statt 10 Spalten).`);
    const created = num(r[5]);
    const updated = num(r[6]);
    if (created === null || updated === null) throw new Error('Job ohne Zeitstempel in der Datenbank.');
    result.push({
      sessionId: r[0] as string,
      sessionLabel: r[1] as string,
      jobId: r[2] as string,
      type: r[3] as PipelineType,
      state: r[4] as string,
      createdMs: created,
      updatedMs: updated,
      runAfterMs: num(r[7]),
      depEndMs: num(r[8]),
      jobDurationMs: num(r[9]),
    });
  }
  return result;
}

export interface StepReport {
  type: PipelineType;
  /** Anzahl Jobs (mehrere bei `audio.finalize` mit mehreren Aufnahmen) */
  jobs: number;
  state: string;
  /** Dauer inkl. Warten; nur bei `fertig` */
  durationMs: number | null;
  /** Laufzeit laut Worker; `null`, wenn nicht gemeldet */
  runMs: number | null;
  /** Dauer − Laufzeit; nur wenn die Laufzeit bekannt ist */
  waitMs: number | null;
  endMs: number | null;
}

export interface SessionReport {
  sessionId: string;
  label: string;
  steps: StepReport[];
  /** Alle Schritte `fertig` */
  complete: boolean;
  startMs: number;
  endMs: number | null;
  totalMs: number | null;
  /** Summe der bekannten Wartezeiten */
  knownWaitMs: number;
  /** Schritte, bei denen sich die Wartezeit nicht abtrennen lässt */
  stepsWithoutRunTime: number;
  /** `null`, solange die Kette nicht komplett ist */
  withinGoal: boolean | null;
}

const STATE_RANK = ['fertig', 'wartet', 'laeuft', 'abgebrochen', 'fehler'];
const worstState = (states: string[]): string =>
  states.reduce((a, b) => (STATE_RANK.indexOf(b) > STATE_RANK.indexOf(a) ? b : a));

/** Gleicher Lauf wie der neueste `transcribe`: `ensurePipelineJobs` legt die Jobs einer Welle in einer Transaktion an */
const WAVE_TOLERANCE_MS = 5000;

function chooseJobs(jobs: JobRow[]): JobRow[] {
  const newest = (type: PipelineType): JobRow | undefined =>
    jobs
      .filter((j) => j.type === type)
      .sort((a, b) => b.createdMs - a.createdMs || (a.jobId < b.jobId ? 1 : -1))[0];
  const chosen: JobRow[] = [];
  const transcribe = newest('transcribe');
  for (const type of PIPELINE_TYPES) {
    if (type === 'audio.finalize') {
      const all = jobs.filter((j) => j.type === type);
      chosen.push(
        ...(transcribe ? all.filter((j) => j.createdMs >= transcribe.createdMs - WAVE_TOLERANCE_MS) : all),
      );
    } else {
      const job = newest(type);
      if (job) chosen.push(job);
    }
  }
  return chosen;
}

export function summarizePipeline(rows: JobRow[]): SessionReport[] {
  const bySession = new Map<string, JobRow[]>();
  for (const row of rows) {
    const list = bySession.get(row.sessionId);
    if (list) list.push(row);
    else bySession.set(row.sessionId, [row]);
  }
  const reports: SessionReport[] = [];
  for (const [sessionId, all] of bySession) {
    const chosen = chooseJobs(all);
    if (chosen.length === 0) continue;
    const steps: StepReport[] = [];
    for (const type of PIPELINE_TYPES) {
      const jobs = chosen.filter((j) => j.type === type);
      if (jobs.length === 0) continue;
      const state = worstState(jobs.map((j) => j.state));
      const done = state === 'fertig';
      const readyMs = Math.min(...jobs.map((j) => Math.max(j.createdMs, j.runAfterMs ?? 0, j.depEndMs ?? 0)));
      const endMs = done ? Math.max(...jobs.map((j) => j.updatedMs)) : null;
      const durationMs = endMs === null ? null : Math.max(0, endMs - readyMs);
      const runMs = jobs.every((j) => j.jobDurationMs !== null)
        ? jobs.reduce((sum, j) => sum + (j.jobDurationMs ?? 0), 0)
        : null;
      const waitMs = durationMs !== null && runMs !== null ? Math.max(0, durationMs - runMs) : null;
      steps.push({ type, jobs: jobs.length, state, durationMs, runMs: done ? runMs : null, waitMs, endMs });
    }
    const complete = steps.every((s) => s.state === 'fertig');
    const startMs = Math.min(...chosen.map((j) => j.createdMs));
    const endMs = complete ? Math.max(...steps.map((s) => s.endMs ?? 0)) : null;
    const totalMs = endMs === null ? null : Math.max(0, endMs - startMs);
    reports.push({
      sessionId,
      label: all[0]?.sessionLabel ?? sessionId,
      steps,
      complete,
      startMs,
      endMs,
      totalMs,
      knownWaitMs: steps.reduce((sum, s) => sum + (s.waitMs ?? 0), 0),
      stepsWithoutRunTime: steps.filter((s) => s.state === 'fertig' && s.runMs === null).length,
      withinGoal: totalMs === null ? null : totalMs <= PIPELINE_GOAL_MS,
    });
  }
  return reports;
}

/** `45 s`, `3 min 05 s`, `1 h 02 min` */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min ${String(total % 60).padStart(2, '0')} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

const dash = (ms: number | null, approx = false): string =>
  ms === null ? '–' : `${approx ? '~' : ''}${formatDuration(ms)}`;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function formatPipelineReport(reports: SessionReport[]): string[] {
  if (reports.length === 0) return ['Keine Jobs der Verarbeitungskette gefunden.'];
  const lines: string[] = [];
  const header = ['Schritt', 'Zustand', 'Laufzeit', 'Wartezeit', 'Dauer'];
  for (const r of reports) {
    lines.push(`Session ${r.label} (${r.sessionId})`);
    const table = r.steps.map((s) => [
      s.jobs > 1 ? `${s.type} ×${s.jobs}` : s.type,
      s.state,
      dash(s.runMs),
      dash(s.waitMs),
      dash(s.durationMs, s.runMs === null),
    ]);
    const widths = header.map((h, i) =>
      Math.max(h.length, ...table.map((row) => [...(row[i] as string)].length)),
    );
    const fmt = (row: string[]): string =>
      '  ' +
      row
        .map((cell, i) => cell + ' '.repeat((widths[i] as number) - [...cell].length))
        .join('  ')
        .trimEnd();
    lines.push(fmt(header), ...table.map(fmt));
    if (r.totalMs !== null) {
      const goal = `Ziel ≤ ${PIPELINE_GOAL_MS / 60000} min: ${r.withinGoal ? 'erreicht' : 'verfehlt'}`;
      lines.push(`  Gesamt: ${formatDuration(r.totalMs)} (${goal})`);
    } else {
      lines.push('  Gesamt: noch nicht fertig (mindestens ein Schritt ist nicht im Zustand fertig).');
    }
    if (r.complete && r.stepsWithoutRunTime > 0) {
      lines.push(
        `  Wartezeit: mindestens ${formatDuration(r.knownWaitMs)}; bei ${r.stepsWithoutRunTime} Schritt(en) ohne Laufzeitmeldung steckt sie in der Dauer (~).`,
      );
    }
    lines.push('');
  }
  const done = reports.filter((r) => r.totalMs !== null);
  if (reports.length > 1 && done.length > 0) {
    const totals = done.map((r) => r.totalMs as number);
    const over = done.filter((r) => r.withinGoal === false).length;
    lines.push(
      `Zusammen: ${done.length} fertige Sessions, Median ${formatDuration(median(totals))}, längste ${formatDuration(Math.max(...totals))}, ${over} über dem Ziel.`,
    );
  }
  lines.push(
    'Laufzeit meldet nur der Worker (audio.finalize, transcribe, align.log). Bei den übrigen Schritten ist die Dauer Ende minus bereit und enthält das Warten (~).',
  );
  return lines;
}

export interface MessenIo {
  out: (line: string) => void;
}

export async function runPipelineReport(
  pg: Pick<PgAccess, 'query'>,
  args: { sessionId?: string; last: number },
  io: MessenIo,
): Promise<number> {
  const { sql, vars } = pipelineQuery(args);
  const rows = parseJobRows(await pg.query(sql, vars));
  const reports = summarizePipeline(rows);
  if (reports.length === 0 && args.sessionId !== undefined) {
    io.out(`Keine Jobs für die Session ${args.sessionId} gefunden (ID prüfen).`);
    return 1;
  }
  for (const line of formatPipelineReport(reports)) io.out(line);
  return 0;
}
