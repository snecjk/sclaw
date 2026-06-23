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
import { getOpenClawProvidersConfig } from '../utils/openclaw-auth';
import { logger } from '../utils/logger';
import {
  detectStoCatalogLegacyState,
  getStoCatalogMigrationVersion,
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
    if (reason.startsWith('stale-account:')) return true;
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
