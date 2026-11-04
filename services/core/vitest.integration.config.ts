import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Eine gemeinsame Test-Schema-Umgebung pro Lauf, Dateien nacheinander
    fileParallelism: false,
  },
});
