// T2-22b: Annahmen A1–A3, Ablehnen und Rückgängig gegen die gemeinsamen Testfälle von Worker und Core
// (`packages/schemas/fixtures/concepts/decisions.json`, VERTRAEGE §20.12). Jeder Fall wird in die echte Datenbank
// geschrieben und über die REST-Route entschieden.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InboxDecisionResultSchema, type AutoAcceptMode, type ConceptProposal } from '@sg/shared';
import { startTestApp, type TestApp } from './helpers.ts';
import { refId, World } from './inbox-helpers.ts';

interface FixtureCase {
  name: string;
  settings: { auto_accept: AutoAcceptMode };
  concepts: {
    ref: string;
    name: string;
    aliases?: string[];
    status: 'vorschlag' | 'aktiv';
    session?: string;
  }[];
  relations?: { ref: string; from: string; to: string; kind: string; confirmed: boolean; session?: string }[];
  evidence?: { ref: string; concept: string; session: string; kind: 'slide'; slide: string }[];
  items: {
    ref: string;
    kind: 'concept_new' | 'concept_merge' | 'relation';
    concept?: string;
    target?: string;
    relation?: string;
    session: string;
    status?: 'angenommen' | 'abgelehnt';
    proposal?: ConceptProposal;
    decision?: Record<string, unknown>;
  }[];
  action: { op: 'accept' | 'reject' | 'reopen'; item: string; body?: Record<string, unknown> };
  expect: {
    error: string | null;
    details?: Record<string, unknown>;
    concepts?: Record<string, Record<string, unknown>>;
    relations?: Record<string, Record<string, unknown>>;
    items?: Record<string, { status?: string; decision?: Record<string, unknown> | null }>;
    evidence?: Record<string, { concept: string }>;
  };
}

const { cases } = JSON.parse(
  readFileSync(
    new URL('../../../../packages/schemas/fixtures/concepts/decisions.json', import.meta.url),
    'utf8',
  ),
) as { cases: FixtureCase[] };

/** Felder, deren Werte Kurznamen sind */
const REF_FIELDS = ['concept_id', 'merged_into', 'duplicate_of', 'triggered_by', 'merge_into'];
const REF_LIST_FIELDS = ['moved_evidence_ids', 'cascade_item_ids', 'path'];

function withIds(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (REF_FIELDS.includes(key) && typeof entry === 'string') result[key] = refId(entry);
    else if (REF_LIST_FIELDS.includes(key) && Array.isArray(entry)) {
      result[key] = entry.map((ref) => refId(ref as string));
    } else result[key] = entry;
  }
  return result;
}

const STATUS: Record<string, number> = {
  concept_exists: 409,
  merge_target_invalid: 409,
  relation_endpoint_pending: 409,
  relation_cycle: 409,
  inbox_reopen_conflict: 409,
};

let app: TestApp;
let world: World;

beforeAll(async () => {
  app = await startTestApp();
  world = new World(app.handle);
});
afterAll(async () => {
  await world.reset();
  await app.close();
});

describe('decisions.json', () => {
  it('hat Testfälle', () => expect(cases.length).toBeGreaterThanOrEqual(15));

  it.each(cases)('$name', async (c) => {
    await world.reset();
    await world.setAutoAccept(c.settings.auto_accept);
    for (const seed of c.concepts) {
      await world.concept(seed.ref, {
        name: seed.name,
        aliases: seed.aliases ?? [],
        status: seed.status,
        session: seed.session ?? null,
      });
    }
    for (const seed of c.relations ?? []) {
      await world.relation(seed.ref, { ...seed, session: seed.session ?? null });
    }
    for (const seed of c.evidence ?? []) {
      await world.slideEvidence(seed.ref, seed);
    }
    for (const seed of c.items) {
      await world.item(seed.ref, {
        kind: seed.kind,
        session: seed.session,
        ...(seed.concept ? { concept: seed.concept } : {}),
        ...(seed.target ? { target: seed.target } : {}),
        ...(seed.relation ? { relation: seed.relation } : {}),
        ...(seed.status ? { status: seed.status } : {}),
        ...(seed.proposal ? { proposal: seed.proposal } : {}),
        ...(seed.decision ? { decision: withIds(seed.decision) } : {}),
      });
    }
    const before = await world.snapshot();

    const res = await app.request({
      method: 'POST',
      url: `/api/v1/inbox/${refId(c.action.item)}/${c.action.op}`,
      ...(c.action.op === 'accept' ? { payload: withIds(c.action.body ?? {}) } : {}),
    });

    if (c.expect.error) {
      expect(res.json()).toMatchObject({ error: { code: c.expect.error } });
      expect(res.statusCode).toBe(STATUS[c.expect.error]);
      if (c.expect.details) expect(res.json().error.details).toMatchObject(withIds(c.expect.details));
      // „dann ändert sich nichts“
      expect(await world.snapshot()).toEqual(before);
      return;
    }

    expect(res.statusCode, res.body).toBe(200);
    InboxDecisionResultSchema.parse(res.json());

    for (const [ref, want] of Object.entries(c.expect.concepts ?? {})) {
      const row = await world.conceptRow(ref);
      if ('status' in want) expect(row.status, `${ref}.status`).toBe(want.status);
      if ('session' in want) {
        expect(row.proposal_session_id, `${ref}.session`).toBe(
          want.session ? refId(want.session as string) : null,
        );
      }
      if ('importance_base' in want)
        expect(row.importance_base).toBeCloseTo(want.importance_base as number, 5);
      if ('exam_relevant' in want) expect(row.exam_relevant).toBe(want.exam_relevant);
      if ('merged_into' in want) expect(row.merged_into).toBe(refId(want.merged_into as string));
      if ('aliases' in want) expect(row.aliases).toEqual(want.aliases);
      const known = ['status', 'session', 'importance_base', 'exam_relevant', 'merged_into', 'aliases'];
      expect(Object.keys(want).filter((key) => !known.includes(key))).toEqual([]);
    }
    for (const [ref, want] of Object.entries(c.expect.relations ?? {})) {
      const row = await world.relationRow(ref);
      if ('from' in want) expect(row.fromId, `${ref}.from`).toBe(refId(want.from as string));
      if ('to' in want) expect(row.toId, `${ref}.to`).toBe(refId(want.to as string));
      if ('kind' in want) expect(row.kind).toBe(want.kind);
      if ('confirmed' in want) expect(row.confirmed, `${ref}.confirmed`).toBe(want.confirmed);
      if ('session' in want) {
        expect(row.proposalSessionId, `${ref}.session`).toBe(
          want.session ? refId(want.session as string) : null,
        );
      }
      const known = ['from', 'to', 'kind', 'confirmed', 'session'];
      expect(Object.keys(want).filter((key) => !known.includes(key))).toEqual([]);
    }
    for (const [ref, want] of Object.entries(c.expect.items ?? {})) {
      const row = await world.itemRow(ref);
      if (want.status) expect(row.status, `${ref}.status`).toBe(want.status);
      if (want.decision === null) expect(row.decision).toBeNull();
      else if (want.decision) expect(row.decision, `${ref}.decision`).toMatchObject(withIds(want.decision));
      expect(row.decidedAt === null).toBe(row.status === 'offen');
    }
    for (const [ref, want] of Object.entries(c.expect.evidence ?? {})) {
      expect((await world.evidenceRow(ref))?.conceptId).toBe(refId(want.concept));
    }
  });
});
