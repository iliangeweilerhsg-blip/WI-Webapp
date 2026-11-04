#!/usr/bin/env node
// Spike S1 + S3 – Automatisiertes Testskript für die Mac-Gegenstelle (simulierter iPad-Client)
// Startet server.mjs, prüft Ping-Pong, sendet 3 Striche aus tests/fixtures/strokes/01-handschrift-pen.json,
// prüft die gespeicherten Dateien unter ~/StudienGehirn/spikes/s1/ sowie die Sicherheits- & RFC-6455-Prüfungen
// und beendet die Gegenstelle wieder.

import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER_PATH = path.resolve(__dirname, 'server.mjs');
const FIXTURE_01_PATH = path.resolve(REPO_ROOT, 'tests', 'fixtures', 'strokes', '01-handschrift-pen.json');
// Der Test arbeitet ausschliesslich in einem temporaeren HOME und fasst das echte ~/StudienGehirn nie an.
let TEST_HOME = '';
let S1_OUT_DIR = '';

function waitForExit(proc) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve();
      return;
    }
    proc.once('exit', () => resolve());
  });
}

async function stopProcess(proc) {
  if (!proc) return;
  const exited = waitForExit(proc);
  if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM');
  const timer = setTimeout(() => proc.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
}
const TEST_PORT = 4795;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function encodeClientWsFrame(opcode, payloadBuf, { fin = true, rsv = 0, masked = true } = {}) {
  const len = payloadBuf.length;
  const maskBit = masked ? 0x80 : 0x00;
  const finBit = fin ? 0x80 : 0x00;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = finBit | ((rsv & 0x7) << 4) | (opcode & 0x0f);
    header[1] = maskBit | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = finBit | ((rsv & 0x7) << 4) | (opcode & 0x0f);
    header[1] = maskBit | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = finBit | ((rsv & 0x7) << 4) | (opcode & 0x0f);
    header[1] = maskBit | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  if (!masked) {
    return Buffer.concat([header, payloadBuf]);
  }
  const maskKey = crypto.randomBytes(4);
  const maskedPayload = Buffer.alloc(len);
  for (let i = 0; i < len; i += 1) {
    maskedPayload[i] = payloadBuf[i] ^ maskKey[i & 3];
  }
  return Buffer.concat([header, maskKey, maskedPayload]);
}

function connectWs(port, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/ws',
      headers: {
        Host: `127.0.0.1:${port}`,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key,
        ...customHeaders,
      },
    });

    req.on('response', (res) => {
      resolve({ upgraded: false, statusCode: res.statusCode });
    });

    req.on('upgrade', (_res, socket) => {
      const messages = [];
      const closeCodes = [];
      let buf = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          const opcode = buf[0] & 0x0f;
          let len = buf[1] & 0x7f;
          let hLen = 2;
          if (len === 126) {
            if (buf.length < 4) break;
            len = buf.readUInt16BE(2);
            hLen = 4;
          }
          if (buf.length < hLen + len) break;
          const payload = buf.subarray(hLen, hLen + len);
          buf = buf.subarray(hLen + len);

          if (opcode === 0x8 && payload.length >= 2) {
            closeCodes.push(payload.readUInt16BE(0));
          } else if (opcode === 0x1) {
            try {
              messages.push(JSON.parse(payload.toString('utf8')));
            } catch {
              // ignore
            }
          }
        }
      });

      resolve({
        upgraded: true,
        socket,
        messages,
        closeCodes,
        sendJson(obj) {
          const raw = Buffer.from(JSON.stringify(obj), 'utf8');
          socket.write(encodeClientWsFrame(0x1, raw));
        },
        sendRawFrame(frameBuf) {
          socket.write(frameBuf);
        },
        close() {
          socket.destroy();
        },
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  TEST_HOME = mkdtempSync(path.join(os.tmpdir(), 's1-test-'));
  S1_OUT_DIR = path.resolve(TEST_HOME, 'StudienGehirn', 'spikes', 's1');
  const childEnv = { ...process.env, HOME: TEST_HOME, USERPROFILE: TEST_HOME };
  try {
    await runTests(childEnv);
  } finally {
    await stopProcess(runState.noDnsProc);
    await stopProcess(runState.serverProc);
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
}

const runState = { noDnsProc: null, serverProc: null };

async function runTests(childEnv) {
  // 1) Linux-Fallback ohne dns-sd prüfen
  console.log('1) Prüfe Start ohne dns-sd (Linux-Fallback) ...');
  const noDnsProc = spawn(process.execPath, [SERVER_PATH, '--port', String(TEST_PORT - 1)], {
    env: { ...childEnv, PATH: '/nonexistent' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let noDnsOut = '';
  noDnsProc.stdout.on('data', (d) => {
    noDnsOut += String(d);
  });
  runState.noDnsProc = noDnsProc;
  await sleep(900);
  await stopProcess(noDnsProc);
  if (!noDnsOut.includes('ohne Bonjour weiter')) {
    throw new Error('Erwartete Meldung bei fehlendem dns-sd nicht gefunden.');
  }
  console.log('   [OK] Server läuft ohne dns-sd mit klarer Meldung weiter.');

  // 2) Gegenstelle starten
  console.log(`2) Starte Mac-Gegenstelle auf Port ${TEST_PORT} ...`);
  const serverProc = spawn(process.execPath, [SERVER_PATH, '--port', String(TEST_PORT), '--no-bonjour'], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  runState.serverProc = serverProc;
  await sleep(900);

  {
    // 3) Sicherheits- & RFC-6455-Prüfungen (S1, S3, S4, Blocker 3)
    console.log('3) Prüfe Host-/Origin-Schutz & RFC-6455-Protokollregeln ...');

    // S1: Fremder Origin muss mit 403 abgewiesen werden
    const evilOriginConn = await connectWs(TEST_PORT, { Origin: 'https://evil.example' });
    if (evilOriginConn.upgraded || evilOriginConn.statusCode !== 403) {
      throw new Error(`Fremder Origin wurde nicht mit 403 abgewiesen (Status: ${evilOriginConn.statusCode})`);
    }

    // S1: Fremder Host bei /state muss mit 403 abgewiesen werden (DNS-Rebinding)
    const dnsRebindStatus = await new Promise((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port: TEST_PORT, path: '/state', headers: { Host: 'evil.example' } },
        (res) => resolve(res.statusCode),
      );
      req.on('error', reject);
    });
    if (dnsRebindStatus !== 403) {
      throw new Error(`DNS-Rebinding Host wurde nicht mit 403 abgewiesen (Status: ${dnsRebindStatus})`);
    }

    // S3: Unmaskierter Frame -> Close 1002
    const unmaskedClient = await connectWs(TEST_PORT);
    unmaskedClient.sendRawFrame(encodeClientWsFrame(0x1, Buffer.from('{}'), { masked: false }));
    await sleep(150);
    if (!unmaskedClient.closeCodes.includes(1002)) {
      throw new Error(`Erwartet Close 1002 bei unmaskiertem Frame, erhalten: ${unmaskedClient.closeCodes}`);
    }
    unmaskedClient.close();

    // S3: FIN=0 (Fragmentierung) -> Close 1003
    const fragClient = await connectWs(TEST_PORT);
    fragClient.sendRawFrame(encodeClientWsFrame(0x1, Buffer.from('{}'), { fin: false }));
    await sleep(150);
    if (!fragClient.closeCodes.includes(1003)) {
      throw new Error(`Erwartet Close 1003 bei FIN=0, erhalten: ${fragClient.closeCodes}`);
    }
    fragClient.close();

    console.log('   [OK] S1 (Host/Origin) und S3 (RFC-6455 Maske/FIN/Close-Codes) verifiziert.');

    // 4) Simulierter iPad-Client: Ping-Pong + 3 Striche aus 01-handschrift-pen.json
    console.log(
      '4) Verbinde als iPad-Client, teste Ping-Pong & sende 3 Striche aus 01-handschrift-pen.json ...',
    );
    const ipad = await connectWs(TEST_PORT);

    // Blocker 3 Test: Böswilliges Objekt in stroke.tool darf Server nicht abstürzen lassen
    ipad.sendJson({
      type: 'stroke.add',
      stroke: { client_id: 'abc', tool: { toString: 1 } },
    });
    await sleep(100);

    // S4 Test: Ungültiges raw_stats.summaries:[{}] muss abgewiesen werden
    ipad.sendJson({ type: 'raw_stats', summaries: [{}] });
    await sleep(100);

    // Ping-Pong
    const tSend = Date.now();
    ipad.sendJson({ type: 'ping', t_client_send_ms: tSend });
    await sleep(150);
    const pong = ipad.messages.find((m) => m.type === 'pong');
    if (!pong || typeof pong.t_server_ms !== 'number') {
      throw new Error('Kein gültiges pong vom Server erhalten.');
    }

    // 3 Striche aus tests/fixtures/strokes/01-handschrift-pen.json laden & prüfen
    const fixtureStrokes = JSON.parse(readFileSync(FIXTURE_01_PATH, 'utf8')).slice(0, 3);
    const firstPtsBuf = Buffer.from(fixtureStrokes[0].points, 'base64');
    const firstAzimuth = firstPtsBuf.readFloatLE(16);
    const firstAltitude = firstPtsBuf.readFloatLE(20);
    if (Math.abs(firstAzimuth - 0.5478) > 0.001 || Math.abs(firstAltitude - 1.1322) > 0.001) {
      throw new Error(`Fixture Punkt 0 azimuth/altitude unerwartet: ${firstAzimuth} / ${firstAltitude}`);
    }

    for (let i = 0; i < fixtureStrokes.length; i += 1) {
      const strokeWithExtra = {
        ...fixtureStrokes[i],
        unexpected_field: 'wird-vom-server-gefiltert',
      };
      ipad.sendJson({
        type: 'stroke.add',
        t_pen_up_ms: Date.now() - (10 + i * 5),
        stroke: strokeWithExtra,
      });
      await sleep(120);
    }

    // Gültige Rohwerte senden
    ipad.sendJson({
      type: 'raw_stats',
      summaries: [
        {
          tool: 'pen',
          inputType: 'pencil',
          strokeCount: 3,
          pointCount: 260,
          force: { count: 260, min: 0.18, median: 0.52, max: 0.91 },
          altitude: { count: 260, min: 0.95, median: 1.13, max: 1.28 },
          azimuth: { count: 260, min: -0.6, median: 0.55, max: 1.1 },
          sizeWidth: { count: 260, min: 2.2, median: 2.4, max: 2.7 },
          sizeHeight: { count: 260, min: 2.2, median: 2.4, max: 2.7 },
        },
      ],
    });

    await sleep(250);
    ipad.close();

    // 5) Gespeicherte Dateien und /state prüfen
    console.log('5) Prüfe gespeicherte Dateien unter ~/StudienGehirn/spikes/s1/ und /state ...');
    const stateRes = await fetch(`http://127.0.0.1:${TEST_PORT}/state`, {
      headers: { Host: `127.0.0.1:${TEST_PORT}` },
    });
    const stateData = await stateRes.json();
    if (stateData.stroke_count !== 3) {
      throw new Error(`Erwartet stroke_count=3 in /state, erhalten: ${stateData.stroke_count}`);
    }

    const strokesLogPath = path.resolve(S1_OUT_DIR, 'strokes.jsonl');
    const rawStatsPath = path.resolve(S1_OUT_DIR, 'raw-stats.json');
    const summaryPath = path.resolve(S1_OUT_DIR, 'session-summary.json');

    if (!existsSync(strokesLogPath) || !existsSync(rawStatsPath) || !existsSync(summaryPath)) {
      throw new Error('Erwartete Ausgabedateien in ~/StudienGehirn/spikes/s1/ fehlen.');
    }

    const savedLines = readFileSync(strokesLogPath, 'utf8').trim().split('\n');
    if (savedLines.length !== 3) {
      throw new Error(`Erwartet 3 Zeilen in strokes.jsonl, erhalten: ${savedLines.length}`);
    }
    const firstSaved = JSON.parse(savedLines[0]);
    if ('unexpected_field' in firstSaved.stroke) {
      throw new Error('Unerwartetes Feld wurde in strokes.jsonl mitgespeichert (S2 verletzt).');
    }

    console.log(
      `   [OK] 3 Striche gespeichert & verifiziert (Latenzen: ${stateData.strokes.map((s) => `${s.latency_ms}ms`).join(', ')}, Median=${stateData.latency_median_ms}ms, p95=${stateData.latency_p95_ms}ms).`,
    );
  }

  console.log('\n[ERFOLG] Alle Funktions-, Format- und Sicherheitstests für Spike S1 + S3 bestanden.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
