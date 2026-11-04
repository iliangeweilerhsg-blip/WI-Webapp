#!/usr/bin/env node
// Spike S1 + S3 – Mac-Gegenstelle (WebSocket RFC-6455 ohne Abhängigkeiten + Bonjour via dns-sd)
// Keine externen Abhängigkeiten (nur Node.js-Bordmittel).

import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const DEFAULT_PORT = 4797;
const AUTO_SHUTDOWN_MS = 60 * 60 * 1000; // 60 Minuten
const MAX_WS_MESSAGE_BYTES = 512 * 1024; // 512 KB Limit pro Nachricht
const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const BASE_OUTPUT_DIR = path.resolve(os.homedir(), 'StudienGehirn', 'spikes', 's1');
const htmlPath = new URL('./index.html', import.meta.url);

const VALID_TOOLS = new Set(['pen', 'fountain', 'pencil', 'monoline', 'marker']);
const VALID_LAYERS = new Set(['ink', 'highlight']);
const CLIENT_ID_REGEX = /^[a-zA-Z0-9_-]{1,80}$/;
const COLOR_REGEX = /^#[0-9a-fA-F]{6,8}$/;

function parseArgs(argv) {
  let port = DEFAULT_PORT;
  let forceNoBonjour = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-bonjour') {
      forceNoBonjour = true;
    } else if (arg === '--port' && argv[i + 1]) {
      const p = Number.parseInt(argv[i + 1], 10);
      if (Number.isInteger(p) && p >= 1 && p <= 65535) {
        port = p;
        i += 1;
      } else {
        console.error(`Ungültiger Port: ${argv[i + 1]}`);
        process.exit(1);
      }
    } else if (arg && arg.startsWith('--port=')) {
      const p = Number.parseInt(arg.slice('--port='.length), 10);
      if (Number.isInteger(p) && p >= 1 && p <= 65535) {
        port = p;
      } else {
        console.error(`Ungültiger Port: ${arg}`);
        process.exit(1);
      }
    }
  }
  return { port, forceNoBonjour };
}

function timeStamp() {
  return new Date().toTimeString().slice(0, 8);
}

function getIpv4Addresses() {
  const nets = os.networkInterfaces();
  const result = [];
  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        result.push({ name, address: addr.address });
      }
    }
  }
  return result;
}

function getBonjourHost() {
  const raw = os.hostname().trim();
  if (!raw) return 'localhost.local';
  const shortName = raw.split('.')[0] || raw;
  return `${shortName}.local`;
}

function percentile(values, p) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 10) / 10;
}

function median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const val = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(val * 10) / 10;
}

// --- Minimaler RFC-6455 WebSocket-Encoder & -Decoder (nur Node-Bordmittel) ---

function encodeWsFrame(opcode, payloadBuffer) {
  const len = payloadBuffer.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payloadBuffer]);
}

function sendWsText(socket, text) {
  if (socket.destroyed || !socket.writable) return;
  const payload = Buffer.from(text, 'utf8');
  socket.write(encodeWsFrame(0x1, payload));
}

function sendWsJson(socket, obj) {
  sendWsText(socket, JSON.stringify(obj));
}

/**
 * Liest alle vollständigen RFC-6455-Frames aus `buffer` und gibt `{ frames, rest }` zurück.
 */
function decodeWsFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const byte0 = buffer[offset];
    const byte1 = buffer[offset + 1];
    const opcode = byte0 & 0x0f;
    const isMasked = (byte1 & 0x80) !== 0;
    let payloadLen = byte1 & 0x7f;
    let headerLen = 2;

    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      const bigLen = buffer.readBigUInt64BE(offset + 2);
      if (bigLen > BigInt(MAX_WS_MESSAGE_BYTES)) {
        throw new Error('FRAME_TOO_LARGE');
      }
      payloadLen = Number(bigLen);
      headerLen = 10;
    }

    if (payloadLen > MAX_WS_MESSAGE_BYTES) {
      throw new Error('FRAME_TOO_LARGE');
    }

    const maskLen = isMasked ? 4 : 0;
    const totalFrameLen = headerLen + maskLen + payloadLen;
    if (offset + totalFrameLen > buffer.length) {
      break; // Warte auf restliche TCP-Bytes
    }

    const payloadStart = offset + headerLen + maskLen;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + payloadLen));

    if (isMasked) {
      const maskOffset = offset + headerLen;
      for (let i = 0; i < payloadLen; i += 1) {
        payload[i] ^= buffer[maskOffset + (i & 3)];
      }
    }

    frames.push({ opcode, payload });
    offset += totalFrameLen;
  }

  return { frames, rest: buffer.subarray(offset) };
}

// --- Validierung eingehender Striche nach 08 §4.1 / §4.2 ---

function validateStrokeObject(stroke) {
  if (!stroke || typeof stroke !== 'object') {
    return 'stroke muss ein Objekt sein.';
  }
  if (typeof stroke.client_id !== 'string' || !CLIENT_ID_REGEX.test(stroke.client_id)) {
    return 'Ungültige client_id.';
  }
  if (!VALID_TOOLS.has(stroke.tool)) {
    return `Ungültiges tool: ${String(stroke.tool)}`;
  }
  if (!VALID_LAYERS.has(stroke.layer)) {
    return `Ungültiger layer: ${String(stroke.layer)}`;
  }
  if (typeof stroke.color !== 'string' || !COLOR_REGEX.test(stroke.color)) {
    return 'Ungültige color.';
  }
  if (typeof stroke.width !== 'number' || !Number.isFinite(stroke.width) || stroke.width <= 0) {
    return 'Ungültige width.';
  }
  if (
    !Array.isArray(stroke.transform) ||
    stroke.transform.length !== 6 ||
    !stroke.transform.every((v) => typeof v === 'number' && Number.isFinite(v))
  ) {
    return 'transform muss ein Array aus 6 Zahlen sein.';
  }
  if (
    !Array.isArray(stroke.bbox) ||
    stroke.bbox.length !== 4 ||
    !stroke.bbox.every((v) => typeof v === 'number' && Number.isFinite(v))
  ) {
    return 'bbox muss ein Array aus 4 Zahlen sein.';
  }
  if (typeof stroke.points !== 'string' || stroke.points.length === 0 || stroke.points.length % 4 !== 0) {
    return 'points muss ein nicht-leerer Base64-String sein.';
  }
  const rawBytes = Buffer.from(stroke.points, 'base64');
  if (rawBytes.length === 0 || rawBytes.length % 24 !== 0) {
    return `points Base64-Dekodierung (${rawBytes.length} Bytes) ist kein Vielfaches von 24 Bytes (6 × Float32).`;
  }
  return null;
}

// --- Server-Zustand (Speicherung unter ~/StudienGehirn/spikes/s1/) ---

mkdirSync(BASE_OUTPUT_DIR, { recursive: true });
const strokesLogPath = path.resolve(BASE_OUTPUT_DIR, 'strokes.jsonl');
const rawStatsPath = path.resolve(BASE_OUTPUT_DIR, 'raw-stats.json');
const summaryPath = path.resolve(BASE_OUTPUT_DIR, 'session-summary.json');

const state = {
  startedAtIso: new Date().toISOString(),
  bonjourActive: false,
  bonjourInfo: 'Nicht gestartet',
  strokes: [],
  latenciesMs: [],
  rawSummaries: [],
  checkpoints: {
    selftest_08_4_2: null,
    bonjour_dialog: null,
    websocket_connected: false,
    camera_ok: null,
    double_tap_ok: null,
    saved_ok: null,
    loaded_ok: null,
  },
  pingCount: 0,
};

const wsClients = new Set(); // { socket, role: 'ipad' | 'viewer' }

function persistSessionSummary() {
  const summary = {
    started_at_iso: state.startedAtIso,
    updated_at_iso: new Date().toISOString(),
    bonjour_active: state.bonjourActive,
    stroke_count: state.strokes.length,
    ping_count: state.pingCount,
    latency_median_ms: median(state.latenciesMs),
    latency_p95_ms: percentile(state.latenciesMs, 95),
    latency_max_ms: state.latenciesMs.length > 0 ? Math.max(...state.latenciesMs) : 0,
    checkpoints: state.checkpoints,
    raw_summaries_count: state.rawSummaries.length,
  };
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function broadcastToAll(payload) {
  const json = JSON.stringify(payload);
  for (const client of wsClients) {
    sendWsText(client.socket, json);
  }
}

function handleWsJsonMessage(client, msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    sendWsJson(client.socket, { type: 'error', message: 'Pflichtfeld type fehlt.' });
    return;
  }

  // 1) Ping-Pong Uhrabgleich (Offset = RTT/2)
  if (msg.type === 'ping') {
    const tClientSend = Number(msg.t_client_send_ms);
    if (!Number.isFinite(tClientSend)) {
      sendWsJson(client.socket, { type: 'error', message: 't_client_send_ms ungültig.' });
      return;
    }
    state.pingCount += 1;
    state.checkpoints.websocket_connected = true;
    sendWsJson(client.socket, {
      type: 'pong',
      t_client_send_ms: tClientSend,
      t_server_ms: Date.now(),
    });
    return;
  }

  // 2) Neuer Strich vom iPad (08 §4.1/§4.2)
  if (msg.type === 'stroke.add') {
    const stroke = msg.stroke;
    const validationErr = validateStrokeObject(stroke);
    if (validationErr) {
      console.warn(`[${timeStamp()}] [WARN] Ungültiger Strich abgewiesen: ${validationErr}`);
      sendWsJson(client.socket, { type: 'error', message: validationErr });
      return;
    }

    const tServerRecvMs = Date.now();
    const tPenUpMs =
      typeof msg.t_pen_up_ms === 'number' && Number.isFinite(msg.t_pen_up_ms)
        ? msg.t_pen_up_ms
        : typeof stroke.t_pen_up_ms === 'number' && Number.isFinite(stroke.t_pen_up_ms)
          ? stroke.t_pen_up_ms
          : tServerRecvMs;

    const latencyMs = Math.round(Math.max(0, tServerRecvMs - tPenUpMs) * 10) / 10;
    state.latenciesMs.push(latencyMs);

    const pointCount = Buffer.from(stroke.points, 'base64').length / 24;
    const entry = {
      seq: state.strokes.length + 1,
      received_at_ms: tServerRecvMs,
      t_pen_up_ms: tPenUpMs,
      latency_ms: latencyMs,
      point_count: pointCount,
      stroke,
    };

    state.strokes.push(entry);
    appendFileSync(strokesLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
    persistSessionSummary();

    const med = median(state.latenciesMs);
    const p95 = percentile(state.latenciesMs, 95);
    console.log(
      `[${timeStamp()}] [STRICH #${entry.seq}] tool=${stroke.tool} layer=${stroke.layer} pts=${pointCount} latenz=${latencyMs.toFixed(1)}ms (Median=${med}ms, p95=${p95}ms)`,
    );

    broadcastToAll({
      type: 'stroke.added',
      entry,
      stats: {
        stroke_count: state.strokes.length,
        latency_median_ms: med,
        latency_p95_ms: p95,
      },
    });
    return;
  }

  // 3) Browser-Viewer meldet exakte Darstellungs-Latenz nach requestAnimationFrame
  if (msg.type === 'viewer.rendered') {
    const seq = Number(msg.seq);
    const displayLatencyMs = Number(msg.display_latency_ms);
    if (
      Number.isInteger(seq) &&
      seq >= 1 &&
      seq <= state.strokes.length &&
      Number.isFinite(displayLatencyMs)
    ) {
      const clamped = Math.round(Math.max(0, displayLatencyMs) * 10) / 10;
      state.strokes[seq - 1].latency_ms = clamped;
      state.latenciesMs[seq - 1] = clamped;
      persistSessionSummary();
      broadcastToAll({
        type: 'stats.updated',
        seq,
        latency_ms: clamped,
        stats: {
          stroke_count: state.strokes.length,
          latency_median_ms: median(state.latenciesMs),
          latency_p95_ms: percentile(state.latenciesMs, 95),
        },
      });
    }
    return;
  }

  // 4) Rohwerte vom iPad (force, altitude, azimuth, size je Werkzeug & Pencil/Finger)
  if (msg.type === 'raw_stats') {
    if (!Array.isArray(msg.summaries) || msg.summaries.length > 50) {
      sendWsJson(client.socket, { type: 'error', message: 'Ungültiges summaries-Array.' });
      return;
    }
    state.rawSummaries = msg.summaries.slice(0, 50);
    writeFileSync(
      rawStatsPath,
      `${JSON.stringify({ received_at_iso: new Date().toISOString(), summaries: state.rawSummaries }, null, 2)}\n`,
      'utf8',
    );
    persistSessionSummary();
    console.log(
      `[${timeStamp()}] [ROHWERTE] ${state.rawSummaries.length} Werkzeug-/Eingabe-Zusammenfassungen gespeichert -> ${rawStatsPath}`,
    );
    broadcastToAll({
      type: 'raw_stats.updated',
      summaries: state.rawSummaries,
    });
    return;
  }

  // 5) Prüfpunkt-Update vom iPad
  if (msg.type === 'checkpoints') {
    if (msg.checkpoints && typeof msg.checkpoints === 'object') {
      for (const key of Object.keys(state.checkpoints)) {
        if (typeof msg.checkpoints[key] === 'boolean') {
          state.checkpoints[key] = msg.checkpoints[key];
        }
      }
      state.checkpoints.websocket_connected = true;
      persistSessionSummary();
      console.log(`[${timeStamp()}] [PRÜFPUNKTE] Aktualisiert:`, JSON.stringify(state.checkpoints));
      broadcastToAll({
        type: 'checkpoints.updated',
        checkpoints: state.checkpoints,
      });
    }
    return;
  }

  sendWsJson(client.socket, { type: 'error', message: `Unbekannter Nachrichtentyp: ${msg.type}` });
}

// --- HTTP & WebSocket-Upgrade-Server ---

const { port, forceNoBonjour } = parseArgs(process.argv.slice(2));

const server = http.createServer((req, res) => {
  const method = req.method ?? 'GET';
  const rawUrl = req.url ?? '/';
  const pathname = rawUrl.split('?')[0] || '/';

  if ((method === 'GET' || method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) {
    const indexHtml = readFileSync(htmlPath, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(method === 'HEAD' ? undefined : indexHtml);
    return;
  }

  if (method === 'GET' && pathname === '/state') {
    const body = JSON.stringify({
      bonjour_active: state.bonjourActive,
      bonjour_info: state.bonjourInfo,
      output_dir: BASE_OUTPUT_DIR,
      stroke_count: state.strokes.length,
      latency_median_ms: median(state.latenciesMs),
      latency_p95_ms: percentile(state.latenciesMs, 95),
      checkpoints: state.checkpoints,
      raw_summaries: state.rawSummaries,
      strokes: state.strokes,
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const upgrade = (req.headers.upgrade || '').toLowerCase();
  if (upgrade !== 'websocket' || typeof key !== 'string' || !key.trim()) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(key.trim() + WS_MAGIC_GUID)
    .digest('base64');

  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n',
  ];
  socket.write(responseHeaders.join('\r\n'));

  const role = (req.url || '').includes('role=viewer') ? 'viewer' : 'ipad';
  const clientEntry = { socket, role };
  wsClients.add(clientEntry);

  if (role === 'ipad') {
    state.checkpoints.websocket_connected = true;
    persistSessionSummary();
    console.log(`[${timeStamp()}] [WS] iPad-Client verbunden (${req.socket.remoteAddress})`);
    broadcastToAll({
      type: 'checkpoints.updated',
      checkpoints: state.checkpoints,
    });
  }

  let recvBuffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    recvBuffer = Buffer.concat([recvBuffer, chunk]);
    if (recvBuffer.length > MAX_WS_MESSAGE_BYTES * 2) {
      socket.destroy();
      return;
    }

    let decoded;
    try {
      decoded = decodeWsFrames(recvBuffer);
    } catch {
      socket.destroy();
      return;
    }

    recvBuffer = decoded.rest;

    for (const frame of decoded.frames) {
      if (frame.opcode === 0x8) {
        // Close Frame
        socket.end(encodeWsFrame(0x8, Buffer.alloc(0)));
        return;
      }
      if (frame.opcode === 0x9) {
        // Ping Frame -> Pong Frame
        socket.write(encodeWsFrame(0x0a, frame.payload));
        continue;
      }
      if (frame.opcode === 0x1) {
        // Text Frame
        let parsed;
        try {
          parsed = JSON.parse(frame.payload.toString('utf8'));
        } catch {
          sendWsJson(socket, { type: 'error', message: 'Ungültiges JSON im Text-Frame.' });
          continue;
        }
        handleWsJsonMessage(clientEntry, parsed);
      }
    }
  });

  socket.on('close', () => {
    wsClients.delete(clientEntry);
  });

  socket.on('error', () => {
    wsClients.delete(clientEntry);
  });
});

// --- Bonjour-Registrierung via dns-sd (mit sauberem Fallback auf Linux / ohne dns-sd) ---

let dnsSdProc = null;

function startBonjourAnnouncement(listenPort) {
  if (forceNoBonjour) {
    state.bonjourActive = false;
    state.bonjourInfo = 'Deaktiviert (--no-bonjour) – manuelle IP-Eingabe aktiv';
    console.log(
      `[${timeStamp()}] [BONJOUR] Hinweis: Bonjour per --no-bonjour deaktiviert. Server läuft ohne Bonjour weiter (bitte IP manuell auf dem iPad eingeben).`,
    );
    return;
  }

  const whichRes = spawnSync('which', ['dns-sd'], { encoding: 'utf8' });
  if (whichRes.status !== 0 || !whichRes.stdout || !whichRes.stdout.trim()) {
    state.bonjourActive = false;
    state.bonjourInfo = 'dns-sd nicht vorhanden – Server läuft ohne Bonjour weiter';
    console.log(
      `[${timeStamp()}] [BONJOUR] Hinweis: 'dns-sd' wurde auf diesem System nicht gefunden (z. B. Linux). Server läuft ohne Bonjour weiter – bitte die angezeigte IP-Adresse manuell in der iPad-App eingeben.`,
    );
    return;
  }

  try {
    dnsSdProc = spawn(
      'dns-sd',
      ['-R', 'StudienGehirn-Mac', '_studiengehirn._tcp', 'local', String(listenPort)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    state.bonjourActive = true;
    state.bonjourInfo = `_studiengehirn._tcp auf Port ${listenPort} aktiv`;

    dnsSdProc.stdout.on('data', (d) => {
      const line = String(d).trim();
      if (line) {
        console.log(`[${timeStamp()}] [BONJOUR] ${line}`);
      }
    });

    dnsSdProc.on('error', (err) => {
      state.bonjourActive = false;
      state.bonjourInfo = `dns-sd Fehler (${err.message}) – nutze manuelle IP`;
      console.log(
        `[${timeStamp()}] [BONJOUR] Hinweis: dns-sd konnte nicht gestartet werden (${err.message}). Server läuft ohne Bonjour weiter.`,
      );
    });
  } catch (err) {
    state.bonjourActive = false;
    state.bonjourInfo = 'Fallback auf manuelle IP';
    console.log(
      `[${timeStamp()}] [BONJOUR] Hinweis: Start ohne Bonjour (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
}

function shutdown(reason) {
  console.log(`\n[${timeStamp()}] Server wird beendet (${reason}) ...`);
  if (dnsSdProc) {
    try {
      dnsSdProc.kill('SIGTERM');
    } catch {
      // ignore
    }
    dnsSdProc = null;
  }
  for (const client of wsClients) {
    client.socket.destroy();
  }
  wsClients.clear();
  persistSessionSummary();
  server.close(() => {
    console.log(`[${timeStamp()}] Server sauber beendet.`);
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('Strg+C / SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const autoStopTimer = setTimeout(() => {
  shutdown('Automatische Abschaltung nach 60 Minuten');
}, AUTO_SHUTDOWN_MS);
autoStopTimer.unref();

server.listen(port, '0.0.0.0', () => {
  const ipv4List = getIpv4Addresses();
  const bonjourHost = getBonjourHost();

  console.log('======================================================================');
  console.log('  Studien-Gehirn · Spike S1 + S3: Mac-Gegenstelle (iPad <-> Mac)');
  console.log('======================================================================');
  console.log('');
  console.log('  WARNUNG:');
  console.log(`  Dieser Testserver lauscht auf 0.0.0.0:${port} im aktuellen WLAN.`);
  console.log('  -> Beenden jederzeit mit Strg+C (automatisches Ende nach 60 min).');
  console.log('');
  console.log(`  1) Öffne auf diesem Mac im Browser:  http://localhost:${port}`);
  console.log('  2) iPad-App verbinden (Bonjour sucht automatisch "_studiengehirn._tcp"):');
  if (ipv4List.length === 0) {
    console.log('     (Keine aktive IPv4-WLAN-Adresse gefunden)');
  } else {
    for (const item of ipv4List) {
      console.log(`     Fallback-IP für iPad:  ${item.address}:${port}   (${item.name})`);
    }
  }
  console.log(`     Bonjour-Hostname:      ${bonjourHost}:${port}`);
  console.log(`  3) Lokale Datenablage:    ${BASE_OUTPUT_DIR}/`);
  console.log('======================================================================');

  startBonjourAnnouncement(port);
  persistSessionSummary();
});
