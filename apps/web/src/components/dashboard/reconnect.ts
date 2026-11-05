// Nach einem Verbindungsabbruch neu laden: Ereignisse, die in der Lücke fielen, kommen nicht nach (VERTRAEGE §11.6).
// Der erste Verbindungsaufbau nach dem Öffnen der Ansicht ist KEIN Abbruch: Der Abruf beim Öffnen ist ohnehin frisch.
import type { ConnectionState } from '../../lib/sync/types.ts';
import type { SyncClient } from '../../lib/sync/client.ts';

/** Zustände, in denen Ereignisse verloren gehen können (`connecting` allein ist auch der erste Aufbau) */
const DOWN: readonly ConnectionState[] = ['backoff', 'failed', 'closed'];

/**
 * Ruft `onReconnect`, wenn die Verbindung nach einem Abbruch wieder `online` ist. Gibt die Abmeldung zurück.
 * War die Verbindung beim Öffnen schon unten, zählt auch das erste `online` (der Abruf beim Öffnen kann gescheitert sein).
 */
export function watchReconnect(client: SyncClient, onReconnect: () => void): () => void {
  let wasDown = DOWN.includes(client.connectionState);
  return client.onEvent('connection', (c) => {
    if (c.state === 'online') {
      if (wasDown) onReconnect();
      wasDown = false;
    } else if (DOWN.includes(c.state)) {
      wasDown = true;
    }
  });
}
