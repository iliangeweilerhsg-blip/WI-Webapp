import type { SearchSnippetPart } from '@sg/shared';

/**
 * Ausschnitt eines Treffers (VERTRAEGE §19.6): Teile als Text, Treffer-Wörter als `<mark>`. Nie als HTML, der Text
 * stammt aus Folien und Transkripten.
 */
export function Snippet({ parts }: { parts: readonly SearchSnippetPart[] }) {
  return (
    <>
      {parts.map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded-sm bg-accent/25 px-0.5 text-text">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
