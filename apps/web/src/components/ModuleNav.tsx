'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { friendlyMessage, isUnreachable } from '../lib/api.ts';
import { moduleHref } from '../lib/nav.ts';
import { moduleColorVar, useModules } from '../lib/modules.ts';

/** Modulliste in der Seitenleiste (aus `GET /modules`, mit Modulfarbe). */
export function ModuleNav() {
  const modules = useModules();
  const pathname = usePathname();
  const activeId = useSearchParams().get('id');

  return (
    <div>
      <div
        className="sg-collapsible px-3 pb-1 pt-4 text-xs font-medium text-text-muted"
        id="nav-module-label"
      >
        Module
      </div>
      <ul aria-labelledby="nav-module-label" className="sg-module-list flex flex-col gap-1">
        {modules.isPending && <li className="sg-collapsible px-3 py-2 text-sm text-text-muted">Lädt …</li>}
        {modules.isError && (
          <li className="sg-collapsible px-3 py-2 text-sm text-text-muted">
            {isUnreachable(modules.error) ? 'Core nicht erreichbar' : friendlyMessage(modules.error)}
          </li>
        )}
        {modules.data?.length === 0 && (
          <li className="sg-collapsible px-3 py-2 text-sm text-text-muted">Noch keine Module</li>
        )}
        {modules.data?.map((m) => {
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
