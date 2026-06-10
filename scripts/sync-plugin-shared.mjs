#!/usr/bin/env zx

/**
 * 将 shared/ 钉钉发送相关模块同步到 sto-plugin，供 OpenClaw 插件与主仓同源引用。
 */

import 'zx/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SHARED_FILES = [
  'dingtalk-mention.ts',
  'dingtalk-disclaimer.ts',
  'dws-send-text.ts',
  'dingtalk-file-send.ts',
  'dingtalk-mention-context.ts',
];

const PLUGIN_TARGETS = [
  'sto-plugin/sto-dynamic-agent-route/shared',
];

for (const relTarget of PLUGIN_TARGETS) {
  const destDir = path.join(ROOT, relTarget);
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of SHARED_FILES) {
    const src = path.join(ROOT, 'shared', file);
    const dest = path.join(destDir, file);
    if (!fs.existsSync(src)) {
      echo`Missing shared module: ${src}`;
      process.exit(1);
    }
    fs.copyFileSync(src, dest);
  }
  echo`Synced ${SHARED_FILES.length} shared modules → ${relTarget}`;
}
