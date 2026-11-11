'use client';

// Notizen-Spalte des Dashboards (F-DSH-04). Welches Notizbuch gilt, entscheidet der Core (#199, VERTRAEGE §7.2):
// `GET /sessions/{id}/notebook` liefert „Übung“ bei Übung und Tutorium, sonst „Vorlesung“. Meldet das iPad per
// `presence` ein anderes Notizbuch desselben Moduls (freie Wahl, UX-30), zeigt die Spalte dieses (§11.6).
// Trennt sich das iPad, bleibt die Spalte beim zuletzt gezeigten Notizbuch.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Notebook, Session } from '@sg/shared';
import { friendlyMessage } from '../../lib/api.ts';
import { useHydrationSafe } from '../../lib/hydrated.ts';
import { fetchNotebook, fetchNotebooks, fetchSessionNotebook } from '../../lib/ink.ts';
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

/** Letztes vom iPad gemeldetes Notizbuch. `client` hält fest, für welchen Sync-Client der Stand gilt. */
interface IpadNotebook {
  client: SyncClient | null;
  notebookId: string | null;
}

const readIpad = (client: SyncClient | null): IpadNotebook => ({
  client,
  notebookId: client?.devicePresence('ipad')?.notebook_id ?? null,
});

export function NotesColumn({
  session,
  client,
}: {
  session: Pick<Session, 'id' | 'module_id'>;
  client: SyncClient | null;
}) {
  const moduleId = session.module_id;
  const [ipad, setIpad] = useState<IpadNotebook>(() => readIpad(client));
  /** Das zuletzt gezeigte Notizbuch: bleibt stehen, solange ein neues gemeldetes noch geprüft wird */
  const shown = useRef<Notebook | null>(null);

  // Startwert aus der letzten `presence` des iPads (auch wenn sie vor dem Einhängen kam), danach folgen
  useEffect(() => {
    if (!client) return;
    setIpad(readIpad(client));
    return client.onEvent('presence', (p) => {
      if (p.client === 'ipad') setIpad({ client, notebookId: p.notebook_id });
    });
  }, [client]);

  const standard = useHydrationSafe(
    useQuery({
      queryKey: ['sessions', session.id, 'notebook'],
      queryFn: ({ signal }) => fetchSessionNotebook(session.id, signal),
    }),
  );
  const notebooks = useHydrationSafe(
    useQuery({
      queryKey: ['notebooks', moduleId],
      queryFn: ({ signal }) => fetchNotebooks(moduleId, signal),
    }),
  );

  const reported = ipad.client === client ? ipad.notebookId : null;
  const listed = reported ? notebooks.data?.items.find((n) => n.id === reported) : undefined;
  // Unbekannt in der Liste (frisch auf dem iPad angelegt oder jenseits der ersten 50): einmal nachfragen
  const lookup = reported !== null && reported !== standard.data?.id && !listed && !notebooks.isPending;
  const single = useHydrationSafe(
    useQuery({
      queryKey: ['notebooks', 'one', reported],
      enabled: lookup,
      retry: false,
      queryFn: ({ signal }) => fetchNotebook(reported ?? '', signal),
    }),
  );

  const checking =
    reported !== null &&
    reported !== standard.data?.id &&
    (notebooks.isPending || (lookup && single.isPending));
  if (standard.isPending || !client || ipad.client !== client || (checking && !shown.current)) {
    return <Hint>Notizen werden geladen …</Hint>;
  }
  if (standard.error) {
    return (
      <Hint retry={() => void standard.refetch()}>
        {`Notizen nicht erreichbar: ${friendlyMessage(standard.error)}`}
      </Hint>
    );
  }
  const fallback = standard.data;
  if (!fallback) return <Hint>Zu diesem Modul gibt es noch kein Notizbuch.</Hint>;

  // Regel V4: das gemeldete Notizbuch nur, wenn es zum Modul der Session gehört, sonst der Standard
  const found = listed ?? single.data;
  const own = found?.module_id === moduleId;
  const notebook = checking && shown.current ? shown.current : reported && found && own ? found : fallback;
  shown.current = notebook;
  return (
    <div className="h-full overflow-y-auto p-3">
      <InkColumn key={notebook.id} notebookId={notebook.id} client={client} />
    </div>
  );
}
