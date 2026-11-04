import { describe, expect, it } from 'vitest';
import { matchShortcut, type KeyLike } from '../src/lib/shortcuts.ts';

const key = (k: string, mod: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mod,
});

describe('matchShortcut (07 §10)', () => {
  it('ordnet am Mac die globalen Kürzel mit ⌘ zu', () => {
    expect(matchShortcut(key('k', { metaKey: true }), true)).toBe('search');
    expect(matchShortcut(key('\\', { metaKey: true }), true)).toBe('toggleSidebar');
    expect(matchShortcut(key('[', { metaKey: true }), true)).toBe('back');
    expect(matchShortcut(key(']', { metaKey: true }), true)).toBe('forward');
  });

  it('am Mac löst Strg nichts aus (Strg+K bleibt in Textfeldern frei), anderswo nur Strg', () => {
    expect(matchShortcut(key('k', { ctrlKey: true }), true)).toBeNull();
    expect(matchShortcut(key('k', { ctrlKey: true }), false)).toBe('search');
    expect(matchShortcut(key('k', { metaKey: true }), false)).toBeNull();
  });

  it('lehnt [ ] \\ mit Alt/Umschalt nicht ab (deutsche Mac-Tastatur: ⌥5, ⌥6, ⌥⇧7)', () => {
    expect(matchShortcut(key('[', { metaKey: true, altKey: true }), true)).toBe('back');
    expect(matchShortcut(key(']', { metaKey: true, altKey: true }), true)).toBe('forward');
    expect(matchShortcut(key('\\', { metaKey: true, altKey: true, shiftKey: true }), true)).toBe(
      'toggleSidebar',
    );
  });

  it('⌘K bleibt mit Alt oder Umschalt frei; unbekannte Tasten und fehlendes ⌘ lösen nichts aus', () => {
    expect(matchShortcut(key('k', { metaKey: true, shiftKey: true }), true)).toBeNull();
    expect(matchShortcut(key('k', { metaKey: true, altKey: true }), true)).toBeNull();
    expect(matchShortcut(key('k'), true)).toBeNull();
    expect(matchShortcut(key('x', { metaKey: true }), true)).toBeNull();
  });

  it('ignoriert Tastenwiederholung und IME-Eingabe', () => {
    expect(matchShortcut(key('k', { metaKey: true, repeat: true }), true)).toBeNull();
    expect(matchShortcut(key('[', { metaKey: true, isComposing: true }), true)).toBeNull();
  });

  it('in Eingabefeldern gilt nur ⌘K', () => {
    const input = document.createElement('input');
    expect(matchShortcut(key('k', { metaKey: true, target: input }), true)).toBe('search');
    expect(matchShortcut(key('[', { metaKey: true, target: input }), true)).toBeNull();
    expect(matchShortcut(key('\\', { metaKey: true, target: input }), true)).toBeNull();
    const area = document.createElement('textarea');
    expect(matchShortcut(key(']', { metaKey: true, target: area }), true)).toBeNull();
    expect(matchShortcut(key(']', { metaKey: true, target: document.createElement('div') }), true)).toBe(
      'forward',
    );
  });
});
