// B4 (VERTRAEGE §21.10): `/lernen` gegen den Fake-Core. Alle Karten, Konzepte und Quellen sind erfunden.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { Card } from '@sg/shared';

vi.mock('next/navigation', () => ({
  usePathname: () => '/lernen',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { LearnView } from '../src/components/learn/LearnView.tsx';
import { ratingOutbox } from '../src/lib/cards.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { ToastProvider } from '../src/lib/toast.tsx';
import { BASIC, CLOZE, makeCard, makeCardState, slideRef, timeRef } from './fake-cards.ts';
import { installFakeCore, makeConceptDetail, makeModule, makeSemester, type FakeCore } from './fake-core.ts';

const id = (n: number) => `0190f6a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const C_3NF = id(801);
const DECK = id(700);
const SESSION = id(1);

let core: FakeCore;

function boot(cards: Card[], concepts = [makeConceptDetail({ id: C_3NF, name: 'Dritte Normalform (3NF)' })]) {
  core = installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
  core.concepts = concepts;
  core.cards.cards = cards;
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

const reviewPosts = () =>
  core.requests.filter((r) => r.method === 'POST' && /\/cards\/.+\/review$/.test(r.path));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const basicCard = (overrides: Partial<Card> = {}) =>
  makeCard({ concept_id: C_3NF, content: BASIC, ...overrides });
const clozeCard = (overrides: Partial<Card> = {}) =>
  makeCard({ concept_id: C_3NF, content: CLOZE, ...overrides });

async function start() {
  const user = userEvent.setup();
  wrap(<LearnView />);
  await user.click(await screen.findByRole('button', { name: 'Starten' }));
  return user;
}

beforeEach(() => {
  ratingOutbox.reset();
});

describe('Übersicht', () => {
  it('zeigt „Heute wiederholen · ≈ n min“ und Starten, ohne Zahl fälliger Karten', async () => {
    boot([basicCard(), clozeCard()]);
    wrap(<LearnView />);
    // neu: 3 × 12 s + 3 × 20 s = 96 s → aufgerundet 2 min
    expect(await screen.findByTestId('learn-headline')).toHaveTextContent('Heute wiederholen · ≈ 2 min');
    expect(screen.getByRole('button', { name: 'Starten' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Rückstand|fällig:|\d+ Karten/);
    expect(core.requests.some((r) => r.path === '/review/queue')).toBe(true);
  });

  it('Enter startet den Block', async () => {
    boot([basicCard()]);
    wrap(<LearnView />);
    await screen.findByRole('button', { name: 'Starten' });
    // Fokus liegt nicht auf dem Knopf (etwa nach einem Klick ins Leere)
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(await screen.findByTestId('learn-progress')).toHaveTextContent('Karte 1 von 1');
  });

  it('ohne Karten: ruhiger Satz und Weg zur Inbox', async () => {
    boot([]);
    wrap(<LearnView />);
    expect(
      await screen.findByText(/Noch keine Karten\. Sie entstehen als Vorschlag nach einer Vorlesung/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zur Inbox' })).toHaveAttribute('href', '/inbox');
    expect(screen.queryByRole('button', { name: 'Starten' })).toBeNull();
  });

  it('Karten da, aber nichts fällig: „Heute ist nichts fällig.“', async () => {
    boot([
      basicCard({
        state: makeCardState({
          state: 'review',
          due: '2099-01-01T00:00:00Z',
          reps: 3,
          last_review: '2026-11-01T00:00:00Z',
        }),
      }),
    ]);
    wrap(<LearnView />);
    expect(await screen.findByText('Heute ist nichts fällig.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Weitere/ })).toBeNull();
  });

  it('nichts mehr dran nach Bewertungen: „Für heute geschafft.“', async () => {
    boot([
      basicCard({
        state: makeCardState({
          state: 'review',
          due: '2099-01-01T00:00:00Z',
          reps: 3,
          last_review: '2026-11-01T00:00:00Z',
        }),
      }),
    ]);
    core.cards.reviews.set(id(1), {
      id: id(1),
      card_id: id(2),
      reviewed_at: '2026-11-12T10:00:00Z',
      rating: 3,
      duration_ms: 5000,
    });
    wrap(<LearnView />);
    expect(await screen.findByText('Für heute geschafft.')).toBeInTheDocument();
  });

  it('Core nicht erreichbar: der übliche ruhige Hinweis', async () => {
    boot([basicCard()]);
    core.down = true;
    wrap(<LearnView />);
    expect(await screen.findByText('Core nicht erreichbar')).toBeInTheDocument();
  });
});

describe('Ablauf', () => {
  it('Frage → aufdecken → Bewertung 1 bis 4 mit der Tastatur; vor dem Aufdecken tun die Zahlen nichts', async () => {
    boot([basicCard(), clozeCard()]);
    const user = await start();
    expect(await screen.findByTestId('learn-progress')).toHaveTextContent('Karte 1 von 2');
    expect(screen.getByText('Wann ist eine Relation in dritter Normalform?')).toBeInTheDocument();
    expect(screen.queryByTestId('card-back')).toBeNull();
    // Konzept dezent mit Link
    expect(screen.getByRole('link', { name: 'Dritte Normalform (3NF)' })).toHaveAttribute(
      'href',
      `/bibliothek?konzept=${C_3NF}`,
    );

    await user.keyboard('3');
    expect(reviewPosts()).toHaveLength(0);

    await user.keyboard(' ');
    expect(screen.getByTestId('card-back')).toHaveTextContent('Wenn sie in 2NF ist');
    expect(screen.getByText('Transitive Abhängigkeiten wandern in eine eigene Tabelle.')).toBeInTheDocument();

    await user.keyboard('3');
    // Die nächste Karte erscheint sofort
    expect(screen.getByTestId('learn-progress')).toHaveTextContent('Karte 2 von 2');
    await waitFor(() => expect(reviewPosts()).toHaveLength(1));
    const first = reviewPosts()[0];
    expect(first?.path).toBe(`/cards/${core.cards.cards[0]?.id}/review`);
    const body = first?.body as { id: string; rating: number; duration_ms: number };
    expect(body.id).toMatch(UUID);
    expect(body.rating).toBe(3);
    expect(Number.isInteger(body.duration_ms)).toBe(true);
    expect(body.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('Lückentext: vorn […], hinten der Satz mit hervorgehobener Lösung', async () => {
    boot([clozeCard()]);
    const user = await start();
    const panel = await screen.findByRole('group', { name: /Karte 1 von 1/ });
    expect(panel).toHaveTextContent('Eine Relation in 3NF ist immer auch in […].');
    expect(panel.textContent).not.toContain('{{');
    await user.keyboard('{Enter}');
    const back = screen.getByTestId('card-back');
    expect(back).toHaveTextContent('Eine Relation in 3NF ist immer auch in 2NF.');
    expect(back.querySelector('mark')).toHaveTextContent('2NF');
  });

  it('Knöpfe „Nochmal“ bis „Leicht“ bewerten wie die Tasten 1 bis 4', async () => {
    boot([basicCard()]);
    const user = await start();
    await user.click(await screen.findByRole('button', { name: 'Aufdecken' }));
    const group = screen.getByRole('group', { name: 'Bewertung' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Nochmal1', 'Schwer2', 'Gut3', 'Leicht4']);
    await user.click(within(group).getByRole('button', { name: /Leicht/ }));
    await waitFor(() => expect(reviewPosts()).toHaveLength(1));
    expect((reviewPosts()[0]?.body as { rating: number }).rating).toBe(4);
  });

  it('Quellen-Chips nach dem Aufdecken: Folie und Zeit mit Zielen, fehlender Beleg ausgegraut ohne Link', async () => {
    boot([
      basicCard({
        sources: [
          { ref: slideRef(DECK, 14), missing: false },
          { ref: timeRef(SESSION, 2_532_000), missing: false },
          { ref: slideRef(DECK, 3), missing: true },
        ],
      }),
    ]);
    const user = await start();
    await screen.findByTestId('learn-progress');
    expect(screen.queryByRole('list', { name: 'Quellen dieser Karte' })).toBeNull();
    await user.keyboard(' ');
    const chips = screen.getByRole('list', { name: 'Quellen dieser Karte' });
    expect(within(chips).getByRole('link', { name: 'Folie 14' })).toHaveAttribute(
      'href',
      `/dokument?typ=folien&id=${DECK}&seite=14`,
    );
    expect(within(chips).getByRole('link', { name: /Aufnahme ab 42:12/ })).toHaveAttribute(
      'href',
      `/rueckblick?id=${SESSION}&t=2532000`,
    );
    const missing = chips.querySelector('[data-missing="true"]') as HTMLElement;
    expect(missing).toHaveTextContent('Folie 3, nicht mehr vorhanden');
    expect(missing.closest('a')).toBeNull();
  });

  it('Klausur-Kennzeichen bei klausurrelevantem Konzept', async () => {
    boot([basicCard()], [makeConceptDetail({ id: C_3NF, name: '3NF', exam_relevant: true })]);
    await start();
    expect(await screen.findByText('Klausur')).toBeInTheDocument();
  });

  it('`requeue`: „Nochmal“ hängt die Karte ans Ende, der Zähler wächst, sie wird sofort gezeigt', async () => {
    boot([basicCard()]);
    const user = await start();
    await screen.findByTestId('learn-progress');
    await user.keyboard(' 1');
    await waitFor(() => expect(screen.getByTestId('learn-progress')).toHaveTextContent('Karte 2 von 2'));
    // Gleiche Karte, noch nicht wieder fällig, trotzdem gezeigt
    expect(screen.getByText('Wann ist eine Relation in dritter Normalform?')).toBeInTheDocument();
    await user.keyboard(' 3');
    expect(await screen.findByTestId('learn-done')).toHaveTextContent(
      'Für heute geschafft · 2 Karten in 1 min',
    );
    expect(reviewPosts()).toHaveLength(2);
    expect(new Set(reviewPosts().map((r) => (r.body as { id: string }).id)).size).toBe(2);
  });

  it('Esc beendet den Block; Weiter setzt mit dem Rest fort', async () => {
    boot([basicCard(), clozeCard()]);
    const user = await start();
    await screen.findByTestId('learn-progress');
    await user.keyboard(' 3');
    await waitFor(() => expect(reviewPosts()).toHaveLength(1));
    await user.keyboard('{Escape}');
    expect(await screen.findByTestId('learn-done')).toHaveTextContent('Block beendet · 1 Karte in 1 min');
    const next = await screen.findByRole('button', { name: 'Weiter' });
    await user.click(next);
    expect(await screen.findByTestId('learn-progress')).toHaveTextContent('Karte 1 von 1');
  });

  it('Ende des Blocks: „Weitere 10 min“ holt die Warteschlange mit `extra_minutes=10`', async () => {
    boot([basicCard(), basicCard(), basicCard()]);
    core.cards.budgetMinutes = 1;
    const user = await start();
    await screen.findByTestId('learn-progress');
    // 1 min Budget: nur eine neue Karte (3 × 12 s) passt in den Block
    expect(screen.getByTestId('learn-progress')).toHaveTextContent('Karte 1 von 1');
    await user.keyboard(' 3');
    expect(await screen.findByTestId('learn-done')).toBeInTheDocument();
    const more = await screen.findByRole('button', { name: 'Weitere 10 min' });
    await user.click(more);
    await waitFor(() =>
      expect(core.requests.some((r) => r.path === '/review/queue?extra_minutes=10')).toBe(true),
    );
    expect(await screen.findByTestId('learn-progress')).toHaveTextContent('Karte 1 von 2');
  });
});

describe('Bewerten ist idempotent', () => {
  it('Netzfehler: dieselbe `id` geht noch einmal hinaus und zählt nicht doppelt', async () => {
    boot([basicCard()]);
    ratingOutbox.retryDelaysMs = [5, 5];
    core.cards.failNextReview = 'after';
    const user = await start();
    await screen.findByTestId('learn-progress');
    await user.keyboard(' 3');
    expect(await screen.findByTestId('learn-done')).toHaveTextContent('1 Karte');
    expect(reviewPosts()).toHaveLength(2);
    const ids = reviewPosts().map((r) => (r.body as { id: string }).id);
    expect(ids[0]).toBe(ids[1]);
    expect(core.cards.reviews.size).toBe(1);
  });

  it('bei anhaltendem Fehler ein ruhiger Hinweis mit „Erneut versuchen“, derselben `id`', async () => {
    boot([basicCard()]);
    ratingOutbox.retryDelaysMs = [5, 5];
    core.cards.failReviews = 99;
    const user = await start();
    await screen.findByTestId('learn-progress');
    await user.keyboard(' 3');
    await screen.findByTestId('learn-done');
    const hint = await screen.findByTestId('outbox-hint');
    expect(hint).toHaveTextContent('Einige Bewertungen sind noch nicht gespeichert');
    expect(reviewPosts()).toHaveLength(3);
    core.cards.failReviews = 0;
    await user.click(
      within(screen.getByTestId('outbox-hint')).getByRole('button', { name: 'Erneut versuchen' }),
    );
    await waitFor(() => expect(core.cards.reviews.size).toBe(1));
    await waitFor(() => expect(screen.queryByTestId('outbox-hint')).toBeNull());
    const ids = new Set(reviewPosts().map((r) => (r.body as { id: string }).id));
    expect(ids.size).toBe(1);
  });

  it('eine inzwischen pausierte Karte (409) wird still verworfen, ohne Fehlerhinweis', async () => {
    boot([basicCard(), clozeCard()]);
    const user = await start();
    await screen.findByTestId('learn-progress');
    const first = core.cards.cards[0];
    if (first) first.suspended = true;
    await user.keyboard(' 3');
    await waitFor(() => expect(reviewPosts()).toHaveLength(1));
    expect(screen.queryByTestId('outbox-hint')).toBeNull();
    expect(screen.getByTestId('learn-progress')).toHaveTextContent('Karte 2 von 2');
  });
});

describe('Menü je Karte', () => {
  async function openMenu(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: /^Menü: / }));
  }

  it('Pausieren nimmt die Karte aus dem Block', async () => {
    boot([basicCard(), clozeCard()]);
    const user = await start();
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Pausieren' }));
    await waitFor(() => expect(core.cards.cards[0]?.suspended).toBe(true));
    expect(await screen.findByText(/Eine Relation in 3NF ist immer auch in/)).toBeInTheDocument();
    expect(screen.getByTestId('learn-progress')).toHaveTextContent('Karte 1 von 1');
  });

  it('Löschen mit 10-s-Toast „Rückgängig“, der die Karte aus dem Papierkorb holt', async () => {
    boot([basicCard(), clozeCard()]);
    const user = await start();
    const deletedId = core.cards.cards[0]?.id ?? '';
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(core.cards.trashed).toHaveLength(1));
    const toast = screen.getByTestId('toast-live');
    expect(toast).toHaveTextContent('Karte gelöscht');
    await user.click(within(toast).getByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(core.cards.trashed).toHaveLength(0));
    expect(core.requests.some((r) => r.method === 'POST' && r.path === `/trash/${deletedId}/restore`)).toBe(
      true,
    );
  });

  it('Bearbeiten inline (kein Dialog): PATCH mit neuem Inhalt; Zahlen im Feld bewerten nichts', async () => {
    boot([basicCard()]);
    const user = await start();
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const front = await screen.findByLabelText('Vorderseite');
    await user.clear(front);
    await user.type(front, 'Was besagt die 3NF? 1234');
    expect(reviewPosts()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.getByText('Was besagt die 3NF? 1234')).toBeInTheDocument());
    const patch = core.requests.find((r) => r.method === 'PATCH');
    expect((patch?.body as { content: { front: { text_md: string } } }).content.front.text_md).toBe(
      'Was besagt die 3NF? 1234',
    );
    expect(core.cards.cards[0]?.state.state).toBe('new');
  });

  it('Bearbeiten: ein Fehler vom Core steht ruhig am Feld', async () => {
    boot([clozeCard()]);
    const user = await start();
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const front = await screen.findByLabelText('Lückentext');
    await user.clear(front);
    await user.type(front, 'Ohne Lücke');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Es fehlt eine Lücke');
    expect(core.requests.some((r) => r.method === 'PATCH')).toBe(false);
  });
});

describe('Seitenwechsel', () => {
  it('eine unterwegs gebliebene Bewertung wird auch nach dem Verlassen der Ansicht noch gesendet', async () => {
    boot([basicCard()]);
    ratingOutbox.retryDelaysMs = [20, 20];
    core.cards.failReviews = 1;
    const user = userEvent.setup();
    const view = wrap(<LearnView />);
    await user.click(await screen.findByRole('button', { name: 'Starten' }));
    await screen.findByTestId('learn-progress');
    await user.keyboard(' 3');
    await waitFor(() => expect(reviewPosts()).toHaveLength(1));
    // Ansicht weg: der Postausgang lebt außerhalb und sendet weiter
    view.unmount();
    await waitFor(() => expect(core.cards.reviews.size).toBe(1));
  });
});
