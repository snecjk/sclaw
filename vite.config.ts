import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

function copyGatewayPreloadCjs(outDir: string) {
  const src = resolve(__dirname, 'electron/gateway/gateway-fetch-preload.cjs');
  if (!existsSync(src)) return;
  mkdirSync(outDir, { recursive: true });
  copyFileSync(src, resolve(outDir, 'gateway-fetch-preload.cjs'));
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // 含 .env.development.local；electron 子构建需通过 define 注入，否则读不到
  const loadedEnv = loadEnv(mode, process.cwd(), '');
  const appEnv = loadedEnv.VITE_APP_ENV || process.env.VITE_APP_ENV || (mode === 'development' ? 'development' : 'production');
  const stoMemoryCenterBaseUrl = (loadedEnv.STO_MEMORY_CENTER_BASE_URL || process.env.STO_MEMORY_CENTER_BASE_URL || '').trim();
  const stoSclawHubBaseUrl = (loadedEnv.STO_SCLAW_HUB_BASE_URL || process.env.STO_SCLAW_HUB_BASE_URL || '').trim();
  const stoWisdomStarBaseUrl = (loadedEnv.STO_WISDOM_STAR_BASE_URL || process.env.STO_WISDOM_STAR_BASE_URL || '').trim();
  const envDefine = {
    'import.meta.env.VITE_APP_ENV': JSON.stringify(appEnv),
    'process.env.STO_MEMORY_CENTER_BASE_URL': JSON.stringify(stoMemoryCenterBaseUrl),
    'process.env.STO_SCLAW_HUB_BASE_URL': JSON.stringify(stoSclawHubBaseUrl),
    'process.env.STO_WISDOM_STAR_BASE_URL': JSON.stringify(stoWisdomStarBaseUrl),
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
            // Cursor/CI may set ELECTRON_RUN_AS_NODE=1, which makes require('electron')
            // resolve to the npm path string instead of the Electron API in the main process.
            const electronEnv = { ...process.env, ...loadedEnv };
            delete electronEnv.ELECTRON_RUN_AS_NODE;

            // AgentLoop / ARMS: inject CMS probe only into the Electron main process.
            // Do NOT set NODE_OPTIONS globally — that loads the probe into vite,
            // electron-rebuild, and zx scripts during predev and breaks local startup.
            const armsLicense = (electronEnv.ARMS_LICENSE_KEY || electronEnv.ARMS_LICENSE || '').trim();
            if (armsLicense && armsLicense !== 'auto') {
              const registerFlag = '-r @loongsuite/cms_node_sdk/register';
              electronEnv.NODE_OPTIONS = electronEnv.NODE_OPTIONS?.includes(registerFlag)
                ? electronEnv.NODE_OPTIONS
                : [registerFlag, electronEnv.NODE_OPTIONS].filter(Boolean).join(' ');
              console.log(`[ARMS] CMS probe enabled for Electron main process (service=${electronEnv.ARMS_APP_NAME || electronEnv.CMS_SERVICE_NAME || 'unknown'})`);
            } else if (armsLicense === 'auto') {
              console.warn(
                '[ARMS] ARMS_LICENSE=auto is not valid for @loongsuite/cms_node_sdk. '
                  + 'Set ARMS_LICENSE_KEY in .env.development.local (from AgentLoop console).',
              );
            }

            options.startup(['.', '--no-sandbox'], { env: electronEnv });
          },
          vite: {
            define: envDefine,
            plugins: [
              {
                name: 'copy-gateway-preload-cjs',
                closeBundle() {
                  copyGatewayPreloadCjs(resolve(__dirname, 'dist-electron/main'));
                },
              },
            ],
            build: {
              outDir: 'dist-electron/main',
              rollupOptions: {
                external: [
                  'electron',
                  'electron-store',
                  'electron-updater',
                  // Keep SDK external so @loongsuite/cms_node_sdk can auto-instrument
                  // claude-agent-sdk at runtime (bundled code cannot be patched).
                  '@anthropic-ai/claude-agent-sdk',
                  /^@anthropic-ai\/claude-agent-sdk/,
                  // mem0's official OSS entry imports its provider peers at runtime.
                  // Keep it external so electron-builder packages those dependencies
                  // once under node_modules instead of duplicating them in this bundle.
                  'mem0ai/oss',
                  'ws',
                  'node:sqlite',
                  /openclaw\/extensions\//,
                  /^node:/,
                ],
                output: {
                  // Keep main process in a single file so require('electron') resolves
                  // to the built-in module (not node_modules/electron path string).
                  inlineDynamicImports: true,
                },
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
      // @tanstack/react-virtual 等包若解析到嵌套 react，会触发 useReducer null 崩溃。
      dedupe: ['react', 'react-dom'],
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
