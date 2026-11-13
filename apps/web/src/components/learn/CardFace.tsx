'use client';

import type { CardContent } from '@sg/shared';
import { clozeParts } from '../../lib/cards.ts';

const text = 'whitespace-pre-line break-words';

/** Hervorgehobene Lösung im Lückentext */
function Solution({ children }: { children: string }) {
  return (
    <mark className="rounded-sm bg-surface-raised px-1 font-medium text-text underline underline-offset-2">
      {children}
    </mark>
  );
}

/** Vorderseite: reiner Text. Bei `cloze` sind alle Lücken zusammen verdeckt (`[…]`, VERTRAEGE §21.2) */
export function CardFront({ content, compact = false }: { content: CardContent; compact?: boolean }) {
  const size = compact ? 'text-md' : 'text-xl';
  if (content.kind === 'basic') return <p className={`${text} ${size}`}>{content.front.text_md}</p>;
  return (
    <p className={`${text} ${size}`}>
      {clozeParts(content.front.text_md).map((part, i) =>
        part.gap === null ? (
          <span key={i}>{part.text}</span>
        ) : (
          <span key={i} aria-label="Lücke" className="text-text-muted">
            […]
          </span>
        ),
      )}
    </p>
  );
}

/** Rückseite: bei `basic` die Antwort, darunter die Erklärung; bei `cloze` der ganze Satz mit hervorgehobenen Lösungen */
export function CardBack({ content, compact = false }: { content: CardContent; compact?: boolean }) {
  const size = compact ? 'text-md' : 'text-xl';
  if (content.kind === 'basic') {
    return (
      <div data-testid="card-back">
        <p className={`${text} ${size}`}>{content.back.text_md}</p>
        {content.back.explanation_md ? (
          <p className={`${text} mt-3 ${compact ? 'text-sm' : 'text-md'} text-text-muted`}>
            {content.back.explanation_md}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <p data-testid="card-back" className={`${text} ${size}`}>
      {clozeParts(content.front.text_md).map((part, i) =>
        part.gap === null ? <span key={i}>{part.text}</span> : <Solution key={i}>{part.text}</Solution>,
      )}
    </p>
  );
}
