'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { friendlyMessage, isUnreachable } from '../lib/api.ts';
import { moduleHref } from '../lib/nav.ts';
import { moduleColorVar, useModules } from '../lib/modules.ts';

/** Modulliste in der Seitenleiste (aus `GET /modules`, mit Modulfarbe). */
export function ModuleNav({ collapsed }: { collapsed: boolean }) {
  const modules = useModules();
  const pathname = usePathname();
  const activeId = useSearchParams().get('id');

  return (
    <div>
      <div
        className={`px-3 pb-1 pt-4 text-xs font-medium text-text-muted ${collapsed ? 'sr-only' : ''}`}
        id="nav-module-label"
      >
        Module
      </div>
      <ul aria-labelledby="nav-module-label" className="flex flex-col gap-0.5">
        {modules.isPending && !collapsed && <li className="px-3 py-1.5 text-sm text-text-muted">Lädt …</li>}
        {modules.isError && !collapsed && (
          <li className="px-3 py-1.5 text-sm text-text-muted">
            {isUnreachable(modules.error) ? 'Core nicht erreichbar' : friendlyMessage(modules.error)}
          </li>
        )}
        {modules.data?.length === 0 && !collapsed && (
          <li className="px-3 py-1.5 text-sm text-text-muted">Noch keine Module</li>
        )}
        {modules.data?.map((m) => {
          const label = m.short_name ?? m.name;
          const active = pathname === '/modul' && activeId === m.id;
          return (
            <li key={m.id}>
              <Link
                href={moduleHref(m.id)}
                aria-current={active ? 'page' : undefined}
                aria-label={collapsed ? m.name : undefined}
                title={m.name}
                className={`sg-nav-link ${active ? 'sg-nav-link-active' : ''}`}
              >
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: moduleColorVar(m.color) }}
                />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
