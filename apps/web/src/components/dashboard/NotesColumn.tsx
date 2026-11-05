'use client';

// Notizen-Spalte des Dashboards (F-DSH-04). Die Session kennt kein Notizbuch (`Session` hat kein `notebook_id`),
// darum leitet sich das Notizbuch aus dem Termin ab (`pickSessionNotebook`): Übung und Tutorium zeigen das Notizbuch
// „Übung“, alles andere „Vorlesung“ (der Core legt beide mit dem Modul an, VERTRAEGE §7.4). Gibt es keins, steht ein
// ruhiger Hinweis da.
import { useQuery } from '@tanstack/react-query';
import { CalendarEventSchema, type Session } from '@sg/shared';
import { apiGet, friendlyMessage } from '../../lib/api.ts';
import { CALENDAR_KEY } from '../../lib/calendar.ts';
import { useHydrationSafe } from '../../lib/hydrated.ts';
import { fetchNotebooks } from '../../lib/ink.ts';
import { pickSessionNotebook } from '../../lib/session-notebook.ts';
import type { SyncClient } from '../../lib/sync/client.ts';
import { InkColumn } from '../ink';

function Hint({ children, retry }: { children: string; retry?: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p role="status" className="text-md text-text-muted">
        {children}
      </p>
      {retry ? (
        <button
          type="button"
          onClick={retry}
          className="inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised"
        >
          Erneut versuchen
        </button>
      ) : null}
    </div>
  );
}

export function NotesColumn({
  session,
  client,
}: {
  session: Pick<Session, 'module_id' | 'calendar_event_id'>;
  client: SyncClient | null;
}) {
  const moduleId = session.module_id;
  const eventId = session.calendar_event_id;
  const notebooks = useHydrationSafe(
    useQuery({
      queryKey: ['notebooks', moduleId],
      queryFn: ({ signal }) => fetchNotebooks(moduleId, signal),
    }),
  );
  // Der Termin entscheidet über „Vorlesung“ oder „Übung“. Ist er nicht erreichbar, gilt „Vorlesung“: Die Notizen
  // sollen nie an einem Nebenabruf hängen.
  const event = useHydrationSafe(
    useQuery({
      queryKey: [...CALENDAR_KEY, 'event', eventId],
      enabled: eventId !== null,
      queryFn: ({ signal }) =>
        apiGet(`/calendar/events/${encodeURIComponent(eventId ?? '')}`, CalendarEventSchema, { signal }),
    }),
  );

  if (notebooks.isPending || !client || (eventId !== null && event.isPending)) {
    return <Hint>Notizen werden geladen …</Hint>;
  }
  if (notebooks.error) {
    return (
      <Hint retry={() => void notebooks.refetch()}>
        {`Notizen nicht erreichbar: ${friendlyMessage(notebooks.error)}`}
      </Hint>
    );
  }
  const notebook = pickSessionNotebook(session, event.data, notebooks.data?.items ?? []);
  if (!notebook) return <Hint>Zu diesem Modul gibt es noch kein Notizbuch.</Hint>;
  return (
    <div className="h-full overflow-y-auto p-3">
      <InkColumn notebookId={notebook.id} client={client} />
    </div>
  );
}
