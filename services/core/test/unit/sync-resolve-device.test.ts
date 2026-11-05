// resolveDevice (VERTRAEGE §16.2): einzige Stelle, an der der Sync-Server request.sgDevice des Wächters liest
import { describe, expect, it } from 'vitest';
import { resolveDevice } from '../../src/sync/server.ts';

describe('resolveDevice', () => {
  it('lokal (null) und Gerät ({ deviceId }) übernimmt es, ohne sgDevice lehnt es ab', () => {
    expect(resolveDevice({ sgDevice: null })).toBeNull();
    expect(resolveDevice({ sgDevice: { deviceId: 'abc' } })).toEqual({ deviceId: 'abc' });
    expect(resolveDevice({ sgDevice: undefined })).toBe('reject');
    expect(resolveDevice({})).toBe('reject');
  });
});
