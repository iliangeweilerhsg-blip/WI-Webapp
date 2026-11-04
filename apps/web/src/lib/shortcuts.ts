/** Globale Tastenkürzel (07 §10, Kontext „überall"). */
export type GlobalAction = 'search' | 'toggleSidebar' | 'back' | 'forward';

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Ordnet einen Tastendruck einer globalen Aktion zu.
 * ⌘ am Mac, Strg an anderen Systemen. Mit zusätzlichem Alt oder Umschalt gibt es keine Aktion.
 */
export function matchShortcut(e: KeyLike): GlobalAction | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null;
  switch (e.key) {
    case 'k':
    case 'K':
      return 'search';
    case '\\':
      return 'toggleSidebar';
    case '[':
      return 'back';
    case ']':
      return 'forward';
    default:
      return null;
  }
}
