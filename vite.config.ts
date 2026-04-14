import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Vite loads .env.[mode] before config resolution, so VITE_APP_ENV is
  // available in process.env here. We must explicitly inject it into the
  // electron sub-builds (main / preload) via `define`, because
  // vite-plugin-electron does not auto-propagate VITE_* env vars.
  const appEnv = process.env.VITE_APP_ENV || (mode === 'development' ? 'development' : 'production');
  const envDefine = {
    'import.meta.env.VITE_APP_ENV': JSON.stringify(appEnv),
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
