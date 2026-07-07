import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { RETIRED_PLUGIN_IDS, RETIRED_SKILL_SLUGS } from '../../shared/retired-skills';
import { setSkillsEnabled } from './skill-config';
import { getClawXConfigDir, getOpenClawConfigDir } from './paths';
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

/**
 * Best-effort directory removal with Windows lock retries.
 * Failures are logged but never thrown — config disable is the reliable fallback.
 */
async function removeDirBestEffort(dirPath: string, label: string): Promise<boolean> {
  if (!(await pathExists(dirPath))) {
    return false;
  }

  try {
    await safeRemoveDir(dirPath, { label });
    logger.info(`[retired-skills] removed ${label}: ${dirPath}`);
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
 * Disable retired skills/plugins in openclaw.json and best-effort delete local dirs.
 * Config changes run first so Agent behavior is corrected even when file deletion fails.
 */
export async function cleanupRetiredSkillsAndPlugins(
  options: CleanupRetiredSkillsOptions = {},
): Promise<void> {
  try {
    await setSkillsEnabled([...RETIRED_SKILL_SLUGS], false);
  } catch (error) {
    logger.warn('[retired-skills] failed to disable retired skills in config:', error);
  }

  try {
    const configUpdated = await removeRetiredPluginsFromOpenClawConfig();
    if (configUpdated) {
      logger.info('[retired-skills] removed retired plugins from openclaw.json');
    }
  } catch (error) {
    logger.warn('[retired-skills] failed to update openclaw.json:', error);
  }

  const openclawSkillsRoot = join(getOpenClawConfigDir(), 'skills');
  const claudeSkillsRoot = join(getClawXConfigDir(), '.claude', 'skills');
  const extensionsRoot = join(getOpenClawConfigDir(), 'extensions');

  for (const slug of RETIRED_SKILL_SLUGS) {
    await removeDirBestEffort(join(openclawSkillsRoot, slug), `skill ${slug} (openclaw)`);
    await removeDirBestEffort(join(claudeSkillsRoot, slug), `skill ${slug} (claude bridge)`);
  }

  if (options.skipPluginDirs) {
    logger.debug('[retired-skills] skipping plugin extension dirs (caller requested)');
    return;
  }

  for (const pluginId of RETIRED_PLUGIN_IDS) {
    await removeDirBestEffort(join(extensionsRoot, pluginId), `plugin ${pluginId}`);
  }
}
