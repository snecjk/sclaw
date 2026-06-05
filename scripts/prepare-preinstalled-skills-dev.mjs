#!/usr/bin/env zx

import 'zx/globals';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const lockPath = join(ROOT, 'build', 'preinstalled-skills', '.preinstalled-lock.json');
const manifestPath = join(ROOT, 'resources', 'skills', 'preinstalled-manifest.json');
const bundleScript = join(ROOT, 'scripts', 'bundle-preinstalled-skills.mjs');

if (process.env.CLAWX_SKIP_PREINSTALLED_SKILLS_PREPARE === '1') {
  echo`Skipping preinstalled skills prepare (CLAWX_SKIP_PREINSTALLED_SKILLS_PREPARE=1).`;
  process.exit(0);
}

function needsRebundle() {
  if (!existsSync(lockPath)) {
    return true; // lock 不存在，需要 bundle
  }

  if (!existsSync(manifestPath)) {
    return false; // manifest 不存在，无法判断，保持现状
  }

  try {
    const lockRaw = readFileSync(lockPath, 'utf8');
    const lock = JSON.parse(lockRaw);
    const lockSlugs = new Set((lock.skills || []).map((s) => s.slug));

    const manifestRaw = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);
    const manifestSlugs = new Set((manifest.skills || []).map((s) => s.slug));

    // 如果 manifest 中有 lock 里不存在的 skill，说明新增了内置 skill，需要重新 bundle
    for (const slug of manifestSlugs) {
      if (!lockSlugs.has(slug)) {
        echo`Manifest has new skill "${slug}" not present in lock; rebundling...`;
        return true;
      }
    }

    return false; // lock 已存在且包含所有 manifest 中的 skills
  } catch {
    // 解析失败时保守处理：重新 bundle
    return true;
  }
}

if (!needsRebundle()) {
  echo`Preinstalled skills bundle is up to date, skipping prepare.`;
  process.exit(0);
}

echo`Preinstalled skills bundle stale or missing, preparing for dev startup...`;

try {
  await $`zx ${bundleScript}`;
} catch (error) {
  // Dev startup should remain available even if network-based skill fetching fails.
  echo`Warning: failed to prepare preinstalled skills for dev startup: ${error?.message || error}`;
  process.exit(0);
}
