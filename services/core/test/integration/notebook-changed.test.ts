// `notebook.changed` (VERTRAEGE §11.3, §11.6): Umbenennen, Löschen und Wiederherstellen eines Notizbuchs gehen als
// Ereignis an alle Verbindungen, auch an solche ohne Abo des Stroms `notebook:<id>`. Echter Versand ohne Mocks.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SyncEventSchema } from '@sg/shared';
import { seedModule } from './ink-helpers.ts';
import { sleep, startSyncApp, TestClient, type Msg, type SyncTestApp } from './sync-helpers.ts';

let app: SyncTestApp;
let moduleId = '';
const clients: TestClient[] = [];

beforeAll(async () => {
  app = await startSyncApp({ extra: { sessionTicker: false } });
});
afterAll(async () => {
  for (const c of clients.splice(0)) c.close();
  await app.close();
});
beforeEach(async () => {
  await app.handle.sql`TRUNCATE semester, module, notebook, session, sync_op, sync_stream CASCADE`;
  moduleId = (await seedModule(app.handle.db)).moduleId;
});
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});

/** Verbindet ohne jedes Abo (`hello.streams = []`) */
async function ready(): Promise<TestClient> {
  const client = await TestClient.open(`ws://127.0.0.1:${app.port}/sync`);
  clients.push(client);
  expect((await client.hello()).type).toBe('welcome');
  return client;
}

const api = (path: string, init: { method?: string; body?: unknown } = {}) =>
  fetch(`http://127.0.0.1:${app.port}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

const changed = (id: string, kind: string) => (m: Msg) =>
  m.type === 'event' &&
  m.name === 'notebook.changed' &&
  (m.data as { notebook_id: string; kind: string }).notebook_id === id &&
  (m.data as { kind: string }).kind === kind;

const changedEvents = (c: TestClient) => c.messages.filter((m) => m.name === 'notebook.changed');

async function createNotebook(title = 'Skizzen'): Promise<string> {
  const res = await api('/notebooks', { method: 'POST', body: { module_id: moduleId, title } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe('Ereignis notebook.changed', () => {
  it('geht beim Umbenennen, Löschen und Wiederherstellen an einen Client ohne Abo', async () => {
    const watcher = await ready();
    const id = await createNotebook();

    expect((await api(`/notebooks/${id}`, { method: 'PATCH', body: { title: 'Neu' } })).status).toBe(200);
    const update = await watcher.next(changed(id, 'update'));
    // Der Wortlaut des Ereignisses entspricht dem Schema
    expect(SyncEventSchema.parse(update)).toEqual({
      type: 'event',
      name: 'notebook.changed',
      data: { notebook_id: id, kind: 'update' },
    });

    expect((await api(`/notebooks/${id}`, { method: 'DELETE' })).status).toBe(204);
    await watcher.next(changed(id, 'delete'));

    expect((await api(`/trash/${id}/restore`, { method: 'POST' })).status).toBe(200);
    await watcher.next(changed(id, 'restore'));

    // Das Ereignis ersetzt kein Abo: Operationen des Notizbuch-Stroms kamen nicht an
    expect(watcher.of('op')).toEqual([]);
  });

  it('kommt auch, wenn das Notizbuch mit seinem Modul gelöscht und wiederhergestellt wird', async () => {
    const id = await createNotebook();
    const watcher = await ready();

    expect((await api(`/modules/${moduleId}`, { method: 'DELETE' })).status).toBe(204);
    await watcher.next(changed(id, 'delete'));

    expect((await api(`/trash/${moduleId}/restore`, { method: 'POST' })).status).toBe(200);
    await watcher.next(changed(id, 'restore'));
  });

  it('geht an jede verbundene Verbindung', async () => {
    const a = await ready();
    const b = await ready();
    const id = await createNotebook();
    await api(`/notebooks/${id}`, { method: 'DELETE' });
    await a.next(changed(id, 'delete'));
    await b.next(changed(id, 'delete'));
  });

  it('bleibt aus, wenn sich nichts ändert', async () => {
    const id = await createNotebook();
    const watcher = await ready();

    // Gleicher Titel: keine Änderung, keine Operation, kein Ereignis
    expect((await api(`/notebooks/${id}`, { method: 'PATCH', body: { title: 'Skizzen' } })).status).toBe(200);
    // Unbekanntes Notizbuch: 404
    const unknown = '019a4e14-0000-7000-8000-0000000000ee';
    expect((await api(`/notebooks/${unknown}`, { method: 'DELETE' })).status).toBe(404);
    // Die Ereignisse einer Verbindung kommen in der Reihenfolge der Commits: Ein früheres wäre vor diesem da
    await api(`/notebooks/${id}`, { method: 'PATCH', body: { title: 'Anders' } });
    await watcher.next(changed(id, 'update'));
    await sleep(100);
    expect(changedEvents(watcher)).toEqual([]);
  });
});
