// KI-Status für die Web-App (VERTRAEGE §20.5, §20.6 `GET /ai/status`). Ticket T2-22a.
//
// Der Core kennt den KI-Schlüssel nicht (§20.5). Ob die KI eingerichtet ist, sagt allein der Worker über das Feld
// `llm` in seinem `GET /health`. Dazu kommt der Stand des Monatsbudgets aus `cost_entry` und den Einstellungen.
import type { AiStatus } from '@sg/shared';
import type { DbOrTx } from '../db/client.ts';
import type { WorkerClient } from '../lib/worker-client.ts';
import { getBudgetStatus, type CostOptions } from './costs.ts';

export interface AiStatusDeps {
  db: DbOrTx;
  worker: Pick<WorkerClient, 'llmStatus'>;
}

/**
 * `GET /ai/status`: Worker nicht erreichbar (aus, Zeitlimit 800 ms) → `worker_reachable = false`, `llm = null`.
 * Fehlt `llm` in der Antwort (älterer Worker), ebenfalls `llm = null`. Das Budget kommt auch ohne Worker.
 * Worker und Datenbank werden gleichzeitig gefragt, damit ein stiller Worker die Antwort höchstens 800 ms aufhält.
 */
export async function getAiStatus(deps: AiStatusDeps, options: CostOptions = {}): Promise<AiStatus> {
  const [worker, budget] = await Promise.all([deps.worker.llmStatus(), getBudgetStatus(deps.db, options)]);
  return { worker_reachable: worker.reachable, llm: worker.llm, budget };
}
