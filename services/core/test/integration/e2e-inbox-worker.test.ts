// E2E-Test Inbox mit echtem Worker (Issue #324, Rest aus #176, Review von #179 / T2-22b).
//
// Die Inbox (VERTRAEGE §20.6) ist sonst je Seite getestet: Der Core mit eingefügten Vorschlägen (`inbox*.test.ts`),
// der Worker mit gemocktem Core (`services/worker/tests`). Dieser Test prüft die ganze Kette zusammen:
//
//   POST /sessions/{id}/reprocess  →  Job concepts.extract / concepts.resolve in derselben Postgres-Datenbank
//   →  echter Worker-Code (`support/drain_worker.py`: Worker.drain mit allen Handlern, KI und Embedder als Fake)
//   →  Vorschläge in der Inbox  →  annehmen, ablehnen, rückgängig, Bulk über die Core-API
//   →  Prüfung in der Datenbank und per API (Konzepte, Beziehungen, Belege, duplicate_of, inbox_reopen_conflict).
//
// Kein Netz, kein Schlüssel: `provider = fake` (deterministische Regeln, `llm_fake.py`), `SG_EMBEDDER=fake`.
// Die Namen sind erfunden. Der Worker braucht `uv` (CI: Job `integration`); ohne `uv` überspringt sich der Test lokal.
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ConceptDetailSchema,
  ConceptListSchema,
  CardListSchema,
  InboxBulkResultSchema,
  InboxDecisionResultSchema,
  InboxItemListSchema,
  ReviewQueueSchema,
  type InboxBulkResult,
  type InboxDecisionResult,
  type InboxItem,
} from '@sg/shared';
import { startTestApp, testDatabaseUrl, type TestApp } from './helpers.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { refId, World } from './inbox-helpers.ts';

const API = '/api/v1';
const WORKER_DIR = fileURLToPath(new URL('../../../worker', import.meta.url));
const DRAIN_SCRIPT = fileURLToPath(new URL('./support/drain_worker.py', import.meta.url));
const execFileAsync = promisify(execFile);

// Ohne uv überspringt sich der Test lokal. In der CI (CI=true) darf das nicht passieren: dort ist uv Pflicht.
const hasUv = spawnSync('uv', ['--version']).status === 0;
if (!hasUv && process.env.CI) throw new Error('uv fehlt: Der E2E-Test Inbox braucht den Worker (uv sync).');
const e2e = hasUv ? describe : describe.skip;

let app: TestApp;
let world: World;
let dataDir: string;

beforeAll(async () => {
  app = await startTestApp();
  world = new World(app.handle);
  dataDir = mkdtempSync(join(tmpdir(), 'sg-e2e-inbox-'));
});
afterAll(async () => {
  await world.reset();
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});
beforeEach(async () => {
  await world.reset();
});

// --- Hilfen ------------------------------------------------------------------------------------------------

/** Arbeitet alle fälligen Jobs mit dem echten Worker-Code ab (eigener Prozess, gleiche Datenbank wie der Core). */
async function drainWorker(): Promise<number> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('ANTHROPIC_')),
  ) as NodeJS.ProcessEnv;
  const { stdout } = await execFileAsync(
    'uv',
    ['run', '--locked', '--project', WORKER_DIR, 'python', DRAIN_SCRIPT, testDatabaseUrl(), dataDir],
    { env: { ...env, SG_LLM: 'fake', SG_EMBEDDER: 'fake' }, timeout: 45_000 },
  );
  return Number(stdout.trim().split('\n').at(-1));
}

/**
 * Legt eine beendete Vorlesung mit Folien (Titel = Konzept, der Fake nimmt je Folientitel eins) an, stößt die
 * Konzept-Kette über die API an und lässt den Worker laufen. Gibt die Session-ID zurück.
 */
async function lecture(ref: string, titles: string[], number: number): Promise<string> {
  await world.deck(
    `d-${ref}`,
    titles.map((title, i) => ({ ref: `${ref}-f${i + 1}`, index: i + 1, title })),
  );
  const id = await world.session(ref, {
    slideDeckId: refId(`d-${ref}`),
    state: 'beendet',
    number,
    startedAt: new Date('2026-11-05T10:00:00Z'),
    endedAt: new Date('2026-11-05T11:30:00Z'),
  });
  const res = await app.request({
    method: 'POST',
    url: `${API}/sessions/${id}/reprocess`,
    payload: { from_step: 'concepts.extract' },
  });
  expect(res.statusCode, res.body).toBe(202);
  expect(await drainWorker()).toBe(4); // concepts.extract, concepts.resolve, summary.write, cards.generate (§21.3)
  const states = await app.handle
    .sql`SELECT type, state, error FROM job WHERE session_id = ${id} ORDER BY type`;
  expect(states.map((j) => [j.type, j.state, j.error])).toEqual([
    ['cards.generate', 'fertig', null],
    ['concepts.extract', 'fertig', null],
    ['concepts.resolve', 'fertig', null],
    ['summary.write', 'fertig', null],
  ]);
  return id;
}

/** Die Einträge zu Konzepten und Beziehungen (Kartenvorschläge nur mit `kinds = ['card_batch']`) */
async function inbox(status = 'offen', kinds: string[] = ['concept_new', 'concept_merge', 'relation']) {
  const kind = kinds.map((k) => `&kind=${k}`).join('');
  const res = await app.request({ method: 'GET', url: `${API}/inbox?status=${status}&limit=100${kind}` });
  expect(res.statusCode, res.body).toBe(200);
  return InboxItemListSchema.parse(res.json()).items;
}

/** Namen der Konzepte nach ID (alle Status), für lesbare Beziehungen */
async function conceptNames(): Promise<Map<string, string>> {
  const rows = await app.handle.sql`SELECT id, name FROM concept`;
  return new Map(rows.map((row) => [row.id as string, row.name as string]));
}

/** Kurzform eines Eintrags: „concept_new Relation“, „concept_merge A => B“, „relation A baut_auf B“ */
async function labels(items: InboxItem[]): Promise<string[]> {
  const names = await conceptNames();
  return items.map((item) => {
    const p = item.payload;
    if (p.kind === 'relation') {
      return `relation ${names.get(p.from_concept_id)} ${p.relation_kind} ${names.get(p.to_concept_id)}`;
    }
    if (p.kind === 'concept_merge') return `concept_merge ${p.proposal.name} => ${p.target.name}`;
    if (p.kind === 'card_batch') return `card_batch ${names.get(p.concept_id)}`;
    return `concept_new ${p.proposal.name}`;
  });
}

async function find(label: string, status = 'offen'): Promise<InboxItem> {
  const items = await inbox(status);
  const all = await labels(items);
  const index = all.indexOf(label);
  if (index < 0) throw new Error(`Eintrag „${label}“ fehlt, vorhanden: ${all.join(' | ')}`);
  return items[index]!;
}

const post = (path: string, payload?: unknown) =>
  app.request({
    method: 'POST',
    url: `${API}${path}`,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

function ok(res: { statusCode: number; body: string; json: () => unknown }): InboxDecisionResult {
  expect(res.statusCode, res.body).toBe(200);
  return InboxDecisionResultSchema.parse(res.json());
}
const accept = async (item: InboxItem, body: unknown = {}) =>
  ok(await post(`/inbox/${item.id}/accept`, body));
const reject = async (item: InboxItem) => ok(await post(`/inbox/${item.id}/reject`));
const reopen = (item: InboxItem) => post(`/inbox/${item.id}/reopen`);

async function bulk(payload: unknown): Promise<InboxBulkResult> {
  const res = await post('/inbox/bulk', payload);
  expect(res.statusCode, res.body).toBe(200);
  return InboxBulkResultSchema.parse(res.json());
}

async function conceptByName(name: string) {
  const res = await app.request({
    method: 'GET',
    url: `${API}/concepts?status=aktiv&q=${encodeURIComponent(name)}`,
  });
  expect(res.statusCode, res.body).toBe(200);
  const hit = ConceptListSchema.parse(res.json()).items.find((entry) => entry.concept.name === name);
  if (!hit) throw new Error(`Konzept „${name}“ nicht aktiv`);
  const detail = await app.request({ method: 'GET', url: `${API}/concepts/${hit.concept.id}` });
  expect(detail.statusCode, detail.body).toBe(200);
  return ConceptDetailSchema.parse(detail.json());
}

async function conceptRow(name: string) {
  const [row] = await app.handle
    .sql`SELECT id, status, merged_into, aliases FROM concept WHERE name = ${name}`;
  return row!;
}

async function relationRows() {
  const names = await conceptNames();
  const rows = await app.handle.sql`SELECT id, from_id, to_id, kind, confirmed FROM concept_relation
    WHERE deleted_at IS NULL`;
  return rows
    .map((row) => ({
      id: row.id as string,
      text: `${names.get(row.from_id as string)} ${row.kind} ${names.get(row.to_id as string)}`,
      confirmed: row.confirmed as boolean,
    }))
    .sort((a, b) => a.text.localeCompare(b.text));
}

const SESSION_1 = ['Relation', 'Schlüssel', 'Normalisierung'];
// Zweite Vorlesung: „Schlüssel“ ist schon aktiv (Beleg ohne Vorschlag), „Normalisierung (Datenbanken)“ gleicht dem
// aktiven „Normalisierung“ (der Fake urteilt „gleich“ → Zusammenführen), „Tupel“ ist neu.
// Die Ähnlichkeit ist exakt, nicht zufällig: Der Fake-Embedder zählt Wörter (gehasht, ±1) im Text „Name, Aliase,
// Einzeiler“, der Fake-Einzeiler ist „Erfundene Erklärung zu <Name>.“. Wortzähler (2,2,1,1,1) gegen (2,0,1,1,1) ergeben
// 7/√77 ≈ 0,7977, mit Abstand zu beiden Bandgrenzen SIM_MIN 0,75 und SIM_AUTO 0,88 (concepts_resolve.py).
const SESSION_2 = ['Schlüssel', 'Normalisierung (Datenbanken)', 'Tupel'];

// --- Tests -------------------------------------------------------------------------------------------------

e2e('Inbox mit echtem Worker (Fake-KI, Fake-Embedder)', { timeout: 90_000 }, () => {
  it('Worker legt Vorschläge und Beziehungen an, ohne etwas zu bestätigen; nur Fake-Kosten', async () => {
    const s1 = await lecture('s1', SESSION_1, 1);

    const items = await inbox();
    expect(await labels(items)).toEqual([
      'concept_new Relation',
      'concept_new Schlüssel',
      'concept_new Normalisierung',
      'relation Schlüssel baut_auf Relation',
      'relation Normalisierung baut_auf Schlüssel',
    ]);
    // Beziehungen warten auf ihre Endpunkte (§20.6), alle Einträge gehören zur Session
    expect(items.map((item) => item.blocked)).toEqual([null, null, null, 'endpunkt_offen', 'endpunkt_offen']);
    expect(new Set(items.map((item) => item.session?.id))).toEqual(new Set([s1]));
    expect(items[0]!.payload).toMatchObject({
      kind: 'concept_new',
      model: 'fake-llm-1',
      prompt_version: 'concepts.extract/v1',
      proposal: { name: 'Relation', one_liner: 'Erfundene Erklärung zu Relation.' },
      evidence: [{ kind: 'slide', slide_index: 1 }],
    });

    // Datenbank: nur Vorschläge, nichts bestätigt, mit Vektoren erst bei aktiven Konzepten
    const concepts = await app.handle.sql`SELECT status, proposal_session_id FROM concept`;
    expect(concepts.map((c) => [c.status, c.proposal_session_id])).toEqual([
      ['vorschlag', s1],
      ['vorschlag', s1],
      ['vorschlag', s1],
    ]);
    expect((await relationRows()).map((r) => r.confirmed)).toEqual([false, false]);
    // Belege hängen als Entwurf an den Vorschlägen (payload.evidence) und in `evidence`; nichts ist bestätigt
    expect(await app.handle.sql`SELECT 1 FROM evidence`).toHaveLength(3);

    // Kosten: nur Fake, 0 €, ohne Schlüssel (extract + resolve + summary). `cost_entry` hat keinen FK und wird von
    // `world.reset()` nicht geleert; andere Testdateien derselben Datenbank schreiben auch hinein. Darum nach Session.
    const costs = await app.handle
      .sql`SELECT provider, model, task, cost_estimate_eur FROM cost_entry WHERE session_id = ${s1} ORDER BY task`;
    expect(costs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(costs.map((c) => `${c.provider}/${c.model}`))).toEqual(new Set(['fake/fake-llm-1']));
    expect(costs.every((c) => Number(c.cost_estimate_eur) === 0)).toBe(true);
  });

  it('Annehmen, Zusammenführen mit duplicate_of, inbox_reopen_conflict und Rückgängig über zwei Vorlesungen', async () => {
    // --- Vorlesung 1: alles annehmen (Bulk) ---
    const s1 = await lecture('s1', SESSION_1, 1);
    const accepted = await bulk({ action: 'accept', session_id: s1 });
    expect(accepted.skipped).toEqual([]);
    // 3 Konzepte, 2 Beziehungen und danach die drei dann sichtbaren Kartenvorschläge (§21.7)
    expect(accepted.decided).toHaveLength(8);

    expect((await conceptRow('Normalisierung')).status).toBe('aktiv');
    expect((await relationRows()).map((r) => `${r.text}:${r.confirmed}`)).toEqual([
      'Normalisierung baut_auf Schlüssel:true',
      'Schlüssel baut_auf Relation:true',
    ]);
    const key = await conceptByName('Schlüssel');
    expect(key.concept.status).toBe('aktiv');
    expect(key.evidence).toHaveLength(1);
    expect(key.relations.map((r) => `${r.direction} ${r.kind} ${r.other.name}`).sort()).toEqual([
      'ausgehend baut_auf Relation',
      'eingehend baut_auf Normalisierung',
    ]);
    const normalisierungId = (await conceptRow('Normalisierung')).id as string;

    // --- Vorlesung 2: Worker gleicht gegen das Wissensnetz ab (Vektoren der aktiven Konzepte werden nachgeholt) ---
    const s2 = await lecture('s2', SESSION_2, 2);
    expect(await labels(await inbox())).toEqual([
      'concept_merge Normalisierung (Datenbanken) => Normalisierung',
      'concept_new Tupel',
      'relation Normalisierung (Datenbanken) baut_auf Schlüssel',
      'relation Tupel baut_auf Normalisierung (Datenbanken)',
    ]);
    // „Schlüssel“ hat keinen Vorschlag, aber einen automatischen Beleg aus Vorlesung 2
    const keyAgain = await conceptByName('Schlüssel');
    expect(keyAgain.evidence).toHaveLength(2);
    expect(keyAgain.evidence.filter((e) => e.auto).map((e) => e.session?.id)).toEqual([s2]);

    const merge = await find('concept_merge Normalisierung (Datenbanken) => Normalisierung');
    expect(merge.payload).toMatchObject({
      kind: 'concept_merge',
      basis: 'ki',
      target: { concept_id: normalisierungId },
    });
    const tupel = await find('concept_new Tupel');
    const relDuplicate = await find('relation Normalisierung (Datenbanken) baut_auf Schlüssel');
    const relTupel = await find('relation Tupel baut_auf Normalisierung (Datenbanken)');
    expect(relTupel.blocked).toBe('endpunkt_offen');
    const beforeMerge = await world.snapshot();

    // --- Zusammenführen: Beziehung wird zur Dublette der bestätigten, ihr Eintrag wird mit duplicate_of abgelehnt ---
    const merged = await accept(merge);
    expect(merged.concept).toMatchObject({ id: normalisierungId, status: 'aktiv' });
    expect(merged.concept!.aliases).toEqual(['Normalisierung (Datenbanken)']);
    expect(await conceptRow('Normalisierung (Datenbanken)')).toMatchObject({
      status: 'zusammengefuehrt',
      merged_into: normalisierungId,
    });
    const confirmedRelation = (await relationRows()).find(
      (r) => r.text === 'Normalisierung baut_auf Schlüssel',
    )!;
    expect(confirmedRelation.confirmed).toBe(true);

    const duplicate = await app.handle
      .sql`SELECT status, decision FROM inbox_item WHERE id = ${relDuplicate.id}`;
    expect(duplicate[0]).toMatchObject({
      status: 'abgelehnt',
      decision: { action: 'abgelehnt', duplicate_of: confirmedRelation.id, triggered_by: merge.id },
    });
    const mergeDecision = (await app.handle.sql`SELECT decision FROM inbox_item WHERE id = ${merge.id}`)[0]!
      .decision;
    expect([...mergeDecision.cascade_item_ids].sort()).toEqual([relDuplicate.id, relTupel.id].sort());
    // Die zweite Beziehung hängt jetzt am Ziel und wartet weiter auf „Tupel“
    const relTupelNow = await find('relation Tupel baut_auf Normalisierung');
    expect(relTupelNow.id).toBe(relTupel.id);
    expect(relTupelNow.blocked).toBe('endpunkt_offen');

    // --- inbox_reopen_conflict: der Folge-Eintrag lässt sich nur über seinen Auslöser öffnen ---
    const direct = await reopen(relDuplicate);
    expect(direct.statusCode).toBe(409);
    expect(direct.json().error).toMatchObject({
      code: 'inbox_reopen_conflict',
      details: { triggered_by: merge.id },
    });

    // --- „Tupel“ und die umgehängte Beziehung annehmen: Rückgängig der Zusammenführung scheitert jetzt ---
    await accept(tupel);
    await accept(relTupelNow);
    expect((await relationRows()).find((r) => r.text === 'Tupel baut_auf Normalisierung')?.confirmed).toBe(
      true,
    );
    const blocked = await reopen(merge);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('inbox_reopen_conflict');

    // --- Erst die Beziehung zurück, dann die Zusammenführung (Bulk in umgekehrter Reihenfolge, wie der Toast) ---
    const undone = await bulk({ action: 'reopen', ids: [relTupelNow.id, merge.id] });
    expect(undone.skipped).toEqual([]);
    // Zusammen mit der Zusammenführung geht auch die als Dublette abgelehnte Beziehung wieder auf
    expect([...undone.decided].sort()).toEqual([relTupelNow.id, merge.id, relDuplicate.id].sort());
    expect(await conceptRow('Normalisierung (Datenbanken)')).toMatchObject({
      status: 'vorschlag',
      merged_into: null,
    });
    expect((await conceptRow('Normalisierung')).aliases).toEqual([]);
    expect(await labels(await inbox())).toContain('relation Normalisierung (Datenbanken) baut_auf Schlüssel');
    // „Tupel“ bleibt angenommen, sonst ist der Zustand wie vor dem Zusammenführen
    expect((await conceptRow('Tupel')).status).toBe('aktiv');
    const afterUndo = (await world.snapshot()) as { concepts: { name: string; status: string }[] };
    const beforeUndo = beforeMerge as typeof afterUndo;
    const withoutTupel = <T extends { name: string }>(rows: T[]) =>
      rows.filter((row) => row.name !== 'Tupel');
    expect(withoutTupel(afterUndo.concepts).map((row) => [row.name, row.status])).toEqual(
      withoutTupel(beforeUndo.concepts).map((row) => [row.name, row.status]),
    );
  });

  it('Ablehnen nimmt die Beziehungen mit, Rückgängig öffnet sie; Bulk reject/reopen/accept mit session_id', async () => {
    const s1 = await lecture('s1', SESSION_1, 1);
    const initial = await world.snapshot();

    // Ablehnen eines Konzepts: seine beiden Beziehungen gehen als Folge mit
    const key = await find('concept_new Schlüssel');
    const rejected = await reject(key);
    expect(rejected.item.status).toBe('abgelehnt');
    expect(rejected.concept).toMatchObject({ name: 'Schlüssel', status: 'vorschlag' });
    const stillOpen = await labels(await inbox());
    expect(stillOpen).toEqual(['concept_new Relation', 'concept_new Normalisierung']);
    const followUp = await find('relation Schlüssel baut_auf Relation', 'entschieden');
    expect(followUp.status).toBe('abgelehnt');
    const direct = await reopen(followUp);
    expect(direct.statusCode).toBe(409);
    expect(direct.json().error).toMatchObject({
      code: 'inbox_reopen_conflict',
      details: { triggered_by: key.id },
    });

    ok(await reopen(key));
    expect(await world.snapshot()).toEqual(initial);
    // zweimal Rückgängig ändert nichts
    const twice = await reopen(key);
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error.code).toBe('inbox_item_not_decided');
    expect(await world.snapshot()).toEqual(initial);

    // Bulk reject der ganzen Vorlesung, dann reopen: wieder alles wie zu Beginn
    const all = await bulk({ action: 'reject', session_id: s1 });
    expect(all.skipped).toEqual([]);
    expect(all.decided).toHaveLength(8); // die Kartenvorschläge verfallen mit ihren Konzepten
    expect(await inbox()).toHaveLength(0);
    expect((await bulk({ action: 'reopen', session_id: s1 })).decided).toHaveLength(8);
    expect(await world.snapshot()).toEqual(initial);

    // Ein Konzept ablehnen, den Rest der Vorlesung annehmen: die Beziehungen am abgelehnten Konzept bleiben außen vor
    await reject(await find('concept_new Normalisierung'));
    const rest = await bulk({ action: 'accept', session_id: s1 });
    expect(rest.skipped).toEqual([]);
    // Relation, Schlüssel, Schlüssel baut_auf Relation und die Kartenvorschläge zu Relation und Schlüssel
    expect(rest.decided).toHaveLength(5);
    expect((await relationRows()).map((r) => `${r.text}:${r.confirmed}`)).toEqual([
      'Normalisierung baut_auf Schlüssel:false',
      'Schlüssel baut_auf Relation:true',
    ]);
    expect((await conceptRow('Normalisierung')).status).toBe('vorschlag');
    expect((await conceptRow('Relation')).status).toBe('aktiv');
  });

  it('Karten: Konzept annehmen → Kartenvorschlag sichtbar → Karten annehmen → Warteschlange; Verfall, Rückgängig und reprocess', async () => {
    const s1 = await lecture('s1', SESSION_1, 1);

    // Karten entstehen für alle Konzepte der Session, sind aber erst mit aktivem Konzept sichtbar (§21.3, §21.7)
    const hidden = await app.handle
      .sql`SELECT count(*)::int AS n FROM inbox_item WHERE kind = 'card_batch' AND status = 'offen'`;
    expect(hidden[0]!.n).toBe(3);
    expect(await inbox('offen', ['card_batch'])).toEqual([]);
    const queueBefore = ReviewQueueSchema.parse(
      (await app.request({ method: 'GET', url: `${API}/review/queue` })).json(),
    );
    expect(queueBefore).toMatchObject({ items: [], has_cards: false });

    // Konzept „Relation“ annehmen: sein Kartenvorschlag wird sichtbar, die anderen nicht, und er wird nicht mit angenommen
    const relation = await find('concept_new Relation');
    await accept(relation);
    const batches = await inbox('offen', ['card_batch']);
    expect(await labels(batches)).toEqual(['card_batch Relation']);
    const batch = batches[0]!;
    expect(batch.session?.id).toBe(s1);
    expect(batch.concept_id).toBeNull();
    expect(batch.payload).toMatchObject({
      kind: 'card_batch',
      model: 'fake-llm-1',
      prompt_version: 'cards.generate/v1',
      concept_name: 'Relation',
      // Fake (§21.6): zwei Karten, beide mit dem ersten Beleg
      cards: [
        {
          key: 'k1',
          content: { kind: 'basic', front: { text_md: 'Was ist Relation?' } },
          sources: [{ kind: 'slide', slide_index: 1 }],
        },
        {
          key: 'k2',
          content: { kind: 'cloze', front: { text_md: '{{c1::Relation}} ist ein Thema dieser Vorlesung.' } },
          sources: [{ kind: 'slide', slide_index: 1 }],
        },
      ],
    });
    const overview = await app.request({ method: 'GET', url: `${API}/inbox/overview` });
    // 2 Konzepte, 2 Beziehungen und 1 sichtbarer Kartenvorschlag
    expect(overview.json().open_count).toBe(5);

    // Vor dem Konzept kann man die Karten eines anderen Vorschlags nicht annehmen
    const [hiddenBatch] = await app.handle
      .sql`SELECT i.id FROM inbox_item i JOIN concept c ON c.id = i.card_concept_id
      WHERE i.kind = 'card_batch' AND c.name = 'Schlüssel'`;
    const pending = await post(`/inbox/${hiddenBatch!.id}/accept`);
    expect(pending.statusCode).toBe(409);
    expect(pending.json().error.code).toBe('card_concept_pending');

    // Karte k1 bearbeiten, k2 verwerfen
    const accepted = await accept(batch, {
      cards: [
        {
          key: 'k1',
          accept: true,
          content: {
            kind: 'basic',
            front: { text_md: 'Was ist eine Relation?' },
            back: { text_md: 'Eine Menge von Tupeln.', explanation_md: null },
          },
        },
        { key: 'k2', accept: false },
      ],
    });
    expect(accepted.concept).toBeNull();
    expect(accepted.cards).toHaveLength(1);
    const card = accepted.cards![0]!;
    expect(card).toMatchObject({
      origin: 'ki',
      content: { front: { text_md: 'Was ist eine Relation?' } },
      sources: [{ ref: { kind: 'slide', slide_index: 1 }, missing: false }],
    });
    const conceptCards = CardListSchema.parse(
      (await app.request({ method: 'GET', url: `${API}/concepts/${card.concept_id}/cards` })).json(),
    );
    expect(conceptCards.items.map((c) => c.id)).toEqual([card.id]);

    // Die Karte steht in der heutigen Warteschlange (neu, fällig sofort)
    const queue = ReviewQueueSchema.parse(
      (await app.request({ method: 'GET', url: `${API}/review/queue` })).json(),
    );
    expect(queue.has_cards).toBe(true);
    expect(queue.items.map((item) => [item.card.id, item.concept.name, item.group])).toEqual([
      [card.id, 'Relation', 'neu'],
    ]);

    // reprocess mit from_step cards.generate legt einen Job an (nur diesen); der Worker erzeugt für „Relation“
    // nichts Neues, weil der Eintrag entschieden ist (skipped_decided), und für die offenen Konzepte dasselbe wie vorher
    const reprocess = await post(`/sessions/${s1}/reprocess`, { from_step: 'cards.generate' });
    expect(reprocess.statusCode, reprocess.body).toBe(202);
    expect(reprocess.json().jobs.map((j: { type: string }) => j.type)).toEqual(['cards.generate']);
    expect(await drainWorker()).toBe(1);
    expect(await inbox('offen', ['card_batch'])).toHaveLength(0);
    const decidedBatches = await inbox('entschieden', ['card_batch']);
    expect(decidedBatches.map((i) => i.id)).toEqual([batch.id]);
    expect(await app.handle.sql`SELECT 1 FROM card`).toHaveLength(1);

    // A1 zurücknehmen scheitert, solange das Konzept Karten hat (§21.7); erst die Karten, dann das Konzept
    const blocked = await reopen(relation);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('inbox_reopen_conflict');
    expect((await reopen(batch)).statusCode).toBe(200);
    expect(await app.handle.sql`SELECT 1 FROM card`).toHaveLength(0);
    expect((await reopen(relation)).statusCode).toBe(200);
    expect(await inbox('offen', ['card_batch'])).toEqual([]);
    expect((await conceptRow('Relation')).status).toBe('vorschlag');

    // Konzept ablehnen: sein Kartenvorschlag verfällt mit; Rückgängig öffnet ihn wieder
    const rejected = await reject(await find('concept_new Relation'));
    expect(rejected.item.status).toBe('abgelehnt');
    const [verfallen] = await app.handle.sql`SELECT i.status, i.decision FROM inbox_item i
      JOIN concept c ON c.id = i.card_concept_id WHERE i.kind = 'card_batch' AND c.name = 'Relation'`;
    expect(verfallen).toMatchObject({
      status: 'abgelehnt',
      decision: { action: 'abgelehnt', triggered_by: relation.id },
    });
    ok(await post(`/inbox/${relation.id}/reopen`));
    const [wieder] = await app.handle.sql`SELECT i.status FROM inbox_item i
      JOIN concept c ON c.id = i.card_concept_id WHERE i.kind = 'card_batch' AND c.name = 'Relation'`;
    expect(wieder!.status).toBe('offen');
  });

  it('Karten: Konzept annehmen → Karten annehmen → Warteschlange → eine Bewertung → Karte ist nicht mehr fällig', async () => {
    await lecture('s1', SESSION_1, 1);
    await accept(await find('concept_new Relation'));
    const [batch] = await inbox('offen', ['card_batch']);
    const accepted = await accept(batch!, {});
    expect(accepted.cards).toHaveLength(2);

    const queueUrl = `${API}/review/queue`;
    const before = ReviewQueueSchema.parse((await app.request({ method: 'GET', url: queueUrl })).json());
    expect(before.items).toHaveLength(2);
    const card = before.items[0]!.card;

    // „Leicht“ (4) schickt eine neue Karte über den Tageswechsel hinaus (06 §1); die andere bleibt dran
    const review = await post(`/cards/${card.id}/review`, { id: uuidv7(), rating: 4, duration_ms: 3000 });
    expect(review.statusCode, review.body).toBe(200);
    expect(review.json().requeue).toBe(false);

    const after = ReviewQueueSchema.parse((await app.request({ method: 'GET', url: queueUrl })).json());
    expect(after.items.map((item) => item.card.id)).not.toContain(card.id);
    expect(after.items).toHaveLength(1);
    expect(after.reviewed_today).toBe(1);
  });

  // Nachträglich angelegtes Material: keine Aufnahme, kein started_at/ended_at. Früher scheiterte `concepts.extract` hier
  // mit „TypeError: 'int' object is not iterable“ (`align_log._timeline_end`: `max(0, *[])`, gefunden in #330).
  it('Session ohne Aufnahme und ohne Zeiten: die Konzept-Kette läuft durch, Vorschläge aus den Folien', async () => {
    await world.deck(
      'd-s1',
      SESSION_1.map((title, i) => ({ ref: `f${i}`, index: i + 1, title })),
    );
    const id = await world.session('s1', { slideDeckId: refId('d-s1'), state: 'beendet', number: 1 });
    const res = await post(`/sessions/${id}/reprocess`, { from_step: 'concepts.extract' });
    expect(res.statusCode, res.body).toBe(202);
    expect(await drainWorker()).toBe(4);
    const states = await app.handle
      .sql`SELECT type, state, error FROM job WHERE session_id = ${id} ORDER BY type`;
    expect(states.map((j) => [j.type, j.state, j.error])).toEqual([
      ['cards.generate', 'fertig', null],
      ['concepts.extract', 'fertig', null],
      ['concepts.resolve', 'fertig', null],
      ['summary.write', 'fertig', null],
    ]);
    const items = await inbox();
    expect(await labels(items)).toEqual([
      'concept_new Relation',
      'concept_new Schlüssel',
      'concept_new Normalisierung',
      'relation Schlüssel baut_auf Relation',
      'relation Normalisierung baut_auf Schlüssel',
    ]);
    // Ohne Zeitleiste nur Folien-Belege
    for (const item of items) {
      if (item.payload.kind === 'concept_new') {
        expect(item.payload.evidence.map((e) => e.kind)).toEqual(['slide']);
      }
    }
  });
});
