import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ pathname: '/modul', search: '', push: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push }),
}));

import { ModulView } from '../src/components/ModulView.tsx';
import { POLL_INTERVAL_MS, titleFromFile } from '../src/lib/material.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { ToastProvider } from '../src/lib/toast.tsx';
import { UploadProvider } from '../src/lib/uploads.tsx';
import { installFakeCore, makeModule, makeSemester } from './fake-core.ts';

const MOD = makeModule();

function page() {
  return render(
    <ThemeProvider>
      <QueryProvider>
        <ToastProvider>
          <UploadProvider>
            <ModulView />
          </UploadProvider>
        </ToastProvider>
      </QueryProvider>
    </ThemeProvider>,
  );
}

const pdf = (name: string) => new File([new Uint8Array(1200)], name, { type: 'application/pdf' });

async function openModule() {
  const core = installFakeCore({ semesters: [makeSemester()], modules: [MOD] });
  page();
  await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
  await screen.findByText('Noch keine Folien.');
  return core;
}

beforeEach(() => {
  nav.pathname = '/modul';
  nav.search = `id=${MOD.id}`;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

/** Zeit in Sekundenschritten vorstellen, bis der Text da ist (ein Toast steht nur 5 s) */
async function advanceUntilText(text: string, maxMs = 15_000) {
  for (let t = 0; t < maxMs && !screen.queryByText(text); t += 1_000) await advance(1_000);
  return screen.findByText(text);
}

describe('Titel aus dem Dateinamen', () => {
  it('Unterstriche und Mehrfach-Leerzeichen werden zu einem Leerzeichen, .pdf entfällt', () => {
    expect(titleFromFile('Mikro_Vorlesung_70.pdf')).toBe('Mikro Vorlesung 70');
    expect(titleFromFile('  VL__03 _ Normalisierung .PDF')).toBe('VL 03 Normalisierung');
    expect(titleFromFile('.pdf')).toBe('');
    expect(titleFromFile('___.pdf')).toBe('');
  });

  it('NFC, ohne Steuerzeichen, auf 300 Code Points gekürzt (Emoji wird nicht zerschnitten)', () => {
    // NFD: „e“ + kombinierender Akut wird zu „é“
    expect(titleFromFile('Cafe\u0301.pdf')).toBe('Caf\u00e9');
    expect(titleFromFile('A\u0001B\u007fC.pdf')).toBe('ABC');
    const cut = titleFromFile(`${'a'.repeat(299)}😀😀.pdf`);
    expect([...cut]).toHaveLength(300);
    expect(cut.endsWith('😀')).toBe(true);
    expect(cut).not.toMatch(/[\ud800-\udbff]$/);
  });

  it('der Upload schickt den lesbaren Titel mit', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const core = await openModule();
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('Mikro_Vorlesung_70.pdf'));
    await screen.findByText('Foliensatz hinzugefügt');
    expect(core.decks[0]?.title).toBe('Mikro Vorlesung 70');
  });
});

describe('Einlesen gescheitert nach dem Hochladen', () => {
  it('neu → fehler: ruhiger Toast mit Titel, die Datei ist gespeichert', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const core = await openModule();
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('Kaputt_PDF.pdf'));
    await screen.findByText('Foliensatz hinzugefügt');
    const id = core.decks[0]?.id ?? '';

    // Solange es noch läuft, kommt nichts dazu
    await advance(POLL_INTERVAL_MS + 100);
    expect(screen.queryByText(/ließ sich nicht lesen/)).not.toBeInTheDocument();

    core.failIngest(id);
    expect(
      await advanceUntilText('„Kaputt PDF“ ließ sich nicht lesen. Die Datei ist gespeichert.'),
    ).toBeInTheDocument();
  });

  it('neu → verarbeitet: kein Fehler-Toast; es wird nur einmal gemeldet', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const core = await openModule();
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('Gut.pdf'));
    await screen.findByText('Foliensatz hinzugefügt');
    core.finishIngest(core.decks[0]?.id ?? '', 3);
    await advance(10_100);
    expect(screen.queryByText(/ließ sich nicht lesen/)).not.toBeInTheDocument();
    const before = core.requests.length;
    await advance(POLL_INTERVAL_MS * 3);
    // Fertig beobachtet: keine weiteren Abfragen nur für den Toast
    expect(core.requests.slice(before).filter((r) => r.path.startsWith('/slide-decks/'))).toHaveLength(0);
  });

  it('mehrere Fehler derselben Runde: ein Sammel-Toast', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const core = await openModule();
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), [pdf('A.pdf'), pdf('BB.pdf')]);
    await screen.findByText('2 Foliensätze hinzugefügt');
    for (const d of core.decks) core.failIngest(d.id);
    expect(
      await advanceUntilText('2 Foliensätze ließen sich nicht lesen. Die Dateien sind gespeichert.'),
    ).toBeInTheDocument();
  });

  it('gelöschter Eintrag (404): wird nicht weiter beobachtet', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const core = await openModule();
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('Weg.pdf'));
    await screen.findByText('Foliensatz hinzugefügt');
    const deck = core.decks[0];
    const detailCount = () => core.requests.filter((r) => r.path === `/slide-decks/${deck?.id}`).length;
    if (deck) deck.deleted_at = new Date().toISOString();
    // Die Abfrage, die den 404 bekommt, kann unter Last noch unterwegs sein – darum erst eine Weile laufen lassen
    // (länger als jede Pause, höchstens 10 s) und dann prüfen, dass danach nichts mehr abgefragt wird.
    await advance(15_000);
    const settled = detailCount();
    await advance(60_000);
    expect(detailCount()).toBe(settled);
  });

  it('der Toast geht nach höchstens 5 s von selbst weg', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await openModule();
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('VL 01.pdf'));
    await screen.findByText('Foliensatz hinzugefügt');
    await advance(5_100);
    expect(screen.queryByText('Foliensatz hinzugefügt')).not.toBeInTheDocument();
  });
});

describe('Beobachten nach dem Hochladen: Pausen (Folgepunkt 7)', () => {
  it('ein neuer Upload setzt die wachsenden Pausen auf 2 s zurück', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const core = await openModule();
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('Erste.pdf'));
    await screen.findByText('Foliensatz hinzugefügt');
    // Der erste Satz bleibt „neu“, die Pausen wachsen bis auf 10 s
    await advance(40_000);
    const first = core.decks[0]?.id ?? '';
    const before = core.requests.length;
    await advance(10_100);
    expect(core.requests.slice(before).filter((r) => r.path === `/slide-decks/${first}`)).toHaveLength(1);

    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('Zweite.pdf'));
    await screen.findByText('Foliensatz hinzugefügt');
    const second = core.decks.find((d) => d.id !== first)?.id ?? '';
    expect(second).not.toBe('');
    const mark = core.requests.length;
    // Schon nach gut 2 s wird der neue Eintrag abgefragt, nicht erst nach der alten Pause von 10 s
    await advance(POLL_INTERVAL_MS + 200);
    expect(
      core.requests.slice(mark).filter((r) => r.path === `/slide-decks/${second}`).length,
    ).toBeGreaterThan(0);
  });
});
