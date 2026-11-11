// Kurzfassung einer Session lesen (F-NAC-08, VERTRAEGE §20.4, §20.6 `GET /sessions/{id}/summary`). Ticket T2-22a.
//
// `session_summary` schreibt nur der Worker (`summary.write`, eine Zeile je Session). Sie ist direkt sichtbar, kein
// Inbox-Vorschlag. Die Sätze sind KI-Text: Die Web-App zeigt sie nur als reinen Text (§20.10).
import { and, eq, isNull } from 'drizzle-orm';
import type { Lang, SessionSummaryView } from '@sg/shared';
import type { DbOrTx } from '../db/client.ts';
import { session, sessionSummary } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { isoTs } from './sessions.ts';

/**
 * `GET /sessions/{id}/summary`: die Zusammenfassung der Session oder `summary: null`, wenn es (noch) keine gibt.
 * `provider` und `input_hash` bleiben intern (das Schema kennt sie nicht).
 *
 * Fehler (HttpError): 404 `session_not_found` (Session fehlt oder ist gelöscht).
 */
export async function getSessionSummary(db: DbOrTx, sessionId: string): Promise<SessionSummaryView> {
  const [found] = await db
    .select({ id: session.id })
    .from(session)
    .where(and(eq(session.id, sessionId), isNull(session.deletedAt)));
  if (!found) throw new HttpError(404, 'session_not_found', 'Die Session wurde nicht gefunden.');

  const [row] = await db
    .select()
    .from(sessionSummary)
    .where(and(eq(sessionSummary.sessionId, sessionId), isNull(sessionSummary.deletedAt)));
  if (!row) return { session_id: sessionId, summary: null };
  return {
    session_id: sessionId,
    summary: {
      id: row.id,
      session_id: row.sessionId,
      created_at: isoTs(row.createdAt),
      updated_at: isoTs(row.updatedAt),
      lang: row.lang as Lang | null,
      sentences: row.sentences,
      outline: row.outline,
      model: row.model,
      prompt_version: row.promptVersion,
      job_id: row.jobId,
    },
  };
}
