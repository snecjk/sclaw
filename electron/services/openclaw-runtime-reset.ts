/**
 * Gateway startup reset for legacy STO / openclaw.json residue.
 *
 * Runs before Gateway reads openclaw.json. Old uninstallers may leave a bad
 * openclaw.json behind; this module scrubs surgically first, then removes the
 * file when model routing is still unsafe. Regeneration happens via
 * syncGatewayConfigBeforeLaunch + login-time sto-model-sync.
 */

import { unlink } from 'fs/promises';
import { join } from 'path';
import { getOpenClawConfigDir } from '../utils/paths';
import { syncStoPluginsToOpenClaw } from '../utils/openclaw-auth';
import { logger } from '../utils/logger';
import { getAuthState, getStoToken } from '../utils/auth-store';
import { getStoModelSyncService } from './providers/sto-model-sync';
import {
  detectStoCatalogLegacyState,
  getStoCatalogMigrationVersion,
  isOpenClawStoModelRuntimeReady,
  preMigrateStoCatalogPlaceholders,
  STO_CATALOG_MIGRATION_VERSION,
  type StoCatalogLegacyState,
} from './providers/sto-catalog-migration';

export type OpenClawRuntimeResetResult = {
  skipped: boolean;
  preMigrateRan: boolean;
  nuclearReset: boolean;
  reasons: string[];
};

const OPENCLAW_CONFIG_FILE = 'openclaw.json';
const MAIN_AGENT_MODELS_FILE = join('agents', 'main', 'agent', 'models.json');

function isLegacyDefaultModel(model: string | undefined): boolean {
  if (!model?.trim()) return false;
  const normalized = model.trim().toLowerCase();
  if (normalized.startsWith('custom-sto/') || normalized === 'custom-sto') return true;
  if (normalized.includes('sto-model-')) return true;
  const provider = normalized.split('/')[0];
  return provider === 'custom-sto';
}

/** True when a full openclaw.json delete is safer than leaving partial state. */
export function shouldNuclearResetOpenClawConfig(
  legacy: StoCatalogLegacyState,
  defaultModel?: string,
): boolean {
  if (isLegacyDefaultModel(defaultModel)) return true;

  for (const reason of legacy.reasons) {
    if (reason.startsWith('openclaw-key:')) return true;
    if (reason === 'openclaw-sto-models-incomplete') return true;
  }
  return false;
}

async function unlinkIfExists(filePath: string): Promise<boolean> {
  try {
    await unlink(filePath);
    return true;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

async function deleteOpenClawRuntimeConfigFiles(): Promise<void> {
  const configDir = getOpenClawConfigDir();
  await unlinkIfExists(join(configDir, OPENCLAW_CONFIG_FILE));
  await unlinkIfExists(join(configDir, MAIN_AGENT_MODELS_FILE));
}

/**
 * One-time / on-demand openclaw runtime reset before Gateway launch.
 * Migration completion is still marked by sto-model-sync after a successful catalog pull.
 */
export async function runOpenClawRuntimeResetIfNeeded(): Promise<OpenClawRuntimeResetResult> {
  const legacy = await detectStoCatalogLegacyState();
  const migrationVersion = await getStoCatalogMigrationVersion();

  if (!legacy.needsMigration && migrationVersion >= STO_CATALOG_MIGRATION_VERSION) {
    return { skipped: true, preMigrateRan: false, nuclearReset: false, reasons: [] };
  }

  logger.info(
    `[openclaw-reset] Legacy openclaw runtime detected (migration=${migrationVersion}/${STO_CATALOG_MIGRATION_VERSION}): ${legacy.reasons.join(', ')}`,
  );

  await preMigrateStoCatalogPlaceholders();
  const afterPreMigrate = await detectStoCatalogLegacyState();
  const { getOpenClawProvidersConfig } = await import('../utils/openclaw-auth');
  const { defaultModel } = await getOpenClawProvidersConfig();
  const nuclearReset = shouldNuclearResetOpenClawConfig(afterPreMigrate, defaultModel);

  if (nuclearReset) {
    await deleteOpenClawRuntimeConfigFiles();
    logger.info('[openclaw-reset] Removed openclaw.json and agents/main/agent/models.json for clean regeneration');
  } else {
    logger.info('[openclaw-reset] Surgical scrub only; keeping openclaw.json (channels/plugins preserved)');
  }

  return {
    skipped: false,
    preMigrateRan: true,
    nuclearReset,
    reasons: legacy.reasons,
  };
}

/**
 * After auth setup, ensure openclaw.json has STO providers + default model.
 * Provider store can be ready while openclaw.json is still minimal after a reset.
 */
export async function ensureOpenClawRuntimeModelsAfterAuthSetup(): Promise<void> {
  const [authState, token] = await Promise.all([getAuthState(), getStoToken()]);
  if (!authState.isAuthenticated || !token) return;

  if (await isOpenClawStoModelRuntimeReady()) return;

  logger.warn('[openclaw-reset] openclaw.json missing STO model runtime; forcing plugin + catalog repair');

  const stoSync = getStoModelSyncService();
  const result = await stoSync.syncModels({ deferGatewayRefresh: true });
  if (result.error) {
    logger.warn(`[openclaw-reset] Forced STO model sync failed: ${result.error}`);
    return;
  }

  try {
    await syncStoPluginsToOpenClaw();
  } catch (err) {
    logger.warn('[openclaw-reset] syncStoPluginsToOpenClaw repair failed:', err);
  }

  if (!(await isOpenClawStoModelRuntimeReady())) {
    logger.warn('[openclaw-reset] STO model runtime still incomplete after forced sync');
  }
}
