// Restpunkte aus dem Review von #42 (Issue #43): Lösch-Race, Health-Abfrage, Toast-Feinheiten, Live-Region, Worker-Cache
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';

const nav = vi.hoisted(() => ({ pathname: '/dokument', search: '' }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn() }),
}));

const pdf = vi.hoisted(() => {
  const doc = {
    numPages: 5,
    pageSize: vi.fn(async (_page: number) => ({ width: 720, height: 405 })),
    textItems: vi.fn(async (_n: number) => []),
    render: vi.fn(async () => true),
    destroy: vi.fn(),
  };
  return { doc, openPdf: vi.fn(async (_url: string) => doc) };
});
vi.mock('../src/lib/pdf.ts', () => ({ openPdf: pdf.openPdf }));

import { DocumentView, HEALTH_GRACE_MS } from '../src/components/DocumentView.tsx';
import {
  commitMaterialDeletes,
  pendingDeleteMessage,
  resetPendingMaterialDeletes,
  scheduleMaterialDelete,
  undoMaterialDeletes,
  unscheduleMaterialDelete,
} from '../src/lib/material.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { ToastProvider, useToast, type ToastOptions } from '../src/lib/toast.tsx';
import { installFakeCore, makeDeck } from './fake-core.ts';

afterEach(() => {
  resetPendingMaterialDeletes();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  pdf.openPdf.mockReset();
  pdf.openPdf.mockImplementation(async () => pdf.doc);
});

describe('Punkt 1: Race am Ende des Rückgängig-Fensters', () => {
  it('Ist das DELETE unterwegs, lässt sich die Löschung nicht mehr zurücknehmen', async () => {
    const deck = makeDeck({ title: 'VL 01', ingest_state: 'verarbeitet', page_count: 3 });
    const core = installFakeCore({ decks: [deck] });
    const inner = globalThis.fetch;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') await gate;
      return inner(input, init);
    });
    scheduleMaterialDelete(new QueryClient(), 'folien', deck.id, () => {});
    expect(pendingDeleteMessage()).toBe('Foliensatz gelöscht');

    commitMaterialDeletes(); // Ablauf des Toasts: DELETE geht raus (hängt am Gate)
    expect(pendingDeleteMessage()).toBeNull();

    // Die Dubletten-Antwort kommt jetzt: nicht mehr zurücknehmbar
    expect(unscheduleMaterialDelete('folien', deck.id)).toBe(false);
    // Auch „Rückgängig“ ändert nichts mehr am unterwegs befindlichen DELETE
    undoMaterialDeletes();
    release();
    await waitFor(() => expect(core.requests.some((r) => r.method === 'DELETE')).toBe(true));
  });

  it('Vor dem Abschicken ist das Zurücknehmen weiterhin möglich', () => {
    installFakeCore({});
    scheduleMaterialDelete(new QueryClient(), 'folien', 'abc', () => {});
    expect(unscheduleMaterialDelete('folien', 'abc')).toBe(true);
    expect(unscheduleMaterialDelete('folien', 'abc')).toBe(false);
  });
});

describe('Punkt 3 und 4: Toast', () => {
  let api: ReturnType<typeof useToast>;
  function Grab() {
    api = useToast();
    return null;
  }
  function setup() {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <main id="main" tabIndex={-1} />
        <Grab />
      </ToastProvider>,
    );
  }
  const show = (options: ToastOptions) => act(() => api.show(options));
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
  const undo = (group: string, message: string): ToastOptions => ({
    message,
    actionLabel: 'Rückgängig',
    group,
    durationMs: 10_000,
    focusAction: true,
    onExpire: vi.fn(),
  });

  it('dismissGroup: Fokus bleibt auf „Rückgängig“ des Rest-Toasts, Restzeit läuft weiter', async () => {
    setup();
    await show(undo('a', 'Modul gelöscht'));
    await show(undo('b', 'Foliensatz gelöscht'));
    await advance(6_000);
    screen.getByRole('button', { name: 'Rückgängig' }).focus();
    act(() => api.dismissGroup('a'));
    expect(screen.getByText('Foliensatz gelöscht')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rückgängig' })).toHaveFocus();
    // Restzeit ca. 4 s, nicht neue 10 s
    await advance(4_200);
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).not.toBeInTheDocument();
  });

  it('amend: neue Meldung im Toast, ohne Timer-Neustart und ohne Fokusverlust', async () => {
    setup();
    await show(undo('material-delete', '2 Dateien gelöscht'));
    await advance(7_000);
    screen.getByRole('button', { name: 'Rückgängig' }).focus();
    let ok = false;
    act(() => {
      ok = api.amend('material-delete', 'Foliensatz gelöscht · „VL 01“ ist wieder da.');
    });
    expect(ok).toBe(true);
    expect(screen.getByText(/„VL 01“ ist wieder da/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rückgängig' })).toHaveFocus();
    await advance(3_200);
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).not.toBeInTheDocument();
    let again = true;
    act(() => {
      again = api.amend('material-delete', 'x');
    });
    expect(again).toBe(false);
  });

  it('die Live-Region existiert dauerhaft (auch ohne Toast); der Toast trägt kein eigenes role=status', async () => {
    setup();
    const live = screen.getByTestId('toast-live');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live.querySelector('[role="status"]')).toBeNull();
    await show({ message: 'Hallo' });
    expect(screen.getByTestId('toast-live')).toBe(live);
    expect(live).toHaveTextContent('Hallo');
    expect(live.querySelector('[role="status"]')).toBeNull();
    await advance(5_200);
    expect(screen.getByTestId('toast-live')).toBe(live);
    expect(live).toBeEmptyDOMElement();
  });
});

describe('Punkt 2 und 4: PDF-Anzeige', () => {
  const DECK = makeDeck({ title: 'VL 03', ingest_state: 'verarbeitet', page_count: 5 });
  function view() {
    nav.search = `typ=folien&id=${DECK.id}`;
    return render(
      <ThemeProvider>
        <QueryProvider>
          <DocumentView />
        </QueryProvider>
      </ThemeProvider>,
    );
  }

  it('„Erneut versuchen“ liegt nicht innerhalb eines role=status', async () => {
    const core = installFakeCore({ decks: [DECK] });
    core.finishIngest(DECK.id, 5);
    pdf.openPdf.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    view();
    const button = await screen.findByRole('button', { name: 'Erneut versuchen' });
    expect(button.closest('[role="status"]')).toBeNull();
    expect(screen.getByText(/nicht scharf anzeigen/).closest('[role="status"]')).not.toBeNull();
  });

  it('dauerhafter Ladefehler bei gesundem Core: die schnelle Health-Abfrage endet', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const core = installFakeCore({ decks: [DECK] });
    core.finishIngest(DECK.id, 5);
    pdf.openPdf.mockRejectedValue(new TypeError('Failed to fetch'));
    view();
    expect(await screen.findByText(/nicht scharf anzeigen/)).toBeInTheDocument();
    const healthCalls = () => core.requests.filter((r) => r.path === '/health').length;
    const step = async (ms: number) => {
      for (let t = 0; t < ms; t += 5_000) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5_000);
        });
      }
    };
    const start = healthCalls();
    await step(HEALTH_GRACE_MS);
    const withinGrace = healthCalls() - start;
    // Innerhalb der Frist wird im 5-s-Takt gefragt (sechs Schritte)
    expect(withinGrace).toBeGreaterThanOrEqual(5);
    const afterGrace = healthCalls();
    await step(60_000);
    // Danach nur noch der 30-s-Takt des Statusfelds (zwei Abfragen in 60 s), nicht zwölf
    expect(healthCalls() - afterGrace).toBeLessThanOrEqual(3);
  });
});
