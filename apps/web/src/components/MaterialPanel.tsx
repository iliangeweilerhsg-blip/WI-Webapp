'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import type { ExerciseSheet, SlideDeck } from '@sg/shared';
import { friendlyMessage } from '../lib/api.ts';
import {
  KIND_WORDS,
  commitMaterialDeletes,
  documentHref,
  formatDate,
  pageThumbUrl,
  pagesLabel,
  pendingMaterialDeleteCount,
  scheduleMaterialDelete,
  undoMaterialDeletes,
  useDeckDetail,
  useDecks,
  useRenameMaterial,
  useSheets,
  useVisibleItems,
  type MaterialKind,
} from '../lib/material.ts';
import { UNDO_WINDOW_MS } from '../lib/modules.ts';
import { useToast } from '../lib/toast.tsx';
import { useUploads, type UploadEntry } from '../lib/uploads.tsx';
import { CoreHint } from './CoreHint.tsx';
import { EmptyState } from './Placeholder.tsx';

/** Springt zu einem Dokument (Toast „Schon vorhanden“ → Anzeigen). */
export type OpenDocument = (kind: MaterialKind, id: string) => void;

const smallButton = 'rounded-md border border-border px-3 py-1 text-sm hover:bg-surface disabled:opacity-50';

const FAILED_HINT =
  'Dieses PDF konnte nicht verarbeitet werden. Die Datei ist gespeichert. Zieh sie noch einmal herein, dann wird sie neu gelesen.';

/** Dateiauswahl: ein verstecktes Feld, das ein Knopf öffnet. Mehrere Dateien gleichzeitig. */
function useFilePicker(onFiles: (files: File[]) => void) {
  const input = useRef<HTMLInputElement>(null);
  const field = (
    <input
      ref={input}
      type="file"
      accept="application/pdf,.pdf"
      multiple
      hidden
      aria-label="PDF-Dateien auswählen"
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        // Zurücksetzen, damit dieselbe Datei erneut gewählt werden kann
        e.target.value = '';
        onFiles(files);
      }}
    />
  );
  return { field, open: () => input.current?.click() };
}

function UploadList({ entries }: { entries: readonly UploadEntry[] }) {
  const { retry, dismiss } = useUploads();
  if (entries.length === 0) return null;
  return (
    <ul aria-label="Uploads" className="mt-3 flex flex-col gap-1">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
        >
          <span className="min-w-0 truncate">{entry.file.name}</span>
          <span className="flex shrink-0 items-center gap-2 text-text-muted">
            {entry.status === 'wartet' ? <span>wartet …</span> : null}
            {entry.status === 'laeuft' ? <span role="status">wird hochgeladen …</span> : null}
            {entry.status === 'fehler' ? (
              <>
                <span role="alert">{entry.message}</span>
                {entry.retryable ? (
                  <button type="button" onClick={() => retry(entry.id)} className={smallButton}>
                    Erneut versuchen
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => dismiss(entry.id)}
                  aria-label={`${entry.file.name} schließen`}
                  className={smallButton}
                >
                  Schließen
                </button>
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RenameForm({
  initial,
  busy,
  error,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  error: string | null;
  onSave: (title: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    if (trimmed === initial) onCancel();
    else onSave(trimmed);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  }

  return (
    <form onSubmit={onSubmit} className="min-w-0 flex-1">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Titel"
        maxLength={300}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded-md border border-border-strong bg-bg px-2 py-1 text-md"
      />
      {error ? (
        <p role="alert" className="mt-1 text-xs text-text-muted">
          {error}
        </p>
      ) : null}
    </form>
  );
}

interface RowModel {
  kind: MaterialKind;
  id: string;
  title: string;
  meta: string[];
  state: 'neu' | 'verarbeitet' | 'fehler';
}

function DeckThumb({ deck }: { deck: SlideDeck }) {
  const detail = useDeckDetail(deck.id, { enabled: deck.ingest_state === 'verarbeitet' });
  const first = detail.data?.slides[0];
  return <Thumb src={first ? pageThumbUrl('folien', deck.id, first.id, 1) : null} />;
}

function Thumb({ src }: { src: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-14 w-20 shrink-0 place-items-center overflow-hidden rounded-sm border border-border bg-surface"
    >
      {src ? (
        // Vorschau aus dem Core (WebP); der Text steht im Titel daneben, darum kein eigener alt-Text
        <img src={src} alt="" loading="lazy" className="size-full object-contain" />
      ) : null}
    </span>
  );
}

function MaterialRow({ row, thumb }: { row: RowModel; thumb: React.ReactNode }) {
  const client = useQueryClient();
  const toast = useToast();
  const rename = useRenameMaterial(row.kind);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const words = KIND_WORDS[row.kind];

  function closeEditor() {
    setEditing(false);
    setError(null);
    // Fokus zurück auf den Knopf, der den Editor geöffnet hat
    requestAnimationFrame(() => renameButton.current?.focus());
  }

  async function onSave(title: string) {
    setError(null);
    try {
      await rename.mutateAsync({ id: row.id, title });
      closeEditor();
    } catch (failure) {
      setError(friendlyMessage(failure));
    }
  }

  function onDelete() {
    // Sofort ausblenden; gelöscht wird erst nach Ablauf des Toasts (R15)
    scheduleMaterialDelete(client, row.kind, row.id, () =>
      toast.show({ message: `„${row.title}“ konnte nicht gelöscht werden. Es ist wieder da.` }),
    );
    const count = pendingMaterialDeleteCount();
    toast.show({
      message: count === 1 ? `${words.one} gelöscht` : `${count} Dateien gelöscht`,
      actionLabel: 'Rückgängig',
      onAction: undoMaterialDeletes,
      onExpire: commitMaterialDeletes,
      onReplace: commitMaterialDeletes,
      group: 'material-delete',
      focusAction: true,
      durationMs: UNDO_WINDOW_MS,
    });
  }

  return (
    <li className="flex items-center gap-4 rounded-lg border border-border px-4 py-3">
      {thumb}
      <div className="min-w-0 flex-1">
        {editing ? (
          <RenameForm
            initial={row.title}
            busy={rename.isPending}
            error={error}
            onSave={onSave}
            onCancel={closeEditor}
          />
        ) : (
          <Link
            href={documentHref(row.kind, row.id)}
            className="block truncate font-medium hover:underline"
            title={row.title}
          >
            {row.title}
          </Link>
        )}
        <p className="mt-0.5 text-sm text-text-muted">
          {row.state === 'fehler' ? (
            FAILED_HINT
          ) : (
            <>
              {row.state === 'neu' ? <span role="status">Wird verarbeitet …</span> : null}
              {row.state === 'neu' && row.meta.length > 0 ? ' · ' : null}
              {row.meta.join(' · ')}
            </>
          )}
        </p>
      </div>
      {!editing ? (
        <div className="flex shrink-0 gap-2">
          <button
            ref={renameButton}
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`${row.title} umbenennen`}
            className={smallButton}
          >
            Umbenennen
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`${row.title} löschen`}
            className={smallButton}
          >
            Löschen
          </button>
        </div>
      ) : null}
    </li>
  );
}

function PanelShell({
  kind,
  moduleId,
  loading,
  error,
  empty,
  onOpen,
  children,
}: {
  kind: MaterialKind;
  moduleId: string;
  loading: boolean;
  error: unknown;
  empty: boolean;
  onOpen: OpenDocument;
  children: React.ReactNode;
}) {
  const { entries, enqueue, dragging } = useUploads();
  const own = entries.filter((e) => e.moduleId === moduleId && e.kind === kind);
  const picker = useFilePicker((files) => enqueue(files, { moduleId, kind, open: onOpen }));
  const noun = kind === 'folien' ? 'Folien' : 'Übungsblätter';

  return (
    <div
      data-dragging={dragging ? 'true' : undefined}
      className="rounded-lg border border-transparent data-[dragging=true]:border-dashed data-[dragging=true]:border-accent data-[dragging=true]:bg-accent-soft"
    >
      {picker.field}
      {error ? (
        <CoreHint error={error} />
      ) : loading ? (
        <p className="text-sm text-text-muted">Lädt …</p>
      ) : empty && own.length === 0 ? (
        <EmptyState
          action={
            <button
              type="button"
              onClick={picker.open}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast"
            >
              PDF hierher ziehen oder auswählen
            </button>
          }
        >
          Noch keine {noun}.
        </EmptyState>
      ) : (
        <div className="flex justify-end">
          <button type="button" onClick={picker.open} className={smallButton}>
            PDF auswählen
          </button>
        </div>
      )}
      <UploadList entries={own} />
      {children}
    </div>
  );
}

function DeckPanel({ moduleId, onOpen }: { moduleId: string; onOpen: OpenDocument }) {
  const query = useDecks(moduleId);
  const decks = useVisibleItems('folien', query.data);
  return (
    <PanelShell
      kind="folien"
      moduleId={moduleId}
      loading={query.isPending}
      error={query.isError ? query.error : null}
      empty={decks?.length === 0}
      onOpen={onOpen}
    >
      {decks && decks.length > 0 ? (
        <ul aria-label="Foliensätze" className="mt-3 flex flex-col gap-2">
          {decks.map((deck) => (
            <MaterialRow
              key={deck.id}
              row={{
                kind: 'folien',
                id: deck.id,
                title: deck.title,
                state: deck.ingest_state,
                meta: [pagesLabel(deck.page_count), formatDate(deck.uploaded_at)].filter(
                  (part): part is string => Boolean(part),
                ),
              }}
              thumb={<DeckThumb deck={deck} />}
            />
          ))}
        </ul>
      ) : null}
    </PanelShell>
  );
}

function sheetMeta(sheet: ExerciseSheet): string[] {
  return [
    sheet.number !== null ? `Blatt ${sheet.number}` : null,
    pagesLabel(sheet.page_count),
    sheet.due_at ? `Abgabe ${formatDate(sheet.due_at)}` : null,
  ].filter((part): part is string => Boolean(part));
}

function SheetPanel({ moduleId, onOpen }: { moduleId: string; onOpen: OpenDocument }) {
  const query = useSheets(moduleId);
  const sheets = useVisibleItems('blatt', query.data);
  return (
    <PanelShell
      kind="blatt"
      moduleId={moduleId}
      loading={query.isPending}
      error={query.isError ? query.error : null}
      empty={sheets?.length === 0}
      onOpen={onOpen}
    >
      {sheets && sheets.length > 0 ? (
        <ul aria-label="Übungsblätter" className="mt-3 flex flex-col gap-2">
          {sheets.map((sheet) => (
            <MaterialRow
              key={sheet.id}
              row={{
                kind: 'blatt',
                id: sheet.id,
                title: sheet.title,
                state: sheet.ingest_state,
                meta: sheetMeta(sheet),
              }}
              thumb={
                <Thumb
                  src={sheet.ingest_state === 'verarbeitet' ? pageThumbUrl('blatt', sheet.id, null, 1) : null}
                />
              }
            />
          ))}
        </ul>
      ) : null}
    </PanelShell>
  );
}

/** Inhalt des Tabs „Vorlesungen“ (Foliensätze) bzw. „Übungen“ (Übungsblätter) eines Moduls. */
export function MaterialPanel({
  moduleId,
  kind,
  onOpen,
}: {
  moduleId: string;
  kind: MaterialKind;
  onOpen: OpenDocument;
}) {
  return kind === 'folien' ? (
    <DeckPanel moduleId={moduleId} onOpen={onOpen} />
  ) : (
    <SheetPanel moduleId={moduleId} onOpen={onOpen} />
  );
}
