import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // 含 .env.development.local；electron 子构建需通过 define 注入，否则读不到
  const env = loadEnv(mode, process.cwd(), '');
  const appEnv = env.VITE_APP_ENV || process.env.VITE_APP_ENV || (mode === 'development' ? 'development' : 'production');
  const stoMemoryCenterBaseUrl = (env.STO_MEMORY_CENTER_BASE_URL || process.env.STO_MEMORY_CENTER_BASE_URL || '').trim();
  const envDefine = {
    'import.meta.env.VITE_APP_ENV': JSON.stringify(appEnv),
    'process.env.STO_MEMORY_CENTER_BASE_URL': JSON.stringify(stoMemoryCenterBaseUrl),
  };

  return {
    // Required for Electron: all asset URLs must be relative because the renderer
    // loads via file:// in production. vite-plugin-electron-renderer sets this
    // automatically, but we declare it explicitly so the intent is clear and the
    // build remains correct even if plugin order ever changes.
    base: './',
    plugins: [
      react(),
      electron([
        {
          // Main process entry file
          entry: 'electron/main/index.ts',
          onstart(options) {
            options.startup();
          },
          vite: {
            define: envDefine,
            build: {
              outDir: 'dist-electron/main',
              rollupOptions: {
                external: [
                  'electron-store',
                  'electron-updater',
                  'ws',
                  /openclaw\/extensions\//,
                ],
              },
            },
          },
        },
        {
          // Preload scripts entry file
          entry: 'electron/preload/index.ts',
          onstart(options) {
            options.reload();
          },
          vite: {
            define: envDefine,
            build: {
              outDir: 'dist-electron/preload',
              rollupOptions: {
                external: ['electron'],
              },
            },
          },
        },
      ]),
      renderer(),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@electron': resolve(__dirname, 'electron'),
      },
    },
    server: {
      port: 5173,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
