#!/usr/bin/env zx

/**
 * 开发启动前确保 OpenClaw 运行时可用。
 * pnpm 下 node_modules/openclaw 偶发仅为 skills 占位目录时，自动执行 bundle-openclaw。
 */

import 'zx/globals';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const nodeModulesOpenClaw = join(ROOT, 'node_modules', 'openclaw');
const buildOpenClaw = join(ROOT, 'build', 'openclaw');
const bundleScript = join(ROOT, 'scripts', 'bundle-openclaw.mjs');

function isValidOpenClawDir(dir) {
  return (
    existsSync(join(dir, 'package.json')) &&
    existsSync(join(dir, 'openclaw.mjs'))
  );
}

if (process.env.STOCLAW_SKIP_OPENCLAW_PREPARE === '1') {
  echo`Skipping OpenClaw dev prepare (STOCLAW_SKIP_OPENCLAW_PREPARE=1).`;
  process.exit(0);
}

if (isValidOpenClawDir(nodeModulesOpenClaw)) {
  echo`OpenClaw dev runtime: node_modules/openclaw`;
  process.exit(0);
}

if (isValidOpenClawDir(buildOpenClaw)) {
  echo`OpenClaw dev runtime: build/openclaw (node_modules/openclaw incomplete)`;
  process.exit(0);
}

echo`OpenClaw package missing, running bundle-openclaw.mjs...`;
try {
  await $`zx ${bundleScript}`;
} catch (error) {
  echo`Warning: bundle-openclaw failed: ${error?.message || error}`;
  echo`Run manually: cd sto-claw && pnpm install && pnpm run bundle:openclaw`;
  process.exit(0);
}
