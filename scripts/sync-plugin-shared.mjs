#!/usr/bin/env zx

/**
 * Verify and refresh self-contained shared files under sto-plugin/openclaw/*.
 * Vendor copies must match repository root `shared/*` (excluding the header comment).
 */

import 'zx/globals';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const VENDOR_HEADER = (rootRel) =>
  [
    '/**',
    ' * Self-contained copy for Gateway extension install (~/.stoclaw/openclaw/extensions/...).',
    ` * Keep in sync with repository root \`${rootRel}\`.`,
    ' */',
    '',
  ].join('\n');

const VENDOR_SYNC_PAIRS = [
  {
    rootRel: 'shared/retired-skills.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dynamic-agent-route/shared/retired-skills.ts',
  },
  {
    rootRel: 'shared/workspace-paths.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dynamic-agent-route/shared/workspace-paths.ts',
  },
];

function stripLeadingBlockComment(source) {
  let result = source;
  let prev;
  do {
    prev = result;
    result = result.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, '');
  } while (result !== prev);
  return result;
}

async function syncVendorFromRoot({ rootRel, vendorRel }) {
  const rootPath = path.join(ROOT, rootRel);
  const vendorPath = path.join(ROOT, vendorRel);
  const rootBody = stripLeadingBlockComment(await readFile(rootPath, 'utf8'));
  const nextVendor = `${VENDOR_HEADER(rootRel)}${rootBody}`;

  let currentVendor = '';
  try {
    currentVendor = await readFile(vendorPath, 'utf8');
  } catch {
    // missing vendor file — write below
  }

  if (currentVendor !== nextVendor) {
    await writeFile(vendorPath, nextVendor, 'utf8');
    echo`Synced vendor copy: ${vendorRel}`;
  }
}

const REQUIRED_PLUGIN_FILES = [
  'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-mention.ts',
  'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-disclaimer.ts',
  'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dws-send-text.ts',
  'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-file-send.ts',
  'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-mention-context.ts',
  'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-oral-send-prompt.ts',
  ...VENDOR_SYNC_PAIRS.map((pair) => pair.vendorRel),
];

for (const pair of VENDOR_SYNC_PAIRS) {
  await syncVendorFromRoot(pair);
}

for (const relPath of REQUIRED_PLUGIN_FILES) {
  const absPath = path.join(ROOT, relPath);
  await access(absPath).catch(() => {
    echo`Missing self-contained plugin file: ${relPath}`;
    process.exit(1);
  });
}

for (const pair of VENDOR_SYNC_PAIRS) {
  const rootBody = stripLeadingBlockComment(await readFile(path.join(ROOT, pair.rootRel), 'utf8'));
  const vendorBody = stripLeadingBlockComment(
    await readFile(path.join(ROOT, pair.vendorRel), 'utf8'),
  );
  if (vendorBody !== rootBody) {
    echo`Vendor drift after sync: ${pair.vendorRel}`;
    process.exit(1);
  }
}

echo`Verified self-contained OpenClaw plugin shared files (${REQUIRED_PLUGIN_FILES.length})`;
