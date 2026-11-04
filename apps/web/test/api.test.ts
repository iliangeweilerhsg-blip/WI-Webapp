import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModuleListSchema } from '@sg/shared';
import { ApiRequestError, apiGet, friendlyMessage, isUnreachable } from '../src/lib/api.ts';

function mockFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiGet', () => {
  it('liefert validierte Daten', async () => {
    mockFetch(async () => json({ items: [], next_cursor: null }));
    await expect(apiGet('/modules', ModuleListSchema)).resolves.toEqual({ items: [], next_cursor: null });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/modules',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('meldet „Core nicht erreichbar", wenn fetch scheitert', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = await apiGet('/modules', ModuleListSchema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(isUnreachable(err)).toBe(true);
    expect(friendlyMessage(err)).toBe('Core nicht erreichbar');
  });

  it('übersetzt ApiError-Antworten in freundliche Meldungen', async () => {
    mockFetch(async () =>
      json({ error: { code: 'device_token_required', message: 'Token fehlt', details: {} } }, 401),
    );
    const err = await apiGet('/modules', ModuleListSchema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).code).toBe('device_token_required');
    expect((err as ApiRequestError).status).toBe(401);
    expect(friendlyMessage(err)).toBe('Dieses Gerät ist noch nicht mit dem Core gekoppelt.');
  });

  it('fällt bei unbekanntem Code und Nicht-JSON auf den Status zurück', async () => {
    mockFetch(async () => new Response('<html>Bad Gateway</html>', { status: 502 }));
    const err = await apiGet('/modules', ModuleListSchema).catch((e: unknown) => e);
    expect(friendlyMessage(err)).toBe('Im Core ist etwas schiefgegangen. Versuch es gleich noch einmal.');
  });

  it('lehnt Antworten ab, die nicht zum Schema passen', async () => {
    mockFetch(async () => json({ items: [{ id: 'kaputt' }], next_cursor: null }));
    const err = await apiGet('/modules', ModuleListSchema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).kind).toBe('invalid');
    expect(friendlyMessage(err)).toBe('Der Core hat unerwartet geantwortet.');
  });
});
