/**
 * One-time migration: lift default agent workspaces from ~/.stoclaw/openclaw/workspace*
 * to ~/.stoclaw/workspace* when the legacy directory exists and the new target does not.
 */
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { migrateWorkspaceTildePath } from '../../shared/workspace-paths';
import { readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import { logger } from './logger';
import {
  getDefaultAgentWorkspacePath,
  getLegacyDefaultAgentWorkspacePath,
  getLegacyManagedAgentWorkspacePath,
  getManagedAgentWorkspacePath,
} from './paths';

async function migrateLegacyWorkspaceDirectories(agentIds: string[]): Promise<void> {
  const normalizedIds = [...new Set(
    ['main', ...agentIds.map((id) => id.trim().toLowerCase()).filter(Boolean)],
  )];

  for (const agentId of normalizedIds) {
    const legacy = agentId === 'main'
      ? getLegacyDefaultAgentWorkspacePath()
      : getLegacyManagedAgentWorkspacePath(agentId);
    const next = agentId === 'main'
      ? getDefaultAgentWorkspacePath()
      : getManagedAgentWorkspacePath(agentId);

    if (legacy === next) continue;
    if (!existsSync(legacy)) continue;
    if (existsSync(next)) continue;

    try {
      await rename(legacy, next);
      logger.info('[workspace-migration] moved legacy workspace directory', {
        agentId,
        from: legacy,
        to: next,
      });
    } catch (error) {
      logger.warn('[workspace-migration] failed to move legacy workspace directory', {
        agentId,
        from: legacy,
        to: next,
        error: String(error),
      });
    }
  }
}

async function migrateLegacyWorkspaceConfig(): Promise<boolean> {
  const config = await readOpenClawConfig() as {
    agents?: {
      defaults?: { workspace?: string };
      list?: Array<{ id?: string; workspace?: string }>;
    };
  };
  let changed = false;

  const defaultsWorkspace = config.agents?.defaults?.workspace;
  if (typeof defaultsWorkspace === 'string' && defaultsWorkspace.trim()) {
    const migrated = migrateWorkspaceTildePath(defaultsWorkspace);
    if (migrated && migrated !== defaultsWorkspace) {
      config.agents!.defaults!.workspace = migrated;
      changed = true;
    }
  }

  const list = config.agents?.list;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (!entry || typeof entry.workspace !== 'string' || !entry.workspace.trim()) continue;
      const migrated = migrateWorkspaceTildePath(entry.workspace);
      if (migrated && migrated !== entry.workspace) {
        entry.workspace = migrated;
        changed = true;
      }
    }
  }

  if (changed) {
    await writeOpenClawConfig(config);
    logger.info('[workspace-migration] updated openclaw.json workspace paths');
  }

  return changed;
}

/** Migrate config paths and on-disk folders only when legacy layout is still present. */
export async function ensureWorkspaceLayoutMigrated(): Promise<void> {
  const configChanged = await migrateLegacyWorkspaceConfig();
  const config = await readOpenClawConfig() as {
    agents?: { list?: Array<{ id?: string }> };
  };

  const agentIds = (config.agents?.list ?? [])
    .map((entry) => entry?.id?.trim().toLowerCase())
    .filter((id): id is string => Boolean(id));

  await migrateLegacyWorkspaceDirectories(agentIds);

  if (!configChanged) {
    logger.debug('[workspace-migration] no workspace config migration needed');
  }
}
