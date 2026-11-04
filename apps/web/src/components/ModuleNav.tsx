'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { friendlyMessage, isUnreachable } from '../lib/api.ts';
import { moduleHref } from '../lib/nav.ts';
import { moduleColorVar, useVisibleModules } from '../lib/modules.ts';
import { pickCurrentSemester, useSemesters } from '../lib/semesters.ts';

/** Modulliste in der Seitenleiste: Module des aktuellen Semesters (aus `GET /modules`, mit Modulfarbe). */
export function ModuleNav({ onOpenSetup }: { onOpenSetup?: () => void }) {
  const semesters = useSemesters();
  const { query, modules: visible } = useVisibleModules();
  const pathname = usePathname();
  const activeId = useSearchParams().get('id');

  const current = semesters.data ? pickCurrentSemester(semesters.data) : undefined;
  const failure = semesters.isError ? semesters.error : query.isError ? query.error : null;
  const loading = !failure && (semesters.isPending || query.isPending);
  const noSemester = semesters.data?.length === 0;
  const modules = current ? visible?.filter((m) => m.semester_id === current.id) : [];

  return (
    <div>
      <div
        className="sg-collapsible px-3 pb-1 pt-4 text-xs font-medium text-text-muted"
        id="nav-module-label"
      >
        Module
      </div>
      <ul aria-labelledby="nav-module-label" className="sg-module-list flex flex-col gap-1">
        {loading && <li className="sg-collapsible px-3 py-2 text-sm text-text-muted">Lädt …</li>}
        {failure ? (
          <li className="sg-collapsible px-3 py-2 text-sm text-text-muted">
            {isUnreachable(failure) ? 'Core nicht erreichbar' : friendlyMessage(failure)}
          </li>
        ) : null}
        {!loading && !failure && modules?.length === 0 && (
          <li className="sg-collapsible px-3 py-2 text-sm text-text-muted">
            Noch keine Module
            {noSemester && onOpenSetup ? (
              <button
                type="button"
                onClick={onOpenSetup}
                className="mt-1 block font-medium text-accent hover:underline"
              >
                Einrichten
              </button>
            ) : null}
          </li>
        )}
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
