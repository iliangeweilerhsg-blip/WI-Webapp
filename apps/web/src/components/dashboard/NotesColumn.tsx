'use client';

// Notizen-Spalte des Dashboards (F-DSH-04). Welches Notizbuch gilt, entscheidet der Core (#199, VERTRAEGE §7.2):
// `GET /sessions/{id}/notebook` liefert „Übung“ bei Übung und Tutorium, sonst „Vorlesung“. Meldet das iPad per
// `presence` ein anderes Notizbuch desselben Moduls (freie Wahl, UX-30), zeigt die Spalte dieses (§11.6).
// Trennt sich das iPad, bleibt die Spalte beim zuletzt gezeigten Notizbuch.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Notebook, Session } from '@sg/shared';
import { ApiRequestError, friendlyMessage } from '../../lib/api.ts';
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

/**
 * Zuletzt gemeldetes Notizbuch je Sync-Client und Session. Nach dem Trennen des iPads liefert `devicePresence`
 * nichts mehr. Eine neu eingehängte Spalte (Tab- oder Layoutwechsel) bleibt so trotzdem beim zuletzt gezeigten
 * Notizbuch (V4).
 */
const remembered = new WeakMap<SyncClient, Map<string, string | null>>();

function remember(client: SyncClient, sessionId: string, notebookId: string | null): void {
  let bySession = remembered.get(client);
  if (!bySession) remembered.set(client, (bySession = new Map()));
  bySession.set(sessionId, notebookId);
}

function readIpad(client: SyncClient | null, sessionId: string): IpadNotebook {
  if (!client) return { client, notebookId: null };
  const presence = client.devicePresence('ipad');
  if (!presence) return { client, notebookId: remembered.get(client)?.get(sessionId) ?? null };
  remember(client, sessionId, presence.notebook_id);
  return { client, notebookId: presence.notebook_id };
}

/**
 * 404 auf `GET /notebooks/{id}` kurz wiederholen: Nach dem Neuverbinden meldet das iPad `presence` vor seinen
 * Operationen. Ein offline angelegtes Notizbuch kennt der Core dann für einen Moment noch nicht.
 */
const retryNotFound = (count: number, error: unknown) =>
  count < 3 && error instanceof ApiRequestError && error.status === 404;

export function NotesColumn({
  session,
  client,
}: {
  session: Pick<Session, 'id' | 'module_id'>;
  client: SyncClient | null;
}) {
  const moduleId = session.module_id;
  const [ipad, setIpad] = useState<IpadNotebook>(() => readIpad(client, session.id));
  /** Das zuletzt gezeigte Notizbuch: bleibt stehen, solange ein neues gemeldetes noch geprüft wird */
  const shown = useRef<Notebook | null>(null);

  // Startwert aus der letzten `presence` des iPads (auch wenn sie vor dem Einhängen kam), danach folgen
  useEffect(() => {
    if (!client) return;
    setIpad(readIpad(client, session.id));
    return client.onEvent('presence', (p) => {
      if (p.client !== 'ipad') return;
      remember(client, session.id, p.notebook_id);
      setIpad({ client, notebookId: p.notebook_id });
    });
  }, [client, session.id]);

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
      retry: retryNotFound,
      retryDelay: (attempt) => 500 * (attempt + 1),
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
