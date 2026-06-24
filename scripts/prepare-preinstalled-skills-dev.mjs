#!/usr/bin/env zx

import 'zx/globals';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const lockPath = join(ROOT, 'build', 'preinstalled-skills', '.preinstalled-lock.json');
const manifestPath = join(ROOT, 'resources', 'skills', 'preinstalled-manifest.json');
const localSkillsRoot = join(ROOT, 'resources', 'skills');
const cacheDir = join(ROOT, '.download-cache', 'preinstalled-skills');
const bundleScript = join(ROOT, 'scripts', 'bundle-preinstalled-skills.mjs');

if (process.env.CLAWX_SKIP_PREINSTALLED_SKILLS_PREPARE === '1') {
  echo`Skipping preinstalled skills prepare (CLAWX_SKIP_PREINSTALLED_SKILLS_PREPARE=1).`;
  process.exit(0);
}

function hashSkillMd(slug) {
  const skillMdPath = join(localSkillsRoot, slug, 'SKILL.md');
  if (!existsSync(skillMdPath)) {
    return null;
  }
  const hash = createHash('sha256');
  hash.update(readFileSync(skillMdPath, 'utf8'));
  return hash.digest('hex').substring(0, 16);
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
    const lockBySlug = new Map((lock.skills || []).map((entry) => [entry.slug, entry]));

    const manifestRaw = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);
    const manifestSkills = manifest.skills || [];

    for (const entry of manifestSkills) {
      if (!entry?.slug) continue;

      if (!lockBySlug.has(entry.slug)) {
        echo`Manifest has new skill "${entry.slug}" not present in lock; rebundling...`;
        return true;
      }

      if (!entry.local) continue;

      const currentHash = hashSkillMd(entry.slug);
      const lockEntry = lockBySlug.get(entry.slug);
      if (currentHash && lockEntry?.version !== currentHash) {
        echo`Local skill "${entry.slug}" changed (${lockEntry?.version || 'missing'} -> ${currentHash}); rebundling...`;
        return true;
      }
    }

    return false;
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

if (existsSync(cacheDir)) {
  rmSync(cacheDir, { recursive: true, force: true });
}

try {
  await $`zx ${bundleScript}`;
} catch (error) {
  // Dev startup should remain available even if network-based skill fetching fails.
  echo`Warning: failed to prepare preinstalled skills for dev startup: ${error?.message || error}`;
  process.exit(0);
}
