#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-empty, no-undef -- CommonJS-Skript (Node + Browser-Kontext) */
// E2E des Web-Sync-Clients gegen einen echten Core mit Postgres (Issue #64). Siehe README.md.
// Aufruf: node apps/web/scripts/e2e-sync/run.cjs [--skip-build] [--keep] [--port 4731] [--only a,b]
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const skipBuild = args.includes('--skip-build');
const keep = args.includes('--keep');
const PORT = Number(opt('port', 4731));
const only = opt('only', '') ? opt('only', '').split(',') : null;
const PG_ADMIN = process.env.E2E_PG_ADMIN_URL || 'postgres://sg:sg@127.0.0.1:5432/postgres';

const webRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(webRoot, '../..');
const coreRoot = path.join(repoRoot, 'services/core');
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api/v1`;

// ------------------------------------------------------------------ Hilfen

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`Zeitüberschreitung: ${label}`);
    await sleep(100);
  }
}
const hex = (n, w) => n.toString(16).padStart(w, '0');
let idCounter = 0;
/** Eindeutige UUIDv7-förmige IDs */
const uid = () => `019a${hex(Date.now() % 0xffff, 4)}-0000-7000-8000-${hex(++idCounter, 12)}`;

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {}
  throw new Error('playwright nicht gefunden (wird nicht installiert, siehe README.md)');
}

function loadEsbuild() {
  for (const base of [webRoot, repoRoot]) {
    const req = createRequire(path.join(base, 'noop.js'));
    try {
      return req('esbuild');
    } catch {}
    try {
      const vitePath = req.resolve('vite', { paths: [path.dirname(req.resolve('vitest/package.json'))] });
      return createRequire(vitePath)('esbuild');
    } catch {}
  }
  throw new Error('esbuild nicht gefunden (pnpm install ausgeführt?)');
}

function loadStrokes() {
  const dir = path.join(repoRoot, 'tests/fixtures/strokes');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}
const FIXTURE_STROKES = loadStrokes();
const strokeAt = (i) => ({ ...FIXTURE_STROKES[i % FIXTURE_STROKES.length], client_id: uid() });

async function rest(method, url, body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// ------------------------------------------------------------------ Umgebung: DB, Build, Core

const env = { dbName: `sg_e2e_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`, tmp: '', core: null };

function psql(url, sql) {
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql], { encoding: 'utf8' });
}

async function bundleHarness(webDir) {
  const esbuild = loadEsbuild();
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'harness.ts')],
    bundle: true,
    outfile: path.join(webDir, 'harness.js'),
    format: 'iife',
    target: 'es2022',
    define: {
      'process.env.NODE_ENV': '"production"',
      // wie im Next-Build, wenn die Variablen fehlen: URL aus dem Seitenursprung
      'process.env.NEXT_PUBLIC_SG_SYNC_URL': 'undefined',
      'process.env.NEXT_PUBLIC_SG_API_BASE': 'undefined',
    },
    absWorkingDir: webRoot,
    logLevel: 'error',
  });
  fs.writeFileSync(
    path.join(webDir, 'harness.html'),
    '<!doctype html><meta charset="utf-8"><title>e2e-sync</title><body><script src="harness.js"></script>',
  );
}

async function setup() {
  env.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-e2e-sync-'));
  const dbUrl = new URL(PG_ADMIN);
  dbUrl.pathname = `/${env.dbName}`;
  env.dbUrl = dbUrl.toString();
  psql(PG_ADMIN, `CREATE DATABASE ${env.dbName}`);
  console.log(`DB ${env.dbName} angelegt`);
  execFileSync('node', ['src/migrate.ts'], {
    cwd: coreRoot,
    env: { ...process.env, DATABASE_URL: env.dbUrl },
    stdio: 'inherit',
  });

  if (!skipBuild) {
    console.log('pnpm --filter @sg/web build …');
    execFileSync('pnpm', ['--filter', '@sg/web', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }
  const out = path.join(webRoot, 'out');
  if (!fs.existsSync(path.join(out, 'index.html'))) throw new Error('apps/web/out fehlt (Build?)');
  const webDir = path.join(env.tmp, 'web');
  fs.cpSync(out, webDir, { recursive: true });
  await bundleHarness(webDir);

  const dataDir = path.join(env.tmp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const log = fs.openSync(path.join(env.tmp, 'core.log'), 'a');
  env.core = spawn('node', ['src/main.ts'], {
    cwd: coreRoot,
    env: {
      ...process.env,
      DATABASE_URL: env.dbUrl,
      SG_DATA_DIR: dataDir,
      SG_CORE_PORT: String(PORT),
      SG_CORE_HOST: '127.0.0.1',
      SG_WEB_DIR: webDir,
      SG_BONJOUR: '0',
      SG_LOG_LEVEL: 'info',
    },
    stdio: ['ignore', log, log],
  });
  console.log(`Core PID ${env.core.pid} auf ${BASE} (Log: ${path.join(env.tmp, 'core.log')})`);
  await waitFor(
    async () => {
      if (env.core.exitCode !== null) throw new Error('Core ist beendet, siehe core.log');
      try {
        return (await fetch(`${API}/semesters`)).ok;
      } catch {
        return false;
      }
    },
    30_000,
    'Core erreichbar',
  );
  const semester = await rest('POST', '/semesters', { name: 'E2E' });
  const mod = await rest('POST', '/modules', { semester_id: semester.id, name: 'E2E-Modul' });
  env.moduleId = mod.id;
}

async function teardown(browser) {
  try {
    await browser?.close();
  } catch {}
  if (env.core && env.core.exitCode === null) {
    env.core.kill('SIGTERM'); // nur die eigene PID
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        try {
          env.core.kill('SIGKILL');
        } catch {}
        resolve();
      }, 12_000);
      env.core.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  if (!keep) {
    try {
      psql(PG_ADMIN, `DROP DATABASE IF EXISTS ${env.dbName} WITH (FORCE)`);
      console.log(`DB ${env.dbName} gelöscht`);
    } catch (e) {
      console.error('DB konnte nicht gelöscht werden:', e.message);
    }
    if (env.tmp) fs.rmSync(env.tmp, { recursive: true, force: true });
  } else {
    console.log(`--keep: DB ${env.dbName} und ${env.tmp} bleiben bestehen`);
  }
}

// ------------------------------------------------------------------ Seiten und Frames

/** Zeichnet alle WebSocket-Rahmen einer Seite auf (Zeit, Richtung, Nachricht). */
function trackSockets(page) {
  const sockets = [];
  page.on('websocket', (ws) => {
    const rec = { url: ws.url(), openedAt: Date.now(), frames: [], closedAt: null };
    sockets.push(rec);
    const push = (dir) => (e) => {
      let msg = null;
      try {
        msg = JSON.parse(typeof e.payload === 'string' ? e.payload : e.payload.toString());
      } catch {}
      rec.frames.push({ dir, t: Date.now(), msg });
    };
    ws.on('framesent', push('out'));
    ws.on('framereceived', push('in'));
    ws.on('close', () => (rec.closedAt = Date.now()));
  });
  page.on('pageerror', (e) => console.error('  pageerror:', e.message));
  return sockets;
}
const framesOf = (sockets, dir, type) =>
  sockets.flatMap((s) => s.frames.filter((f) => f.dir === dir && f.msg?.type === type).map((f) => f.msg));

async function openHarness(context, dbName) {
  const page = await context.newPage();
  const sockets = trackSockets(page);
  await page.goto(`${BASE}/harness.html`);
  const state = await page.evaluate((n) => window.__boot({ dbName: n }), dbName);
  return { page, sockets, state };
}

async function online(page, ms = 15_000) {
  await waitFor(
    () => page.evaluate(() => window.__h.client.connectionState === 'online'),
    ms,
    'Zustand online',
  );
}

const nbStream = (id) => `notebook:${id}`;

/** Notizbuch mit einer Seite über den Client anlegen (Strom notebook:<id>) */
async function createNotebook(page) {
  const notebookId = uid();
  const pageId = uid();
  const stream = nbStream(notebookId);
  const r = await page.evaluate(({ ops }) => window.__send(ops), {
    ops: [
      {
        stream,
        kind: 'notebook.create',
        data: {
          notebook_id: notebookId,
          module_id: env.moduleId,
          title: 'E2E',
          kind: 'frei',
          created_at: Date.now(),
        },
      },
      {
        stream,
        kind: 'page.create',
        data: {
          page_id: pageId,
          notebook_id: notebookId,
          session_id: null,
          index: 1,
          template: 'blanko',
          width_pt: 595,
          height_pt: 842,
          background_slide_id: null,
          attached_slide_id: null,
        },
      },
    ],
  });
  if (r.ok !== 2) throw new Error(`Notizbuch anlegen: ${JSON.stringify(r)}`);
  return { notebookId, pageId, stream };
}

const strokeOps = (nb, n) =>
  Array.from({ length: n }, (_, i) => ({
    stream: nb.stream,
    kind: 'stroke.add',
    data: { page_id: nb.pageId, stroke: strokeAt(i) },
  }));

const serverStrokes = (nb) => rest('GET', `/pages/${nb.pageId}/strokes`);

// ------------------------------------------------------------------ Szenarien

const scenarios = {
  /** 0: Die gebaute App verbindet sich selbst mit dem Core (SyncProvider im Static Export) */
  async app(ctx) {
    const context = await ctx.browser.newContext();
    const page = await context.newPage();
    const sockets = trackSockets(page);
    await page.goto(`${BASE}/`);
    const welcomed = await waitFor(
      () => sockets.some((s) => s.url.endsWith('/sync') && s.frames.some((f) => f.msg?.type === 'welcome')),
      15_000,
      'welcome in der echten App',
    ).catch(() => false);
    check('App (Static Export vom Core): SyncProvider verbindet und bekommt welcome', welcomed);
    await context.close();
  },

  /** 1: Ack-Reihenfolge bei vielen parallelen Operationen */
  async acks(ctx) {
    const context = await ctx.browser.newContext();
    const { page, sockets } = await openHarness(context, 'acks');
    await online(page);
    const nb = await createNotebook(page);
    const N = 120;
    const ops = strokeOps(nb, N);
    const r = await page.evaluate((o) => window.__send(o), ops);
    check(
      '120 stroke.add parallel gesendet und alle bestätigt',
      r.ok === N && r.other.length === 0,
      JSON.stringify(r),
    );
    const sent = framesOf(sockets, 'out', 'op')
      .filter((m) => m.kind === 'stroke.add')
      .map((m) => m.op_id);
    const acks = framesOf(sockets, 'in', 'ack').filter((a) => sent.includes(a.op_id));
    check(
      'Reihenfolge der acks = Reihenfolge der gesendeten Operationen',
      acks.length === N && acks.every((a, i) => a.op_id === sent[i]),
    );
    const seqs = acks.map((a) => a.seq);
    check(
      'seq der acks steigt lückenlos (3..122 nach notebook.create und page.create)',
      seqs.every((s, i) => s === i + 3),
      `${seqs[0]}..${seqs.at(-1)}`,
    );
    const st = await serverStrokes(nb);
    check(
      'Server hat 120 Striche, stream_seq = 122',
      st.strokes.length === N && st.stream_seq === N + 2,
      `${st.strokes.length}/${st.stream_seq}`,
    );
    check('Warteschlange im Client leer', (await page.evaluate(() => window.__h.client.pendingCount)) === 0);
    await context.close();
  },

  /** 2: Resume nach Verbindungsabbruch, 3: reset */
  async resumeAndReset(ctx) {
    const wctx = await ctx.browser.newContext();
    const rctx = await ctx.browser.newContext();
    const w = await openHarness(wctx, 'writer');
    await online(w.page);
    const nb = await createNotebook(w.page);
    await w.page.evaluate((o) => window.__send(o), strokeOps(nb, 3)); // seq 3..5
    const r = await openHarness(rctx, 'reader');
    await online(r.page);
    await r.page.evaluate(({ s }) => window.__follow(s, { lastSeq: 0, lastOpId: null }, null), {
      s: nb.stream,
    });
    const got = () => r.page.evaluate((s) => window.__h.received[s].map((x) => x.seq), nb.stream);
    await waitFor(async () => (await got()).length === 5, 10_000, 'Reader hat die ersten 5 Operationen');
    check('Abo ab seq 0 liefert 1..5 vollständig', JSON.stringify(await got()) === '[1,2,3,4,5]');

    // Verbindung des Readers abbrechen, während der Writer weiterschreibt
    const connsBefore = r.sockets.length;
    await r.page.evaluate(() => window.__dropSocket(4000));
    await w.page.evaluate((o) => window.__send(o), strokeOps(nb, 10)); // seq 6..15
    await waitFor(async () => (await got()).length === 15, 20_000, 'Reader holt 6..15 nach dem Abbruch nach');
    const seqs = await got();
    check(
      'Resume: 6..15 kommen nach, lückenlos und ohne Duplikate',
      seqs.every((s, i) => s === i + 1),
      seqs.join(','),
    );
    check('Resume: neue Verbindung wurde aufgebaut', r.sockets.length > connsBefore);
    const hello2 = framesOf(r.sockets.slice(connsBefore), 'out', 'hello')[0];
    const entry = hello2?.streams?.find((s) => s.stream === nb.stream);
    check(
      'Resume: hello meldet last_seq = 5 mit last_op_id',
      entry?.last_seq === 5 && typeof entry?.last_op_id === 'string',
      JSON.stringify(entry),
    );
    const welcome2 = framesOf(r.sockets.slice(connsBefore), 'in', 'welcome')[0];
    const res = welcome2?.resume?.find((x) => x.stream === nb.stream);
    check(
      'Resume: welcome sagt from_seq = 6, reset = false',
      res?.from_seq === 6 && res?.reset === false,
      JSON.stringify(res),
    );

    // reset: Client meldet eine Position, die der Server nicht kennt
    const st = await serverStrokes(nb);
    const head = { lastSeq: st.stream_seq, lastOpId: st.stream_op_id };
    const rctx2 = await ctx.browser.newContext();
    const r2 = await openHarness(rctx2, 'reader2');
    await online(r2.page);
    await r2.page.evaluate(
      ({ s, head }) =>
        window.__follow(s, { lastSeq: 99, lastOpId: '019a0000-0000-7000-8000-00000000dead' }, head),
      { s: nb.stream, head },
    );
    const resets = () => r2.page.evaluate(() => window.__h.resets);
    await waitFor(async () => (await resets()).length === 1, 10_000, 'Reset-Handler aufgerufen');
    const rs = (await resets())[0];
    check(
      'reset: Handler bekommt Strom und head_seq 15',
      rs.stream === nb.stream && rs.headSeq === 15,
      JSON.stringify(rs),
    );
    // Das Abo kommt nach dem Verbinden: Antwort ist `subscribed` (bei Abo im hello wäre es `welcome`)
    const sub = framesOf(r2.sockets, 'in', 'subscribed')[0];
    const rr = sub?.resume?.find((x) => x.stream === nb.stream);
    check(
      'reset: Server antwortet reset = true, from_seq = 1',
      rr?.reset === true && rr?.from_seq === 1,
      JSON.stringify(rr),
    );
    // Danach (nach REST-Abgleich) ab Kopf abonniert: nur neue Operationen kommen an, keine Schleife
    await w.page.evaluate((o) => window.__send(o), strokeOps(nb, 2)); // seq 16..17
    const got2 = () => r2.page.evaluate((s) => window.__h.received[s].map((x) => x.seq), nb.stream);
    await waitFor(async () => (await got2()).length >= 2, 10_000, 'Reader2 bekommt 16,17');
    await sleep(1500);
    check(
      'reset: danach nur 16,17 (kein Replay, keine Reset-Schleife)',
      JSON.stringify(await got2()) === '[16,17]' && (await resets()).length === 1,
      JSON.stringify(await got2()),
    );
    await wctx.close();
    await rctx.close();
    await rctx2.close();
  },

  /** 3: 4503 und exponentielles Backoff. Echter 4503: session.start ohne Handler (handler_missing, wiederholbar). */
  async backoff4503(ctx) {
    const context = await ctx.browser.newContext();
    const { page, sockets } = await openHarness(context, 'backoff');
    await online(page);
    const sid = uid();
    await page.evaluate(
      ({ sid, mod }) => {
        // nicht abwarten: die Operation scheitert 5-mal und landet in der Fehlerablage
        void window.__h.client
          .send({
            stream: `session:${sid}`,
            kind: 'session.start',
            data: {
              session_id: sid,
              module_id: mod,
              calendar_event_id: null,
              slide_deck_id: null,
              started_from: 'ipad',
              started_at: Date.now(),
            },
          })
          .catch(() => undefined);
      },
      { sid, mod: env.moduleId },
    );
    // Gibt es den Handler inzwischen (T1-02 / #65 gemergt), antwortet der Server mit einem anderen Fehler:
    // dann ist dieser 4503-Pfad nicht mehr erreichbar, das Szenario wird übersprungen statt zu scheitern.
    const otherAnswer = await waitFor(
      async () => {
        if (await page.evaluate(() => window.__h.client.shelved >= 1)) return 'shelved';
        const e = framesOf(sockets, 'in', 'error')[0];
        return e && !(e.code === 'internal_error' && e.details?.reason === 'handler_missing')
          ? e.code
          : false;
      },
      90_000,
      'erste Antwort auf session.start',
    );
    if (otherAnswer !== 'shelved') {
      check(
        `übersprungen: session.start hat einen Handler (Antwort ${otherAnswer}), kein 4503 über handler_missing`,
        true,
      );
      await context.close();
      return;
    }
    await waitFor(
      () => page.evaluate(() => window.__h.client.shelved === 1),
      90_000,
      'giftige Operation in der Fehlerablage',
    );
    const errors = framesOf(sockets, 'in', 'error');
    const missing = errors.filter(
      (e) => e.code === 'internal_error' && e.details?.reason === 'handler_missing',
    );
    check(
      'Server antwortet 5-mal internal_error/handler_missing (retryable, fatal)',
      missing.length === 5 && missing.every((e) => e.retryable && e.fatal),
      `${missing.length}x`,
    );
    const opens = sockets.map((s) => s.openedAt);
    const gaps = opens.slice(1, 5).map((t, i) => t - opens[i]);
    const expected = [1000, 2000, 4000, 8000];
    check(
      'Wartezeit zwischen den Versuchen wächst 1 s, 2 s, 4 s, 8 s (Jitter bis -25 %)',
      gaps.length === 4 && gaps.every((g, i) => g >= expected[i] * 0.7 && g <= expected[i] * 1.0 + 1500),
      gaps.join(' ms, ') + ' ms',
    );
    const shelf = await page.evaluate(() => window.__h.client.listShelf());
    check(
      'Fehlerablage: Eintrag mit Grund poison',
      shelf.length === 1 && shelf[0].reason.kind === 'poison',
      shelf[0]?.reason?.kind,
    );
    // Nach dem Verschieben läuft die Warteschlange weiter, und ein ack setzt das Backoff zurück
    await online(page, 40_000);
    const nb = await createNotebook(page);
    check('Danach gehen normale Operationen wieder durch (Notizbuch angelegt)', Boolean(nb.pageId));
    const before = sockets.length;
    const t0 = Date.now();
    await page.evaluate(() => window.__dropSocket(4000));
    await waitFor(() => sockets.length > before, 10_000, 'Neuverbindung nach ack');
    const wait = sockets[before].openedAt - t0;
    check(
      'Nach einem ack beginnt das Backoff von vorn (neue Verbindung nach unter 1,5 s)',
      wait < 1500,
      `${wait} ms`,
    );
    await context.close();
  },

  /** 4: Leader-Wechsel zwischen zwei Tabs (gleicher Kontext: gemeinsame IndexedDB und Web Locks) */
  async leader(ctx) {
    const context = await ctx.browser.newContext();
    const t1 = await openHarness(context, 'leader-shared');
    await online(t1.page);
    const t2 = await openHarness(context, 'leader-shared');
    const roles = async (t) =>
      t.page.evaluate(() => ({ leader: window.__h.client.leader, state: window.__h.client.connectionState }));
    await waitFor(async () => (await roles(t2)).state === 'other_tab', 5000, 'Tab 2 other_tab');
    check(
      'Tab 1 ist Leader und online, Tab 2 zeigt other_tab',
      (await roles(t1)).leader && (await roles(t2)).state === 'other_tab',
    );
    check('Nur eine Sync-Verbindung insgesamt', t1.sockets.length === 1 && t2.sockets.length === 0);

    const nb = await createNotebook(t1.page);
    let total = 0;
    let handedTotal = 0;
    let notLeaderTotal = 0;
    const notLeaderIds = [];
    // Wechsel unter Last: Der Leader schickt Striche, der andere Tab übernimmt mittendrin. Mehrere Runden, Rollen tauschen.
    const tabs = [t1, t2];
    let leaderIdx = 0;
    const ROUNDS = 10;
    for (let round = 0; round < ROUNDS; round++) {
      const cur = tabs[leaderIdx];
      const next = tabs[1 - leaderIdx];
      const ops = strokeOps(nb, 60);
      const sending = cur.page.evaluate(({ o, gap }) => window.__sendStaggered(o, gap), { o: ops, gap: 3 });
      await sleep(20 + 15 * round); // Übernahme mitten in der Folge, jede Runde an anderer Stelle
      await next.page.evaluate(() => window.__h.client.takeOver());
      const r = await sending;
      total += r.ok + r.handedOver;
      handedTotal += r.handedOver;
      notLeaderTotal += r.notLeader;
      notLeaderIds.push(...r.notLeaderIds);
      check(
        `Runde ${round + 1}: kein unerwarteter Fehler (ok ${r.ok}, übergeben ${r.handedOver}, ohne Leader ${r.notLeader})`,
        r.other.length === 0 && r.ok + r.handedOver + r.notLeader === 60,
        r.other.join('; '),
      );
      await waitFor(async () => (await roles(next)).leader, 10_000, 'neuer Leader');
      await online(next.page);
      leaderIdx = 1 - leaderIdx;
      // Warteschlange des neuen Leaders muss sich leeren (nichts bleibt liegen)
      await waitFor(
        () => next.page.evaluate(() => window.__h.client.pendingCount === 0),
        15_000,
        `Warteschlange von Tab ${2 - leaderIdx} leer`,
      ).catch(() => undefined);
    }
    const leaderTab = tabs[leaderIdx];
    const pendingEnd = await leaderTab.page.evaluate(() => window.__h.client.pendingCount);
    const st = await serverStrokes(nb);
    check(
      `Nichts geht verloren: Server hat genau die bestätigten + übergebenen Striche (${total})`,
      st.strokes.length === total && new Set(st.strokes.map((s) => s.client_id)).size === total,
      `Server ${st.strokes.length}, erwartet ${total}, davon übergeben ${handedTotal}, ohne Leader ${notLeaderTotal}`,
    );
    const stored = new Set(st.strokes.map((x) => x.client_id));
    const leaked = notLeaderIds.filter((id) => stored.has(id));
    check(
      'Abgelehnte Operationen (SyncNotLeaderError) liegen nicht auf dem Server',
      leaked.length === 0,
      `${leaked.length} doch gespeichert`,
    );
    check('Warteschlange des Leaders am Ende leer', pendingEnd === 0, String(pendingEnd));
    const old = tabs[1 - leaderIdx];
    check(
      'Alter Leader zeigt other_tab und sendet nichts',
      (await roles(old)).state === 'other_tab' && !(await roles(old)).leader,
    );

    // Leader-Tab schließt: der wartende Tab übernimmt von selbst
    await leaderTab.page.close();
    await waitFor(async () => (await roles(old)).leader, 10_000, 'Übernahme nach Schließen');
    await online(old.page);
    const r = await old.page.evaluate((o) => window.__send(o), strokeOps(nb, 3));
    check('Schließt der Leader-Tab, übernimmt der andere und sendet', r.ok === 3, JSON.stringify(r));
    await context.close();
  },
};

// ------------------------------------------------------------------ Lauf

let browser;
let tearingDown = null;
/** Einmal aufräumen (Browser, Core über die eigene PID, DB, Temp-Verzeichnis), auch bei Strg+C und SIGTERM.
 *  Alle Aufrufer warten auf dasselbe Aufräumen, damit der Prozess nicht davor endet. */
function cleanupOnce() {
  tearingDown ??= teardown(browser);
  return tearingDown;
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n${sig}: räume auf …`);
    cleanupOnce().finally(() => process.exit(sig === 'SIGINT' ? 130 : 143));
  });
}

(async () => {
  let failed = true;
  try {
    await setup();
    const { chromium } = loadPlaywright();
    // Playwright würde sonst selbst auf SIGINT/SIGTERM beenden, bevor aufgeräumt ist
    browser = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
    const ctx = { browser };
    const order = ['app', 'acks', 'resumeAndReset', 'backoff4503', 'leader'];
    for (const name of order) {
      if (only && !only.includes(name)) continue;
      console.log(`\n== ${name}`);
      try {
        await scenarios[name](ctx);
      } catch (e) {
        check(`${name}: Szenario abgebrochen`, false, e.message);
      }
    }
    const bad = results.filter((r) => !r.ok);
    console.log(`\n${results.length - bad.length}/${results.length} Prüfungen bestanden`);
    failed = bad.length > 0;
  } catch (e) {
    console.error('Lauf fehlgeschlagen:', e);
  } finally {
    await cleanupOnce();
  }
  process.exit(failed ? 1 : 0);
})();
