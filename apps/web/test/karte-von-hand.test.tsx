// B5 (VERTRAEGE §21.4 `POST /cards`, §21.10): Karte von Hand anlegen, aus der Konzeptansicht und mit „Karte daraus“
// aus der Kurzfassung. Alle Inhalte sind erfunden.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { CardContent, EvidenceView, SessionSummary } from '@sg/shared';

vi.mock('next/navigation', () => ({
  usePathname: () => '/konzepte',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { ConceptView } from '../src/components/concepts/ConceptView.tsx';
import { SummaryPanel } from '../src/components/rueckblick/SummaryPanel.tsx';
import { cardErrorMessage, contentFromDraft, createCard, draftFromContent } from '../src/lib/cards.ts';
import { ApiRequestError } from '../src/lib/api.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { ToastProvider } from '../src/lib/toast.tsx';
import { DECK_ID, slideRef, timeRef } from './fake-cards.ts';
import { installFakeCore, makeConceptDetail, makeModule, makeSemester, type FakeCore } from './fake-core.ts';

const id = (n: number) => `0190f6a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const C_3NF = id(801);
const C_1NF = id(803);
const SESSION_ID = id(850);

let core: FakeCore;

const evidence = (
  n: number,
  ref: EvidenceView['ref'],
  overrides: Partial<EvidenceView> = {},
): EvidenceView => ({
  id: id(7000 + n),
  ref,
  session: null,
  slide_title: null,
  missing: false,
  quote: null,
  auto: false,
  ...overrides,
});

function boot(
  evidenceList: EvidenceView[] = [
    evidence(1, slideRef(DECK_ID, 14)),
    evidence(2, timeRef(SESSION_ID, 42_000)),
  ],
) {
  core = installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
  core.concepts = [
    makeConceptDetail({ id: C_3NF, name: 'Dritte Normalform (3NF)' }, { evidence: evidenceList }),
    makeConceptDetail({ id: C_1NF, name: 'Erste Normalform (1NF)' }),
  ];
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

const posts = () => core.requests.filter((r) => r.method === 'POST' && r.path === '/cards');
const bodyOf = (n: number) => posts()[n]?.body as Record<string, unknown> | null | undefined;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});
afterEach(() => cleanup());

describe('Konzeptansicht: Karte anlegen', () => {
  it('Frage: der erste Beleg ist vorgewählt, die Karte erscheint in der Liste', async () => {
    boot();
    const user = userEvent.setup();
    wrap(<ConceptView id={C_3NF} />);
    await user.click(await screen.findByRole('button', { name: 'Karte anlegen' }));
    const editor = screen.getByTestId('card-editor');
    expect(within(editor).getByLabelText('Folie 14')).toBeChecked();
    expect(within(editor).getByLabelText(/^Aufnahme ab/)).not.toBeChecked();
    expect(editor).toHaveTextContent('Dritte Normalform (3NF)');
    expect(within(editor).getByLabelText('Vorderseite')).toHaveFocus();

    await user.type(within(editor).getByLabelText('Vorderseite'), 'Was ist ein Schlüsselattribut?');
    await user.type(within(editor).getByLabelText('Antwort'), 'Ein Attribut eines Schlüsselkandidaten.');
    await user.click(within(editor).getByRole('button', { name: 'Karte anlegen' }));

    await waitFor(() => expect(screen.queryByTestId('card-editor')).toBeNull());
    expect(posts()).toHaveLength(1);
    expect(bodyOf(0)).toMatchObject({
      concept_id: C_3NF,
      content: {
        kind: 'basic',
        front: { text_md: 'Was ist ein Schlüsselattribut?' },
        back: { text_md: 'Ein Attribut eines Schlüsselkandidaten.', explanation_md: null },
      },
      sources: [slideRef(DECK_ID, 14)],
    });
    const section = screen.getByRole('region', { name: /^Karten/ });
    const row = await waitFor(() => {
      const found = within(section)
        .getAllByRole('listitem')
        .filter((li) => li.dataset.cardId);
      expect(found).toHaveLength(1);
      return found[0] as HTMLElement;
    });
    expect(row).toHaveTextContent('Was ist ein Schlüsselattribut?');
    expect(core.cards.cards[0]?.origin).toBe('manuell');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Karte anlegen' })).toHaveFocus());
  });

  it('Lückentext: Vorschau mit […] und aufgedeckter Lösung, Lösungen aus den Lücken', async () => {
    boot();
    const user = userEvent.setup();
    wrap(<ConceptView id={C_3NF} />);
    await user.click(await screen.findByRole('button', { name: 'Karte anlegen' }));
    const editor = screen.getByTestId('card-editor');
    await user.click(within(editor).getByLabelText('Lückentext', { selector: 'input' }));
    const preview = within(editor).getByTestId('cloze-preview');
    expect(preview).toHaveTextContent('Noch keine Lücke.');
    await user.click(within(editor).getByLabelText('Lückentext', { selector: 'textarea' }));
    await user.paste('Jede 3NF ist auch in {{c1::2NF}}.');
    expect(preview).toHaveTextContent('Jede 3NF ist auch in […].');
    expect(preview).toHaveTextContent('Jede 3NF ist auch in 2NF.');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(bodyOf(0)).toMatchObject({
      content: {
        kind: 'cloze',
        front: { text_md: 'Jede 3NF ist auch in {{c1::2NF}}.' },
        back: { answers: { c1: ['2NF'] } },
      },
    });
    await waitFor(() => expect(screen.queryByTestId('card-editor')).toBeNull());
  });

  it('ohne Belege: kein Editor, ruhiger Hinweis; gelöschte Belege zählen nicht', async () => {
    boot([evidence(1, slideRef(DECK_ID, 14), { missing: true })]);
    wrap(<ConceptView id={C_3NF} />);
    expect(await screen.findByText(/Keine Belege mehr\. Ohne Beleg/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Karte anlegen' })).toBeNull();
  });

  it('Eingaben werden vor dem Senden geprüft: leer, kein Beleg, keine Lücke', async () => {
    boot();
    const user = userEvent.setup();
    wrap(<ConceptView id={C_3NF} />);
    await user.click(await screen.findByRole('button', { name: 'Karte anlegen' }));
    const editor = screen.getByTestId('card-editor');
    const save = () => user.click(within(editor).getByRole('button', { name: 'Karte anlegen' }));
    await save();
    expect(within(editor).getByRole('alert')).toHaveTextContent('Ein Feld ist leer.');
    await user.type(within(editor).getByLabelText('Vorderseite'), 'Frage?');
    await user.type(within(editor).getByLabelText('Antwort'), 'Antwort.');
    await user.click(within(editor).getByLabelText('Folie 14'));
    await save();
    expect(within(editor).getByRole('alert')).toHaveTextContent('Wähle mindestens einen Beleg');
    await user.click(within(editor).getByLabelText('Lückentext', { selector: 'input' }));
    await user.click(within(editor).getByLabelText('Folie 14'));
    await user.clear(within(editor).getByLabelText('Lückentext', { selector: 'textarea' }));
    await user.type(within(editor).getByLabelText('Lückentext', { selector: 'textarea' }), 'Ohne Lücke');
    await save();
    expect(within(editor).getByRole('alert')).toHaveTextContent('Es fehlt eine Lücke');
    expect(posts()).toHaveLength(0);
  });

  it('Esc bricht ab, ohne etwas zu senden', async () => {
    boot();
    const user = userEvent.setup();
    wrap(<ConceptView id={C_3NF} />);
    await user.click(await screen.findByRole('button', { name: 'Karte anlegen' }));
    await user.type(screen.getByLabelText('Vorderseite'), 'Halb');
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('card-editor')).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it('Fehler vom Core stehen ruhig im Editor: Beleg gibt es nicht mehr, der Entwurf bleibt', async () => {
    boot();
    core.cards.goneRefs = [slideRef(DECK_ID, 14)];
    const user = userEvent.setup();
    wrap(<ConceptView id={C_3NF} />);
    await user.click(await screen.findByRole('button', { name: 'Karte anlegen' }));
    const editor = screen.getByTestId('card-editor');
    await user.type(within(editor).getByLabelText('Vorderseite'), 'Frage?');
    await user.type(within(editor).getByLabelText('Antwort'), 'Antwort.');
    await user.click(within(editor).getByRole('button', { name: 'Karte anlegen' }));
    expect(await within(editor).findByRole('alert')).toHaveTextContent(
      'Den Beleg „Folie 14“ gibt es nicht mehr. Wähle einen anderen.',
    );
    expect(within(editor).getByLabelText('Vorderseite')).toHaveValue('Frage?');
    await user.click(within(editor).getByLabelText('Folie 14'));
    await user.click(within(editor).getByLabelText(/^Aufnahme ab/));
    await user.click(within(editor).getByRole('button', { name: 'Karte anlegen' }));
    await waitFor(() => expect(screen.queryByTestId('card-editor')).toBeNull());
    expect(core.cards.cards).toHaveLength(1);
  });

  it('abgerissene Antwort: erneutes Speichern legt keine zweite Karte an (gleiche `id`)', async () => {
    boot();
    core.cards.failNextCreate = 'after';
    const user = userEvent.setup();
    wrap(<ConceptView id={C_3NF} />);
    await user.click(await screen.findByRole('button', { name: 'Karte anlegen' }));
    const editor = screen.getByTestId('card-editor');
    await user.type(within(editor).getByLabelText('Vorderseite'), 'Frage?');
    await user.type(within(editor).getByLabelText('Antwort'), 'Antwort.');
    await user.click(within(editor).getByRole('button', { name: 'Karte anlegen' }));
    await within(editor).findByRole('alert');
    expect(core.cards.cards).toHaveLength(1);
    await user.click(within(editor).getByRole('button', { name: 'Karte anlegen' }));
    await waitFor(() => expect(screen.queryByTestId('card-editor')).toBeNull());
    expect(core.cards.cards).toHaveLength(1);
    expect(posts()).toHaveLength(2);
    expect(bodyOf(0)?.id).toBe(bodyOf(1)?.id);
  });

  it('abgerissene Antwort, danach geändert: dieselbe Karte bekommt den neuen Stand, keine zweite', async () => {
    boot();
    core.cards.failNextCreate = 'after';
    const user = userEvent.setup();
    wrap(<ConceptView id={C_3NF} />);
    await user.click(await screen.findByRole('button', { name: 'Karte anlegen' }));
    const editor = screen.getByTestId('card-editor');
    await user.type(within(editor).getByLabelText('Vorderseite'), 'Frage?');
    await user.type(within(editor).getByLabelText('Antwort'), 'Alt.');
    await user.click(within(editor).getByRole('button', { name: 'Karte anlegen' }));
    await within(editor).findByRole('alert');
    await user.clear(within(editor).getByLabelText('Antwort'));
    await user.type(within(editor).getByLabelText('Antwort'), 'Neu.');
    await user.click(within(editor).getByLabelText(/^Aufnahme ab/));
    await user.click(within(editor).getByRole('button', { name: 'Karte anlegen' }));
    await waitFor(() => expect(screen.queryByTestId('card-editor')).toBeNull());
    expect(core.cards.cards).toHaveLength(1);
    const card = core.cards.cards[0];
    expect(card?.content).toMatchObject({ back: { text_md: 'Neu.' } });
    expect(card?.sources.map((s) => s.ref)).toEqual([slideRef(DECK_ID, 14), timeRef(SESSION_ID, 42_000)]);
  });

  it('card_source_invalid nennt den gesendeten Beleg, nicht die Stelle in der Liste', async () => {
    boot();
    core.cards.goneRefs = [timeRef(SESSION_ID, 42_000)];
    const user = userEvent.setup();
    wrap(<ConceptView id={C_3NF} />);
    await user.click(await screen.findByRole('button', { name: 'Karte anlegen' }));
    const editor = screen.getByTestId('card-editor');
    await user.type(within(editor).getByLabelText('Vorderseite'), 'Frage?');
    await user.type(within(editor).getByLabelText('Antwort'), 'Antwort.');
    await user.click(within(editor).getByLabelText('Folie 14'));
    await user.click(within(editor).getByLabelText(/^Aufnahme ab/));
    await user.click(within(editor).getByRole('button', { name: 'Karte anlegen' }));
    expect(await within(editor).findByRole('alert')).toHaveTextContent(
      /^Den Beleg „Aufnahme ab [\d:]+“ gibt es/,
    );
  });
});

describe('Rückblick: Karte daraus', () => {
  const SUMMARY: SessionSummary = {
    id: id(771),
    session_id: SESSION_ID,
    created_at: '2026-11-04T09:20:00Z',
    updated_at: '2026-11-04T09:20:00Z',
    lang: 'de',
    sentences: [
      {
        text: 'Die dritte Normalform schließt transitive Abhängigkeiten aus.',
        sources: [slideRef(DECK_ID, 14), timeRef(SESSION_ID, 205_000)],
      },
    ],
    outline: [],
    model: 'fake',
    prompt_version: 'summary.write/v1',
    job_id: null,
  };
  const concepts = [
    { id: C_3NF, name: 'Dritte Normalform (3NF)' },
    { id: C_1NF, name: 'Erste Normalform (1NF)' },
  ];

  it('Satz als Antwort, seine Quellen als Beleg, Konzept zur Auswahl', async () => {
    boot();
    const user = userEvent.setup();
    wrap(<SummaryPanel summary={SUMMARY} onPick={() => false} concepts={concepts} />);
    await user.click(screen.getByRole('button', { name: 'Karte aus Satz 1 anlegen' }));
    const editor = screen.getByTestId('card-editor');
    expect(within(editor).getByLabelText('Antwort')).toHaveValue(SUMMARY.sentences[0]?.text);
    expect(within(editor).getByLabelText('Folie 14')).toBeChecked();
    expect(within(editor).getByLabelText(/^Aufnahme ab 03:25/)).toBeChecked();
    await user.selectOptions(within(editor).getByLabelText('Konzept'), C_1NF);
    await user.type(within(editor).getByLabelText('Vorderseite'), 'Was schließt die 3NF aus?');
    await user.click(within(editor).getByRole('button', { name: 'Karte anlegen' }));
    await waitFor(() => expect(screen.queryByTestId('card-editor')).toBeNull());
    expect(bodyOf(0)).toMatchObject({
      concept_id: C_1NF,
      sources: [slideRef(DECK_ID, 14), timeRef(SESSION_ID, 205_000)],
      content: { kind: 'basic', back: { text_md: SUMMARY.sentences[0]?.text } },
    });
    expect(core.cards.cards).toHaveLength(1);
  });

  it('als Lückentext übernimmt der Editor den Satz', async () => {
    boot();
    const user = userEvent.setup();
    wrap(<SummaryPanel summary={SUMMARY} onPick={() => false} concepts={concepts} />);
    await user.click(screen.getByRole('button', { name: 'Karte aus Satz 1 anlegen' }));
    const editor = screen.getByTestId('card-editor');
    await user.click(within(editor).getByLabelText('Lückentext', { selector: 'input' }));
    expect(within(editor).getByLabelText('Lückentext', { selector: 'textarea' })).toHaveValue(
      SUMMARY.sentences[0]?.text,
    );
  });

  it('doppelte Quellen eines Satzes erscheinen nur einmal', async () => {
    boot();
    const user = userEvent.setup();
    const sentence = SUMMARY.sentences[0];
    const doubled: SessionSummary = {
      ...SUMMARY,
      sentences: [{ text: sentence?.text ?? '', sources: [slideRef(DECK_ID, 14), slideRef(DECK_ID, 14)] }],
    };
    wrap(<SummaryPanel summary={doubled} onPick={() => false} concepts={concepts} />);
    await user.click(screen.getByRole('button', { name: 'Karte aus Satz 1 anlegen' }));
    expect(within(screen.getByTestId('card-editor')).getAllByRole('checkbox')).toHaveLength(1);
  });

  it('ohne aktive Konzepte gibt es den Knopf nicht', () => {
    boot();
    wrap(<SummaryPanel summary={SUMMARY} onPick={() => false} concepts={[]} />);
    expect(screen.queryByRole('button', { name: /Karte aus Satz/ })).toBeNull();
  });
});

describe('Hilfen', () => {
  it('Fehlertexte: card_invalid mit Grund, too_long, card_source_invalid, concept_not_active', () => {
    const err = (code: string, details: Record<string, unknown> = {}) =>
      new ApiRequestError({ kind: 'api', status: 400, code, message: 'x', userMessage: 'x', details });
    expect(cardErrorMessage(err('card_invalid', { reason: 'cloze_syntax' }))).toMatch(
      /Lücken sind nicht richtig/,
    );
    expect(cardErrorMessage(err('card_invalid', { reason: 'too_long', key: 'k1' }))).toMatch(/zu lang/);
    expect(cardErrorMessage(err('card_invalid', { reason: 'unbekannt' }))).toMatch(/passt so nicht/);
    expect(cardErrorMessage(err('card_source_invalid', { index: 1 }))).toMatch(/Beleg 2/);
    expect(cardErrorMessage(err('concept_not_active', { status: 'zusammengefuehrt' }))).toMatch(
      /zusammengeführt/,
    );
  });

  it('Clientprüfung gegen die gemeinsamen Testfälle (fixtures/cards/content.json)', () => {
    const file = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../packages/schemas/fixtures/cards/content.json',
    );
    const { cases } = JSON.parse(readFileSync(file, 'utf8')) as {
      cases: { name: string; content: CardContent; reason: string | null }[];
    };
    const messages: Record<string, RegExp> = {
      empty: /Ein Feld ist leer/,
      cloze_none: /Es fehlt eine Lücke/,
      cloze_numbers: /bei c1 beginnen/,
    };
    expect(cases.length).toBeGreaterThan(10);
    for (const testCase of cases) {
      const result = contentFromDraft(draftFromContent(testCase.content), testCase.content);
      // Gültiges lehnt der Client nie ab; was er ablehnt, lehnt er mit dem Grund des Core ab (den Rest prüft der Core)
      if (testCase.reason === null) expect(result.ok, testCase.name).toBe(true);
      else if (!result.ok) expect(result.message, testCase.name).toMatch(messages[testCase.reason] ?? /^$/);
    }
  });

  it('createCard sendet POST /cards und liest die Karte', async () => {
    boot();
    const card = await createCard({
      concept_id: C_3NF,
      content: { kind: 'basic', front: { text_md: 'F?' }, back: { text_md: 'A', explanation_md: null } },
      sources: [slideRef(DECK_ID, 14)],
    });
    expect(card.origin).toBe('manuell');
    expect(card.concept_id).toBe(C_3NF);
  });
});
