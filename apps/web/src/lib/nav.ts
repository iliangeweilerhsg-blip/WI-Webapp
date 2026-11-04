/** Hauptnavigation (07 §2). Jeder Bildschirm hat eine URL; Modul-Details nutzen Query-Parameter (VERTRAEGE §5). */
export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export const NAV_TOP: NavItem[] = [{ href: '/', label: 'Heute', icon: '◉' }];

export const NAV_MAIN: NavItem[] = [
  { href: '/bibliothek', label: 'Bibliothek', icon: '◇' },
  { href: '/lernen', label: 'Lernen', icon: '◇' },
  { href: '/planer', label: 'Planer', icon: '◇' },
  { href: '/videos', label: 'Videos', icon: '◇' },
  { href: '/inbox', label: 'Inbox', icon: '◇' },
];

export const NAV_SETTINGS: NavItem = { href: '/einstellungen', label: 'Einstellungen', icon: '⚙' };

export function moduleHref(id: string): string {
  return `/modul?id=${encodeURIComponent(id)}`;
}
