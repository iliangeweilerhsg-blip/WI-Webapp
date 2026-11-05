#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-empty, no-undef -- CommonJS-Messskript (Node + Browser-Kontext) */
// Frame-Messung für den Ink-Renderer (Issue #79): p95 pro Frame bei Zoom 1 und Zoom 2 mit vielen Strichen.
// Aufruf: node apps/web/scripts/ink-perf/measure.cjs [--browser chromium|webkit|firefox] [--strokes 1500]
//         [--frames 120] [--throttle 1] [--dpr 2] [--width 700] [--json]
// Siehe README.md. Playwright muss vorhanden sein (wird nicht installiert).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const browserName = opt('browser', 'chromium');
const nStrokes = Number(opt('strokes', 1500));
const nFrames = Number(opt('frames', 120));
const throttle = Number(opt('throttle', 1));
const dpr = Number(opt('dpr', 2));
const width = Number(opt('width', 700)); // CSS-Breite bei Zoom 1
const asJson = args.includes('--json');
const serve = args.includes('--serve');
const BUDGET_MS = 16.7;

const webRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(webRoot, '../..');

/** esbuild ist keine direkte Abhängigkeit: direkt oder über vite (kommt mit vitest) auflösen. */
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

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {}
  try {
    return createRequire('/opt/node-tools/x.js')('playwright');
  } catch {}
  throw new Error('playwright nicht gefunden. Siehe README.md.');
}

function loadStrokes() {
  const dir = path.join(repoRoot, 'tests/fixtures/strokes');
  const base = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const make = (i) => {
    const s = base[i % base.length];
    const copy = Math.floor(i / base.length);
    const id = `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`;
    // leicht versetzt, damit sich die Kopien über die Seite verteilen
    const dx = (copy * 37) % 300;
    const dy = (copy * 53) % 500;
    return { ...s, client_id: id, transform: [1, 0, 0, 1, dx, dy] };
  };
  const strokes = Array.from({ length: nStrokes }, (_, i) => make(i));
  const reserve = Array.from({ length: nFrames + 5 }, (_, i) => make(nStrokes + i));
  return { strokes, reserve };
}

async function bundle(outDir) {
  const esbuild = loadEsbuild();
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'harness.tsx')],
    bundle: true,
    outfile: path.join(outDir, 'harness.js'),
    format: 'iife',
    jsx: 'automatic',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    absWorkingDir: webRoot,
    logLevel: 'error',
  });
  fs.writeFileSync(
    path.join(outDir, 'index.html'),
    '<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="host"></div><script src="harness.js"></script>',
  );
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function runCase(browser, url, data, zoom, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  if (browserName === 'chromium' && throttle > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  await page.goto(url);
  await page.evaluate((cfg) => window.__start(cfg), { ...data, zoom, width });
  await page.waitForTimeout(500);
  const deltas = await page.evaluate(({ frames, mode }) => window.__measure(frames, mode), {
    frames: nFrames,
    mode,
  });
  await ctx.close();
  const s = [...deltas].sort((a, b) => a - b);
  return {
    zoom,
    mode,
    frames: deltas.length,
    p50: pct(s, 50),
    p95: pct(s, 95),
    max: s[s.length - 1],
    over: deltas.filter((d) => d > BUDGET_MS * 1.5).length,
  };
}

/** Handbetrieb: Bundle über http://localhost:8123 ausliefern (file:// würde fetch blockieren). */
async function serveManual(outDir) {
  const http = require('node:http');
  const data = loadStrokes();
  fs.writeFileSync(path.join(outDir, 'data.json'), JSON.stringify({ ...data, width, frames: nFrames }));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const name = req.url.split('?')[0].replace(/^\/$/, '/index.html').slice(1);
    const file = path.join(outDir, path.basename(name));
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res
      .writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' })
      .end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(8123, '127.0.0.1', r));
  console.log('Öffne http://localhost:8123/#manual in Chrome oder Safari. Beenden mit Strg+C.');
  await new Promise((r) => process.on('SIGINT', r));
  server.close();
}

(async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-perf-'));
  try {
    await bundle(outDir);
    if (serve) return await serveManual(outDir);
    const pw = loadPlaywright();
    const browser = await pw[browserName].launch();
    const data = loadStrokes();
    const url = 'file://' + path.join(outDir, 'index.html');
    const results = [];
    // append: pro Frame kommt ein Strich dazu (Live-Schreiben). idle: nichts ändert sich (reines Compositing).
    for (const mode of ['append', 'idle']) {
      for (const zoom of [1, 2]) results.push(await runCase(browser, url, data, zoom, mode));
    }
    const version = browser.version();
    await browser.close();
    const info = {
      browser: browserName,
      version,
      strokes: nStrokes,
      dpr,
      throttle,
      width,
      frames: nFrames,
      results,
    };
    if (asJson) return console.log(JSON.stringify(info, null, 2));
    console.log(
      `Browser ${browserName} ${version} | ${nStrokes} Striche | DPR ${dpr} | CPU-Drosselung ${throttle}x | Breite ${width}px`,
    );
    console.log('Modus   Zoom  Frames   p50 ms   p95 ms   max ms  Frames>25ms');
    for (const r of results) {
      console.log(
        `${r.mode.padEnd(7)} ${String(r.zoom).padEnd(5)} ${String(r.frames).padEnd(8)} ${r.p50.toFixed(1).padStart(6)} ${r.p95.toFixed(1).padStart(8)} ${r.max.toFixed(1).padStart(8)} ${String(r.over).padStart(8)}`,
      );
    }
    const z2 = results.find((r) => r.mode === 'append' && r.zoom === 2);
    console.log(
      z2.p95 > BUDGET_MS
        ? `Zoom 2 (append): p95 ${z2.p95.toFixed(1)} ms liegt über ${BUDGET_MS} ms.`
        : `Zoom 2 (append): p95 ${z2.p95.toFixed(1)} ms liegt im Budget (${BUDGET_MS} ms).`,
    );
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
