#!/usr/bin/env zx

/**
 * 兼容保留：已迁移为插件目录自包含实现。
 * 该脚本继续存在，仅用于校验关键文件是否齐全，避免 package.json 中现有 predev 引用失效。
 */

import 'zx/globals';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const REQUIRED_PLUGIN_FILES = [
  'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-mention.ts',
  'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-disclaimer.ts',
  'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dws-send-text.ts',
  'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-file-send.ts',
  'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-mention-context.ts',
  'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-oral-send-prompt.ts',
  'sto-plugin/openclaw/sto-dynamic-agent-route/shared/retired-skills.ts',
];

for (const relPath of REQUIRED_PLUGIN_FILES) {
  const absPath = path.join(ROOT, relPath);
  await access(absPath).catch(() => {
    echo`Missing self-contained plugin file: ${relPath}`;
    process.exit(1);
  });
}

echo`Verified self-contained OpenClaw plugin shared files (${REQUIRED_PLUGIN_FILES.length})`;
