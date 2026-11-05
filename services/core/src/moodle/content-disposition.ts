// Dateinamen und Content-Disposition (RFC 6266, RFC 8187) für Moodle-Dateien (08 §9.2, Review #125).
// Lesen: echter Parser statt Regex (Quotes, Escapes, `;` im Wert). Schreiben: nie roher Name im Header.

/**
 * Steuerzeichen, die nie in einen Dateinamen gehören: C0, DEL, C1 sowie unsichtbare Format- und
 * Richtungszeichen (z. B. U+202E, das `fdp.exe` als `exe.pdf` anzeigt): weiches Trennzeichen U+00AD,
 * arabisches Richtungszeichen U+061C, mongolischer Vokaltrenner U+180E, U+200B–200F, U+2028–202E,
 * U+2060–2064, U+2066–206F, BOM U+FEFF und die Interlinear-Zeichen U+FFF9–FFFB.
 */
const FILENAME_CONTROL =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb]/g;

/** Unter Windows und macOS unzulässige Zeichen (Zeichenliste wie 08 §8.1), werden zu `_` */
const FILENAME_RESERVED = /["<>|:*?]/g;

/**
 * Macht aus einem Dateinamen von Moodle einen reinen Namen ohne Pfad: Steuerzeichen raus, nur der
 * Teil nach dem letzten `/` oder `\`, führende Punkte und Leerzeichen raus (also nie `.`/`..`),
 * `" < > | : * ?` werden zu `_`. Bleibt nichts übrig: null.
 *
 * Der Name kann weiter `;`, `%`, `'` und Zeichen über U+00FF enthalten. Nicht roh in einen Header
 * einsetzen. Ausgabe nur als `filename*=UTF-8''<RFC-5987-kodiert>` plus ASCII-Ersatz.
 */
export function sanitizeFilename(raw: string): string | null {
  const withoutControls = raw.replace(FILENAME_CONTROL, '');
  const base = withoutControls.split(/[/\\]/).pop() ?? '';
  const name = base
    .replace(/^[.\s]+/, '')
    .trimEnd()
    .replace(FILENAME_RESERVED, '_');
  return name === '' ? null : name;
}

/** Geparster `Content-Disposition`-Header. Parameternamen klein geschrieben, Werte ohne Quotes */
export interface ContentDisposition {
  type: string;
  params: ReadonlyMap<string, string>;
}

/** `tchar` aus RFC 9110 5.6.2 */
const TCHAR = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]$/;

/**
 * Liest `Content-Disposition` nach RFC 6266:
 * `disposition-type *( OWS ";" OWS name OWS "=" OWS ( token / quoted-string ) )`.
 * Quoted-Strings dürfen `;` enthalten, `\x` steht für `x` (quoted-pair). Parameternamen sind
 * unabhängig von Groß-/Kleinschreibung. Syntaxfehler, nicht geschlossene Quotes und doppelte
 * Parameter (mehrdeutig, RFC 6266 4.1) ergeben null.
 */
export function parseContentDisposition(header: string): ContentDisposition | null {
  const length = header.length;
  let pos = 0;
  const skipWhitespace = () => {
    while (pos < length && (header[pos] === ' ' || header[pos] === '\t')) pos += 1;
  };
  const readToken = (): string => {
    const start = pos;
    while (pos < length && TCHAR.test(header[pos] ?? '')) pos += 1;
    return header.slice(start, pos);
  };

  skipWhitespace();
  const type = readToken().toLowerCase();
  if (type === '') return null;
  const params = new Map<string, string>();
  skipWhitespace();
  while (pos < length) {
    if (header[pos] !== ';') return null;
    pos += 1;
    skipWhitespace();
    // `attachment;` mit leerem Rest ist harmlos
    if (pos >= length) break;
    const name = readToken().toLowerCase();
    if (name === '') return null;
    skipWhitespace();
    if (header[pos] !== '=') return null;
    pos += 1;
    skipWhitespace();
    let value = '';
    if (header[pos] === '"') {
      pos += 1;
      let closed = false;
      while (pos < length) {
        const char = header[pos] ?? '';
        if (char === '\\') {
          if (pos + 1 >= length) return null;
          value += header[pos + 1];
          pos += 2;
        } else if (char === '"') {
          pos += 1;
          closed = true;
          break;
        } else {
          value += char;
          pos += 1;
        }
      }
      if (!closed) return null;
    } else {
      value = readToken();
      if (value === '') return null;
    }
    if (params.has(name)) return null;
    params.set(name, value);
    skipWhitespace();
  }
  return { type, params };
}

/** `attr-char` aus RFC 8187 3.2.1 (ohne `%`) */
const ATTR_CHAR = /^[A-Za-z0-9!#$&+\-.^_`|~]$/;
const EXT_VALUE =
  /^([A-Za-z0-9!#$%&+\-^_`{}~]+)'([A-Za-z0-9-]*)'((?:%[0-9A-Fa-f]{2}|[A-Za-z0-9!#$&+\-.^_`|~])*)$/;

/**
 * Dekodiert einen `ext-value` (RFC 8187, früher RFC 5987): `charset'sprache'wert`. Erlaubt sind
 * UTF-8 und ISO-8859-1. Ungültige Prozent-Kodierung, ungültiges UTF-8 oder ein anderer Zeichensatz
 * ergeben null.
 */
export function decodeExtValue(value: string): string | null {
  const match = EXT_VALUE.exec(value);
  if (!match) return null;
  const charset = (match[1] ?? '').toLowerCase();
  const raw = match[3] ?? '';
  const bytes: number[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === '%') {
      bytes.push(Number.parseInt(raw.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(raw.charCodeAt(index));
    }
  }
  if (charset === 'utf-8') {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
    } catch {
      return null;
    }
  }
  if (charset === 'iso-8859-1') return String.fromCharCode(...bytes);
  return null;
}

/**
 * `filename="…"` kommt über fetch als ISO-8859-1 an. Sind die Bytes gültiges UTF-8 (Moodle schickt
 * Namen roh in UTF-8), gilt die UTF-8-Lesart, sonst bleibt der Text wie er ist.
 */
function utf8IfValid(value: string): string {
  let ascii = true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0xff) return value;
    if (code >= 0x80) ascii = false;
  }
  if (ascii) return value;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'latin1'));
  } catch {
    return value;
  }
}

/**
 * Dateiname aus `Content-Disposition` (RFC 6266). `filename*` (RFC 8187) hat Vorrang, sonst
 * `filename`. Das Ergebnis ist immer mit `sanitizeFilename` bereinigt (Hinweis 1 aus #93) und wird
 * nicht weiter normalisiert (keine NFKC-Normalisierung: aus `．．／` würde sonst `../`).
 */
export function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const parsed = parseContentDisposition(disposition);
  if (!parsed) return null;
  const star = parsed.params.get('filename*');
  if (star !== undefined) {
    const decoded = decodeExtValue(star);
    const name = decoded === null ? null : sanitizeFilename(decoded);
    if (name !== null) return name;
  }
  const plain = parsed.params.get('filename');
  return plain === undefined ? null : sanitizeFilename(utf8IfValid(plain));
}

/** Kodiert einen Wert als `value-chars` (RFC 8187): UTF-8, alles außer `attr-char` als `%XX` */
export function encodeExtValue(value: string): string {
  let out = '';
  for (const byte of Buffer.from(value, 'utf8')) {
    const char = String.fromCharCode(byte);
    out +=
      byte < 0x80 && ATTR_CHAR.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/**
 * ASCII-Ersatz für `filename="…"`: nur druckbares ASCII, ohne `"`, `\` und `%` (manche Browser
 * dekodieren `%XX` im Quoted-String). Alles andere wird zu `_`.
 */
export function asciiFallback(name: string): string {
  let out = '';
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    out += code >= 0x20 && code < 0x7f && char !== '"' && char !== '\\' && char !== '%' ? char : '_';
  }
  return out;
}

/** Ersatzname, wenn nichts Brauchbares übrig bleibt */
export const FALLBACK_FILENAME = 'datei';

/**
 * Baut `Content-Disposition` für die Antwort an die Web-App. Der Name wird nie roh eingesetzt:
 * `filename="<ASCII-Ersatz>"; filename*=UTF-8''<RFC-8187-kodiert>` (Vorgabe aus dem Review von #125).
 */
export function buildContentDisposition(type: 'inline' | 'attachment', name: string): string {
  const safe = sanitizeFilename(name) ?? FALLBACK_FILENAME;
  return `${type}; filename="${asciiFallback(safe)}"; filename*=UTF-8''${encodeExtValue(safe)}`;
}
