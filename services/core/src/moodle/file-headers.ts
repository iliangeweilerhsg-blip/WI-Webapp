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

export function fileResponseHeaders(download: MoodleDownload, ref: string): Record<string, string> {
  const essence = (download.contentType.split(';')[0] ?? '').trim().toLowerCase();
  const inline = INLINE_CONTENT_TYPES.has(essence);
  let contentType = 'application/octet-stream';
  if (inline) {
    const charset = CHARSET.exec(download.contentType)?.[1];
    contentType = essence === 'text/plain' ? `text/plain; charset=${charset ?? 'utf-8'}` : essence;
  }
  const headers: Record<string, string> = {
    'content-type': contentType,
    'content-disposition': buildContentDisposition(
      inline ? 'inline' : 'attachment',
      download.filename ?? nameFromRef(ref),
    ),
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox',
  };
  if (download.contentLength !== null) headers['content-length'] = String(download.contentLength);
  return headers;
}
