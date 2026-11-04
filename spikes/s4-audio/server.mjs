#!/usr/bin/env node
// Spike S4 – Langzeit-Audioaufnahme im Browser (2h-Stabilität, Variante A vs. B, IndexedDB-Puffer)
// Keine externen Abhängigkeiten (nur Node.js-Bordmittel).
// Lauscht ausschließlich lokal auf 127.0.0.1 (Port 4798).

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4798;
const AUTO_SHUTDOWN_MS = 3 * 60 * 60 * 1000; // 3 Stunden
const MAX_BODY_BYTES = 25 * 1024 * 1024; // Max. 25 MB pro Chunk

const BASE_OUTPUT_DIR = path.resolve(os.homedir(), 'StudienGehirn', 'spikes', 's4');
const htmlPath = new URL('./index.html', import.meta.url);

const LAUF_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const SEQ_REGEX = /^\d{1,6}$/;

function parsePort(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' && argv[i + 1]) {
      const p = Number.parseInt(argv[i + 1], 10);
      if (Number.isInteger(p) && p >= 1 && p <= 65535) return p;
      console.error(`Ungültiger Port: ${argv[i + 1]} (erlaubt: 1–65535)`);
      process.exit(1);
    }
    if (arg && arg.startsWith('--port=')) {
      const val = arg.slice('--port='.length);
      const p = Number.parseInt(val, 10);
      if (Number.isInteger(p) && p >= 1 && p <= 65535) return p;
      console.error(`Ungültiger Port: ${val} (erlaubt: 1–65535)`);
      process.exit(1);
    }
  }
  return DEFAULT_PORT;
}

function timeStamp() {
  return new Date().toTimeString().slice(0, 8);
}

/**
 * Validiert `lauf` strikt gegen Path-Traversal und unerlaubte Zeichen.
 */
function validateLauf(lauf) {
  if (!lauf || typeof lauf !== 'string' || !LAUF_REGEX.test(lauf)) {
    return null;
  }
  const resolved = path.resolve(BASE_OUTPUT_DIR, lauf);
  const rel = path.relative(BASE_OUTPUT_DIR, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return { lauf, dir: resolved };
}

/**
 * Validiert `seq` strikt als nicht-negative Ganzzahl (0..999999).
 */
function validateSeq(seqRaw) {
  if (!seqRaw || typeof seqRaw !== 'string' || !SEQ_REGEX.test(seqRaw)) {
    return null;
  }
  const seq = Number.parseInt(seqRaw, 10);
  if (!Number.isInteger(seq) || seq < 0 || seq > 999999) {
    return null;
  }
  return seq;
}

function extensionForMime(mime) {
  const lower = (mime || '').toLowerCase();
  if (lower.includes('mp4') || lower.includes('aac') || lower.includes('m4a')) {
    return 'm4a';
  }
  return 'webm';
}

function parseNumberHeader(headers, name, fallback = 0) {
  const raw = headers[name];
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const port = parsePort(process.argv.slice(2));

const server = http.createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const rawUrl = req.url ?? '/';
  const pathname = rawUrl.split('?')[0] || '/';

  // 1) Statische Testseite ausliefern
  if ((method === 'GET' || method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) {
    const indexHtml = readFileSync(htmlPath, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(method === 'HEAD' ? undefined : indexHtml);
    return;
  }

  // 2) Health-Check
  if (method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { status: 'ok', t_server: Date.now() });
    return;
  }

  // 3) PUT /chunk/<lauf>/<seq>
  if (method === 'PUT' && pathname.startsWith('/chunk/')) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length !== 3 || parts[0] !== 'chunk') {
      sendJson(res, 400, { error: 'Ungültiger Pfad. Erwartet: /chunk/<lauf>/<seq>' });
      return;
    }

    const laufInfo = validateLauf(parts[1]);
    const seq = validateSeq(parts[2]);
    if (!laufInfo || seq === null) {
      sendJson(res, 400, { error: 'Ungültige Parameter für <lauf> oder <seq>.' });
      return;
    }

    let bodyBuffer;
    try {
      bodyBuffer = await readRequestBody(req, MAX_BODY_BYTES);
    } catch (err) {
      const code = err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { error: 'Fehler beim Lesen des Chunk-Bodys.' });
      return;
    }

    const mimeType = String(req.headers['x-mime-type'] || req.headers['content-type'] || 'audio/webm').slice(
      0,
      120,
    );
    const variant = String(req.headers['x-variant'] || 'A') === 'B' ? 'B' : 'A';
    const mode = String(req.headers['x-mode'] || 'sine') === 'mic' ? 'mic' : 'sine';
    const segmentId = Math.max(0, Math.trunc(parseNumberHeader(req.headers, 'x-segment-id', 0)));
    const startMs = parseNumberHeader(req.headers, 'x-start-ms', 0);
    const durationMs = parseNumberHeader(req.headers, 'x-duration-ms', 0);
    const audioStartMs = parseNumberHeader(req.headers, 'x-audio-start-ms', 0);
    const audioTimeMs = parseNumberHeader(req.headers, 'x-audio-time-ms', 0);
    const decodedDurationMs = parseNumberHeader(req.headers, 'x-decoded-duration-ms', -1);
    const leadingSilenceMs = parseNumberHeader(req.headers, 'x-leading-silence-ms', -1);
    const trailingSilenceMs = parseNumberHeader(req.headers, 'x-trailing-silence-ms', -1);
    const internalSilenceMaxMs = parseNumberHeader(req.headers, 'x-internal-silence-max-ms', 0);
    const retryCount = Math.max(0, Math.trunc(parseNumberHeader(req.headers, 'x-retry-count', 0)));

    const ext = extensionForMime(mimeType);
    const chunksDir = path.resolve(laufInfo.dir, 'chunks');
    mkdirSync(chunksDir, { recursive: true });

    const seqPadded = String(seq).padStart(5, '0');
    const fileName = `${seqPadded}.${ext}`;
    const filePath = path.resolve(chunksDir, fileName);
    const relCheck = path.relative(chunksDir, filePath);
    if (!relCheck || relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
      sendJson(res, 400, { error: 'Ungültiger Dateipfad.' });
      return;
    }

    writeFileSync(filePath, bodyBuffer);

    const receivedAtMs = Date.now();
    const receivedAtIso = new Date(receivedAtMs).toISOString();

    const record = {
      lauf: laufInfo.lauf,
      seq,
      segment_id: segmentId,
      file: `chunks/${fileName}`,
      size_bytes: bodyBuffer.length,
      variant,
      mode,
      mime_type: mimeType,
      start_ms: Math.round(startMs * 100) / 100,
      duration_ms: Math.round(durationMs * 100) / 100,
      audio_start_ms: Math.round(audioStartMs * 100) / 100,
      audio_time_ms: Math.round(audioTimeMs * 100) / 100,
      decoded_duration_ms: decodedDurationMs >= 0 ? Math.round(decodedDurationMs * 100) / 100 : null,
      leading_silence_ms: leadingSilenceMs >= 0 ? Math.round(leadingSilenceMs * 100) / 100 : null,
      trailing_silence_ms: trailingSilenceMs >= 0 ? Math.round(trailingSilenceMs * 100) / 100 : null,
      internal_silence_max_ms: Math.round(internalSilenceMaxMs * 100) / 100,
      retry_count: retryCount,
      received_at_ms: receivedAtMs,
      received_at_iso: receivedAtIso,
    };

    const manifestPath = path.resolve(laufInfo.dir, 'manifest.jsonl');
    appendFileSync(manifestPath, `${JSON.stringify(record)}\n`, 'utf8');

    console.log(
      `[${timeStamp()}] [CHUNK]  lauf=${laufInfo.lauf} seq=${seqPadded} (${bodyBuffer.length} B, start=${record.start_ms.toFixed(0)}ms, dur=${record.duration_ms.toFixed(0)}ms, retries=${retryCount})`,
    );

    sendJson(res, 200, {
      ok: true,
      lauf: laufInfo.lauf,
      seq,
      size_bytes: bodyBuffer.length,
      received_at_ms: receivedAtMs,
    });
    return;
  }

  // 4) POST /finish/<lauf>
  if (method === 'POST' && pathname.startsWith('/finish/')) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || parts[0] !== 'finish') {
      sendJson(res, 400, { error: 'Ungültiger Pfad. Erwartet: /finish/<lauf>' });
      return;
    }

    const laufInfo = validateLauf(parts[1]);
    if (!laufInfo) {
      sendJson(res, 400, { error: 'Ungültiger Parameter für <lauf>.' });
      return;
    }

    let bodyBuffer;
    try {
      bodyBuffer = await readRequestBody(req, 1024 * 1024);
    } catch {
      sendJson(res, 400, { error: 'Fehler beim Lesen des Finish-Bodys.' });
      return;
    }

    let clientSummary;
    try {
      clientSummary = JSON.parse(bodyBuffer.toString('utf8') || '{}');
    } catch {
      sendJson(res, 400, { error: 'Ungültiges JSON im Finish-Body.' });
      return;
    }

    mkdirSync(laufInfo.dir, { recursive: true });
    const summaryPath = path.resolve(laufInfo.dir, 'summary.json');
    const summaryData = {
      ...clientSummary,
      lauf: laufInfo.lauf,
      finished_at_iso: new Date().toISOString(),
      user_agent: String(req.headers['user-agent'] || ''),
    };
    writeFileSync(summaryPath, `${JSON.stringify(summaryData, null, 2)}\n`, 'utf8');

    console.log(`[${timeStamp()}] [FINISH] lauf=${laufInfo.lauf} abgeschlossen -> ${summaryPath}`);
    sendJson(res, 200, { ok: true, lauf: laufInfo.lauf, summary_path: summaryPath });
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
});

function shutdown(reason) {
  console.log(`\n[${timeStamp()}] Server wird beendet (${reason}) ...`);
  server.close(() => {
    console.log(`[${timeStamp()}] Server sauber beendet.`);
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('Strg+C / SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const autoStopTimer = setTimeout(() => {
  shutdown('Automatische Abschaltung nach 3 Stunden');
}, AUTO_SHUTDOWN_MS);
autoStopTimer.unref();

if (!existsSync(BASE_OUTPUT_DIR)) {
  mkdirSync(BASE_OUTPUT_DIR, { recursive: true });
}

server.listen(port, HOST, () => {
  console.log('======================================================================');
  console.log('  Studien-Gehirn · Spike S4: Browser-Audioaufnahme-Testserver');
  console.log('======================================================================');
  console.log(`  Adresse (nur lokal):  http://${HOST}:${port}`);
  console.log(`  Alternativ im Browser: http://localhost:${port}`);
  console.log(`  Zielverzeichnis:      ${BASE_OUTPUT_DIR}/<lauf>/`);
  console.log('  Automatischer Stopp:  nach 3 Stunden (oder jederzeit mit Strg+C)');
  console.log('======================================================================');
  console.log(`[${timeStamp()}] Bereit für Aufnahmeläufe ...`);
});
