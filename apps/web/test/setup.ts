import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// findBy*/waitFor kehren sofort zurück, sobald die Bedingung stimmt; die Frist ist nur die Grenze für den
// Fehlerfall. Die Standard-Sekunde reicht unter Last (parallele Worker) nicht für das erste Rendern + Laden.
configure({ asyncUtilTimeout: 8_000 });

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    // localStorage nicht verfügbar – egal im Test
  }
});
