'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Module, MoodleItem } from '@sg/shared';
import { apiBase } from '../lib/api.ts';
import { moduleColorVar, useVisibleModules } from '../lib/modules.ts';
import { moduleHref } from '../lib/nav.ts';
import { moodleErrorMessage, useDecideItem, useMoodleItems, useSingleFlight } from '../lib/moodle.ts';
import { useToast } from '../lib/toast.tsx';
import { CoreHint } from './CoreHint.tsx';
import { EmptyState } from './Placeholder.tsx';

const button =
  'min-h-9 rounded-md border border-border px-3 py-1 text-sm hover:bg-surface disabled:opacity-50 sg-transition';

const DECISIONS = [
  { kind: 'folien', label: 'Als Folien', done: 'Als Folien übernommen' },
  { kind: 'uebung', label: 'Als Übung', done: 'Als Übungsblatt übernommen' },
  { kind: 'ignoriert', label: 'Ignorieren', done: 'Ignoriert' },
] as const;

const sizeFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${sizeFormat.format(Math.max(1, bytes / 1024))} KB`;
  return `${sizeFormat.format(bytes / (1024 * 1024))} MB`;
}

function ItemRow({
  item,
  onDecided,
  onUndo,
}: {
  item: MoodleItem;
  onDecided: (item: MoodleItem) => void;
  onUndo: (item: MoodleItem) => void;
}) {
  const decide = useDecideItem();
  const once = useSingleFlight();
  const toast = useToast();

  function choose(decision: (typeof DECISIONS)[number]) {
    once((done) =>
      decide.mutate(
        { id: item.id, kind: decision.kind },
        {
          onSettled: done,
          onSuccess: () => {
            onDecided(item);
            const message = `${decision.done}. Gilt auch für weitere Dateien in „${item.activity_name}“.`;
            if (decision.kind !== 'ignoriert') {
              toast.show({ message });
              return;
            }
            // „Ignorieren“ lässt sich zurücknehmen (R15): zurück auf offen
            toast.show({
              message,
              actionLabel: 'Rückgängig',
              onAction: () => onUndo(item),
            });
          },
          onError: (error) => toast.show({ message: moodleErrorMessage(error) }),
        },
      ),
    );
  }

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
      data-moodle-item={item.id}
    >
      <div className="min-w-0 flex-1 basis-60">
        <p className="break-words">
          <span aria-hidden="true" className="mr-2 text-text-muted">
            ▤
          </span>
          {item.filename}
        </p>
        <p className="text-sm text-text-muted">
          {item.activity_name} · {formatSize(item.size_bytes)} ·{' '}
          <a
            href={`${apiBase()}/moodle/file?ref=${encodeURIComponent(item.file_ref)}`}
            target="_blank"
            rel="noreferrer noopener"
            className="underline-offset-2 hover:text-text hover:underline"
          >
            Ansehen
          </a>
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Entscheidung für ${item.filename}`}>
        {DECISIONS.map((decision) => (
          <button
            key={decision.kind}
            type="button"
            className={button}
            disabled={decide.isPending}
            onClick={() => choose(decision)}
          >
            {decision.label}
          </button>
        ))}
      </div>
    </li>
  );
}

function group(items: readonly MoodleItem[], modules: readonly Module[]) {
  const byModule = new Map<string, { module: Module | undefined; items: MoodleItem[] }>();
  for (const item of items) {
    const key = item.module_id ?? '';
    const entry = byModule.get(key) ?? { module: modules.find((m) => m.id === item.module_id), items: [] };
    entry.items.push(item);
    byModule.set(key, entry);
  }
  return [...byModule.entries()];
}

/**
 * Inbox (07 §3.11): gruppiert nach Quelle. Bis die Vorschläge aus den Vorlesungen kommen (Phase 2), stehen hier
 * die Moodle-Dateien, die der Abgleich nicht sicher einordnen konnte (F-MDL-04): „Als Folien / Übung / ignorieren“.
 */
export function MoodleInbox() {
  const items = useMoodleItems({ kind: 'offen' });
  const { modules } = useVisibleModules();
  // Nach einer Entscheidung: Fokus auf die nächste Datei, sonst auf die Überschrift (Review #134, N3)
  const [focusAfter, setFocusAfter] = useState<{ next: string | null } | null>(null);
  const data = items.data;
  useEffect(() => {
    if (!focusAfter || !data) return;
    const next = focusAfter.next;
    if (next !== null && data.some((i) => i.id === next)) {
      document.querySelector<HTMLButtonElement>(`[data-moodle-item="${next}"] button`)?.focus();
    } else {
      document.getElementById('screen-title')?.focus();
    }
    setFocusAfter(null);
  }, [focusAfter, data]);

  // Auf Listenebene: die Zeile ist nach der Entscheidung schon verschwunden, wenn „Rückgängig“ kommt
  const undo = useDecideItem();
  const toast = useToast();
  function onUndo(item: MoodleItem) {
    undo.mutate(
      { id: item.id, kind: 'offen' },
      { onError: (error) => toast.show({ message: moodleErrorMessage(error) }) },
    );
  }

  function onDecided(item: MoodleItem) {
    const list = data ?? [];
    const index = list.findIndex((i) => i.id === item.id);
    const next = list[index + 1] ?? list[index - 1] ?? null;
    setFocusAfter({ next: next?.id ?? null });
  }

  if (items.isError) return <CoreHint error={items.error} />;
  if (!items.data) {
    return (
      <p role="status" aria-busy="true" className="text-md text-text-muted">
        Lädt …
      </p>
    );
  }
  if (items.data.length === 0) {
    return (
      <EmptyState
        action={
          <Link
            href="/einstellungen?bereich=moodle"
            className="inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface"
          >
            Moodle-Kurse zuordnen
          </Link>
        }
      >
        Nichts zu entscheiden. Dateien aus Moodle, die sich nicht sicher einordnen lassen, landen hier.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      {group(items.data, modules ?? []).map(([key, entry]) => (
        <section key={key} aria-labelledby={`inbox-${key || 'ohne'}`}>
          <h2
            id={`inbox-${key || 'ohne'}`}
            className="flex items-center gap-2 text-sm font-medium text-text-muted"
          >
            {entry.module ? (
              <span
                aria-hidden="true"
                className="inline-block size-2.5 rounded-full"
                style={{ backgroundColor: moduleColorVar(entry.module.color) }}
              />
            ) : null}
            <span>
              Moodle ·{' '}
              {entry.module ? (
                <Link href={moduleHref(entry.module.id)} className="hover:text-text hover:underline">
                  {entry.module.name}
                </Link>
              ) : (
                'ohne Modul'
              )}
            </span>
            <span className="tabular-nums">{entry.items.length}</span>
          </h2>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border px-4">
            {entry.items.map((item) => (
              <ItemRow key={item.id} item={item} onDecided={onDecided} onUndo={onUndo} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
