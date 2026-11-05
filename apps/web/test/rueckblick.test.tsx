// Rückblick einer Vorlesung (T2-03, F-NAC-02, VERTRAEGE §18.9): Zustände, Transkript je Folie, Abspielen ab einem
// Abschnitt, Markierung und Folie folgen der Position, Tasten, Live-Fortschritt über `session.updated`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Session, SessionTranscript } from '@sg/shared';
import { ReviewView } from '../src/components/rueckblick/ReviewView.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { SyncProvider } from '../src/lib/sync/SyncProvider.tsx';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { clockAt } from '../src/lib/transcript.ts';
import { installAudioStub, type AudioStub } from './audio-stub.ts';
import {
  installFakeCore,
  makeDeck,
  makeLine,
  makeModule,
  makeRecording,
  makeSemester,
  makeSession,
  makeSlideSegment,
  makeSlides,
  makeTranscript,
  makeTranscriptInfo,
  type FakeCore,
} from './fake-core.ts';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/rueckblick',
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn() }),
}));

const DBS = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a3', name: 'Datenbanksysteme' });
const SESSION_ID = '0190f6a2-0000-7000-8000-0000000000e1';
const DECK_ID = '0190f6a2-0000-7000-8000-0000000000d1';
const R1 = '0190f6a2-0000-7000-8000-0000000000f1';
const R2 = '0190f6a2-0000-7000-8000-0000000000f5';
const STARTED = '2026-11-04T08:00:00Z';
const S = makeSlides(DECK_ID, 3).map((s) => ({ id: s.id, index: s.index }));
const [S1, S2, S3] = S as [(typeof S)[0], (typeof S)[0], (typeof S)[0]];

const ALL_DONE: Session['processing'] = {
  'audio.finalize': 'fertig',
  transcribe: 'fertig',
  'align.log': 'fertig',
};

/** Zwei Aufnahmen (R2 beginnt nach einer Lücke), drei Folien, Zeilen auf Folie 1 und 2, zwei ohne Folie */
function fullTranscript(overrides: Partial<SessionTranscript> = {}): SessionTranscript {
  return makeTranscript({
    session_id: SESSION_ID,
    slide_deck_id: DECK_ID,
    slide_source: 'log',
    slide_segments: [
      makeSlideSegment(1, S1, 10_000, 200_000),
      makeSlideSegment(2, S2, 200_000, 500_000),
      makeSlideSegment(3, S3, 500_000, 600_000),
    ],
    recordings: [
      makeRecording({ id: R1, started_ms: 0, duration_ms: 600_000 }),
      makeRecording({ id: R2, started_ms: 700_000, duration_ms: 100_000 }),
    ],
    transcripts: [makeTranscriptInfo()],
    lines: [
      makeLine(0, 1_000, 5_000, 'Guten Morgen, wir warten noch kurz.', null),
      makeLine(1, 10_000, 20_000, 'Heute geht es um Normalformen.', S1),
      makeLine(2, 20_000, 40_000, 'Zuerst die erste Normalform.', S1),
      makeLine(3, 200_000, 230_000, 'Die dritte Normalform ist klausurrelevant.', S2),
      makeLine(4, 230_000, 260_000, 'Dazu gibt es gleich ein Beispiel.', S2),
      makeLine(5, 710_000, 720_000, 'Noch eine Frage zum Schluss.', null, { recording_id: R2 }),
    ],
    ...overrides,
  });
}

function fakeSync() {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const client = {
    connectionState: 'online',
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    onEvent: vi.fn((name: string, fn: (data: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(fn);
      listeners.set(name, set);
      return () => void set.delete(fn);
    }),
    takeOver: vi.fn(),
    listShelf: vi.fn(async () => []),
    subscribe: vi.fn(),
  };
  return {
    client: client as unknown as SyncClient,
    emit: (name: string, data: unknown) => act(() => listeners.get(name)?.forEach((fn) => fn(data))),
  };
}

let core: FakeCore;
let sync: ReturnType<typeof fakeSync>;
let stub: AudioStub;

function boot(
  opts: {
    session?: Partial<Session> | null;
    transcript?: SessionTranscript;
    deck?: boolean;
    search?: string;
    failTranscript?: boolean;
  } = {},
) {
  nav.search = opts.search ?? `id=${SESSION_ID}`;
  const deck = opts.deck ?? true;
  core = installFakeCore({
    semesters: [makeSemester()],
    modules: [DBS],
    decks: deck ? [makeDeck({ id: DECK_ID })] : [],
    sessions:
      opts.session === null
        ? []
        : [
            makeSession({
              id: SESSION_ID,
              module_id: DBS.id,
              number: 7,
              state: 'verarbeitet',
              started_at: STARTED,
              ended_at: '2026-11-04T09:00:00Z',
              slide_deck_id: deck ? DECK_ID : null,
              processing: ALL_DONE,
              updated_at: '2026-11-04T09:10:00Z',
              ...opts.session,
            }),
          ],
  });
  if (deck) core.finishIngest(DECK_ID, 3);
  core.failTranscript = opts.failTranscript ?? false;
  core.transcripts[SESSION_ID] = opts.transcript ?? fullTranscript();
  sync = fakeSync();
  return render(
    <QueryProvider>
      <SyncProvider client={sync.client}>
        <ReviewView />
      </SyncProvider>
    </QueryProvider>,
  );
}

const audio = (id: string) =>
  document.querySelector<HTMLAudioElement>(`audio[data-recording="${id}"]`) as HTMLAudioElement;
const lineEls = () => screen.getAllByTestId('transcript-line');
const lineTexts = () => lineEls().map((el) => el.textContent ?? '');
const reprocessPosts = () => core.requests.filter((r) => r.method === 'POST' && /\/reprocess$/.test(r.path));
const transcriptGets = () =>
  core.requests.filter((r) => r.method === 'GET' && /\/transcript/.test(r.path)).length;
const key = (target: Element | Window, k: string) => fireEvent.keyDown(target, { key: k });
const counter = () => screen.getByTestId('review-slide-counter');
const activeLines = () => lineEls().filter((el) => el.getAttribute('aria-current') === 'true');

/** Position der Wiedergabe: das `<audio>` der Aufnahme meldet `seconds` (Datei-Zeit) */
function tick(id: string, seconds: number) {
  const el = audio(id);
  act(() => {
    el.currentTime = seconds;
    fireEvent.timeUpdate(el);
  });
}

beforeEach(() => {
  stub = installAudioStub();
});
afterEach(() => {
  stub.restore();
  cleanup();
  vi.unstubAllGlobals();
});

describe('Rückblick: Folie und Transkript', () => {
  it('zeigt links die Folie und daneben das Transkript der ersten Folie mit Zeitangaben', async () => {
    boot();
    expect(
      await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme · Vorlesung 7/ }),
    ).toBeVisible();
    await screen.findAllByTestId('transcript-line');
    // Die erste zugeordnete Folie ist gewählt, ihr Bild kommt aus dem Foliensatz
    expect(await screen.findByAltText('Folie 1')).toHaveAttribute(
      'src',
      expect.stringContaining(`/slides/${S1.id}/image`),
    );
    expect(counter()).toHaveTextContent('Folie 1 von 3');
    expect(screen.getByRole('heading', { level: 2, name: 'Transkript zu Folie 1' })).toBeVisible();
    expect(lineTexts()).toHaveLength(2);
    const first = lineEls()[0] as HTMLElement;
    expect(first).toHaveTextContent('Heute geht es um Normalformen.');
    // Uhrzeit der Vorlesung (Ortszeit) mit Sekunden
    expect(within(first).getByText(/^\d{2}:\d{2}:\d{2}$/)).toHaveTextContent(clockAt(STARTED, 10_000, true));
  });

  it('wechselt mit der Folienleiste das Transkript; Folien ohne Gesagtes sagen das ruhig', async () => {
    boot();
    await screen.findAllByTestId('transcript-line');
    fireEvent.click(screen.getByRole('button', { name: 'Folie 2' }));
    expect(counter()).toHaveTextContent('Folie 2 von 3');
    expect(lineTexts().join(' ')).toContain('Die dritte Normalform ist klausurrelevant.');
    expect(lineTexts().join(' ')).not.toContain('Heute geht es um Normalformen.');
    fireEvent.click(screen.getByRole('button', { name: 'Folie 3' }));
    expect(screen.queryAllByTestId('transcript-line')).toHaveLength(0);
    expect(screen.getByText('Zu dieser Folie wurde nichts gesagt.')).toBeVisible();
    // Zeilen ohne Folie haben einen eigenen Eintrag in der Leiste
    fireEvent.click(screen.getByRole('button', { name: 'Ohne Folie' }));
    expect(lineTexts()).toHaveLength(2);
    expect(lineTexts().join(' ')).toContain('Noch eine Frage zum Schluss.');
  });

  it('lädt das Transkript einmal (ohne Wörter) und filtert beim Folienwechsel lokal', async () => {
    boot();
    await screen.findAllByTestId('transcript-line');
    fireEvent.click(screen.getByRole('button', { name: 'Folie 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Folie 1' }));
    const gets = core.requests.filter((r) => r.method === 'GET' && /\/transcript/.test(r.path));
    expect(gets).toHaveLength(1);
    expect(gets[0]?.path).toBe(`/sessions/${SESSION_ID}/transcript`);
  });

  it('Pfeiltasten in der Folienleiste wählen die Nachbarfolie', async () => {
    boot();
    await screen.findAllByTestId('transcript-line');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Folie 1' }), { key: 'ArrowRight' });
    expect(counter()).toHaveTextContent('Folie 2 von 3');
  });
});

describe('Rückblick: Wiedergabe', () => {
  it('Klick auf einen Abschnitt spielt die Aufnahme ab dieser Stelle', async () => {
    boot();
    await screen.findAllByTestId('transcript-line');
    fireEvent.click(lineEls()[1] as HTMLElement); // „Zuerst die erste Normalform.“ ab 20 s
    expect(audio(R1).currentTime).toBe(20);
    expect(stub.started.at(-1)).toMatchObject({ id: R1, at: 20 });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeVisible();
  });

  it('rechnet für spätere Aufnahmen die Position in der Datei: t − started_ms', async () => {
    boot();
    await screen.findAllByTestId('transcript-line');
    fireEvent.click(lineEls()[0] as HTMLElement); // läuft zuerst in R1
    expect(audio(R1).paused).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ohne Folie' }));
    fireEvent.click(lineEls()[1] as HTMLElement); // 710 s Sitzungszeit, R2 beginnt bei 700 s
    expect(audio(R2).currentTime).toBe(10);
    expect(stub.started.at(-1)).toMatchObject({ id: R2, at: 10 });
    expect(audio(R1).paused).toBe(true);
  });

  it('springt am Ende einer Aufnahme zum Beginn der nächsten', async () => {
    boot();
    await screen.findAllByTestId('transcript-line');
    fireEvent.click(lineEls()[0] as HTMLElement);
    act(() => {
      fireEvent.ended(audio(R1));
    });
    expect(audio(R2).currentTime).toBe(0);
    expect(stub.started.at(-1)).toMatchObject({ id: R2, at: 0 });
  });

  it('markiert beim Abspielen den aktuellen Abschnitt und folgt der Folie', async () => {
    boot();
    await screen.findAllByTestId('transcript-line');
    // Vor dem Abspielen ist nichts markiert
    expect(activeLines()).toHaveLength(0);
    fireEvent.click(lineEls()[0] as HTMLElement);
    tick(R1, 25);
    expect(activeLines()).toHaveLength(1);
    expect(activeLines()[0]).toHaveTextContent('Zuerst die erste Normalform.');
    // Grenze: Ende ist ausschließlich, bei 40 s läuft kein Abschnitt dieser Folie mehr
    tick(R1, 40);
    expect(activeLines()).toHaveLength(0);
    // Die Folie folgt der Position
    tick(R1, 205);
    expect(counter()).toHaveTextContent('Folie 2 von 3');
    expect(activeLines()[0]).toHaveTextContent('Die dritte Normalform');
    expect(await screen.findByAltText('Folie 2')).toBeVisible();
  });

  it('die Uhr im Player folgt der Abspielposition', async () => {
    boot();
    await screen.findAllByTestId('transcript-line');
    fireEvent.click(lineEls()[0] as HTMLElement);
    tick(R1, 65);
    expect(screen.getByTestId('review-clock')).toHaveTextContent(clockAt(STARTED, 65_000, true));
  });

  it('±15 s und Geschwindigkeit wirken auf die laufende Aufnahme', async () => {
    boot();
    await screen.findAllByTestId('transcript-line');
    fireEvent.click(lineEls()[0] as HTMLElement); // 10 s
    fireEvent.click(screen.getByRole('button', { name: '15 Sekunden vor' }));
    expect(audio(R1).currentTime).toBe(25);
    fireEvent.click(screen.getByRole('button', { name: '15 Sekunden zurück' }));
    expect(audio(R1).currentTime).toBe(10);
    fireEvent.change(screen.getByRole('combobox', { name: 'Geschwindigkeit' }), { target: { value: '1.5' } });
    expect(audio(R1).playbackRate).toBe(1.5);
  });
});

describe('Rückblick: Tastatur', () => {
  it('Abschnitte sind fokussierbar, Enter spielt ab', async () => {
    boot();
    await screen.findAllByTestId('transcript-line');
    const line = lineEls()[1] as HTMLElement;
    expect(line).toHaveAttribute('tabindex', '0');
    line.focus();
    expect(document.activeElement).toBe(line);
    key(line, 'Enter');
    expect(stub.started.at(-1)).toMatchObject({ id: R1, at: 20 });
  });

  it('Leertaste pausiert und setzt fort; auf dem Abschnitt, ohne Seitenscroll', async () => {
    boot();
    await screen.findAllByTestId('transcript-line');
    const line = lineEls()[0] as HTMLElement;
    key(line, 'Enter');
    const plays = stub.play.mock.calls.length;
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    act(() => {
      line.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(stub.pause).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Abspielen' })).toBeVisible();
    key(line, ' ');
    expect(stub.play.mock.calls.length).toBe(plays + 1);
  });

  it('J und L springen um 15 s', async () => {
    boot();
    await screen.findAllByTestId('transcript-line');
    key(lineEls()[0] as HTMLElement, 'Enter'); // 10 s
    key(document.body, 'l');
    expect(audio(R1).currentTime).toBe(25);
    key(document.body, 'j');
    expect(audio(R1).currentTime).toBe(10);
  });

  it('löst in Eingabefeldern nichts aus', async () => {
    boot();
    await screen.findAllByTestId('transcript-line');
    key(lineEls()[0] as HTMLElement, 'Enter');
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    document.body.append(input, area);
    const pauses = stub.pause.mock.calls.length;
    const before = audio(R1).currentTime;
    for (const field of [input, area]) {
      key(field, ' ');
      key(field, 'j');
      key(field, 'l');
    }
    expect(stub.pause.mock.calls.length).toBe(pauses);
    expect(audio(R1).currentTime).toBe(before);
    input.remove();
    area.remove();
  });

  it('die Leertaste auf einer Schaltfläche löst nur deren eigene Aktion aus', async () => {
    boot();
    await screen.findAllByTestId('transcript-line');
    key(lineEls()[0] as HTMLElement, 'Enter');
    const plays = stub.play.mock.calls.length;
    const pauses = stub.pause.mock.calls.length;
    key(screen.getByRole('button', { name: 'Folie 2' }), ' ');
    expect(stub.play.mock.calls.length).toBe(plays);
    expect(stub.pause.mock.calls.length).toBe(pauses);
  });
});

describe('Rückblick: Zustände', () => {
  it('Verarbeitung offen: Schrittliste und „Transkript kommt noch“, ohne Balken und Prozent', async () => {
    boot({
      session: { processing: { 'audio.finalize': 'fertig', transcribe: 'laeuft', 'align.log': 'wartet' } },
      transcript: makeTranscript({ session_id: SESSION_ID, recordings: [makeRecording({ id: R1 })] }),
    });
    const list = await screen.findByTestId('step-list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-step'))).toEqual([
      'audio.finalize',
      'transcribe',
      'align.log',
    ]);
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['fertig', 'laeuft', 'wartet']);
    expect(rows[0]).toHaveTextContent('✓');
    expect(rows[0]).toHaveTextContent('Audio');
    expect(rows[1]).toHaveTextContent('…');
    expect(rows[1]).toHaveTextContent('Transkript');
    expect(rows[2]).toHaveTextContent('–');
    expect(rows[2]).toHaveTextContent('Folien zuordnen');
    expect(screen.getByText('Transkript kommt noch.')).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(list.textContent).not.toMatch(/%/);
  });

  it('Verarbeitung offen geht vor „keine Aufnahme“', async () => {
    boot({
      session: { processing: { 'audio.finalize': 'laeuft' } },
      transcript: makeTranscript({ session_id: SESSION_ID }),
    });
    expect(await screen.findByText('Transkript kommt noch.')).toBeVisible();
    expect(screen.queryByText('Zu dieser Session gibt es keine Aufnahme.')).toBeNull();
  });

  it('zeigt bei offener Verarbeitung vorhandene Folien und Zeilen trotzdem', async () => {
    boot({
      session: { processing: { 'audio.finalize': 'fertig', transcribe: 'fertig', 'align.log': 'laeuft' } },
    });
    await screen.findAllByTestId('transcript-line');
    expect(screen.getByTestId('step-list')).toBeVisible();
    expect(counter()).toHaveTextContent('Folie 1 von 3');
  });

  it('Fortschritt live: session.updated lädt das fertige Transkript nach, die Schrittliste verschwindet', async () => {
    const running: Session['processing'] = {
      'audio.finalize': 'fertig',
      transcribe: 'laeuft',
      'align.log': 'fertig',
    };
    boot({
      session: { processing: running },
      transcript: makeTranscript({ session_id: SESSION_ID, recordings: [makeRecording({ id: R1 })] }),
    });
    await screen.findByTestId('step-list');
    expect(screen.queryAllByTestId('transcript-line')).toHaveLength(0);
    expect(transcriptGets()).toBe(1);

    core.transcripts[SESSION_ID] = fullTranscript();
    const current = core.sessions[0] as Session;
    // Zwischenstand: läuft noch (anderer Schritt wechselt), kein Neuladen des Transkripts
    sync.emit('session.updated', {
      ...current,
      processing: { ...running, 'align.log': 'laeuft' },
      updated_at: '2026-11-04T09:11:00Z',
    });
    await waitFor(() =>
      expect(
        within(screen.getByTestId('step-list')).getByText('Folien zuordnen').closest('li'),
      ).toHaveAttribute('data-state', 'laeuft'),
    );
    expect(transcriptGets()).toBe(1);
    // Fertig: Transkript wird neu geladen
    sync.emit('session.updated', { ...current, processing: ALL_DONE, updated_at: '2026-11-04T09:12:00Z' });
    expect(await screen.findAllByTestId('transcript-line')).toHaveLength(2);
    expect(transcriptGets()).toBe(2);
    await waitFor(() => expect(screen.queryByTestId('step-list')).toBeNull());
  });

  it('ältere Fassungen von session.updated ändern nichts', async () => {
    boot({
      session: { processing: { 'audio.finalize': 'fertig', transcribe: 'laeuft', 'align.log': 'fertig' } },
    });
    await screen.findByTestId('step-list');
    const current = core.sessions[0] as Session;
    sync.emit('session.updated', { ...current, processing: ALL_DONE, updated_at: '2026-11-04T08:00:00Z' });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('step-list')).toBeVisible();
  });

  it('keine Aufnahme: ohne Aufnahme mit Länge', async () => {
    boot({
      transcript: makeTranscript({
        session_id: SESSION_ID,
        recordings: [makeRecording({ duration_ms: null })],
      }),
    });
    expect(await screen.findByText('Zu dieser Session gibt es keine Aufnahme.')).toBeVisible();
    expect(screen.queryByTestId('review-player')).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Zum Modul' }).length).toBeGreaterThan(0);
  });

  it('Audio nicht fertig und noch keine Länge: die Schrittliste statt „keine Aufnahme“', async () => {
    boot({
      session: {
        processing: { 'audio.finalize': 'fehler', transcribe: 'abgebrochen', 'align.log': 'abgebrochen' },
      },
      transcript: makeTranscript({
        session_id: SESSION_ID,
        recordings: [makeRecording({ duration_ms: null })],
      }),
    });
    expect(await screen.findByRole('button', { name: 'Mit vorhandenem Audio fortfahren' })).toBeVisible();
    expect(screen.queryByText('Zu dieser Session gibt es keine Aufnahme.')).toBeNull();
  });

  it('keine Aufnahme: Transkript fertig, aber leer', async () => {
    boot({ transcript: makeTranscript({ session_id: SESSION_ID, recordings: [makeRecording({ id: R1 })] }) });
    expect(await screen.findByText('Zu dieser Session gibt es keine Aufnahme.')).toBeVisible();
  });

  it('Fehler: „Erneut versuchen“ startet ab dem ersten Schritt in fehler/abgebrochen', async () => {
    boot({
      session: {
        processing: { 'audio.finalize': 'fertig', transcribe: 'fehler', 'align.log': 'abgebrochen' },
      },
    });
    const list = await screen.findByTestId('step-list');
    expect(within(list).getAllByText('nicht fertig')).toHaveLength(2);
    // Nur bei Fehler im Audio gibt es „Mit vorhandenem Audio fortfahren“
    expect(screen.queryByRole('button', { name: 'Mit vorhandenem Audio fortfahren' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(reprocessPosts()).toHaveLength(1));
    expect(reprocessPosts()[0]?.body).toEqual({ from_step: 'transcribe' });
    // Die Antwort enthält die Session: Die Schritte stehen jetzt auf „wartet“
    await waitFor(() =>
      expect(
        within(screen.getByTestId('step-list'))
          .getAllByRole('listitem')
          .map((r) => r.getAttribute('data-state')),
      ).toEqual(['fertig', 'wartet', 'wartet']),
    );
    expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).toBeNull();
  });

  it('Fehler im Audio: „Erneut versuchen“ ab Audio und „Mit vorhandenem Audio fortfahren“ ab Transkript', async () => {
    const failed: Session['processing'] = {
      'audio.finalize': 'fehler',
      transcribe: 'abgebrochen',
      'align.log': 'abgebrochen',
    };
    boot({ session: { processing: failed } });
    await screen.findByTestId('step-list');
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(reprocessPosts()).toHaveLength(1));
    expect(reprocessPosts()[0]?.body).toEqual({ from_step: 'audio.finalize' });
    cleanup();
    boot({ session: { processing: failed } });
    await screen.findByTestId('step-list');
    fireEvent.click(screen.getByRole('button', { name: 'Mit vorhandenem Audio fortfahren' }));
    await waitFor(() => expect(reprocessPosts()).toHaveLength(1));
    expect(reprocessPosts()[0]?.body).toEqual({ from_step: 'transcribe' });
  });

  it('Fehler: die Folien bleiben sichtbar, das Transkript fehlt ruhig', async () => {
    boot({
      session: { processing: { 'audio.finalize': 'fertig', transcribe: 'fehler', 'align.log': 'fertig' } },
      transcript: fullTranscript({ lines: [], transcripts: [] }),
    });
    expect(await screen.findByText('Transkript nicht fertig.')).toBeVisible();
    expect(counter()).toHaveTextContent('Folie 1 von 3');
  });

  it('Fehler: eine Ablehnung des Core steht ruhig in der Liste', async () => {
    const t = fullTranscript();
    t.recordings = [makeRecording({ id: R1, chunk_count: 0 })];
    boot({ session: { processing: { 'audio.finalize': 'fehler' } }, transcript: t });
    await screen.findByTestId('step-list');
    fireEvent.click(screen.getByRole('button', { name: 'Mit vorhandenem Audio fortfahren' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('noch kein Audio');
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
  });

  it('veraltet: Hinweis mit „Transkript aktualisieren“ (ab transcribe)', async () => {
    boot({ transcript: fullTranscript({ stale: true }) });
    expect(await screen.findByText(/neues Audio dazugekommen/)).toBeVisible();
    // Das alte Transkript bleibt sichtbar
    expect(screen.getAllByTestId('transcript-line')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Transkript aktualisieren' }));
    await waitFor(() => expect(reprocessPosts()).toHaveLength(1));
    expect(reprocessPosts()[0]?.body).toEqual({ from_step: 'transcribe' });
    // Danach läuft die Verarbeitung: Schrittliste statt Hinweis
    expect(await screen.findByTestId('step-list')).toBeVisible();
  });

  it('nicht veraltet: kein Hinweis', async () => {
    boot();
    await screen.findAllByTestId('transcript-line');
    expect(screen.queryByRole('button', { name: 'Transkript aktualisieren' })).toBeNull();
    expect(screen.queryByTestId('step-list')).toBeNull();
  });

  it('ohne Folien: das Transkript steht als eine Liste', async () => {
    boot({
      deck: false,
      transcript: fullTranscript({ slide_deck_id: null, slide_source: null, slide_segments: [] }),
    });
    expect(await screen.findByText('Ohne Folien: Das Transkript steht als eine Liste.')).toBeVisible();
    expect(lineTexts()).toHaveLength(6);
    expect(screen.queryByTestId('review-slides')).toBeNull();
    // Abspielen geht trotzdem
    fireEvent.click(lineEls()[1] as HTMLElement);
    expect(stub.started.at(-1)).toMatchObject({ id: R1, at: 10 });
  });

  it('Folien ohne Zuordnung: eine Liste mit eigenem Hinweis', async () => {
    boot({ transcript: fullTranscript({ slide_source: null, slide_segments: [] }) });
    expect(await screen.findByText(/Die Folien sind noch nicht zugeordnet/)).toBeVisible();
    expect(lineTexts()).toHaveLength(6);
  });

  it('eine laufende Session hat noch keinen Rückblick', async () => {
    boot({ session: { state: 'laeuft', ended_at: null } });
    expect(await screen.findByText('Diese Session läuft noch. Den Rückblick gibt es danach.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Zur Vorlesung' })).toHaveAttribute(
      'href',
      `/session?id=${SESSION_ID}`,
    );
  });

  it('unbekannte Session und fehlende ID', async () => {
    boot({ session: null });
    expect(await screen.findByText('Diese Session gibt es nicht (mehr).')).toBeVisible();
    cleanup();
    boot({ search: '' });
    expect(await screen.findByText('Keine Session ausgewählt.')).toBeVisible();
  });

  it('Transkript nicht erreichbar: ruhiger Hinweis, „Erneut versuchen“ lädt neu', async () => {
    boot({ failTranscript: true });
    expect(await screen.findByText(/Das Transkript ist gerade nicht erreichbar/)).toBeVisible();
    core.failTranscript = false;
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findAllByTestId('transcript-line')).toHaveLength(2);
  });
});

describe('Rückblick: Darstellung', () => {
  it('nutzt nur Design-Tokens, keine festen Farben und kein Rot', async () => {
    const { container } = boot();
    await screen.findAllByTestId('transcript-line');
    const html = container.innerHTML;
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|text-danger|bg-record|text-red|bg-red/);
  });

  it('bleibt bei schmaler Breite im Rahmen: kein festes Mindestmaß, Leiste scrollt in sich', async () => {
    const { container } = boot();
    await screen.findAllByTestId('transcript-line');
    expect(container.innerHTML).not.toMatch(/min-w-\[|w-\[(?!4\.5rem)|\bw-screen\b/);
    expect(screen.getByRole('navigation', { name: 'Folien' }).firstElementChild?.className).toContain(
      'overflow-x-auto',
    );
  });
});

describe('Rückblick: Teile derselben Abschnitte', () => {
  it('ein Abschnitt über eine Foliengrenze erscheint als zwei Zeilen, je auf ihrer Folie', async () => {
    const lines = [
      makeLine(1, 190_000, 200_000, 'Das war die Einleitung', S1, { part: 0 }),
      makeLine(1, 200_000, 210_000, 'und jetzt zur Definition', S2, { part: 1 }),
    ];
    boot({ transcript: fullTranscript({ lines }) });
    await screen.findAllByTestId('transcript-line');
    expect(lineTexts().join(' ')).toContain('Das war die Einleitung');
    expect(lineTexts().join(' ')).not.toContain('und jetzt zur Definition');
    fireEvent.click(screen.getByRole('button', { name: 'Folie 2' }));
    expect(lineTexts().join(' ')).toContain('und jetzt zur Definition');
    // Beide Teile spielen ab ihrer eigenen Stelle
    fireEvent.click(lineEls()[0] as HTMLElement);
    expect(stub.started.at(-1)).toMatchObject({ at: 200 });
  });
});
