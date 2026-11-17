// `watchReconnect` hört auf `link`, nicht auf `connection` (VERTRAEGE §11.8): Im Folge-Tab bleibt `connection` bei
// `other_tab`, nur die Mitlese-Verbindung (`link`) bricht ab und kommt wieder.
import { describe, expect, it, vi } from 'vitest';
import { watchReconnect } from '../src/components/dashboard/reconnect.ts';

function fakeClient(linkState: string) {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const raw = {
    connectionState: 'other_tab',
    linkState,
    onEvent: vi.fn((name: string, fn: (data: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(fn);
      listeners.set(name, set);
      return () => void set.delete(fn);
    }),
  };
  return {
    client: raw as unknown as Parameters<typeof watchReconnect>[0],
    link: (state: string) => listeners.get('link')?.forEach((fn) => fn({ state })),
    connection: (state: string) =>
      listeners.get('connection')?.forEach((fn) => fn({ state, retryInMs: null, closeCode: null })),
    count: (name: string) => listeners.get(name)?.size ?? 0,
  };
}

describe('watchReconnect', () => {
  it('Folge-Tab: Abbruch der Mitlese-Verbindung und wieder online lädt einmal nach', () => {
    const c = fakeClient('online');
    const reload = vi.fn();
    watchReconnect(c.client, reload);
    c.link('backoff');
    expect(reload).not.toHaveBeenCalled();
    c.link('connecting');
    c.link('online');
    expect(reload).toHaveBeenCalledTimes(1);
    c.link('online');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('Ereignisse von `connection` zählen nicht (im Folge-Tab bleibt es `other_tab`)', () => {
    const c = fakeClient('online');
    const reload = vi.fn();
    watchReconnect(c.client, reload);
    c.connection('backoff');
    c.connection('online');
    expect(reload).not.toHaveBeenCalled();
    expect(c.count('connection')).toBe(0);
  });

  it('war `link` beim Öffnen schon unten, zählt das erste online; die Abmeldung räumt auf', () => {
    const c = fakeClient('failed');
    const reload = vi.fn();
    const off = watchReconnect(c.client, reload);
    c.link('online');
    expect(reload).toHaveBeenCalledTimes(1);
    off();
    expect(c.count('link')).toBe(0);
  });
});
