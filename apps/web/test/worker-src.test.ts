// Punkt 5: Nach einem gescheiterten Worker-Start bekommt der Neuversuch einen Cache-Buster (Chrome cacht sonst den Fehler)
import { describe, expect, it } from 'vitest';
import { workerSource } from '../src/lib/pdf.ts';

describe('workerSource', () => {
  it('ohne Fehlschlag keine, danach eine eigene Cache-Buster-Nummer', () => {
    expect(workerSource(0)).not.toContain('retry=');
    expect(workerSource(1)).toContain('retry=1');
    expect(workerSource(2)).toContain('retry=2');
    expect(workerSource(2)).not.toBe(workerSource(1));
  });
});
