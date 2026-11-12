import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../src/lib/api.ts';
import { makeQueryClient } from '../src/lib/query.tsx';

// Der Core ist lokal: Meldet der Browser „offline“, laufen Abfragen und Mutationen trotzdem
describe('makeQueryClient ohne Browser-Netz', () => {
  let client: QueryClient | undefined;

  afterEach(() => {
    client?.clear();
    client = undefined;
    onlineManager.setOnline(true);
  });

  it('führt eine Abfrage aus, obwohl der Browser offline meldet', async () => {
    onlineManager.setOnline(false);
    client = makeQueryClient();
    const queryFn = vi.fn().mockResolvedValue({ ok: true });
    await expect(client.fetchQuery({ queryKey: ['offline-probe'], queryFn })).resolves.toEqual({ ok: true });
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('scheitert bei echtem Core-Ausfall nach einem Wiederholungsversuch, statt zu pausieren', async () => {
    onlineManager.setOnline(false);
    client = makeQueryClient();
    const down = new ApiRequestError({
      kind: 'unreachable',
      message: 'x',
      userMessage: 'Core nicht erreichbar',
    });
    const queryFn = vi.fn().mockRejectedValue(down);
    await expect(client.fetchQuery({ queryKey: ['offline-down'], queryFn, retryDelay: 0 })).rejects.toBe(
      down,
    );
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it('führt eine Mutation aus, obwohl der Browser offline meldet', async () => {
    onlineManager.setOnline(false);
    client = makeQueryClient();
    const mutationFn = vi.fn().mockResolvedValue('gespeichert');
    const mutation = client.getMutationCache().build(client, { mutationFn });
    await expect(mutation.execute(undefined)).resolves.toBe('gespeichert');
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });
});
