// Welches Notizbuch gehört zur laufenden Session? Die Session hat kein `notebook_id`; die Wahl leitet sich aus dem
// Termin ab (Entscheidung des Leads zu Issue #107, ohne Schemaänderung). Reine Funktionen ohne React.
import type { CalendarEvent, Notebook, Session } from '@sg/shared';

type WantedKind = Extract<Notebook['kind'], 'vorlesung' | 'uebung'>;

/** Übung oder Tutorium: Notizbuch „Übung“. Alles andere, auch ein fehlender Termin: „Vorlesung“. */
export function wantedNotebookKind(event: Pick<CalendarEvent, 'kind'> | null | undefined): WantedKind {
  return event?.kind === 'uebung' || event?.kind === 'tutorium' ? 'uebung' : 'vorlesung';
}

const byAge = (a: Notebook, b: Notebook) =>
  Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id);

/**
 * Das Notizbuch für die laufende Session: das zum Termintyp passende (ältestes seiner Art), fehlt es „Vorlesung“,
 * sonst das älteste Notizbuch. `null` ohne Notizbücher. Gelöschte Notizbücher zählen nicht.
 */
export function pickSessionNotebook(
  session: Pick<Session, 'calendar_event_id'>,
  event: Pick<CalendarEvent, 'kind'> | null | undefined,
  notebooks: readonly Notebook[],
): Notebook | null {
  const live = notebooks.filter((n) => n.deleted_at === null);
  // Ohne Termin an der Session gibt es nichts Genaueres als „Vorlesung“, auch wenn ein Termin übergeben wurde
  const wanted = wantedNotebookKind(session.calendar_event_id === null ? null : event);
  const of = (kind: Notebook['kind']) => live.filter((n) => n.kind === kind).sort(byAge)[0];
  return of(wanted) ?? of('vorlesung') ?? [...live].sort(byAge)[0] ?? null;
}
