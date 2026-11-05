'use client';

// Notizen-Spalte des Dashboards (F-DSH-04). Die Session kennt kein Notizbuch (`Session` hat kein `notebook_id`),
// darum gilt: das Notizbuch „Vorlesung“ des Moduls der Session (`GET /notebooks?module_id`, der Core legt es mit
// dem Modul an, VERTRAEGE §7.4). Gibt es keins, steht ein ruhiger Hinweis da.
import { useQuery } from '@tanstack/react-query';
import type { Notebook } from '@sg/shared';
import { friendlyMessage } from '../../lib/api.ts';
import { useHydrationSafe } from '../../lib/hydrated.ts';
import { fetchNotebooks } from '../../lib/ink.ts';
import type { SyncClient } from '../../lib/sync/client.ts';
import { InkColumn } from '../ink';

/** Das Notizbuch für die laufende Session: „Vorlesung“ zuerst, sonst das älteste. `null` ohne Notizbücher. */
export function pickNotebook(notebooks: readonly Notebook[]): Notebook | null {
  const live = notebooks.filter((n) => n.deleted_at === null);
  const byAge = (a: Notebook, b: Notebook) =>
    Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id);
  const lecture = live.filter((n) => n.kind === 'vorlesung').sort(byAge);
  return lecture[0] ?? [...live].sort(byAge)[0] ?? null;
}

function Hint({ children }: { children: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <p role="status" className="text-md text-text-muted">
        {children}
      </p>
    </div>
  );
}

export function NotesColumn({ moduleId, client }: { moduleId: string; client: SyncClient | null }) {
  const query = useHydrationSafe(
    useQuery({
      queryKey: ['notebooks', moduleId],
      queryFn: ({ signal }) => fetchNotebooks(moduleId, signal),
      select: (page) => pickNotebook(page.items),
    }),
  );
  if (query.isPending || !client) return <Hint>Notizen werden geladen …</Hint>;
  if (query.error) return <Hint>{`Notizen nicht erreichbar: ${friendlyMessage(query.error)}`}</Hint>;
  if (!query.data) return <Hint>Zu diesem Modul gibt es noch kein Notizbuch.</Hint>;
  return (
    <div className="h-full overflow-y-auto p-3">
      <InkColumn notebookId={query.data.id} client={client} />
    </div>
  );
}
