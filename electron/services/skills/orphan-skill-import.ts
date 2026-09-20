/**
 * Debounced import of unmanaged skill directories into skills-store user scope.
 * Handles agents that bypass save_user_skill and write to openclaw/skills or workspace/skills.
 */
import fs from 'fs';
import path from 'path';
import { getOpenClawSkillsDir } from '../../utils/paths';
import { readPreinstalledManifestSlugs } from '../../utils/skill-config';
import { logger } from '../../utils/logger';
import { getAgentWorkspacePath } from '../../utils/agent-config';
import { getCurrentActiveUserCode } from '../user-skill-workspace';
import { getSkillEntry, resolvePackageDir } from './canonical-store';
import { isOpenClawProjectionManaged } from './adapters/openclaw-skill-adapter';
import { normalizeSkillMarkdown, parseSkillFrontmatter } from '../../utils/skill-frontmatter';
import { getSkillManager } from './skill-manager';
import { slugFromFrontmatterName } from './skill-package';

const DEBOUNCE_MS = 2_000;
const MAX_CANDIDATES = 40;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
const inFlightSlugs = new Set<string>();

export type OrphanImportResult = {
  scanned: number;
  imported: string[];
  skipped: string[];
};

function readSkillMeta(skillMdPath: string): { name?: string; description?: string; version?: string } {
  try {
    const raw = normalizeSkillMarkdown(fs.readFileSync(skillMdPath, 'utf8'));
    const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return {};
    const meta = parseSkillFrontmatter(match[1]);
    return {
      name: meta.name?.trim() || undefined,
      description: meta.description?.trim() || undefined,
      version: meta.version?.trim() || undefined,
    };
  } catch {
    return {};
  }
}

async function listScanRoots(): Promise<string[]> {
  const roots: string[] = [getOpenClawSkillsDir()];
  try {
    const workspace = await getAgentWorkspacePath('main');
    if (workspace) {
      roots.push(path.join(workspace, 'skills'));
    }
  } catch {
    // ignore workspace resolve errors
  }
  return roots;
}

async function collectUnmanagedCandidates(
  userCode: string,
): Promise<Array<{ slug: string; sourceDir: string }>> {
  const whitelist = readPreinstalledManifestSlugs();
  const out: Array<{ slug: string; sourceDir: string }> = [];
  const seen = new Set<string>();

  for (const root of await listScanRoots()) {
    if (!fs.existsSync(root)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (out.length >= MAX_CANDIDATES) return out;

      const sourceDir = path.join(root, entry.name);
      const skillMd = path.join(sourceDir, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;

      // Skip engine-managed projections — they already mirror skills-store.
      if (isOpenClawProjectionManaged(sourceDir)) continue;

      let slug: string;
      try {
        const meta = readSkillMeta(skillMd);
        slug = slugFromFrontmatterName(meta.name || entry.name);
      } catch {
        slug = entry.name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
      }
      if (!slug || whitelist.has(slug) || seen.has(slug)) continue;

      const existing = await getSkillEntry({ slug, scope: 'user', userCode });
      if (existing) {
        const packageDir = resolvePackageDir(existing);
        if (fs.existsSync(path.join(packageDir, 'SKILL.md'))) continue;
      }

      seen.add(slug);
      out.push({ slug, sourceDir });
    }
  }

  return out;
}

/**
 * Import unmanaged skill dirs for the current user. Safe to call repeatedly.
 * Never throws to callers — errors are logged.
 */
export async function runOrphanSkillImport(reason = 'manual'): Promise<OrphanImportResult> {
  const result: OrphanImportResult = { scanned: 0, imported: [], skipped: [] };
  if (running) return result;
  running = true;

  try {
    const userCode = await getCurrentActiveUserCode();
    if (!userCode) {
      logger.debug(`[orphan-skill-import] skip (${reason}): not logged in`);
      return result;
    }

    const candidates = await collectUnmanagedCandidates(userCode);
    result.scanned = candidates.length;
    const manager = getSkillManager();

    for (const candidate of candidates) {
      if (inFlightSlugs.has(candidate.slug)) {
        result.skipped.push(candidate.slug);
        continue;
      }
      inFlightSlugs.add(candidate.slug);
      try {
        const meta = readSkillMeta(path.join(candidate.sourceDir, 'SKILL.md'));
        await manager.installFromLocalDir({
          slug: candidate.slug,
          sourceDir: candidate.sourceDir,
          version: meta.version || '1.0.0',
          source: 'local',
          enabled: true,
          scope: 'user',
          name: meta.name || candidate.slug,
          description: meta.description,
        });
        result.imported.push(candidate.slug);
        logger.info(
          `[orphan-skill-import] imported ${candidate.slug} from ${candidate.sourceDir} (${reason})`,
        );
      } catch (error) {
        result.skipped.push(candidate.slug);
        logger.warn(
          `[orphan-skill-import] failed ${candidate.slug}:`,
          error instanceof Error ? error.message : error,
        );
      } finally {
        inFlightSlugs.delete(candidate.slug);
      }
    }
  } catch (error) {
    logger.warn(
      `[orphan-skill-import] run failed (${reason}):`,
      error instanceof Error ? error.message : error,
    );
  } finally {
    running = false;
  }

  return result;
}

/** Debounced schedule — never blocks chat/send path. */
export function scheduleOrphanSkillImport(reason = 'schedule'): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runOrphanSkillImport(reason);
  }, DEBOUNCE_MS);
}

/** Test helper */
export function _resetOrphanSkillImportForTests(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  running = false;
  inFlightSlugs.clear();
}
