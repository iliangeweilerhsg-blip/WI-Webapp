import { onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeQueryClient } from '../src/lib/query.tsx';

// Der Core ist lokal: Meldet der Browser „offline“, laufen Abfragen und Mutationen trotzdem
describe('makeQueryClient ohne Browser-Netz', () => {
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it('führt eine Abfrage aus, obwohl der Browser offline meldet', async () => {
    onlineManager.setOnline(false);
    const client = makeQueryClient();
    const queryFn = vi.fn().mockResolvedValue({ ok: true });
    await expect(client.fetchQuery({ queryKey: ['offline-probe'], queryFn })).resolves.toEqual({ ok: true });
    expect(queryFn).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it('führt eine Mutation aus, obwohl der Browser offline meldet', async () => {
    onlineManager.setOnline(false);
    const client = makeQueryClient();
    const mutationFn = vi.fn().mockResolvedValue('gespeichert');
    const mutation = client.getMutationCache().build(client, { mutationFn });
    await expect(mutation.execute(undefined)).resolves.toBe('gespeichert');
    expect(mutationFn).toHaveBeenCalledTimes(1);
    client.clear();
  });
});
