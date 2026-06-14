import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const stoToolkitDir = resolve(__dirname, 'sto-plugin', 'sto-toolkit');

/**
 * Rewrite `./sto-toolkit/*` imports inside sto-workflow-tool to the real
 * sto-plugin/sto-toolkit directory. On Windows, core.symlinks=false leaves
 * git symlinks as plain text files so Vite cannot traverse them as directories.
 */
function resolveStoToolkitPlugin() {
  return {
    name: 'resolve-sto-toolkit',
    resolveId(source: string, importer: string | undefined) {
      if (!importer || !source.startsWith('./sto-toolkit/')) return null;
      if (!importer.includes('sto-workflow-tool')) return null;
      let rest = source.slice('./sto-toolkit/'.length);
      // Strip .js and point to the real .ts file
      if (rest.endsWith('.js')) rest = rest.slice(0, -3) + '.ts';
      // Normalize to forward slashes for vitest compatibility
      const resolved = resolve(stoToolkitDir, rest).replace(/\\/g, '/');
      return resolved;
    },
  };
}

export default defineConfig({
  plugins: [react(), resolveStoToolkitPlugin()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron'),
    },
  },
});
