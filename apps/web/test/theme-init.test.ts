// Theme-Skript im <head>: lokale Wahl vor zuletzt bekanntem Standard (T1-19), ohne auf den Core zu warten
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_INIT_SCRIPT } from '../src/lib/theme-init.ts';

const run = () => new Function(THEME_INIT_SCRIPT)();

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-sidebar');
  document.documentElement.removeAttribute('data-sidebar-auto');
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
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

describe('THEME_INIT_SCRIPT auf /session (dunkel als Standard, 07-UX §3.3)', () => {
  const root = document.documentElement;
  const onSession = () => window.history.replaceState(null, '', '/session?id=x');

  it('ohne Wahl und ohne gespeicherten Standard ist /session dunkel, andere Seiten bleiben beim System', () => {
    onSession();
    run();
    expect(root).toHaveAttribute('data-theme', 'dark');
    root.removeAttribute('data-theme');
    window.history.replaceState(null, '', '/kalender');
    run();
    expect(root).not.toHaveAttribute('data-theme');
  });

  it('eine eigene Wahl „Hell“ und ein gespeicherter Standard „hell“ gehen vor', () => {
    onSession();
    window.localStorage.setItem('sg-theme', 'light');
    run();
    expect(root).toHaveAttribute('data-theme', 'light');
    window.localStorage.removeItem('sg-theme');
    window.localStorage.setItem('sg-theme-default', 'light');
    run();
    expect(root).toHaveAttribute('data-theme', 'light');
  });

  it('gesperrter Speicher: die Seitenleiste klappt auf /session trotzdem ein (eigenes try)', () => {
    onSession();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('gesperrt', 'SecurityError');
    });
    expect(run).not.toThrow();
    expect(root).toHaveAttribute('data-sidebar', 'collapsed');
    expect(root).toHaveAttribute('data-sidebar-auto');
    // Das Theme bleibt ohne Speicher bei „dunkel“ (Standard der Session)
    expect(root).toHaveAttribute('data-theme', 'dark');
  });

  it('gesperrter Speicher auf anderen Seiten: nichts passiert, kein Fehler', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('gesperrt', 'SecurityError');
    });
    expect(run).not.toThrow();
    expect(root).not.toHaveAttribute('data-sidebar');
    expect(root).not.toHaveAttribute('data-theme');
  });
});
