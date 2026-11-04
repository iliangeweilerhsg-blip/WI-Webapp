// Zeichnen mit pdf.js: Überholte Vorgänge dürfen weder den Canvas blockieren noch ein falsches Ergebnis melden
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  gate: new Map<number, () => void>(),
  drawing: 0,
  drawn: [] as number[],
  errors: [] as string[],
  failRender: null as Error | null,
  destroyed: 0,
  cleaned: [] as number[],
}));

vi.mock('pdfjs-dist', () => {
  const page = (number: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 720 * scale,
      height: 405 * scale,
      transform: [],
    }),
    cleanup: () => state.cleaned.push(number),
    render: ({ canvas }: { canvas: { id?: number } }) => {
      if (state.drawing > 0)
        state.errors.push('Cannot use the same canvas during multiple render() operations');
      state.drawing += 1;
      let cancel!: () => void;
      const promise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          state.drawing -= 1;
          if (state.failRender) reject(state.failRender);
          else {
            state.drawn.push(number);
            canvas.id = number;
            resolve();
          }
        }, 20);
        cancel = () => {
          clearTimeout(timer);
          state.drawing -= 1;
          const error = new Error('abgebrochen');
          error.name = 'RenderingCancelledException';
          reject(error);
        };
      });
      return { promise, cancel: () => cancel() };
    },
  });
  const doc = {
    numPages: 60,
    // getPage dauert, bis der Test es freigibt (langsame Maschine)
    getPage: (number: number) =>
      new Promise((resolve) => {
        state.gate.set(number, () => resolve(page(number)));
      }),
  };
  return {
    version: '0.0.0-test',
    GlobalWorkerOptions: { workerSrc: 'x' },
    Util: { transform: () => [] },
    getDocument: () => ({ promise: Promise.resolve(doc), destroy: () => state.destroyed++ }),
  };
});

import { openPdf } from '../src/lib/pdf.ts';

function canvas() {
  const el = document.createElement('canvas');
  el.getContext = (() => ({})) as never;
  return el;
}

beforeEach(() => {
  state.gate.clear();
  state.drawing = 0;
  state.drawn = [];
  state.errors = [];
  state.failRender = null;
  state.destroyed = 0;
  state.cleaned = [];
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('openPdf().render', () => {
  it('Abbruch während getPage: nur die aktuelle Seite wird gezeichnet, kein Canvas-Konflikt', async () => {
    const doc = await openPdf('/x.pdf');
    const el = canvas();
    const first = new AbortController();
    const second = new AbortController();

    const r27 = doc.render(27, el, 800, first.signal);
    await tick();
    first.abort(); // Seitenwechsel, solange getPage(27) noch läuft
    const r28 = doc.render(28, el, 800, second.signal);
    second.abort();
    const r27b = doc.render(27, el, 800, new AbortController().signal);
    // Die Seiten kommen verspätet an, nacheinander in der Reihenfolge der Vorgänge
    state.gate.get(27)?.();
    await tick();
    state.gate.get(28)?.();
    await tick();
    state.gate.get(27)?.(); // dritter Vorgang bekommt seine Seite zuletzt
    await wait(60);

    expect(await r27).toBe(false);
    expect(await r28).toBe(false);
    expect(await r27b).toBe(true);
    expect(state.errors).toEqual([]);
    expect(state.drawn.at(-1)).toBe(27);
    expect(state.drawn).not.toContain(28);
  });

  it('ein laufender Vorgang wird vom nächsten aktiv abgebrochen', async () => {
    const doc = await openPdf('/x.pdf');
    const el = canvas();
    const a = new AbortController();
    const first = doc.render(1, el, 800, a.signal);
    await tick();
    state.gate.get(1)?.();
    await wait(5);
    expect(state.drawing).toBe(1);
    a.abort();
    const second = doc.render(2, el, 800, new AbortController().signal);
    await tick();
    state.gate.get(2)?.();
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(state.errors).toEqual([]);
    expect(state.drawn).toEqual([2]);
  });

  it('echte Fehler werden nicht verschluckt', async () => {
    const doc = await openPdf('/x.pdf');
    state.failRender = new Error('kaputt');
    const result = doc.render(1, canvas(), 800, new AbortController().signal);
    await tick();
    state.gate.get(1)?.();
    await expect(result).rejects.toThrow('kaputt');
  });
});

describe('openPdf().pageSize', () => {
  it('gibt die Seite nach dem Lesen der Größe frei und stört die Zeichenschlange nicht', async () => {
    const doc = await openPdf('/x.pdf');
    const el = canvas();
    const drawing = doc.render(1, el, 800, new AbortController().signal);
    await tick();
    state.gate.get(1)?.();
    await wait(5);
    expect(state.drawing).toBe(1);

    const size = doc.pageSize(2);
    await tick();
    state.gate.get(2)?.();
    expect(await size).toEqual({ width: 720, height: 405 });
    expect(state.cleaned).toEqual([2]);
    // Der laufende Vorgang wurde weder abgebrochen noch behindert
    expect(await drawing).toBe(true);
    expect(state.errors).toEqual([]);
  });
});
