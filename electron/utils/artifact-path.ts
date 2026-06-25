import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, normalize } from 'node:path';
import { homedir } from 'node:os';
import { expandPath, getLegacyOpenClawWorkspaceRoot, getOpenClawConfigDir } from './paths';
import {
  isWindowsDrivePath,
  normalizeArtifactPathPrefix,
} from '../../shared/artifact-path';

const EXT_FUZZY_ALTERNATES: Record<string, string[]> = {
  '.ts': ['.tsv'],
  '.htm': ['.html'],
};

/** Known agent output subdirs under each workspace root (canonical first). */
const WORKSPACE_OUTPUT_SUBDIRS = ['.claw-output', 'outputs'] as const;

function decodePathSegments(filePath: string): string {
  let path = filePath.trim();
  if (!path.includes('%')) return path;
  try {
    const once = decodeURIComponent(path);
    if (once.includes('%')) {
      try {
        return decodeURIComponent(once);
      } catch {
        return once;
      }
    }
    return once;
  } catch {
    return path;
  }
}

function normalizeInputPath(filePath: string): string {
  const decoded = decodePathSegments(filePath);
  return normalizeArtifactPathPrefix(decoded, homedir());
}

function listWorkspaceRoots(): string[] {
  const configDir = getOpenClawConfigDir();
  const roots = [join(configDir, 'workspace')];
  try {
    for (const entry of readdirSync(configDir)) {
      if (entry.startsWith('workspace-')) {
        roots.push(join(configDir, entry));
      }
    }
  } catch { /* ignore */ }

  const legacyRoot = getLegacyOpenClawWorkspaceRoot();
  const normalizedLegacy = normalize(legacyRoot);
  if (
    existsSync(legacyRoot)
    && !roots.some((root) => normalize(root) === normalizedLegacy)
  ) {
    roots.push(legacyRoot);
  }

  return roots;
}

function fuzzyExistingPath(filePath: string): string | null {
  if (existsSync(filePath)) return filePath;
  const ext = extname(filePath);
  for (const alt of EXT_FUZZY_ALTERNATES[ext.toLowerCase()] ?? []) {
    const altPath = `${filePath.slice(0, -ext.length)}${alt}`;
    if (existsSync(altPath)) return altPath;
  }
  return null;
}

function fuzzyBasenameInDir(dir: string, fileName: string): string | null {
  const exact = fuzzyExistingPath(join(dir, fileName));
  if (exact) return exact;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }

  const ext = extname(fileName).toLowerCase();
  if (!ext) return null;

  const stem = basename(fileName, extname(fileName));
  const sameExt = entries.filter((entry) => entry.toLowerCase().endsWith(ext));

  for (const entry of sameExt) {
    const entryStem = basename(entry, extname(entry));
    if (entryStem === stem) {
      const found = fuzzyExistingPath(join(dir, entry));
      if (found) return found;
    }
    if (entryStem.startsWith(stem) || stem.startsWith(entryStem)) {
      const found = fuzzyExistingPath(join(dir, entry));
      if (found) return found;
    }
  }

  const dateMatch = stem.match(/(_\d{8}(?:_v\d+)?)$/);
  if (dateMatch) {
    const dateSuffix = dateMatch[1];
    const stemPrefix = stem.slice(0, -dateSuffix.length);
    for (const entry of sameExt) {
      const entryStem = basename(entry, extname(entry));
      if (!entryStem.endsWith(dateSuffix)) continue;
      const entryPrefix = entryStem.slice(0, -dateSuffix.length);
      if (entryPrefix.includes(stemPrefix) || stemPrefix.includes(entryPrefix)) {
        const found = fuzzyExistingPath(join(dir, entry));
        if (found) return found;
      }
    }
  }

  return null;
}

/** Exact basename match across workspace roots (canonical stoclaw roots first). */
function findExactInDirs(fileName: string, dirs: string[]): string | null {
  for (const dir of dirs) {
    const direct = join(dir, fileName);
    const found = fuzzyExistingPath(direct);
    if (found) return found;
    for (const subdir of WORKSPACE_OUTPUT_SUBDIRS) {
      const nested = join(dir, subdir, fileName);
      const foundNested = fuzzyExistingPath(nested);
      if (foundNested) return foundNested;
    }
  }
  return null;
}

/** Fuzzy basename match — only after exact matches fail across all roots. */
function findFuzzyInDirs(fileName: string, dirs: string[]): string | null {
  for (const dir of dirs) {
    for (const subdir of WORKSPACE_OUTPUT_SUBDIRS) {
      const fuzzyNested = fuzzyBasenameInDir(join(dir, subdir), fileName);
      if (fuzzyNested) return fuzzyNested;
    }
  }
  return null;
}

function relativePathCandidates(normalized: string): string[] {
  const roots = listWorkspaceRoots();
  const candidates: string[] = [];
  const trimmed = normalized.replace(/^\.\//, '');

  for (const root of roots) {
    candidates.push(join(root, normalized));
    candidates.push(join(root, trimmed));
    for (const subdir of WORKSPACE_OUTPUT_SUBDIRS) {
      if (!trimmed.startsWith(`${subdir}/`) && trimmed !== subdir) {
        candidates.push(join(root, subdir, trimmed));
        candidates.push(join(root, subdir, basename(trimmed)));
      }
    }
  }

  return candidates;
}

/**
 * Resolve a preview file path for Host API read/stat/serve.
 * - Expands `~`, `/.stoclaw`, and legacy `.openclaw/workspace`
 * - Relative paths search workspace / workspace-* / `.claw-output` / `outputs`
 * - Exact basename wins across all roots before fuzzy near-miss fallback
 */
export function resolveWorkspaceFilePath(filePath: string): string {
  const normalized = normalizeInputPath(filePath);
  const roots = listWorkspaceRoots();

  if (normalized.startsWith('~')) {
    return expandPath(normalized);
  }

  if (isAbsolute(normalized) || isWindowsDrivePath(normalized)) {
    const found = fuzzyExistingPath(normalized);
    if (found) return found;

    const fileName = basename(normalized);
    const exact = findExactInDirs(fileName, roots);
    if (exact) return exact;

    const fuzzySameDir = fuzzyBasenameInDir(dirname(normalized), fileName);
    if (fuzzySameDir) return fuzzySameDir;

    const fuzzy = findFuzzyInDirs(fileName, roots);
    if (fuzzy) return fuzzy;

    return normalized;
  }

  const candidates = relativePathCandidates(normalized);
  const existing = candidates.find((p) => existsSync(p));
  if (existing) return existing;

  const fuzzy = candidates.map((p) => fuzzyExistingPath(p)).find(Boolean);
  if (fuzzy) return fuzzy;

  const fileName = basename(normalized);
  const exact = findExactInDirs(fileName, roots);
  if (exact) return exact;

  const fuzzyByName = findFuzzyInDirs(fileName, roots);
  if (fuzzyByName) return fuzzyByName;

  return candidates[0] ?? join(getOpenClawConfigDir(), 'workspace', normalized);
}
