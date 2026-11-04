'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { friendlyMessage, isUnreachable } from '../lib/api.ts';
import { moduleHref } from '../lib/nav.ts';
import { moduleColorVar, useVisibleModules } from '../lib/modules.ts';
import { useQuickModules } from '../lib/quick-modules.ts';
import { pickCurrentSemester, useSemesters } from '../lib/semesters.ts';
import { FailedModules } from './FailedModules.tsx';
import { Icon } from './Icon.tsx';

const note = 'sg-collapsible px-3 py-2 text-sm text-text-muted';
const actionLink = 'mt-1 block font-medium text-accent hover:underline';

type Quick = ReturnType<typeof useQuickModules>;

/** Inline-Namensfeld: Enter legt im aktuellen Semester an, das Feld leert sich sofort. */
function QuickAdd({ quick, onClose }: { quick: Quick; onClose: () => void }) {
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    quick.add(name);
    setName('');
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <li className="sg-collapsible px-1">
      <form onSubmit={onSubmit}>
        <input
          ref={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Modulname"
          placeholder="Modulname, Enter"
          autoComplete="off"
          className="w-full rounded-md border border-border-strong bg-bg px-2 py-1 text-sm"
        />
      </form>
    </li>
  );
}

/** Modulliste in der Seitenleiste: Module des aktuellen Semesters (aus `GET /modules`, mit Modulfarbe). */
export function ModuleNav({ onOpenSetup }: { onOpenSetup?: () => void }) {
  const semesters = useSemesters();
  const { query, modules: visible } = useVisibleModules();
  const pathname = usePathname();
  const activeId = useSearchParams().get('id');
  const [adding, setAdding] = useState(false);
  const plusButton = useRef<HTMLButtonElement>(null);

  const current = semesters.data ? pickCurrentSemester(semesters.data) : undefined;
  const failure = semesters.isError ? semesters.error : query.isError ? query.error : null;
  const loading = !failure && (semesters.isPending || query.isPending);
  const noSemester = semesters.data?.length === 0;
  const noCurrent = semesters.data !== undefined && !noSemester && !current;
  const modules = current ? visible?.filter((m) => m.semester_id === current.id) : [];
  const ready = !loading && !failure;
  // Die Warteschlange gehört der Seitenleiste, nicht dem Eingabefeld: Schließt man das Feld, läuft sie weiter
  const quick = useQuickModules({ semesterId: current?.id ?? null, keepDone: false });

  function closeAdd() {
    setAdding(false);
    // Fokus zurück auf das „+“, sonst landet er auf dem Body
    requestAnimationFrame(() => plusButton.current?.focus());
  }

  return (
    <div>
      <div
        className="sg-collapsible flex items-center justify-between gap-2 px-3 pb-1 pt-4 text-xs font-medium text-text-muted"
        id="nav-module-label"
      >
        <span className="min-w-0 truncate">
          Module
          {current ? <span className="font-normal"> · {current.name}</span> : null}
        </span>
        {current ? (
          <button
            ref={plusButton}
            type="button"
            onClick={() => setAdding((a) => !a)}
            aria-label="Modul anlegen"
            aria-expanded={adding}
            title="Modul anlegen"
            className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-border"
          >
            <Icon name="plus" />
          </button>
        ) : null}
      </div>
      <ul aria-labelledby="nav-module-label" className="sg-module-list flex flex-col gap-1">
        {loading && <li className={note}>Lädt …</li>}
        {failure ? (
          <li className={note}>
            {isUnreachable(failure) ? 'Core nicht erreichbar' : friendlyMessage(failure)}
          </li>
        ) : null}
        {ready && current && adding ? <QuickAdd quick={quick} onClose={closeAdd} /> : null}
        {ready && current && quick.entries.length > 0 ? (
          <li className="sg-collapsible">
            <ul aria-label="Wird angelegt" className="px-1">
              {quick.entries.map((m) => (
                <li key={m.id} className="px-2 py-1 text-sm text-text-muted">
                  {m.name} …
                </li>
              ))}
            </ul>
          </li>
        ) : null}
        {ready && current ? (
          <li className="sg-collapsible px-3 text-sm text-text-muted empty:hidden">
            <FailedModules semesterId={current.id} message={quick.error} onRetry={quick.retryFailed} />
          </li>
        ) : null}
        {ready && noSemester ? (
          <li className={note}>
            Noch keine Module
            {onOpenSetup ? (
              <button type="button" onClick={onOpenSetup} className={actionLink}>
                Einrichten
              </button>
            ) : null}
          </li>
        ) : null}
        {ready && noCurrent ? (
          <li className={note}>
            Kein aktuelles Semester
            <Link href="/einstellungen" className={actionLink}>
              In den Einstellungen wählen
            </Link>
          </li>
        ) : null}
        {ready && current && modules?.length === 0 && !adding ? (
          <li className={note}>
            Noch keine Module
            <button type="button" onClick={() => setAdding(true)} className={actionLink}>
              Modul anlegen
            </button>
          </li>
        ) : null}
        {!failure &&
          modules?.map((m) => {
            const label = m.short_name ?? m.name;
            const active = pathname === '/modul' && activeId === m.id;
            return (
              <li key={m.id}>
                <Link
                  href={moduleHref(m.id)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={m.name}
                  title={m.name}
                  className={`sg-nav-link ${active ? 'sg-nav-link-active' : ''}`}
                >
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: moduleColorVar(m.color) }}
                  />
                  <span className="sg-collapsible truncate">{label}</span>
                </Link>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
