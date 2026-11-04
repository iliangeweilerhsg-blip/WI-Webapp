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

describe('Titel aus dem Dateinamen', () => {
  it('Unterstriche und Mehrfach-Leerzeichen werden zu einem Leerzeichen, .pdf entfällt', () => {
    expect(titleFromFile('Mikro_Vorlesung_70.pdf')).toBe('Mikro Vorlesung 70');
    expect(titleFromFile('  VL__03 _ Normalisierung .PDF')).toBe('VL 03 Normalisierung');
    expect(titleFromFile('.pdf')).toBe('');
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
    await advance(POLL_INTERVAL_MS + 100);
    expect(
      await screen.findByText('„Kaputt PDF“ ließ sich nicht lesen. Die Datei ist gespeichert.'),
    ).toBeInTheDocument();
  });

  it('neu → verarbeitet: kein Fehler-Toast; es wird nur einmal gemeldet', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const core = await openModule();
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('Gut.pdf'));
    await screen.findByText('Foliensatz hinzugefügt');
    core.finishIngest(core.decks[0]?.id ?? '', 3);
    await advance(POLL_INTERVAL_MS + 100);
    expect(screen.queryByText(/ließ sich nicht lesen/)).not.toBeInTheDocument();
    const before = core.requests.length;
    await advance(POLL_INTERVAL_MS * 3);
    // Fertig beobachtet: keine weiteren Abfragen nur für den Toast
    expect(core.requests.slice(before).filter((r) => r.path.startsWith('/slide-decks/'))).toHaveLength(0);
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
