// Folgepunkte aus #187 (T2-23, Inbox): `details` im gemeinsamen Client, „Rückgängig“ nach „Alle annehmen“ mit
// mitentschiedenen Folge-Einträgen, Fake-Core wie der echte Core. Alle Namen sind erfunden.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModuleListSchema, type InboxItem } from '@sg/shared';
import { ApiRequestError, apiGet, apiSend, friendlyMessage } from '../src/lib/api.ts';
import {
  bulkInChunks,
  bulkTarget,
  errorDetail,
  inboxErrorMessage,
  reopenItem,
  undoBulk,
} from '../src/lib/inbox.ts';
import {
  installFakeCore,
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
const C_EXISTING = id(802);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lib/api.ts: details und Codes der Inbox (§20.11)', () => {
  it('reicht `error.details` an ApiRequestError durch (GET und POST); ohne details bleibt es leer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ error: { code: 'relation_cycle', message: 'x', details: { path: ['a', 'b', 'a'] } } }, 409),
      ),
    );
    const viaGet = await apiGet('/modules', ModuleListSchema).catch((e: unknown) => e);
    const viaPost = await apiSend('POST', '/inbox/bulk', ModuleListSchema, { body: {} }).catch(
      (e: unknown) => e,
    );
    for (const err of [viaGet, viaPost]) {
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).details).toEqual({ path: ['a', 'b', 'a'] });
      expect((err as ApiRequestError).code).toBe('relation_cycle');
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'inbox_busy', message: 'x' } }, 503)),
    );
    const plain = await apiGet('/modules', ModuleListSchema).catch((e: unknown) => e);
    expect((plain as ApiRequestError).details).toEqual({});
  });

  it('kennt die Codes aus §20.11 mit eigenen Texten', async () => {
    const texts = new Map<string, string>();
    for (const [status, code] of [
      [503, 'inbox_busy'],
      [400, 'inbox_action_invalid'],
      [409, 'inbox_reopen_conflict'],
      [409, 'inbox_item_decided'],
      [409, 'inbox_item_not_decided'],
      [404, 'inbox_item_not_found'],
      [404, 'concept_not_found'],
      [409, 'concept_exists'],
      [409, 'merge_target_invalid'],
      [409, 'relation_endpoint_pending'],
      [409, 'relation_cycle'],
    ] as const) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => json({ error: { code, message: 'x' } }, status)),
      );
      const err = await apiGet('/modules', ModuleListSchema).catch((e: unknown) => e);
      texts.set(code, friendlyMessage(err));
    }
    expect(texts.get('inbox_busy')).toBe('Gerade beschäftigt, bitte gleich nochmal.');
    expect(texts.get('inbox_action_invalid')).toBe('Das passt nicht zu dieser Art von Vorschlag.');
    expect(texts.get('inbox_reopen_conflict')).toBe(
      'Rückgängig geht nicht mehr: Darauf baut inzwischen anderes auf.',
    );
    for (const [code, text] of texts) {
      expect(text, code).not.toMatch(/nicht geklappt|schiefgegangen|unerwartet/);
    }
    expect(new Set(texts.values()).size).toBe(texts.size);
  });
});

let core: FakeCore;

/** `n` Konzepte mit je einer Beziehung zu einem vorhandenen Konzept; `extra` Konzepte ohne Beziehung am Ende */
function boot(n: number, extra = 0) {
  core = installFakeCore({
    semesters: [makeSemester()],
    modules: [makeModule()],
    sessions: [makeSession({ id: SESSION.id, state: 'verarbeitet', ended_at: '2026-11-05T13:45:00Z' })],
  });
  core.concepts = [makeConceptDetail({ id: C_EXISTING, name: 'Vorhandenes Konzept' })];
  core.inboxCascade = true;
  const items: InboxItem[] = [];
  const concept = (i: number, priority: number) =>
    makeInboxItem(
      {
        kind: 'concept_new',
        proposal: {
          name: `Konzept ${i}`,
          aliases: [],
          one_liner: null,
          kind: 'definition',
          importance: 2,
          exam_hint: false,
          prof_explanation: null,
          confidence: 0.95,
        },
        evidence: [{ kind: 'transcript', session_id: SESSION.id, t_start_ms: 0, t_end_ms: 1000 }],
        similar: [],
        prompt_version: 'concepts.extract/v1',
        model: 'fake',
      },
      { id: id(10_000 + i), concept_id: id(20_000 + i), priority },
    );
  for (let i = 1; i <= n; i += 1) {
    items.push(concept(i, i));
    items.push(
      makeInboxItem(
        {
          kind: 'relation',
          from_concept_id: id(20_000 + i),
          to_concept_id: C_EXISTING,
          relation_kind: 'baut_auf',
          why: 'Erfunden.',
          confidence: 0.95,
          prompt_version: 'concepts.extract/v1',
          model: 'fake',
        },
        { id: id(30_000 + i), relation_id: id(40_000 + i), blocked: 'endpunkt_offen' },
      ),
    );
  }
  for (let k = 0; k < extra; k += 1) items.push(concept(9000 + k, 9000 + k));
  core.inboxItems = items;
  return core;
}

const states = () => new Set(core.inboxItems.map((x) => x.status));

describe('Rückgängig nach „Alle annehmen“ (§20.6: mitentschiedene Folge-Einträge)', () => {
  it('Fake-Core entscheidet Beziehungen mit und öffnet sie nur über den Auslöser wieder (wie der Core)', async () => {
    boot(2);
    const result = await bulkInChunks({ action: 'accept', session_id: SESSION.id });
    // `decided` enthält auch die mitentschiedenen Beziehungen, in Bearbeitungsreihenfolge (Konzept, Folge-Eintrag)
    expect(result.decided).toEqual([id(10_001), id(30_001), id(10_002), id(30_002)]);
    expect(result.skipped).toEqual([]);
    expect(states()).toEqual(new Set(['angenommen']));
    // Direkt wieder öffnen geht nur über den Auslöser
    const direct = await reopenItem(id(30_001)).catch((e: unknown) => e);
    expect(direct).toMatchObject({ status: 409, code: 'inbox_reopen_conflict' });
    expect(errorDetail(direct, 'triggered_by')).toBe(id(10_001));
    expect(inboxErrorMessage(direct)).toMatch(/Rückgängig geht nicht mehr/);
    await reopenItem(id(10_001));
    expect(core.inboxItems.find((x) => x.id === id(30_001))?.status).toBe('offen');
  });

  it('meldet bei wenigen Einträgen nichts als „nicht zurückgenommen“', async () => {
    boot(3);
    const result = await bulkInChunks({ action: 'accept', session_id: SESSION.id });
    const undone = await undoBulk(result.decided);
    expect(undone.skipped).toEqual([]);
    expect(undone.decided).toHaveLength(6);
    expect(states()).toEqual(new Set(['offen']));
  });

  it('meldet auch über Blöcke zu 500 hinweg nichts Falsches (Folge-Eintrag und Auslöser in verschiedenen Blöcken)', async () => {
    // 250 Konzepte mit Beziehung + 1 Konzept ohne: 501 Einträge in `decided`. Umgekehrt steht die Beziehung des
    // ersten Konzepts im ersten Block, das Konzept allein im zweiten.
    boot(250, 1);
    const result = await bulkInChunks({ action: 'accept', session_id: SESSION.id });
    expect(result.decided).toHaveLength(501);
    expect(result.skipped).toEqual([]);
    const undone = await undoBulk(result.decided);
    expect(undone.skipped).toEqual([]);
    expect(states()).toEqual(new Set(['offen']));
  });

  it('„Alle annehmen“ mit `ids` über 500: im ersten Block mitbestätigte Beziehungen zählen nicht als offen geblieben', async () => {
    // Konzepte zuerst, dann Beziehungen (`bulkTarget`): Die letzte Beziehung steht im zweiten Block, ihr Konzept
    // hat sie im ersten schon mitbestätigt (der Core meldet dann `inbox_item_decided`)
    boot(250, 1);
    const ids = bulkTarget(core.inboxItems, null, core.inboxItems.length).ids ?? [];
    expect(ids).toHaveLength(501);
    const result = await bulkInChunks({ action: 'accept', ids });
    expect(result.skipped).toEqual([]);
    expect(new Set(result.decided).size).toBe(501);
    expect(states()).toEqual(new Set(['angenommen']));
  });

  it('unbekannte IDs meldet der Fake-Core wie der Core mit `inbox_item_not_found`', async () => {
    boot(1);
    const result = await bulkInChunks({ action: 'accept', ids: [id(10_001), id(99_999)] });
    expect(result.skipped).toEqual([{ id: id(99_999), code: 'inbox_item_not_found' }]);
    expect(result.decided).toEqual([id(10_001), id(30_001)]);
  });

  it('echte Konflikte bleiben in `skipped`', async () => {
    boot(1);
    const result = await bulkInChunks({ action: 'accept', session_id: SESSION.id });
    const real = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (...args: Parameters<typeof fetch>) => {
        if (String(args[0]).endsWith('/inbox/bulk')) {
          return json({ decided: [], skipped: [{ id: id(30_001), code: 'inbox_reopen_conflict' }] });
        }
        return real(...args);
      }),
    );
    const undone = await undoBulk(result.decided);
    expect(undone.skipped).toEqual([{ id: id(30_001), code: 'inbox_reopen_conflict' }]);
  });
});

describe('Fake-Core: reprocess mit den Schritten der Konzepte (§20.2)', () => {
  type Reply = { status: number; body: { session?: { processing: Record<string, string> } } };
  const reprocess = async (from?: string): Promise<Reply> => {
    const res = await fetch(`/api/v1/sessions/${SESSION.id}/reprocess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(from ? { from_step: from } : {}),
    });
    return { status: res.status, body: (await res.json()) as Reply['body'] };
  };
  const fresh = () => {
    boot(0);
    const found = core.sessions[0];
    if (found) {
      found.processing = {
        'audio.finalize': 'fertig',
        transcribe: 'fertig',
        'align.log': 'fertig',
        'concepts.extract': 'fertig',
        'concepts.resolve': 'fertig',
        'summary.write': 'fertig',
      };
    }
  };

  it('setzt ab `from_step` die Folgeschritte auf „wartet“; die Konzept-Schritte brauchen kein Audio', async () => {
    fresh();
    let r = await reprocess('summary.write');
    expect(r.status).toBe(202);
    expect(r.body.session?.processing).toMatchObject({
      'concepts.resolve': 'fertig',
      'summary.write': 'wartet',
    });
    fresh();
    r = await reprocess('concepts.resolve');
    expect(r.body.session?.processing).toMatchObject({
      'concepts.extract': 'fertig',
      'concepts.resolve': 'wartet',
      'summary.write': 'wartet',
    });
    fresh();
    r = await reprocess('concepts.extract');
    expect(r.status).toBe(202);
    expect(r.body.session?.processing).toMatchObject({
      'align.log': 'fertig',
      'concepts.extract': 'wartet',
      'concepts.resolve': 'wartet',
      'summary.write': 'wartet',
    });
    fresh();
    r = await reprocess('align.log');
    expect(r.body.session?.processing).toMatchObject({ 'align.log': 'wartet', 'summary.write': 'wartet' });
  });

  it('ohne fertigen `concepts.extract` gilt `from_step = concepts.extract`; Audio nur bis `transcribe` nötig', async () => {
    fresh();
    const found = core.sessions[0];
    if (found) found.processing['concepts.extract'] = 'fehler';
    const r = await reprocess('concepts.resolve');
    expect(r.body.session?.processing['concepts.extract']).toBe('wartet');
    fresh();
    expect((await reprocess('transcribe')).status).toBe(409);
  });
});
