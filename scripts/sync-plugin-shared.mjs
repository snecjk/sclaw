#!/usr/bin/env zx

/**
 * Verify and refresh self-contained shared files under sto-plugin/openclaw/*.
 * Vendor copies must match repository root `shared/*` (excluding the header comment).
 */

import 'zx/globals';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_SHARED_VENDOR_PAIRS } from './plugin-shared-vendor-pairs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const VENDOR_HEADER = (rootRel) =>
  [
    '/**',
    ' * Self-contained copy for Gateway extension install (~/.stoclaw/openclaw/extensions/...).',
    ` * Keep in sync with repository root \`${rootRel}\`.`,
    ' * Regenerate: `pnpm run sync:plugin-shared`',
    ' */',
    '',
  ].join('\n');

export function stripLeadingBlockComment(source) {
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
    await mkdir(path.dirname(vendorPath), { recursive: true });
    await writeFile(vendorPath, nextVendor, 'utf8');
    echo`Synced vendor copy: ${vendorRel}`;
  }
}

const REQUIRED_PLUGIN_FILES = PLUGIN_SHARED_VENDOR_PAIRS.map((pair) => pair.vendorRel);

for (const pair of PLUGIN_SHARED_VENDOR_PAIRS) {
  await syncVendorFromRoot(pair);
}

for (const relPath of REQUIRED_PLUGIN_FILES) {
  const absPath = path.join(ROOT, relPath);
  await access(absPath).catch(() => {
    echo`Missing self-contained plugin file: ${relPath}`;
    process.exit(1);
  });
}

for (const pair of PLUGIN_SHARED_VENDOR_PAIRS) {
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
