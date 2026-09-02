import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { ssoAuthVite } from '@sto/sclaw-plugin-sso-auth/vite';
import { buildViteProxyFromFile } from './scripts/dev-proxy.mjs';
import { resolveSsoApiProxyTarget } from './scripts/sso-env.mjs';

/**
 * Engineering base aligned with STO company publish-platform Vite template:
 * - default port 3000
 * - production outDir `build/` (platform expects this)
 * Path aliases match company tsconfig (`@/*`, `$src/*`).
 * SClaw app-dev still overrides `--port` / `--host` when spawning.
 *
 * Dev API proxy: contracts/dev-proxy.v1.json → /proxy/<key>/* → target origin.
 * Register new hosts with: node scripts/ensure-dev-proxy.mjs <absolute-url>
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const ssoApiProxyTarget = resolveSsoApiProxyTarget(env);

  return {
    plugins: [ssoAuthVite(), react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        $src: fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 3000,
      proxy: {
        ...buildViteProxyFromFile(),
        '/sso-api': {
          target: ssoApiProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/sso-api/, ''),
        },
      },
    },
    build: {
      outDir: 'build',
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
  };
});
