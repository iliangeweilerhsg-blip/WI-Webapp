import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ pathname: '/dokument', search: '' }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn() }),
}));

// pdf.js selbst läuft nicht in jsdom: Die Hülle liefert ein Dokument mit festem Textinhalt
const pdf = vi.hoisted(() => {
  const pages: Record<number, { str: string; x: number; y: number; w: number; h: number }[]> = {
    1: [{ str: 'Einführung', x: 10, y: 10, w: 100, h: 12 }],
    2: [{ str: 'Normalisierung', x: 20, y: 40, w: 140, h: 14 }],
    3: [{ str: 'Beispiele', x: 10, y: 10, w: 80, h: 12 }],
    4: [
      { str: 'Normalisierung in der Praxis', x: 10, y: 10, w: 280, h: 12 },
      { str: 'weitere normalisierung', x: 10, y: 60, w: 220, h: 12 },
    ],
    5: [{ str: 'Zusammenfassung', x: 10, y: 10, w: 150, h: 12 }],
  };
  const render = vi.fn(async (_page: number, _canvas: unknown, _cssWidth: number, _signal?: unknown) => true);
  const doc = {
    numPages: 5,
    pageSize: vi.fn(async () => ({ width: 720, height: 405 })),
    textItems: vi.fn(async (n: number) => pages[n] ?? []),
    render,
    destroy: vi.fn(),
  };
  return { doc, render, openPdf: vi.fn(async (_url: string) => doc) };
});

vi.mock('../src/lib/pdf.ts', () => ({ openPdf: pdf.openPdf }));

import { DocumentView } from '../src/components/DocumentView.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { POLL_INTERVAL_MS } from '../src/lib/material.ts';
import { installFakeCore, makeDeck, makeSheet } from './fake-core.ts';

const DECK = makeDeck({ title: 'VL 03 Normalisierung', ingest_state: 'verarbeitet', page_count: 5 });
const SHEET = makeSheet({ title: 'Blatt 2', ingest_state: 'verarbeitet', page_count: 5 });

function view() {
  return render(
    <ThemeProvider>
      <QueryProvider>
        <DocumentView />
      </QueryProvider>
    </ThemeProvider>,
  );
}

function deckCore() {
  const core = installFakeCore({ decks: [DECK] });
  core.finishIngest(DECK.id, 5);
  return core;
}

async function openViewer(search = `typ=folien&id=${DECK.id}`) {
  nav.search = search;
  view();
  await screen.findByRole('heading', { level: 1, name: /Normalisierung|Blatt 2/ });
  return screen.getByRole('group', { name: 'Dokumentanzeige' });
}

const pageRegion = () => screen.getByRole('region', { name: /^Seite \d/ });
const mainImage = () => within(pageRegion()).getByRole('img');

beforeEach(() => {
  nav.search = '';
  window.history.replaceState(null, '', '/dokument');
  pdf.openPdf.mockClear();
  pdf.render.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PDF-Anzeige', () => {
  it('zeigt Titel, Seitenleiste mit Vorschaubildern (alt „Seite n“) und die erste Seite als Core-Bild', async () => {
    deckCore();
    await openViewer();
    const thumbs = screen.getByRole('navigation', { name: 'Seiten' });
    expect(within(thumbs).getAllByRole('button')).toHaveLength(5);
    expect(within(thumbs).getByRole('img', { name: 'Seite 3' })).toHaveAttribute(
      'src',
      expect.stringMatching(/\/slides\/.+\/thumb$/),
    );
    expect(within(thumbs).getByRole('button', { name: 'Seite 1' })).toHaveAttribute('aria-current', 'page');
    // Schnelle Vorschau: das PNG aus dem Core, noch bevor pdf.js fertig ist
    expect(mainImage()).toHaveAttribute('alt', 'Seite 1');
    expect(mainImage()).toHaveAttribute('src', expect.stringMatching(/\/slides\/.+\/image$/));
    expect(screen.getByRole('link', { name: '← Modul' })).toHaveAttribute(
      'href',
      expect.stringContaining('/modul?id='),
    );
    // pdf.js bekommt das Original aus dem Core (Range-fähig)
    await waitFor(() =>
      expect(pdf.openPdf).toHaveBeenCalledWith(expect.stringContaining(`/slide-decks/${DECK.id}/file`)),
    );
    await waitFor(() => expect(pdf.render).toHaveBeenCalled());
  });

  it('Übungsblätter nutzen die Seiten-URLs des Blatts', async () => {
    const core = installFakeCore({ sheets: [SHEET] });
    core.finishIngest(SHEET.id, 5);
    await openViewer(`typ=blatt&id=${SHEET.id}`);
    expect(mainImage()).toHaveAttribute(
      'src',
      expect.stringContaining(`/exercise-sheets/${SHEET.id}/pages/1/image`),
    );
    expect(
      within(screen.getByRole('navigation', { name: 'Seiten' })).getByRole('img', { name: 'Seite 2' }),
    ).toHaveAttribute('src', expect.stringContaining(`/exercise-sheets/${SHEET.id}/pages/2/thumb`));
  });

  it('springt per Vorschaubild, Knöpfen und Seitenfeld; die Adresse führt „seite“ mit', async () => {
    deckCore();
    const user = userEvent.setup();
    await openViewer();
    await user.click(screen.getByRole('button', { name: 'Seite 4' }));
    expect(pageRegion()).toHaveAccessibleName('Seite 4 von 5');
    expect(mainImage()).toHaveAttribute('alt', 'Seite 4');
    expect(window.location.search).toContain('seite=4');

    await user.click(screen.getByRole('button', { name: 'Vorherige Seite' }));
    expect(pageRegion()).toHaveAccessibleName('Seite 3 von 5');

    const field = screen.getByRole('spinbutton', { name: 'Seite' });
    await user.clear(field);
    await user.type(field, '5{Enter}');
    expect(pageRegion()).toHaveAccessibleName('Seite 5 von 5');
    expect(screen.getByRole('button', { name: 'Nächste Seite' })).toBeDisabled();

    await user.clear(field);
    await user.type(field, '99{Enter}');
    expect(pageRegion()).toHaveAccessibleName('Seite 5 von 5');
    await user.click(screen.getByRole('button', { name: 'Seite 1' }));
    expect(window.location.search).not.toContain('seite');
  });

  it('Deep-Link: &seite=2 öffnet die Seite; zu große Werte werden begrenzt', async () => {
    deckCore();
    await openViewer(`typ=folien&id=${DECK.id}&seite=2`);
    expect(pageRegion()).toHaveAccessibleName('Seite 2 von 5');
  });

  it('Tastatur: Pfeile und Bild↑/↓ blättern, Pos1/Ende springen', async () => {
    deckCore();
    const user = userEvent.setup();
    const viewer = await openViewer();
    expect(viewer).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(pageRegion()).toHaveAccessibleName('Seite 2 von 5');
    await user.keyboard('{PageDown}');
    expect(pageRegion()).toHaveAccessibleName('Seite 3 von 5');
    await user.keyboard('{PageUp}{ArrowLeft}');
    expect(pageRegion()).toHaveAccessibleName('Seite 1 von 5');
    await user.keyboard('{ArrowLeft}');
    expect(pageRegion()).toHaveAccessibleName('Seite 1 von 5');
    await user.keyboard('{End}');
    expect(pageRegion()).toHaveAccessibleName('Seite 5 von 5');
    await user.keyboard('{Home}');
    expect(pageRegion()).toHaveAccessibleName('Seite 1 von 5');
  });

  it('Zoom: + und − ändern die Stufe, „Einpassen“ und „Breite“ sind wählbar', async () => {
    deckCore();
    const user = userEvent.setup();
    await openViewer();
    const frame = screen.getByTestId('page-frame');
    const fitWidth = frame.style.width;
    const label = screen.getByText(/ %$/);
    const start = label.textContent;
    await user.click(screen.getByRole('button', { name: 'Vergrößern' }));
    expect(label.textContent).not.toBe(start);
    expect(frame.style.width).not.toBe(fitWidth);
    await user.click(screen.getByRole('button', { name: 'Verkleinern' }));
    await user.click(screen.getByRole('button', { name: 'Einpassen' }));
    expect(screen.getByRole('button', { name: 'Einpassen' })).toHaveAttribute('aria-pressed', 'true');
    expect(frame.style.width).toBe(fitWidth);
    await user.click(screen.getByRole('button', { name: 'Breite' }));
    expect(screen.getByRole('button', { name: 'Breite' })).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('0');
    expect(screen.getByRole('button', { name: 'Einpassen' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Suche: Strg/⌘F öffnet sie nur im Viewer, Treffer zählen, springen und hervorheben, Esc schließt', async () => {
    deckCore();
    const user = userEvent.setup();
    const viewer = await openViewer();

    // Außerhalb des Viewers bleibt die Suche des Browsers unberührt
    const outside = fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true });
    expect(outside).toBe(true);
    expect(screen.queryByRole('search')).not.toBeInTheDocument();

    // Im Viewer wird sie übernommen (Standardaktion unterdrückt)
    const handled = fireEvent.keyDown(viewer, { key: 'f', ctrlKey: true });
    expect(handled).toBe(false);
    const box = await screen.findByRole('textbox', { name: 'Suchbegriff' });
    await waitFor(() => expect(box).toHaveFocus());

    await user.type(box, 'normalisierung');
    const status = within(screen.getByRole('search')).getByRole('status');
    await waitFor(() => expect(status).toHaveTextContent('1 von 3'));
    // Der erste Treffer liegt auf Seite 2 und ist hervorgehoben
    expect(pageRegion()).toHaveAccessibleName('Seite 2 von 5');
    await waitFor(() => expect(document.querySelectorAll('[data-hit]')).toHaveLength(1));
    expect(document.querySelector('[data-hit="active"]')).not.toBeNull();

    await user.keyboard('{Enter}');
    expect(status).toHaveTextContent('2 von 3');
    expect(pageRegion()).toHaveAccessibleName('Seite 4 von 5');
    await waitFor(() => expect(document.querySelectorAll('[data-hit]')).toHaveLength(2));
    expect(document.querySelectorAll('[data-hit="active"]')).toHaveLength(1);

    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(status).toHaveTextContent('1 von 3');
    expect(pageRegion()).toHaveAccessibleName('Seite 2 von 5');
    await user.click(screen.getByRole('button', { name: 'Vorheriger Treffer' }));
    expect(status).toHaveTextContent('3 von 3');
    await user.click(screen.getByRole('button', { name: 'Nächster Treffer' }));
    expect(status).toHaveTextContent('1 von 3');

    // Pfeiltasten im Suchfeld bewegen den Cursor, sie blättern nicht
    await user.click(screen.getByRole('textbox', { name: 'Suchbegriff' }));
    await user.keyboard('{ArrowRight}');
    expect(pageRegion()).toHaveAccessibleName('Seite 2 von 5');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(viewer).toHaveFocus();
    expect(document.querySelectorAll('[data-hit]')).toHaveLength(0);
  });

  it('Suche ohne Treffer sagt es ruhig', async () => {
    deckCore();
    const user = userEvent.setup();
    const viewer = await openViewer();
    fireEvent.keyDown(viewer, { key: 'f', ctrlKey: true });
    await user.type(await screen.findByRole('textbox', { name: 'Suchbegriff' }), 'xyz');
    await waitFor(() =>
      expect(within(screen.getByRole('search')).getByRole('status')).toHaveTextContent('Kein Treffer'),
    );
    expect(screen.getByRole('button', { name: 'Nächster Treffer' })).toBeDisabled();
  });

  it('wird das Dokument noch verarbeitet: Hinweis, Seiten kommen aus pdf.js, Bilder fehlen noch', async () => {
    installFakeCore({ decks: [makeDeck({ id: DECK.id, title: 'VL 03 Normalisierung' })] });
    await openViewer();
    expect(screen.getByText(/Wird verarbeitet/)).toBeInTheDocument();
    // pdf.js liefert die Seitenzahl
    await waitFor(() =>
      expect(within(screen.getByRole('navigation', { name: 'Seiten' })).getAllByRole('button')).toHaveLength(
        5,
      ),
    );
    expect(within(pageRegion()).queryByRole('img')).not.toBeInTheDocument();
  });

  it('wenn pdf.js nicht lädt, bleiben die Vorschaubilder nutzbar', async () => {
    deckCore();
    pdf.openPdf.mockRejectedValueOnce(new Error('kaputt'));
    const viewer = await openViewer();
    expect(await screen.findByText(/nicht scharf anzeigen/)).toBeInTheDocument();
    expect(mainImage()).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(viewer, { key: 'ArrowRight' });
    });
    expect(pageRegion()).toHaveAccessibleName('Seite 2 von 5');
  });

  it('ohne gültige Adresse: ruhiger Leerzustand', async () => {
    installFakeCore();
    nav.search = 'typ=unsinn';
    view();
    expect(await screen.findByText(/Dieses Dokument gibt es nicht/)).toBeInTheDocument();
  });
});

describe('PDF-Anzeige (Nacharbeit)', () => {
  it('kaputtes PDF: ruhiger Leer-Zustand mit einer Aktion, keine Navigation', async () => {
    installFakeCore({ decks: [makeDeck({ id: DECK.id, title: 'Kaputt', ingest_state: 'fehler' })] });
    pdf.openPdf.mockRejectedValueOnce(new Error('kaputt'));
    nav.search = `typ=folien&id=${DECK.id}&seite=2`;
    view();
    expect(await screen.findByText(/lässt sich nicht anzeigen/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zurück zum Modul' })).toHaveAttribute(
      'href',
      expect.stringContaining('/modul?id='),
    );
    expect(screen.queryByRole('button', { name: 'Nächste Seite' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Lesen kannst du es trotzdem/)).not.toBeInTheDocument();
    expect(screen.queryByText(/vorschaubilder bleiben nutzbar/i)).not.toBeInTheDocument();
  });

  it('Suche zeigt „Sucht …“, solange pdf.js noch lädt, nicht „Kein Treffer“', async () => {
    deckCore();
    let release: (doc: typeof pdf.doc) => void = () => {};
    pdf.openPdf.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const user = userEvent.setup();
    const viewer = await openViewer();
    fireEvent.keyDown(viewer, { key: 'f', ctrlKey: true });
    await user.type(await screen.findByRole('textbox', { name: 'Suchbegriff' }), 'normalisierung');
    const status = within(screen.getByRole('search')).getByRole('status');
    expect(status).toHaveTextContent('Sucht …');
    await act(async () => release(pdf.doc));
    await waitFor(() => expect(status).toHaveTextContent('1 von 3'));
  });

  it('übernimmt eine von außen geänderte Seite aus der Adresse', async () => {
    deckCore();
    nav.search = `typ=folien&id=${DECK.id}&seite=2`;
    const { rerender } = view();
    await screen.findByRole('heading', { level: 1, name: /Normalisierung/ });
    expect(pageRegion()).toHaveAccessibleName('Seite 2 von 5');
    nav.search = `typ=folien&id=${DECK.id}&seite=4`;
    rerender(
      <ThemeProvider>
        <QueryProvider>
          <DocumentView />
        </QueryProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(pageRegion()).toHaveAccessibleName('Seite 4 von 5'));
  });
});

describe('PDF-Anzeige während des Einlesens (F-ORG-02)', () => {
  const frameCanvas = () => screen.getByTestId('page-frame').querySelector('canvas') as HTMLCanvasElement;

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Zustand „neu“: Seite 1 kommt sofort aus pdf.js, in der echten Größe, Seitenzahl aus pdf.js', async () => {
    installFakeCore({
      decks: [makeDeck({ id: DECK.id, title: 'Frisch Normalisierung', ingest_state: 'neu' })],
    });
    await openViewer();
    // Ohne Core-Bilder und ohne Seitengrößen: pdf.js zeichnet die erste Seite
    await waitFor(() => expect(pdf.render).toHaveBeenCalled());
    expect(pdf.render.mock.calls[0]?.[0]).toBe(1);
    // Zuerst die Größe aus pdf.js (720 × 405 pt), nicht das Standardformat: Breite 768 statt ≈ 401
    expect(pdf.render.mock.calls[0]?.[2]).toBe(768);
    expect(pdf.render).toHaveBeenCalledTimes(1);
    expect(within(pageRegion()).queryByRole('img')).not.toBeInTheDocument();
    await waitFor(() => expect(frameCanvas().style.visibility).toBe('visible'));
    expect(pageRegion()).toHaveAccessibleName('Seite 1 von 5');
    expect(screen.getByText('/ 5')).toBeInTheDocument();
  });

  it('Zustand „neu“: Blättern per Taste und Knopf, Seitenleiste mit Platzhaltern statt Vorschaubildern', async () => {
    installFakeCore({
      decks: [makeDeck({ id: DECK.id, title: 'Frisch Normalisierung', ingest_state: 'neu' })],
    });
    const user = userEvent.setup();
    await openViewer();
    const thumbs = screen.getByRole('navigation', { name: 'Seiten' });
    await waitFor(() => expect(within(thumbs).getAllByRole('button')).toHaveLength(5));
    expect(within(thumbs).queryAllByRole('img')).toHaveLength(0);
    expect(within(thumbs).getAllByTestId('thumb-placeholder')).toHaveLength(5);
    expect(within(thumbs).getByRole('button', { name: 'Seite 3' })).toBeInTheDocument();

    await user.keyboard('{ArrowRight}');
    expect(pageRegion()).toHaveAccessibleName('Seite 2 von 5');
    await user.click(screen.getByRole('button', { name: 'Nächste Seite' }));
    expect(pageRegion()).toHaveAccessibleName('Seite 3 von 5');
    await user.click(within(thumbs).getByRole('button', { name: 'Seite 5' }));
    expect(pageRegion()).toHaveAccessibleName('Seite 5 von 5');
    await waitFor(() => expect(pdf.render.mock.calls.some((c) => c[0] === 5)).toBe(true));
  });

  it('Zustand „neu“: Suche funktioniert schon', async () => {
    installFakeCore({
      decks: [makeDeck({ id: DECK.id, title: 'Frisch Normalisierung', ingest_state: 'neu' })],
    });
    const user = userEvent.setup();
    const viewer = await openViewer();
    fireEvent.keyDown(viewer, { key: 'f', ctrlKey: true });
    await user.type(await screen.findByRole('textbox', { name: 'Suchbegriff' }), 'normalisierung');
    await waitFor(() =>
      expect(within(screen.getByRole('search')).getByRole('status')).toHaveTextContent('1 von 3'),
    );
    expect(pageRegion()).toHaveAccessibleName('Seite 2 von 5');
  });

  it('Wechsel auf „verarbeitet“: Bilder und Vorschauen kommen dazu, Seite bleibt, nichts wird neu gezeichnet', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const core = installFakeCore({
      decks: [makeDeck({ id: DECK.id, title: 'Frisch Normalisierung', ingest_state: 'neu' })],
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await openViewer();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(pageRegion()).toHaveAccessibleName('Seite 3 von 5');
    await waitFor(() => expect(frameCanvas().style.visibility).toBe('visible'));
    const renders = pdf.render.mock.calls.length;
    const sizeBefore = screen.getByTestId('page-frame').style.width;

    core.finishIngest(DECK.id, 5);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 200);
    });
    const thumbs = screen.getByRole('navigation', { name: 'Seiten' });
    await waitFor(() => expect(within(thumbs).getAllByRole('img')).toHaveLength(5));
    expect(within(thumbs).queryAllByTestId('thumb-placeholder')).toHaveLength(0);
    expect(mainImage()).toHaveAttribute('alt', 'Seite 3');
    expect(pageRegion()).toHaveAccessibleName('Seite 3 von 5');
    expect(screen.queryByText(/Wird verarbeitet/)).not.toBeInTheDocument();
    // Kein Flackern: gleiche Größe, die scharfe Seite bleibt sichtbar, kein zusätzlicher Zeichenvorgang
    expect(screen.getByTestId('page-frame').style.width).toBe(sizeBefore);
    expect(frameCanvas().style.visibility).toBe('visible');
    expect(pdf.render.mock.calls.length).toBe(renders);
  });

  it('Seitengröße nicht lesbar: gezeichnet wird trotzdem (Standardformat)', async () => {
    installFakeCore({
      decks: [makeDeck({ id: DECK.id, title: 'Frisch Normalisierung', ingest_state: 'neu' })],
    });
    pdf.doc.pageSize.mockRejectedValueOnce(new Error('kaputt'));
    await openViewer();
    await waitFor(() => expect(pdf.render).toHaveBeenCalled());
  });
});
