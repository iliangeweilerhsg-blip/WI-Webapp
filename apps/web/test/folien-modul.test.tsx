// Modulseite, Upload von Folien mit dem Feld „Für Vorlesung“ (VERTRAEGE §22.5, §22.7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Vor allen Imports: Die Formatierer lesen die Zeitzone beim Laden
vi.hoisted(() => {
  process.env.TZ = 'Europe/Zurich';
});

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/modul',
  useSearchParams: () => new URLSearchParams('id=0190f6a2-0000-7000-8000-0000000000a1'),
  useRouter: () => ({ push: nav.push }),
}));

import { ModulView } from '../src/components/ModulView.tsx';
import { resetPendingMaterialDeletes } from '../src/lib/material.ts';
import { resetPendingModuleDeletes } from '../src/lib/modules.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { ToastProvider } from '../src/lib/toast.tsx';
import { UploadProvider } from '../src/lib/uploads.tsx';
import {
  installFakeCore,
  makeDeck,
  makeModule,
  makeSemester,
  makeSession,
  type FakeCore,
} from './fake-core.ts';

const MOD = makeModule();
const RUNNING = '0190f6a2-0000-7000-8000-0000000000e1';
const LATER = '0190f6a2-0000-7000-8000-0000000000e2';
const WITH_DECK = '0190f6a2-0000-7000-8000-0000000000e3';
const ENDED = '0190f6a2-0000-7000-8000-0000000000e4';
const TOMORROW = '0190f6a2-0000-7000-8000-0000000000e5';
const OLD_DECK = '0190f6a2-0000-7000-8000-0000000000d9';

function sessions() {
  const base = { module_id: MOD.id, created_at: '2026-11-03T08:00:00Z', updated_at: '2026-11-04T07:00:00Z' };
  return [
    makeSession({ ...base, id: RUNNING, number: 7, state: 'laeuft', started_at: '2026-11-04T07:15:00Z' }),
    makeSession({
      ...base,
      id: LATER,
      number: 8,
      state: 'geplant',
      started_at: null,
      planned_starts_at: '2026-11-04T13:15:00Z',
    }),
    makeSession({
      ...base,
      id: WITH_DECK,
      number: 6,
      state: 'bereit',
      started_at: null,
      planned_starts_at: '2026-11-04T10:15:00Z',
      slide_deck_id: OLD_DECK,
    }),
    makeSession({
      ...base,
      id: ENDED,
      number: 5,
      state: 'beendet',
      started_at: '2026-11-04T05:15:00Z',
      ended_at: '2026-11-04T06:45:00Z',
    }),
    makeSession({
      ...base,
      id: TOMORROW,
      number: 9,
      state: 'geplant',
      started_at: null,
      planned_starts_at: '2026-11-05T07:15:00Z',
    }),
  ];
}

const pdf = (name: string) => new File([new Uint8Array(1200)], name, { type: 'application/pdf' });

let core: FakeCore;
/** Alle hochgeladenen Formulare (`POST /slide-decks`), damit das Feld `session_id` prüfbar ist */
let forms: FormData[];

function openModule(initial: Parameters<typeof installFakeCore>[0] = {}) {
  vi.setSystemTime(new Date('2026-11-04T09:00:00Z')); // 10:00 Uhr
  core = installFakeCore({
    semesters: [makeSemester()],
    modules: [MOD],
    sessions: sessions(),
    decks: [makeDeck({ id: OLD_DECK, ingest_state: 'verarbeitet', title: 'Alt' })],
    ...initial,
  });
  forms = [];
  const coreFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body instanceof FormData && String(input).endsWith('/slide-decks')) forms.push(init.body);
    return coreFetch(input, init);
  });
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

const field = () => screen.findByLabelText('Für Vorlesung');
const sent = (n = 0) => forms[n]?.get('session_id');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  nav.push.mockReset();
});
afterEach(() => {
  cleanup();
  resetPendingMaterialDeletes();
  resetPendingModuleDeletes();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Modulseite: Upload „Für Vorlesung“', () => {
  it('bietet nur heutige, nicht abgeschlossene Sessions ohne Satz an, Standard ist die laufende', async () => {
    openModule();
    const select = (await field()) as HTMLSelectElement;
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['keine', expect.stringContaining('VL 7'), expect.stringContaining('VL 8')]);
    expect(options[1]).toContain('läuft');
    expect(select.value).toBe(RUNNING);
    // Mit Satz, beendet und morgen stehen nicht zur Wahl
    expect(select).not.toHaveTextContent('VL 6');
    expect(select).not.toHaveTextContent('VL 5');
    expect(select).not.toHaveTextContent('VL 9');
  });

  it('ohne laufende Session steht „keine“ vor', async () => {
    openModule({ sessions: sessions().filter((s) => s.id !== RUNNING) });
    const select = (await field()) as HTMLSelectElement;
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
    expect(select.value).toBe('');
  });

  it('ohne passende Session gibt es das Feld nicht', async () => {
    openModule({ sessions: [] });
    await screen.findByRole('list', { name: 'Foliensätze' });
    await waitFor(() => expect(core.requests.some((r) => r.path.startsWith('/sessions?'))).toBe(true));
    expect(screen.queryByLabelText('Für Vorlesung')).toBeNull();
  });

  it('der Upload schickt session_id mit, der Core hängt den Satz an, die Session verschwindet aus der Wahl', async () => {
    const user = userEvent.setup();
    openModule();
    await field();
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('VL_07_Transaktionen.pdf'));
    await waitFor(() => expect(core.decks.some((d) => d.title === 'VL 07 Transaktionen')).toBe(true));
    expect(sent()).toBe(RUNNING);
    const created = core.decks.find((d) => d.title === 'VL 07 Transaktionen')!;
    expect(core.sessions.find((s) => s.id === RUNNING)?.slide_deck_id).toBe(created.id);
    // Ersetzt wird hier nie: Die Session hat nun einen Satz und steht nicht mehr zur Wahl
    await waitFor(() => expect(screen.getByLabelText('Für Vorlesung')).not.toHaveTextContent('VL 7'));
    expect((screen.getByLabelText('Für Vorlesung') as HTMLSelectElement).value).toBe('');
  });

  it('„keine“ lädt ohne session_id hoch, die Session bleibt ohne Satz', async () => {
    const user = userEvent.setup();
    openModule();
    await user.selectOptions(await field(), '');
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('Anderes.pdf'));
    await waitFor(() => expect(core.decks.some((d) => d.title === 'Anderes')).toBe(true));
    expect(forms[0]?.has('session_id')).toBe(false);
    expect(core.sessions.find((s) => s.id === RUNNING)?.slide_deck_id).toBeNull();
  });

  it('eine gewählte spätere Vorlesung bekommt den Satz', async () => {
    const user = userEvent.setup();
    openModule();
    await user.selectOptions(await field(), LATER);
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('VL_08.pdf'));
    await waitFor(() => expect(core.decks.some((d) => d.title === 'VL 08')).toBe(true));
    expect(sent()).toBe(LATER);
    expect(core.sessions.find((s) => s.id === LATER)?.slide_deck_id).not.toBeNull();
    expect(core.sessions.find((s) => s.id === RUNNING)?.slide_deck_id).toBeNull();
  });

  it('Dateien, die ins Fenster fallen, gehören derselben Vorlesung', async () => {
    openModule();
    await field();
    fireEvent.drop(window, { dataTransfer: { files: [pdf('Gezogen.pdf')], types: ['Files'] } });
    await waitFor(() => expect(core.decks.some((d) => d.title === 'Gezogen')).toBe(true));
    expect(sent()).toBe(RUNNING);
  });

  it('409 slide_deck_session_closed: ruhige Meldung, kein Satz, kein „Erneut versuchen“', async () => {
    const user = userEvent.setup();
    openModule();
    await field();
    // Die Vorlesung endet, bevor der Upload ankommt
    core.sessions.find((s) => s.id === RUNNING)!.state = 'beendet';
    const before = core.decks.length;
    await user.upload(screen.getByLabelText('PDF-Dateien auswählen'), pdf('Zu_spaet.pdf'));
    const uploads = await screen.findByRole('list', { name: 'Uploads' });
    expect(within(uploads).getByRole('alert')).toHaveTextContent('Diese Vorlesung ist schon beendet');
    expect(within(uploads).getByRole('alert')).toHaveTextContent('ohne „Für Vorlesung“');
    expect(within(uploads).queryByRole('button', { name: 'Erneut versuchen' })).toBeNull();
    expect(core.decks).toHaveLength(before);
  });
});
