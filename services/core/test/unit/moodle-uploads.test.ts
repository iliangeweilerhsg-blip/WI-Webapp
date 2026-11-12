// Upload-Speicher und Annahme einer Datei (T1-24 PR 2, Plan §3.4 und §5.3)
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from '../../src/errors.ts';
import {
  limitFilename,
  matchesMagic,
  MAX_OPEN_UPLOAD_BYTES,
  MAX_OPEN_UPLOADS,
  MAX_UPLOAD_FILE_BYTES,
  MoodleUploadStore,
  storeUploadStream,
  UPLOAD_TTL_MS,
  uploadKindOf,
  uploadsDir,
  type StoredUpload,
} from '../../src/moodle/uploads.ts';

const MB = 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0]);
const PDF = Buffer.from('%PDF-1.7\n%…\n');

let dataDir: string;
let clock: number;
let store: MoodleUploadStore;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'sg-moodle-uploads-'));
  clock = Date.parse('2026-11-12T10:00:00Z');
  store = new MoodleUploadStore({ dataDir, now: () => clock });
  await store.reset();
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

async function httpError(promise: Promise<unknown> | (() => unknown)): Promise<HttpError> {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error('kein Fehler geworfen');
}

const input = (filename: string | undefined, ...chunks: Buffer[]) => ({
  filename,
  file: Readable.from(chunks) as Readable & { truncated?: boolean },
});

/** Legt einen Upload mit Datei an, wie die Route es tut */
async function put(name = 'blatt.pdf', content: Buffer = PDF): Promise<StoredUpload> {
  const slot = store.reserve(content.length);
  try {
    return await storeUploadStream(slot, input(name, content));
  } finally {
    slot.cancel();
  }
}

describe('Verzeichnis und Rechte', () => {
  it('liegt unter tmp/moodle-uploads, Verzeichnis 0700, Datei 0600, Name = Kennung des Core', async () => {
    expect(store.dir).toBe(join(dataDir, 'tmp', 'moodle-uploads'));
    expect(uploadsDir(dataDir)).toBe(store.dir);
    expect(statSync(store.dir).mode & 0o777).toBe(0o700);
    const upload = await put('../../etc/loesung.pdf');
    expect(upload.path).toBe(join(store.dir, upload.id));
    expect(upload.path).not.toContain('loesung');
    expect(statSync(upload.path).mode & 0o777).toBe(0o600);
    expect(upload.filename).toBe('loesung.pdf');
  });

  it('reset leert das Verzeichnis und die Liste (Neustart, E4)', async () => {
    const upload = await put();
    expect(readdirSync(store.dir)).toEqual([upload.id]);
    await store.reset();
    expect(readdirSync(store.dir)).toEqual([]);
    expect(() => store.resolve([upload.id])).toThrow(/unbekannt/);
    expect(store.openCount).toBe(0);
  });

  it('reset legt ein vorhandenes Verzeichnis mit zu weiten Rechten wieder mit 0700 an', async () => {
    const { chmodSync } = await import('node:fs');
    chmodSync(store.dir, 0o755);
    await store.reset();
    expect(statSync(store.dir).mode & 0o777).toBe(0o700);
  });
});

describe('auflösen und Verfall', () => {
  it('resolve liefert den Upload; 24 h später (genau) ist er verfallen → 404 moodle_upload_not_found', async () => {
    const upload = await put();
    expect(upload.expiresAt.getTime()).toBe(clock + UPLOAD_TTL_MS);
    expect(store.resolve([upload.id])).toEqual([upload]);
    clock += UPLOAD_TTL_MS - 1;
    expect(store.resolve([upload.id])).toHaveLength(1);
    clock += 1;
    const error = await httpError(() => store.resolve([upload.id]));
    expect(error).toMatchObject({ statusCode: 404, code: 'moodle_upload_not_found' });
  });

  it('unbekannte Kennung → 404; eine Kennung, die nur wie ein Pfad aussieht, ebenfalls (nie zu einem Pfad gebaut)', async () => {
    await put();
    for (const id of ['0190f6a2-0000-7000-8000-000000000001', '../../etc/passwd', '..', '']) {
      expect(await httpError(() => store.resolve([id]))).toMatchObject({
        statusCode: 404,
        code: 'moodle_upload_not_found',
      });
    }
  });

  it('doppelte Kennung → 400; mehrere verschiedene gehen (Gegenprobe)', async () => {
    const a = await put('a.pdf');
    const b = await put('b.pdf');
    expect(await httpError(() => store.resolve([a.id, a.id]))).toMatchObject({
      statusCode: 400,
      code: 'validation_failed',
    });
    expect(store.resolve([b.id, a.id]).map((u) => u.filename)).toEqual(['b.pdf', 'a.pdf']);
  });

  it('sweep löscht Verfallenes samt Datei, Frisches bleibt', async () => {
    const old = await put('alt.pdf');
    clock += UPLOAD_TTL_MS / 2;
    const fresh = await put('neu.pdf');
    clock += UPLOAD_TTL_MS / 2;
    await store.sweep();
    expect(existsSync(old.path)).toBe(false);
    expect(existsSync(fresh.path)).toBe(true);
    expect(store.openCount).toBe(1);
    expect(store.resolve([fresh.id])).toHaveLength(1);
  });
});

describe('löschen', () => {
  it('remove löscht Datei und Eintrag; danach false (→ 404)', async () => {
    const upload = await put();
    expect(await store.remove(upload.id)).toBe(true);
    expect(existsSync(upload.path)).toBe(false);
    expect(await store.remove(upload.id)).toBe(false);
    expect(await store.remove('0190f6a2-0000-7000-8000-000000000001')).toBe(false);
  });

  it('ein verfallener, noch nicht gefegter Upload zählt als unbekannt, die Datei geht trotzdem weg', async () => {
    const upload = await put();
    clock += UPLOAD_TTL_MS;
    expect(await store.remove(upload.id)).toBe(false);
    expect(existsSync(upload.path)).toBe(false);
  });

  it('removeUnused löscht nur, was nicht in Benutzung ist', async () => {
    const free = await put('frei.pdf');
    const busy = await put('belegt.pdf');
    store.acquire([busy.id]);
    await store.removeUnused([free.id, busy.id, '0190f6a2-0000-7000-8000-000000000001']);
    expect(existsSync(free.path)).toBe(false);
    expect(existsSync(busy.path)).toBe(true);
    store.release([busy.id]);
    await store.removeUnused([busy.id]);
    expect(existsSync(busy.path)).toBe(false);
  });
});

describe('in Benutzung (acquire/release)', () => {
  it('remove → 409 moodle_upload_in_use, die Datei bleibt; nach release geht es', async () => {
    const upload = await put();
    expect(store.acquire([upload.id])).toEqual([upload]);
    expect(store.isInUse(upload.id)).toBe(true);
    const error = await httpError(store.remove(upload.id));
    expect(error).toMatchObject({ statusCode: 409, code: 'moodle_upload_in_use' });
    expect(existsSync(upload.path)).toBe(true);
    expect(store.resolve([upload.id])).toHaveLength(1);
    store.release([upload.id]);
    expect(store.isInUse(upload.id)).toBe(false);
    expect(await store.remove(upload.id)).toBe(true);
  });

  it('sweep lässt einen verfallenen Upload in Benutzung liegen und fegt ihn nach release', async () => {
    const upload = await put();
    store.acquire([upload.id]);
    clock += UPLOAD_TTL_MS + 1000;
    await store.sweep();
    expect(existsSync(upload.path)).toBe(true);
    store.release([upload.id]);
    await store.sweep();
    expect(existsSync(upload.path)).toBe(false);
  });

  it('zwei Aktionen mit derselben Datei: erst nach dem zweiten release ist sie frei', async () => {
    const upload = await put();
    store.acquire([upload.id]);
    store.acquire([upload.id]);
    store.release([upload.id]);
    expect(await httpError(store.remove(upload.id))).toMatchObject({ code: 'moodle_upload_in_use' });
    store.release([upload.id]);
    expect(await store.remove(upload.id)).toBe(true);
  });

  it('acquire gilt ganz oder gar nicht: eine fehlende Kennung markiert keine der anderen', async () => {
    const upload = await put();
    const error = await httpError(() => store.acquire([upload.id, '0190f6a2-0000-7000-8000-000000000001']));
    expect(error).toMatchObject({ statusCode: 404, code: 'moodle_upload_not_found' });
    expect(store.isInUse(upload.id)).toBe(false);
    expect(await store.remove(upload.id)).toBe(true);
  });

  it('release ohne acquire oder doppelt zählt nicht ins Minus', async () => {
    const upload = await put();
    store.release([upload.id, 'unbekannt']);
    store.acquire([upload.id]);
    store.release([upload.id]);
    store.release([upload.id]);
    store.acquire([upload.id]);
    expect(store.isInUse(upload.id)).toBe(true);
  });
});

describe('Grenzen: Anzahl und Byte, reserviert vor dem Schreiben', () => {
  it('höchstens 20 offene Uploads: der 21. → 409 moodle_upload_limit; ein freier Platz macht es wieder möglich', async () => {
    const slots = Array.from({ length: MAX_OPEN_UPLOADS }, () => store.reserve(10));
    expect(store.openCount).toBe(MAX_OPEN_UPLOADS);
    const error = await httpError(() => store.reserve(10));
    expect(error).toMatchObject({ statusCode: 409, code: 'moodle_upload_limit' });
    expect(error.details).toMatchObject({ reason: 'count' });
    // Gegenprobe: ein abgebrochener Upload gibt seinen Platz frei
    slots[0]?.cancel();
    slots[0]?.cancel();
    expect(store.openCount).toBe(MAX_OPEN_UPLOADS - 1);
    expect(() => store.reserve(10)).not.toThrow();
  });

  it('fertige Uploads zählen weiter mit, laufende ebenfalls (19 fertig + 1 laufend = voll)', async () => {
    for (let i = 0; i < MAX_OPEN_UPLOADS - 1; i += 1) await put(`b${i}.pdf`);
    const running = store.reserve(10);
    expect(await httpError(() => store.reserve(10))).toMatchObject({ code: 'moodle_upload_limit' });
    running.cancel();
    expect(() => store.reserve(10)).not.toThrow();
  });

  it('höchstens 500 MB: laufende Uploads reservieren je bis zu 100 MB', async () => {
    const held = Array.from({ length: MAX_OPEN_UPLOAD_BYTES / MAX_UPLOAD_FILE_BYTES }, () => store.reserve());
    expect(store.openBytes).toBe(MAX_OPEN_UPLOAD_BYTES);
    const error = await httpError(() => store.reserve(1));
    expect(error).toMatchObject({ statusCode: 409, code: 'moodle_upload_limit' });
    expect(error.details).toMatchObject({ reason: 'bytes' });
    held[0]?.cancel();
    // Gegenprobe: genau 100 MB frei → passt; ein Byte mehr nicht (die Obergrenze je Datei ist 100 MB)
    expect(() => store.reserve(MAX_UPLOAD_FILE_BYTES)).not.toThrow();
    expect(await httpError(() => store.reserve(1))).toMatchObject({ code: 'moodle_upload_limit' });
  });

  it('eine bekannte kleine Länge reserviert nur so viel: viele kleine Uploads neben großen Platz', async () => {
    store.reserve(MAX_UPLOAD_FILE_BYTES);
    store.reserve(MAX_UPLOAD_FILE_BYTES);
    store.reserve(MAX_UPLOAD_FILE_BYTES);
    store.reserve(MAX_UPLOAD_FILE_BYTES);
    // 400 MB belegt, 100 MB frei: 1 MB geht, 101 MB werden auf 100 MB gedeckelt und gehen auch
    expect(() => store.reserve(MB)).not.toThrow();
    expect(await httpError(() => store.reserve(100 * MB))).toMatchObject({ code: 'moodle_upload_limit' });
  });

  it('beim Abschluss ersetzt die tatsächliche Größe die Reservierung', async () => {
    const slot = store.reserve(MAX_UPLOAD_FILE_BYTES);
    expect(store.openBytes).toBe(MAX_UPLOAD_FILE_BYTES);
    await storeUploadStream(slot, input('a.pdf', PDF));
    expect(store.openBytes).toBe(PDF.length);
    expect(store.openCount).toBe(1);
  });

  it('ein abgelehnter Upload (falscher Typ, leer, zu groß) belegt keinen Platz und lässt keine Datei liegen', async () => {
    const bad: [string, Buffer, boolean?][] = [
      ['a.pdf', PNG],
      ['a.exe', PDF],
      ['a.pdf', Buffer.alloc(0)],
      ['a.pdf', PDF, true],
    ];
    for (const [name, content, truncated] of bad) {
      const slot = store.reserve(MB);
      try {
        const file = Object.assign(Readable.from([content]), truncated ? { truncated: true } : {});
        await httpError(storeUploadStream(slot, { filename: name, file }));
      } finally {
        slot.cancel();
      }
    }
    expect(store.openCount).toBe(0);
    expect(store.openBytes).toBe(0);
    expect(readdirSync(store.dir)).toEqual([]);
  });

  it('ein abgeschlossener Platz lässt sich nicht noch einmal abschließen', async () => {
    const slot = store.reserve(10);
    slot.commit({ filename: 'a.pdf', sizeBytes: 1, sha256: 'x', kind: 'pdf' });
    expect(() => slot.commit({ filename: 'a.pdf', sizeBytes: 1, sha256: 'x', kind: 'pdf' })).toThrow();
    // cancel nach commit gibt nichts frei
    slot.cancel();
    expect(store.openCount).toBe(1);
  });
});

describe('Annahme: Typ, Endung und Anfangsbytes (Content-Type zählt nicht)', () => {
  it.each([
    ['blatt.pdf', PDF, 'pdf'],
    ['bild.png', PNG, 'png'],
    ['foto.jpg', JPEG, 'jpeg'],
    ['foto.jpeg', JPEG, 'jpeg'],
    ['code.zip', ZIP, 'zip'],
    ['notiz.txt', Buffer.from('Grüße, 日本語, ß'), 'text'],
    ['daten.csv', Buffer.from('a;b\n1;2\n'), 'text'],
    ['notizen.md', Buffer.from('# Lösung\n'), 'text'],
    ['GROSS.PDF', PDF, 'pdf'],
    ['Foto.JPG', JPEG, 'jpeg'],
  ] as [string, Buffer, string][])(
    '%s wird angenommen als %s, mit sha256 und Größe',
    async (name, content, kind) => {
      const upload = await put(name, content);
      expect(upload.kind).toBe(kind);
      expect(upload.sizeBytes).toBe(content.length);
      expect(upload.sha256).toBe(createHash('sha256').update(content).digest('hex'));
    },
  );

  it.each([
    ['PNG-Inhalt mit Endung .pdf', 'a.pdf', PNG],
    ['PDF-Inhalt mit Endung .png', 'a.png', PDF],
    ['PDF-Inhalt mit Endung .jpg', 'a.jpg', PDF],
    ['PDF-Inhalt mit Endung .zip', 'a.zip', PDF],
    ['ZIP-Inhalt mit Endung .pdf', 'a.pdf', ZIP],
    ['JPEG-Inhalt mit Endung .png', 'a.png', JPEG],
    ['Text mit Endung .pdf', 'a.pdf', Buffer.from('Hallo')],
    ['HTML mit Endung .html', 'a.html', Buffer.from('<script>alert(1)</script>')],
    ['SVG', 'a.svg', Buffer.from('<svg onload=alert(1)/>')],
    ['ausführbar', 'a.exe', Buffer.from('MZ')],
    ['ohne Endung', 'README', Buffer.from('Hallo')],
    ['nur Punkt am Ende', 'a.', Buffer.from('Hallo')],
    ['Quellcode (erst nach F2, #289)', 'loesung.py', Buffer.from('print(1)\n')],
    ['Text mit NUL', 'a.txt', Buffer.from('ab\0cd')],
    ['Text mit ungültigem UTF-8', 'a.txt', Buffer.from([0x61, 0xff, 0xfe, 0x62])],
    ['Text mit abgeschnittenem UTF-8 am Ende', 'a.txt', Buffer.from([0x61, 0xc3])],
    ['Doppelendung mit falschem Schluss', 'a.pdf.exe', PDF],
    ['PK ohne Dateikopf', 'a.zip', Buffer.from('PK\0\0')],
    ['PNG-Anfang abgeschnitten', 'a.png', PNG.subarray(0, 7)],
  ] as [string, string, Buffer][])('%s → 400 moodle_upload_type_invalid', async (_label, name, content) => {
    const error = await httpError(put(name, content));
    expect(error).toMatchObject({ statusCode: 400, code: 'moodle_upload_type_invalid' });
    expect(store.openCount).toBe(0);
    expect(readdirSync(store.dir)).toEqual([]);
  });

  it('leere Datei → 400, auch mit gültiger Endung', async () => {
    expect(await httpError(put('a.pdf', Buffer.alloc(0)))).toMatchObject({
      code: 'moodle_upload_type_invalid',
    });
    expect(await httpError(put('a.txt', Buffer.alloc(0)))).toMatchObject({
      code: 'moodle_upload_type_invalid',
    });
  });

  it('fehlender Dateiname → 400', async () => {
    const slot = store.reserve(10);
    expect(await httpError(storeUploadStream(slot, input(undefined, PDF)))).toMatchObject({
      code: 'moodle_upload_type_invalid',
    });
    expect(await httpError(storeUploadStream(slot, input('///', PDF)))).toMatchObject({
      code: 'moodle_upload_type_invalid',
    });
  });

  it('PDF: „%PDF“ darf nach Vorspann stehen (bis 1024 Byte), danach nicht mehr (Gegenprobe)', async () => {
    const preamble = (n: number) => Buffer.concat([Buffer.alloc(n, 0x20), PDF]);
    expect((await put('a.pdf', preamble(1000))).kind).toBe('pdf');
    expect(await httpError(put('b.pdf', preamble(1030)))).toMatchObject({
      code: 'moodle_upload_type_invalid',
    });
  });

  it('große Dateien in mehreren Stücken: Anfang und Ende stimmen, Hash ist der des Ganzen', async () => {
    const parts = [PDF, Buffer.alloc(300_000, 1), Buffer.alloc(5, 2)];
    const slot = store.reserve(MB);
    const upload = await storeUploadStream(slot, input('gross.pdf', ...parts));
    const whole = Buffer.concat(parts);
    expect(upload.sizeBytes).toBe(whole.length);
    expect(upload.sha256).toBe(createHash('sha256').update(whole).digest('hex'));
    expect(statSync(upload.path).size).toBe(whole.length);
  });

  it('Text: ein UTF-8-Zeichen über die Stückgrenze hinweg ist gültig (Gegenprobe zum abgeschnittenen Zeichen)', async () => {
    const bytes = Buffer.from('Grüße ä');
    const cut = bytes.indexOf(0xc3) + 1;
    const slot = store.reserve(MB);
    const upload = await storeUploadStream(slot, input('a.txt', bytes.subarray(0, cut), bytes.subarray(cut)));
    expect(upload.kind).toBe('text');
    expect(statSync(upload.path).size).toBe(bytes.length);
  });

  it('zu groß (Parser meldet truncated) → 413 file_too_large, Teildatei gelöscht', async () => {
    const slot = store.reserve(MB);
    const file = Object.assign(Readable.from([PDF]), { truncated: true });
    expect(await httpError(storeUploadStream(slot, { filename: 'a.pdf', file }))).toMatchObject({
      statusCode: 413,
      code: 'file_too_large',
    });
    expect(readdirSync(store.dir)).toEqual([]);
  });

  it('der Dateiname wird bereinigt und nie als Pfad verwendet', async () => {
    const cases: [string, string][] = [
      ['../../etc/passwd.pdf', 'passwd.pdf'],
      ['C:\\Users\\x\\blatt.pdf', 'blatt.pdf'],
      ['a"b\r\n.pdf', 'a_b.pdf'],
      ['  .versteckt.pdf', 'versteckt.pdf'],
      ['a\u202efdp.exe.pdf', 'afdp.exe.pdf'],
    ];
    for (const [raw, expected] of cases) {
      const upload = await put(raw);
      expect(upload.filename).toBe(expected);
      expect(upload.path).toBe(join(store.dir, upload.id));
    }
    expect(readdirSync(dataDir)).toEqual(['tmp']);
  });

  it('ein Name über 255 Byte wird gekürzt, die Endung bleibt', async () => {
    const upload = await put(`${'ä'.repeat(300)}.pdf`);
    expect(Buffer.byteLength(upload.filename)).toBeLessThanOrEqual(255);
    expect(upload.filename.endsWith('.pdf')).toBe(true);
    expect(limitFilename('kurz.pdf')).toBe('kurz.pdf');
    expect(Buffer.byteLength(limitFilename('x'.repeat(255) + '.pdf'))).toBe(255);
  });

  it('kürzt je Codepunkt: kein halbes Ersatzpaar am Schnitt, die Endung bleibt', () => {
    // 4 Byte je Emoji: 63 * 4 + 4 = 256 Byte, eins muss weg. Eine Kürzung je UTF-16-Einheit ließe ein Surrogat stehen
    const limited = limitFilename('\u{1F600}'.repeat(63) + '.pdf');
    expect(limited).toBe('\u{1F600}'.repeat(62) + '.pdf');
    // Mit `u` steht ein vollständiges Paar für einen Codepunkt, nur ein einzelnes Surrogat trifft die Klasse
    expect(limited).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(Buffer.byteLength(limited)).toBeLessThanOrEqual(255);
  });
});

describe('Hilfsfunktionen', () => {
  it('uploadKindOf kennt nur die erlaubten Endungen', () => {
    expect(uploadKindOf('a.PDF')).toBe('pdf');
    expect(uploadKindOf('a.tar.gz')).toBeNull();
    expect(uploadKindOf('a.html')).toBeNull();
    expect(uploadKindOf('a.svg')).toBeNull();
    expect(uploadKindOf('a')).toBeNull();
    expect(uploadKindOf('constructor')).toBeNull();
    expect(uploadKindOf('a.__proto__')).toBeNull();
    // Text nur txt, md, csv (F2, #289): Quellcode und andere Textformate erst nach der Entscheidung des Owners
    expect(uploadKindOf('a.txt')).toBe('text');
    expect(uploadKindOf('a.MD')).toBe('text');
    expect(uploadKindOf('a.csv')).toBe('text');
    for (const ext of ['py', 'java', 'c', 'h', 'cpp', 'js', 'ts', 'json', 'sql', 'r', 'tex', 'tsv', 'docx']) {
      expect(uploadKindOf(`a.${ext}`)).toBeNull();
    }
  });

  it('matchesMagic prüft die Anfangsbytes', () => {
    expect(matchesMagic('png', PNG)).toBe(true);
    expect(matchesMagic('png', JPEG)).toBe(false);
    expect(matchesMagic('jpeg', JPEG)).toBe(true);
    expect(matchesMagic('zip', Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
    expect(matchesMagic('zip', Buffer.from([0x50, 0x4b, 0x01, 0x02]))).toBe(false);
    expect(matchesMagic('pdf', Buffer.alloc(0))).toBe(false);
  });
});
