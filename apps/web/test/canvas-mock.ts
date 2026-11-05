// Canvas-2D-Mock für jsdom: zeichnet nichts, protokolliert aber alle Aufrufe (und die Füllfarbe zum Zeitpunkt von `fill`).
import { vi } from 'vitest';

export interface CanvasLog {
  /** Alle Methodenaufrufe in Reihenfolge */
  calls: { name: string; args: unknown[] }[];
  /** `fillStyle` bei jedem `fill()` */
  fills: string[];
  /** Letzte `setTransform`-Argumente */
  transform: number[] | null;
  count(name: string): number;
  reset(): void;
}

export function installCanvasMock(): CanvasLog {
  const log: CanvasLog = {
    calls: [],
    fills: [],
    transform: null,
    count: (name) => log.calls.filter((c) => c.name === name).length,
    reset: () => {
      log.calls.length = 0;
      log.fills.length = 0;
      log.transform = null;
    },
  };
  const state: Record<string, unknown> = { fillStyle: '#000', strokeStyle: '#000' };
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (text: string) => ({ width: text.length * 6 });
      return (...args: unknown[]) => {
        log.calls.push({ name: prop, args });
        if (prop === 'fill') log.fills.push(String(target.fillStyle));
        if (prop === 'setTransform') log.transform = args as number[];
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => ctx) as unknown as HTMLCanvasElement['getContext'],
  );
  return log;
}
