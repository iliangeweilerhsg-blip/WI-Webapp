import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiErrorSchema, JobListSchema, SINGLE_USER_ID, type Job } from '@sg/shared';
import { job } from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { enqueueJob, JOB_NOTIFY_CHANNEL } from '../../src/services/jobs.ts';
import { startTestApp, type TestApp } from './helpers.ts';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.handle.sql`DELETE FROM cost_entry`;
  await t.handle.sql`DELETE FROM job`;
});

/** Sammelt NOTIFY-Meldungen auf dem Kanal sg_jobs über eine eigene Verbindung */
async function listen() {
  const received: string[] = [];
  const subscription = await t.handle.sql.listen(JOB_NOTIFY_CHANNEL, (payload) => received.push(payload));
  const waitFor = async (count: number, timeoutMs = 3000) => {
    const start = Date.now();
    while (received.length < count && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return received;
  };
  return { received, waitFor, stop: () => subscription.unlisten() };
}

describe('enqueueJob', () => {
  it('legt den Job mit den Vorgaben aus VERTRAEGE §3 an', async () => {
    const dep = await t.handle.db.transaction((tx) =>
      enqueueJob(tx, { type: 'pdf.ingest', payload: { slide_deck_id: uuidv7() } }),
    );
    const sessionId = uuidv7();
    const id = await t.handle.db.transaction((tx) =>
      enqueueJob(tx, {
        type: 'embed.slides',
        payload: { deck_id: 'x' },
        priority: 5,
        dependsOn: [dep],
        sessionId,
      }),
    );

    const [row] = await t.handle.db.select().from(job).where(eq(job.id, id));
    expect(row).toMatchObject({
      id,
      userId: SINGLE_USER_ID,
      type: 'embed.slides',
      payload: { deck_id: 'x' },
      state: 'wartet',
      priority: 5,
      attempts: 0,
      maxAttempts: 3,
      dependsOn: [dep],
      sessionId,
      lockedBy: null,
      lockedAt: null,
      error: null,
      result: null,
      runAfter: null,
      deletedAt: null,
    });

    const [defaults] = await t.handle.db.select().from(job).where(eq(job.id, dep));
    expect(defaults).toMatchObject({ priority: 0, dependsOn: [], sessionId: null });
  });

  it('sendet NOTIFY sg_jobs mit der Job-ID erst nach dem Commit', async () => {
    const l = await listen();
    try {
      let idInTx = '';
      await t.handle.db.transaction(async (tx) => {
        idInTx = await enqueueJob(tx, { type: 'pdf.ingest', payload: { slide_deck_id: uuidv7() } });
        // noch nicht committet: nichts darf ankommen
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(l.received).toEqual([]);
      });
      expect(await l.waitFor(1)).toEqual([idInTx]);
    } finally {
      await l.stop();
    }
  });

  it('sendet bei Rollback weder Job noch NOTIFY', async () => {
    const l = await listen();
    try {
      await expect(
        t.handle.db.transaction(async (tx) => {
          await enqueueJob(tx, { type: 'pdf.ingest', payload: {} });
          throw new Error('fachlicher Fehler');
        }),
      ).rejects.toThrow('fachlicher Fehler');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(l.received).toEqual([]);
      expect(await t.handle.db.select().from(job)).toHaveLength(0);
    } finally {
      await l.stop();
    }
  });

  it('meldet mehrere Jobs einer Transaktion einzeln', async () => {
    const l = await listen();
    try {
      const ids = await t.handle.db.transaction(async (tx) => [
        await enqueueJob(tx, { type: 'pdf.ingest', payload: {} }),
        await enqueueJob(tx, { type: 'embed.slides', payload: {} }),
      ]);
      expect((await l.waitFor(2)).sort()).toEqual([...ids].sort());
    } finally {
      await l.stop();
    }
  });

  it('weist unbekannte Zustände per CHECK ab', async () => {
    await expect(
      t.handle
        .sql`INSERT INTO job (id, user_id, type, state) VALUES (${uuidv7()}, ${SINGLE_USER_ID}, 'pdf.ingest', 'kaputt')`,
    ).rejects.toThrow();
  });
});

describe('GET /api/v1/jobs', () => {
  async function seed(count: number, extra: { sessionId?: string; state?: string } = {}) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      // jeweils eigene Transaktion → unterschiedliche created_at
      ids.push(
        await t.handle.db.transaction((tx) =>
          enqueueJob(tx, {
            type: 'pdf.ingest',
            payload: { n: i },
            ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
          }),
        ),
      );
    }
    if (extra.state) await t.handle.sql`UPDATE job SET state = ${extra.state} WHERE id = ANY(${ids})`;
    return ids;
  }

  async function fetchPage(query: string): Promise<{ items: Job[]; next_cursor: string | null }> {
    const res = await t.request({ url: `/api/v1/jobs${query}` });
    expect(res.statusCode).toBe(200);
    return JobListSchema.parse(res.json());
  }

  it('liefert eine leere Liste ohne Jobs', async () => {
    expect(await fetchPage('')).toEqual({ items: [], next_cursor: null });
  });

  it('liefert Jobs im Format Job (neueste zuerst) mit ISO-Zeitstempeln', async () => {
    const ids = await seed(3);
    const page = await fetchPage('');
    expect(page.items.map((j) => j.id)).toEqual([...ids].reverse());
    expect(page.next_cursor).toBeNull();
    expect(page.items[0]).toMatchObject({
      state: 'wartet',
      type: 'pdf.ingest',
      priority: 0,
      depends_on: [],
      session_id: null,
      deleted_at: null,
    });
    expect(page.items[0]?.created_at).toMatch(/Z$/);
  });

  it('paginiert über Cursor ohne Lücken und Dubletten', async () => {
    const ids = await seed(7);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { items: Job[]; next_cursor: string | null } = await fetchPage(
        `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      seen.push(...page.items.map((j) => j.id));
      cursor = page.next_cursor;
      pages++;
      expect(pages).toBeLessThan(10);
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual([...ids].reverse());
  });

  it('bleibt bei identischem created_at stabil (Tie-Break über id)', async () => {
    // Alle Jobs einer Transaktion haben dasselbe now() → gleicher created_at
    const ids = await t.handle.db.transaction(async (tx) => {
      const out: string[] = [];
      for (let i = 0; i < 6; i++) out.push(await enqueueJob(tx, { type: 'pdf.ingest', payload: { i } }));
      return out;
    });
    const rows = await t.handle.sql`SELECT count(DISTINCT created_at)::int AS n FROM job`;
    expect(rows[0]?.n).toBe(1);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: Job[]; next_cursor: string | null } = await fetchPage(
        `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      seen.push(...page.items.map((j) => j.id));
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen).toEqual([...ids].reverse());
  });

  it('filtert nach session_id und state', async () => {
    const sessionId = uuidv7();
    const inSession = await seed(2, { sessionId });
    await seed(2, { state: 'fehler' });
    await seed(1);

    const bySession = await fetchPage(`?session_id=${sessionId}`);
    expect(bySession.items.map((j) => j.id).sort()).toEqual([...inSession].sort());

    const byState = await fetchPage('?state=fehler');
    expect(byState.items).toHaveLength(2);
    expect(byState.items.every((j) => j.state === 'fehler')).toBe(true);

    expect((await fetchPage(`?session_id=${sessionId}&state=fehler`)).items).toHaveLength(0);
    expect((await fetchPage('?state=wartet')).items).toHaveLength(3);
  });

  it('blendet weich gelöschte Jobs aus', async () => {
    const [keep, drop] = await seed(2);
    await t.handle.sql`UPDATE job SET deleted_at = now() WHERE id = ${drop!}`;
    expect((await fetchPage('')).items.map((j) => j.id)).toEqual([keep]);
  });

  it('weist einen kaputten Cursor mit 400 invalid_cursor ab', async () => {
    for (const cursor of ['kaputt', Buffer.from('["x","y"]').toString('base64url')]) {
      const res = await t.request({ url: `/api/v1/jobs?cursor=${cursor}` });
      expect(res.statusCode).toBe(400);
      expect(ApiErrorSchema.parse(res.json()).error.code).toBe('invalid_cursor');
    }
  });

  it('weist limit außerhalb von 1..200 mit 400 validation_failed ab', async () => {
    for (const limit of ['0', '201', 'abc']) {
      const res = await t.request({ url: `/api/v1/jobs?limit=${limit}` });
      expect(res.statusCode, limit).toBe(400);
      expect(ApiErrorSchema.parse(res.json()).error.code).toBe('validation_failed');
    }
  });
});
