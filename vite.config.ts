import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';
import {
  applyAgentLoopRuntimeEnv,
  resolveAgentLoopBuildConfig,
  serializeAgentLoopSecrets,
  toAgentLoopProcessEnvDefine,
} from './scripts/agentloop-env';

function copyGatewayPreloadCjs(outDir: string) {
  const src = resolve(__dirname, 'electron/gateway/gateway-fetch-preload.cjs');
  if (!existsSync(src)) return;
  mkdirSync(outDir, { recursive: true });
  copyFileSync(src, resolve(outDir, 'gateway-fetch-preload.cjs'));
}

function copyPiWindowsHidePreloadCjs(outDir: string) {
  const src = resolve(__dirname, 'electron/pi-runtime/windows-hide-preload.cjs');
  if (!existsSync(src)) return;
  mkdirSync(outDir, { recursive: true });
  copyFileSync(src, resolve(outDir, 'windows-hide-preload.cjs'));
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // 含 .env.development.local；electron 子构建需通过 define 注入，否则读不到
  const loadedEnv = loadEnv(mode, process.cwd(), '');
  const appEnv = loadedEnv.VITE_APP_ENV || process.env.VITE_APP_ENV || (mode === 'development' ? 'development' : 'production');
  const stoMemoryCenterBaseUrl = (loadedEnv.STO_MEMORY_CENTER_BASE_URL || process.env.STO_MEMORY_CENTER_BASE_URL || '').trim();
  const stoSclawHubBaseUrl = (loadedEnv.STO_SCLAW_HUB_BASE_URL || process.env.STO_SCLAW_HUB_BASE_URL || '').trim();
  const stoWisdomStarBaseUrl = (loadedEnv.STO_WISDOM_STAR_BASE_URL || process.env.STO_WISDOM_STAR_BASE_URL || '').trim();

  // AgentLoop / ARMS：按 mode 读取对应环境文件中的接入配置，ARMS_APP_NAME 以配置值为准。
  // 非敏感字段走 define 注入主进程 bundle；License 只写入 dist-electron/main/agentloop.config.json，
  // 由主进程引导入口在运行时读取（构建日志与代码生成中均不出现凭证值）。
  const agentLoopConfig = resolveAgentLoopBuildConfig(mode, loadedEnv, process.env);
  for (const warning of agentLoopConfig.warnings) {
    console.warn(warning);
  }
  // The main and preload watchers can each be the first one to ask
  // vite-plugin-electron to start Electron. Seed non-secret values on the
  // parent process so both startup paths inherit the same AgentLoop config.
  applyAgentLoopRuntimeEnv(agentLoopConfig, process.env);
  const envDefine = {
    'import.meta.env.VITE_APP_ENV': JSON.stringify(appEnv),
    'process.env.STO_MEMORY_CENTER_BASE_URL': JSON.stringify(stoMemoryCenterBaseUrl),
    'process.env.STO_SCLAW_HUB_BASE_URL': JSON.stringify(stoSclawHubBaseUrl),
    'process.env.STO_WISDOM_STAR_BASE_URL': JSON.stringify(stoWisdomStarBaseUrl),
    ...toAgentLoopProcessEnvDefine(agentLoopConfig),
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

            // AgentLoop / ARMS：探针改由主进程引导入口（electron/main/index.ts）统一注册，
            // 覆盖 development 与打包应用。此处不再注入 NODE_OPTIONS --require，
            // 避免把探针带进 vite / electron-rebuild / zx 等前置脚本进程。

            options.startup(['.', '--no-sandbox'], { env: electronEnv });
          },
          vite: {
            define: envDefine,
            plugins: [
              {
                name: 'copy-gateway-preload-cjs',
                closeBundle() {
                  copyGatewayPreloadCjs(resolve(__dirname, 'dist-electron/main'));
                  copyPiWindowsHidePreloadCjs(resolve(__dirname, 'dist-electron/main'));
                },
              },
              {
                name: 'write-agentloop-config-json',
                closeBundle() {
                  // License 不进 Vite define：构建日志和产物源码中都不出现凭证值，
                  // 运行时由主进程引导入口读取该文件并注入 process.env。
                  const outDir = resolve(__dirname, 'dist-electron/main');
                  mkdirSync(outDir, { recursive: true });
                  writeFileSync(
                    resolve(outDir, 'agentloop.config.json'),
                    serializeAgentLoopSecrets(agentLoopConfig.secrets),
                    'utf-8',
                  );
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
                  // Keep the CMS probe itself external too: it uses import-in-the-middle
                  // to hook claude-agent-sdk at runtime, which requires real module files
                  // on disk (must not be inlined into the main bundle).
                  '@loongsuite/cms_node_sdk/register',
                  /^@loongsuite\/cms_node_sdk/,
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
                  // 主进程为多 chunk 输出：引导入口 index.js（先注册 AgentLoop 探针）
                  // + 业务入口 main.js（由 index 在探针注册后 require）。两者同为 CJS，
                  // require('electron') 在任一分片中均解析为内置模块（而非 node_modules
                  // 路径字符串），故无需再用 inlineDynamicImports 强制单文件——该选项会把
                  // require('./main') 拆出的 main.js 分片静默丢弃，导致业务逻辑缺失。
                  inlineDynamicImports: false,
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
        {
          // Pi coding runtime: isolated Electron utilityProcess entry (no port).
          entry: 'electron/pi-runtime/worker-entry.ts',
          vite: {
            define: envDefine,
            plugins: [
              {
                name: 'copy-pi-windows-hide-preload-cjs',
                closeBundle() {
                  copyPiWindowsHidePreloadCjs(resolve(__dirname, 'dist-electron/pi-runtime'));
                },
              },
            ],
            build: {
              outDir: 'dist-electron/pi-runtime',
              rollupOptions: {
                external: [
                  'electron',
                  /^@earendil-works\/pi-/,
                  /^node:/,
                ],
                output: {
                  entryFileNames: 'worker-entry.js',
                  inlineDynamicImports: true,
                },
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
