import { access, cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { readOpenClawConfig } from '../utils/channel-config';
import { getOpenClawAgentSkillsDir, getOpenClawSkillsDir } from '../utils/paths';
import { logger } from '../utils/logger';

const BRIDGE_MARKER_FILE = '.stoclaw-claude-skill-bridge.json';

type OpenClawConfig = {
  skills?: {
    entries?: Record<string, {
      enabled?: boolean;
    }>;
  };
};

type SkillSource = {
  slug: string;
  sourceDir: string;
  scope: 'global' | 'agent';
};

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function listSkillDirectories(baseDir: string, scope: SkillSource['scope']): Promise<SkillSource[]> {
  if (!(await fileExists(baseDir))) {
    return [];
  }

  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await readdir(baseDir, { withFileTypes: true });
  } catch (error) {
    logger.warn(`Failed to read Claude skill bridge source directory: ${baseDir}`, error);
    return [];
  }

  const results: SkillSource[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourceDir = join(baseDir, entry.name);
    const skillManifest = join(sourceDir, 'SKILL.md');
    if (!(await fileExists(skillManifest))) continue;
    results.push({
      slug: entry.name,
      sourceDir,
      scope,
    });
  }
  return results;
}

function isSkillEnabled(config: OpenClawConfig, slug: string): boolean {
  return config.skills?.entries?.[slug]?.enabled !== false;
}

async function readBridgeMarker(targetDir: string): Promise<boolean> {
  return fileExists(join(targetDir, BRIDGE_MARKER_FILE));
}

async function writeBridgeMarker(targetDir: string, payload: Record<string, unknown>): Promise<void> {
  await writeFile(join(targetDir, BRIDGE_MARKER_FILE), `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

export async function syncClaudeSkillsForAgent(
  agentId: string,
  workspacePath: string,
): Promise<{ mirrored: string[]; skippedConflicts: string[] }> {
  const targetRoot = join(workspacePath, '.claude', 'skills');
  await mkdir(targetRoot, { recursive: true });

  const config = await readOpenClawConfig() as OpenClawConfig;
  const globalSkills = await listSkillDirectories(getOpenClawSkillsDir(), 'global');
  const agentSkills = await listSkillDirectories(getOpenClawAgentSkillsDir(agentId), 'agent');

  const desiredSkills = new Map<string, SkillSource>();
  for (const skill of globalSkills) {
    if (isSkillEnabled(config, skill.slug)) {
      desiredSkills.set(skill.slug, skill);
    }
  }
  for (const skill of agentSkills) {
    if (isSkillEnabled(config, skill.slug)) {
      desiredSkills.set(skill.slug, skill);
    }
  }

  const mirrored: string[] = [];
  const skippedConflicts: string[] = [];

  for (const [slug, skill] of desiredSkills) {
    const targetDir = join(targetRoot, slug);
    const targetExists = await fileExists(targetDir);
    const managedByBridge = targetExists ? await readBridgeMarker(targetDir) : false;

    if (targetExists && !managedByBridge) {
      skippedConflicts.push(slug);
      logger.warn(`Skipping Claude skill bridge for ${slug}: target already exists and is not bridge-managed`, { targetDir });
      continue;
    }

    if (targetExists) {
      await rm(targetDir, { recursive: true, force: true });
    }

    await cp(skill.sourceDir, targetDir, { recursive: true, force: true });
    await writeBridgeMarker(targetDir, {
      source: 'stoclaw-openclaw-skills',
      slug,
      scope: skill.scope,
      sourceDir: skill.sourceDir,
      syncedAt: new Date().toISOString(),
    });
    mirrored.push(slug);
  }

  let targetEntries: Array<import('node:fs').Dirent>;
  try {
    targetEntries = await readdir(targetRoot, { withFileTypes: true });
  } catch {
    targetEntries = [];
  }

  for (const entry of targetEntries) {
    if (!entry.isDirectory()) continue;
    const targetDir = join(targetRoot, entry.name);
    const managedByBridge = await readBridgeMarker(targetDir);
    if (!managedByBridge) continue;
    if (desiredSkills.has(entry.name)) continue;
    await rm(targetDir, { recursive: true, force: true });
  }

  return { mirrored, skippedConflicts };
}

export async function listClaudeBridgedSkillNames(workspacePath: string): Promise<string[]> {
  const targetRoot = join(workspacePath, '.claude', 'skills');
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
