// Theme-Skript im <head>: lokale Wahl vor zuletzt bekanntem Standard (T1-19), ohne auf den Core zu warten
import { beforeEach, describe, expect, it } from 'vitest';
import { THEME_INIT_SCRIPT } from '../src/lib/theme-init.ts';

const run = () => new Function(THEME_INIT_SCRIPT)();

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('THEME_INIT_SCRIPT', () => {
  it('ohne lokale Wahl gilt der zuletzt bekannte Standard „dunkel“', () => {
    window.localStorage.setItem('sg-theme-default', 'dark');
    run();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('die lokale Wahl hat Vorrang vor dem Standard', () => {
    window.localStorage.setItem('sg-theme-default', 'dark');
    window.localStorage.setItem('sg-theme', 'light');
    run();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });

  it('ohne beides bleibt das System (kein Attribut)', () => {
    run();
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });
});
