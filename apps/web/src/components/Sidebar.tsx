'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_MAIN, NAV_SETTINGS, NAV_TOP, type NavItem } from '../lib/nav.ts';
import { CoreStatus } from './CoreStatus.tsx';
import { Icon } from './Icon.tsx';
import { ModuleNav } from './ModuleNav.tsx';

interface SidebarProps {
  /** Nur für aria-expanded. Das Aussehen steuert `html[data-sidebar]` per CSS (kein Ruckeln beim Laden). */
  expanded: boolean;
  onToggle: () => void;
  onOpenSearch: () => void;
  /** Öffnet den Einrichtungsdialog (Hinweis in der Modulliste, solange es kein Semester gibt) */
  onOpenSetup?: () => void;
  /** Neutrale Inbox-Zahl (07 §2: grau, nie rot). Solange der Core keine Zahl liefert, leer. */
  inboxCount?: number | null;
  /** Drawer-Zustand für schmale Bildschirme (< 768 px). Breit ignoriert das CSS ihn. */
  drawerOpen?: boolean;
  /** Schmal und offen: Dialog, der den Rest der Seite abschirmt */
  modal?: boolean;
}

function NavLink({ item, count }: { item: NavItem; count?: number | null }) {
  const pathname = usePathname();
  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        aria-label={item.label}
        title={item.label}
        className={`sg-nav-link ${active ? 'sg-nav-link-active' : ''}`}
      >
        <Icon name={item.icon} />
        <span className="sg-collapsible flex-1">{item.label}</span>
        {count ? <span className="sg-collapsible text-xs tabular-nums text-text-muted">{count}</span> : null}
      </Link>
    </li>
  );
}

export function Sidebar({
  expanded,
  onToggle,
  onOpenSearch,
  onOpenSetup,
  inboxCount = null,
  drawerOpen = false,
  modal = false,
}: SidebarProps) {
  return (
    <aside
      id="sidebar"
      data-drawer={drawerOpen ? 'open' : 'closed'}
      {...(modal ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Hauptmenü' } : {})}
      className="flex shrink-0 flex-col border-r border-border bg-surface"
    >
      <div className="flex items-center justify-between px-3 py-3">
        <span className="sg-collapsible text-sm font-semibold">Studien-Gehirn</span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls="sidebar-nav"
          aria-label={drawerOpen ? 'Menü schließen' : 'Seitenleiste ein- oder ausklappen'}
          aria-keyshortcuts="Meta+\"
          title="Seitenleiste ein- oder ausklappen (⌘\)"
          className="sg-nav-link sg-toggle"
        >
          <Icon name="menu" />
        </button>
      </div>

      <nav id="sidebar-nav" aria-label="Hauptnavigation" className="flex-1 overflow-y-auto px-2">
        <ul className="flex flex-col gap-1">
          {NAV_TOP.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </ul>
        <ModuleNav {...(onOpenSetup ? { onOpenSetup } : {})} />
        <ul className="mt-4 flex flex-col gap-1">
          {NAV_MAIN.map((item) => (
            <NavLink key={item.href} item={item} count={item.href === '/inbox' ? inboxCount : null} />
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-1 border-t border-border px-2 py-2">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Suche öffnen"
          aria-keyshortcuts="Meta+K Control+K"
          title="Suche (⌘K)"
          className="sg-nav-link w-full"
        >
          <Icon name="search" />
          <span className="sg-collapsible flex-1 text-left">Suche</span>
          <kbd className="sg-collapsible text-xs text-text-muted">⌘K</kbd>
        </button>
        <ul>
          <NavLink item={NAV_SETTINGS} />
        </ul>
        <CoreStatus />
      </div>
    </aside>
  );
}
