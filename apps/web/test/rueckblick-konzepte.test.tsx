// T2-23 im Rückblick (VERTRAEGE §20.10): Kurzfassung ✦ über dem Transkript, Konzepte als Chips, neue Zustände der
// Verarbeitung. Alle Inhalte sind erfunden.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Session, SessionConceptItem, SessionSummary } from '@sg/shared';
import { StepList } from '../src/components/processing/StepList.tsx';
import { ReviewView } from '../src/components/rueckblick/ReviewView.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { installAudioStub, type AudioStub } from './audio-stub.ts';
import {
  installFakeCore,
  makeAiStatus,
  makeConcept,
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
const S = makeSlides(DECK_ID, 3).map((s) => ({ id: s.id, index: s.index }));
const [S1, S2] = S as [(typeof S)[0], (typeof S)[0], (typeof S)[0]];

const DONE: Session['processing'] = {
  'audio.finalize': 'fertig',
  transcribe: 'fertig',
  'align.log': 'fertig',
  'concepts.extract': 'fertig',
  'concepts.resolve': 'fertig',
  'summary.write': 'fertig',
};

const slideRef = (slide: { id: string; index: number }) => ({
  kind: 'slide' as const,
  slide_id: slide.id,
  deck_id: DECK_ID,
  slide_index: slide.index,
});
const timeRef = (ms: number) => ({
  kind: 'transcript' as const,
  session_id: SESSION_ID,
  t_start_ms: ms,
  t_end_ms: ms + 5_000,
});

const SUMMARY: SessionSummary = {
  id: '0190f6a2-0000-7000-8000-000000000771',
  session_id: SESSION_ID,
  created_at: '2026-11-04T09:20:00Z',
  updated_at: '2026-11-04T09:20:00Z',
  lang: 'de',
  sentences: [
    { text: 'Die Vorlesung führt Normalformen ein.', sources: [slideRef(S1)] },
    {
      text: 'Die dritte Normalform ist **wichtig** <i>und</i> klausurrelevant.',
      sources: [slideRef(S2), timeRef(205_000)],
    },
  ],
  outline: [{ title: 'Erste Normalform', sources: [slideRef(S1)] }],
  model: 'fake',
  prompt_version: 'summary.write/v1',
  job_id: null,
};

function conceptItem(
  n: number,
  name: string,
  slide: { id: string; index: number },
  proposal = false,
): SessionConceptItem {
  return {
    concept: makeConcept({
      id: `0190f6a2-0000-7000-8000-00000000c${String(n).padStart(3, '0')}`,
      name,
      status: proposal ? 'vorschlag' : 'aktiv',
    }),
    evidence: [
      {
        id: `0190f6a2-0000-7000-8000-00000000d${String(n).padStart(3, '0')}`,
        ref: slideRef(slide),
        session: null,
        slide_title: null,
        missing: false,
        quote: null,
        auto: false,
      },
    ],
    inbox_item_id: null,
    inbox_status: proposal ? 'offen' : null,
  };
}

let core: FakeCore;
let stub: AudioStub;

function boot(
  opts: { processing?: Session['processing']; summary?: boolean; concepts?: SessionConceptItem[] } = {},
) {
  nav.search = `id=${SESSION_ID}`;
  core = installFakeCore({
    semesters: [makeSemester()],
    modules: [DBS],
    decks: [makeDeck({ id: DECK_ID })],
    sessions: [
      makeSession({
        id: SESSION_ID,
        module_id: DBS.id,
        number: 7,
        state: 'verarbeitet',
        started_at: '2026-11-04T08:00:00Z',
        ended_at: '2026-11-04T09:00:00Z',
        slide_deck_id: DECK_ID,
        processing: opts.processing ?? DONE,
        updated_at: '2026-11-04T09:10:00Z',
      }),
    ],
  });
  core.finishIngest(DECK_ID, 3);
  core.transcripts[SESSION_ID] = makeTranscript({
    session_id: SESSION_ID,
    slide_deck_id: DECK_ID,
    slide_source: 'log',
    slide_segments: [makeSlideSegment(1, S1, 10_000, 200_000), makeSlideSegment(2, S2, 200_000, 500_000)],
    recordings: [makeRecording({ id: R1, started_ms: 0, duration_ms: 600_000 })],
    transcripts: [makeTranscriptInfo()],
    lines: [
      makeLine(1, 10_000, 20_000, 'Heute geht es um Normalformen.', S1),
      makeLine(2, 200_000, 230_000, 'Die dritte Normalform ist klausurrelevant.', S2),
    ],
  });
  if (opts.summary ?? true) core.summaries[SESSION_ID] = SUMMARY;
  core.sessionConcepts[SESSION_ID] = opts.concepts ?? [
    conceptItem(1, 'Erste Normalform', S1),
    conceptItem(2, 'Dritte Normalform', S2, true),
  ];
  return render(
    <QueryProvider>
      <ReviewView />
    </QueryProvider>,
  );
}

const audio = () =>
  document.querySelector<HTMLAudioElement>(`audio[data-recording="${R1}"]`) as HTMLAudioElement;
const reprocessPosts = () => core.requests.filter((r) => r.method === 'POST' && /\/reprocess$/.test(r.path));
const counter = () => screen.getByTestId('review-slide-counter');

beforeEach(() => {
  stub = installAudioStub();
});
afterEach(() => {
  stub.restore();
  cleanup();
  vi.unstubAllGlobals();
});

describe('Rückblick: Kurzfassung', () => {
  it('steht aufklappbar über dem Transkript, Sätze mit Quellen-Chips, Gliederung, alles als reiner Text', async () => {
    boot();
    const panel = await screen.findByTestId('review-summary');
    expect(panel.tagName).toBe('DETAILS');
    expect(panel).toHaveAttribute('open');
    expect(within(panel).getByRole('heading', { name: 'Kurzfassung' })).toBeInTheDocument();
    expect(panel).toHaveTextContent('✦');
    expect(within(panel).getByText('Die Vorlesung führt Normalformen ein.')).toBeInTheDocument();
    expect(panel).toHaveTextContent('Die dritte Normalform ist **wichtig** <i>und</i> klausurrelevant.');
    expect(panel.querySelector('i, strong, b')).toBeNull();
    expect(within(panel).getByText('Gliederung')).toBeInTheDocument();
    expect(within(panel).getByText('Erste Normalform')).toBeInTheDocument();
    const chips = within(panel).getByRole('list', { name: 'Quellen zu Satz 2' });
    expect(within(chips).getByRole('link', { name: 'Folie 2' })).toHaveTextContent('F 2');
    expect(within(chips).getByRole('link', { name: 'Aufnahme ab 03:25' })).toHaveTextContent('03:25');
    // Über dem Transkript
    const transcript = await screen.findByRole('heading', { name: /^Transkript zu Folie/ });
    expect(panel.compareDocumentPosition(transcript) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Folien-Chip wählt die Folie, Zeit-Chip springt wie `t`, ohne abzuspielen', async () => {
    boot();
    const panel = await screen.findByTestId('review-summary');
    await screen.findByText('Heute geht es um Normalformen.');
    expect(counter()).toHaveTextContent('1');
    fireEvent.click(within(panel).getByRole('link', { name: 'Folie 2' }));
    await screen.findByText('Die dritte Normalform ist klausurrelevant.');
    expect(counter()).toHaveTextContent('2');

    fireEvent.click(within(panel).getAllByRole('link', { name: 'Folie 1' })[0] as HTMLElement);
    await screen.findByText('Heute geht es um Normalformen.');
    fireEvent.click(within(panel).getByRole('link', { name: 'Aufnahme ab 03:25' }));
    await waitFor(() => expect(audio().currentTime).toBe(205));
    expect(stub.play).not.toHaveBeenCalled();
    await screen.findByText('Die dritte Normalform ist klausurrelevant.');
  });

  it('ohne Kurzfassung gibt es den Bereich nicht', async () => {
    boot({ summary: false });
    await screen.findByText('Heute geht es um Normalformen.');
    expect(screen.queryByTestId('review-summary')).toBeNull();
  });
});

describe('Rückblick: Konzepte', () => {
  it('stehen als Chips in der rechten Spalte; Vorschläge sind dezent gekennzeichnet', async () => {
    boot();
    const section = await screen.findByTestId('review-concepts');
    const list = await within(section).findByRole('list', { name: 'Konzepte dieser Vorlesung' });
    const links = within(list).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Erste Normalform', 'Dritte Normalform (Vorschlag)']);
    expect(links[0]).toHaveAttribute('href', expect.stringMatching(/^\/bibliothek\?konzept=/));
    expect(links[0]).not.toHaveAttribute('data-proposal');
    expect(links[1]).toHaveAttribute('data-proposal', 'true');
    expect(links[1]?.className).toContain('border-dashed');
    // Rechte Spalte: neben den Folien, über dem Transkript der Folie
    expect(screen.getByTestId('review-slides').contains(section)).toBe(false);
    const transcript = screen.getByRole('heading', { name: /^Transkript zu Folie/ });
    expect(section.parentElement?.contains(transcript)).toBe(true);
  });

  it('zeigt die Konzepte der gewählten Folie zuerst', async () => {
    boot();
    const panel = await screen.findByTestId('review-summary');
    const names = () =>
      within(screen.getByRole('list', { name: 'Konzepte dieser Vorlesung' }))
        .getAllByRole('link')
        .map((l) => l.textContent);
    await waitFor(() => expect(names()[0]).toBe('Erste Normalform'));
    fireEvent.click(within(panel).getByRole('link', { name: 'Folie 2' }));
    await waitFor(() => expect(names()[0]).toBe('Dritte Normalform (Vorschlag)'));
  });

  it('Konzept-Schritt offen: „Konzepte kommen noch“ statt „Transkript kommt noch“', async () => {
    boot({
      processing: {
        ...DONE,
        'concepts.extract': 'laeuft',
        'concepts.resolve': 'wartet',
        'summary.write': 'wartet',
      },
      summary: false,
      concepts: [],
    });
    expect(await screen.findByText('Konzepte kommen noch.')).toBeInTheDocument();
    expect(screen.queryByText('Transkript kommt noch.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Konzepte erzeugen' })).toBeNull();
    // Das Transkript ist schon da
    expect(screen.getByText('Heute geht es um Normalformen.')).toBeInTheDocument();
  });

  it('solange das Transkript noch läuft, bleibt es bei „Transkript kommt noch“', async () => {
    boot({
      processing: { ...DONE, transcribe: 'laeuft', 'concepts.extract': 'wartet' },
      summary: false,
      concepts: [],
    });
    expect(await screen.findByText('Transkript kommt noch.')).toBeInTheDocument();
    expect(screen.queryByText('Konzepte kommen noch.')).toBeNull();
  });

  it('Session ohne Konzept-Schritte: „Konzepte erzeugen“ startet ab `concepts.extract`', async () => {
    boot({
      processing: { 'audio.finalize': 'fertig', transcribe: 'fertig', 'align.log': 'fertig' },
      summary: false,
      concepts: [],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Konzepte erzeugen' }));
    await waitFor(() => expect(reprocessPosts()).toHaveLength(1));
    expect(reprocessPosts()[0]?.body).toEqual({ from_step: 'concepts.extract' });
  });

  it('ohne Konzept-Schritte und ohne eingerichtete KI: ruhiger Hinweis statt Knopf', async () => {
    boot({
      processing: { 'audio.finalize': 'fertig', transcribe: 'fertig', 'align.log': 'fertig' },
      summary: false,
      concepts: [],
    });
    core.aiStatus = makeAiStatus({
      llm: { provider: 'anthropic', configured: false, issue: 'kein_schluessel' },
    });
    const section = await screen.findByTestId('review-concepts');
    expect(await within(section).findByText(/KI nicht eingerichtet/)).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Einstellungen' })).toHaveAttribute(
      'href',
      '/einstellungen?bereich=ki',
    );
    expect(screen.queryByRole('button', { name: 'Konzepte erzeugen' })).toBeNull();
  });

  it('KI nicht eingerichtet: die Schrittliste sagt das ruhig statt „nicht fertig“', async () => {
    boot({
      processing: {
        ...DONE,
        'concepts.extract': 'fehler',
        'concepts.resolve': 'abgebrochen',
        'summary.write': 'abgebrochen',
      },
      summary: false,
      concepts: [],
    });
    core.aiStatus = makeAiStatus({
      llm: { provider: 'anthropic', configured: false, issue: 'kein_schluessel' },
    });
    const list = await screen.findByTestId('step-list');
    const row = () => list.querySelector('[data-step="concepts.extract"]') as HTMLElement;
    await waitFor(() => expect(row()).toHaveTextContent('KI nicht eingerichtet · Einstellungen'));
    expect(within(list).queryByText('nicht fertig')).toBeNull();
    expect(within(row()).getByRole('link', { name: 'Einstellungen' })).toHaveAttribute(
      'href',
      '/einstellungen?bereich=ki',
    );
  });

  it('Budget erreicht und Konzept-Schritt gescheitert: „KI-Budget für <Monat> erreicht“', async () => {
    boot({
      processing: { ...DONE, 'concepts.resolve': 'fehler', 'summary.write': 'abgebrochen' },
      summary: false,
      concepts: [],
    });
    core.aiStatus = makeAiStatus({
      budget: { month: '2026-11', spent_eur: 10.2, budget_eur: 10, reached: true, warn: true },
    });
    const list = await screen.findByTestId('step-list');
    await waitFor(() =>
      expect(list.querySelector('[data-step="concepts.resolve"]')).toHaveTextContent(
        'KI-Budget für November 2026 erreicht · Einstellungen',
      ),
    );
  });

  it('`transcribe` auf fehler: neben „Erneut versuchen“ auch „Konzepte nur aus Folien“', async () => {
    boot({
      processing: {
        'audio.finalize': 'fertig',
        transcribe: 'fehler',
        'align.log': 'abgebrochen',
        'concepts.extract': 'abgebrochen',
      },
      summary: false,
      concepts: [],
    });
    const list = await screen.findByTestId('step-list');
    expect(within(list).getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
    // Das Transkript ist gescheitert, nicht die KI: Die Konzept-Schritte bleiben bei „nicht fertig“
    expect(list.querySelector('[data-step="concepts.extract"]')).toHaveTextContent('nicht fertig');
    fireEvent.click(within(list).getByRole('button', { name: 'Konzepte nur aus Folien' }));
    await waitFor(() => expect(reprocessPosts()).toHaveLength(1));
    expect(reprocessPosts()[0]?.body).toEqual({ from_step: 'concepts.extract' });
  });
});

describe('Schrittliste ohne KI-Stand', () => {
  it('bleibt bei den bisherigen Texten und zeigt „Konzepte nur aus Folien“ nur bei `transcribe: fehler`', () => {
    render(
      <StepList
        processing={{ transcribe: 'fertig', 'concepts.extract': 'fehler' }}
        onRetry={() => {}}
        ai={makeAiStatus()}
      />,
    );
    expect(screen.getByText('nicht fertig')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Konzepte nur aus Folien' })).toBeNull();
  });
});
