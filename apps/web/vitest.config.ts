import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    // Obergrenzen nur für den Fehlerfall: unter Last (parallele Worker, pdf.js) dauert das erste Rendern länger als 5 s
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
