import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Node-only vitest config for electron DB tests (node:sqlite migrations etc.).
 * Bypasses tests/setup.ts (which assumes a jsdom `window`) and runs in node env.
 * Run with: npx vitest run --config vitest.db.config.ts
 */
export default defineConfig({
  resolve: {
    alias: {
      '@electron': resolve(__dirname, 'electron'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'tests/db/**/*.test.ts',
      'tests/unit/sqlite-migrator-legacy-session-catalog.test.ts',
    ],
  },
});
