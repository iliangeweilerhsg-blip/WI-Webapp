'use client';

// Abschnitt „Karten“ in der Konzeptansicht (VERTRAEGE §21.10): Vorderseite, Typ, Zustand in Worten, ✦ bei KI-Karten.
// „Karte anlegen“ (von Hand, B5) öffnet den Editor mit den Belegen des Konzepts.
import { useRef, useState } from 'react';
import type { Card, EvidenceView } from '@sg/shared';
import { CARD_KIND_LABELS, cardFrontText, cardStateText, useConceptCards } from '../../lib/cards.ts';
import { friendlyMessage } from '../../lib/api.ts';
import { CardEditor } from './CardEditor.tsx';
import { CardEditFields } from './CardEditFields.tsx';
import { CardMenu } from './CardMenu.tsx';
import { CardSourceChips } from './CardSourceChips.tsx';
import { useCardActions } from './use-card-actions.ts';

const mark = 'rounded-sm border border-border px-1.5 py-0.5 text-xs text-text-muted';

function CardRow({ card }: { card: Card }) {
  const actions = useCardActions();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const front = cardFrontText(card.content);
  return (
    <li data-card-id={card.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
      {editing ? (
        <div className="min-w-0 flex-1 basis-72">
          <CardEditFields
            content={card.content}
            busy={actions.busy}
            error={error}
            onCancel={() => setEditing(false)}
            onSave={(content) => {
              void actions.saveContent(card, content).then((result) => {
                if (result.ok) setEditing(false);
                else setError(result.message);
              });
            }}
          />
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1 basis-72">
            <p className="whitespace-pre-line break-words">
              {front}
              {card.origin === 'ki' ? (
                <>
                  <span aria-hidden="true" title="Vorschlag der KI" className="ml-2 text-text-muted">
                    ✦
                  </span>
                  <span className="sr-only"> (Vorschlag der KI)</span>
                </>
              ) : null}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
              <span>{CARD_KIND_LABELS[card.content.kind]}</span>
              <span data-testid="card-state">{cardStateText(card)}</span>
            </p>
            <div className="mt-2">
              <CardSourceChips sources={card.sources} label="Quellen dieser Karte" />
            </div>
          </div>
          <CardMenu
            suspended={card.suspended}
            label={front}
            busy={actions.busy}
            onEdit={() => {
              setError(null);
              setEditing(true);
            }}
            onToggleSuspended={() => void actions.setSuspended(card, !card.suspended)}
            onDelete={() => void actions.remove(card)}
          />
        </>
      )}
    </li>
  );
}

const addButton = 'min-h-9 rounded-md border border-border px-3 py-1 text-sm hover:bg-surface sg-transition';

export interface ConceptCardsProps {
  conceptId: string;
  conceptName: string;
  /** Belege des Konzepts: Aus ihnen wählt der Editor den Beleg der neuen Karte (§21.10) */
  evidence: readonly EvidenceView[];
}

export function ConceptCards({ conceptId, conceptName, evidence }: ConceptCardsProps) {
  const cards = useConceptCards(conceptId);
  const items = cards.data?.items;
  const [creating, setCreating] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // Gelöschte Folien und Foliensätze kann der Core nicht mehr belegen
  const sources = evidence
    .filter((e) => !e.missing)
    .map((e) => ({ ref: e.ref, hint: e.slide_title ?? e.session?.title ?? null }));
  return (
    <section aria-labelledby="concept-cards" className="mt-8">
      <h2 id="concept-cards" className="flex items-center gap-2 text-lg font-medium">
        Karten
        {items && items.length > 0 ? (
          <span className={mark} data-testid="card-count">
            {items.length}
          </span>
        ) : null}
      </h2>
      <div className="mt-2">
        {sources.length === 0 ? (
          <p className="text-sm text-text-muted">
            Keine Belege mehr. Ohne Beleg lässt sich keine Karte anlegen.
          </p>
        ) : creating ? (
          <CardEditor
            concepts={[{ id: conceptId, name: conceptName }]}
            sources={sources}
            onDone={() => {
              setCreating(false);
              requestAnimationFrame(() => trigger.current?.focus());
            }}
          />
        ) : (
          <button ref={trigger} type="button" className={addButton} onClick={() => setCreating(true)}>
            Karte anlegen
          </button>
        )}
      </div>
      {cards.isError && !items ? (
        <p role="status" className="mt-2 text-md text-text-muted">
          Die Karten sind gerade nicht erreichbar: {friendlyMessage(cards.error)}
        </p>
      ) : !items ? (
        <p role="status" aria-busy="true" className="mt-2 text-md text-text-muted">
          Lädt …
        </p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-md text-text-muted">
          Noch keine Karten. Sie entstehen als Vorschlag nach einer Vorlesung.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {items.map((card) => (
            <CardRow key={card.id} card={card} />
          ))}
        </ul>
      )}
    </section>
  );
}
