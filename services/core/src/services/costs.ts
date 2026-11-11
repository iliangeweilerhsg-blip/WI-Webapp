// Kosten der Cloud-KI und Monatsbudget (F-DAT-05, VERTRAEGE §20.5, §20.6 `GET /costs/summary`). Ticket T2-22a.
//
// Die Zeilen in `cost_entry` schreibt nur der Worker (je Aufruf eine). Der Core liest und summiert.
// **Monat** = Kalendermonat in Ortszeit. Für den laufenden Monat gilt genau der Ausdruck aus §20.5, den auch der
// Worker nutzt (`MONTH_SPENT_SQL` in `ai/budget.py`), damit Anzeige und Budgetprüfung dieselbe Summe sehen.
import { sql, type SQL } from 'drizzle-orm';
import type { AiBudgetStatus, CostSummary, SessionRef } from '@sg/shared';
import type { Db, DbOrTx } from '../db/client.ts';
import { HttpError } from '../errors.ts';
import { isoTs } from './sessions.ts';
import { getAiSettings } from './settings.ts';

/** Ab diesem Anteil des Budgets steht der Hinweis in den Einstellungen (`warn`, F-DAT-05) */
export const BUDGET_WARN_RATIO = 0.8;
/** `by_session`: die teuersten Sessions (§20.6) */
export const COST_SESSION_LIMIT = 20;

/** `YYYY-MM`. Das Jahr 0000 kennt Postgres nicht (`date` außerhalb des Bereichs, sonst 500) */
export const MONTH_RE = /^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/;

/**
 * IANA-Name der Ortszeit des Prozesses (§20.5): `TZ` (ohne führenden `:`), sonst die Zone des Systems, sonst `UTC`.
 * Ein ungültiger Name zählt als nicht gesetzt (wie im Worker), damit eine falsche `TZ` keinen 500 auslöst.
 */
export function localTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [
    (env.TZ ?? '').trim().replace(/^:/, ''),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ];
  for (const name of candidates) {
    if (!name) continue;
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: name });
      return name;
    } catch {
      // nächster Kandidat
    }
  }
  return 'UTC';
}

/** Beginn des laufenden Monats in Ortszeit, genau wie in §20.5 */
const currentMonthStart = (tz: string): SQL =>
  sql`date_trunc('month', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}`;

/** Bedingung „`cost_entry` (Alias `c`) liegt im Monat“. Ohne `month`: laufender Monat, Ausdruck aus §20.5 */
function inMonth(tz: string, month: string | undefined): SQL {
  if (month === undefined) return sql`c.created_at >= ${currentMonthStart(tz)}`;
  const first = `${month}-01`;
  return sql`c.created_at >= (${first}::date)::timestamp AT TIME ZONE ${tz}
             AND c.created_at < ((${first}::date)::timestamp + interval '1 month') AT TIME ZONE ${tz}`;
}

export interface CostOptions {
  /** IANA-Zeitzone. Standard: Ortszeit des Prozesses */
  timeZone?: string;
}

function budgetStatus(month: string, spent: number, budget: number): AiBudgetStatus {
  return {
    month,
    spent_eur: spent,
    budget_eur: budget,
    reached: spent >= budget,
    warn: spent >= budget * BUDGET_WARN_RATIO,
  };
}

/**
 * Stand des Monatsbudgets für den laufenden Monat (`GET /ai/status`): Summe wie der Worker, Budget aus
 * `ai.monthly_budget_eur`. `reached` heißt: KI-Jobs enden mit `fehler` (`Monatsbudget erreicht`).
 */
export async function getBudgetStatus(db: DbOrTx, options: CostOptions = {}): Promise<AiBudgetStatus> {
  const tz = options.timeZone ?? localTimeZone();
  const [row] = await db.execute<{ month: string; spent: number }>(sql`
    SELECT to_char(now() AT TIME ZONE ${tz}, 'YYYY-MM') AS month,
           coalesce(sum(c.cost_estimate_eur), 0)::float8 AS spent
    FROM cost_entry c
    WHERE c.deleted_at IS NULL AND ${inMonth(tz, undefined)}`);
  const { monthly_budget_eur: budget } = await getAiSettings(db);
  return budgetStatus(row?.month ?? '', Number(row?.spent ?? 0), budget);
}

interface SessionCostRow extends Record<string, unknown> {
  session_id: string;
  calls: number;
  eur: number;
  present: boolean;
  number: number | null;
  title: string | null;
  started_at: Date | string | null;
  module_id: string | null;
  module_name: string | null;
  module_short_name: string | null;
}

function toSessionRef(row: SessionCostRow): SessionRef | null {
  if (!row.present || !row.module_id || !row.module_name) return null;
  return {
    id: row.session_id,
    number: row.number,
    title: row.title,
    started_at: row.started_at ? isoTs(new Date(row.started_at)) : null,
    module: { id: row.module_id, name: row.module_name, short_name: row.module_short_name },
  };
}

/**
 * `GET /costs/summary?month` (§20.6): Summen über die nicht gelöschten `cost_entry` des Monats, je Aufgabe, je Modell
 * und die 20 teuersten Sessions. `month` als `YYYY-MM`, Standard: laufender Monat in Ortszeit. Das Budget ist immer
 * das aktuell eingestellte. Gelöschte Sessions stehen mit `session = null` (ihre Kosten bleiben gezählt).
 *
 * Fehler (HttpError): 400 `validation_failed` bei einem `month`, der kein `YYYY-MM` ist.
 */
export async function getCostSummary(
  database: Db,
  query: { month?: string | undefined },
  options: CostOptions = {},
): Promise<CostSummary> {
  if (query.month !== undefined && !MONTH_RE.test(query.month)) {
    throw new HttpError(400, 'validation_failed', 'month muss die Form YYYY-MM haben.');
  }
  const tz = options.timeZone ?? localTimeZone();
  // Ein Schnappschuss für alle Summen: Der Worker schreibt nebenher weiter
  return database.transaction((db) => summarize(db, query.month, tz), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
}

async function summarize(db: DbOrTx, month: string | undefined, tz: string): Promise<CostSummary> {
  const where = sql`c.deleted_at IS NULL AND ${inMonth(tz, month)}`;

  const [total] = await db.execute<{ month: string; calls: number; spent: number }>(sql`
    SELECT to_char(now() AT TIME ZONE ${tz}, 'YYYY-MM') AS month, count(*)::int AS calls,
           coalesce(sum(c.cost_estimate_eur), 0)::float8 AS spent
    FROM cost_entry c WHERE ${where}`);
  const byTask = await db.execute<{ task: string; calls: number; eur: number }>(sql`
    SELECT c.task, count(*)::int AS calls, sum(c.cost_estimate_eur)::float8 AS eur
    FROM cost_entry c WHERE ${where}
    GROUP BY c.task ORDER BY sum(c.cost_estimate_eur) DESC, c.task`);
  const byModel = await db.execute<{
    provider: string;
    model: string;
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    eur: number;
  }>(sql`
    SELECT c.provider, c.model, count(*)::int AS calls,
           sum(c.input_tokens)::float8 AS input_tokens, sum(c.output_tokens)::float8 AS output_tokens,
           sum(c.cache_creation_input_tokens)::float8 AS cache_creation_input_tokens,
           sum(c.cache_read_input_tokens)::float8 AS cache_read_input_tokens,
           sum(c.cost_estimate_eur)::float8 AS eur
    FROM cost_entry c WHERE ${where}
    GROUP BY c.provider, c.model ORDER BY sum(c.cost_estimate_eur) DESC, c.provider, c.model`);
  // `cost_entry.session_id` hat keinen FK: Die Session kann weich oder endgültig gelöscht sein (dann `session = null`)
  const bySession = await db.execute<SessionCostRow>(sql`
    WITH top AS (
      SELECT c.session_id, count(*)::int AS calls, sum(c.cost_estimate_eur) AS eur
      FROM cost_entry c WHERE ${where} AND c.session_id IS NOT NULL
      GROUP BY c.session_id ORDER BY sum(c.cost_estimate_eur) DESC, c.session_id LIMIT ${COST_SESSION_LIMIT}
    )
    SELECT top.session_id, top.calls, top.eur::float8 AS eur, (s.id IS NOT NULL AND m.id IS NOT NULL) AS present,
           s.number, s.title, s.started_at, m.id AS module_id, m.name AS module_name,
           m.short_name AS module_short_name
    FROM top
    LEFT JOIN session s ON s.id = top.session_id AND s.deleted_at IS NULL
    LEFT JOIN module m ON m.id = s.module_id
    ORDER BY top.eur DESC, top.session_id`);

  const { monthly_budget_eur: budget } = await getAiSettings(db);
  return {
    budget: budgetStatus(month ?? total?.month ?? '', Number(total?.spent ?? 0), budget),
    calls: total?.calls ?? 0,
    by_task: byTask.map((r) => ({ task: r.task, calls: r.calls, eur: Number(r.eur) })),
    by_session: bySession.map((r) => ({
      session_id: r.session_id,
      session: toSessionRef(r),
      calls: r.calls,
      eur: Number(r.eur),
    })),
    by_model: byModel.map((r) => ({
      provider: r.provider,
      model: r.model,
      calls: r.calls,
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      cache_creation_input_tokens: Number(r.cache_creation_input_tokens),
      cache_read_input_tokens: Number(r.cache_read_input_tokens),
      eur: Number(r.eur),
    })),
  };
}
