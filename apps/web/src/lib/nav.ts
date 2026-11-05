import type { IconName } from '../components/Icon.tsx';

/** Hauptnavigation (07 §2). Jeder Bildschirm hat eine URL; Modul-Details nutzen Query-Parameter (VERTRAEGE §5). */
export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export const NAV_TOP: NavItem[] = [{ href: '/', label: 'Heute', icon: 'today' }];

export const NAV_MAIN: NavItem[] = [
  { href: '/bibliothek', label: 'Bibliothek', icon: 'library' },
  { href: '/lernen', label: 'Lernen', icon: 'learn' },
  { href: '/kalender', label: 'Kalender', icon: 'calendar' },
  { href: '/planer', label: 'Planer', icon: 'planner' },
  { href: '/videos', label: 'Videos', icon: 'videos' },
  { href: '/inbox', label: 'Inbox', icon: 'inbox' },
];

export const NAV_SETTINGS: NavItem = { href: '/einstellungen', label: 'Einstellungen', icon: 'settings' };

export function moduleHref(id: string): string {
  return `/modul?id=${encodeURIComponent(id)}`;
}
