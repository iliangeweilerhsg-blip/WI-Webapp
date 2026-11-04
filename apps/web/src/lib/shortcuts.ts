/** Globale Tastenkürzel (07 §10, Kontext „überall"). */
export type GlobalAction = 'search' | 'toggleSidebar' | 'back' | 'forward';

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  target?: EventTarget | null;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** Läuft gerade eine Texteingabe? Dann gehören Tasten dem Feld. */
export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Ordnet einen Tastendruck einer globalen Aktion zu. Abgleich über `e.key`.
 * - Am Mac gilt nur ⌘, sonst nur Strg (so bleibt Strg+K in Textfeldern am Mac frei).
 * - `[`, `]`, `\` brauchen auf der deutschen Mac-Tastatur Alt/Umschalt (⌥5, ⌥6, ⌥⇧7), dort werden sie nicht abgelehnt.
 * - ⌘K ist mit Alt oder Umschalt keine Suche.
 * - Wiederholte Tasten und IME-Eingaben lösen nichts aus. In Eingabefeldern gilt nur ⌘K.
 */
export function matchShortcut(e: KeyLike, mac: boolean = isMacPlatform()): GlobalAction | null {
  if (e.repeat || e.isComposing) return null;
  const modifier = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!modifier) return null;

  if (e.key === 'k' || e.key === 'K') {
    return e.altKey || e.shiftKey ? null : 'search';
  }
  if (isEditableTarget(e.target)) return null;
  switch (e.key) {
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
