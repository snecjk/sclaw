#!/usr/bin/env zx

/**
 * Bundle Gateway and Pi utilityProcess --require preloads.
 * Gateway: security + DWS send normalization (NODE_OPTIONS / execArgv).
 * Pi: hide Windows console windows for powershell/tool spawns.
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

const piHideEntry = path.join(ROOT, 'electron/pi-runtime/windows-hide-preload-entry.ts');
const piHideOut = path.join(ROOT, 'electron/pi-runtime/windows-hide-preload.cjs');
const piHideDistMain = path.join(ROOT, 'dist-electron/main/windows-hide-preload.cjs');
const piHideDistWorker = path.join(ROOT, 'dist-electron/pi-runtime/windows-hide-preload.cjs');

await esbuild.build({
  entryPoints: [piHideEntry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: piHideOut,
  sourcemap: false,
  logLevel: 'info',
});

for (const dest of [piHideDistMain, piHideDistWorker]) {
  if (!fs.existsSync(path.dirname(dest))) continue;
  fs.copyFileSync(piHideOut, dest);
  echo`Copied Pi windows-hide preload → ${dest}`;
}

echo`✅ Pi windows-hide preload bundled: ${piHideOut}`;
