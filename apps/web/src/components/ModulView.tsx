'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Module, ModuleUpdate } from '@sg/shared';
import { friendlyMessage } from '../lib/api.ts';
import {
  MODULE_COLORS,
  UNDO_WINDOW_MS,
  moduleColorVar,
  scheduleModuleDelete,
  undoModuleDelete,
  useUpdateModule,
  useVisibleModules,
} from '../lib/modules.ts';
import { useToast } from '../lib/toast.tsx';
import { CoreHint } from './CoreHint.tsx';
import { EmptyState } from './Placeholder.tsx';

const TABS = [
  {
    id: 'vorlesungen',
    label: 'Vorlesungen',
    empty: 'Noch keine Vorlesungen. Das Ablegen von Folien kommt in einem der nächsten Schritte.',
  },
  {
    id: 'uebungen',
    label: 'Übungen',
    empty: 'Noch keine Übungen. Übungsblätter erscheinen hier, sobald du sie ablegen kannst.',
  },
  {
    id: 'konzepte',
    label: 'Konzepte',
    empty: 'Noch keine Konzepte. Sie entstehen aus den Vorlesungen und Übungen dieses Moduls.',
  },
  {
    id: 'altklausuren',
    label: 'Altklausuren',
    empty: 'Noch keine Altklausuren. Auch sie kannst du später hier ablegen.',
  },
] as const;

type TabId = (typeof TABS)[number]['id'];

function Title({ children }: { children: string }) {
  return (
    <h1 id="screen-title" className="text-xxl font-semibold">
      {children}
    </h1>
  );
}

function ModuleTabs() {
  const [active, setActive] = useState<TabId>('vorlesungen');
  const current = TABS.find((t) => t.id === active) ?? TABS[0];

  function onKeyDown(e: KeyboardEvent, index: number) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length];
    if (!next) return;
    setActive(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  return (
    <div className="mt-6">
      <div role="tablist" aria-label="Bereiche des Moduls" className="flex gap-1 border-b border-border">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => setActive(tab.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm sg-transition ${
              active === tab.id
                ? 'border-accent font-medium text-text'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`panel-${current.id}`}
        aria-labelledby={`tab-${current.id}`}
        tabIndex={0}
        className="mt-4"
      >
        <EmptyState>{current.empty}</EmptyState>
      </div>
    </div>
  );
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function ModuleEditForm({ module, onClose }: { module: Module; onClose: () => void }) {
  const update = useUpdateModule();
  const [name, setName] = useState(module.name);
  const [shortName, setShortName] = useState(module.short_name ?? '');
  const [color, setColor] = useState<string>(module.color);
  const [ects, setEcts] = useState(module.ects != null ? String(module.ects) : '');
  const [examType, setExamType] = useState(module.exam_type ?? '');
  const [lecturer, setLecturer] = useState(module.lecturer ?? '');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || update.isPending) return;
    const ectsValue = ects.trim() === '' ? null : Number(ects.replace(',', '.'));
    if (ectsValue !== null && (!Number.isFinite(ectsValue) || ectsValue < 0)) {
      setError('ECTS braucht eine Zahl ab 0.');
      return;
    }
    setError(null);
    const patch: ModuleUpdate = {
      name: trimmedName,
      short_name: emptyToNull(shortName),
      color: color as ModuleUpdate['color'],
      ects: ectsValue,
      exam_type: emptyToNull(examType),
      lecturer: emptyToNull(lecturer),
    };
    try {
      await update.mutateAsync({ id: module.id, patch });
      onClose();
    } catch (failure) {
      setError(friendlyMessage(failure));
    }
  }

  const field = 'mt-1 w-full rounded-md border border-border-strong bg-bg px-3 py-2 text-md';

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Modul bearbeiten"
      className="mt-4 rounded-lg border border-border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium sm:col-span-2">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} autoFocus />
        </label>
        <label className="block text-sm font-medium">
          Kürzel
          <input
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            maxLength={12}
            className={field}
          />
        </label>
        <label className="block text-sm font-medium">
          ECTS
          <input
            value={ects}
            onChange={(e) => setEcts(e.target.value)}
            inputMode="decimal"
            className={field}
          />
        </label>
        <label className="block text-sm font-medium">
          Prüfungsform
          <input
            value={examType}
            onChange={(e) => setExamType(e.target.value)}
            placeholder="z. B. Klausur"
            className={field}
          />
        </label>
        <label className="block text-sm font-medium">
          Dozent oder Dozentin
          <input value={lecturer} onChange={(e) => setLecturer(e.target.value)} className={field} />
        </label>
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium">Farbe</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {MODULE_COLORS.map((token, index) => (
              <label key={token} className="cursor-pointer">
                <input
                  type="radio"
                  name="module-color"
                  value={token}
                  checked={color === token}
                  onChange={() => setColor(token)}
                  aria-label={`Farbe ${index + 1}`}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className="block size-7 rounded-full border-2 border-transparent peer-checked:border-text peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
                  style={{ backgroundColor: moduleColorVar(token) }}
                />
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-text-muted">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm hover:bg-surface">
          Abbrechen
        </button>
        <button
          type="submit"
          disabled={!name.trim() || update.isPending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast disabled:opacity-50"
        >
          Speichern
        </button>
      </div>
    </form>
  );
}

function ModuleView() {
  const id = useSearchParams().get('id');
  const { query, modules } = useVisibleModules();
  const module = id ? modules?.find((m) => m.id === id) : undefined;
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();

  if (!id) {
    return (
      <>
        <Title>Modul</Title>
        <div className="mt-6">
          <EmptyState>Wähle links ein Modul aus.</EmptyState>
        </div>
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <Title>Modul</Title>
        <div className="mt-6">
          <CoreHint error={query.error} />
        </div>
      </>
    );
  }
  if (query.isPending) return <Title>Modul</Title>;
  if (!module) {
    return (
      <>
        <Title>Modul</Title>
        <div className="mt-6">
          <EmptyState>Dieses Modul gibt es nicht (mehr). Wähle links ein anderes aus.</EmptyState>
        </div>
      </>
    );
  }

  function onDelete(target: Module) {
    // Sofort ausblenden; gelöscht wird erst nach Ablauf des Toasts (R15)
    scheduleModuleDelete(client, target, () =>
      toast.show({ message: `„${target.name}“ konnte nicht gelöscht werden. Es ist wieder da.` }),
    );
    toast.show({
      message: 'Modul gelöscht',
      actionLabel: 'Rückgängig',
      onAction: () => undoModuleDelete(target.id),
      durationMs: UNDO_WINDOW_MS,
    });
    router.push('/');
  }

  const meta = [module.exam_type, module.ects != null ? `${module.ects} ECTS` : null, module.lecturer]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 id="screen-title" className="flex items-center gap-3 text-xxl font-semibold">
            <span
              aria-hidden="true"
              className="size-4 shrink-0 rounded-full"
              style={{ backgroundColor: moduleColorVar(module.color) }}
            />
            <span className="truncate">{module.name}</span>
            {module.short_name ? (
              <span className="shrink-0 rounded-sm border border-border px-2 py-0.5 text-sm font-normal text-text-muted">
                {module.short_name}
              </span>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-text-muted">{meta || 'Noch keine Angaben'}</p>
        </div>
        {!editing ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface"
            >
              Bearbeiten
            </button>
            <button
              type="button"
              onClick={() => onDelete(module)}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface"
            >
              Löschen
            </button>
          </div>
        ) : null}
      </div>

      {editing ? (
        <ModuleEditForm key={module.updated_at} module={module} onClose={() => setEditing(false)} />
      ) : null}

      <ModuleTabs />
    </>
  );
}

/** Modul-Übersicht (07 §3.2) – Route mit Query-Parameter `?id=` (VERTRAEGE §5). */
export function ModulView() {
  return (
    <section aria-labelledby="screen-title">
      <Suspense fallback={null}>
        <ModuleView />
      </Suspense>
    </section>
  );
}
