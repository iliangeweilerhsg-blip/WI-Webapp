'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Notebook } from '@sg/shared';
import { ApiRequestError, friendlyMessage } from '../lib/api.ts';
import { useHydrationSafe } from '../lib/hydrated.ts';
import {
  createNotebook,
  deleteNotebook,
  fetchNotebooks,
  notebooksKey,
  renameNotebook,
  restoreNotebook,
} from '../lib/ink.ts';
import { UNDO_WINDOW_MS } from '../lib/modules.ts';
import { useToast } from '../lib/toast.tsx';
import { uuidv7 } from '../lib/uuid.ts';

/** Längster Titel in der Eingabe (das Schema selbst kennt nur „nicht leer“) */
const MAX_TITLE = 200;
const EMPTY_TITLE = 'Der Titel darf nicht leer sein.';

const pagesLabel = (count: number) => (count === 1 ? '1 Seite' : `${count} Seiten`);

const rowButton = 'rounded-md border border-border px-2.5 py-1 text-sm hover:bg-surface disabled:opacity-50';
const titleInput = 'w-full rounded-md border border-border-strong bg-bg px-3 py-1.5 text-md';

function NotebookRow({
  notebook,
  onChanged,
  onDeleted,
}: {
  notebook: Notebook;
  onChanged: () => void;
  onDeleted: (notebook: Notebook) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notebook.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const standard = notebook.kind !== 'frei';

  function startEdit() {
    setDraft(notebook.title);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
    // Der Fokus bleibt in der Zeile, sobald das Eingabefeld weg ist
    setTimeout(() => renameButton.current?.focus(), 0);
  }

  async function save() {
    if (busy) return;
    const title = draft.trim();
    if (title === '') {
      setError(EMPTY_TITLE);
      return;
    }
    if (title === notebook.title) {
      cancel();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await renameNotebook(notebook.id, title);
      onChanged();
      setEditing(false);
      setTimeout(() => renameButton.current?.focus(), 0);
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteNotebook(notebook.id);
      onDeleted(notebook);
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      // Escape gehört dieser Zeile, nicht einem darüberliegenden Dialog
      e.stopPropagation();
      cancel();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save();
  }

  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
        {editing ? (
          <form onSubmit={onSubmit} className="min-w-0 flex-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              maxLength={MAX_TITLE}
              aria-label={`Neuer Titel für ${notebook.title}`}
              aria-invalid={error ? true : undefined}
              disabled={busy}
              className={titleInput}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
            />
          </form>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">{notebook.title}</span>
            <span className="shrink-0 text-sm text-text-muted">{pagesLabel(notebook.page_count)}</span>
            <button
              ref={renameButton}
              type="button"
              onClick={startEdit}
              disabled={busy}
              aria-label={`${notebook.title} umbenennen`}
              className={rowButton}
            >
              Umbenennen
            </button>
            {standard ? null : (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                aria-label={`${notebook.title} löschen`}
                className={rowButton}
              >
                Löschen
              </button>
            )}
          </>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-text-muted">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function CreateForm({ moduleId, onCreated }: { moduleId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Die ID bleibt bei einem Wiederholen gleich: Ist das erste Anlegen doch durchgegangen, meldet der Core `notebook_exists`
  const pendingId = useRef<string | null>(null);

  function close() {
    setOpen(false);
    setTitle('');
    setError(null);
    pendingId.current = null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = title.trim();
    if (trimmed === '') {
      setError(EMPTY_TITLE);
      return;
    }
    pendingId.current ??= uuidv7();
    setBusy(true);
    setError(null);
    try {
      await createNotebook({ id: pendingId.current, moduleId, title: trimmed });
      onCreated();
      close();
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.code === 'notebook_exists') {
        // Das vorige Anlegen ist angekommen
        onCreated();
        close();
      } else {
        setError(friendlyMessage(failure));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${rowButton} mt-3`}>
        Notizbuch anlegen
      </button>
    );
  }

  return (
    <form onSubmit={submit} aria-label="Notizbuch anlegen" className="mt-3">
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
          maxLength={MAX_TITLE}
          placeholder="Titel"
          aria-label="Titel des neuen Notizbuchs"
          aria-invalid={error ? true : undefined}
          disabled={busy}
          className={titleInput}
          autoFocus
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast disabled:opacity-50"
        >
          Anlegen
        </button>
        <button
          type="button"
          onClick={close}
          className="shrink-0 rounded-md px-3 py-1.5 text-sm hover:bg-surface"
        >
          Abbrechen
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-text-muted">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Notizbücher des Moduls (UX-52): anlegen, umbenennen, löschen. Löschen läuft ohne Dialog über den Core
 * (`DELETE /notebooks/{id}` legt das Notizbuch samt Seiten in den Papierkorb), „Rückgängig“ holt es von dort zurück.
 * „Vorlesung“ und „Übung“ lassen sich umbenennen, aber nicht löschen.
 */
export function ModuleNotebooks({ moduleId }: { moduleId: string }) {
  const client = useQueryClient();
  const toast = useToast();
  const notebooks = useHydrationSafe(
    useQuery({
      queryKey: notebooksKey(moduleId),
      queryFn: ({ signal }) => fetchNotebooks(moduleId, signal),
    }),
  );
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['notebooks'] });
  };

  function onDeleted(notebook: Notebook) {
    refresh();
    toast.show({
      message: `„${notebook.title}“ gelöscht`,
      actionLabel: 'Rückgängig',
      onAction: () => {
        restoreNotebook(notebook.id).then(refresh, (failure: unknown) => {
          refresh();
          toast.show({
            message: `„${notebook.title}“ ließ sich nicht zurückholen. ${friendlyMessage(failure)}`,
          });
        });
      },
      // Nichts zu bestätigen (gelöscht ist schon), aber so bleibt die Leiste vor anderen Meldungen sichtbar
      onExpire: () => {},
      group: `notebook-delete-${notebook.id}`,
      focusAction: true,
      durationMs: UNDO_WINDOW_MS,
    });
  }

  const items = notebooks.data?.items ?? [];

  return (
    <section aria-labelledby={`notizbuecher-${moduleId}`} className="mt-6">
      <h2 id={`notizbuecher-${moduleId}`} className="text-lg font-semibold">
        Notizbücher
      </h2>
      {notebooks.isPending ? (
        <p className="mt-2 text-sm text-text-muted">Notizbücher werden geladen …</p>
      ) : notebooks.isError ? (
        <p role="status" className="mt-2 text-sm text-text-muted">
          {friendlyMessage(notebooks.error)}
        </p>
      ) : (
        <ul aria-label="Notizbücher" className="mt-2 divide-y divide-border">
          {items.map((notebook) => (
            <NotebookRow key={notebook.id} notebook={notebook} onChanged={refresh} onDeleted={onDeleted} />
          ))}
        </ul>
      )}
      <CreateForm moduleId={moduleId} onCreated={refresh} />
    </section>
  );
}
