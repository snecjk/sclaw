/**
 * One-shot destructive channel rebind epoch.
 * Runs at ensureChannelRuntimesReady start; idempotent via AppSettings.channelBindEpoch.
 */

import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getCatalogSessionRepository } from '../../db/repositories/catalog-session-repository';
import { getKyselyDatabase } from '../../db/connection';
import { getSetting, setSetting } from '../../utils/store';
import { logger } from '../../utils/logger';
import {
  resolveLegacyOpenClawWeixinStateDir,
  resolveWeixinStateDir,
} from '../weixin/runtime/transport/state-dir';

/** Bump only on the next destructive upgrade window. */
export const CHANNEL_BIND_EPOCH = '2026.09-host-weixin';

const EPOCH_CHANNEL_TYPES = ['dingtalk', 'wechat', 'sto-mobile', 'mobile'] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function resolveLegacyWeixinSyncDir(): string {
  return path.join(
    os.homedir(),
    '.stoclaw',
    'openclaw',
    'agents',
    'default',
    'sessions',
    '.openclaw-weixin-sync',
  );
}

function removeDirBestEffort(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('[ChannelEpoch] failed to remove directory', { dir, error: String(error) });
  }
}

export function resolveChannelEpochCredentialDirs(): string[] {
  return [
    resolveWeixinStateDir(),
    resolveLegacyOpenClawWeixinStateDir(),
    resolveLegacyWeixinSyncDir(),
  ];
}

async function revokeAllChannelConnectionRows(): Promise<number> {
  const db = getKyselyDatabase();
  const result = await db
    .updateTable('channel_connections')
    .set({
      bind_status: 'revoked',
      enabled: 0,
      refresh_token: null,
      credential_token: null,
      updated_at: nowIso(),
    })
    .where('channel_type', 'in', [...EPOCH_CHANNEL_TYPES])
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0n);
}

async function stopChannelRuntimesBestEffort(): Promise<void> {
  try {
    const { getWeixinChannelService } = await import('../weixin/service');
    await getWeixinChannelService().shutdown();
  } catch (error) {
    logger.warn('[ChannelEpoch] weixin shutdown failed', error);
  }
  try {
    const { getSclawHubClient } = await import('../hub/hub-client');
    getSclawHubClient().disconnectPermanently();
  } catch (error) {
    logger.warn('[ChannelEpoch] hub disconnect failed', error);
  }
}

/**
 * If persisted epoch ≠ CHANNEL_BIND_EPOCH, wipe channel credentials / bindings / channel catalog.
 * Always writes the epoch even when cleanup partially fails (avoids reset loops).
 */
export async function maybeResetChannelRuntimeEpoch(): Promise<{
  reset: boolean;
  previousEpoch: string | null;
}> {
  const previousEpoch = (await getSetting('channelBindEpoch')) ?? null;
  if (previousEpoch === CHANNEL_BIND_EPOCH) {
    return { reset: false, previousEpoch };
  }

  logger.info('[ChannelEpoch] resetting channel runtime', {
    from: previousEpoch,
    to: CHANNEL_BIND_EPOCH,
  });

  try {
    await stopChannelRuntimesBestEffort();
  } catch (error) {
    logger.warn('[ChannelEpoch] stop runtimes failed', error);
  }

  for (const dir of resolveChannelEpochCredentialDirs()) {
    removeDirBestEffort(dir);
  }

  try {
    const revoked = await revokeAllChannelConnectionRows();
    logger.info('[ChannelEpoch] revoked channel_connections', { revoked });
  } catch (error) {
    logger.warn('[ChannelEpoch] revoke channel_connections failed', error);
  }

  try {
    const deleted = await getCatalogSessionRepository().softDeleteBySessionType(
      'channel',
      'channel-bind-epoch',
    );
    logger.info('[ChannelEpoch] soft-deleted channel catalog sessions', { deleted });
  } catch (error) {
    logger.warn('[ChannelEpoch] soft-delete channel catalog failed', error);
  }

  try {
    await setSetting('channelBindEpoch', CHANNEL_BIND_EPOCH);
  } catch (error) {
    logger.warn('[ChannelEpoch] failed to persist channelBindEpoch', error);
  }

  return { reset: true, previousEpoch };
}
