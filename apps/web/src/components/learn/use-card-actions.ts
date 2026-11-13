'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { Card, CardContent } from '@sg/shared';
import {
  CARDS_KEY,
  REVIEW_KEY,
  cardErrorMessage,
  deleteCard,
  patchCard,
  restoreCard,
} from '../../lib/cards.ts';
import { UNDO_MS } from '../../lib/inbox.ts';
import { useToast } from '../../lib/toast.tsx';

export type SaveResult = { ok: true; card: Card } | { ok: false; message: string };

/** Ändern, Pausieren und Löschen einer Karte (VERTRAEGE §21.4, §21.10); Löschen mit 10-s-Toast „Rückgängig“ (R15) */
export function useCardActions() {
  const client = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: CARDS_KEY });
    void client.invalidateQueries({ queryKey: REVIEW_KEY });
  }, [client]);

  /** Neuer Inhalt (`PATCH`); der FSRS-Zustand bleibt (§21.4) */
  const saveContent = useCallback(
    async (card: Card, content: CardContent): Promise<SaveResult> => {
      setBusy(true);
      try {
        const saved = await patchCard(card.id, { content });
        refresh();
        return { ok: true, card: saved };
      } catch (error) {
        return { ok: false, message: cardErrorMessage(error) };
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const setSuspended = useCallback(
    async (card: Card, suspended: boolean): Promise<Card | null> => {
      setBusy(true);
      try {
        const saved = await patchCard(card.id, { suspended });
        refresh();
        return saved;
      } catch (error) {
        toast.show({ message: cardErrorMessage(error) });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [refresh, toast],
  );

  const remove = useCallback(
    async (card: Card): Promise<boolean> => {
      setBusy(true);
      try {
        await deleteCard(card.id);
      } catch (error) {
        toast.show({ message: cardErrorMessage(error) });
        return false;
      } finally {
        setBusy(false);
      }
      refresh();
      toast.show({
        message: 'Karte gelöscht',
        actionLabel: 'Rückgängig',
        durationMs: UNDO_MS,
        focusAction: true,
        onAction: () => {
          restoreCard(card.id)
            .then(refresh)
            .catch((error: unknown) => toast.show({ message: cardErrorMessage(error) }));
        },
      });
      return true;
    },
    [refresh, toast],
  );

  return { busy, saveContent, setSuspended, remove };
}
