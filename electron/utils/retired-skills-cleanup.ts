import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { RETIRED_PLUGIN_IDS, RETIRED_SKILL_SLUGS } from '../../shared/retired-skills';
import { getOpenClawConfigDir } from './paths';
import { logger } from './logger';
import { removeRetiredPluginsFromOpenClawConfig } from './openclaw-auth';
import { safeRemoveDir } from './fs-retry';

export type CleanupRetiredSkillsOptions = {
  /**
   * Skip deleting plugin extension directories. Use when Gateway may already
   * hold file locks (e.g. deferred post-paint cleanup on Windows).
   */
  skipPluginDirs?: boolean;
};

async function pathExists(dirPath: string): Promise<boolean> {
  try {
    await access(dirPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function removeDirBestEffort(dirPath: string, label: string): Promise<boolean> {
  if (!(await pathExists(dirPath))) {
    return false;
  }

  try {
    await safeRemoveDir(dirPath, { label });
    return true;
  } catch (error) {
    logger.warn(
      `[retired-skills] could not remove ${label} (${dirPath}); ` +
      'config/prompt guards still apply. On Windows, close apps locking the folder and restart.',
      error,
    );
    return false;
  }
}

/**
 * Disable retired skills/plugins and best-effort delete local dirs via SkillManager + adapters.
 */
export async function cleanupRetiredSkillsAndPlugins(
  options: CleanupRetiredSkillsOptions = {},
): Promise<void> {
  try {
    const { getSkillManager } = await import('../services/skills/skill-manager');
    const manager = getSkillManager();
    for (const slug of RETIRED_SKILL_SLUGS) {
      await manager.setEnabled(slug, false).catch((error) => {
        logger.warn(`[retired-skills] failed to disable ${slug}:`, error);
      });
      await manager.uninstall({ slug }).catch((error) => {
        logger.warn(`[retired-skills] failed to uninstall ${slug}:`, error);
      });
    }
  } catch (error) {
    logger.warn('[retired-skills] SkillManager cleanup failed:', error);
  }

  try {
    await removeRetiredPluginsFromOpenClawConfig();
  } catch (error) {
    logger.warn('[retired-skills] failed to update openclaw.json:', error);
  }

  // Best-effort leftover sweep for any pre-adapter copies.
  const openclawSkillsRoot = join(getOpenClawConfigDir(), 'skills');
  const extensionsRoot = join(getOpenClawConfigDir(), 'extensions');

  for (const slug of RETIRED_SKILL_SLUGS) {
    await removeDirBestEffort(join(openclawSkillsRoot, slug), `skill ${slug} (openclaw)`);
  }

  if (options.skipPluginDirs) {
    return;
  }

  for (const pluginId of RETIRED_PLUGIN_IDS) {
    await removeDirBestEffort(join(extensionsRoot, pluginId), `plugin ${pluginId}`);
  }
}
