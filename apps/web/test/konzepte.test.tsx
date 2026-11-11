// T2-23 (VERTRAEGE §20.10): Inbox der Vorschläge, Zähler in der Navigation, Bibliothek und Konzeptansicht,
// Einstellungen → KI. Alle Konzepte, Namen und Sätze sind erfunden.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { InboxItem } from '@sg/shared';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/inbox',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
}));

import { LibraryView } from '../src/components/concepts/LibraryView.tsx';
import { conceptEdit } from '../src/components/inbox/InboxEdit.tsx';
import { SuggestionInbox } from '../src/components/inbox/SuggestionInbox.tsx';
import { SettingsView } from '../src/components/SettingsView.tsx';
import { Sidebar } from '../src/components/Sidebar.tsx';
import { ApiRequestError } from '../src/lib/api.ts';
import {
  evidenceChip,
  evidenceHref,
  groupByModule,
  groupRelations,
  relationSentence,
  sessionRefLabel,
} from '../src/lib/concepts.ts';
import { aiStateSentence, budgetPercent, monthLabel, parseBudget } from '../src/lib/costs.ts';
import {
  InboxRequestError,
  acceptItem,
  bulkTarget,
  inboxErrorMessage,
  parseAliases,
} from '../src/lib/inbox.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { ToastProvider } from '../src/lib/toast.tsx';
import {
  installFakeCore,
  makeAiStatus,
  makeConceptDetail,
  makeCostSummary,
  makeInboxItem,
  makeModule,
  makeSemester,
  makeSession,
  makeSessionRef,
  type FakeCore,
} from './fake-core.ts';

const id = (n: number) => `0190f6a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SESSION = makeSessionRef();
const DECK = id(700);
const C_3NF = id(801);
const C_FA = id(802);
const C_BCNF = id(803);
const I_NEW = id(901);
const I_MERGE = id(902);
const I_REL = id(903);
const I_OLD = id(904);

type Proposal = Extract<InboxItem['payload'], { kind: 'concept_new' }>['proposal'];

const proposal = (name: string, extra: Partial<Proposal> = {}): Proposal => ({
  name,
  aliases: [],
  one_liner: null,
  kind: 'definition' as const,
  importance: 2,
  exam_hint: false,
  prof_explanation: null,
  confidence: 0.9,
  ...extra,
});

const slideRef = (index: number) => ({
  kind: 'slide' as const,
  slide_id: id(5000 + index),
  deck_id: DECK,
  slide_index: index,
});
const timeRef = (ms: number) => ({
  kind: 'transcript' as const,
  session_id: SESSION.id,
  t_start_ms: ms,
  t_end_ms: ms + 10_000,
});

function newItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return makeInboxItem(
    {
      kind: 'concept_new',
      proposal: proposal('Dritte Normalform', {
        aliases: ['3NF'],
        one_liner: 'Kein Nichtschlüsselattribut hängt transitiv vom Schlüssel ab.',
      }),
      evidence: [slideRef(14), timeRef(2_532_000)],
      similar: [],
      prompt_version: 'concepts.extract/v1',
      model: 'fake',
    },
    { id: I_NEW, concept_id: C_3NF, priority: 1, ...overrides },
  );
}

function mergeItem(): InboxItem {
  return makeInboxItem(
    {
      kind: 'concept_merge',
      proposal: proposal('Funktionale Abhaengigkeit'),
      evidence: [slideRef(15)],
      target: { concept_id: C_FA, name: 'Funktionale Abhängigkeit' },
      basis: 'ki',
      similarity: 0.84,
      reason: 'Gleiche Definition, andere Schreibweise.',
      prompt_version: 'concepts.resolve/v1',
      model: 'fake',
    },
    { id: I_MERGE, concept_id: id(804), priority: 2 },
  );
}

function relationItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return makeInboxItem(
    {
      kind: 'relation',
      from_concept_id: C_3NF,
      to_concept_id: C_FA,
      relation_kind: 'baut_auf',
      why: 'Die 3NF wird über funktionale Abhängigkeiten definiert.',
      confidence: 0.9,
      prompt_version: 'concepts.extract/v1',
      model: 'fake',
    },
    { id: I_REL, relation_id: id(950), blocked: 'endpunkt_offen', ...overrides },
  );
}

let core: FakeCore;

function boot(items: InboxItem[] = [newItem(), mergeItem(), relationItem()]) {
  core = installFakeCore({
    semesters: [makeSemester()],
    modules: [makeModule()],
    sessions: [makeSession({ id: SESSION.id, state: 'verarbeitet', ended_at: '2026-11-05T13:45:00Z' })],
  });
  core.inboxItems = items;
  core.concepts = [makeConceptDetail({ id: C_FA, name: 'Funktionale Abhängigkeit' })];
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

const rowOf = (itemId: string) =>
  document.querySelector<HTMLElement>(`[data-inbox-item="${itemId}"]`) as HTMLElement;
const posts = () => core.requests.filter((r) => r.method === 'POST' && r.path.startsWith('/inbox'));
const toast = () => screen.getByTestId('toast-live');

beforeEach(() => {
  nav.replace.mockClear();
  window.history.replaceState(null, '', '/');
});

describe('Hilfen', () => {
  it('Quellen-Chips, Ziele und Kurzbeschreibungen', () => {
    expect(evidenceChip(slideRef(14))).toBe('F 14');
    expect(evidenceChip(timeRef(2_532_000))).toBe('42:12');
    expect(evidenceHref(slideRef(14))).toBe(`/dokument?typ=folien&id=${DECK}&seite=14`);
    expect(evidenceHref(timeRef(2_532_000))).toBe(`/rueckblick?id=${SESSION.id}&t=2532000`);
    expect(relationSentence('baut_auf', 'A', 'B')).toBe('A baut auf B auf');
    expect(sessionRefLabel(SESSION)).toBe('VL 7 · Normalformen · DBS');
    expect(sessionRefLabel(null)).toBe('Ohne Vorlesung');
  });

  it('gruppiert Konzepte je Modul mit „Ohne Fach“ am Ende und Beziehungen nach Art und Richtung', () => {
    const stat: typeof SESSION.module = { id: id(2), name: 'Statistik', short_name: null };
    const item = (name: string, modules: (typeof stat)[]) => ({
      concept: makeConceptDetail({ id: id(name.length), name }).concept,
      modules,
      evidence_count: 0,
      session_count: 0,
    });
    const groups = groupByModule([item('A', []), item('BB', [stat, SESSION.module]), item('CCC', [stat])]);
    expect(groups.map((g) => [g.name, g.items.length])).toEqual([
      ['Datenbanksysteme', 1],
      ['Statistik', 2],
      ['Ohne Fach', 1],
    ]);
    const rel = (kind: 'baut_auf' | 'verwandt', direction: 'ausgehend' | 'eingehend', n: number) => ({
      id: id(n),
      kind,
      direction,
      other: { id: id(n + 100), name: `K${n}`, status: 'aktiv' as const },
      source: 'ki' as const,
      confidence: null,
      cross_module: false,
    });
    expect(
      groupRelations([
        rel('verwandt', 'eingehend', 1),
        rel('baut_auf', 'eingehend', 2),
        rel('baut_auf', 'ausgehend', 3),
        rel('verwandt', 'ausgehend', 4),
      ]).map((g) => [g.label, g.relations.length]),
    ).toEqual([
      ['Baut auf', 1],
      ['Grundlage für', 1],
      ['Verwandt mit', 2],
    ]);
  });

  it('Bearbeiten schickt nur geänderte Felder; Aliase ohne Leere und Doppelte', () => {
    const before = { name: 'Alt', aliases: ['a'], one_liner: 'Satz', kind: 'definition' as const };
    expect(conceptEdit(before, { name: 'Alt', aliases: 'a', oneLiner: 'Satz', kind: 'definition' })).toEqual(
      {},
    );
    expect(conceptEdit(before, { name: ' Neu  Name ', aliases: 'a, b', oneLiner: '', kind: '' })).toEqual({
      name: 'Neu Name',
      aliases: ['a', 'b'],
      one_liner: null,
      kind: null,
    });
    expect(parseAliases(' 3NF, , 3nf ,Third  normal form')).toEqual(['3NF', 'Third normal form']);
  });

  it('„Alle annehmen“ zielt auf die Session nur, wenn die Gruppe alle offenen Einträge zeigt', () => {
    const items = [newItem(), mergeItem()];
    expect(bulkTarget(items, SESSION.id, 2)).toEqual({ session_id: SESSION.id });
    expect(bulkTarget(items, SESSION.id, 3)).toEqual({ ids: [I_NEW, I_MERGE] });
    expect(bulkTarget(items, null, 2)).toEqual({ ids: [I_NEW, I_MERGE] });
  });

  it('Fehlercodes haben verständliche Texte, auch die drei, die im Vertrag noch fehlen', () => {
    const error = (status: number, code: string, details = {}) =>
      new InboxRequestError(status, code, 'x', details);
    expect(inboxErrorMessage(error(503, 'inbox_busy'))).toBe('Gerade beschäftigt, bitte gleich nochmal.');
    expect(inboxErrorMessage(error(400, 'inbox_action_invalid'))).toBe(
      'Das passt nicht zu dieser Art von Vorschlag.',
    );
    expect(inboxErrorMessage(error(409, 'inbox_reopen_conflict'))).toBe(
      'Rückgängig geht nicht mehr: Darauf baut inzwischen anderes auf.',
    );
    const names = new Map([
      [C_3NF, 'A'],
      [C_FA, 'B'],
    ]);
    expect(inboxErrorMessage(error(409, 'relation_cycle', { path: [C_3NF, C_FA, C_3NF] }), names)).toBe(
      'Das würde einen Kreis bilden: A → B → A',
    );
    expect(inboxErrorMessage(error(409, 'relation_cycle', { path: [C_3NF, id(1)] }), names)).toBe(
      'Das würde einen Kreis bilden.',
    );
    expect(inboxErrorMessage(error(409, 'relation_endpoint_pending', { concept_id: C_3NF }), names)).toBe(
      'Erst „A“ annehmen, dann die Beziehung.',
    );
    for (const code of [
      'inbox_item_not_found',
      'inbox_item_decided',
      'inbox_item_not_decided',
      'concept_exists',
      'merge_target_invalid',
      'relation_endpoint_pending',
    ]) {
      expect(inboxErrorMessage(error(409, code))).not.toMatch(/nicht geklappt|schiefgegangen/);
    }
    // Allgemeine Codes und unbekannte Codes fallen wie in `lib/api.ts` auf verständliche Texte zurück
    expect(inboxErrorMessage(error(400, 'validation_failed'))).toBe(
      'Das passt so nicht. Prüfe deine Eingabe.',
    );
    expect(inboxErrorMessage(error(401, 'device_token_required'))).toBe(
      'Dieses Gerät ist noch nicht mit dem Core gekoppelt.',
    );
    expect(inboxErrorMessage(error(404, 'irgendwas_neues'))).toBe('Das gibt es nicht (mehr).');
    expect(inboxErrorMessage(error(500, 'internal'))).toMatch(/schiefgegangen/);
  });

  it('Aktionen reichen `details` des Core durch und senden einen Idempotency-Key', async () => {
    boot([newItem()]);
    core.rejectNextInbox = { status: 409, code: 'concept_exists', details: { concept_id: C_FA } };
    const failure = await acceptItem(I_NEW).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(InboxRequestError);
    expect(failure).toBeInstanceOf(ApiRequestError);
    expect((failure as InboxRequestError).details).toEqual({ concept_id: C_FA });
    expect(posts()[0]?.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    core.down = true;
    await expect(acceptItem(I_NEW)).rejects.toMatchObject({ kind: 'unreachable' });
  });

  it('Kosten: Monat, Anteil, Budget-Eingabe, Satz zum Einrichten', () => {
    expect(monthLabel('2026-11')).toBe('November 2026');
    expect(budgetPercent(1.84, 10)).toBe(18);
    expect(budgetPercent(12, 10)).toBe(100);
    expect(budgetPercent(0, 0)).toBe(0);
    expect(parseBudget('12,5')).toBe(12.5);
    expect(parseBudget('1000')).toBe(1000);
    expect(parseBudget('1000,01')).toBeNull();
    expect(parseBudget('-1')).toBeNull();
    expect(parseBudget('zehn')).toBeNull();
    expect(
      aiStateSentence(
        makeAiStatus({ llm: { provider: 'anthropic', configured: false, issue: 'kein_schluessel' } }),
      ),
    ).toMatch(/~\/StudienGehirn\/config\/\.env.*chmod 600.*Worker neu/);
  });
});

describe('Inbox: Vorschläge', () => {
  it('zeigt Gruppen je Vorlesung mit Kurzbeschreibung, ✦ und Quellen-Chips', async () => {
    boot();
    wrap(<SuggestionInbox />);
    const group = await screen.findByRole('region', { name: /VL 7 · Normalformen · DBS/ });
    expect(
      within(group)
        .getAllByRole('listitem')
        .filter((li) => li.dataset.inboxItem),
    ).toHaveLength(3);

    const first = rowOf(I_NEW);
    expect(first).toHaveAccessibleName('Neues Konzept: Dritte Normalform');
    expect(first).toHaveTextContent('Kein Nichtschlüsselattribut hängt transitiv vom Schlüssel ab.');
    expect(first).toHaveTextContent('✦');
    expect(within(first).getByRole('link', { name: 'Folie 14' })).toHaveAttribute(
      'href',
      `/dokument?typ=folien&id=${DECK}&seite=14`,
    );
    expect(within(first).getByRole('link', { name: 'Aufnahme ab 42:12' })).toHaveTextContent('42:12');

    const merge = rowOf(I_MERGE);
    expect(merge).toHaveTextContent('Funktionale Abhaengigkeit – gleich wie Funktionale Abhängigkeit?');
    expect(within(merge).getByRole('button', { name: 'Zusammenführen' })).toBeInTheDocument();
    expect(within(merge).getByRole('button', { name: 'Als neues Konzept' })).toBeInTheDocument();

    const relation = rowOf(I_REL);
    expect(relation).toHaveTextContent('Dritte Normalform baut auf Funktionale Abhängigkeit auf');
    expect(within(relation).getByTestId('inbox-blocked')).toHaveTextContent('wartet auf Dritte Normalform');
    expect(within(relation).getByRole('button', { name: 'Annehmen' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('KI-Texte erscheinen als reiner Text: kein HTML, kein Markdown, keine erkannten Links', async () => {
    boot([
      newItem({
        payload: {
          ...newItem().payload,
          kind: 'concept_new',
          proposal: proposal('<img src=x onerror=alert(1)>', {
            one_liner: '**fett** [Klick](https://example.org) https://example.org',
          }),
        } as InboxItem['payload'],
      }),
    ]);
    wrap(<SuggestionInbox />);
    await screen.findByText('<img src=x onerror=alert(1)>');
    const row = rowOf(I_NEW);
    expect(row.querySelector('img')).toBeNull();
    expect(row).toHaveTextContent('**fett** [Klick](https://example.org) https://example.org');
    expect(within(row).queryByRole('link', { name: /example|Klick/ })).toBeNull();
  });

  it('→ nimmt an, der Fokus geht auf den nächsten Vorschlag, „Rückgängig“ öffnet wieder', async () => {
    boot();
    wrap(<SuggestionInbox />);
    await screen.findByText('Dritte Normalform');
    rowOf(I_NEW).focus();
    fireEvent.keyDown(rowOf(I_NEW), { key: 'ArrowRight' });
    await waitFor(() => expect(rowOf(I_NEW)).toBeNull());
    expect(posts().map((r) => [r.path, r.body])).toEqual([[`/inbox/${I_NEW}/accept`, {}]]);
    await waitFor(() => expect(rowOf(I_MERGE)).toHaveFocus());
    expect(toast()).toHaveTextContent('„Dritte Normalform“ angenommen');
    // Die Beziehung wartet nicht mehr
    await waitFor(() => expect(within(rowOf(I_REL)).queryByTestId('inbox-blocked')).toBeNull());

    fireEvent.click(within(toast()).getByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(rowOf(I_NEW)).not.toBeNull());
    expect(posts().at(-1)?.path).toBe(`/inbox/${I_NEW}/reopen`);
  });

  it('Doppelklick auf „Annehmen“ schickt die Entscheidung nur einmal', async () => {
    boot();
    wrap(<SuggestionInbox />);
    await screen.findByText('Dritte Normalform');
    const accept = within(rowOf(I_NEW)).getByRole('button', { name: 'Annehmen' });
    fireEvent.click(accept);
    fireEvent.click(accept);
    fireEvent.keyDown(rowOf(I_NEW), { key: 'ArrowRight' });
    await waitFor(() => expect(rowOf(I_NEW)).toBeNull());
    expect(posts().map((r) => r.path)).toEqual([`/inbox/${I_NEW}/accept`]);
  });

  it('← verwirft, ↓ ↑ wechseln die Zeile, in Eingabefeldern gelten die Tasten nicht', async () => {
    boot();
    wrap(<SuggestionInbox />);
    await screen.findByText('Dritte Normalform');
    rowOf(I_NEW).focus();
    fireEvent.keyDown(rowOf(I_NEW), { key: 'ArrowDown' });
    expect(rowOf(I_MERGE)).toHaveFocus();
    fireEvent.keyDown(rowOf(I_MERGE), { key: 'ArrowUp' });
    expect(rowOf(I_NEW)).toHaveFocus();

    fireEvent.keyDown(rowOf(I_NEW), { key: 'e' });
    const name = await screen.findByLabelText('Name');
    expect(name).toHaveFocus();
    fireEvent.keyDown(name, { key: 'ArrowLeft' });
    fireEvent.keyDown(name, { key: 'ArrowRight' });
    expect(posts()).toHaveLength(0);
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(rowOf(I_NEW)).toHaveFocus();

    fireEvent.keyDown(rowOf(I_NEW), { key: 'ArrowLeft' });
    await waitFor(() => expect(rowOf(I_NEW)).toBeNull());
    expect(posts().map((r) => r.path)).toEqual([`/inbox/${I_NEW}/reject`]);
    expect(toast()).toHaveTextContent('Verworfen');
  });

  it('E bearbeitet in der Zeile: Name, Aliase, One-Liner und Art gehen als `edit` mit', async () => {
    const user = userEvent.setup();
    boot();
    wrap(<SuggestionInbox />);
    await screen.findByText('Dritte Normalform');
    fireEvent.keyDown(rowOf(I_NEW), { key: 'E' });
    const form = await screen.findByRole('form', { name: 'Vorschlag bearbeiten' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.clear(within(form).getByLabelText('Name'));
    await user.type(within(form).getByLabelText('Name'), 'Dritte Normalform (3NF)');
    await user.type(within(form).getByLabelText('Aliase'), ', Third normal form');
    await user.selectOptions(within(form).getByLabelText('Art'), 'satz');
    await user.click(within(form).getByRole('button', { name: 'Annehmen' }));
    await waitFor(() => expect(rowOf(I_NEW)).toBeNull());
    expect(posts()[0]?.body).toEqual({
      edit: { name: 'Dritte Normalform (3NF)', aliases: ['3NF', 'Third normal form'], kind: 'satz' },
    });
  });

  it('wählt das Ziel über die Konzeptsuche und führt zusammen', async () => {
    const user = userEvent.setup();
    boot();
    wrap(<SuggestionInbox />);
    await screen.findByText('Dritte Normalform');
    await user.click(within(rowOf(I_NEW)).getByRole('button', { name: 'Bearbeiten' }));
    await user.type(screen.getByLabelText('Stattdessen zusammenführen mit'), 'funkt');
    await user.click(
      await screen.findByRole('button', { name: 'Mit Funktionale Abhängigkeit zusammenführen' }),
    );
    await waitFor(() => expect(rowOf(I_NEW)).toBeNull());
    expect(core.requests.some((r) => r.path.startsWith('/concepts?') && r.path.includes('q=funkt'))).toBe(
      true,
    );
    expect(posts()[0]?.body).toEqual({ merge_into: C_FA });
    expect(toast()).toHaveTextContent('Mit „Funktionale Abhängigkeit“ zusammengeführt');
  });

  it('`concept_merge`: „Als neues Konzept“ schickt `as_new`, die Art einer Beziehung lässt sich ändern', async () => {
    const user = userEvent.setup();
    boot([mergeItem(), relationItem({ blocked: null })]);
    wrap(<SuggestionInbox />);
    await screen.findByText('Funktionale Abhaengigkeit');
    await user.click(within(rowOf(I_MERGE)).getByRole('button', { name: 'Als neues Konzept' }));
    // Namensgleich ist es nicht („ae“ statt „ä“), also entsteht ein neues Konzept
    await waitFor(() => expect(rowOf(I_MERGE)).toBeNull());
    expect(posts()[0]?.body).toEqual({ as_new: true });

    await user.click(within(rowOf(I_REL)).getByRole('button', { name: 'Bearbeiten' }));
    await user.selectOptions(screen.getByLabelText('Art der Beziehung'), 'verwandt');
    await user.click(screen.getByRole('button', { name: 'Annehmen' }));
    await waitFor(() => expect(rowOf(I_REL)).toBeNull());
    expect(posts().at(-1)?.body).toEqual({ relation_kind: 'verwandt' });
    expect(toast()).toHaveTextContent('Beziehung bestätigt');
  });

  it('`409 concept_exists`: Toast mit „Zusammenführen“, kein Dialog', async () => {
    boot([
      newItem({ payload: { ...newItem().payload, proposal: proposal('funktionale abhängigkeit') } as never }),
    ]);
    wrap(<SuggestionInbox />);
    await screen.findByText('funktionale abhängigkeit');
    fireEvent.click(within(rowOf(I_NEW)).getByRole('button', { name: 'Annehmen' }));
    const merge = await within(toast()).findByRole('button', { name: 'Zusammenführen' });
    expect(toast()).toHaveTextContent('„funktionale abhängigkeit“ gibt es schon.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rowOf(I_NEW)).not.toBeNull();
    fireEvent.click(merge);
    await waitFor(() => expect(rowOf(I_NEW)).toBeNull());
    expect(posts().at(-1)?.body).toEqual({ merge_into: C_FA });
  });

  it.each([
    [503, 'inbox_busy', 'Gerade beschäftigt, bitte gleich nochmal.'],
    [400, 'inbox_action_invalid', 'Das passt nicht zu dieser Art von Vorschlag.'],
    [
      409,
      'merge_target_invalid',
      'Mit diesem Konzept lässt sich nicht zusammenführen. Wähle ein anderes Ziel.',
    ],
  ])('zeigt %i %s verständlich an und lässt den Vorschlag stehen', async (status, code, message) => {
    boot([newItem()]);
    wrap(<SuggestionInbox />);
    await screen.findByText('Dritte Normalform');
    core.rejectNextInbox = { status, code };
    fireEvent.click(within(rowOf(I_NEW)).getByRole('button', { name: 'Annehmen' }));
    await waitFor(() => expect(toast()).toHaveTextContent(message));
    expect(rowOf(I_NEW)).not.toBeNull();
  });

  it('„Rückgängig“ scheitert mit `inbox_reopen_conflict`: ruhige Meldung', async () => {
    boot([newItem()]);
    wrap(<SuggestionInbox />);
    await screen.findByText('Dritte Normalform');
    fireEvent.click(within(rowOf(I_NEW)).getByRole('button', { name: 'Verwerfen' }));
    const undo = await within(toast()).findByRole('button', { name: 'Rückgängig' });
    core.rejectNextInbox = { status: 409, code: 'inbox_reopen_conflict', details: { triggered_by: id(1) } };
    fireEvent.click(undo);
    await waitFor(() =>
      expect(toast()).toHaveTextContent('Rückgängig geht nicht mehr: Darauf baut inzwischen anderes auf.'),
    );
  });

  it('„Alle annehmen“ je Gruppe mit Rückgängig (10 s), das in umgekehrter Reihenfolge wieder öffnet', async () => {
    boot([newItem(), mergeItem(), relationItem()]);
    wrap(<SuggestionInbox />);
    await screen.findByText('Dritte Normalform');
    fireEvent.click(screen.getByRole('button', { name: 'Alle annehmen: VL 7 · Normalformen · DBS' }));
    await waitFor(() => expect(toast()).toHaveTextContent('3 angenommen'));
    expect(posts()[0]).toMatchObject({
      path: '/inbox/bulk',
      body: { action: 'accept', session_id: SESSION.id },
    });
    await screen.findByText(/Keine offenen Vorschläge/);
    const undo = within(toast()).getByRole('button', { name: 'Rückgängig' });
    expect(undo).toHaveFocus();
    fireEvent.click(undo);
    await waitFor(() => expect(rowOf(I_NEW)).not.toBeNull());
    expect(posts().at(-1)?.body).toEqual({ action: 'reopen', ids: [I_REL, I_MERGE, I_NEW] });
  });

  it('„Alle annehmen“ meldet, was offen geblieben ist', async () => {
    boot([
      newItem({ payload: { ...newItem().payload, proposal: proposal('Funktionale Abhängigkeit') } as never }),
    ]);
    core.inboxItems.push(mergeItem());
    wrap(<SuggestionInbox />);
    await screen.findAllByText('Funktionale Abhängigkeit');
    fireEvent.click(screen.getByRole('button', { name: /^Alle annehmen/ }));
    await waitFor(() => expect(toast()).toHaveTextContent('1 angenommen · 1 offen geblieben'));
    expect(rowOf(I_NEW)).not.toBeNull();
  });

  it('filtert nach Art; mit Filter nimmt „Alle annehmen“ nur die sichtbaren Einträge', async () => {
    boot();
    wrap(<SuggestionInbox />);
    await screen.findByText('Dritte Normalform');
    fireEvent.click(screen.getByRole('button', { name: 'Neue Konzepte' }));
    expect(screen.getByRole('button', { name: 'Neue Konzepte' })).toHaveAttribute('aria-pressed', 'true');
    expect(rowOf(I_MERGE)).toBeNull();
    expect(rowOf(I_REL)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Alle annehmen/ }));
    await waitFor(() => expect(toast()).toHaveTextContent('1 angenommen'));
    expect(posts()[0]?.body).toEqual({ action: 'accept', ids: [I_NEW] });
  });

  it('sammelt Einträge, die älter als 14 Tage sind, aufklappbar', async () => {
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    boot([newItem(), newItem({ id: I_OLD, concept_id: C_BCNF, created_at: old })]);
    wrap(<SuggestionInbox />);
    await screen.findAllByText('Dritte Normalform');
    const older = screen.getByTestId('inbox-older');
    expect(within(older).getByText('1 älterer Vorschlag')).toBeInTheDocument();
    expect(older).not.toHaveAttribute('open');
    expect(older.contains(rowOf(I_OLD))).toBe(true);
    expect(older.contains(rowOf(I_NEW))).toBe(false);
    expect(rowOf(I_OLD)).toHaveTextContent('VL 7 · Normalformen · DBS');
    // Die Gruppe zeigt nicht alle offenen Einträge der Session: „Alle annehmen“ nennt die IDs
    fireEvent.click(screen.getByRole('button', { name: /^Alle annehmen/ }));
    await waitFor(() => expect(posts()[0]?.body).toEqual({ action: 'accept', ids: [I_NEW] }));
  });

  it('ohne Vorschläge ein ruhiger Satz; nicht erreichbarer Core ohne Absturz', async () => {
    boot([]);
    const view = wrap(<SuggestionInbox />);
    expect(await screen.findByText(/Keine offenen Vorschläge/)).toBeInTheDocument();
    view.unmount();
    boot();
    core.down = true;
    wrap(<SuggestionInbox />);
    expect(await screen.findByText('Core nicht erreichbar')).toBeInTheDocument();
  });

  it('während eine Session läuft, lädt die Inbox keine Vorschläge (R1)', async () => {
    boot();
    core.sessions.push(makeSession({ id: id(0xe2), state: 'laeuft' }));
    wrap(<SuggestionInbox />);
    expect(
      await screen.findByText(/Während der Vorlesung kommen hier keine neuen Vorschläge/),
    ).toBeInTheDocument();
    expect(core.requests.some((r) => r.path.startsWith('/inbox'))).toBe(false);
  });
});

describe('Navigation: Zähler', () => {
  const sidebar = () => <Sidebar expanded onToggle={() => {}} onOpenSearch={() => {}} />;

  it('zeigt die Zahl offener Einträge neutral grau', async () => {
    boot();
    wrap(sidebar());
    const link = await screen.findByRole('link', { name: 'Inbox, 3 offen' });
    const count = within(link).getByText('3');
    expect(count.className).toContain('text-text-muted');
    expect(count.className).not.toMatch(/danger|record|red/);
  });

  it('ohne offene Einträge keine Zahl', async () => {
    boot([]);
    wrap(sidebar());
    await waitFor(() => expect(core.requests.some((r) => r.path === '/inbox/overview')).toBe(true));
    expect(screen.getByRole('link', { name: 'Inbox' })).toBeInTheDocument();
  });

  it('lädt den Zähler nicht, solange eine Session läuft, und holt ihn danach nach (R1)', async () => {
    boot();
    const running = makeSession({ id: id(0xe2), state: 'laeuft' });
    core.sessions.push(running);
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <ToastProvider>{sidebar()}</ToastProvider>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(core.requests.some((r) => r.path.startsWith('/sessions?'))).toBe(true));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(core.requests.some((r) => r.path === '/inbox/overview')).toBe(false);
    expect(screen.getByRole('link', { name: 'Inbox' })).toBeInTheDocument();

    const stopped = core.sessions.find((s) => s.id === running.id);
    if (stopped) stopped.state = 'beendet';
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['sessions', 'active'] });
    });
    expect(await screen.findByRole('link', { name: 'Inbox, 3 offen' })).toBeInTheDocument();
  });
});

describe('Inbox: Neuverbinden', () => {
  it('lädt Zähler und Vorschläge nach dem Neuverbinden nach (§20.9)', async () => {
    boot();
    const listeners = new Map<string, Set<(data: unknown) => void>>();
    const sync = {
      connectionState: 'online',
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(),
      onEvent: vi.fn((name: string, fn: (data: unknown) => void) => {
        const set = listeners.get(name) ?? new Set();
        set.add(fn);
        listeners.set(name, set);
        return () => void set.delete(fn);
      }),
    };
    const setState = (state: string) => {
      sync.connectionState = state;
      for (const fn of listeners.get('connection') ?? []) fn({ state, retryInMs: null, closeCode: null });
    };
    const { SyncProvider } = await import('../src/lib/sync/SyncProvider.tsx');
    const { unmount } = render(
      <ThemeProvider>
        <QueryProvider>
          <SyncProvider client={sync as never}>
            <ToastProvider>
              <SuggestionInbox />
            </ToastProvider>
          </SyncProvider>
        </QueryProvider>
      </ThemeProvider>,
    );
    await screen.findByText('Dritte Normalform');
    const overviews = () => core.requests.filter((r) => r.path === '/inbox/overview').length;
    const before = overviews();
    act(() => setState('backoff'));
    act(() => setState('online'));
    await waitFor(() => expect(overviews()).toBeGreaterThan(before));
    unmount();
    expect([...(listeners.get('connection') ?? [])]).toHaveLength(0);
  });
});

describe('Bibliothek', () => {
  function bootLibrary() {
    boot([]);
    core.concepts = [
      makeConceptDetail(
        { id: C_FA, name: 'Funktionale Abhängigkeit', aliases: ['FA'], exam_relevant: true },
        {
          evidence: [
            {
              id: id(601),
              ref: slideRef(14),
              session: SESSION,
              slide_title: 'Dritte Normalform',
              missing: false,
              quote: null,
              auto: false,
            },
            {
              id: id(602),
              ref: timeRef(2_532_000),
              session: SESSION,
              slide_title: null,
              missing: false,
              quote: 'Das ist <b>wichtig</b>.',
              auto: true,
            },
            {
              id: id(603),
              ref: slideRef(3),
              session: null,
              slide_title: null,
              missing: true,
              quote: null,
              auto: false,
            },
          ],
          relations: [
            {
              id: id(651),
              kind: 'baut_auf',
              direction: 'eingehend',
              other: { id: C_3NF, name: 'Dritte Normalform', status: 'aktiv' },
              source: 'ki',
              confidence: 0.9,
              cross_module: true,
            },
          ],
        },
      ),
      makeConceptDetail({ id: C_3NF, name: 'Dritte Normalform', one_liner: 'Ein Satz dazu.' }),
      makeConceptDetail({ id: C_BCNF, name: 'Verwaistes Konzept' }, { modules: [] }),
      makeConceptDetail(
        { id: id(805), name: 'Nur ein Vorschlag', status: 'vorschlag' },
        { inbox_item_id: I_NEW },
      ),
      makeConceptDetail({ id: id(806), name: 'Alte Hülle', status: 'zusammengefuehrt', merged_into: C_FA }),
    ];
  }

  it('listet aktive Konzepte je Modul, dazu „Ohne Fach“; die Suche fragt den Core', async () => {
    const user = userEvent.setup();
    bootLibrary();
    wrap(<LibraryView />);
    const dbs = await screen.findByRole('region', { name: /Datenbanksysteme/ });
    expect(within(dbs).getAllByRole('listitem')).toHaveLength(2);
    expect(within(dbs).getByRole('link', { name: 'Funktionale Abhängigkeit' })).toHaveAttribute(
      'href',
      `/bibliothek?konzept=${C_FA}`,
    );
    expect(within(dbs).getByText('3 Belege · 1 Vorlesung')).toBeInTheDocument();
    expect(within(dbs).getByText('Klausur')).toBeInTheDocument();
    const orphan = screen.getByRole('region', { name: /Ohne Fach/ });
    expect(within(orphan).getByRole('link', { name: 'Verwaistes Konzept' })).toBeInTheDocument();
    expect(screen.queryByText('Nur ein Vorschlag')).toBeNull();
    expect(screen.queryByText('Alte Hülle')).toBeNull();

    await user.type(screen.getByLabelText('Konzepte suchen'), 'dritte');
    await waitFor(() => expect(screen.queryByText('Funktionale Abhängigkeit')).toBeNull());
    expect(screen.getByRole('link', { name: 'Dritte Normalform' })).toBeInTheDocument();
    expect(core.requests.some((r) => r.path.startsWith('/concepts?') && r.path.includes('q=dritte'))).toBe(
      true,
    );
    await user.clear(screen.getByLabelText('Konzepte suchen'));
    await user.type(screen.getByLabelText('Konzepte suchen'), 'xyz');
    expect(await screen.findByText('Kein Konzept gefunden.')).toBeInTheDocument();
  });

  it('lädt alle Seiten; ab 2000 Konzepten sagt ein Satz, dass weitere nur über die Suche kommen', async () => {
    boot([]);
    core.concepts = Array.from({ length: 450 }, (_, i) =>
      makeConceptDetail({ id: id(10_000 + i), name: `Konzept ${String(i).padStart(4, '0')}` }),
    );
    const { unmount } = wrap(<LibraryView />);
    await screen.findByRole('link', { name: 'Konzept 0449' });
    const pages = core.requests.filter((r) => r.path.startsWith('/concepts?'));
    expect(pages).toHaveLength(3);
    expect(pages[2]?.path).toContain('cursor=400');
    expect(screen.queryByTestId('concepts-capped')).toBeNull();
    unmount();

    core.concepts = Array.from({ length: 2001 }, (_, i) =>
      makeConceptDetail({ id: id(20_000 + i), name: `Konzept ${String(i).padStart(4, '0')}` }),
    );
    wrap(<LibraryView />);
    expect(await screen.findByTestId('concepts-capped')).toHaveTextContent('nur die ersten 2000 Konzepte');
    expect(screen.queryByRole('link', { name: 'Konzept 2000' })).toBeNull();
  });

  it('ohne Konzepte ein Satz und der Weg zur Inbox', async () => {
    boot([]);
    core.concepts = [];
    wrap(<LibraryView />);
    expect(await screen.findByText(/Noch keine Konzepte/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zur Inbox' })).toHaveAttribute('href', '/inbox');
  });

  it('Konzeptansicht: Kopf, Belege als Kacheln, Beziehungen mit Fächerbrücke', async () => {
    bootLibrary();
    window.history.replaceState(null, '', `/bibliothek?konzept=${C_FA}`);
    wrap(<LibraryView />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Funktionale Abhängigkeit' }),
    ).toBeInTheDocument();
    expect(screen.getByText('FA')).toBeInTheDocument();
    const facts = screen.getByRole('list', { name: 'Einordnung' });
    expect(within(facts).getByRole('link', { name: 'Datenbanksysteme' })).toBeInTheDocument();
    expect(within(facts).getByText('Klausurrelevant')).toBeInTheDocument();
    expect(within(facts).getByText('Definition')).toBeInTheDocument();

    const evidence = screen.getByRole('region', { name: 'Belege' });
    expect(within(evidence).getByRole('link', { name: /Folie 14 · Dritte Normalform/ })).toHaveAttribute(
      'href',
      `/dokument?typ=folien&id=${DECK}&seite=14`,
    );
    const time = within(evidence).getByRole('link', { name: /42:12/ });
    expect(time).toHaveAttribute('href', `/rueckblick?id=${SESSION.id}&t=2532000`);
    expect(time).toHaveTextContent('▶');
    // Zitat als reiner Text
    expect(time).toHaveTextContent('„Das ist <b>wichtig</b>.“');
    expect(time.querySelector('b')).toBeNull();
    const missing = evidence.querySelector('[data-missing="true"]') as HTMLElement;
    expect(missing).toHaveTextContent('Folie 3 · nicht mehr vorhanden');
    expect(missing.closest('a')).toBeNull();

    const relations = screen.getByRole('region', { name: 'Beziehungen' });
    const group = within(relations).getByRole('region', { name: 'Grundlage für' });
    expect(within(group).getByRole('link', { name: 'Dritte Normalform' })).toHaveAttribute(
      'href',
      `/bibliothek?konzept=${C_3NF}`,
    );
    expect(within(group).getByText('Fächerbrücke')).toBeInTheDocument();
  });

  it('ohne Belege „Keine Belege mehr“; Vorschläge zeigen „Vorschlag · in der Inbox“', async () => {
    bootLibrary();
    window.history.replaceState(null, '', `/bibliothek?konzept=${id(805)}`);
    wrap(<LibraryView />);
    expect(await screen.findByText('Keine Belege mehr.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vorschlag · in der Inbox' })).toHaveAttribute('href', '/inbox');
    expect(screen.getByText('Noch keine Beziehungen.')).toBeInTheDocument();
  });

  it('Hüllen leiten auf `merged_into` weiter; ein unbekanntes Konzept wird ruhig gemeldet', async () => {
    bootLibrary();
    window.history.replaceState(null, '', `/bibliothek?konzept=${id(806)}`);
    const view = wrap(<LibraryView />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/bibliothek?konzept=${C_FA}`));
    expect(screen.getByRole('link', { name: 'Zum Konzept' })).toHaveAttribute(
      'href',
      `/bibliothek?konzept=${C_FA}`,
    );
    view.unmount();

    window.history.replaceState(null, '', `/bibliothek?konzept=${id(999)}`);
    wrap(<LibraryView />);
    expect(await screen.findByText('Dieses Konzept gibt es nicht (mehr).')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zur Bibliothek' })).toBeInTheDocument();
  });
});

describe('Einstellungen → KI', () => {
  async function openAi() {
    const user = userEvent.setup();
    wrap(<SettingsView />);
    await user.click(await screen.findByRole('tab', { name: 'KI' }));
    return { user, panel: document.getElementById('settings-panel-ki') as HTMLElement };
  }

  it('Status „Eingerichtet“, Budget, Kosten des Monats mit neutralem Balken', async () => {
    boot([]);
    core.costSummary = makeCostSummary({
      budget: { month: '2026-11', spent_eur: 1.84, budget_eur: 10, reached: false, warn: false },
      calls: 14,
      by_task: [
        { task: 'concepts.extract', calls: 5, eur: 1.21 },
        { task: 'summary.write', calls: 5, eur: 0.48 },
      ],
      by_session: [
        { session_id: SESSION.id, session: SESSION, calls: 3, eur: 0.37 },
        { session_id: id(77), session: null, calls: 1, eur: 0.1 },
      ],
    });
    const { panel } = await openAi();
    const state = await within(panel).findByTestId('ai-state');
    expect(state).toHaveAttribute('data-state', 'eingerichtet');
    expect(state).toHaveTextContent('Eingerichtet');
    // Nie ein Eingabefeld für den Schlüssel
    expect(panel.querySelector('input[type="password"]')).toBeNull();
    expect(within(panel).queryByLabelText(/Schlüssel|API/i)).toBeNull();

    expect(
      await within(panel).findByRole('heading', { name: 'Kosten im November 2026' }),
    ).toBeInTheDocument();
    const bar = within(panel).getByRole('progressbar', { name: 'Anteil am Monatsbudget' });
    expect(bar).toHaveAttribute('aria-valuenow', '18');
    expect(bar.innerHTML).not.toMatch(/danger|record|red/);
    const tasks = within(panel).getByRole('table', { name: 'Je Aufgabe' });
    expect(within(tasks).getByRole('row', { name: /Konzepte 5/ })).toBeInTheDocument();
    expect(within(tasks).getByRole('row', { name: /Zusammenfassung 5/ })).toBeInTheDocument();
    const sessions = within(panel).getByRole('table', { name: 'Teuerste Vorlesungen' });
    expect(within(sessions).getByRole('link', { name: 'VL 7 · Normalformen · DBS' })).toBeInTheDocument();
    expect(within(sessions).getByText('Gelöschte Vorlesung')).toBeInTheDocument();
  });

  it('„Nicht eingerichtet“ mit einem Satz, wie es geht', async () => {
    boot([]);
    core.aiStatus = makeAiStatus({
      llm: { provider: 'anthropic', configured: false, issue: 'kein_schluessel' },
    });
    const { panel } = await openAi();
    const state = await within(panel).findByTestId('ai-state');
    expect(state).toHaveTextContent('Nicht eingerichtet');
    expect(state).toHaveTextContent('~/StudienGehirn/config/.env');
    expect(state).toHaveTextContent('chmod 600');
  });

  it('speichert Budget und Automatik als Bereich `ai`; Hinweis bei „alles ab 90 %“', async () => {
    boot([]);
    const { user, panel } = await openAi();
    const budget = await within(panel).findByLabelText('Monatsbudget (€)');
    expect(budget).toHaveValue('10');
    await user.clear(budget);
    await user.type(budget, 'viel');
    expect(within(panel).getByText('Bitte einen Betrag von 0 bis 1000 eingeben.')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Speichern' })).toBeDisabled();
    await user.clear(budget);
    await user.type(budget, '12,5');
    expect(within(panel).queryByTestId('auto-accept-warning')).toBeNull();
    await user.selectOptions(within(panel).getByLabelText('Automatisch annehmen'), 'alles_ab_0_9');
    expect(within(panel).getByTestId('auto-accept-warning')).toHaveTextContent(/Selbstauskunft der KI/);
    await user.click(within(panel).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(core.settings.ai).toEqual({ monthly_budget_eur: 12.5, auto_accept: 'alles_ab_0_9' }),
    );
    const patch = core.requests.find((r) => r.method === 'PATCH' && r.path === '/settings');
    expect(patch?.body).toEqual({ ai: { monthly_budget_eur: 12.5, auto_accept: 'alles_ab_0_9' } });
    expect(toast()).toHaveTextContent('KI-Einstellungen gespeichert');
  });

  it('öffnet den Bereich direkt über `?bereich=ki`', async () => {
    boot([]);
    window.history.replaceState(null, '', '/einstellungen?bereich=ki');
    wrap(<SettingsView />);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'KI' })).toHaveAttribute('aria-selected', 'true'),
    );
  });
});
