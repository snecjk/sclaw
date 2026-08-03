#!/usr/bin/env zx

/**
 * Bundle gateway-preload-entry.ts → gateway-fetch-preload.cjs
 * 与 shared/dingtalk-send/dws-send-text.ts 同源，供 Gateway NODE_OPTIONS -r 预加载。
 */

import 'zx/globals';
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const entry = path.join(ROOT, 'electron/gateway/gateway-preload-entry.ts');
const outFile = path.join(ROOT, 'electron/gateway/gateway-fetch-preload.cjs');
const distOut = path.join(ROOT, 'dist-electron/main/gateway-fetch-preload.cjs');

if (!fs.existsSync(entry)) {
  echo`Missing gateway preload entry: ${entry}`;
  process.exit(1);
}

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: outFile,
  sourcemap: false,
  logLevel: 'info',
});

if (fs.existsSync(path.dirname(distOut))) {
  fs.copyFileSync(outFile, distOut);
  echo`Copied gateway preload → ${distOut}`;
}

echo`✅ Gateway preload bundled: ${outFile}`;
