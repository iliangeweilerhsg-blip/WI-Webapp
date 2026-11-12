// UX-307 und UX-308 (STUDIENALLTAG-3): Liste vergangener Vorlesungen im Modul, „Zuletzt“ auf Heute, Konzepte im Modul.
// Alle Namen und Titel sind erfunden.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.TZ = 'Europe/Zurich';
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/modul',
  useSearchParams: () => new URLSearchParams('id=0190f6a2-0000-7000-8000-0000000000a1'),
  useRouter: () => ({ push: nav.push }),
}));

import { HeuteView } from '../src/components/HeuteView.tsx';
import { ModulView } from '../src/components/ModulView.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import {
  formatDuration,
  isFinished,
  newestFirst,
  sessionDurationMs,
  sessionLabel,
} from '../src/lib/sessions.ts';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { ToastProvider } from '../src/lib/toast.tsx';
import { UploadProvider } from '../src/lib/uploads.tsx';
import { installCalendarCore } from './calendar-core.ts';
import {
  installFakeCore,
  makeConceptDetail,
  makeDeck,
  makeModule,
  makeSemester,
  makeSession,
} from './fake-core.ts';

const id = (n: number) => `0190f6a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const DBS = makeModule();
const STAT = makeModule({ id: id(0xa2), name: 'Statistik', short_name: 'STA', color: 'mod-05' });

function finished(
  n: number,
  started: string,
  minutes: number,
  extra: Parameters<typeof makeSession>[0] = {},
) {
  const end = new Date(Date.parse(started) + minutes * 60_000).toISOString();
  return makeSession({
    id: id(1000 + n),
    state: 'verarbeitet',
    started_at: started,
    ended_at: end,
    created_at: started,
    ...extra,
  });
}

function modulePage() {
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Hilfsfunktionen für Vorlesungen', () => {
  it('formatiert Dauer, Beschriftung und Reihenfolge', () => {
    expect(formatDuration(45 * 60_000)).toBe('45 Min.');
    expect(formatDuration(90 * 60_000)).toBe('1 Std. 30 Min.');
    expect(formatDuration(2 * 3_600_000)).toBe('2 Std.');
    expect(formatDuration(10_000)).toBe('< 1 Min.');
    expect(sessionDurationMs(makeSession({ started_at: null, ended_at: null }))).toBeNull();
    expect(sessionLabel({ number: 7, title: 'Normalformen' })).toBe('VL 7 · Normalformen');
    expect(sessionLabel({ number: null, title: null }, 'Foliensatz 3')).toBe('Foliensatz 3');
    expect(sessionLabel({ number: null, title: ' ' })).toBe('Vorlesung');
    expect(isFinished({ state: 'beendet' })).toBe(true);
    expect(isFinished({ state: 'laeuft' })).toBe(false);
    const a = finished(1, '2026-11-02T08:00:00Z', 90);
    const b = finished(2, '2026-11-05T08:00:00Z', 90);
    expect(newestFirst([a, b]).map((s) => s.id)).toEqual([b.id, a.id]);
  });
});

describe('Modul: Vorlesungen (UX-307)', () => {
  it('listet vergangene Vorlesungen neueste zuerst mit Datum, Dauer und Link auf den Rückblick', async () => {
    const sessions = [
      finished(1, '2026-10-20T07:15:00Z', 90, { number: 1, title: 'Einführung' }),
      finished(2, '2026-11-03T07:15:00Z', 95, { number: 3, title: 'Normalformen' }),
      finished(3, '2026-10-27T07:15:00Z', 45, { number: null, slide_deck_id: id(0xd1), state: 'beendet' }),
      makeSession({ id: id(1004), state: 'laeuft', started_at: '2026-11-05T07:15:00Z' }),
      makeSession({ id: id(1005), module_id: STAT.id, state: 'beendet', title: 'Anderes Modul' }),
    ];
    const core = installFakeCore({
      semesters: [makeSemester()],
      modules: [DBS, STAT],
      sessions,
      decks: [makeDeck({ id: id(0xd1), title: 'Foliensatz Transaktionen' })],
    });
    modulePage();
    const list = await screen.findByRole('list', { name: /Aufgenommene Vorlesungen/ });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('VL 3 · Normalformen');
    expect(rows[0]).toHaveTextContent('1 Std. 35 Min.');
    expect(rows[1]).toHaveTextContent('Foliensatz Transaktionen');
    expect(rows[1]).toHaveTextContent('45 Min.');
    expect(rows[2]).toHaveTextContent('VL 1 · Einführung');
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute('href', `/rueckblick?id=${id(1002)}`);
    // Das Modul wird beim Core gefiltert
    expect(
      core.requests.some(
        (r) => r.method === 'GET' && r.path.startsWith('/sessions') && r.path.includes(`module_id=${DBS.id}`),
      ),
    ).toBe(true);
  });

  it('zeigt ohne Vorlesungen nichts Zusätzliches, die Foliensätze bleiben', async () => {
    installFakeCore({ semesters: [makeSemester()], modules: [DBS] });
    modulePage();
    expect(await screen.findByText('Noch keine Folien.')).toBeInTheDocument();
    expect(screen.queryByText(/Aufgenommene Vorlesungen/)).not.toBeInTheDocument();
  });
});

describe('Modul: Konzepte (UX-308)', () => {
  it('zeigt die aktiven Konzepte dieses Moduls und verlinkt die Bibliothek', async () => {
    const core = installFakeCore({ semesters: [makeSemester()], modules: [DBS, STAT] });
    core.concepts = [
      makeConceptDetail({
        id: id(0xc1),
        name: 'Dritte Normalform',
        one_liner: 'Keine transitiven Abhängigkeiten.',
      }),
      makeConceptDetail(
        { id: id(0xc2), name: 'Erwartungswert' },
        { modules: [{ id: STAT.id, name: STAT.name, short_name: STAT.short_name }] },
      ),
    ];
    const user = userEvent.setup();
    modulePage();
    await user.click(await screen.findByRole('tab', { name: 'Konzepte' }));
    const list = await screen.findByRole('list', { name: 'Konzepte des Moduls' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByRole('link', { name: 'Dritte Normalform' })).toHaveAttribute(
      'href',
      `/bibliothek?konzept=${id(0xc1)}`,
    );
    expect(within(list).getByText('Keine transitiven Abhängigkeiten.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alle Konzepte in der Bibliothek' })).toHaveAttribute(
      'href',
      '/bibliothek',
    );
    expect(screen.queryByText('Erwartungswert')).not.toBeInTheDocument();
  });

  it('ohne Konzepte: ruhiger leerer Zustand mit Link zur Inbox', async () => {
    installFakeCore({ semesters: [makeSemester()], modules: [DBS] });
    const user = userEvent.setup();
    modulePage();
    await user.click(await screen.findByRole('tab', { name: 'Konzepte' }));
    expect(await screen.findByText(/Noch keine Konzepte/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zur Inbox' })).toHaveAttribute('href', '/inbox');
  });
});

describe('Heute: Zuletzt (UX-307)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
  });

  function boot(sessions: ReturnType<typeof finished>[]) {
    installCalendarCore({ semesters: [makeSemester()], modules: [DBS, STAT], sessions, events: [] });
    return render(
      <ThemeProvider>
        <QueryProvider>
          <ToastProvider>
            <HeuteView />
          </ToastProvider>
        </QueryProvider>
      </ThemeProvider>,
    );
  }

  it('zeigt die letzten drei Vorlesungen aus allen Modulen, neueste zuerst', async () => {
    boot([
      finished(1, '2026-11-02T07:15:00Z', 90, { title: 'Alt' }),
      finished(2, '2026-11-05T07:15:00Z', 90, { title: 'Normalformen' }),
      finished(3, '2026-11-09T09:15:00Z', 60, { title: 'Erwartungswert', module_id: STAT.id }),
      finished(4, '2026-11-10T07:15:00Z', 45, { number: 4 }),
      finished(5, '2025-01-10T07:15:00Z', 45, { title: 'Zu lange her' }),
    ]);
    const heading = await screen.findByRole('heading', { name: 'Zuletzt' });
    const rows = within(heading.closest('section')!).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('VL 4');
    expect(rows[0]).toHaveTextContent('DBS');
    expect(rows[1]).toHaveTextContent('Erwartungswert');
    expect(rows[1]).toHaveTextContent('STA');
    expect(rows[2]).toHaveTextContent('Normalformen');
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute('href', `/rueckblick?id=${id(1004)}`);
    expect(screen.queryByText('Zu lange her')).not.toBeInTheDocument();
  });

  it('ohne vergangene Vorlesungen fehlt der Abschnitt', async () => {
    boot([]);
    await screen.findByText(/Heute steht nichts an/);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Zuletzt' })).not.toBeInTheDocument());
  });
});
