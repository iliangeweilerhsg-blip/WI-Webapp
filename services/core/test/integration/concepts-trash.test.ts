// T2-22a: Papierkorb-Kanten für Konzepte, Inbox und Zusammenfassung (VERTRAEGE §20.8) und der Hook beim
// Wiederherstellen: Kollidierende unbestätigte Beziehungen und Belege einer Session werden hart gelöscht statt
// `409 restore_conflict`. Echte Datenbank, die Tests schreiben Vorschläge selbst in die Tabellen.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID, type InboxPayload, type TrashKind } from '@sg/shared';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import {
  concept,
  conceptModule,
  conceptRelation,
  courseModule,
  evidence,
  inboxItem,
  notebook,
  semester,
  session,
  sessionSummary,
  slide,
  slideDeck,
} from '../../src/db/schema/index.ts';
import { HttpError } from '../../src/errors.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { listTrash } from '../../src/services/trash-ops.ts';
import { CHILDREN, restoreFromTrash, softDelete } from '../../src/services/trash.ts';
import { testDatabaseUrl } from './helpers.ts';

let handle: DbHandle;
const base = { userId: SINGLE_USER_ID };

beforeAll(() => {
  handle = createDb(testDatabaseUrl());
});
afterAll(async () => {
  await truncate();
  await handle.close();
});
beforeEach(truncate);

async function truncate() {
  await handle.sql`TRUNCATE semester, module, calendar_source, calendar_event, session, slide_deck,
    exercise_sheet, notebook, concept CASCADE`;
}

const del = (kind: TrashKind, id: string) => handle.db.transaction((tx) => softDelete(tx, kind, id));
const restore = (id: string) => handle.db.transaction((tx) => restoreFromTrash(tx, id));

/** `deleted_at` als Text je ID. Fehlt die Zeile (hart gelöscht), fehlt der Schlüssel */
async function deletedAt(table: string, ids: string[]): Promise<Record<string, string | null>> {
  const rows =
    await handle.sql`SELECT id, deleted_at::text AS d FROM ${handle.sql(table)} WHERE id = ANY(${ids})`;
  return Object.fromEntries(rows.map((r) => [r.id as string, (r.d as string | null) ?? null]));
}
const stampOf = async (table: string, id: string) => (await deletedAt(table, [id]))[id];
const exists = async (table: string, id: string) => id in (await deletedAt(table, [id]));

async function errorOf(promise: Promise<unknown>): Promise<HttpError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

const payload = (kind: 'concept_new' | 'relation') => ({ kind }) as unknown as InboxPayload;
const HASH = 'a'.repeat(64);

/**
 * Ein Modul mit zwei Sessions. Session `s1` trägt alles, was §20.8 nennt: einen Vorschlag, eine Hülle, eine
 * unbestätigte Beziehung zwischen zwei aktiven Konzepten, Belege, Inbox-Einträge und eine Zusammenfassung.
 * Daneben angenommenes Wissen, das bleiben muss: zwei aktive Konzepte, eine bestätigte Beziehung, ein Beleg aus `s2`.
 */
async function seed() {
  const ids = {
    semester: uuidv7(),
    module: uuidv7(),
    deck: uuidv7(),
    slide: uuidv7(),
    s1: uuidv7(),
    s2: uuidv7(),
    active: uuidv7(),
    active2: uuidv7(),
    proposal: uuidv7(),
    shell: uuidv7(),
    cmActive: uuidv7(),
    cmProposal: uuidv7(),
    relProposed: uuidv7(),
    relConfirmed: uuidv7(),
    evActiveS1: uuidv7(),
    evProposalS1: uuidv7(),
    evActiveS2: uuidv7(),
    inboxConcept: uuidv7(),
    inboxRelation: uuidv7(),
    summary: uuidv7(),
  };
  // Symmetrische Art `verwandt` verlangt from_id < to_id
  const [lo, hi] = [ids.active, ids.active2].sort() as [string, string];
  const db = handle.db;
  await db.insert(semester).values({ id: ids.semester, ...base, name: 'HS 2026' });
  await db
    .insert(courseModule)
    .values({ id: ids.module, ...base, semesterId: ids.semester, name: 'Testmodul', color: 'mod-01' });
  await db
    .insert(slideDeck)
    .values({ id: ids.deck, ...base, moduleId: ids.module, title: 'Satz 1', filePath: 'p', sha256: HASH });
  await db
    .insert(slide)
    .values({ id: ids.slide, ...base, deckId: ids.deck, index: 1, widthPt: 1, heightPt: 1 });
  await db.insert(session).values([
    { id: ids.s1, ...base, moduleId: ids.module, state: 'verarbeitet' },
    { id: ids.s2, ...base, moduleId: ids.module, state: 'verarbeitet' },
  ]);
  await db.insert(concept).values([
    { id: ids.active, ...base, name: 'Begriff A', status: 'aktiv' },
    { id: ids.active2, ...base, name: 'Begriff B', status: 'aktiv' },
    { id: ids.proposal, ...base, name: 'Begriff C', status: 'vorschlag', proposalSessionId: ids.s1 },
  ]);
  await db.insert(concept).values({
    id: ids.shell,
    ...base,
    name: 'Begriff A (alt)',
    status: 'zusammengefuehrt',
    mergedInto: ids.active,
    proposalSessionId: ids.s1,
  });
  await db.insert(conceptModule).values([
    { id: ids.cmActive, ...base, conceptId: ids.active, moduleId: ids.module },
    { id: ids.cmProposal, ...base, conceptId: ids.proposal, moduleId: ids.module },
  ]);
  await db.insert(conceptRelation).values([
    {
      id: ids.relProposed,
      ...base,
      fromId: lo,
      toId: hi,
      kind: 'verwandt',
      source: 'ki',
      confirmed: false,
      proposalSessionId: ids.s1,
    },
    {
      id: ids.relConfirmed,
      ...base,
      fromId: ids.active,
      toId: ids.active2,
      kind: 'baut_auf',
      source: 'ki',
      confirmed: true,
    },
  ]);
  await db.insert(evidence).values([
    {
      id: ids.evActiveS1,
      ...base,
      conceptId: ids.active,
      sessionId: ids.s1,
      kind: 'slide',
      refId: ids.slide,
    },
    {
      id: ids.evProposalS1,
      ...base,
      conceptId: ids.proposal,
      sessionId: ids.s1,
      kind: 'transcript',
      refId: ids.s1,
      tStartMs: 1000,
      tEndMs: 5000,
    },
    {
      id: ids.evActiveS2,
      ...base,
      conceptId: ids.active,
      sessionId: ids.s2,
      kind: 'slide',
      refId: ids.slide,
    },
  ]);
  await db.insert(inboxItem).values([
    {
      id: ids.inboxConcept,
      ...base,
      kind: 'concept_new',
      sessionId: ids.s1,
      payload: payload('concept_new'),
      conceptId: ids.proposal,
    },
    {
      id: ids.inboxRelation,
      ...base,
      kind: 'relation',
      sessionId: ids.s1,
      payload: payload('relation'),
      relationId: ids.relProposed,
    },
  ]);
  await db.insert(sessionSummary).values({
    id: ids.summary,
    ...base,
    sessionId: ids.s1,
    sentences: [
      {
        text: 'Ein Satz.',
        sources: [{ kind: 'transcript', session_id: ids.s1, t_start_ms: 0, t_end_ms: 1 }],
      },
    ],
    provider: 'fake',
    model: 'fake-llm-1',
    promptVersion: 'summary.write/v1',
    inputHash: HASH,
  });
  return { ...ids, lo, hi };
}

/** Zeilen, die mit der Session gehen (Tabelle, ID) */
const withSession = (ids: Awaited<ReturnType<typeof seed>>): [string, string][] => [
  ['inbox_item', ids.inboxConcept],
  ['inbox_item', ids.inboxRelation],
  ['evidence', ids.evActiveS1],
  ['evidence', ids.evProposalS1],
  ['concept', ids.proposal],
  ['concept', ids.shell],
  ['concept_module', ids.cmProposal],
  ['concept_relation', ids.relProposed],
  ['session_summary', ids.summary],
];
/** Zeilen, die bleiben (angenommenes Wissen und Belege anderer Sessions) */
const staying = (ids: Awaited<ReturnType<typeof seed>>): [string, string][] => [
  ['concept', ids.active],
  ['concept', ids.active2],
  ['concept_module', ids.cmActive],
  ['concept_relation', ids.relConfirmed],
  ['evidence', ids.evActiveS2],
  ['session', ids.s2],
];

describe('Kanten (§20.8)', () => {
  it('[E0] CHILDREN nennt genau die Kanten aus dem Vertrag', () => {
    const edges = (node: keyof typeof CHILDREN) => CHILDREN[node].map((e) => `${e.child}.${e.fk}`);
    expect(edges('session')).toEqual(
      expect.arrayContaining([
        'inbox_item.session_id',
        'evidence.session_id',
        'concept.proposal_session_id',
        'concept_relation.proposal_session_id',
        'session_summary.session_id',
      ]),
    );
    expect(edges('module')).toContain('concept_module.module_id');
    // Karten (§21.8): die Kante concept → card wirkt erst, wenn Konzepte selbst löschbar werden (F-BIB-05)
    expect(edges('concept')).toEqual(['concept_module.concept_id', 'card.concept_id']);
    expect(edges('card')).toEqual(['card_state.card_id', 'review_log.card_id']);
    for (const leaf of [
      'inbox_item',
      'evidence',
      'concept_module',
      'concept_relation',
      'session_summary',
    ] as const) {
      expect(CHILDREN[leaf]).toEqual([]);
    }
    // Folien-Belege bleiben, wenn der Foliensatz geht (Anzeige „Folie gelöscht“)
    expect(edges('slide_deck')).not.toContain('evidence.ref_id');
  });

  it('[E1] Session löschen: Vorschläge, Hüllen, unbestätigte Beziehungen, Belege, Inbox und Zusammenfassung mit demselben deleted_at; Angenommenes bleibt', async () => {
    const ids = await seed();
    await del('session', ids.s1);
    const ts = await stampOf('session', ids.s1);
    expect(ts).toBeTruthy();
    for (const [table, id] of withSession(ids)) expect(await stampOf(table, id), `${table} ${id}`).toBe(ts);
    for (const [table, id] of staying(ids)) expect(await stampOf(table, id), `${table} ${id}`).toBeNull();

    // Wiederherstellen holt genau diese Zeilen zurück
    const result = await restore(ids.s1);
    expect(result).toMatchObject({
      id: ids.s1,
      kind: 'session',
      restored_count: withSession(ids).length + 1,
    });
    for (const [table, id] of [...withSession(ids), ...staying(ids)]) {
      expect(await stampOf(table, id), `${table} ${id}`).toBeNull();
    }
  });

  it('[E2] Schon vorher gelöschte Teile (anderer Zeitstempel) bleiben beim Wiederherstellen im Papierkorb', async () => {
    const ids = await seed();
    await handle.sql`UPDATE evidence SET deleted_at = '2026-01-01T00:00:00Z' WHERE id = ${ids.evProposalS1}`;
    await del('session', ids.s1);
    await restore(ids.s1);
    expect(await stampOf('evidence', ids.evProposalS1)).not.toBeNull();
    expect(await stampOf('evidence', ids.evActiveS1)).toBeNull();
  });

  it('[E3] Modul löschen: concept_module des Moduls und über die Sessions alles von oben; die Konzepte selbst bleiben', async () => {
    const ids = await seed();
    await del('module', ids.module);
    const ts = await stampOf('module', ids.module);
    for (const [table, id] of withSession(ids)) expect(await stampOf(table, id), `${table} ${id}`).toBe(ts);
    expect(await stampOf('concept_module', ids.cmActive)).toBe(ts);
    expect(await stampOf('evidence', ids.evActiveS2)).toBe(ts); // s2 gehört zum Modul
    for (const id of [ids.active, ids.active2]) expect(await stampOf('concept', id)).toBeNull();
    expect(await stampOf('concept_relation', ids.relConfirmed)).toBeNull();

    await restore(ids.module);
    for (const [table, id] of [...withSession(ids), ...staying(ids)]) {
      expect(await stampOf(table, id), `${table} ${id}`).toBeNull();
    }
  });

  it('[E4] Semester löschen nimmt über das Modul dieselben Zeilen mit', async () => {
    const ids = await seed();
    await del('semester', ids.semester);
    const ts = await stampOf('semester', ids.semester);
    expect(await stampOf('concept_module', ids.cmActive)).toBe(ts);
    expect(await stampOf('inbox_item', ids.inboxConcept)).toBe(ts);
    expect(await stampOf('concept', ids.active)).toBeNull();
  });

  it('[E5] Foliensatz löschen lässt Folien-Belege und die Zusammenfassung stehen', async () => {
    const ids = await seed();
    await del('slide_deck', ids.deck);
    for (const id of [ids.evActiveS1, ids.evActiveS2]) expect(await stampOf('evidence', id)).toBeNull();
    expect(await stampOf('session_summary', ids.summary)).toBeNull();
  });

  it('[E6] dependent_count zählt die neuen Tabellen nicht (Maschinenausgaben und Vorschläge)', async () => {
    const ids = await seed();
    await del('session', ids.s1);
    const list = await listTrash(handle.db, { limit: 50 });
    expect(list.items.find((i) => i.id === ids.s1)).toMatchObject({ kind: 'session', dependent_count: 0 });
  });

  it('[E7] Endgültiges Löschen der Session erledigen die FKs; cost_entry bleibt', async () => {
    const ids = await seed();
    const costId = uuidv7();
    await handle.sql`INSERT INTO cost_entry (id, user_id, session_id, provider, model, task, cost_estimate_eur)
      VALUES (${costId}, ${SINGLE_USER_ID}, ${ids.s1}, 'fake', 'fake-llm-1', 'concepts.extract', 0.5)`;
    await handle.sql`DELETE FROM session WHERE id = ${ids.s1}`;
    for (const [table, id] of withSession(ids)) expect(await exists(table, id), `${table} ${id}`).toBe(false);
    for (const [table, id] of staying(ids)) expect(await exists(table, id), `${table} ${id}`).toBe(true);
    expect(await exists('cost_entry', costId)).toBe(true);
    await handle.sql`DELETE FROM cost_entry WHERE id = ${costId}`;
  });
});

describe('Wiederherstellen: Maschinenausgaben weichen statt zu blockieren (§20.8)', () => {
  /** Nach dem Löschen von `s1` schlägt `s2` dieselbe Beziehung noch einmal vor */
  async function sameRelationFromS2(ids: Awaited<ReturnType<typeof seed>>) {
    const relation = uuidv7();
    const item = uuidv7();
    await handle.db.insert(conceptRelation).values({
      id: relation,
      ...base,
      fromId: ids.lo,
      toId: ids.hi,
      kind: 'verwandt',
      source: 'ki',
      confirmed: false,
      proposalSessionId: ids.s2,
    });
    await handle.db.insert(inboxItem).values({
      id: item,
      ...base,
      kind: 'relation',
      sessionId: ids.s2,
      payload: payload('relation'),
      relationId: relation,
    });
    return { relation, item };
  }

  it('[H1] kollidierende unbestätigte Beziehung: samt Inbox-Eintrag hart gelöscht, kein 409, der Rest kommt zurück', async () => {
    const ids = await seed();
    await del('session', ids.s1);
    const fresh = await sameRelationFromS2(ids);

    const result = await restore(ids.s1);
    expect(result.kind).toBe('session');
    // die wiederhergestellte Beziehung und ihr Eintrag sind weg (hart, nicht weich)
    expect(await exists('concept_relation', ids.relProposed)).toBe(false);
    expect(await exists('inbox_item', ids.inboxRelation)).toBe(false);
    // die inzwischen vorhandene Zeile und ihr Eintrag bleiben unberührt
    expect(await stampOf('concept_relation', fresh.relation)).toBeNull();
    expect(await stampOf('inbox_item', fresh.item)).toBeNull();
    // alles andere der Session ist zurück
    for (const [table, id] of withSession(ids)) {
      if (id === ids.relProposed || id === ids.inboxRelation) continue;
      expect(await stampOf(table, id), `${table} ${id}`).toBeNull();
    }
    expect(await stampOf('session', ids.s1)).toBeNull();
    // gezählt wird, was wirklich zurückkam: Session + 7 Teile
    expect(result.restored_count).toBe(withSession(ids).length - 2 + 1);
  });

  it('[H2] auch gegen eine inzwischen bestätigte Beziehung weicht der Vorschlag', async () => {
    const ids = await seed();
    await del('session', ids.s1);
    const confirmed = uuidv7();
    await handle.db.insert(conceptRelation).values({
      id: confirmed,
      ...base,
      fromId: ids.lo,
      toId: ids.hi,
      kind: 'verwandt',
      source: 'manuell',
      confirmed: true,
    });
    await restore(ids.s1);
    expect(await exists('concept_relation', ids.relProposed)).toBe(false);
    expect(await exists('inbox_item', ids.inboxRelation)).toBe(false);
    expect(await stampOf('concept_relation', confirmed)).toBeNull();
  });

  it('[H3] kollidierender Beleg (evidence_dedupe_uq): der wiederhergestellte wird hart gelöscht, der vorhandene bleibt', async () => {
    const ids = await seed();
    await del('session', ids.s1);
    const twinSlide = uuidv7();
    const twinTranscript = uuidv7();
    await handle.db.insert(evidence).values([
      { id: twinSlide, ...base, conceptId: ids.active, sessionId: ids.s1, kind: 'slide', refId: ids.slide },
      {
        id: twinTranscript,
        ...base,
        conceptId: ids.proposal,
        sessionId: ids.s1,
        kind: 'transcript',
        refId: ids.s1,
        tStartMs: 1000,
        tEndMs: 5000,
      },
    ]);
    await restore(ids.s1);
    expect(await exists('evidence', ids.evActiveS1)).toBe(false);
    expect(await exists('evidence', ids.evProposalS1)).toBe(false);
    expect(await stampOf('evidence', twinSlide)).toBeNull();
    expect(await stampOf('evidence', twinTranscript)).toBeNull();
    // der Beleg aus s2 (gleiches Konzept, gleiche Folie, andere Session) ist keine Dublette
    expect(await stampOf('evidence', ids.evActiveS2)).toBeNull();
  });

  it('[H4] nur echte Dubletten weichen: andere Art, anderer Zeitraum oder anderes Konzept kollidieren nicht', async () => {
    const ids = await seed();
    await del('session', ids.s1);
    await handle.db.insert(conceptRelation).values({
      id: uuidv7(),
      ...base,
      fromId: ids.lo,
      toId: ids.hi,
      kind: 'gegensatz', // andere Art
      source: 'ki',
      confirmed: false,
      proposalSessionId: ids.s2,
    });
    await handle.db.insert(evidence).values([
      {
        id: uuidv7(),
        ...base,
        conceptId: ids.proposal,
        sessionId: ids.s1,
        kind: 'transcript',
        refId: ids.s1,
        tStartMs: 1000,
        tEndMs: 6000, // anderer Zeitraum
      },
      { id: uuidv7(), ...base, conceptId: ids.active2, sessionId: ids.s1, kind: 'slide', refId: ids.slide },
    ]);
    const result = await restore(ids.s1);
    expect(result.restored_count).toBe(withSession(ids).length + 1);
    for (const [table, id] of withSession(ids)) expect(await stampOf(table, id), `${table} ${id}`).toBeNull();
  });

  it('[H5] über das Modul wiederhergestellt gilt dasselbe; gelöschte Zeilen (anderer Zeitstempel) lösen nichts aus', async () => {
    const ids = await seed();
    await del('module', ids.module);
    // Dublette, die selbst gelöscht ist: keine Kollision
    await handle.db.insert(evidence).values({
      id: uuidv7(),
      ...base,
      conceptId: ids.active,
      sessionId: ids.s1,
      kind: 'slide',
      refId: ids.slide,
      deletedAt: new Date('2026-01-01T00:00:00Z'),
    });
    // aktive Dublette der Beziehung, ohne Session (bestätigt)
    await handle.db.insert(conceptRelation).values({
      id: uuidv7(),
      ...base,
      fromId: ids.lo,
      toId: ids.hi,
      kind: 'verwandt',
      source: 'manuell',
      confirmed: true,
    });
    await restore(ids.module);
    expect(await exists('concept_relation', ids.relProposed)).toBe(false);
    expect(await exists('inbox_item', ids.inboxRelation)).toBe(false);
    expect(await stampOf('evidence', ids.evActiveS1)).toBeNull();
    expect(await stampOf('concept', ids.proposal)).toBeNull();
  });

  it('[H6] scheitert das Wiederherstellen an einem anderen Konflikt, bleibt auch das hart Gelöschte erhalten (Savepoint)', async () => {
    const ids = await seed();
    const vl = uuidv7();
    await handle.db
      .insert(notebook)
      .values({ id: vl, ...base, moduleId: ids.module, kind: 'vorlesung', title: 'Vorlesung' });
    await del('module', ids.module);
    const ts = await stampOf('module', ids.module);
    // Kollision für den Hook (Beziehung) und ein Konflikt, der 409 bleibt (Standard-Notizbuch), der erst NACH den
    // Sessions geprüft wird
    await handle.db.insert(conceptRelation).values({
      id: uuidv7(),
      ...base,
      fromId: ids.lo,
      toId: ids.hi,
      kind: 'verwandt',
      source: 'manuell',
      confirmed: true,
    });
    await handle.db
      .insert(notebook)
      .values({ id: uuidv7(), ...base, moduleId: ids.module, kind: 'vorlesung', title: 'Vorlesung neu' });

    const err = await errorOf(restore(ids.module));
    expect(err).toMatchObject({ statusCode: 409, code: 'restore_conflict' });
    expect(err.details).toMatchObject({ constraint: 'notebook_default_uq' });
    // nichts halb wiederhergestellt und nichts verloren
    expect(await stampOf('concept_relation', ids.relProposed)).toBe(ts);
    expect(await stampOf('inbox_item', ids.inboxRelation)).toBe(ts);
    expect(await stampOf('session', ids.s1)).toBe(ts);
  });
});
