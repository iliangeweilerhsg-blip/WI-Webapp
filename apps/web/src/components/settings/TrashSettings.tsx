'use client';

import type { TrashItem, TrashKind } from '@sg/shared';
import { friendlyMessage } from '../../lib/api.ts';
import { useEmptyTrash, usePurgeTrashItem, useRestoreTrashItem, useTrash } from '../../lib/data.ts';
import { useToast } from '../../lib/toast.tsx';
import { CoreHint } from '../CoreHint.tsx';

const KIND_LABEL: Record<TrashKind, string> = {
  semester: 'Semester',
  module: 'Modul',
  slide_deck: 'Foliensatz',
  exercise_sheet: 'Übungsblatt',
  calendar_source: 'Kalenderquelle',
  session: 'Session',
  notebook: 'Notizbuch',
  page: 'Seite',
  marker: 'Marker',
  photo: 'Foto',
};

const smallButton = 'rounded-md border border-border px-3 py-1 text-sm hover:bg-surface disabled:opacity-50';

/** Verbleibende Tage bis zum endgültigen Löschen (aufgerundet, nie unter 0) */
export function daysLeft(purgeAt: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(purgeAt).getTime() - now.getTime()) / 86_400_000));
}

function Row({
  item,
  busy,
  onRestore,
  onPurge,
}: {
  item: TrashItem;
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const left = daysLeft(item.purge_at);
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <span className="font-medium">{item.title}</span>
        <span className="ml-2 text-xs text-text-muted">
          {KIND_LABEL[item.kind]}
          {item.parent ? ` in ${item.parent.title}` : ''}
          {item.dependent_count > 0 ? ` · mit ${item.dependent_count} abhängigen Objekten` : ''}
          {` · noch ${left} ${left === 1 ? 'Tag' : 'Tage'}`}
        </span>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          disabled={busy}
          aria-label={`${item.title} wiederherstellen`}
          onClick={onRestore}
          className={smallButton}
        >
          Wiederherstellen
        </button>
        <button
          type="button"
          disabled={busy}
          aria-label={`${item.title} endgültig löschen`}
          onClick={onPurge}
          className={smallButton}
        >
          Endgültig löschen
        </button>
      </div>
    </li>
  );
}

/** Einstellungen → Papierkorb (F-DAT-04): wiederherstellen, endgültig löschen, leeren. Gelöschtes bleibt 30 Tage. */
export function TrashSettings() {
  const trash = useTrash();
  const restore = useRestoreTrashItem();
  const purge = usePurgeTrashItem();
  const empty = useEmptyTrash();
  const toast = useToast();
  const busy = restore.isPending || purge.isPending || empty.isPending;
  const fail = (error: unknown) => toast.show({ message: friendlyMessage(error) });

  if (trash.isPending) return <p className="text-sm text-text-muted">Lädt …</p>;
  if (trash.isError) return <CoreHint error={trash.error} />;
  const items = trash.data.items;

  return (
    <section aria-labelledby="trash-title" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="trash-title" className="text-lg font-semibold">
          Papierkorb
        </h2>
        <button
          type="button"
          disabled={busy || items.length === 0}
          className={smallButton}
          onClick={() => {
            // Unumkehrbar (R18): mit Bestätigung
            if (window.confirm('Den Papierkorb leeren? Das lässt sich nicht rückgängig machen.')) {
              empty.mutate(undefined, { onError: fail });
            }
          }}
        >
          Papierkorb leeren
        </button>
      </div>
      <p className="text-sm text-text-muted">
        Gelöschtes bleibt 30 Tage hier und wird danach endgültig entfernt.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-text-muted">Der Papierkorb ist leer.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              busy={busy}
              onRestore={() =>
                restore.mutate(item.id, {
                  onSuccess: () => toast.show({ message: `${item.title} wiederhergestellt` }),
                  onError: fail,
                })
              }
              onPurge={() => {
                if (
                  window.confirm(`„${item.title}“ endgültig löschen? Das lässt sich nicht rückgängig machen.`)
                ) {
                  purge.mutate(item.id, { onError: fail });
                }
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
