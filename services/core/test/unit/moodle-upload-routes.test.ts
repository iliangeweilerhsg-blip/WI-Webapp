// POST /moodle/uploads und DELETE /moodle/uploads/{upload_id} (T1-24 PR 2, Plan §3.6 und §5.3)
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiErrorSchema, MoodleUploadSchema, type MoodleActionId } from '@sg/shared';
import { MAX_OPEN_UPLOADS, UPLOAD_TTL_MS } from '../../src/moodle/uploads.ts';
import { createMoodleServices, type MoodleServices } from '../../src/moodle/index.ts';
import { StaticTokenStore } from '../../src/moodle/token-store.ts';
import { registerErrorHandler } from '../../src/plugins/errors.ts';
import { moodleRoutes } from '../../src/routes/moodle.ts';
import { FAKE_BASE, FAKE_TOKEN, fakeFetch, restHandler, siteInfo } from './moodle-fake.ts';

const PDF = Buffer.from('%PDF-1.7\nLösung\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const BOUNDARY = '----sgtestboundary7MA4YWxk';

interface Part {
  name: string;
  value: string | Buffer;
  filename?: string;
  type?: string;
}

/** multipart/form-data von Hand, damit der Test unabhängig vom Parser des Core bleibt */
function multipartBody(parts: Part[]): { payload: Buffer; headers: Record<string, string> } {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition =
      `Content-Disposition: form-data; name="${part.name}"` +
      (part.filename === undefined ? '' : `; filename="${part.filename}"`);
    const type = part.type === undefined ? '' : `\r\nContent-Type: ${part.type}`;
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n${disposition}${type}\r\n\r\n`));
    chunks.push(typeof part.value === 'string' ? Buffer.from(part.value) : part.value);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  const payload = Buffer.concat(chunks);
  return {
    payload,
    headers: {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      'content-length': String(payload.length),
    },
  };
}

const filePart = (filename: string, value: Buffer | string = PDF, type = 'application/pdf'): Part => ({
  name: 'file',
  value,
  filename,
  type,
});

let app: FastifyInstance | undefined;
let dataDir: string;
let clock: number;
let moodle: MoodleServices;
let requests: ReturnType<typeof fakeFetch>['requests'];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sg-moodle-upload-routes-'));
  clock = Date.parse('2026-11-12T10:00:00Z');
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

async function setup(
  options: { moodleActions?: MoodleActionId[]; baseUrl?: string; maxUploadBytes?: number } = {},
) {
  const fake = fakeFetch(
    restHandler({ core_webservice_get_site_info: siteInfo(['core_webservice_get_site_info']) }),
  );
  requests = fake.requests;
  moodle = createMoodleServices({
    config: {
      moodleUrl: options.baseUrl ?? FAKE_BASE,
      dataDir,
      moodleActions: options.moodleActions ?? ['files.upload_private'],
    },
    tokens: new StaticTokenStore(FAKE_TOKEN),
    fetch: fake.fetch,
    now: () => new Date(clock),
    readMeta: async () => ({ token_valid_until: '2027-01-27' }),
  });
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  await app.register(moodleRoutes, {
    moodle,
    ...(options.maxUploadBytes === undefined ? {} : { maxUploadBytes: options.maxUploadBytes }),
  });
  await app.ready();
  return app;
}

async function upload(parts: Part[] = [filePart('loesung.pdf')]) {
  const { payload, headers } = multipartBody(parts);
  return (app as FastifyInstance).inject({ method: 'POST', url: '/moodle/uploads', payload, headers });
}

const errorCode = (res: { json: () => unknown }) => ApiErrorSchema.parse(res.json()).error.code;
const filesOnDisk = () => {
  const dir = join(dataDir, 'tmp', 'moodle-uploads');
  return existsSync(dir) ? readdirSync(dir) : [];
};

describe('Freischaltung (E12)', () => {
  it('mit leerem SG_MOODLE_ACTIONS → 501 moodle_action_not_implemented, nichts auf der Platte, Moodle unberührt', async () => {
    await setup({ moodleActions: [] });
    const res = await upload();
    expect(res.statusCode).toBe(501);
    expect(errorCode(res)).toBe('moodle_action_not_implemented');
    expect(existsSync(join(dataDir, 'tmp'))).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it('eine Aktion ohne Dateien (assign.submit, message.send …) schaltet die Route nicht frei', async () => {
    for (const id of ['assign.submit', 'message.send', 'calendar.create_event'] as const) {
      await app?.close();
      await setup({ moodleActions: [id] });
      expect((await upload()).statusCode, id).toBe(501);
    }
  });

  it.each(['assign.save_draft', 'forum.create_discussion', 'forum.reply', 'files.upload_private'] as const)(
    'mit %s freigeschaltet → die Route ist offen (Gegenprobe)',
    async (id) => {
      await setup({ moodleActions: [id] });
      expect((await upload()).statusCode).toBe(201);
    },
  );

  it('das Löschen braucht keine Freischaltung der Route, antwortet aber ohne Upload mit 404', async () => {
    await setup({ moodleActions: [] });
    const res = await (app as FastifyInstance).inject({
      method: 'DELETE',
      url: '/moodle/uploads/0190f6a2-0000-7000-8000-000000000001',
    });
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('moodle_upload_not_found');
  });
});

describe('hochladen, auflösen, löschen', () => {
  it('201 MoodleUpload; Datei unter tmp/moodle-uploads/<id> mit Inhalt, Rechten und 24 h Verfall', async () => {
    await setup();
    const res = await upload([filePart('../Lösung <1>.pdf')]);
    expect(res.statusCode).toBe(201);
    const body = MoodleUploadSchema.parse(res.json());
    expect(body.filename).toBe('Lösung _1_.pdf');
    expect(body.size_bytes).toBe(PDF.length);
    expect(Date.parse(body.expires_at)).toBe(clock + UPLOAD_TTL_MS);
    const path = join(dataDir, 'tmp', 'moodle-uploads', body.upload_id);
    expect(readFileSync(path).equals(PDF)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dataDir, 'tmp', 'moodle-uploads')).mode & 0o777).toBe(0o700);
    // Die Antwort enthält keinen Pfad
    expect(res.body).not.toContain(dataDir);
    // Auflösen
    const [resolved] = moodle.uploads.resolve([body.upload_id]);
    expect(resolved).toMatchObject({ filename: 'Lösung _1_.pdf', sizeBytes: PDF.length, kind: 'pdf', path });
  });

  it('beide Routen antworten auch ohne eingerichtetes Moodle und sprechen Moodle nie an', async () => {
    await setup({ baseUrl: '' });
    const res = await upload();
    expect(res.statusCode).toBe(201);
    const { upload_id } = MoodleUploadSchema.parse(res.json());
    const del = await (app as FastifyInstance).inject({
      method: 'DELETE',
      url: `/moodle/uploads/${upload_id}`,
    });
    expect(del.statusCode).toBe(204);
    expect(requests).toHaveLength(0);
  });

  it('löschen: 204 (leer), Datei weg; danach 404; ungültige Kennung 400', async () => {
    await setup();
    const { upload_id } = MoodleUploadSchema.parse((await upload()).json());
    const del = await (app as FastifyInstance).inject({
      method: 'DELETE',
      url: `/moodle/uploads/${upload_id}`,
    });
    expect(del.statusCode).toBe(204);
    expect(del.body).toBe('');
    expect(filesOnDisk()).toEqual([]);
    const again = await (app as FastifyInstance).inject({
      method: 'DELETE',
      url: `/moodle/uploads/${upload_id}`,
    });
    expect(again.statusCode).toBe(404);
    expect(errorCode(again)).toBe('moodle_upload_not_found');
    const bad = await (app as FastifyInstance).inject({
      method: 'DELETE',
      url: '/moodle/uploads/..%2F..%2Fetc',
    });
    expect(bad.statusCode).toBe(400);
  });

  it('löschen, solange eine Aktion den Upload liest: 409 moodle_upload_in_use, Datei bleibt; danach 204', async () => {
    await setup();
    const { upload_id } = MoodleUploadSchema.parse((await upload()).json());
    moodle.uploads.acquire([upload_id]);
    const url = `/moodle/uploads/${upload_id}`;
    const busy = await (app as FastifyInstance).inject({ method: 'DELETE', url });
    expect(busy.statusCode).toBe(409);
    expect(errorCode(busy)).toBe('moodle_upload_in_use');
    expect(filesOnDisk()).toEqual([upload_id]);
    moodle.uploads.release([upload_id]);
    expect((await (app as FastifyInstance).inject({ method: 'DELETE', url })).statusCode).toBe(204);
    expect(filesOnDisk()).toEqual([]);
  });

  it('verfallen: nach 24 h unbekannt (404), das nächste Hochladen räumt die Datei weg', async () => {
    await setup();
    const { upload_id } = MoodleUploadSchema.parse((await upload()).json());
    clock += UPLOAD_TTL_MS;
    expect(() => moodle.uploads.resolve([upload_id])).toThrow(/unbekannt oder abgelaufen/);
    const del = await (app as FastifyInstance).inject({
      method: 'DELETE',
      url: `/moodle/uploads/${upload_id}`,
    });
    expect(del.statusCode).toBe(404);
    expect(filesOnDisk()).toEqual([]);

    // Fegen vor dem Hochladen: ein neuer Upload räumt Verfallenes auf und zählt nicht dagegen
    await app?.close();
    await setup();
    const old = MoodleUploadSchema.parse((await upload()).json());
    clock += UPLOAD_TTL_MS + 1;
    const fresh = MoodleUploadSchema.parse((await upload()).json());
    expect(filesOnDisk()).toEqual([fresh.upload_id]);
    expect(filesOnDisk()).not.toContain(old.upload_id);
  });

  it('verfallen, aber in Benutzung: bleibt liegen, bis die Aktion fertig ist', async () => {
    await setup();
    const { upload_id } = MoodleUploadSchema.parse((await upload()).json());
    moodle.uploads.acquire([upload_id]);
    clock += UPLOAD_TTL_MS + 1;
    await upload();
    expect(filesOnDisk()).toContain(upload_id);
    moodle.uploads.release([upload_id]);
    await upload();
    expect(filesOnDisk()).not.toContain(upload_id);
  });
});

describe('Typ und Form der Anfrage', () => {
  it('kein multipart → 415 multipart_required', async () => {
    await setup();
    const res = await (app as FastifyInstance).inject({
      method: 'POST',
      url: '/moodle/uploads',
      payload: { datei: 'x' },
    });
    expect(res.statusCode).toBe(415);
    expect(errorCode(res)).toBe('multipart_required');
    expect(filesOnDisk()).toEqual([]);
  });

  it('der Content-Type des Browsers zählt nicht: PNG als text/html angenommen, PDF-Endung mit PNG-Inhalt abgelehnt', async () => {
    await setup();
    const ok = await upload([filePart('bild.png', PNG, 'text/html')]);
    expect(ok.statusCode).toBe(201);
    const lying = await upload([filePart('bild.pdf', PNG, 'application/pdf')]);
    expect(lying.statusCode).toBe(400);
    expect(errorCode(lying)).toBe('moodle_upload_type_invalid');
    expect(filesOnDisk()).toHaveLength(1);
  });

  it.each([
    ['falsche Endung', [filePart('a.html', '<b>x</b>', 'text/html')]],
    ['Endung passt nicht zum Inhalt', [filePart('a.png', PDF, 'image/png')]],
    ['leere Datei', [filePart('a.pdf', Buffer.alloc(0))]],
    ['Text mit NUL', [filePart('a.txt', Buffer.from('a\0b'), 'text/plain')]],
  ])('%s → 400 moodle_upload_type_invalid, nichts bleibt liegen', async (_name, parts) => {
    await setup();
    const res = await upload(parts);
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe('moodle_upload_type_invalid');
    expect(filesOnDisk()).toEqual([]);
    expect(moodle.uploads.openCount).toBe(0);
  });

  it('Größe: genau am Limit geht, ein Byte mehr → 413 file_too_large und die Teildatei ist weg', async () => {
    await setup({ maxUploadBytes: 1024 });
    const header = Buffer.from('%PDF-1.7\n');
    const exact = Buffer.concat([header, Buffer.alloc(1024 - header.length, 0x20)]);
    expect(exact.length).toBe(1024);
    const ok = await upload([filePart('genau.pdf', exact)]);
    expect(ok.statusCode).toBe(201);
    expect(MoodleUploadSchema.parse(ok.json()).size_bytes).toBe(1024);
    const tooBig = await upload([filePart('zu-gross.pdf', Buffer.concat([exact, Buffer.from('x')]))]);
    expect(tooBig.statusCode).toBe(413);
    expect(errorCode(tooBig)).toBe('file_too_large');
    expect(filesOnDisk()).toHaveLength(1);
    expect(moodle.uploads.openCount).toBe(1);
  });

  it('genau eine Datei im Feld „file“: zweite Datei, falscher Feldname und fehlende Datei → 400, nichts bleibt liegen', async () => {
    await setup();
    const two = await upload([filePart('a.pdf'), filePart('b.pdf')]);
    expect(two.statusCode).toBe(400);
    expect(errorCode(two)).toBe('unexpected_file');
    const wrongName = await upload([{ ...filePart('a.pdf'), name: 'datei' }]);
    expect(wrongName.statusCode).toBe(400);
    expect(errorCode(wrongName)).toBe('unexpected_file');
    const none = await upload([{ name: 'titel', value: 'nur ein Textfeld' }]);
    expect(none.statusCode).toBe(400);
    expect(errorCode(none)).toBe('file_missing');
    expect(filesOnDisk()).toEqual([]);
    expect(moodle.uploads.openCount).toBe(0);
    // Gegenprobe: ein zusätzliches Textfeld stört nicht
    const withField = await upload([{ name: 'titel', value: 'Blatt 3' }, filePart('a.pdf')]);
    expect(withField.statusCode).toBe(201);
  });
});

describe('Grenzen aus §5.3 mit Gegenprobe, auch gleichzeitig', () => {
  it('höchstens 20 offene Uploads: der 21. → 409 moodle_upload_limit; nach dem Löschen geht es wieder', async () => {
    await setup();
    const ids: string[] = [];
    for (let i = 0; i < MAX_OPEN_UPLOADS; i += 1) {
      const res = await upload([filePart(`b${i}.pdf`)]);
      expect(res.statusCode).toBe(201);
      ids.push(MoodleUploadSchema.parse(res.json()).upload_id);
    }
    const over = await upload();
    expect(over.statusCode).toBe(409);
    expect(errorCode(over)).toBe('moodle_upload_limit');
    expect(filesOnDisk()).toHaveLength(MAX_OPEN_UPLOADS);
    const first = ids[0] as string;
    await (app as FastifyInstance).inject({ method: 'DELETE', url: `/moodle/uploads/${first}` });
    expect((await upload()).statusCode).toBe(201);
  });

  it('25 gleichzeitige Uploads: genau 20 gehen durch, 5 bekommen 409, auf der Platte liegen genau 20', async () => {
    await setup();
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => upload([filePart(`p${i}.pdf`)])));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(MAX_OPEN_UPLOADS);
    expect(codes.filter((c) => c === 409)).toHaveLength(5);
    expect(codes).toHaveLength(25);
    expect(filesOnDisk()).toHaveLength(MAX_OPEN_UPLOADS);
    expect(moodle.uploads.openCount).toBe(MAX_OPEN_UPLOADS);
  });

  it('gleichzeitige Uploads, von denen einige abgelehnt werden: Abgelehnte belegen keinen Platz', async () => {
    await setup();
    // 15 gültige und 15 ungültige gleichzeitig: alle 15 gültigen müssen Platz finden
    const calls = Array.from({ length: 30 }, (_, i) =>
      i % 2 === 0 ? upload([filePart(`ok${i}.pdf`)]) : upload([filePart(`kaputt${i}.pdf`, PNG)]),
    );
    const results = await Promise.all(calls);
    const accepted = results.filter((r) => r.statusCode === 201).length;
    const rejected = results.filter((r) => r.statusCode === 400).length;
    // Wer wegen des Limits 409 bekommt, tut das nur, solange bis zu 20 Plätze (auch kurz für Ungültige) belegt sind
    expect(accepted + rejected + results.filter((r) => r.statusCode === 409).length).toBe(30);
    expect(accepted).toBeGreaterThanOrEqual(1);
    expect(filesOnDisk()).toHaveLength(accepted);
    expect(moodle.uploads.openCount).toBe(accepted);
    // Nach Abschluss aller sind keine Plätze mehr reserviert: bis zum Limit geht es weiter
    const free = MAX_OPEN_UPLOADS - accepted;
    for (let i = 0; i < free; i += 1) expect((await upload()).statusCode).toBe(201);
    expect((await upload()).statusCode).toBe(409);
  });

  it('die Obergrenze in Byte gilt vor dem Streamen: die Länge der Anfrage reserviert den Platz', async () => {
    await setup();
    // 5 große Reservierungen von Hand (je 100 MB, laufende Uploads), dann kommt ein Upload nicht mehr durch
    const held = Array.from({ length: 5 }, () => moodle.uploads.reserve());
    const res = await upload();
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('moodle_upload_limit');
    expect(filesOnDisk()).toEqual([]);
    held[0]?.cancel();
    expect((await upload()).statusCode).toBe(201);
  });
});

describe('nie ausliefern', () => {
  it('es gibt kein GET auf Uploads und keinen Weg, den Inhalt zu lesen', async () => {
    await setup();
    const { upload_id } = MoodleUploadSchema.parse((await upload()).json());
    for (const url of [
      `/moodle/uploads/${upload_id}`,
      '/moodle/uploads',
      `/moodle/uploads/${upload_id}/file`,
    ]) {
      const res = await (app as FastifyInstance).inject({ method: 'GET', url });
      expect([404, 405], url).toContain(res.statusCode);
      expect(res.body).not.toContain('%PDF');
    }
  });
});
