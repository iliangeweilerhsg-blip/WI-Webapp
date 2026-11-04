// Punkt 5: Der Worker bekommt beim Neuversuch einen Cache-Buster (Chrome cacht sonst den gescheiterten Import)
import { describe, expect, it } from 'vitest';
import { workerSource } from '../src/lib/pdf.ts';

describe('workerSource', () => {
  it('erster Versuch ohne, weitere mit eigenem Cache-Buster', () => {
    expect(workerSource(0)).not.toContain('retry=');
    expect(workerSource(1)).toContain('retry=1');
    expect(workerSource(2)).toContain('retry=2');
    expect(workerSource(2)).not.toBe(workerSource(1));
  });
});
