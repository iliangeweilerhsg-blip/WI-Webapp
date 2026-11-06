#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-empty, no-undef -- CommonJS-Skript (Node + Browser-Kontext) */
// E2E der Suche (⌘K, T2-13) in Chromium gegen die gebaute App (Static Export) und einen kleinen Mock-Core.
// Aufruf: node apps/web/scripts/e2e-search/run.cjs [--skip-build] [--shots <Ordner>]
// Nicht Teil der CI. Playwright wird nicht installiert (ggf. NODE_PATH=/opt/node-tools/node_modules).
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const skipBuild = args.includes('--skip-build');
const shotsDir = opt('shots', '');
const webRoot = path.resolve(__dirname, '../..');
const outDir = path.join(webRoot, 'out');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
}

// ------------------------------------------------------------------ Daten (erfunden)

const SESSION_ID = '0190f6a2-0000-7000-8000-0000000000e1';
const LIVE_ID = '0190f6a2-0000-7000-8000-0000000000e2';
const DECK_ID = '0190f6a2-0000-7000-8000-0000000000d1';
const REC_ID = '0190f6a2-0000-7000-8000-0000000000f1';
const STARTED = '2026-11-04T08:00:00Z';
const REC_DURATION_MS = 1_200_000;
const SAMPLE_RATE = 8000;

async function loadFake() {
  return import(path.join(webRoot, 'test/fake-core.ts'));
}

function buildData(f) {
  const slides = f.makeSlides(DECK_ID, 3);
  const [s1, s2, s3] = slides.map((s) => ({ id: s.id, index: s.index }));
  const module = f.makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a3', name: 'Datenbanksysteme' });
  const session = f.makeSession({
    id: SESSION_ID,
    module_id: module.id,
    number: 7,
    state: 'verarbeitet',
    started_at: STARTED,
    ended_at: '2026-11-04T09:00:00Z',
    slide_deck_id: DECK_ID,
    processing: { 'audio.finalize': 'fertig', transcribe: 'fertig', 'align.log': 'fertig' },
    updated_at: '2026-11-04T09:10:00Z',
  });
  const live = f.makeSession({
    id: LIVE_ID,
    module_id: module.id,
    number: 8,
    state: 'laeuft',
    started_at: new Date().toISOString(),
    slide_deck_id: DECK_ID,
  });
  const transcript = f.makeTranscript({
    session_id: SESSION_ID,
    slide_deck_id: DECK_ID,
    slide_source: 'log',
    slide_segments: [
      f.makeSlideSegment(1, s1, 10_000, 200_000),
      f.makeSlideSegment(2, s2, 200_000, 500_000),
      f.makeSlideSegment(3, s3, 500_000, 1_200_000),
    ],
    recordings: [
      f.makeRecording({ id: REC_ID, session_id: SESSION_ID, started_ms: 0, duration_ms: REC_DURATION_MS }),
    ],
    transcripts: [f.makeTranscriptInfo({ session_id: SESSION_ID, recording_id: REC_ID })],
    lines: [
      f.makeLine(1, 10_000, 20_000, 'Heute geht es um Normalformen.', s1),
      f.makeLine(3, 200_000, 230_000, 'Die zweite Normalform ist Voraussetzung.', s2),
      f.makeLine(4, 612_000, 640_000, 'Die dritte Normalform ist klausurrelevant.', s3),
    ],
  });
  // Treffer passend zu den Daten oben (Folie 14 gibt es nicht im Foliensatz, die Seite zeigt dann „nicht gefunden“)
  const mod = { id: module.id, name: module.name, short_name: 'DBS' };
  const fixtures = [
    ...f.SEARCH_FIXTURE.filter((h) => h.kind === 'slide').map((h) => ({
      ...h,
      module: mod,
      deck_id: DECK_ID,
    })),
    {
      kind: 'transcript',
      chunk_id: '0190f6a2-0000-7000-8000-000000005004',
      score: 0.0161,
      module: mod,
      text: '… und das ist eben die dritte Normalform, das kommt auch in der Klausur …',
      session_id: SESSION_ID,
      session_number: 7,
      session_title: null,
      session_started_at: STARTED,
      t_ms: 612_000,
      t_end_ms: 640_000,
    },
    {
      kind: 'transcript',
      chunk_id: '0190f6a2-0000-7000-8000-000000005005',
      score: 0.0159,
      module: mod,
      text: 'Bei der Normalform merkt ihr euch: erst die Schlüssel, dann die Abhängigkeiten',
      session_id: SESSION_ID,
      session_number: null,
      session_title: 'Normalisierung',
      session_started_at: STARTED,
      t_ms: 95_000,
      t_end_ms: 140_000,
    },
  ];
  return { f, module, session, live, transcript, fixtures, semester: f.makeSemester(), slides };
}

// Stille als WAV (8 kHz, 8 Bit, mono), damit Chromium die Position wirklich setzen kann
function silentWav(seconds) {
  const bytes = seconds * SAMPLE_RATE;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes, 40);
  return Buffer.concat([header, Buffer.alloc(bytes, 128)]);
}

// ------------------------------------------------------------------ Server

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
};

function startServer(data) {
  const wav = silentWav(REC_DURATION_MS / 1000);
  const searchLog = [];
  const state = { failSearch: false };
  const sendJson = (res, body, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p.startsWith('/api/v1/')) {
      const api = p.slice('/api/v1'.length);
      if (api === '/health') return sendJson(res, { status: 'ok', db: 'ok', version: '0.0.0' });
      if (api === '/search') {
        searchLog.push(url.search);
        if (state.failSearch) return sendJson(res, { error: { code: 'internal', message: 'x' } }, 500);
        const q = url.searchParams.get('q') || '';
        if (!q.trim()) return sendJson(res, { error: { code: 'validation_failed', message: 'x' } }, 400);
        return sendJson(
          res,
          data.f.fixtureSearch(q, Number(url.searchParams.get('limit') || 20), data.fixtures),
        );
      }
      if (api === '/semesters') return sendJson(res, { items: [data.semester], next_cursor: null });
      if (api === '/modules') return sendJson(res, { items: [data.module], next_cursor: null });
      if (api === '/settings') return sendJson(res, data.f.makeSettings());
      if (api === '/sessions') return sendJson(res, { items: [data.session], next_cursor: null });
      if (api === `/sessions/${SESSION_ID}`) return sendJson(res, data.session);
      if (api === `/sessions/${LIVE_ID}`) return sendJson(res, data.live);
      if (api === `/sessions/${SESSION_ID}/transcript`) return sendJson(res, data.transcript);
      if (/^\/slides\/[^/]+\/image$/.test(api)) {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        return res.end(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#e8ecf4"/><text x="800" y="470" font-size="64" text-anchor="middle" fill="#41506e">Folie</text></svg>',
        );
      }
      if (api === `/recordings/${REC_ID}/audio`) {
        const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
        if (range) {
          const start = Number(range[1]);
          const end = range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
          res.writeHead(206, {
            'Content-Type': 'audio/wav',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${wav.length}`,
            'Content-Length': end - start + 1,
          });
          return res.end(wav.subarray(start, end + 1));
        }
        res.writeHead(200, {
          'Content-Type': 'audio/wav',
          'Accept-Ranges': 'bytes',
          'Content-Length': wav.length,
        });
        return res.end(wav);
      }
      if (/^\/(slide-decks|exercise-sheets)\/[^/]+$/.test(api)) {
        return sendJson(res, { error: { code: 'not_found', message: 'x' } }, 404);
      }
      return sendJson(res, { items: [], next_cursor: null });
    }
    // Statische Dateien des Exports: /rueckblick → rueckblick.html
    let file = path.join(outDir, p === '/' ? 'index.html' : p);
    if (!path.extname(file)) file += '.html';
    if (!file.startsWith(outDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('nicht gefunden');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, searchLog, state })),
  );
}

// ------------------------------------------------------------------ Szenarien

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return require(require.resolve('playwright', { paths: ['/opt/node-tools/node_modules'] }));
  }
}

async function main() {
  if (!skipBuild) {
    console.log('Build …');
    const r = spawnSync('pnpm', ['--filter', '@sg/web', 'build'], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(1);
  }
  if (!fs.existsSync(path.join(outDir, 'index.html'))) {
    console.error('apps/web/out fehlt: ohne --skip-build starten');
    process.exit(1);
  }
  if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
  const fake = await loadFake();
  const data = buildData(fake);
  const { server, port, searchLog, state } = await startServer(data);
  const base = `http://127.0.0.1:${port}`;
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

  async function newPage(opts = {}) {
    const context = await browser.newContext({
      viewport: opts.viewport || { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      colorScheme: opts.theme || 'light',
    });
    // `localStorage.sg-theme` erzwingt die Darstellung unabhängig von System und Route
    await context.addInitScript((theme) => {
      try {
        localStorage.setItem('sg-theme', theme);
      } catch {}
    }, opts.theme || 'light');
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log('  pageerror:', e.message));
    return { context, page };
  }
  const options = (page) => page.locator('[role="option"]');
  async function search(page, text) {
    await page.getByRole('searchbox', { name: 'Suchbegriff' }).fill(text);
    await options(page).first().waitFor({ timeout: 8000 });
  }

  try {
    console.log('Suche öffnen, suchen, Treffer');
    {
      const { context, page } = await newPage();
      await page.goto(`${base}/`);
      await page.getByRole('button', { name: 'Suche öffnen' }).waitFor();
      check('Overlay zunächst zu', (await page.getByRole('dialog', { name: 'Suche' }).count()) === 0);
      await page.keyboard.press(`${mod}+k`);
      const dialog = page.getByRole('dialog', { name: 'Suche' });
      await dialog.waitFor();
      check('Strg+K öffnet das Overlay', await dialog.isVisible());
      const focused = await page.evaluate(
        () => document.activeElement && document.activeElement.getAttribute('aria-label'),
      );
      check('Fokus im Suchfeld', focused === 'Suchbegriff', String(focused));
      const box = await dialog.boundingBox();
      check('Breite 640 px', Math.round(box.width) === 640, String(box.width));
      check(
        'mittig',
        Math.abs(box.x + box.width / 2 - 640) < 2,
        `x=${Math.round(box.x)} w=${Math.round(box.width)}`,
      );
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, '00-leer-hell-desktop.png') });
      searchLog.length = 0;
      await page.keyboard.type('normalform', { delay: 20 });
      await options(page).first().waitFor();
      await page.waitForTimeout(200);
      check('vier Treffer', (await options(page).count()) === 4, String(await options(page).count()));
      check(
        'eine entprellte Anfrage mit limit=50',
        searchLog.length === 1 && /limit=50/.test(searchLog[0]),
        JSON.stringify(searchLog),
      );
      check('Treffer-Wörter als <mark>', (await page.locator('[role="option"] mark').count()) >= 4);
      const headings = await page.locator('[role="dialog"] h2').allTextContents();
      check('Gruppen Folien, Gesagtes', headings.join(',') === 'Folien,Gesagtes', headings.join(','));
      check(
        'mm:ss und ▶ bei Gesagtem',
        (await page.locator('[data-kind="transcript"]').first().innerText()).includes('10:12'),
      );
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, '01-treffer-hell-desktop.png') });
      await page.keyboard.press('ArrowDown');
      if (shotsDir)
        await page.screenshot({ path: path.join(shotsDir, '02-treffer-auswahl-hell-desktop.png') });
      await page.keyboard.press('Escape');
      check('Esc schließt', (await page.getByRole('dialog').count()) === 0);
      await context.close();
    }

    console.log('Enter öffnet die Folie (gleicher Tab)');
    {
      const { context, page } = await newPage();
      await page.goto(`${base}/`);
      await page.keyboard.press(`${mod}+k`);
      await search(page, 'normalform');
      await page.keyboard.press('Enter');
      await page.waitForURL(/\/dokument\?/);
      const u = new URL(page.url());
      check(
        'Ziel /dokument?typ=folien&id=…&seite=14',
        u.pathname === '/dokument' &&
          u.searchParams.get('typ') === 'folien' &&
          u.searchParams.get('id') === DECK_ID &&
          u.searchParams.get('seite') === '14',
        page.url(),
      );
      check('Overlay nach dem Öffnen zu', (await page.getByRole('dialog', { name: 'Suche' }).count()) === 0);
      await context.close();
    }

    console.log('Strg+Enter öffnet einen neuen Tab');
    {
      const { context, page } = await newPage();
      await page.goto(`${base}/`);
      await page.keyboard.press(`${mod}+k`);
      await search(page, 'normalform');
      const popup = context.waitForEvent('page');
      await page.keyboard.press(`${mod}+Enter`);
      const tab = await popup;
      await tab.waitForLoadState('domcontentloaded');
      check('neuer Tab mit /dokument', /\/dokument\?typ=folien/.test(tab.url()), tab.url());
      check('alter Tab bleibt auf /', new URL(page.url()).pathname === '/');
      await context.close();
    }

    console.log('Gesagtes → Rückblick bei t');
    {
      const { context, page } = await newPage();
      await page.goto(`${base}/`);
      await page.keyboard.press(`${mod}+k`);
      await search(page, 'normalform');
      // Folien (2) zuerst, dann Gesagtes: dritter Eintrag = höchster score der Gruppe
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForURL(/\/rueckblick\?/);
      const u = new URL(page.url());
      check(
        'Ziel /rueckblick?id=…&t=612000',
        u.pathname === '/rueckblick' &&
          u.searchParams.get('id') === SESSION_ID &&
          u.searchParams.get('t') === '612000',
        page.url(),
      );
      await page.locator('audio').first().waitFor({ state: 'attached' });
      await page.waitForFunction(
        () => {
          const a = document.querySelector('audio');
          return a && Math.abs(a.currentTime - 612) < 1;
        },
        null,
        { timeout: 10000 },
      );
      const audio = await page.evaluate(() => {
        const a = document.querySelector('audio');
        return { t: a.currentTime, paused: a.paused };
      });
      check('Audio steht bei 612 s (t − started_ms)', Math.abs(audio.t - 612) < 1, String(audio.t));
      check('kein Autoplay', audio.paused === true);
      await page.getByTestId('review-slide-counter').waitFor();
      const counter = await page.getByTestId('review-slide-counter').innerText();
      check('Folie zur Stelle (Folie 3)', /Folie 3 von 3/.test(counter), counter);
      const active = await page.locator('[data-testid="transcript-line"][aria-current="true"]').innerText();
      check('Zeile an der Stelle markiert', /dritte Normalform/.test(active), active);
      if (shotsDir)
        await page.screenshot({ path: path.join(shotsDir, '06-rueckblick-sprung-hell-desktop.png') });
      await context.close();
    }

    console.log('Zustände');
    {
      const { context, page } = await newPage();
      await page.goto(`${base}/`);
      await page.keyboard.press(`${mod}+k`);
      await page.keyboard.type('zzzz');
      await page.getByText('Nichts gefunden').waitFor();
      check('Nichts gefunden', true);
      await page.getByRole('searchbox').fill('normalform fach:XYZ');
      await page.getByText('Unbekannter Filter: fach:XYZ').waitFor();
      check('Unbekannter Filter', true);
      state.failSearch = true;
      await page.getByRole('searchbox').fill('normalform');
      await page.getByText('Suche gerade nicht erreichbar').waitFor();
      check('Fehlerzeile', true);
      state.failSearch = false;
      await page.getByRole('searchbox').fill('normalform typ:folie');
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-kind="transcript"]').length === 0 &&
          document.querySelectorAll('[role="option"]').length === 2,
      );
      check('typ:folie zeigt nur Folien', true);
      await context.close();
    }

    if (shotsDir) {
      console.log('Screenshots');
      const shots = [
        [
          '03-treffer-dunkel-desktop.png',
          'dunkel-desktop',
          { theme: 'dark', viewport: { width: 1280, height: 800 } },
        ],
        [
          '04-treffer-hell-schmal.png',
          'hell-schmal',
          { theme: 'light', viewport: { width: 390, height: 800 } },
        ],
        [
          '05-treffer-dunkel-schmal.png',
          'dunkel-schmal',
          { theme: 'dark', viewport: { width: 390, height: 800 } },
        ],
      ];
      for (const [file, name, o] of shots) {
        const { context, page } = await newPage(o);
        await page.goto(`${base}/`);
        await page.keyboard.press(`${mod}+k`);
        await search(page, 'normalform');
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(shotsDir, file) });
        if (name === 'dunkel-desktop') {
          await page.getByRole('searchbox').fill('zzzz');
          await page.getByText('Nichts gefunden').waitFor();
          await page.screenshot({ path: path.join(shotsDir, '20-nichts-gefunden-dunkel-desktop.png') });
        }
        await context.close();
      }
      // Live-Dashboard: Overlay über der Notizen-Spalte
      {
        const { context, page } = await newPage({ theme: 'dark', viewport: { width: 1440, height: 860 } });
        await page.goto(`${base}/session?id=${LIVE_ID}`);
        const notes = page.locator('[data-column="notizen"]');
        const found = await notes
          .first()
          .waitFor({ timeout: 8000 })
          .then(
            () => true,
            () => false,
          );
        if (found) {
          await page.keyboard.press(`${mod}+k`);
          await search(page, 'normalform');
          const dialog = await page.getByRole('dialog', { name: 'Suche' }).boundingBox();
          const col = await notes.first().boundingBox();
          check(
            'auf /session über der Notizen-Spalte',
            dialog.x >= col.x - 1 && dialog.x + dialog.width <= col.x + col.width + 1,
            `Dialog ${Math.round(dialog.x)}–${Math.round(dialog.x + dialog.width)}, Spalte ${Math.round(col.x)}–${Math.round(col.x + col.width)}`,
          );
          await page.waitForTimeout(150);
          await page.screenshot({ path: path.join(shotsDir, '30-live-dashboard-dunkel-desktop.png') });
          const popup = context.waitForEvent('page');
          await page.keyboard.press('Enter');
          const tab = await popup;
          check(
            'auf /session öffnet Enter in neuem Tab',
            /\/dokument\?/.test(tab.url()) || tab.url() !== 'about:blank',
            tab.url(),
          );
          check('Live-Tab bleibt auf /session', new URL(page.url()).pathname === '/session');
        } else {
          console.log('  (Live-Dashboard im Mock nicht darstellbar, übersprungen)');
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} Prüfungen ok`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
