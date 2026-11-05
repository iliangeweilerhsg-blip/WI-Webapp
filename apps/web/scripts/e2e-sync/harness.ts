// Harness für den E2E-Lauf des Web-Sync-Clients: bündelt den echten SyncClient und hängt kleine Hilfen an `window`.
// Wird von run.cjs mit esbuild gebündelt und neben den Static Export gelegt; nicht Teil des App-Builds.
import { SyncClient } from '../../src/lib/sync/client.ts';
import { IndexedDbQueueStore } from '../../src/lib/sync/store.ts';
import type { SendOpInput, StreamPosition } from '../../src/lib/sync/types.ts';

interface Boot {
  dbName: string;
}

interface Harness {
  client: SyncClient;
  sockets: WebSocket[];
  received: Record<string, { seq: number; op_id: string; kind: string }[]>;
  resets: { stream: string; reason: string; headSeq: number }[];
  states: string[];
  leaderChanged: number;
}

declare global {
  interface Window {
    __h: Harness;
    __boot: (b: Boot) => Promise<string>;
    __send: (
      inputs: SendOpInput[],
    ) => Promise<{ ok: number; handedOver: number; notLeader: number; other: string[] }>;
    __sendStaggered: (
      inputs: SendOpInput[],
      gapMs: number,
    ) => Promise<{
      ok: number;
      handedOver: number;
      notLeader: number;
      other: string[];
      notLeaderIds: string[];
    }>;
    __follow: (stream: string, from: StreamPosition, resetTo: StreamPosition | null) => void;
    __dropSocket: (code?: number) => boolean;
  }
}

/** Neuer Client in diesem Tab: eigene IndexedDB (`dbName`), echter WebSocket, Web Locks wie in der App. */
window.__boot = async ({ dbName }) => {
  const sockets: WebSocket[] = [];
  const client = new SyncClient({
    store: new IndexedDbQueueStore(dbName),
    webSocketFactory: (url) => {
      const ws = new WebSocket(url);
      sockets.push(ws);
      return ws as never;
    },
  });
  const h: Harness = { client, sockets, received: {}, resets: [], states: [], leaderChanged: 0 };
  client.onEvent('connection', (c) => h.states.push(c.state));
  client.onEvent('leader.changed', () => h.leaderChanged++);
  window.__h = h;
  await client.connect();
  return client.connectionState;
};

/** Operationen parallel senden und das Ergebnis zählen (`ack`, Übergabe an den neuen Leader, kein Leader). */
window.__send = async (inputs) => {
  const out = { ok: 0, handedOver: 0, notLeader: 0, other: [] as string[] };
  await Promise.all(
    inputs.map((i) =>
      window.__h.client.send(i).then(
        () => void out.ok++,
        (err: unknown) => {
          const name = (err as Error).name;
          if (name === 'SyncHandedOverError') out.handedOver++;
          else if (name === 'SyncNotLeaderError') out.notLeader++;
          else out.other.push(`${name}: ${(err as Error).message}`);
        },
      ),
    ),
  );
  return out;
};

/** Wie `__send`, aber mit Abstand zwischen den Aufrufen: ein Wechsel des Leaders fällt mitten in die Folge. */
window.__sendStaggered = async (inputs, gapMs) => {
  const out = { ok: 0, handedOver: 0, notLeader: 0, other: [] as string[], notLeaderIds: [] as string[] };
  const all: Promise<void>[] = [];
  for (const i of inputs) {
    const cid = i.kind === 'stroke.add' ? i.data.stroke.client_id : '';
    all.push(
      window.__h.client.send(i).then(
        () => void out.ok++,
        (err: unknown) => {
          const name = (err as Error).name;
          if (name === 'SyncHandedOverError') out.handedOver++;
          else if (name === 'SyncNotLeaderError') {
            out.notLeader++;
            out.notLeaderIds.push(cid);
          } else out.other.push(`${name}: ${(err as Error).message}`);
        },
      ),
    );
    await new Promise((r) => setTimeout(r, gapMs));
  }
  await Promise.all(all);
  return out;
};

/** Strom abonnieren und mitschreiben, was ankommt. `resetTo`: Position, die der Reset-Handler liefert. */
window.__follow = (stream, from, resetTo) => {
  const h = window.__h;
  h.received[stream] ??= [];
  h.client.subscribe(
    stream,
    from,
    (op) => h.received[stream]!.push({ seq: op.seq, op_id: op.op_id, kind: op.kind }),
    {
      onReset: (info) => {
        h.resets.push({ stream: info.stream, reason: info.reason, headSeq: info.headSeq });
        return Promise.resolve(resetTo ?? { lastSeq: 0, lastOpId: null });
      },
    },
  );
};

/** Bricht die offene Verbindung clientseitig ab (wie ein Netzabbruch: kein sauberes Schließen durch den Server). */
window.__dropSocket = (code = 4000) => {
  const ws = window.__h.sockets.at(-1);
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.close(code, 'e2e-drop');
  return true;
};
