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

const notFoundBody = () => apiErrorBody('not_found', 'Die Ressource wurde nicht gefunden.');

/**
 * Liefert den Static Export der Web-App unter `/` aus (VERTRAEGE §5).
 *
 * `@fastify/static` dient nur als `sendFile`-Helfer (`serve: false`), die Auswahl der Datei macht die
 * Route `GET /*` selbst. Reihenfolge:
 * 1. `/api…` → 404 `ApiError`
 * 2. Pfad enthält `..`, versteckte Segmente (`.git`, `.env`), `\` oder NUL → 404
 * 3. existierende Datei → diese
 * 4. Pfad mit Endung (außer `.html`) → 404
 * 5. `<pfad>.html`, `<pfad>/index.html`, sonst `index.html`
 * Fehlt der Export, zeigt jede Seite eine Hinweisseite (503).
 * Alle anderen unbekannten Routen und Methoden → 404 `ApiError`.
 */
export async function registerWeb(app: FastifyInstance, config: Pick<Config, 'webDir'>): Promise<void> {
  const { webDir } = config;
  const available = isFile(join(webDir, 'index.html'));

  app.setNotFoundHandler(async (_request, reply) => reply.code(404).send(notFoundBody()));

  if (available) {
    await app.register(fastifyStatic, { root: webDir, serve: false });
  } else {
    app.log.warn(
      { webDir },
      'Kein Web-Export gefunden (index.html fehlt): Es wird nur die Hinweisseite ausgeliefert.',
    );
  }

  app.get('/*', async (request, reply) => {
    const rawPath = request.url.split('?')[0] ?? '/';
    if (rawPath === '/api' || rawPath.startsWith('/api/')) {
      return reply.code(404).send(notFoundBody());
    }
    if (!available) {
      return reply.code(503).type('text/html; charset=utf-8').send(missingWebPage(webDir));
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      return reply.code(404).send(notFoundBody());
    }
    const segments = decoded.split('/').filter((segment) => segment !== '');
    const unsafe =
      decoded.includes('\0') || decoded.includes('\\') || segments.some((segment) => segment.startsWith('.'));
    if (unsafe) return reply.code(404).send(notFoundBody());
    const rel = segments.join('/');

    if (rel && isFile(join(webDir, rel))) return reply.sendFile(rel);

    // Dateien mit Endung (z. B. /app.js), die es nicht gibt, sind ein 404 – kein HTML
    const ext = posix.extname(rel);
    if (ext && ext !== '.html') return reply.code(404).send(notFoundBody());

    const candidates = rel ? [`${rel}.html`, `${rel}/index.html`, 'index.html'] : ['index.html'];
    const hit = candidates.find((candidate) => isFile(join(webDir, candidate))) ?? 'index.html';
    return reply.type('text/html; charset=utf-8').sendFile(hit);
  });
}
