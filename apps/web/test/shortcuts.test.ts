import { describe, expect, it } from 'vitest';
import { matchShortcut } from '../src/lib/shortcuts.ts';

const key = (
  k: string,
  mod: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {},
) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mod,
});

describe('matchShortcut (07 §10)', () => {
  it('ordnet die globalen Kürzel zu', () => {
    expect(matchShortcut(key('k', { metaKey: true }))).toBe('search');
    expect(matchShortcut(key('\\', { metaKey: true }))).toBe('toggleSidebar');
    expect(matchShortcut(key('[', { metaKey: true }))).toBe('back');
    expect(matchShortcut(key(']', { metaKey: true }))).toBe('forward');
  });

  it('akzeptiert Strg als Ersatz für ⌘', () => {
    expect(matchShortcut(key('k', { ctrlKey: true }))).toBe('search');
  });

  it('ignoriert Tasten ohne ⌘/Strg und Kombinationen mit Alt oder Umschalt', () => {
    expect(matchShortcut(key('k'))).toBeNull();
    expect(matchShortcut(key('k', { metaKey: true, shiftKey: true }))).toBeNull();
    expect(matchShortcut(key('k', { metaKey: true, altKey: true }))).toBeNull();
    expect(matchShortcut(key('x', { metaKey: true }))).toBeNull();
  });
});
