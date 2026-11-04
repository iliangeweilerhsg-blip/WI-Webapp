import { statSync } from 'node:fs';
import { join, posix } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';
import { apiErrorBody } from '../errors.ts';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Freundliche Hinweisseite, solange die Web-App nicht gebaut ist */
export function missingWebPage(webDir: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Studien-Gehirn – Web-App fehlt</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5; color: #222; }
  code { background: #eee; padding: 0.1rem 0.35rem; border-radius: 4px; }
</style>
</head>
<body>
<h1>Der Core läuft, aber die Web-App fehlt noch</h1>
<p>Im Ordner <code>${escapeHtml(webDir)}</code> liegt kein Static Export.</p>
<p>Bau die Web-App mit <code>pnpm --filter @sg/web build</code> und starte den Core danach neu.
Der Ordner lässt sich mit <code>SG_WEB_DIR</code> ändern.</p>
<p>Die API ist trotzdem erreichbar: <a href="/api/v1/health">/api/v1/health</a>.</p>
</body>
</html>
`;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Liefert den Static Export der Web-App unter `/` aus (VERTRAEGE §5) und setzt den
 * Not-Found-Handler:
 * - `/api/…` und alle Nicht-GET-Anfragen: 404 im `ApiError`-Format
 * - sonst die passende `.html`-Datei aus dem Export bzw. `index.html`
 * - fehlt der Export-Ordner: Hinweisseite (503)
 */
export async function registerWeb(app: FastifyInstance, config: Pick<Config, 'webDir'>): Promise<void> {
  const { webDir } = config;
  const available = isFile(join(webDir, 'index.html'));

  if (available) {
    await app.register(fastifyStatic, { root: webDir, index: ['index.html'] });
  }

  app.setNotFoundHandler(async (request, reply) => {
    const rawPath = request.url.split('?')[0] ?? '/';
    const isApi = rawPath === '/api' || rawPath.startsWith('/api/');
    const isRead = request.method === 'GET' || request.method === 'HEAD';

    if (isApi || !isRead) {
      return reply.code(404).send(apiErrorBody('not_found', 'Die Ressource wurde nicht gefunden.'));
    }

    if (!available) {
      return reply.code(503).type('text/html; charset=utf-8').send(missingWebPage(webDir));
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      return reply.code(404).send(apiErrorBody('not_found', 'Die Ressource wurde nicht gefunden.'));
    }
    const rel = posix.normalize(decoded).replace(/^\/+/, '').replace(/\/+$/, '');
    const safe = !rel.startsWith('..') && !decoded.includes('\0') && !decoded.includes('\\');
    if (!safe) {
      return reply.code(404).send(apiErrorBody('not_found', 'Die Ressource wurde nicht gefunden.'));
    }

    // Echte Dateien mit Endung (z. B. /app.js), die es nicht gibt, sind ein 404 – kein HTML
    const ext = posix.extname(rel);
    if (ext && ext !== '.html') {
      return reply.code(404).send(apiErrorBody('not_found', 'Die Ressource wurde nicht gefunden.'));
    }

    const candidates = rel ? [`${rel}.html`, `${rel}/index.html`, 'index.html'] : ['index.html'];
    const hit = candidates.find((candidate) => isFile(join(webDir, candidate))) ?? 'index.html';
    return reply.code(200).type('text/html; charset=utf-8').sendFile(hit);
  });

  if (!available) {
    app.log.warn(
      { webDir },
      'Kein Web-Export gefunden (index.html fehlt): Es wird nur die Hinweisseite ausgeliefert.',
    );
  }
}
