// T2-22b: Sperren und Nebenläufigkeit der Inbox (VERTRAEGE §20.6 „Sperren“). Echte Datenbank, echte parallele
// Transaktionen. Den Worker (`concepts.resolve`, §20.3 Schritt 7) spielt eine zweite Verbindung, die dieselben
// Sperren in derselben Reihenfolge nimmt: Session `FOR NO KEY UPDATE` → Graph-Sperre → schreiben.
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CONCEPT_GRAPH_LOCK_KEY } from '../../src/lib/locks.ts';
import { startTestApp, testDatabaseUrl, type TestApp } from './helpers.ts';
import { refId, World } from './inbox-helpers.ts';

const API = '/api/v1';
/** Der Schlüssel steht im Vertrag: Worker und Core müssen dieselbe Zahl nehmen */
const GRAPH_LOCK = 70070006;

let app: TestApp;
let world: World;
let side: postgres.Sql;

beforeAll(async () => {
  app = await startTestApp();
  world = new World(app.handle);
  side = postgres(testDatabaseUrl(), { max: 4, onnotice: () => {} });
});
afterAll(async () => {
  await world.reset();
  await side.end({ timeout: 5 });
  await app.close();
});
beforeEach(async () => {
  await world.reset();
});

const post = (path: string, payload?: unknown) =>
  app.request({ method: 'POST', url: `${API}${path}`, ...(payload === undefined ? {} : { payload }) });
const accept = (ref: string, body: unknown = {}) => post(`/inbox/${refId(ref)}/accept`, body);
const reject = (ref: string) => post(`/inbox/${refId(ref)}/reject`);
const reopen = (ref: string) => post(`/inbox/${refId(ref)}/reopen`);
const codeOf = (res: { statusCode: number; json: () => { error?: { code: string } } }) =>
  res.statusCode === 200 ? 'ok' : (res.json().error?.code ?? String(res.statusCode));

/** true, wenn das Versprechen nach `ms` noch nicht fertig ist (die Anfrage wartet auf eine Sperre) */
async function pending(promise: Promise<unknown>, ms = 300): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return !settled;
}

/** Offene Transaktion auf einer eigenen Verbindung */
async function openTx() {
  const conn = await side.reserve();
  await conn`BEGIN`;
  let open = true;
  const end = async (how: 'COMMIT' | 'ROLLBACK') => {
    if (!open) return;
    open = false;
    try {
      await conn.unsafe(how);
    } finally {
      conn.release();
    }
  };
  return { sql: conn, commit: () => end('COMMIT'), rollback: () => end('ROLLBACK') };
}

/** Lässt sich die Zeile gerade nicht sperren? (`55P03` = lock_not_available) */
async function isLocked(query: (sql: postgres.ReservedSql) => Promise<unknown>): Promise<boolean> {
  const tx = await openTx();
  try {
    await query(tx.sql);
    return false;
  } catch (error) {
    if ((error as { code?: string }).code === '55P03') return true;
    throw error;
  } finally {
    await tx.rollback();
  }
}

describe('Graph-Sperre', () => {
  it('hat den Schlüssel aus dem Vertrag', () => {
    expect(CONCEPT_GRAPH_LOCK_KEY).toBe(GRAPH_LOCK);
  });

  it('jede Annahme und jede Rücknahme wartet auf sie, Ablehnen nicht', async () => {
    await world.concept('p1', { name: 'Tupel' });
    await world.concept('p2', { name: 'Attribut' });
    await world.concept('p3', { name: 'Relation', status: 'aktiv' });
    await world.concept('p4', { name: 'Domäne' });
    await world.concept('t', { name: 'Tabelle', status: 'aktiv' });
    await world.concept('u', { name: 'Zeile', status: 'aktiv' });
    await world.relation('r1', { from: 't', to: 'u' });
    await world.item('i1', { kind: 'concept_new', concept: 'p1' });
    await world.item('i2', { kind: 'concept_new', concept: 'p2' });
    await world.item('i3', {
      kind: 'concept_new',
      concept: 'p3',
      status: 'angenommen',
      decision: { concept_id: refId('p3') },
    });
    await world.item('i4', { kind: 'concept_merge', concept: 'p4', target: 't' });
    await world.item('ir1', { kind: 'relation', relation: 'r1' });

    const holder = await openTx();
    await holder.sql`SELECT pg_advisory_xact_lock(${GRAPH_LOCK})`;
    try {
      const waiting = [accept('i1'), reopen('i3'), accept('i4'), accept('ir1')];
      const bulk = post('/inbox/bulk', { action: 'accept', ids: [refId('i2')] });
      for (const request of [...waiting, bulk]) expect(await pending(request, 150)).toBe(true);
      expect((await world.conceptRow('p1')).status).toBe('vorschlag');

      await holder.commit();
      for (const request of [...waiting, bulk]) expect((await request).statusCode).toBe(200);
    } finally {
      await holder.rollback();
    }
    expect((await world.conceptRow('p1')).status).toBe('aktiv');
    expect((await world.conceptRow('p3')).status).toBe('vorschlag');

    // Ablehnen braucht die Sperre nicht
    await world.concept('p5', { name: 'Schlüssel' });
    await world.item('i5', { kind: 'concept_new', concept: 'p5' });
    const second = await openTx();
    await second.sql`SELECT pg_advisory_xact_lock(${GRAPH_LOCK})`;
    try {
      expect((await reject('i5')).statusCode).toBe(200);
    } finally {
      await second.rollback();
    }
  });

  it('die Namensprüfung läuft erst unter der Sperre: eine Annahme des Workers dazwischen zählt', async () => {
    await world.concept('p', { name: 'Tupel' });
    await world.concept('w', { name: 'tupel', session: 's2' });
    await world.item('i1', { kind: 'concept_new', concept: 'p' });

    // Der Worker nimmt in s2 automatisch an (A1) und hält dabei die Graph-Sperre
    const worker = await openTx();
    await worker.sql`SELECT id FROM session WHERE id = ${refId('s2')} FOR NO KEY UPDATE`;
    await worker.sql`SELECT pg_advisory_xact_lock(${GRAPH_LOCK})`;
    const request = accept('i1');
    try {
      expect(await pending(request)).toBe(true);
      await worker.sql`UPDATE concept SET status = 'aktiv', proposal_session_id = NULL WHERE id = ${refId('w')}`;
      await worker.commit();
    } finally {
      await worker.rollback();
    }
    const res = await request;
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'concept_exists', details: { concept_id: refId('w') } });
    expect((await world.conceptRow('p')).status).toBe('vorschlag');
    expect((await world.itemRow('i1')).status).toBe('offen');
  });

  it('die Kreisprüfung läuft erst unter der Sperre', async () => {
    await world.concept('a', { name: 'A', status: 'aktiv' });
    await world.concept('b', { name: 'B', status: 'aktiv' });
    await world.relation('r1', { from: 'a', to: 'b' });
    await world.relation('rw', { from: 'b', to: 'a', session: 's2' });
    await world.item('i1', { kind: 'relation', relation: 'r1' });

    const worker = await openTx();
    await worker.sql`SELECT pg_advisory_xact_lock(${GRAPH_LOCK})`;
    const request = accept('i1');
    try {
      expect(await pending(request)).toBe(true);
      await worker.sql`UPDATE concept_relation SET confirmed = true, proposal_session_id = NULL
        WHERE id = ${refId('rw')}`;
      await worker.commit();
    } finally {
      await worker.rollback();
    }
    const res = await request;
    expect(res.json().error).toMatchObject({
      code: 'relation_cycle',
      details: { path: ['a', 'b', 'a'].map(refId) },
    });
    expect((await world.relationRow('r1')).confirmed).toBe(false);
  });
});

describe('Sperrreihenfolge: Session FOR SHARE → Eintrag FOR UPDATE → Graph-Sperre → Konzepte', () => {
  it('eine Entscheidung wartet, solange concepts.resolve die Session hält, und sieht danach dessen Ergebnis', async () => {
    await world.concept('p', { name: 'Tupel' });
    await world.concept('q', { name: 'Attribut', session: 's2' });
    await world.item('i1', { kind: 'concept_new', concept: 'p' });
    await world.item('i2', { kind: 'concept_new', concept: 'q', session: 's2' });

    const worker = await openTx();
    await worker.sql`SELECT id FROM session WHERE id = ${refId('s1')} FOR NO KEY UPDATE`;
    const request = accept('i1');
    const bulk = post('/inbox/bulk', { action: 'accept', session_id: refId('s1') });
    try {
      expect(await pending(request)).toBe(true);
      expect(await pending(bulk, 0)).toBe(true);
      // Eine andere Session ist nicht betroffen
      expect((await accept('i2')).statusCode).toBe(200);
      // Die wartende Entscheidung hält weder die Graph-Sperre noch ihren Eintrag: der Worker kommt durch
      await worker.sql`SET LOCAL lock_timeout = '2s'`;
      await worker.sql`SELECT pg_advisory_xact_lock(${GRAPH_LOCK})`;
      await worker.sql`SELECT id FROM inbox_item WHERE id = ${refId('i1')} FOR UPDATE`;
      // Der neue Lauf ersetzt seinen offenen Vorschlag (hart, §20.3 Schritt 7)
      await worker.sql`DELETE FROM concept WHERE id = ${refId('p')}`;
      await worker.commit();
    } finally {
      await worker.rollback();
    }
    const res = await request;
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('inbox_item_not_found');
    expect((await bulk).json()).toEqual({ decided: [], skipped: [] });
  });

  it('während einer Entscheidung sind Session (geteilt), Eintrag und danach das Konzept gesperrt', async () => {
    await world.concept('p', { name: 'Tupel' });
    await world.item('i1', { kind: 'concept_new', concept: 'p' });

    const holder = await openTx();
    await holder.sql`SELECT pg_advisory_xact_lock(${GRAPH_LOCK})`;
    const request = accept('i1');
    try {
      expect(await pending(request)).toBe(true);
      // Schritt 1: concepts.resolve (FOR NO KEY UPDATE) käme jetzt nicht an die Session, ein Leser mit FOR SHARE schon
      expect(
        await isLocked(
          (sql) => sql`SELECT id FROM session WHERE id = ${refId('s1')} FOR NO KEY UPDATE NOWAIT`,
        ),
      ).toBe(true);
      expect(
        await isLocked((sql) => sql`SELECT id FROM session WHERE id = ${refId('s1')} FOR SHARE NOWAIT`),
      ).toBe(false);
      // Schritt 2
      expect(
        await isLocked((sql) => sql`SELECT id FROM inbox_item WHERE id = ${refId('i1')} FOR UPDATE NOWAIT`),
      ).toBe(true);
      // Schritt 4 kommt erst nach der Graph-Sperre
      expect(
        await isLocked(
          (sql) => sql`SELECT id FROM concept WHERE id = ${refId('p')} FOR NO KEY UPDATE NOWAIT`,
        ),
      ).toBe(false);
      await holder.commit();
    } finally {
      await holder.rollback();
    }
    expect((await request).statusCode).toBe(200);
  });

  it('Konzepte werden mit FOR NO KEY UPDATE gesperrt: ein FK-Schreiber (FOR KEY SHARE) wartet nicht', async () => {
    await world.concept('p', { name: 'Tupel' });
    await world.concept('t', { name: 'Tabelle', status: 'aktiv' });
    await world.concept('u', { name: 'Relation', status: 'aktiv' });
    await world.relation('r1', { from: 'p', to: 'u' });
    await world.item('i1', { kind: 'concept_merge', concept: 'p', target: 't' });
    await world.item('ir1', { kind: 'relation', relation: 'r1' });

    // Ein Fremder hält den Folge-Eintrag: die Zusammenführung sperrt P und T, kommt an ir1 nicht vorbei und
    // versucht es neu. Dazwischen prüfen wir die Sperren auf den Konzepten nicht (zu kurz), sondern das Ergebnis:
    // ein Beleg-Schreiber auf T (FK → FOR KEY SHARE) läuft parallel durch.
    const holder = await openTx();
    await holder.sql`SELECT id FROM inbox_item WHERE id = ${refId('ir1')} FOR UPDATE`;
    const request = accept('i1');
    try {
      expect(await pending(request, 150)).toBe(true);
      const writer = await openTx();
      try {
        await writer.sql`SET LOCAL lock_timeout = '2s'`;
        await writer.sql`SELECT id FROM concept WHERE id = ${refId('t')} FOR KEY SHARE`;
        await writer.commit();
      } finally {
        await writer.rollback();
      }
      await holder.commit();
    } finally {
      await holder.rollback();
    }
    expect((await request).statusCode).toBe(200);
    expect(await world.relationRow('r1')).toMatchObject({ fromId: refId('t'), toId: refId('u') });
  });
});

describe('zwei Entscheidungen gleichzeitig', () => {
  const ROUNDS = 8;

  it('zwei namensgleiche Vorschläge: genau einer wird aktiv', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await world.reset();
      await world.concept('p', { name: 'Dritte Normalform', aliases: ['3NF'] });
      await world.concept('q', { name: '3nf', session: 's2' });
      await world.item('i1', { kind: 'concept_new', concept: 'p' });
      await world.item('i2', { kind: 'concept_new', concept: 'q', session: 's2' });
      const codes = (await Promise.all([accept('i1'), accept('i2')])).map(codeOf).sort();
      expect(codes).toEqual(['concept_exists', 'ok']);
      const active = [await world.conceptRow('p'), await world.conceptRow('q')].filter(
        (row) => row.status === 'aktiv',
      );
      expect(active).toHaveLength(1);
    }
  });

  it('auch über edit und über eine Massenaktion', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await world.reset();
      await world.concept('p', { name: 'Streuung' });
      await world.concept('q', { name: 'Varianz', session: 's2' });
      await world.item('i1', { kind: 'concept_new', concept: 'p' });
      await world.item('i2', { kind: 'concept_new', concept: 'q', session: 's2' });
      const [single, bulk] = await Promise.all([
        accept('i1', { edit: { name: 'varianz' } }),
        post('/inbox/bulk', { action: 'accept', session_id: refId('s2') }),
      ]);
      expect(bulk.statusCode).toBe(200);
      const bulkOk = bulk.json().decided.length === 1;
      expect([codeOf(single), bulkOk]).toEqual(bulkOk ? ['concept_exists', true] : ['ok', false]);
      if (!bulkOk) expect(bulk.json().skipped).toEqual([{ id: refId('i2'), code: 'concept_exists' }]);
    }
  });

  it('zwei Beziehungen, die zusammen einen Kreis bilden: genau eine wird bestätigt', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await world.reset();
      await world.concept('a', { name: 'A', status: 'aktiv' });
      await world.concept('b', { name: 'B', status: 'aktiv' });
      await world.concept('c', { name: 'C', status: 'aktiv' });
      await world.relation('r0', { from: 'b', to: 'c', confirmed: true });
      await world.relation('r1', { from: 'a', to: 'b' });
      await world.relation('r2', { from: 'c', to: 'a', session: 's2' });
      await world.item('i1', { kind: 'relation', relation: 'r1' });
      await world.item('i2', { kind: 'relation', relation: 'r2', session: 's2' });
      const codes = (await Promise.all([accept('i1'), accept('i2')])).map(codeOf).sort();
      expect(codes).toEqual(['ok', 'relation_cycle']);
      const confirmed = [await world.relationRow('r1'), await world.relationRow('r2')].filter(
        (r) => r.confirmed,
      );
      expect(confirmed).toHaveLength(1);
    }
  });

  it('derselbe Eintrag zweimal: einmal 200, einmal 409 inbox_item_decided', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await world.reset();
      await world.concept('p', { name: 'Tupel' });
      await world.item('i1', { kind: 'concept_new', concept: 'p' });
      const responses = await Promise.all([accept('i1'), accept('i1'), reject('i1')]);
      expect(responses.map(codeOf).sort()).toEqual(['inbox_item_decided', 'inbox_item_decided', 'ok']);
      const row = await world.itemRow('i1');
      const concept = await world.conceptRow('p');
      expect(concept.status).toBe(row.status === 'angenommen' ? 'aktiv' : 'vorschlag');
    }
  });

  it('zwei Zusammenführungen in dasselbe Ziel: keine doppelten Aliase', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await world.reset();
      await world.concept('p', { name: 'FD', aliases: ['Functional dependency'] });
      await world.concept('q', { name: 'fd', aliases: ['FA'], session: 's2' });
      await world.concept('t', { name: 'Funktionale Abhängigkeit', status: 'aktiv' });
      await world.item('i1', { kind: 'concept_merge', concept: 'p', target: 't' });
      await world.item('i2', { kind: 'concept_merge', concept: 'q', target: 't', session: 's2' });
      const codes = (await Promise.all([accept('i1'), accept('i2')])).map(codeOf);
      expect(codes).toEqual(['ok', 'ok']);
      const aliases = (await world.conceptRow('t')).aliases;
      expect(aliases.map((alias) => alias.toLowerCase()).sort()).toEqual([
        'fa',
        'fd',
        'functional dependency',
      ]);
    }
  });

  it('zweimal Rückgängig gleichzeitig: einmal 200, einmal 409, der Zustand ist der vom Anfang', async () => {
    await world.setAutoAccept('nur_beziehungen');
    for (let round = 0; round < ROUNDS; round += 1) {
      await world.reset();
      await world.setAutoAccept('nur_beziehungen');
      await world.concept('p', { name: 'Zweite Normalform' });
      await world.concept('t', { name: 'Erste Normalform', status: 'aktiv' });
      await world.relation('r1', { from: 'p', to: 't' });
      await world.item('i1', { kind: 'concept_new', concept: 'p' });
      await world.item('ir1', { kind: 'relation', relation: 'r1' });
      const before = await world.snapshot();
      expect((await accept('i1')).statusCode).toBe(200);
      const codes = (await Promise.all([reopen('i1'), reopen('i1')])).map(codeOf).sort();
      expect(codes).toEqual(['inbox_item_not_decided', 'ok']);
      expect(await world.snapshot()).toEqual(before);
    }
  });
});

describe('keine Verklemmung über Folge-Einträge', () => {
  const ROUNDS = 8;
  const ALLOWED = ['ok', 'inbox_item_decided', 'relation_endpoint_pending', 'inbox_item_not_decided'];

  it('Konzept annehmen (bestätigt die Beziehung mit) und gleichzeitig die Beziehung selbst annehmen', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await world.reset();
      await world.setAutoAccept('nur_beziehungen');
      await world.concept('p', { name: 'Zweite Normalform' });
      await world.concept('t', { name: 'Erste Normalform', status: 'aktiv' });
      await world.relation('r1', { from: 'p', to: 't' });
      await world.item('i1', { kind: 'concept_new', concept: 'p' });
      await world.item('ir1', { kind: 'relation', relation: 'r1' });
      const [a, b] = (await Promise.all([accept('i1'), accept('ir1')])).map(codeOf);
      expect(a).toBe('ok');
      expect(ALLOWED).toContain(b);
      const relation = await world.relationRow('r1');
      const item = await world.itemRow('ir1');
      expect(relation.confirmed).toBe(item.status === 'angenommen');
      expect(relation.confirmed === (relation.proposalSessionId === null)).toBe(true);
    }
  });

  it('zusammenführen (hängt die Beziehung um) und gleichzeitig die Beziehung annehmen oder ablehnen', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await world.reset();
      await world.concept('p', { name: 'FD' });
      await world.concept('t', { name: 'Funktionale Abhängigkeit', status: 'aktiv' });
      await world.concept('x', { name: 'Schlüssel', status: 'aktiv' });
      await world.relation('r1', { from: 'p', to: 'x' });
      await world.relation('r2', { from: 'x', to: 'p', kind: 'beispiel_fuer' });
      await world.item('i1', { kind: 'concept_merge', concept: 'p', target: 't' });
      await world.item('ir1', { kind: 'relation', relation: 'r1' });
      await world.item('ir2', { kind: 'relation', relation: 'r2' });
      const [a, b, c] = (await Promise.all([accept('i1'), accept('ir1'), reject('ir2')])).map(codeOf);
      expect([a, c]).toEqual(['ok', 'ok']);
      expect(ALLOWED).toContain(b);
      // Die Beziehungen hängen immer am Ziel, nie mehr an der Hülle
      expect(await world.relationRow('r1')).toMatchObject({ fromId: refId('t'), toId: refId('x') });
      expect(await world.relationRow('r2')).toMatchObject({ fromId: refId('x'), toId: refId('t') });
      expect((await world.itemRow('ir1')).payload).toMatchObject({ from_concept_id: refId('t') });
      expect((await world.itemRow('i1')).decision?.cascade_item_ids.sort()).toEqual(
        [refId('ir1'), refId('ir2')].sort(),
      );
    }
  });

  it('Massenaktion und Einzelentscheidungen auf denselben Einträgen', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await world.reset();
      await world.setAutoAccept('nur_beziehungen');
      const refs: string[] = [];
      await world.concept('t', { name: 'Ziel', status: 'aktiv' });
      for (let n = 0; n < 4; n += 1) {
        await world.concept(`p${n}`, { name: `Konzept ${n}` });
        await world.relation(`r${n}`, { from: `p${n}`, to: 't' });
        await world.item(`i${n}`, { kind: 'concept_new', concept: `p${n}`, priority: n });
        await world.item(`ir${n}`, { kind: 'relation', relation: `r${n}`, priority: 1000 + n });
        refs.push(`i${n}`, `ir${n}`);
      }
      const responses = await Promise.all([
        post('/inbox/bulk', { action: 'accept', session_id: refId('s1') }),
        ...refs.map((ref) => accept(ref)),
        post('/inbox/bulk', { action: 'accept', ids: refs.map(refId).reverse() }),
      ]);
      for (const res of responses) expect(res.statusCode, res.body).toBeLessThan(500);
      for (const res of responses.slice(1, -1)) expect(ALLOWED).toContain(codeOf(res));
      for (let n = 0; n < 4; n += 1) {
        expect((await world.conceptRow(`p${n}`)).status).toBe('aktiv');
        expect((await world.relationRow(`r${n}`)).confirmed).toBe(true);
        expect((await world.itemRow(`ir${n}`)).status).toBe('angenommen');
      }
    }
  });

  it('Rückgängig einzeln und als Massenaktion gleichzeitig', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await world.reset();
      await world.setAutoAccept('nur_beziehungen');
      await world.concept('p', { name: 'Zweite Normalform' });
      await world.concept('t', { name: 'Erste Normalform', status: 'aktiv' });
      await world.relation('r1', { from: 'p', to: 't' });
      await world.item('i1', { kind: 'concept_new', concept: 'p' });
      await world.item('ir1', { kind: 'relation', relation: 'r1' });
      const before = await world.snapshot();
      expect((await accept('i1')).statusCode).toBe(200);
      const responses = await Promise.all([
        reopen('i1'),
        post('/inbox/bulk', { action: 'reopen', ids: [refId('ir1'), refId('i1')] }),
        reopen('ir1'),
      ]);
      for (const res of responses) expect(res.statusCode, res.body).toBeLessThan(500);
      expect(await world.snapshot()).toEqual(before);
    }
  });
});
