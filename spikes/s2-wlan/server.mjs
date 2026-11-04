#!/usr/bin/env node
// Spike S2 – WLAN-Erreichbarkeitstest (iPad <-> Mac im Hörsaal / eduroam)
// Keine externen Abhängigkeiten (nur Node.js-Bordmittel).

import http from 'node:http';
import os from 'node:os';
import { readFileSync } from 'node:fs';

const DEFAULT_PORT = 4799;
const AUTO_SHUTDOWN_MS = 30 * 60 * 1000; // 30 Minuten

const htmlPath = new URL('./index.html', import.meta.url);
const indexHtml = readFileSync(htmlPath, 'utf8');

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

function formatClientIp(remoteAddress) {
  if (!remoteAddress) return 'unbekannt';
  return remoteAddress.startsWith('::ffff:') ? remoteAddress.slice(7) : remoteAddress;
}

function shortUserAgent(ua) {
  if (!ua) return 'kein User-Agent';
  return ua.length > 72 ? `${ua.slice(0, 69)}...` : ua;
}

function timeStamp() {
  return new Date().toTimeString().slice(0, 8);
}

const port = parsePort(process.argv.slice(2));
const sseClients = new Set();
const seenPingClients = new Set();

const server = http.createServer((req, res) => {
  const method = req.method ?? 'GET';
  const rawUrl = req.url ?? '/';
  const pathname = rawUrl.split('?')[0] || '/';
  const clientIp = formatClientIp(req.socket.remoteAddress);
  const ua = shortUserAgent(req.headers['user-agent']);

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end('Method Not Allowed');
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    console.log(`[${timeStamp()}] [SEITE]  ${clientIp} (${ua})`);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(method === 'HEAD' ? undefined : indexHtml);
    return;
  }

  if (pathname === '/ping') {
    if (!seenPingClients.has(clientIp)) {
      seenPingClients.add(clientIp);
      console.log(`[${timeStamp()}] [PING]   Erster Ping von ${clientIp} (${ua})`);
    }
    const body = JSON.stringify({ t_server: Date.now() });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(method === 'HEAD' ? undefined : body);
    return;
  }

  if (pathname === '/events') {
    console.log(`[${timeStamp()}] [EVENTS] Verbunden: ${clientIp} (${ua})`);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let seq = 0;
    const sendTick = () => {
      seq += 1;
      const payload = JSON.stringify({ seq, t_server: Date.now() });
      res.write(`id: ${seq}\ndata: ${payload}\n\n`);
    };

    sendTick();
    const timer = setInterval(sendTick, 1000);
    const clientEntry = { res, timer };
    sseClients.add(clientEntry);

    req.on('close', () => {
      clearInterval(timer);
      sseClients.delete(clientEntry);
      console.log(`[${timeStamp()}] [EVENTS] Getrennt:  ${clientIp} (nach ${seq} Events)`);
    });
    return;
  }

  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end('Not Found');
});

function shutdown(reason) {
  console.log(`\n[${timeStamp()}] Server wird beendet (${reason}) ...`);
  for (const client of sseClients) {
    clearInterval(client.timer);
    client.res.end();
  }
  sseClients.clear();
  server.close(() => {
    console.log(`[${timeStamp()}] Server sauber beendet.`);
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('Strg+C / SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const autoStopTimer = setTimeout(() => {
  shutdown('Automatische Abschaltung nach 30 Minuten');
}, AUTO_SHUTDOWN_MS);
autoStopTimer.unref();

server.listen(port, '0.0.0.0', () => {
  const ipv4List = getIpv4Addresses();
  const bonjourHost = getBonjourHost();

  console.log('======================================================================');
  console.log('  Studien-Gehirn · Spike S2: WLAN-Erreichbarkeitstest (iPad <-> Mac)');
  console.log('======================================================================');
  console.log('');
  console.log('  WARNUNG:');
  console.log(`  Dieser Testserver lauscht auf 0.0.0.0:${port} und ist im gesamten`);
  console.log('  aktuellen WLAN erreichbar, solange der Test läuft.');
  console.log('  -> Beenden jederzeit mit Strg+C (automatisches Ende nach 30 min).');
  console.log('');
  console.log('  1) Öffne auf dem iPad in Safari zuerst eine dieser IP-Adressen:');
  if (ipv4List.length === 0) {
    console.log('     (Keine aktive IPv4-WLAN-Adresse gefunden – prüfe die WLAN-Verbindung)');
  } else {
    for (const item of ipv4List) {
      console.log(`     -> http://${item.address}:${port}   (${item.name})`);
    }
  }
  console.log('');
  console.log('  2) Teste danach auf dem iPad auch den Bonjour-Namen (.local):');
  console.log(`     -> http://${bonjourHost}:${port}`);
  console.log('');
  console.log('  (Lokaler Test auf diesem Mac: http://127.0.0.1:' + port + ')');
  console.log('======================================================================');
  console.log(`[${timeStamp()}] Warte auf Verbindungen ...`);
});
