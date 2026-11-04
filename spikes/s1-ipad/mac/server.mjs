#!/usr/bin/env node
// Spike S1 + S3 – Mac-Gegenstelle (WebSocket RFC-6455 ohne Abhängigkeiten + Bonjour via dns-sd)
// Keine externen Abhängigkeiten (nur Node.js-Bordmittel).

import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const DEFAULT_PORT = 4797;
const AUTO_SHUTDOWN_MS = 60 * 60 * 1000; // 60 Minuten
const MAX_WS_MESSAGE_BYTES = 512 * 1024; // 512 KB Limit pro WebSocket-Nachricht
const MAX_WS_CONNECTIONS = 8; // S2: Höchstens 8 gleichzeitige WebSocket-Verbindungen
const SOCKET_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // S2: 5 Minuten Idle-Timeout
const MAX_POINTS_PER_STROKE = 10_000; // S2: Max. 10.000 Punkte pro Strich (240 KB)
const MAX_STROKES_PER_SESSION = 5_000; // S2: Max. 5.000 Striche pro Sitzung im Speicher
const MAX_STROKES_FILE_BYTES = 25 * 1024 * 1024; // S2: Max. 25 MB für strokes.jsonl
const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const BASE_OUTPUT_DIR = path.resolve(os.homedir(), 'StudienGehirn', 'spikes', 's1');
const htmlPath = new URL('./index.html', import.meta.url);
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

const VALID_TOOLS = new Set(['pen', 'fountain', 'pencil', 'monoline', 'marker']);
const VALID_LAYERS = new Set(['ink', 'highlight']);
const VALID_INPUT_TYPES = new Set(['pencil', 'finger']);
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

function maxOfArray(values) {
  if (!values || values.length === 0) return 0;
  let maxVal = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > maxVal) maxVal = values[i];
  }
  return Number.isFinite(maxVal) ? Math.round(maxVal * 10) / 10 : 0;
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

// --- S1: Host- und Origin-Prüfung (Schutz gegen DNS-Rebinding & Cross-Site WebSocket Hijacking) ---

function getAllowedHostnames() {
  const allowed = new Set(['localhost', '127.0.0.1', '[::1]', getBonjourHost().toLowerCase()]);
  const rawHostname = os.hostname().trim().toLowerCase();
  if (rawHostname) allowed.add(rawHostname);
  for (const item of getIpv4Addresses()) {
    allowed.add(item.address.toLowerCase());
  }
  return allowed;
}

function isAllowedHostHeader(hostHeader, listenPort) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0 || hostHeader.length > 128) {
    return false;
  }
  const lower = hostHeader.trim().toLowerCase();
  const allowedHosts = getAllowedHostnames();
  for (const h of allowedHosts) {
    if (lower === h || lower === `${h}:${listenPort}`) {
      return true;
    }
  }
  return false;
}

function isAllowedOriginHeader(originHeader, listenPort) {
  // Kein Origin-Header (z. B. native iPad-App URLSessionWebSocketTask oder Node-Testclient) -> erlaubt
  if (originHeader === undefined) {
    return true;
  }
  if (typeof originHeader !== 'string' || originHeader.length === 0 || originHeader.length > 256) {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(originHeader);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:') {
    return false;
  }
  return isAllowedHostHeader(parsed.host, listenPort);
}

// --- S3: RFC-6455 WebSocket-Encoder & -Decoder ---

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

function encodeCloseFrame(statusCode, reason = '') {
  const reasonBytes = Buffer.from(String(reason).slice(0, 80), 'utf8');
  const payload = Buffer.alloc(2 + reasonBytes.length);
  payload.writeUInt16BE(statusCode, 0);
  reasonBytes.copy(payload, 2);
  return encodeWsFrame(0x8, payload);
}

function closeWithStatus(socket, statusCode, reason = '') {
  if (socket.destroyed) return;
  try {
    if (socket.writable) {
      socket.end(encodeCloseFrame(statusCode, reason));
    } else {
      socket.destroy();
    }
  } catch {
    socket.destroy();
  }
}

function sendWsText(socket, text) {
  if (socket.destroyed || !socket.writable) return;
  const payload = Buffer.from(text, 'utf8');
  socket.write(encodeWsFrame(0x1, payload));
}

function sendWsJson(socket, obj) {
  sendWsText(socket, JSON.stringify(obj));
}

const KNOWN_OPCODES = new Set([0x0, 0x1, 0x2, 0x8, 0x9, 0x0a]);

/**
 * Dekodiert RFC-6455-Client-Frames mit strikter Protokollprüfung:
 * - RSV-Bits != 0 -> Fehler 1002
 * - Unbekannter Opcode -> Fehler 1002
 * - Client-Frame nicht maskiert (MASK=0) -> Fehler 1002
 * - Control-Frame (opcode >= 0x8) mit Payload > 125 Byte oder FIN=0 -> Fehler 1002
 * - FIN=0 (Fragmentierung) oder Opcode 0x0 (Continuation) oder 0x2 (Binär) -> Fehler 1003
 */
function decodeWsFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const byte0 = buffer[offset];
    const byte1 = buffer[offset + 1];
    const fin = (byte0 & 0x80) !== 0;
    const rsv = byte0 & 0x70;
    const opcode = byte0 & 0x0f;
    const isMasked = (byte1 & 0x80) !== 0;
    let payloadLen = byte1 & 0x7f;
    let headerLen = 2;

    if (rsv !== 0) {
      return { error: { code: 1002, reason: 'RSV-Bits muessen 0 sein' } };
    }
    if (!KNOWN_OPCODES.has(opcode)) {
      return { error: { code: 1002, reason: 'Unbekannter Opcode' } };
    }
    if (!isMasked) {
      return { error: { code: 1002, reason: 'Client-Frames muessen maskiert sein' } };
    }
    if (opcode >= 0x8) {
      if (!fin || payloadLen > 125) {
        return { error: { code: 1002, reason: 'Ungueltiger Control-Frame' } };
      }
    }

    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      const bigLen = buffer.readBigUInt64BE(offset + 2);
      if (bigLen > BigInt(MAX_WS_MESSAGE_BYTES)) {
        return { error: { code: 1009, reason: 'Nachricht zu gross' } };
      }
      payloadLen = Number(bigLen);
      headerLen = 10;
    }

    if (payloadLen > MAX_WS_MESSAGE_BYTES) {
      return { error: { code: 1009, reason: 'Nachricht zu gross' } };
    }

    if (!fin || opcode === 0x0 || opcode === 0x2) {
      return {
        error: { code: 1003, reason: 'Fragmentierte oder binaere Frames nicht unterstuetzt' },
      };
    }

    const totalFrameLen = headerLen + 4 + payloadLen;
    if (offset + totalFrameLen > buffer.length) {
      break; // Warte auf restliche TCP-Bytes
    }

    const maskOffset = offset + headerLen;
    const payloadStart = maskOffset + 4;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + payloadLen));

    for (let i = 0; i < payloadLen; i += 1) {
      payload[i] ^= buffer[maskOffset + (i & 3)];
    }

    frames.push({ opcode, payload });
    offset += totalFrameLen;
  }

  return { frames, rest: buffer.subarray(offset), error: null };
}

// --- Validierung & Bereinigung eingehender Nachrichten (08 §4.1/§4.2 & Rohwerte) ---

function validateAndSanitizeStroke(stroke) {
  if (!stroke || typeof stroke !== 'object' || Array.isArray(stroke)) {
    return { error: 'stroke muss ein Objekt sein.', sanitized: null };
  }
  if (typeof stroke.client_id !== 'string' || !CLIENT_ID_REGEX.test(stroke.client_id)) {
    return { error: 'Ungültige client_id.', sanitized: null };
  }
  if (typeof stroke.tool !== 'string' || !VALID_TOOLS.has(stroke.tool)) {
    return { error: 'Ungültiges tool.', sanitized: null };
  }
  if (typeof stroke.layer !== 'string' || !VALID_LAYERS.has(stroke.layer)) {
    return { error: 'Ungültiger layer.', sanitized: null };
  }
  if (typeof stroke.color !== 'string' || !COLOR_REGEX.test(stroke.color)) {
    return { error: 'Ungültige color.', sanitized: null };
  }
  if (
    typeof stroke.width !== 'number' ||
    !Number.isFinite(stroke.width) ||
    stroke.width <= 0 ||
    stroke.width > 500
  ) {
    return { error: 'Ungültige width.', sanitized: null };
  }
  if (
    !Array.isArray(stroke.transform) ||
    stroke.transform.length !== 6 ||
    !stroke.transform.every((v) => typeof v === 'number' && Number.isFinite(v))
  ) {
    return { error: 'transform muss ein Array aus 6 endlichen Zahlen sein.', sanitized: null };
  }
  if (
    !Array.isArray(stroke.bbox) ||
    stroke.bbox.length !== 4 ||
    !stroke.bbox.every((v) => typeof v === 'number' && Number.isFinite(v))
  ) {
    return { error: 'bbox muss ein Array aus 4 endlichen Zahlen sein.', sanitized: null };
  }
  if (
    typeof stroke.points !== 'string' ||
    stroke.points.length === 0 ||
    stroke.points.length % 4 !== 0 ||
    stroke.points.length > MAX_POINTS_PER_STROKE * 32
  ) {
    return { error: 'points muss ein gültiger Base64-String sein.', sanitized: null };
  }

  const rawBytes = Buffer.from(stroke.points, 'base64');
  if (rawBytes.length === 0 || rawBytes.length % 24 !== 0 || rawBytes.length > MAX_POINTS_PER_STROKE * 24) {
    return {
      error: 'points Base64-Dekodierung ist kein gültiges Vielfaches von 24 Bytes.',
      sanitized: null,
    };
  }

  const createdAt =
    typeof stroke.created_at === 'number' && Number.isFinite(stroke.created_at)
      ? Math.trunc(stroke.created_at)
      : Date.now();
  const tStartMs =
    typeof stroke.t_start_ms === 'number' && Number.isFinite(stroke.t_start_ms)
      ? Math.max(0, Math.trunc(stroke.t_start_ms))
      : 0;
  const tEndMs =
    typeof stroke.t_end_ms === 'number' && Number.isFinite(stroke.t_end_ms)
      ? Math.max(tStartMs, Math.trunc(stroke.t_end_ms))
      : tStartMs;

  // S2: Ausschließlich die in 08 §4.1 definierten Felder übernehmen
  const sanitized = {
    client_id: stroke.client_id,
    tool: stroke.tool,
    layer: stroke.layer,
    color: stroke.color,
    width: stroke.width,
    created_at: createdAt,
    t_start_ms: tStartMs,
    t_end_ms: tEndMs,
    transform: stroke.transform.map(Number),
    bbox: stroke.bbox.map(Number),
    points: stroke.points,
  };

  return { error: null, sanitized, pointCount: rawBytes.length / 24 };
}

function validateMetricBox(box) {
  if (!box || typeof box !== 'object' || Array.isArray(box)) return null;
  const count = Number(box.count);
  const min = Number(box.min);
  const med = Number(box.median);
  const max = Number(box.max);
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    count > 10_000_000 ||
    !Number.isFinite(min) ||
    !Number.isFinite(med) ||
    !Number.isFinite(max)
  ) {
    return null;
  }
  return { count, min, median: med, max };
}

function validateAndSanitizeRawSummaries(summaries) {
  if (!Array.isArray(summaries) || summaries.length > 50) {
    return null;
  }
  const clean = [];
  for (const item of summaries) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    if (typeof item.tool !== 'string' || !VALID_TOOLS.has(item.tool)) return null;
    if (typeof item.inputType !== 'string' || !VALID_INPUT_TYPES.has(item.inputType)) return null;
    const strokeCount = Number(item.strokeCount);
    const pointCount = Number(item.pointCount);
    if (
      !Number.isInteger(strokeCount) ||
      strokeCount < 0 ||
      strokeCount > 1_000_000 ||
      !Number.isInteger(pointCount) ||
      pointCount < 0 ||
      pointCount > 10_000_000
    ) {
      return null;
    }
    const force = validateMetricBox(item.force);
    const altitude = validateMetricBox(item.altitude);
    const azimuth = validateMetricBox(item.azimuth);
    const sizeWidth = validateMetricBox(item.sizeWidth);
    const sizeHeight = validateMetricBox(item.sizeHeight);
    if (!force || !altitude || !azimuth || !sizeWidth || !sizeHeight) {
      return null;
    }
    clean.push({
      tool: item.tool,
      inputType: item.inputType,
      strokeCount,
      pointCount,
      force,
      altitude,
      azimuth,
      sizeWidth,
      sizeHeight,
    });
  }
  return clean;
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

const wsClients = new Set();

function persistSessionSummary() {
  const summary = {
    started_at_iso: state.startedAtIso,
    updated_at_iso: new Date().toISOString(),
    bonjour_active: state.bonjourActive,
    stroke_count: state.strokes.length,
    ping_count: state.pingCount,
    latency_median_ms: median(state.latenciesMs),
    latency_p95_ms: percentile(state.latenciesMs, 95),
    latency_max_ms: maxOfArray(state.latenciesMs),
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
  try {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') {
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
      if (state.strokes.length >= MAX_STROKES_PER_SESSION) {
        sendWsJson(client.socket, {
          type: 'error',
          message: 'Maximale Strichanzahl dieser Sitzung erreicht.',
        });
        return;
      }

      const { error: validationErr, sanitized, pointCount } = validateAndSanitizeStroke(msg.stroke);
      if (validationErr || !sanitized) {
        console.warn(`[${timeStamp()}] [WARN] Ungültiger Strich abgewiesen: ${validationErr}`);
        sendWsJson(client.socket, { type: 'error', message: validationErr || 'Ungültiger Strich.' });
        return;
      }

      const tServerRecvMs = Date.now();
      const rawPenUp =
        typeof msg.t_pen_up_ms === 'number' && Number.isFinite(msg.t_pen_up_ms)
          ? msg.t_pen_up_ms
          : tServerRecvMs;

      const latencyMs = Math.round(Math.max(0, tServerRecvMs - rawPenUp) * 10) / 10;
      state.latenciesMs.push(latencyMs);

      const entry = {
        seq: state.strokes.length + 1,
        received_at_ms: tServerRecvMs,
        t_pen_up_ms: rawPenUp,
        latency_ms: latencyMs,
        point_count: pointCount,
        stroke: sanitized,
      };

      state.strokes.push(entry);

      // S2: Dateigröße von strokes.jsonl begrenzen
      const currentFileSize = existsSync(strokesLogPath) ? statSync(strokesLogPath).size : 0;
      if (currentFileSize < MAX_STROKES_FILE_BYTES) {
        appendFileSync(strokesLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
      }
      persistSessionSummary();

      const med = median(state.latenciesMs);
      const p95 = percentile(state.latenciesMs, 95);
      console.log(
        `[${timeStamp()}] [STRICH #${entry.seq}] tool=${sanitized.tool} layer=${sanitized.layer} pts=${pointCount} latenz=${latencyMs.toFixed(1)}ms (Median=${med}ms, p95=${p95}ms)`,
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
        Number.isFinite(displayLatencyMs) &&
        displayLatencyMs >= 0 &&
        displayLatencyMs <= 600_000
      ) {
        const clamped = Math.round(displayLatencyMs * 10) / 10;
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

    // 4) Rohwerte vom iPad (S4: Serverseitig strikt validiert)
    if (msg.type === 'raw_stats') {
      const cleanSummaries = validateAndSanitizeRawSummaries(msg.summaries);
      if (!cleanSummaries) {
        sendWsJson(client.socket, {
          type: 'error',
          message: 'Ungültige Struktur in raw_stats.summaries.',
        });
        return;
      }
      state.rawSummaries = cleanSummaries;
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
      if (msg.checkpoints && typeof msg.checkpoints === 'object' && !Array.isArray(msg.checkpoints)) {
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

    sendWsJson(client.socket, { type: 'error', message: 'Unbekannter Nachrichtentyp.' });
  } catch {
    sendWsJson(client.socket, { type: 'error', message: 'Interner Verarbeitungsfehler.' });
  }
}

// --- HTTP & WebSocket-Upgrade-Server ---

const { port, forceNoBonjour } = parseArgs(process.argv.slice(2));

const server = http.createServer((req, res) => {
  // S1: Host-Header gegen DNS-Rebinding prüfen
  if (!isAllowedHostHeader(req.headers.host, port)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden: Invalid Host header');
    return;
  }

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

server.headersTimeout = 10_000;
server.requestTimeout = 15_000;

server.on('upgrade', (req, socket, head) => {
  // S1: Host- und Origin-Prüfung beim WebSocket-Upgrade
  if (!isAllowedHostHeader(req.headers.host, port) || !isAllowedOriginHeader(req.headers.origin, port)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  // S2: Verbindungs-Obergrenze prüfen
  if (wsClients.size >= MAX_WS_CONNECTIONS) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  const upgrade = (req.headers.upgrade || '').toLowerCase();
  if (upgrade !== 'websocket' || typeof key !== 'string' || !key.trim()) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
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

  // S2: Idle-Timeout pro Verbindung setzen
  socket.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => {
    closeWithStatus(socket, 1001, 'Idle timeout');
  });

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

  function processIncomingChunk(chunk) {
    if (socket.destroyed) return;
    recvBuffer = Buffer.concat([recvBuffer, chunk]);
    if (recvBuffer.length > MAX_WS_MESSAGE_BYTES * 2) {
      closeWithStatus(socket, 1009, 'Pufferlimit ueberschritten');
      return;
    }

    const decoded = decodeWsFrames(recvBuffer);
    if (decoded.error) {
      closeWithStatus(socket, decoded.error.code, decoded.error.reason);
      return;
    }

    recvBuffer = decoded.rest;

    for (const frame of decoded.frames) {
      if (frame.opcode === 0x8) {
        // Close Frame (Body muss leer oder >= 2 Byte sein)
        if (frame.payload.length === 1) {
          closeWithStatus(socket, 1002, 'Ungueltiger Close-Payload');
          return;
        }
        closeWithStatus(socket, 1000, 'Normal closure');
        return;
      }
      if (frame.opcode === 0x9) {
        // Ping Frame -> Pong Frame
        socket.write(encodeWsFrame(0x0a, frame.payload));
        continue;
      }
      if (frame.opcode === 0x0a) {
        // Pong Frame ignorieren
        continue;
      }
      if (frame.opcode === 0x1) {
        // Text Frame (strikte UTF-8-Prüfung)
        let text;
        try {
          text = utf8Decoder.decode(frame.payload);
        } catch {
          closeWithStatus(socket, 1007, 'Ungueltiges UTF-8');
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          sendWsJson(socket, { type: 'error', message: 'Ungültiges JSON im Text-Frame.' });
          continue;
        }
        handleWsJsonMessage(clientEntry, parsed);
      }
    }
  }

  socket.on('data', processIncomingChunk);

  // S3: Eventuelle bereits im Upgrade-Paket mitgelieferte Bytes (`head`) sofort verarbeiten
  if (head && head.length > 0) {
    processIncomingChunk(head);
  }

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

    dnsSdProc.on('exit', (code, signal) => {
      state.bonjourActive = false;
      state.bonjourInfo = `dns-sd beendet (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
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
  console.log('  Jedes Gerät im selben WLAN kann während des Laufs Striche lesen');
  console.log('  oder senden. Nur im Heim-WLAN / Hotspot nutzen, nichts Privates schreiben!');
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
