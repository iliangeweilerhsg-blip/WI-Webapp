// T1-22: Content-Disposition nach RFC 6266 lesen und sicher schreiben, dazu Hilfen der Lese-Endpunkte
import { describe, expect, it } from 'vitest';
import {
  asciiFallback,
  buildContentDisposition,
  decodeExtValue,
  encodeExtValue,
  filenameFrom,
  parseContentDisposition,
} from '../../src/moodle/content-disposition.ts';
import { scrubToken } from '../../src/moodle/client.ts';
import { calendarDate, mapFile, nameFromRef, safeUrl, timestamp } from '../../src/moodle/mappers.ts';
import { MoodleFileRegistry } from '../../src/moodle/reader.ts';

const params = (header: string) => Object.fromEntries(parseContentDisposition(header)?.params ?? []);

describe('parseContentDisposition (RFC 6266)', () => {
  it('Typ und Parameter, Namen ohne Groß-/Kleinschreibung, Leerraum um ; und =', () => {
    expect(parseContentDisposition('Attachment ;  FileName = "a.pdf" ;size=12')).toEqual({
      type: 'attachment',
      params: new Map([
        ['filename', 'a.pdf'],
        ['size', '12'],
      ]),
    });
    expect(params('inline; filename=bericht.pdf')).toEqual({ filename: 'bericht.pdf' });
    expect(parseContentDisposition('inline')).toEqual({ type: 'inline', params: new Map() });
    expect(parseContentDisposition('inline;')).toEqual({ type: 'inline', params: new Map() });
  });

  it('Quoted-String: ; und = im Wert, Escapes (quoted-pair)', () => {
    expect(params('attachment; filename="a;b=c.pdf"; x=1')).toEqual({ filename: 'a;b=c.pdf', x: '1' });
    expect(params('attachment; filename="say \\"hi\\".pdf"')).toEqual({ filename: 'say "hi".pdf' });
    expect(params('attachment; filename="back\\\\slash.pdf"')).toEqual({ filename: 'back\\slash.pdf' });
    expect(params('attachment; filename="\\a\\b.pdf"')).toEqual({ filename: 'ab.pdf' });
    expect(params('attachment; filename=""')).toEqual({ filename: '' });
  });

  it('Syntaxfehler → null', () => {
    for (const header of [
      '',
      ' ',
      '; filename=a.pdf',
      'attachment filename=a.pdf',
      'attachment; filename',
      'attachment; filename=',
      'attachment; =a.pdf',
      'attachment; filename="offen',
      'attachment; filename="ende\\',
      'attachment; filename=a b.pdf',
      'attachment; filename=(a).pdf',
      'attachment; filename="a.pdf" x',
      // doppelte Parameter sind mehrdeutig (RFC 6266 4.1)
      'attachment; filename="a.pdf"; filename="b.html"',
      "attachment; filename*=UTF-8''a.pdf; FILENAME*=UTF-8''b.html",
    ]) {
      expect([header, parseContentDisposition(header)]).toEqual([header, null]);
    }
  });
});

describe('decodeExtValue / encodeExtValue (RFC 8187)', () => {
  it('UTF-8 und ISO-8859-1 mit Sprache, Zeichensatz ohne Groß-/Kleinschreibung', () => {
    expect(decodeExtValue("UTF-8''%C3%9Cbung%201.pdf")).toBe('\u00dcbung 1.pdf');
    expect(decodeExtValue("utf-8'de'a.pdf")).toBe('a.pdf');
    expect(decodeExtValue("iso-8859-1'en'%A3%20rates")).toBe('\u00a3 rates');
  });

  it('ungültig → null: anderer Zeichensatz, kaputte Prozent-Kodierung, ungültiges UTF-8, verbotene Zeichen', () => {
    for (const value of [
      "UTF-16''%00a",
      "''a.pdf",
      'UTF-8a.pdf',
      "UTF-8'a.pdf",
      "UTF-8''%E0%A4%A",
      "UTF-8''%G1",
      "UTF-8''%C3%28",
      "UTF-8''%FF",
      "UTF-8''a b",
      "UTF-8''a\"b",
      "UTF-8''a'b",
      "UTF-8''(a)",
    ]) {
      expect([value, decodeExtValue(value)]).toEqual([value, null]);
    }
  });

  it('encodeExtValue kodiert alles außer attr-char, Rundweg verlustfrei', () => {
    expect(encodeExtValue('a b\'()*%;,="\u00e4\u20ac.pdf')).toBe(
      'a%20b%27%28%29%2A%25%3B%2C%3D%22%C3%A4%E2%82%AC.pdf',
    );
    expect(encodeExtValue('AZaz09!#$&+-.^_`|~')).toBe('AZaz09!#$&+-.^_`|~');
    for (const name of [
      '\u00dcbung 3 \u2013 L\u00f6sung (v2).pdf',
      '\ud83d\udcc4 Notizen.txt',
      "it's 100%.pdf",
    ]) {
      expect(decodeExtValue(`UTF-8''${encodeExtValue(name)}`)).toBe(name);
    }
  });
});

describe('filenameFrom', () => {
  it.each([
    ['attachment; filename="a;b.pdf"', 'a;b.pdf'],
    ['attachment; filename="say \\"hi\\".pdf"', 'say _hi_.pdf'],
    ['attachment; filename=bericht.pdf', 'bericht.pdf'],
    ['attachment; filename*=UTF-8\'\'neu.pdf; filename="alt.pdf"', 'neu.pdf'],
    ['attachment; filename="alt.pdf"; filename*=UTF-8\'\'neu.pdf', 'neu.pdf'],
    // Unbekannter Zeichensatz → filename=
    ['attachment; filename*=UTF-16\'\'x; filename="ersatz.pdf"', 'ersatz.pdf'],
    ["attachment; filename*=iso-8859-1'de'%E4rger.pdf", '\u00e4rger.pdf'],
    // Rohes UTF-8 im Quoted-String (fetch liest Header als ISO-8859-1)
    [`attachment; filename="${Buffer.from('\u00dcbung.pdf').toString('latin1')}"`, '\u00dcbung.pdf'],
    // Echtes ISO-8859-1 bleibt
    ['attachment; filename="\u00e4.pdf"', '\u00e4.pdf'],
    ['attachment; filename="a.pdf"; filename="b.html"', null],
    ['attachment; filename="offen', null],
    ['attachment', null],
  ])('%s → %s', (header, expected) => {
    expect(filenameFrom(header)).toBe(expected);
  });

  it('keine NFKC-Normalisierung: Vollbreite bleibt Vollbreite', () => {
    const name = filenameFrom("attachment; filename*=UTF-8''%EF%BC%8E%EF%BC%8E%EF%BC%8Fx.pdf");
    expect(name).toBe('\uff0e\uff0e\uff0fx.pdf');
  });
});

describe('buildContentDisposition', () => {
  it('nur filename="ASCII" plus filename*=UTF-8, Name bereinigt', () => {
    expect(buildContentDisposition('inline', '\u00dcbung 1.pdf')).toBe(
      `inline; filename="_bung 1.pdf"; filename*=UTF-8''%C3%9Cbung%201.pdf`,
    );
    expect(buildContentDisposition('attachment', '../a"b\r\n.pdf')).toBe(
      `attachment; filename="a_b.pdf"; filename*=UTF-8''a_b.pdf`,
    );
    expect(buildContentDisposition('attachment', '..')).toBe(
      `attachment; filename="datei"; filename*=UTF-8''datei`,
    );
  });

  it('Rundweg: eigener Header wird von eigenem Parser genau so zurückgelesen', () => {
    for (const name of ['a;b=c.pdf', "it's 50%.pdf", '\u20ac \u00e4\u00f6\u00fc.txt', 'x\\y']) {
      const header = buildContentDisposition('attachment', name);
      expect(header).toMatch(/^[\x20-\x7e]+$/);
      const parsed = parseContentDisposition(header);
      expect([...(parsed?.params.keys() ?? [])]).toEqual(['filename', 'filename*']);
      expect(filenameFrom(header)).toBe(name === 'x\\y' ? 'y' : name);
    }
  });

  it('asciiFallback ersetzt Nicht-ASCII, Steuerzeichen, " \\ und %', () => {
    expect(asciiFallback('a\u00e4"\\%\u0001b')).toBe('a_____b');
    expect(asciiFallback("a;b=c '()*.pdf")).toBe("a;b=c '()*.pdf");
  });
});

describe('Hilfen der Lese-Endpunkte', () => {
  const ctx = { baseUrl: 'https://moodle.example.org', timeZone: 'Europe/Berlin' };

  it('safeUrl: nur http(s), ohne Zugangsdaten und Token-Parameter', () => {
    expect(safeUrl('https://moodle.example.org/mod/x/view.php?id=1&token=abc&WSTOKEN=d')).toBe(
      'https://moodle.example.org/mod/x/view.php?id=1',
    );
    expect(safeUrl('https://user:pw@moodle.example.org/a')).toBe('https://moodle.example.org/a');
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      '',
      'kein url',
      5,
      null,
    ]) {
      expect(safeUrl(value)).toBeNull();
    }
  });

  it('timestamp und calendarDate: 0 und Unsinn → null, Datum in Ortszeit', () => {
    expect(timestamp(0)).toBeNull();
    expect(timestamp(-5)).toBeNull();
    expect(timestamp(1e20)).toBeNull();
    expect(timestamp('abc')).toBeNull();
    expect(timestamp(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z');
    expect(calendarDate(Date.parse('2026-10-11T22:00:00Z') / 1000, 'Europe/Berlin')).toBe('2026-10-12');
    expect(calendarDate(Date.parse('2026-10-11T22:00:00Z') / 1000, 'UTC')).toBe('2026-10-11');
  });

  it('mapFile: nur eigene Instanz, Query verworfen, Name bereinigt; Ordner ausgelassen', () => {
    const seen: string[] = [];
    const file = mapFile(
      {
        filename: '../x.pdf',
        fileurl:
          'https://moodle.example.org/webservice/pluginfile.php/1/mod_resource/content/2/x.pdf?token=t',
        filesize: 'kaputt',
        mimetype: '',
      },
      { ...ctx, onFile: (f) => seen.push(f.ref) },
    );
    expect(file).toEqual({
      ref: '/1/mod_resource/content/2/x.pdf',
      filename: 'x.pdf',
      mime_type: null,
      size_bytes: 0,
      modified_at: null,
    });
    expect(seen).toEqual(['/1/mod_resource/content/2/x.pdf']);
    expect(
      mapFile({ fileurl: 'https://moodle.example.org.evil/webservice/pluginfile.php/1/a/b/c' }, ctx),
    ).toBeNull();
    expect(
      mapFile({ fileurl: 'http://moodle.example.org/webservice/pluginfile.php/1/a/b/c' }, ctx),
    ).toBeNull();
    expect(
      mapFile({ isdir: true, url: 'https://moodle.example.org/pluginfile.php/1/a/b/c' }, ctx),
    ).toBeNull();
    expect(nameFromRef('/1/a/b/%C3%9Cbung%201.pdf')).toBe('\u00dcbung 1.pdf');
  });

  it('scrubToken ersetzt den Token überall, auch in Schlüsseln', () => {
    const token = 'ab'.repeat(16);
    expect(scrubToken({ [`k${token}`]: [`x${token}y`, 1, null, { z: token }] }, token)).toEqual({
      'k[Redacted]': ['x[Redacted]y', 1, null, { z: '[Redacted]' }],
    });
  });

  it('MoodleFileRegistry vergisst die ältesten Verweise zuerst', () => {
    const registry = new MoodleFileRegistry(2);
    registry.add('/1/a/b/x');
    registry.add('/1/a/b/y');
    registry.add('/1/a/b/x');
    registry.add('/1/a/b/z');
    expect([registry.has('/1/a/b/x'), registry.has('/1/a/b/y'), registry.has('/1/a/b/z')]).toEqual([
      true,
      false,
      true,
    ]);
    expect(registry.size).toBe(2);
  });
});
