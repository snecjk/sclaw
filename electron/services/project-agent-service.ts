/**
 * Project-scoped OpenClaw agent management.
 *
 * OpenClaw's workspace model is per-agent, not per-session. To make OpenClaw
 * respect a project workspace, each project maps to a dedicated "project agent"
 * whose `workspace` points at the project's rootPath. Sessions created under a
 * project use this project agent's ID, so OpenClaw's normal agent workspace
 * resolution naturally lands in the correct directory.
 */

import { cp, mkdir, readdir, stat } from 'fs/promises';
import path from 'path';
import {
  createAgentWithId,
  deleteAgentConfig,
  getAgentWorkspacePath,
  listConfiguredAgentIds,
  setAgentEngineType,
  updateAgentWorkspace,
} from '../utils/agent-config';
import { getAgentEngineType } from '../utils/agent-config';
import { logger } from '../utils/logger';
import { getWorkspaceRepository } from '../db/repositories/workspace-repository';
import { getOpenClawAgentSkillsDir } from '../utils/paths';
import { safeRemoveDir } from '../utils/fs-retry';
import {
  getBaseAgentIdFromProjectAgentId,
  getProjectIdFromProjectAgentId,
  isProjectAgentId,
  parseProjectAgentId,
  PROJECT_AGENT_PREFIX,
  resolveProjectAgentId,
} from '../../shared/project-agent';

export { PROJECT_AGENT_PREFIX, resolveProjectAgentId, parseProjectAgentId, isProjectAgentId, getBaseAgentIdFromProjectAgentId, getProjectIdFromProjectAgentId };

export async function listProjectAgentIds(): Promise<string[]> {
  const allIds = await listConfiguredAgentIds();
  return allIds.filter(isProjectAgentId);
}

function normalizeWorkspacePathForCompare(workspacePath: string | null | undefined): string {
  const trimmed = workspacePath?.trim();
  if (!trimmed) return '';
  return path.normalize(path.resolve(trimmed));
}

/**
 * Ensure the project agent for a session key exists and points at the right workspace.
 * Returns the project agent ID and whether the config changed.
 */
export async function ensureProjectAgentForSessionKey(
  sessionKey: string,
): Promise<{ agentId: string | null; created: boolean; workspaceUpdated: boolean }> {
  if (!sessionKey.startsWith('agent:')) {
    return { agentId: null, created: false, workspaceUpdated: false };
  }
  const rawAgentId = sessionKey.split(':')[1] || 'main';
  const projectId = getProjectIdFromProjectAgentId(rawAgentId);
  if (!projectId) {
    return { agentId: null, created: false, workspaceUpdated: false };
  }

  const workspace = await getWorkspaceRepository().getById(projectId).catch(() => null);
  if (!workspace) {
    logger.warn('[project-agent] workspace not found for project agent session', { sessionKey, projectId });
    return { agentId: null, created: false, workspaceUpdated: false };
  }

  const baseAgentId = getBaseAgentIdFromProjectAgentId(rawAgentId) || 'main';
  const result = await ensureProjectAgent(projectId, baseAgentId, workspace.rootPath);
  return { agentId: result.agentId, created: result.created, workspaceUpdated: result.workspaceUpdated };
}

interface EnsureProjectAgentResult {
  agentId: string;
  created: boolean;
  workspaceUpdated: boolean;
}

/**
 * Ensure a project agent exists for the given project + base agent.
 * If it already exists but its workspace differs from rootPath, update it.
 */
export async function ensureProjectAgent(
  projectId: string,
  baseAgentId: string,
  rootPath: string,
): Promise<EnsureProjectAgentResult> {
  const agentId = resolveProjectAgentId(projectId, baseAgentId);
  const allIds = await listConfiguredAgentIds();
  const exists = allIds.some((id) => id.toLowerCase() === agentId.toLowerCase());

  if (exists) {
    const currentWorkspace = await getAgentWorkspacePath(agentId);
    const normalizedCurrent = normalizeWorkspacePathForCompare(currentWorkspace);
    const normalizedTarget = normalizeWorkspacePathForCompare(rootPath);
    if (normalizedCurrent && normalizedCurrent !== normalizedTarget) {
      await updateAgentWorkspace(agentId, rootPath);
      return { agentId, created: false, workspaceUpdated: true };
    }
    return { agentId, created: false, workspaceUpdated: false };
  }

  // Create new project agent inheriting bootstrap files from the main agent.
  await createAgentWithId(agentId, `Project ${projectId}`, {
    workspace: rootPath,
    inheritWorkspace: true,
  });

  // Inherit engine type from base agent so OpenClaw/Claude choice is preserved.
  try {
    const baseEngineType = await getAgentEngineType(baseAgentId);
    await setAgentEngineType(agentId, baseEngineType);
  } catch (error) {
    logger.warn('[project-agent] failed to inherit engineType', { agentId, baseAgentId, error });
  }

  // Inherit agent-scoped skills from the base agent so the project agent has the
  // same capabilities in the project workspace.
  try {
    await syncProjectAgentSkillsFromBaseAgent(projectId, baseAgentId);
  } catch (error) {
    logger.warn('[project-agent] failed to inherit agent-scoped skills', { agentId, baseAgentId, error });
  }

  logger.info('[project-agent] created', { agentId, projectId, baseAgentId, rootPath });
  return { agentId, created: true, workspaceUpdated: false };
}

/**
 * Delete the project agent for a given project + base agent.
 * Returns true if an agent was actually removed.
 */
export async function deleteProjectAgent(projectId: string, baseAgentId: string): Promise<boolean> {
  const agentId = resolveProjectAgentId(projectId, baseAgentId);
  const allIds = await listConfiguredAgentIds();
  const exists = allIds.some((id) => id.toLowerCase() === agentId.toLowerCase());
  if (!exists) return false;

  await deleteAgentConfig(agentId);
  logger.info('[project-agent] deleted', { agentId, projectId, baseAgentId });
  return true;
}

/**
 * Delete all project agents associated with a project (across all base agents).
 */
export async function deleteAllProjectAgentsForProject(projectId: string): Promise<string[]> {
  const removed: string[] = [];
  const allIds = await listConfiguredAgentIds();
  const knownBaseAgentIds = allIds.filter((id) => !isProjectAgentId(id));
  const normalizedProjectId = projectId.trim().toLowerCase();
  for (const agentId of allIds) {
    const parsed = parseProjectAgentId(agentId, knownBaseAgentIds);
    if (parsed?.projectId === normalizedProjectId) {
      await deleteAgentConfig(agentId);
      removed.push(agentId);
    }
  }
  return removed;
}

// ── Agent-scoped skill synchronization ──────────────────────────────────────

function resolveBaseAgentIdForSkillSync(agentId: string): string | null {
  if (!agentId) return null;
  const trimmed = agentId.trim().toLowerCase();
  if (isProjectAgentId(trimmed)) {
    return getBaseAgentIdFromProjectAgentId(trimmed) || null;
  }
  return trimmed;
}

async function listAgentScopedSkillSlugs(agentId: string): Promise<string[]> {
  const skillsDir = getOpenClawAgentSkillsDir(agentId);
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const slugs: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
        try {
          const s = await stat(skillMdPath);
          if (s.isFile()) {
            slugs.push(entry.name);
          }
        } catch {
          // ignore entries without SKILL.md
        }
      }
    }
    return slugs;
  } catch {
    return [];
  }
}

async function copyAgentScopedSkill(sourceAgentId: string, targetAgentId: string, slug: string): Promise<void> {
  const sourceDir = getOpenClawAgentSkillsDir(sourceAgentId);
  const targetDir = getOpenClawAgentSkillsDir(targetAgentId);
  const sourceSkillDir = path.join(sourceDir, slug);
  const targetSkillDir = path.join(targetDir, slug);

  // Ensure target skills dir exists
  await safeRemoveDir(targetSkillDir, { label: targetSkillDir }).catch(() => {});

  await mkdir(targetDir, { recursive: true });
  await cp(sourceSkillDir, targetSkillDir, { recursive: true, force: true });
}

async function removeAgentScopedSkill(agentId: string, slug: string): Promise<void> {
  const targetDir = path.join(getOpenClawAgentSkillsDir(agentId), slug);
  await safeRemoveDir(targetDir, { label: targetDir }).catch(() => {});
}

async function listProjectAgentIdsForBaseAgent(baseAgentId: string): Promise<string[]> {
  const normalizedBase = baseAgentId.trim().toLowerCase();
  const allIds = await listConfiguredAgentIds();
  return allIds.filter((agentId) => {
    const parsed = parseProjectAgentId(agentId);
    return parsed?.baseAgentId === normalizedBase;
  });
}

/**
 * Copy all agent-scoped skills from a base agent into a single project agent.
 * Called when a project agent is first created.
 */
export async function syncProjectAgentSkillsFromBaseAgent(
  projectId: string,
  baseAgentId: string,
): Promise<void> {
  const projectAgentId = resolveProjectAgentId(projectId, baseAgentId);
  const normalizedBase = baseAgentId.trim().toLowerCase();
  const slugs = await listAgentScopedSkillSlugs(normalizedBase);
  if (slugs.length === 0) return;

  for (const slug of slugs) {
    try {
      await copyAgentScopedSkill(normalizedBase, projectAgentId, slug);
    } catch (error) {
      logger.warn('[project-agent] failed to copy skill to project agent', { projectAgentId, slug, error });
    }
  }

  logger.info('[project-agent] synced agent-scoped skills from base agent', {
    projectAgentId,
    baseAgentId: normalizedBase,
    count: slugs.length,
  });
}

/**
 * Mirror an agent-scoped skill install/update from a base agent to all of its
 * project agents. Call after installing a skill with an agentId.
 */
export async function syncBaseAgentSkillInstall(
  agentId: string,
  slug: string,
): Promise<void> {
  const baseAgentId = resolveBaseAgentIdForSkillSync(agentId);
  if (!baseAgentId) return;

  const projectAgentIds = await listProjectAgentIdsForBaseAgent(baseAgentId);
  if (projectAgentIds.length === 0) return;

  for (const projectAgentId of projectAgentIds) {
    try {
      await copyAgentScopedSkill(baseAgentId, projectAgentId, slug);
    } catch (error) {
      logger.warn('[project-agent] failed to mirror skill install to project agent', { projectAgentId, slug, error });
    }
  }

  logger.info('[project-agent] mirrored skill install to project agents', {
    baseAgentId,
    slug,
    count: projectAgentIds.length,
  });
}

/**
 * Mirror an agent-scoped skill uninstall from a base agent to all of its
 * project agents. Call after uninstalling a skill with an agentId.
 */
export async function syncBaseAgentSkillUninstall(
  agentId: string,
  slug: string,
): Promise<void> {
  const baseAgentId = resolveBaseAgentIdForSkillSync(agentId);
  if (!baseAgentId) return;

  const projectAgentIds = await listProjectAgentIdsForBaseAgent(baseAgentId);
  if (projectAgentIds.length === 0) return;

  for (const projectAgentId of projectAgentIds) {
    try {
      await removeAgentScopedSkill(projectAgentId, slug);
    } catch (error) {
      logger.warn('[project-agent] failed to mirror skill uninstall to project agent', { projectAgentId, slug, error });
    }
  }

  logger.info('[project-agent] mirrored skill uninstall to project agents', {
    baseAgentId,
    slug,
    count: projectAgentIds.length,
  });
}

/**
 * Fully synchronize all agent-scoped skills from a base agent to all of its
 * existing project agents. Useful for bulk repair / manual sync.
 */
export async function syncBaseAgentSkillsToProjectAgents(agentId: string): Promise<void> {
  const baseAgentId = resolveBaseAgentIdForSkillSync(agentId);
  if (!baseAgentId) return;

  const projectAgentIds = await listProjectAgentIdsForBaseAgent(baseAgentId);
  const slugs = await listAgentScopedSkillSlugs(baseAgentId);

  for (const projectAgentId of projectAgentIds) {
    for (const slug of slugs) {
      try {
        await copyAgentScopedSkill(baseAgentId, projectAgentId, slug);
      } catch (error) {
        logger.warn('[project-agent] failed to sync skill to project agent', { projectAgentId, slug, error });
      }
    }
  }

  logger.info('[project-agent] synchronized base agent skills to project agents', {
    baseAgentId,
    projectCount: projectAgentIds.length,
    skillCount: slugs.length,
  });
}
