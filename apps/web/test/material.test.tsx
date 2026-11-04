import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

const nav = vi.hoisted(() => ({ pathname: '/modul', search: '', push: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push }),
}));

import { ModulView } from '../src/components/ModulView.tsx';
import { POLL_INTERVAL_MS, resetPendingMaterialDeletes } from '../src/lib/material.ts';
import { UNDO_WINDOW_MS, resetPendingModuleDeletes } from '../src/lib/modules.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { ToastProvider } from '../src/lib/toast.tsx';
import { UploadProvider } from '../src/lib/uploads.tsx';
import {
  installFakeCore,
  makeDeck,
  makeModule,
  makeSemester,
  makeSheet,
  type FakeCore,
} from './fake-core.ts';

const MOD = makeModule();

function page(children: ReactNode = <ModulView />) {
  return render(
    <ThemeProvider>
      <QueryProvider>
        <ToastProvider>
          <UploadProvider>{children}</UploadProvider>
        </ToastProvider>
      </QueryProvider>
    </ThemeProvider>,
  );
}

const pdf = (name: string, size = 1200) =>
  new File([new Uint8Array(size)], name, { type: 'application/pdf' });

const posts = (core: FakeCore, path: string) =>
  core.requests.filter((r) => r.method === 'POST' && r.path === path);

const gets = (core: FakeCore, path: string) =>
  core.requests.filter((r) => r.method === 'GET' && r.path.startsWith(path));

async function openModule(core?: Partial<Parameters<typeof installFakeCore>[0]>) {
  const fake = installFakeCore({ semesters: [makeSemester()], modules: [MOD], ...core });
  page();
  await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
  return fake;
}

function dropFiles(files: File[]) {
  fireEvent.drop(window, { dataTransfer: { files, types: ['Files'] } });
}

beforeEach(() => {
  nav.pathname = '/modul';
  nav.search = `id=${MOD.id}`;
  nav.push.mockReset();
});

afterEach(() => {
  resetPendingMaterialDeletes();
  resetPendingModuleDeletes();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Listen und leere Zustände', () => {
  it('Vorlesungen: leer mit genau einer Aktion; Übungen ebenso', async () => {
    const user = userEvent.setup();
    await openModule();
    const panel = screen.getByRole('tabpanel');
    expect(await within(panel).findByText('Noch keine Folien.')).toBeInTheDocument();
    expect(within(panel).getAllByRole('button')).toHaveLength(1);
    expect(within(panel).getByRole('button', { name: 'PDF hierher ziehen oder auswählen' })).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'Übungen' }));
    const sheets = screen.getByRole('tabpanel');
    expect(await within(sheets).findByText('Noch keine Übungsblätter.')).toBeInTheDocument();
    expect(within(sheets).getAllByRole('button')).toHaveLength(1);
  });

  it('zeigt Foliensätze mit Seitenzahl, Datum und Vorschau; Übungsblätter mit Nummer und Abgabe', async () => {
    const user = userEvent.setup();
    const deck = makeDeck({ title: 'VL 03 Normalisierung', ingest_state: 'verarbeitet', page_count: 3 });
    const sheet = makeSheet({
      title: 'Blatt 3',
      number: 3,
      due_at: '2026-11-18T12:00:00Z',
      ingest_state: 'verarbeitet',
      page_count: 2,
    });
    const core = await openModule({ decks: [deck], sheets: [sheet] });
    core.finishIngest(deck.id, 3);
    // Der Foliensatz wurde schon verarbeitet übergeben; die Folien holt die Zeile selbst
    const list = await screen.findByRole('list', { name: 'Foliensätze' });
    const row = within(list).getByRole('link', { name: 'VL 03 Normalisierung' });
    expect(row).toHaveAttribute('href', `/dokument?typ=folien&id=${deck.id}`);
    expect(within(list).getByText(/3 Seiten/)).toBeInTheDocument();
    await waitFor(() =>
      expect(list.querySelector('img')?.getAttribute('src')).toMatch(/\/slides\/.+\/thumb$/),
    );

    await user.click(screen.getByRole('tab', { name: 'Übungen' }));
    const sheets = await screen.findByRole('list', { name: 'Übungsblätter' });
    expect(within(sheets).getByRole('link', { name: 'Blatt 3' })).toHaveAttribute(
      'href',
      `/dokument?typ=blatt&id=${sheet.id}`,
    );
    expect(within(sheets).getByText(/Blatt 3 · 2 Seiten · Abgabe/)).toBeInTheDocument();
    expect(sheets.querySelector('img')?.getAttribute('src')).toContain(
      `/exercise-sheets/${sheet.id}/pages/1/thumb`,
    );
  });
});

describe('Upload', () => {
  it('Dateiauswahl, mehrere Dateien: je ein POST mit eigenem Idempotency-Key, ein Sammel-Toast', async () => {
    const user = userEvent.setup();
    const core = await openModule();
    await screen.findByText('Noch keine Folien.');
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), [
      pdf('VL 01.pdf'),
      pdf('VL 02.pdf', 2000),
    ]);

    expect(await screen.findByText('2 Foliensätze hinzugefügt')).toBeInTheDocument();
    const sent = posts(core, '/slide-decks');
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map((r) => r.headers['Idempotency-Key'])).size).toBe(2);
    const list = await screen.findByRole('list', { name: 'Foliensätze' });
    expect(within(list).getByRole('link', { name: 'VL 01' })).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: 'VL 02' })).toBeInTheDocument();
    // Neu eingelesen: ruhiger Hinweis, kein Fehler
    expect(within(list).getAllByText('Wird verarbeitet …')).toHaveLength(2);
    expect(screen.queryByRole('list', { name: 'Uploads' })).not.toBeInTheDocument();
  });

  it('ein neuer Foliensatz: kleiner Toast „Foliensatz hinzugefügt“', async () => {
    const user = userEvent.setup();
    await openModule();
    await screen.findByText('Noch keine Folien.');
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('VL 01.pdf'));
    expect(await screen.findByText('Foliensatz hinzugefügt')).toBeInTheDocument();
  });

  it('Drag & Drop auf die Modulseite: Übungsblatt im Tab Übungen', async () => {
    const user = userEvent.setup();
    const core = await openModule();
    await user.click(screen.getByRole('tab', { name: 'Übungen' }));
    await screen.findByText('Noch keine Übungsblätter.');
    dropFiles([pdf('Blatt 1.pdf')]);
    expect(await screen.findByText('Übungsblatt hinzugefügt')).toBeInTheDocument();
    expect(posts(core, '/exercise-sheets')).toHaveLength(1);
    expect(posts(core, '/slide-decks')).toHaveLength(0);
  });

  it('Dublette: „Schon vorhanden“ mit Sprung zum vorhandenen Foliensatz', async () => {
    const user = userEvent.setup();
    const core = await openModule();
    await screen.findByText('Noch keine Folien.');
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('VL 01.pdf'));
    await screen.findByText('Foliensatz hinzugefügt');
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('VL 01.pdf'));
    expect(await screen.findByText('Schon vorhanden')).toBeInTheDocument();
    expect(core.decks).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Anzeigen' }));
    expect(nav.push).toHaveBeenCalledWith(`/dokument?typ=folien&id=${core.decks[0]?.id}`);
  });

  it('Fehler vom Core werden freundlich gemeldet (kein gültiges PDF, zu groß)', async () => {
    const user = userEvent.setup();
    const core = await openModule();
    await screen.findByText('Noch keine Folien.');
    core.rejectNextUpload = { status: 400, code: 'invalid_pdf' };
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('kaputt.pdf'));
    const uploads = await screen.findByRole('list', { name: 'Uploads' });
    expect(within(uploads).getByRole('alert')).toHaveTextContent('Das ist kein gültiges PDF');
    // Kein „Erneut versuchen“: Wiederholen würde nichts ändern
    expect(within(uploads).queryByRole('button', { name: 'Erneut versuchen' })).not.toBeInTheDocument();
    await user.click(within(uploads).getByRole('button', { name: /schließen/ }));
    expect(screen.queryByRole('list', { name: 'Uploads' })).not.toBeInTheDocument();

    core.rejectNextUpload = { status: 413, code: 'file_too_large' };
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('riesig.pdf'));
    expect(await screen.findAllByText(/höchstens 200 MB/)).not.toHaveLength(0);
  });

  it('Dateien, die offensichtlich kein PDF sind, gehen gar nicht erst raus', async () => {
    const core = await openModule();
    await screen.findByText('Noch keine Folien.');
    dropFiles([new File(['x'], 'foto.png', { type: 'image/png' })]);
    const uploads = await screen.findByRole('list', { name: 'Uploads' });
    expect(within(uploads).getByRole('alert')).toHaveTextContent('Das ist kein PDF');
    expect(posts(core, '/slide-decks')).toHaveLength(0);
  });

  it('Retry nach Netzfehler nutzt DENSELBEN Idempotency-Key und legt nichts doppelt an', async () => {
    const user = userEvent.setup();
    const core = await openModule();
    await screen.findByText('Noch keine Folien.');
    // Der Core verarbeitet den Upload, die Antwort geht verloren
    core.failNextUpload = 'after';
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('VL 01.pdf'));
    const uploads = await screen.findByRole('list', { name: 'Uploads' });
    expect(within(uploads).getByRole('alert')).toHaveTextContent('Core nicht erreichbar');

    await user.click(within(uploads).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('Foliensatz hinzugefügt')).toBeInTheDocument();
    const sent = posts(core, '/slide-decks');
    expect(sent).toHaveLength(2);
    expect(sent[1]?.headers['Idempotency-Key']).toBe(sent[0]?.headers['Idempotency-Key']);
    expect(core.decks).toHaveLength(1);
    expect(screen.queryByRole('list', { name: 'Uploads' })).not.toBeInTheDocument();
  });

  it('Drop ohne offenes Modul: Hinweis statt Upload', async () => {
    nav.pathname = '/';
    nav.search = '';
    const core = installFakeCore();
    page(<p>Heute</p>);
    dropFiles([pdf('VL 01.pdf')]);
    expect(
      await screen.findByText('Öffne zuerst ein Modul, dann zieh die PDFs dorthin.'),
    ).toBeInTheDocument();
    expect(core.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('Drop auf einem Tab ohne PDF-Ablage (Konzepte): Hinweis statt Upload', async () => {
    const user = userEvent.setup();
    const core = await openModule();
    await user.click(screen.getByRole('tab', { name: 'Konzepte' }));
    dropFiles([pdf('VL 01.pdf')]);
    expect(await screen.findByText(/Wechsle zum Tab Vorlesungen oder Übungen/)).toBeInTheDocument();
    expect(core.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('Drag mit Dateien über dem Fenster hebt die Ablage hervor und verhindert das Öffnen im Browser', async () => {
    await openModule();
    await screen.findByText('Noch keine Folien.');
    const over = new Event('dragover', { cancelable: true, bubbles: true });
    Object.defineProperty(over, 'dataTransfer', { value: { types: ['Files'] } });
    act(() => {
      fireEvent.dragEnter(window, { dataTransfer: { types: ['Files'] } });
    });
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-dragging="true"]')).not.toBeNull();
    act(() => {
      fireEvent.dragLeave(window, { dataTransfer: { types: ['Files'] } });
    });
    expect(document.querySelector('[data-dragging="true"]')).toBeNull();
  });
});

describe('Verarbeitung', () => {
  it('pollt nur, solange etwas verarbeitet wird, und hört bei „verarbeitet“ auf', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const deck = makeDeck({ title: 'VL 01' });
    const core = installFakeCore({ semesters: [makeSemester()], modules: [MOD], decks: [deck] });
    page();
    const list = await screen.findByRole('list', { name: 'Foliensätze' });
    expect(within(list).getByText('Wird verarbeitet …')).toBeInTheDocument();

    const before = gets(core, '/slide-decks?').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 200);
    });
    expect(gets(core, '/slide-decks?').length).toBeGreaterThan(before);

    core.finishIngest(deck.id, 3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 200);
    });
    await waitFor(() => expect(within(list).getByText(/3 Seiten/)).toBeInTheDocument());
    expect(within(list).queryByText('Wird verarbeitet …')).not.toBeInTheDocument();

    const settled = gets(core, '/slide-decks?').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
    });
    expect(gets(core, '/slide-decks?').length).toBe(settled);
  });

  it('bei einem Fehler: ruhiger Hinweis ohne Knopf, kein Polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const deck = makeDeck({ title: 'VL 01', ingest_state: 'fehler' });
    const core = installFakeCore({ semesters: [makeSemester()], modules: [MOD], decks: [deck] });
    page();
    const list = await screen.findByRole('list', { name: 'Foliensätze' });
    expect(within(list).getByText(/konnte nicht verarbeitet werden/)).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /erneut/i })).not.toBeInTheDocument();
    const settled = gets(core, '/slide-decks?').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });
    expect(gets(core, '/slide-decks?').length).toBe(settled);
  });
});

describe('Umbenennen und Löschen', () => {
  it('Umbenennen: Enter speichert per PATCH, Esc bricht ab, der Fokus kehrt zurück', async () => {
    const user = userEvent.setup();
    const deck = makeDeck({ title: 'VL 01', ingest_state: 'verarbeitet', page_count: 3 });
    const core = await openModule({ decks: [deck] });
    const list = await screen.findByRole('list', { name: 'Foliensätze' });

    await user.click(within(list).getByRole('button', { name: 'VL 01 umbenennen' }));
    await user.keyboard('{Escape}');
    expect(within(list).getByRole('link', { name: 'VL 01' })).toBeInTheDocument();
    await waitFor(() => expect(within(list).getByRole('button', { name: 'VL 01 umbenennen' })).toHaveFocus());

    await user.click(within(list).getByRole('button', { name: 'VL 01 umbenennen' }));
    const input = within(list).getByRole('textbox', { name: 'Titel' });
    await user.clear(input);
    await user.type(input, 'VL 01 Einführung{Enter}');
    expect(await within(list).findByRole('link', { name: 'VL 01 Einführung' })).toBeInTheDocument();
    const patch = core.requests.find((r) => r.method === 'PATCH');
    expect(patch?.path).toBe(`/slide-decks/${deck.id}`);
    expect(patch?.body).toEqual({ title: 'VL 01 Einführung' });
  });

  it('Löschen blendet sofort aus; Rückgängig bringt den Eintrag zurück, ohne dass etwas gelöscht wurde', async () => {
    const user = userEvent.setup();
    const deck = makeDeck({ title: 'VL 01', ingest_state: 'verarbeitet', page_count: 3 });
    const core = await openModule({ decks: [deck] });
    const list = await screen.findByRole('list', { name: 'Foliensätze' });
    await user.click(within(list).getByRole('button', { name: 'VL 01 löschen' }));
    expect(screen.queryByRole('link', { name: 'VL 01' })).not.toBeInTheDocument();
    expect(screen.getByText('Foliensatz gelöscht')).toBeInTheDocument();
    expect(core.requests.some((r) => r.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Rückgängig' }));
    expect(await screen.findByRole('link', { name: 'VL 01' })).toBeInTheDocument();
    expect(core.requests.some((r) => r.method === 'DELETE')).toBe(false);
    // Fokus fällt nicht auf <body>
    expect(document.activeElement).toBe(document.getElementById('main') ?? document.body);
  });

  it('nach Ablauf des Fensters geht das DELETE raus; der Eintrag bleibt weg', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sheet = makeSheet({ title: 'Blatt 1', ingest_state: 'verarbeitet', page_count: 2 });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const core = installFakeCore({ semesters: [makeSemester()], modules: [MOD], sheets: [sheet] });
    page();
    await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    await user.click(screen.getByRole('tab', { name: 'Übungen' }));
    await user.click(await screen.findByRole('button', { name: 'Blatt 1 löschen' }));
    expect(screen.getByText('Übungsblatt gelöscht')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 500);
    });
    expect(core.requests.filter((r) => r.method === 'DELETE').map((r) => r.path)).toEqual([
      `/exercise-sheets/${sheet.id}`,
    ]);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Blatt 1' })).not.toBeInTheDocument());
  });
});

describe('Nacharbeit', () => {
  it('Umbenennen mit Enter: Fokus landet deterministisch auf dem Umbenennen-Knopf', async () => {
    const user = userEvent.setup();
    const deck = makeDeck({ title: 'VL 01', ingest_state: 'verarbeitet', page_count: 3 });
    await openModule({ decks: [deck] });
    const list = await screen.findByRole('list', { name: 'Foliensätze' });
    await user.click(within(list).getByRole('button', { name: 'VL 01 umbenennen' }));
    await user.type(within(list).getByRole('textbox', { name: 'Titel' }), ' neu{Enter}');
    const button = await within(list).findByRole('button', { name: 'VL 01 neu umbenennen' });
    await waitFor(() => expect(button).toHaveFocus());
  });

  it('409 (Key noch in Arbeit) lässt sich mit demselben Key erneut versuchen', async () => {
    const user = userEvent.setup();
    const core = await openModule();
    await screen.findByText('Noch keine Folien.');
    core.rejectNextUpload = { status: 409, code: 'idempotency_key_in_progress' };
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('VL 01.pdf'));
    const uploads = await screen.findByRole('list', { name: 'Uploads' });
    await user.click(await within(uploads).findByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('Foliensatz hinzugefügt')).toBeInTheDocument();
    const sent = posts(core, '/slide-decks');
    expect(sent[1]?.headers['Idempotency-Key']).toBe(sent[0]?.headers['Idempotency-Key']);
  });

  it('dieselbe Datei im Rückgängig-Fenster erneut hochladen: Löschung wird zurückgenommen, kein DELETE', async () => {
    const user = userEvent.setup();
    const deck = makeDeck({ title: 'VL 01', ingest_state: 'verarbeitet', page_count: 3 });
    const core = await openModule({ decks: [deck] });
    // Der Core kennt die Datei schon: derselbe Inhalt wird als Dublette erkannt
    const list = await screen.findByRole('list', { name: 'Foliensätze' });
    await user.click(within(list).getByRole('button', { name: 'VL 01 löschen' }));
    expect(screen.getByText('Foliensatz gelöscht')).toBeInTheDocument();
    core.nextUploadDuplicateOf = deck.id;
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('VL 01.pdf'));
    expect(await screen.findByText('„VL 01“ ist wieder da.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anzeigen' })).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'VL 01' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(core.requests.some((r) => r.method === 'DELETE')).toBe(false);
  });

  it('Löschen, während „Schon vorhanden · Anzeigen“ sichtbar ist: „Rückgängig“ sofort da und fokussiert', async () => {
    const user = userEvent.setup();
    const deck = makeDeck({ title: 'VL 01', ingest_state: 'verarbeitet', page_count: 3 });
    const other = makeDeck({ title: 'VL 02', ingest_state: 'verarbeitet', page_count: 3 });
    const core = await openModule({ decks: [deck, other] });
    core.nextUploadDuplicateOf = deck.id;
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('VL 01.pdf'));
    expect(await screen.findByText('Schon vorhanden')).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Foliensätze' });
    await user.click(within(list).getByRole('button', { name: 'VL 02 löschen' }));
    expect(screen.getByRole('button', { name: 'Rückgängig' })).toHaveFocus();
    expect(core.requests.some((r) => r.method === 'DELETE')).toBe(false);
  });

  it('ein Upload-Toast verdrängt ein offenes „Rückgängig“ nicht (Löschen löst nicht vorzeitig aus)', async () => {
    const user = userEvent.setup();
    const deck = makeDeck({ title: 'VL 01', ingest_state: 'verarbeitet', page_count: 3 });
    const core = await openModule({ decks: [deck] });
    const list = await screen.findByRole('list', { name: 'Foliensätze' });
    await user.click(within(list).getByRole('button', { name: 'VL 01 löschen' }));
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('VL 02.pdf'));
    await screen.findByRole('link', { name: 'VL 02' });
    expect(screen.getByText('Foliensatz gelöscht')).toBeInTheDocument();
    expect(core.requests.some((r) => r.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Rückgängig' }));
    expect(await screen.findByText('Foliensatz hinzugefügt')).toBeInTheDocument();
    expect(core.requests.some((r) => r.method === 'DELETE')).toBe(false);
  });
});
