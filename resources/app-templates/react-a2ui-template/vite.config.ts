import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Engineering base aligned with STO company publish-platform Vite template:
 * - default port 3000
 * - production outDir `build/` (platform expects this)
 * Path aliases match company tsconfig (`@/*`, `$src/*`).
 * SClaw app-dev still overrides `--port` / `--host` when spawning.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      $src: fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3000,
  },
  build: {
    outDir: 'build',
  },
});
