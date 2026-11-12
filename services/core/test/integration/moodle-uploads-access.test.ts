// Uploads für Moodle-Aktionen nur vom Mac selbst und nie unter einem Idempotency-Key (08 §9.3, Plan T1-24 E2/E3)
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MoodleUploadSchema } from '@sg/shared';
import { idempotencyKey } from '../../src/db/schema/index.ts';
import { createMoodleServices } from '../../src/moodle/index.ts';
import { StaticTokenStore } from '../../src/moodle/token-store.ts';
import { FAKE_BASE, FAKE_TOKEN, fakeFetch, restHandler, siteInfo } from '../unit/moodle-fake.ts';
import { occupyPort, startTestApp, type TestApp } from './helpers.ts';

const API = '/api/v1';
const DEVICE_ID = '0190f6a2-0000-7000-8000-0000000000f3';
const BOUNDARY = '----sgintegrationboundary';

function multipart(filename = 'loesung.pdf', content = '%PDF-1.7\nLösung\n') {
  const payload = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/pdf\r\n\r\n${content}\r\n--${BOUNDARY}--\r\n`,
  );
  return {
    payload,
    headers: {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      'content-length': String(payload.length),
    },
  };
}

let enabled: TestApp;
let disabled: TestApp;
let dataDir: string;
let disabledDir: string;
let requests: ReturnType<typeof fakeFetch>['requests'];

function services(dir: string, moodleActions: ('files.upload_private' | 'assign.save_draft')[]) {
  const fake = fakeFetch(
    restHandler({ core_webservice_get_site_info: siteInfo(['core_webservice_get_site_info']) }),
  );
  requests = fake.requests;
  return createMoodleServices({
    config: { moodleUrl: FAKE_BASE, dataDir: dir, moodleActions },
    tokens: new StaticTokenStore(FAKE_TOKEN),
    fetch: fake.fetch,
    readMeta: async () => ({ token_valid_until: '2027-01-27' }),
  });
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'sg-core-moodle-uploads-'));
  disabledDir = mkdtempSync(join(tmpdir(), 'sg-core-moodle-uploads-off-'));
  enabled = await startTestApp(
    { moodleUrl: FAKE_BASE, dataDir },
    {
      moodle: services(dataDir, ['files.upload_private']),
      verifyDeviceToken: async () => ({ deviceId: DEVICE_ID }),
    },
  );
  disabled = await startTestApp(
    { moodleUrl: FAKE_BASE, dataDir: disabledDir },
    { moodle: services(disabledDir, []), verifyDeviceToken: async () => ({ deviceId: DEVICE_ID }) },
  );
});

afterAll(async () => {
  await enabled.close();
  await disabled.close();
});

beforeEach(() => {
  requests.length = 0;
});

/** Anfrage aus dem Netz (gekoppeltes iPad im WLAN) */
const fromNetwork = (t: TestApp, options: InjectOptions & { token?: string }) =>
  t.app.inject({
    remoteAddress: '192.168.1.20',
    ...options,
    headers: {
      host: 'mac.local:4710',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
  });

const errorCode = (res: { json: () => unknown }) => (res.json() as { error: { code: string } }).error.code;
const uploadsOnDisk = () => {
  const dir = join(dataDir, 'tmp', 'moodle-uploads');
  return existsSync(dir) ? readdirSync(dir) : [];
};

describe('Uploads aus dem Netz', () => {
  it('POST: 401 ohne Token, 403 local_only mit gültigem Geräte-Token, nichts wird gespeichert', async () => {
    const { payload, headers } = multipart();
    const none = await fromNetwork(enabled, {
      method: 'POST',
      url: `${API}/moodle/uploads`,
      payload,
      headers,
    });
    expect(none.statusCode).toBe(401);
    const res = await fromNetwork(enabled, {
      method: 'POST',
      url: `${API}/moodle/uploads`,
      payload,
      headers,
      token: 'EXAMPLEdevicetoken000',
    });
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('local_only');
    expect(uploadsOnDisk()).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it('DELETE: 401 ohne Token, 403 local_only mit gültigem Geräte-Token, der Upload bleibt', async () => {
    const { payload, headers } = multipart();
    const created = await enabled.request({ method: 'POST', url: `${API}/moodle/uploads`, payload, headers });
    expect(created.statusCode).toBe(201);
    const { upload_id } = MoodleUploadSchema.parse(created.json());
    const url = `${API}/moodle/uploads/${upload_id}`;
    expect((await fromNetwork(enabled, { method: 'DELETE', url })).statusCode).toBe(401);
    const res = await fromNetwork(enabled, { method: 'DELETE', url, token: 'EXAMPLEdevicetoken000' });
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('local_only');
    expect(uploadsOnDisk()).toContain(upload_id);
    // Gegenprobe: lokal geht es
    expect((await enabled.request({ method: 'DELETE', url })).statusCode).toBe(204);
    expect(uploadsOnDisk()).not.toContain(upload_id);
  });

  it('auch bei leerem SG_MOODLE_ACTIONS gilt zuerst „nur lokal“ (403), lokal dann 501', async () => {
    const { payload, headers } = multipart();
    const network = await fromNetwork(disabled, {
      method: 'POST',
      url: `${API}/moodle/uploads`,
      payload,
      headers,
      token: 'EXAMPLEdevicetoken000',
    });
    expect(network.statusCode).toBe(403);
    const local = await disabled.request({ method: 'POST', url: `${API}/moodle/uploads`, payload, headers });
    expect(local.statusCode).toBe(501);
    expect(errorCode(local)).toBe('moodle_action_not_implemented');
    expect(existsSync(join(disabledDir, 'tmp'))).toBe(false);
  });
});

describe('Uploads nie unter einem Idempotency-Key', () => {
  it('POST mit Idempotency-Key: kein Eintrag in idempotency_key, kein Replay, jedes Mal ein neuer Upload', async () => {
    const key = crypto.randomUUID();
    const send = () => {
      const { payload, headers } = multipart();
      return enabled.request({
        method: 'POST',
        url: `${API}/moodle/uploads`,
        payload,
        headers: { ...headers, 'idempotency-key': key },
      });
    };
    const first = await send();
    expect(first.statusCode).toBe(201);
    const second = await send();
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replay']).toBeUndefined();
    const a = MoodleUploadSchema.parse(first.json()).upload_id;
    const b = MoodleUploadSchema.parse(second.json()).upload_id;
    expect(a).not.toBe(b);
    expect(uploadsOnDisk()).toEqual(expect.arrayContaining([a, b]));
    const stored = await enabled.handle.db
      .select()
      .from(idempotencyKey)
      .where(sql`${idempotencyKey.key} = ${key}::uuid`);
    expect(stored).toHaveLength(0);
  });

  it('DELETE mit Idempotency-Key wird ebenfalls nicht gespeichert', async () => {
    const { payload, headers } = multipart();
    const created = await enabled.request({ method: 'POST', url: `${API}/moodle/uploads`, payload, headers });
    const { upload_id } = MoodleUploadSchema.parse(created.json());
    const key = crypto.randomUUID();
    const res = await enabled.request({
      method: 'DELETE',
      url: `${API}/moodle/uploads/${upload_id}`,
      headers: { 'idempotency-key': key },
    });
    expect(res.statusCode).toBe(204);
    const stored = await enabled.handle.db
      .select()
      .from(idempotencyKey)
      .where(sql`${idempotencyKey.key} = ${key}::uuid`);
    expect(stored).toHaveLength(0);
  });
});

describe('Start des Core', () => {
  async function createUpload(): Promise<string> {
    const { payload, headers } = multipart();
    const created = await enabled.request({ method: 'POST', url: `${API}/moodle/uploads`, payload, headers });
    expect(created.statusCode).toBe(201);
    return MoodleUploadSchema.parse(created.json()).upload_id;
  }

  it('nach erfolgreichem listen (onListen) ist tmp/moodle-uploads geleert: Reste eines früheren Laufs sind weg', async () => {
    await createUpload();
    expect(uploadsOnDisk().length).toBeGreaterThan(0);
    // Ein neuer Core auf demselben Datenordner (Neustart) beginnt mit leerem Ordner
    const moodle = services(dataDir, ['files.upload_private']);
    const restarted = await startTestApp({ moodleUrl: FAKE_BASE, dataDir }, { moodle });
    try {
      // Vor dem listen ändert sich nichts
      expect(uploadsOnDisk().length).toBeGreaterThan(0);
      await restarted.app.listen({ port: 0, host: '127.0.0.1' });
      // Der Hook läuft nach dem listen, ohne dass listen darauf wartet
      await moodle.uploads.whenReady();
      expect(uploadsOnDisk()).toEqual([]);
    } finally {
      await restarted.close();
    }
  });

  it('ein zweiter Core, dessen listen mit EADDRINUSE scheitert, löscht keine Uploads des laufenden Core', async () => {
    const id = await createUpload();
    const blocker = await occupyPort();
    const second = await startTestApp(
      { moodleUrl: FAKE_BASE, dataDir },
      { moodle: services(dataDir, ['files.upload_private']) },
    );
    try {
      await expect(second.app.listen({ port: blocker.port, host: '127.0.0.1' })).rejects.toThrow(
        /EADDRINUSE/,
      );
    } finally {
      await second.close();
      await blocker.close();
    }
    expect(uploadsOnDisk()).toContain(id);
  });
});
