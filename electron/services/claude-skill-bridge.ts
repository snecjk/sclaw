/**
 * Claude skill bridge — thin compatibility wrapper over SkillManager.reconcile.
 */
import { getSkillManager } from './skills/skill-manager';
import { getCurrentActiveUserCode } from './user-skill-workspace';
import { getClaudeSkillsDir } from '../utils/paths';
import { constants } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sync Claude skills for an agent by reconciling the Claude engine adapter.
 * Preserves the historical return shape used by claude-adapter.
 */
export async function syncClaudeSkillsForAgent(
  agentId: string,
  _workspacePath: string,
): Promise<{ mirrored: string[]; skippedConflicts: string[] }> {
  const userCode = await getCurrentActiveUserCode();
  const results = await getSkillManager().reconcile(
    { userCode, agentId },
    ['claude'],
  );
  const claude = results.claude || { mirrored: [], removed: [], skippedConflicts: [] };
  return {
    mirrored: claude.mirrored,
    skippedConflicts: claude.skippedConflicts,
  };
}

export async function listClaudeBridgedSkillNames(_workspacePath: string): Promise<string[]> {
  const targetRoot = getClaudeSkillsDir();
  if (!(await fileExists(targetRoot))) {
    return [];
  }

  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await readdir(targetRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const targetDir = join(targetRoot, entry.name);
    const skillManifest = join(targetDir, 'SKILL.md');
    if (!(await fileExists(skillManifest))) continue;
    results.push(entry.name);
  }

  return results.sort((left, right) => left.localeCompare(right));
}
