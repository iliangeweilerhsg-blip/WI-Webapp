'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense } from 'react';
import { NAV_MAIN, NAV_SETTINGS, NAV_TOP, type NavItem } from '../lib/nav.ts';
import { CoreStatus } from './CoreStatus.tsx';
import { ModuleNav } from './ModuleNav.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onOpenSearch: () => void;
  /** Neutrale Inbox-Zahl (07 §2: grau, nie rot). Solange der Core keine Zahl liefert, leer. */
  inboxCount?: number | null;
}

function NavLink({ item, collapsed, count }: { item: NavItem; collapsed: boolean; count?: number | null }) {
  const pathname = usePathname();
  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? item.label : undefined}
        title={item.label}
        className={`sg-nav-link ${active ? 'sg-nav-link-active' : ''}`}
      >
        <span aria-hidden="true" className="w-4 shrink-0 text-center">
          {item.icon}
        </span>
        {!collapsed && <span className="flex-1">{item.label}</span>}
        {!collapsed && count ? (
          <span className="text-xs tabular-nums text-text-muted" aria-label={`${count} Einträge`}>
            {count}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

export function Sidebar({ collapsed, onToggle, onOpenSearch, inboxCount = null }: SidebarProps) {
  return (
    <aside
      id="sidebar"
      className={`flex shrink-0 flex-col border-r border-border bg-surface sg-transition-width ${
        collapsed ? 'w-14' : 'w-60'
      }`}
    >
      <div className="flex items-center justify-between px-3 py-3">
        {!collapsed && <span className="text-sm font-semibold">Studien-Gehirn</span>}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls="sidebar-nav"
          aria-label="Seitenleiste ein- oder ausklappen"
          title="Seitenleiste ein- oder ausklappen (⌘\)"
          className="sg-nav-link !w-auto"
        >
          <span aria-hidden="true">☰</span>
        </button>
      </div>

      <nav id="sidebar-nav" aria-label="Hauptnavigation" className="flex-1 overflow-y-auto px-2">
        <ul className="flex flex-col gap-0.5">
          {NAV_TOP.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} />
          ))}
        </ul>
        <Suspense fallback={null}>
          <ModuleNav collapsed={collapsed} />
        </Suspense>
        <ul className="mt-3 flex flex-col gap-0.5">
          {NAV_MAIN.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              collapsed={collapsed}
              count={item.href === '/inbox' ? inboxCount : null}
            />
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-border px-2 py-2">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Suche öffnen"
          aria-keyshortcuts="Meta+K Control+K"
          title="Suche (⌘K)"
          className="sg-nav-link w-full"
        >
          <span aria-hidden="true" className="w-4 shrink-0 text-center">
            ⌕
          </span>
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Suche</span>
              <kbd className="text-xs text-text-muted">⌘K</kbd>
            </>
          )}
        </button>
        <ul>
          <NavLink item={NAV_SETTINGS} collapsed={collapsed} />
        </ul>
        {collapsed ? (
          <ThemeToggle compact />
        ) : (
          <div className="px-1 py-1">
            <ThemeToggle />
          </div>
        )}
        <CoreStatus collapsed={collapsed} />
      </div>
    </aside>
  );
}
