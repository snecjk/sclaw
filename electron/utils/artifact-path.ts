import { existsSync, readdirSync } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { expandPath, getOpenClawConfigDir } from './paths';
import {
  isWindowsDrivePath,
  normalizeArtifactPathPrefix,
} from '../../shared/artifact-path';

const EXT_FUZZY_ALTERNATES: Record<string, string[]> = {
  '.ts': ['.tsv'],
  '.htm': ['.html'],
};

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

function findInDirs(fileName: string, dirs: string[]): string | null {
  for (const dir of dirs) {
    const direct = join(dir, fileName);
    const found = fuzzyExistingPath(direct);
    if (found) return found;
    const clawOutput = join(dir, '.claw-output', fileName);
    const foundClaw = fuzzyExistingPath(clawOutput);
    if (foundClaw) return foundClaw;
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
    if (!trimmed.startsWith('.claw-output')) {
      candidates.push(join(root, '.claw-output', trimmed));
      candidates.push(join(root, '.claw-output', basename(trimmed)));
    }
  }

  return candidates;
}

/**
 * Resolve a preview file path for Host API read/stat/serve.
 * - Expands `~`, `/.stoclaw`, and legacy `.openclaw/workspace`
 * - Relative paths search workspace / workspace-* / `.claw-output`
 * - Fuzzy extension (.ts → .tsv) and basename fallback
 */
export function resolveWorkspaceFilePath(filePath: string): string {
  const normalized = normalizeInputPath(filePath);

  if (normalized.startsWith('~')) {
    return expandPath(normalized);
  }

  if (isAbsolute(normalized) || isWindowsDrivePath(normalized)) {
    const found = fuzzyExistingPath(normalized);
    if (found) return found;
    const byName = findInDirs(basename(normalized), listWorkspaceRoots());
    if (byName) return byName;
    return normalized;
  }

  const candidates = relativePathCandidates(normalized);
  const existing = candidates.find((p) => existsSync(p));
  if (existing) return existing;

  const fuzzy = candidates.map((p) => fuzzyExistingPath(p)).find(Boolean);
  if (fuzzy) return fuzzy;

  const byName = findInDirs(basename(normalized), listWorkspaceRoots());
  if (byName) return byName;

  return candidates[0] ?? join(getOpenClawConfigDir(), 'workspace', normalized);
}
