'use client';

// Foliensatz einer Session setzen, wechseln oder leeren (VERTRAEGE §22.4) und PDFs „für diese Vorlesung“ hochladen
// (§22.5). Gemeinsam für die Start-Karte und die Live-Ansicht. Nach jeder Änderung gilt die `Session` aus der Antwort,
// die Optionen werden neu geladen (§22.7). Fehler stehen ruhig als Text, nie als Alarm.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { DeckOptions, Session } from '@sg/shared';
import { ApiRequestError, friendlyMessage } from '../../lib/api.ts';
import { deckOptionsKey } from '../../lib/material.ts';
import { setSessionDeck } from '../../lib/sessions.ts';
import { useOptionalUploads } from '../../lib/uploads.tsx';

export interface DeckChoice {
  busy: boolean;
  /** Ruhiger Text zum letzten Fehlschlag, sonst `null` */
  message: string | null;
  clearMessage: () => void;
  /** `true`, wenn der Core den Wunsch angenommen hat */
  choose: (deckId: string | null) => Promise<boolean>;
  /** PDFs hochladen, die der Session zugeordnet werden (ohne UploadProvider: `undefined`, dann gibt es den Weg nicht) */
  upload: ((files: File[]) => void) | undefined;
}

export function useDeckChoice(
  session: Pick<Session, 'id' | 'module_id'> | undefined,
  onSession: (session: Session) => void,
): DeckChoice {
  const client = useQueryClient();
  const uploads = useOptionalUploads();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const sessionId = session?.id ?? null;
  const moduleId = session?.module_id ?? null;

  const refresh = useCallback(() => {
    if (moduleId !== null) {
      void client.invalidateQueries({ queryKey: deckOptionsKey(moduleId, sessionId) });
    }
  }, [client, moduleId, sessionId]);

  const choose = useCallback(
    async (deckId: string | null): Promise<boolean> => {
      if (sessionId === null || busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      setMessage(null);
      try {
        const updated = await setSessionDeck(sessionId, deckId);
        // Die Antwort gilt sofort in der Momentaufnahme; die Neuladung folgt nur noch für Liste und Sperre
        if (moduleId !== null) {
          client.setQueryData<DeckOptions>(deckOptionsKey(moduleId, sessionId), (old) =>
            old
              ? {
                  ...old,
                  current_deck_id: updated.slide_deck_id,
                  suggested_deck_id: updated.slide_deck_id !== null ? null : old.suggested_deck_id,
                }
              : old,
          );
        }
        onSession(updated);
        refresh();
        return true;
      } catch (cause) {
        setMessage(friendlyMessage(cause));
        // Der Stand im Core ist ein anderer als gedacht (Satz gelöscht, geblättert, Session beendet): auffrischen
        if (cause instanceof ApiRequestError && cause.kind === 'api') {
          refresh();
          void client.invalidateQueries({ queryKey: ['sessions'] });
        }
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [sessionId, moduleId, onSession, refresh, client],
  );

  const enqueue = uploads?.enqueue;
  const upload =
    enqueue && sessionId !== null && moduleId !== null
      ? (files: File[]) => enqueue(files, { moduleId, kind: 'folien', sessionId })
      : undefined;

  return { busy, message, clearMessage: () => setMessage(null), choose, upload };
}
