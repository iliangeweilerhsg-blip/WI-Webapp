// SyncProvider mit echtem SyncClient: gefälschtes Leader-Lock und WebSocket, StrictMode, zwei Tabs (Provider)
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { LeaderLock, LeaderLockHandlers } from '../src/lib/sync/tabs.ts';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

class FakeLocks {
  holder: FakeLock | null = null;
  waiting: FakeLock[] = [];
  created: FakeLock[] = [];
  create = (): LeaderLock => {
    const l = new FakeLock(this);
    this.created.push(l);
    return l;
  };
}
class FakeLock implements LeaderLock {
  handlers: LeaderLockHandlers | null = null;
  stopped = false;
  private readonly owner: FakeLocks;
  constructor(owner: FakeLocks) {
    this.owner = owner;
  }
  start(h: LeaderLockHandlers): void {
    this.handlers = h;
    if (!this.owner.holder) {
      this.owner.holder = this;
      h.onLeader();
    } else {
      h.onOtherTab();
      this.owner.waiting.push(this);
    }
  }
  steal(): void {}
  stop(): void {
    this.stopped = true;
    this.owner.waiting = this.owner.waiting.filter((w) => w !== this);
    if (this.owner.holder === this) {
      this.owner.holder = null;
      const next = this.owner.waiting.shift();
      if (next) {
        this.owner.holder = next;
        next.handlers?.onLeader();
      }
    }
  }
}

const locks = { current: new FakeLocks() };
vi.mock('../src/lib/sync/tabs.ts', () => ({ createWebLocksLeader: () => locks.current.create() }));

import { SyncProvider, useSyncClient } from '../src/lib/sync/SyncProvider.tsx';
import { OtherTabBanner } from '../src/lib/sync/OtherTabBanner.tsx';
import { SyncClient } from '../src/lib/sync/client.ts';

const sockets: { url: string; closed: boolean }[] = [];
class FakeWS {
  readyState = 0;
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  rec: { url: string; closed: boolean };
  constructor(url: string) {
    this.rec = { url, closed: false };
    sockets.push(this.rec);
  }
  send() {}
  close() {
    this.rec.closed = true;
    this.readyState = 3;
  }
}

beforeEach(() => {
  locks.current = new FakeLocks();
  sockets.length = 0;
  vi.stubGlobal('WebSocket', FakeWS);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Probe({ seen }: { seen: (SyncClient | null)[] }) {
  const c = useSyncClient();
  seen.push(c);
  return c ? <OtherTabBanner client={c} /> : null;
}

describe('SyncProvider mit echtem SyncClient', () => {
  it('StrictMode: ein Client, ein gehaltenes Lock, ein offener Socket; Unmount gibt alles frei', async () => {
    const connect = vi.spyOn(SyncClient.prototype, 'connect');
    const seen: (SyncClient | null)[] = [];
    const view = render(
      <StrictMode>
        <SyncProvider>
          <Probe seen={seen} />
        </SyncProvider>
      </StrictMode>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const clients = new Set(connect.mock.contexts);
    expect(clients.size).toBe(1);
    const client = [...clients][0] as SyncClient;
    expect(seen.at(-1)).toBe(client);
    // nur ein Lock wurde angelegt (der StrictMode-Abbruch kam vor dem Anlegen)
    expect(locks.current.created.length).toBe(1);
    expect(locks.current.holder?.stopped).toBe(false);
    expect(client.leader).toBe(true);
    const open = sockets.filter((s) => !s.closed);
    expect(sockets.length).toBe(1);
    expect(open.length).toBe(1);
    expect(client.connectionState).toBe('connecting');
    expect(screen.queryByText(/anderen Tab/)).toBeNull();

    view.unmount();
    expect(client.connectionState).toBe('closed');
    expect(locks.current.holder).toBeNull();
    expect(sockets.every((s) => s.closed)).toBe(true);
  });

  it('zwei Tabs (zwei Provider): der zweite zeigt den Banner, nach Schließen des ersten wird er Leader', async () => {
    const a = render(
      <StrictMode>
        <SyncProvider>
          <Probe seen={[]} />
        </SyncProvider>
      </StrictMode>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const b = render(
      <StrictMode>
        <SyncProvider>
          <div data-testid="b">
            <Probe seen={[]} />
          </div>
        </SyncProvider>
      </StrictMode>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByTestId('b')).toHaveTextContent('in einem anderen Tab aktiv');
    expect(sockets.filter((s) => !s.closed).length).toBe(1);
    a.unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByTestId('b')).not.toHaveTextContent('in einem anderen Tab aktiv');
    expect(sockets.filter((s) => !s.closed).length).toBe(1);
    b.unmount();
  });
});
