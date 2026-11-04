'use client';

import { useRef, useState, type FormEvent } from 'react';
import type { CalendarEvent, CalendarEventKind, CalendarEventUpdate, Module } from '@sg/shared';
import {
  EDITABLE_KINDS,
  KIND_LABELS,
  calendarErrorMessage,
  dayKey,
  formatDay,
  formatEventTime,
  groupByDay,
  useUpdateEvent,
} from '../lib/calendar.ts';
import { moduleColorVar } from '../lib/modules.ts';
import { useToast } from '../lib/toast.tsx';

const smallButton = 'rounded-md border border-border px-3 py-1 text-sm hover:bg-surface disabled:opacity-50';
const select = 'mt-1 w-full rounded-md border border-border-strong bg-bg px-3 py-2 text-md font-normal';

function ModuleChip({ module }: { module: Module | undefined }) {
  if (!module) return <span className="text-sm text-text-muted">Kein Modul</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span
        aria-hidden="true"
        className="inline-block size-2.5 rounded-full"
        style={{ backgroundColor: moduleColorVar(module.color) }}
      />
      {module.name}
    </span>
  );
}

/** Modul und Art eines Termins ändern; bei Serien wahlweise für die ganze Serie oder nur diesen Termin (F-KAL-02). */
function EventEditor({
  event,
  modules,
  onClose,
}: {
  event: CalendarEvent;
  modules: readonly Module[];
  /** `restoreFocus`: Der Fokus geht zurück auf den Knopf, der den Editor geöffnet hat */
  onClose: () => void;
}) {
  const update = useUpdateEvent();
  const toast = useToast();
  const [moduleId, setModuleId] = useState(event.module_id ?? '');
  const [kind, setKind] = useState<CalendarEventKind>(event.kind);
  const [scope, setScope] = useState<'serie' | 'einzeln'>('serie');
  const [error, setError] = useState<string | null>(null);
  const isSeries = event.recurrence_id !== null;
  const changed = moduleId !== (event.module_id ?? '') || kind !== event.kind;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!changed || update.isPending) return;
    setError(null);
    const patch: CalendarEventUpdate = { scope: isSeries ? scope : 'einzeln' };
    if (moduleId !== (event.module_id ?? '')) patch.module_id = moduleId === '' ? null : moduleId;
    if (kind !== event.kind) patch.kind = kind;
    try {
      const result = await update.mutateAsync({ id: event.id, patch });
      toast.show({
        message:
          result.items.length === 1
            ? 'Zuordnung gespeichert'
            : `Zuordnung gespeichert · ${result.items.length} Termine`,
      });
      onClose();
    } catch (failure) {
      setError(calendarErrorMessage(failure));
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label={`Termin „${event.title}“ bearbeiten`}
      className="mt-3 rounded-md border border-border bg-bg p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Modul
          <select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className={select}>
            <option value="">Kein Modul</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Art
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as CalendarEventKind)}
            className={select}
          >
            {[...new Set<CalendarEventKind>([...EDITABLE_KINDS, event.kind])].map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {isSeries ? (
        <fieldset className="mt-3">
          <legend className="text-sm font-medium">Gilt für</legend>
          <div className="mt-1 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`scope-${event.id}`}
                checked={scope === 'serie'}
                onChange={() => setScope('serie')}
              />
              Ganze Serie
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`scope-${event.id}`}
                checked={scope === 'einzeln'}
                onChange={() => setScope('einzeln')}
              />
              Nur diesen Termin
            </label>
          </div>
        </fieldset>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm hover:bg-surface">
          Abbrechen
        </button>
        <button
          type="submit"
          disabled={!changed || update.isPending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast disabled:opacity-50"
        >
          Speichern
        </button>
      </div>
    </form>
  );
}

function EventItem({ event, modules }: { event: CalendarEvent; modules: readonly Module[] }) {
  const [editing, setEditing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const module = modules.find((m) => m.id === event.module_id);
  const close = () => {
    setEditing(false);
    // Der Editor verschwindet samt Fokus: zurück zum Auslöser, nicht auf <body>
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const label = module ? 'Ändern' : 'Zuordnen';
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className={`font-medium ${event.cancelled ? 'text-text-muted line-through' : ''}`}>
            {event.title}
          </p>
          <p className="mt-0.5 text-sm text-text-muted">
            <time>{formatEventTime(event)}</time>
            {event.location ? ` · ${event.location}` : ''}
            {` · ${KIND_LABELS[event.kind]}`}
            {event.cancelled ? ' · entfällt' : ''}
          </p>
          <p className="mt-1">
            <ModuleChip module={module} />
          </p>
        </div>
        <button
          ref={trigger}
          type="button"
          aria-expanded={editing}
          // Der sichtbare Text steht am Anfang des Namens (WCAG 2.5.3)
          aria-label={`${label}: ${event.title}`}
          onClick={() => (editing ? close() : setEditing(true))}
          className={smallButton}
        >
          {label}
        </button>
      </div>
      {editing ? <EventEditor event={event} modules={modules} onClose={close} /> : null}
    </li>
  );
}

/** Die Termine einer Woche, Tag für Tag (Ortszeit). Ruhig: Tage ohne Termine bleiben kurz, nichts ist rot. */
export function CalendarWeek({
  weekStart,
  events,
  modules,
  today,
}: {
  weekStart: Date;
  events: readonly CalendarEvent[];
  modules: readonly Module[];
  today: Date | null;
}) {
  const days = groupByDay(weekStart, events);
  const todayKey = today ? dayKey(today) : null;
  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {days.map((day) => (
        <section key={day.key} aria-label={formatDay(day.date)} className="px-4 py-3">
          <h3 className={`text-sm font-medium ${day.key === todayKey ? 'text-text' : 'text-text-muted'}`}>
            {formatDay(day.date)}
            {day.key === todayKey ? (
              <span className="ml-2 rounded-sm bg-accent-soft px-2 py-0.5 text-xs">heute</span>
            ) : null}
          </h3>
          {day.events.length === 0 ? (
            <p className="mt-1 text-sm text-text-muted">Keine Termine</p>
          ) : (
            <ul className="mt-1 divide-y divide-border">
              {day.events.map((event) => (
                <EventItem key={event.id} event={event} modules={modules} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
