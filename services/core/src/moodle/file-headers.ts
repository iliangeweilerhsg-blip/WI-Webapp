// Antwort-Header für GET /moodle/file (08 §9.2, Sicherheits-Header).
// Dateien aus Moodle stammen auch von anderen Personen und dürfen nie als aktive Inhalte im Origin
// des Core laufen.
import { buildContentDisposition } from './content-disposition.ts';
import type { MoodleDownload } from './client.ts';
import { nameFromRef } from './mappers.ts';

/** Diese Typen übernimmt der Core von Moodle und zeigt sie inline. Alles andere: Download */
export const INLINE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
]);

const CHARSET = /;\s*charset\s*=\s*"?([A-Za-z0-9._-]{1,40})"?/i;
/** Zeichensätze, die text/plain behalten darf. Alles andere (z. B. UTF-7) wird zu utf-8 */
const TEXT_CHARSETS: ReadonlySet<string> = new Set(['utf-8', 'us-ascii', 'iso-8859-1', 'windows-1252']);

/** Header, die nur zur Datei gehören. Bei einer Fehlerantwort statt der Datei werden sie entfernt */
export const FILE_ONLY_HEADERS = ['content-type', 'content-disposition', 'content-length'] as const;

export function fileResponseHeaders(download: MoodleDownload, ref: string): Record<string, string> {
  const essence = (download.contentType.split(';')[0] ?? '').trim().toLowerCase();
  const inline = INLINE_CONTENT_TYPES.has(essence);
  let contentType = 'application/octet-stream';
  if (inline) {
    const charset = CHARSET.exec(download.contentType)?.[1]?.toLowerCase();
    const safeCharset = charset && TEXT_CHARSETS.has(charset) ? charset : 'utf-8';
    contentType = essence === 'text/plain' ? `text/plain; charset=${safeCharset}` : essence;
  }
  const headers: Record<string, string> = {
    'content-type': contentType,
    'content-disposition': buildContentDisposition(
      inline ? 'inline' : 'attachment',
      download.filename ?? nameFromRef(ref),
    ),
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox',
    // Nur die Web-App im selben Origin darf die Datei einbetten; nichts landet in geteilten Caches
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': 'private, no-store',
  };
  if (download.contentLength !== null) headers['content-length'] = String(download.contentLength);
  return headers;
}
