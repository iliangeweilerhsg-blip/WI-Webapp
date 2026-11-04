// SERVER_ONLY_KINDS ist eine Liste von Hand (VERTRAEGE §16.2). Sie muss zu den Schema-Varianten passen, die laut
// Beschreibung nur der Server schreibt. Kommt eine neue Server-Operation dazu, schlägt dieser Test fehl.
import { describe, expect, it } from 'vitest';
import { SyncOpSchema } from '@sg/shared';
import { SERVER_ONLY_KINDS } from '../../src/sync/handlers.ts';

describe('SERVER_ONLY_KINDS', () => {
  it('enthält genau die Operationen, deren Schema „Nur vom Server“ sagt', () => {
    const fromSchema = SyncOpSchema.options
      .filter((o) => o.description?.startsWith('Nur vom Server'))
      .map((o) => o.shape.kind.value)
      .sort();
    expect(fromSchema.length).toBeGreaterThan(0);
    expect([...SERVER_ONLY_KINDS].sort()).toEqual(fromSchema);
  });
});
