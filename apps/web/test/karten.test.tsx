// B4 (VERTRAEGE §21.7, §21.10): Karten in der Konzeptansicht, Kartenvorschläge in der Inbox, Schrittliste und
// Heute-Kachel gegen den Fake-Core. Alle Karten, Konzepte und Quellen sind erfunden.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { InboxItem, ReviewQueueItem } from '@sg/shared';

vi.mock('next/navigation', () => ({
  usePathname: () => '/inbox',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { ConceptView } from '../src/components/concepts/ConceptView.tsx';
import { SuggestionInbox } from '../src/components/inbox/SuggestionInbox.tsx';
import { StepList } from '../src/components/processing/StepList.tsx';
import { ReviewTile } from '../src/components/today/ReviewTile.tsx';
import {
  INITIAL_BLOCK,
  RatingOutbox,
  blockReducer,
  blockSummary,
  cardFrontText,
  cardStateText,
  clozeParts,
  contentFromDraft,
  draftFromContent,
  queueMinutes,
} from '../src/lib/cards.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { ToastProvider } from '../src/lib/toast.tsx';
import {
  BASIC,
  CLOZE,
  DECK_ID,
  makeCard,
  makeCardProposal,
  makeCardState,
  slideRef,
  timeRef,
} from './fake-cards.ts';
import {
  installFakeCore,
  makeAiStatus,
  makeConceptDetail,
  makeInboxItem,
  makeModule,
  makeSemester,
  makeSession,
  makeSessionRef,
  type FakeCore,
} from './fake-core.ts';

const id = (n: number) => `0190f6a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SESSION = makeSessionRef();
const C_3NF = id(801);
const C_HUELLE = id(802);
const I_BATCH = id(910);
const I_BATCH_2 = id(911);

let core: FakeCore;

function boot(items: InboxItem[] = []) {
  core = installFakeCore({
    semesters: [makeSemester()],
    modules: [makeModule()],
    sessions: [makeSession({ id: SESSION.id, state: 'verarbeitet', ended_at: '2026-11-05T13:45:00Z' })],
  });
  core.inboxItems = items;
  core.concepts = [makeConceptDetail({ id: C_3NF, name: 'Dritte Normalform (3NF)' })];
  return core;
}

function wrap(children: ReactNode) {
  return render(
    <ThemeProvider>
      <QueryProvider>
        <ToastProvider>{children}</ToastProvider>
      </QueryProvider>
    </ThemeProvider>,
  );
}

function batchItem(overrides: Partial<InboxItem> = {}, conceptId = C_3NF): InboxItem {
  return makeInboxItem(
    {
      kind: 'card_batch',
      concept_id: conceptId,
      concept_name: 'Normalform 3 (alter Name)',
      cards: [
        makeCardProposal('k1', BASIC, [slideRef(DECK_ID, 14), timeRef(SESSION.id, 2_532_000)]),
        makeCardProposal('k2', CLOZE, [slideRef(DECK_ID, 14)]),
        makeCardProposal(
          'k3',
          {
            kind: 'basic',
            front: { text_md: 'Was ist ein Schlüsselattribut?' },
            back: { text_md: 'Ein Attribut, das zu einem Schlüsselkandidaten gehört.', explanation_md: null },
          },
          [timeRef(SESSION.id, 2_700_000)],
        ),
      ],
      input_hash: 'c'.repeat(64),
      prompt_version: 'cards.generate/v1',
      model: 'fake',
    },
    { id: I_BATCH, priority: 2000, ...overrides },
  );
}

const rowOf = (itemId: string) =>
  document.querySelector<HTMLElement>(`[data-inbox-item="${itemId}"]`) as HTMLElement;
const inboxPosts = () => core.requests.filter((r) => r.method === 'POST' && r.path.startsWith('/inbox'));

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('Hilfen', () => {
  it('Lücken: Teile, Vorderseite mit […], Wortlaut ohne Markdown', () => {
    expect(clozeParts('A {{c1::B}} und {{c2:: C }}.')).toEqual([
      { text: 'A ', gap: null },
      { text: 'B', gap: 1 },
      { text: ' und ', gap: null },
      { text: 'C', gap: 2 },
      { text: '.', gap: null },
    ]);
    expect(cardFrontText(CLOZE)).toBe('Eine Relation in 3NF ist immer auch in […].');
    expect(cardFrontText(BASIC)).toBe('Wann ist eine Relation in dritter Normalform?');
  });

  it('Zustand in Worten', () => {
    expect(cardStateText({ suspended: true, state: makeCardState() })).toBe('pausiert');
    expect(cardStateText({ suspended: false, state: makeCardState() })).toBe('neu');
    expect(
      cardStateText({
        suspended: false,
        state: makeCardState({ state: 'review', due: '2026-11-20T08:00:00Z' }),
      }),
    ).toMatch(/^fällig am 20\. November$/);
  });

  it('Entwurf → Inhalt: Lösungen und gleichwertige Schreibweisen bleiben, Fehler vor dem Senden', () => {
    const draft = draftFromContent(CLOZE);
    expect(contentFromDraft(draft, CLOZE)).toEqual({ ok: true, content: CLOZE });
    // Gleiche Lücke, anderer Satz: Alternativen bleiben
    const reworded = contentFromDraft({ ...draft, front: 'In {{c1::2NF}} liegt jede 3NF.' }, CLOZE);
    expect(reworded).toMatchObject({
      ok: true,
      content: { back: { answers: { c1: ['2NF', 'zweite Normalform'] } } },
    });
    // Andere Lücke: nur der neue Text
    const changed = contentFromDraft({ ...draft, front: 'In {{c1::1NF}} liegt jede 3NF.' }, CLOZE);
    expect(changed).toMatchObject({ ok: true, content: { back: { answers: { c1: ['1NF'] } } } });
    expect(contentFromDraft({ ...draft, front: 'Ohne Lücke' }, CLOZE)).toMatchObject({ ok: false });
    expect(contentFromDraft({ ...draft, front: '{{c2::nur zwei}}' }, CLOZE)).toMatchObject({ ok: false });
    expect(contentFromDraft({ ...draft, front: '{{c1::a}} {{c1::b}}' }, CLOZE)).toMatchObject({ ok: false });
    const basic = draftFromContent(BASIC);
    expect(contentFromDraft({ ...basic, explanation: '  ' }, BASIC)).toMatchObject({
      ok: true,
      content: { back: { explanation_md: null } },
    });
    expect(contentFromDraft({ ...basic, back: ' ' }, BASIC)).toMatchObject({ ok: false });
  });

  it('Block: Wiederholung hängt hinten an, Entfernen und Ende', () => {
    const item = (n: number): ReviewQueueItem => ({
      card: makeCard({ concept_id: C_3NF }),
      concept: { id: C_3NF, name: 'X', exam_relevant: false },
      group: 'neu',
      estimate_seconds: 12 + n,
    });
    const a = item(1);
    const b = item(2);
    let state = blockReducer(INITIAL_BLOCK, { type: 'start', items: [a, b], now: 1000 });
    // Bewerten geht erst nach dem Aufdecken
    expect(blockReducer(state, { type: 'rate', durationMs: 5, now: 2000 })).toBe(state);
    state = blockReducer(state, { type: 'reveal' });
    state = blockReducer(state, { type: 'rate', durationMs: 4000, now: 2000 });
    expect(state).toMatchObject({ index: 1, revealed: false, rated: 1, spentMs: 4000, shownAt: 2000 });
    state = blockReducer(state, { type: 'append', item: a });
    expect(state.deck).toHaveLength(3);
    // Die aktuelle Karte entfällt (pausiert): die nächste steht vorn, die Zeit beginnt neu
    state = blockReducer(state, { type: 'remove', cardId: b.card.id, now: 3000 });
    expect(state.deck.map((x) => x.card.id)).toEqual([a.card.id, a.card.id]);
    expect(state).toMatchObject({ index: 1, shownAt: 3000 });
    state = blockReducer(state, { type: 'end', early: true });
    expect(state).toMatchObject({ phase: 'finished', endedEarly: true });
    expect(blockSummary(state)).toBe('Block beendet · 1 Karte in 1 min');
    expect(blockSummary({ rated: 14, spentMs: 6 * 60_000, endedEarly: false })).toBe(
      'Für heute geschafft · 14 Karten in 6 min',
    );
    expect(queueMinutes({ items: [], estimated_seconds: 0 })).toBe(0);
    expect(queueMinutes({ items: [a], estimated_seconds: 56 })).toBe(1);
    expect(queueMinutes({ items: [a], estimated_seconds: 61 })).toBe(2);
  });

  it('Postausgang: 4xx wird verworfen, Netzfehler gehen mit derselben `id` noch zweimal hinaus', async () => {
    boot();
    core.cards.cards = [makeCard({ concept_id: C_3NF })];
    const outbox = new RatingOutbox();
    outbox.retryDelaysMs = [1, 1];
    const cardId = core.cards.cards[0]?.id ?? '';
    core.cards.failReviews = 5;
    const results: unknown[] = [];
    outbox.submit({ id: id(1), cardId, rating: 3, durationMs: 5000 }, (r) => results.push(r));
    await waitFor(() => expect(outbox.getSnapshot()).toEqual({ pending: 0, failed: 1 }));
    expect(core.requests.filter((r) => r.path.endsWith('/review'))).toHaveLength(3);
    core.cards.failReviews = 0;
    outbox.retryFailed();
    await waitFor(() => expect(results).toHaveLength(1));
    expect(outbox.getSnapshot()).toEqual({ pending: 0, failed: 0 });
    // Karte gibt es nicht: 404 ist nicht wiederholbar
    const dropped: unknown[] = [];
    outbox.submit({ id: id(2), cardId: id(999), rating: 3, durationMs: 1 }, (r) => dropped.push(r));
    await waitFor(() => expect(dropped).toEqual([null]));
    expect(outbox.getSnapshot()).toEqual({ pending: 0, failed: 0 });
  });
});

describe('Konzeptansicht: Karten', () => {
  const wrapConcept = () => wrap(<ConceptView id={C_3NF} />);

  it('listet die Karten mit Typ, Zustand in Worten und ✦ bei KI-Karten', async () => {
    boot();
    core.cards.cards = [
      makeCard({ concept_id: C_3NF, content: BASIC, created_at: '2026-11-05T14:20:00Z' }),
      makeCard({
        concept_id: C_3NF,
        content: CLOZE,
        origin: 'manuell',
        created_at: '2026-11-05T14:21:00Z',
        state: makeCardState({
          state: 'review',
          due: '2026-11-20T08:00:00Z',
          reps: 2,
          last_review: '2026-11-10T08:00:00Z',
        }),
      }),
      makeCard({ concept_id: C_3NF, suspended: true, created_at: '2026-11-05T14:22:00Z' }),
    ];
    wrapConcept();
    const section = await screen.findByRole('region', { name: /^Karten/ });
    const rows = await waitFor(() => {
      const found = within(section)
        .getAllByRole('listitem')
        .filter((li) => li.dataset.cardId);
      expect(found).toHaveLength(3);
      return found;
    });
    expect(rows[0]).toHaveTextContent('Wann ist eine Relation in dritter Normalform?');
    expect(rows[0]).toHaveTextContent('Frage');
    expect(within(rows[0] as HTMLElement).getByTestId('card-state')).toHaveTextContent('neu');
    expect(within(rows[0] as HTMLElement).getByText('(Vorschlag der KI)')).toBeInTheDocument();
    // Lückentext: Lücke verdeckt
    expect(rows[1]).toHaveTextContent('Eine Relation in 3NF ist immer auch in […].');
    expect(rows[1]).toHaveTextContent('Lückentext');
    expect(within(rows[1] as HTMLElement).getByTestId('card-state')).toHaveTextContent(
      'fällig am 20. November',
    );
    expect(within(rows[1] as HTMLElement).queryByText('(Vorschlag der KI)')).toBeNull();
    expect(within(rows[2] as HTMLElement).getByTestId('card-state')).toHaveTextContent('pausiert');
    expect(screen.getByTestId('card-count')).toHaveTextContent('3');
  });

  it('ohne Karten ein ruhiger Satz', async () => {
    boot();
    wrapConcept();
    expect(await screen.findByText(/Noch keine Karten\. Sie entstehen als Vorschlag/)).toBeInTheDocument();
  });

  it('Menü: Pausieren und Fortsetzen, Löschen mit Rückgängig', async () => {
    boot();
    core.cards.cards = [makeCard({ concept_id: C_3NF })];
    const user = userEvent.setup();
    wrapConcept();
    await user.click(await screen.findByRole('button', { name: /^Menü: / }));
    await user.click(screen.getByRole('button', { name: 'Pausieren' }));
    await waitFor(() => expect(screen.getByTestId('card-state')).toHaveTextContent('pausiert'));
    await user.click(screen.getByRole('button', { name: /^Menü: / }));
    await user.click(screen.getByRole('button', { name: 'Fortsetzen' }));
    await waitFor(() => expect(screen.getByTestId('card-state')).toHaveTextContent('neu'));
    await user.click(screen.getByRole('button', { name: /^Menü: / }));
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(screen.queryByTestId('card-state')).toBeNull());
    const toast = screen.getByTestId('toast-live');
    await user.click(within(toast).getByRole('button', { name: 'Rückgängig' }));
    expect(await screen.findByTestId('card-state')).toBeInTheDocument();
  });

  it('Bearbeiten inline: der neue Inhalt geht per PATCH, der Zustand bleibt', async () => {
    boot();
    core.cards.cards = [makeCard({ concept_id: C_3NF, content: CLOZE })];
    const user = userEvent.setup();
    wrapConcept();
    await user.click(await screen.findByRole('button', { name: /^Menü: / }));
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const field = await screen.findByLabelText('Lückentext');
    await user.clear(field);
    await user.click(field);
    await user.paste('In {{c1::2NF}} liegt jede 3NF.');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('In […] liegt jede 3NF.')).toBeInTheDocument();
    const patch = core.requests.find((r) => r.method === 'PATCH');
    expect(patch?.body).toMatchObject({
      content: { kind: 'cloze', back: { answers: { c1: ['2NF', 'zweite Normalform'] } } },
    });
  });

  it('Vorschläge haben keinen Abschnitt „Karten“', async () => {
    boot();
    core.concepts = [makeConceptDetail({ id: C_3NF, name: 'Noch offen', status: 'vorschlag' })];
    wrapConcept();
    await screen.findByRole('heading', { level: 1, name: 'Noch offen' });
    expect(screen.queryByRole('region', { name: /^Karten/ })).toBeNull();
  });
});

describe('Inbox: Kartenvorschläge', () => {
  it('Zeile „n Karten zu Konzept“ mit dem aktuellen Namen, ✦; aufklappbar mit Karten und Quellen', async () => {
    boot([batchItem()]);
    wrap(<SuggestionInbox />);
    const row = await waitFor(() => {
      const found = rowOf(I_BATCH);
      expect(found).toBeTruthy();
      return found;
    });
    // Aktueller Name des Konzepts, nicht `payload.concept_name`
    await waitFor(() => expect(row).toHaveTextContent('3 Karten zu Dritte Normalform (3NF)'));
    expect(row).not.toHaveTextContent('alter Name');
    expect(within(row).getByRole('link', { name: 'Dritte Normalform (3NF)' })).toHaveAttribute(
      'href',
      `/bibliothek?konzept=${C_3NF}`,
    );
    expect(within(row).getByText('(Vorschlag der KI)')).toBeInTheDocument();
    expect(row).toHaveAttribute('data-kind', 'card_batch');
    // Zu: keine Karten im Text
    expect(within(row).queryByText('Wann ist eine Relation in dritter Normalform?')).toBeNull();

    await userEvent.setup().click(within(row).getByRole('button', { name: 'Karten ansehen' }));
    const cards = within(row).getByRole('list', { name: /^Karten zu / });
    const items = within(cards)
      .getAllByRole('listitem')
      .filter((li) => li.dataset.cardKey);
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Wann ist eine Relation in dritter Normalform?');
    expect(items[0]).toHaveTextContent('Wenn sie in 2NF ist');
    expect(items[1]).toHaveTextContent('Eine Relation in 3NF ist immer auch in […].');
    expect(within(items[0] as HTMLElement).getByRole('link', { name: 'Folie 14' })).toHaveAttribute(
      'href',
      `/dokument?typ=folien&id=${DECK_ID}&seite=14`,
    );
    expect(
      within(items[0] as HTMLElement).getByRole('link', { name: /Aufnahme ab 42:12/ }),
    ).toBeInTheDocument();
    // Häkchen standardmäßig an
    for (const box of within(cards).getAllByRole('checkbox')) expect(box).toBeChecked();
  });

  it('kein Kartenvorschlag, solange das Konzept nicht aktiv ist; mit der Annahme des Konzepts wird er sichtbar', async () => {
    boot([batchItem()]);
    core.concepts = [makeConceptDetail({ id: C_3NF, name: 'Noch offen', status: 'vorschlag' })];
    wrap(<SuggestionInbox />);
    expect(await screen.findByText(/Keine offenen Vorschläge/)).toBeInTheDocument();
    expect(rowOf(I_BATCH)).toBeNull();
  });

  it('→ nimmt alle an: ohne `cards` im Request, Toast mit Rückgängig', async () => {
    boot([batchItem()]);
    const user = userEvent.setup();
    wrap(<SuggestionInbox />);
    await waitFor(() => expect(rowOf(I_BATCH)).toBeTruthy());
    rowOf(I_BATCH).focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(inboxPosts()).toHaveLength(1));
    expect(inboxPosts()[0]?.path).toBe(`/inbox/${I_BATCH}/accept`);
    expect(inboxPosts()[0]?.body).toEqual({});
    expect(core.cards.cards).toHaveLength(3);
    expect(screen.getByTestId('toast-live')).toHaveTextContent('3 Karten angenommen');
    await waitFor(() => expect(rowOf(I_BATCH)).toBeNull());

    // Rückgängig: reopen löscht die Karten wieder
    await user.click(within(screen.getByTestId('toast-live')).getByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(core.cards.cards).toHaveLength(0));
    await waitFor(() => expect(rowOf(I_BATCH)).toBeTruthy());
  });

  it('abgewählte Karten gehen als `accept: false` mit, die anderen werden angelegt', async () => {
    boot([batchItem()]);
    const user = userEvent.setup();
    wrap(<SuggestionInbox />);
    await waitFor(() => expect(rowOf(I_BATCH)).toBeTruthy());
    const row = rowOf(I_BATCH);
    await user.click(within(row).getByRole('button', { name: 'Karten ansehen' }));
    await user.click(within(row).getByRole('checkbox', { name: /Eine Relation in 3NF/ }));
    expect(within(row).getByTestId('batch-count')).toHaveTextContent('2 von 3 angehakt');
    await user.click(within(row).getByRole('button', { name: '2 annehmen' }));
    await waitFor(() => expect(inboxPosts()).toHaveLength(1));
    expect(inboxPosts()[0]?.body).toEqual({ cards: [{ key: 'k2', accept: false }] });
    expect(core.cards.cards.map((c) => c.content.kind)).toEqual(['basic', 'basic']);
    expect(screen.getByTestId('toast-live')).toHaveTextContent('2 Karten angenommen');
  });

  it('← verwirft alle: `reject`, keine Karten', async () => {
    boot([batchItem()]);
    const user = userEvent.setup();
    wrap(<SuggestionInbox />);
    await waitFor(() => expect(rowOf(I_BATCH)).toBeTruthy());
    rowOf(I_BATCH).focus();
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(inboxPosts()).toHaveLength(1));
    expect(inboxPosts()[0]?.path).toBe(`/inbox/${I_BATCH}/reject`);
    expect(core.cards.cards).toHaveLength(0);
    expect(screen.getByTestId('toast-live')).toHaveTextContent('Verworfen');
  });

  it('E bearbeitet die markierte Karte inline; der Entwurf geht beim Annehmen als `content` mit', async () => {
    boot([batchItem()]);
    const user = userEvent.setup();
    wrap(<SuggestionInbox />);
    await waitFor(() => expect(rowOf(I_BATCH)).toBeTruthy());
    const row = rowOf(I_BATCH);
    row.focus();
    await user.keyboard('e');
    const front = await within(row).findByLabelText('Vorderseite');
    expect(row).toHaveTextContent('Karten ausblenden');
    // In Feldern gelten die Tasten der Zeile nicht
    await user.clear(front);
    await user.type(front, 'Was ist die 3NF? eee');
    expect(inboxPosts()).toHaveLength(0);
    await user.click(within(row).getByRole('button', { name: 'Übernehmen' }));
    expect(within(row).getByText('Was ist die 3NF? eee')).toBeInTheDocument();
    expect(within(row).getByText('Geändert, wird so angenommen.')).toBeInTheDocument();
    row.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(inboxPosts()).toHaveLength(1));
    const body = inboxPosts()[0]?.body as {
      cards: { key: string; accept: boolean; content: { front: { text_md: string } } }[];
    };
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]).toMatchObject({ key: 'k1', accept: true });
    expect(body.cards[0]?.content.front.text_md).toBe('Was ist die 3NF? eee');
    expect(core.cards.cards[0]?.content).toMatchObject({ front: { text_md: 'Was ist die 3NF? eee' } });
  });

  it('Hülle: der Name kommt vom Ziel (`merged_into`)', async () => {
    boot([batchItem({}, C_HUELLE)]);
    core.concepts = [
      makeConceptDetail({ id: C_3NF, name: 'Dritte Normalform (3NF)' }),
      makeConceptDetail({ id: C_HUELLE, name: 'Alte Hülle', status: 'zusammengefuehrt', merged_into: C_3NF }),
    ];
    wrap(<SuggestionInbox />);
    // Sichtbar, weil das wirksame Konzept (Ziel) aktiv ist
    const row = await waitFor(() => {
      const found = rowOf(I_BATCH);
      expect(found).toBeTruthy();
      return found;
    });
    await waitFor(() => expect(row).toHaveTextContent('3 Karten zu Dritte Normalform (3NF)'));
    expect(within(row).getByRole('link', { name: 'Dritte Normalform (3NF)' })).toHaveAttribute(
      'href',
      `/bibliothek?konzept=${C_3NF}`,
    );
    expect(row).not.toHaveTextContent('Alte Hülle');
  });

  it('Filter „Karten“ und „Alle annehmen“ je Gruppe schließt Kartenvorschläge ein', async () => {
    const conceptItem = makeInboxItem(
      {
        kind: 'concept_new',
        proposal: {
          name: 'Boyce-Codd-Normalform',
          aliases: [],
          one_liner: null,
          kind: 'definition',
          importance: 2,
          exam_hint: false,
          prof_explanation: null,
          confidence: 0.9,
        },
        evidence: [slideRef(DECK_ID, 20)],
        similar: [],
        prompt_version: 'concepts.extract/v1',
        model: 'fake',
      },
      { id: id(901), concept_id: id(803), priority: 1 },
    );
    boot([conceptItem, batchItem()]);
    const user = userEvent.setup();
    wrap(<SuggestionInbox />);
    await waitFor(() => expect(rowOf(I_BATCH)).toBeTruthy());
    expect(rowOf(id(901))).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Karten' }));
    expect(rowOf(id(901))).toBeNull();
    expect(rowOf(I_BATCH)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Alle' }));
    await user.click(screen.getByRole('button', { name: /^Alle annehmen/ }));
    await waitFor(() => expect(core.requests.some((r) => r.path === '/inbox/bulk')).toBe(true));
    expect(core.requests.find((r) => r.path === '/inbox/bulk')?.body).toEqual({
      action: 'accept',
      session_id: SESSION.id,
    });
    await waitFor(() => expect(core.cards.cards).toHaveLength(3));
  });

  it('Fehler ruhig: Konzept noch nicht angenommen', async () => {
    boot([batchItem()]);
    core.rejectNextInbox = { status: 409, code: 'card_concept_pending', details: { concept_id: C_3NF } };
    const user = userEvent.setup();
    wrap(<SuggestionInbox />);
    await waitFor(() => expect(rowOf(I_BATCH)).toBeTruthy());
    await user.click(within(rowOf(I_BATCH)).getByRole('button', { name: 'Annehmen' }));
    await waitFor(() =>
      expect(screen.getByTestId('toast-live')).toHaveTextContent(
        'Erst das Konzept annehmen, dann die Karten.',
      ),
    );
    expect(rowOf(I_BATCH)).toBeTruthy();
  });

  it('zwei Kartenvorschläge zu verschiedenen Konzepten stehen nebeneinander, Pfeiltasten wechseln die Zeile', async () => {
    const other = batchItem({ id: I_BATCH_2, priority: 2001 }, id(805));
    boot([batchItem(), other]);
    core.concepts.push(makeConceptDetail({ id: id(805), name: 'Boyce-Codd-Normalform' }));
    const user = userEvent.setup();
    wrap(<SuggestionInbox />);
    await waitFor(() => expect(rowOf(I_BATCH_2)).toBeTruthy());
    await waitFor(() => expect(rowOf(I_BATCH_2)).toHaveTextContent('3 Karten zu Boyce-Codd-Normalform'));
    rowOf(I_BATCH).focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(rowOf(I_BATCH_2));
    fireEvent.keyDown(rowOf(I_BATCH_2), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rowOf(I_BATCH));
  });
});

describe('Schrittliste', () => {
  const ai = (warn: boolean) =>
    makeAiStatus({
      budget: { month: '2026-11', spent_eur: warn ? 8.5 : 1, budget_eur: 10, reached: false, warn },
    });
  const base = {
    'audio.finalize': 'fertig',
    transcribe: 'fertig',
    'align.log': 'fertig',
    'concepts.extract': 'fertig',
    'concepts.resolve': 'fertig',
    'summary.write': 'fertig',
  } as const;

  it('Budget-Pause: ruhig „Karten pausiert · KI-Budget“ mit Link und „Karten erzeugen“', async () => {
    const onRetry = vi.fn();
    render(<StepList processing={{ ...base, 'cards.generate': 'fehler' }} ai={ai(true)} onRetry={onRetry} />);
    const row = document.querySelector('[data-step="cards.generate"]') as HTMLElement;
    expect(row).toHaveTextContent('Karten');
    expect(row).toHaveTextContent('Karten pausiert · KI-Budget · Einstellungen');
    expect(within(row).getByRole('link', { name: 'Einstellungen' })).toHaveAttribute(
      'href',
      '/einstellungen?bereich=ki',
    );
    expect(screen.queryByText('nicht fertig')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Karten erzeugen' }));
    expect(onRetry).toHaveBeenCalledWith('cards.generate');
  });

  it('ohne Budget-Warnung bleibt es bei „nicht fertig“ und „Erneut versuchen“', () => {
    render(
      <StepList processing={{ ...base, 'cards.generate': 'fehler' }} ai={ai(false)} onRetry={() => {}} />,
    );
    const row = document.querySelector('[data-step="cards.generate"]') as HTMLElement;
    expect(row).toHaveTextContent('nicht fertig');
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Karten erzeugen' })).toBeNull();
  });

  it('ältere Session ohne Schritt „Karten“, aber mit Konzepten: „Karten erzeugen“', async () => {
    const onRetry = vi.fn();
    render(<StepList processing={base} cardsMissing onRetry={onRetry} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Karten erzeugen' }));
    expect(onRetry).toHaveBeenCalledWith('cards.generate');
  });

  it('ohne den Hinweis keine Schaltfläche', () => {
    render(<StepList processing={base} onRetry={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Karten erzeugen' })).toBeNull();
  });
});

describe('Heute: Kachel', () => {
  it('„Heute wiederholen · ≈ n min“ mit Sprung nach /lernen, nur wenn etwas fällig ist', async () => {
    boot();
    core.cards.cards = [makeCard({ concept_id: C_3NF }), makeCard({ concept_id: C_3NF, content: CLOZE })];
    wrap(<ReviewTile sessions={[]} />);
    const tile = await screen.findByTestId('review-tile');
    expect(tile).toHaveTextContent('Heute wiederholen · ≈ 2 min');
    expect(tile).toHaveAttribute('href', '/lernen');
    expect(tile.textContent).not.toMatch(/\d+ Karten/);
  });

  it('nichts fällig oder keine Karten: keine Kachel', async () => {
    boot();
    wrap(<ReviewTile sessions={[]} />);
    await waitFor(() => expect(core.requests.some((r) => r.path === '/review/queue')).toBe(true));
    expect(screen.queryByTestId('review-tile')).toBeNull();
  });

  it('während eine Session läuft: keine Kachel und keine Abfrage (R1)', async () => {
    boot();
    core.cards.cards = [makeCard({ concept_id: C_3NF })];
    const running = makeSession({ state: 'laeuft' });
    wrap(<ReviewTile sessions={[running]} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('review-tile')).toBeNull();
    expect(core.requests.some((r) => r.path === '/review/queue')).toBe(false);
  });

  it('Core nicht erreichbar: still', async () => {
    boot();
    core.cards.cards = [makeCard({ concept_id: C_3NF })];
    core.down = true;
    wrap(<ReviewTile sessions={[]} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('review-tile')).toBeNull();
  });
});
