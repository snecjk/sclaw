/**
 * Single-Bot Weixin binding (channel_connections + local credential presence).
 */

import { randomUUID } from 'node:crypto';
import { getKyselyDatabase } from '../../db/connection';
import { parseAgentEngineType } from '../../../shared/agent-engine';
import type { ChannelConnection } from '../hub/binding-service';
import { findChannelConnectionByType, getLocalDeviceId } from '../hub/binding-service';
import type { ChannelRuntimeEngine } from '../common/session-lifecycle';
import {
  listIndexedAccountIds,
  loadAccount,
  resolvePrimaryAccount,
} from './runtime/transport/account-store';
import { migrateLegacyCredentials } from './runtime/transport/migrate-credentials';
import { resolveWeixinStateDir } from './runtime/transport/state-dir';

export type { ChannelRuntimeEngine };

const DEFAULT_WEIXIN_ENGINE: ChannelRuntimeEngine = 'pi';

export type WeixinBinding = {
  channelType: 'wechat';
  accountId: string;
  agentId: string;
  engineType: ChannelRuntimeEngine;
  enabled: boolean;
};

export function normalizeWeixinEngineType(value: unknown): ChannelRuntimeEngine {
  const parsed = parseAgentEngineType(value);
  if (parsed === 'claude' || parsed === 'pi') return parsed;
  return DEFAULT_WEIXIN_ENGINE;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** WeChat stores the real bot accountId (not `default`); look up the single slot by type. */
async function getWeixinConnectionRow(): Promise<ChannelConnection | null> {
  return findChannelConnectionByType('wechat');
}

export function ensureWeixinCredentialsMigrated(): void {
  // Permanent no-op: migrateLegacyCredentials no longer copies legacy OpenClaw creds.
  migrateLegacyCredentials({ overwrite: false });
}

/** True when a WeChat bot credential already exists (single-Bot hard constraint). */
export function hasWeixinBotBound(): boolean {
  ensureWeixinCredentialsMigrated();
  return resolvePrimaryAccount() != null;
}

export function getBoundWeixinAccountId(): string | null {
  ensureWeixinCredentialsMigrated();
  return resolvePrimaryAccount()?.accountId ?? null;
}

export async function getWeixinBinding(): Promise<WeixinBinding | null> {
  const conn = await getWeixinConnectionRow();
  if (conn && conn.bindStatus !== 'bound') {
    return null;
  }
  if (!conn) {
    // First-bind window only: QR wrote credential files before the DB row landed.
    // Epoch reset deletes both files and DB → this branch does not resurrect after reset.
    // Do not reintroduce legacy OpenClaw credential migration here.
    const primary = resolvePrimaryAccount();
    if (!primary) return null;
    return {
      channelType: 'wechat',
      accountId: primary.accountId,
      agentId: 'main',
      engineType: DEFAULT_WEIXIN_ENGINE,
      enabled: true,
    };
  }
  return {
    channelType: 'wechat',
    accountId: conn.accountId,
    agentId: 'main',
    engineType: DEFAULT_WEIXIN_ENGINE,
    enabled: conn.enabled,
  };
}

/**
 * Upsert the single WeChat bot binding.
 * Re-scan / reconnect replaces the existing slot (WeChat may issue a new accountId).
 */
export async function upsertWeixinBinding(input: {
  accountId: string;
  agentId?: string;
  engineType?: ChannelRuntimeEngine;
  token?: string;
  baseUrl?: string;
  userId?: string;
}): Promise<WeixinBinding> {
  ensureWeixinCredentialsMigrated();
  const accountId = input.accountId.trim();
  if (!accountId) throw new Error('accountId is required');

  const { clearAccountFiles, saveAccount } = await import('./runtime/transport/account-store');

  // Single-Bot slot: drop any other local credential files before saving the new one.
  for (const id of listIndexedAccountIds()) {
    if (id !== accountId && loadAccount(id)?.token) {
      clearAccountFiles(id);
    }
  }
  // Also clear previous primary if accountId changed but old files linger outside index.
  const previousPrimary = resolvePrimaryAccount();
  if (previousPrimary && previousPrimary.accountId !== accountId) {
    clearAccountFiles(previousPrimary.accountId);
  }

  if (input.token?.trim()) {
    saveAccount(accountId, {
      token: input.token.trim(),
      baseUrl: input.baseUrl,
      userId: input.userId,
    });
  }

  const db = getKyselyDatabase();
  const now = nowIso();
  const deviceId = await getLocalDeviceId();
  const existing = await getWeixinConnectionRow();
  const agentId = 'main';
  const engineType = DEFAULT_WEIXIN_ENGINE;

  if (!existing) {
    await db
      .insertInto('channel_connections')
      .values({
        id: randomUUID(),
        channel_type: 'wechat',
        account_id: accountId,
        enabled: 1,
        device_id: deviceId,
        external_user_id: input.userId ?? null,
        provider_account_id: accountId,
        bind_status: 'bound',
        bound_at: now,
        last_online_at: null,
        refresh_token: null,
        credential_token: input.token?.trim() ?? null,
        endpoint_base_url: input.baseUrl ?? null,
        engine_type: engineType,
        agent_id: agentId,
        extras_json: JSON.stringify({ stateDir: resolveWeixinStateDir() }),
        created_at: now,
        updated_at: now,
      })
      .execute();
  } else {
    // Replace-in-place: same machine re-scan may get a new WeChat bot accountId.
    await db
      .updateTable('channel_connections')
      .set({
        account_id: accountId,
        device_id: deviceId,
        external_user_id: input.userId ?? existing.externalUserId,
        provider_account_id: accountId,
        bind_status: 'bound',
        bound_at: now,
        credential_token: input.token?.trim() ?? existing.credentialToken,
        endpoint_base_url: input.baseUrl ?? existing.endpointBaseUrl,
        engine_type: engineType,
        agent_id: agentId,
        enabled: 1,
        updated_at: now,
      })
      .where('id', '=', existing.id)
      .execute();
  }

  const binding = await getWeixinBinding();
  if (!binding) throw new Error('Failed to upsert WeChat binding');
  return binding;
}

export async function updateWeixinBindingAgent(_input: {
  engineType: string;
  agentId: string;
}): Promise<WeixinBinding> {
  const engineType = DEFAULT_WEIXIN_ENGINE;
  const agentId = 'main';
  const existing = await getWeixinConnectionRow();
  if (!existing || existing.bindStatus !== 'bound') {
    const accountId = getBoundWeixinAccountId();
    if (!accountId) throw new Error('WeChat channel not bound');
    return upsertWeixinBinding({ accountId, agentId, engineType });
  }

  const db = getKyselyDatabase();
  await db
    .updateTable('channel_connections')
    .set({
      engine_type: engineType,
      agent_id: agentId,
      updated_at: nowIso(),
    })
    .where('id', '=', existing.id)
    .execute();

  const binding = await getWeixinBinding();
  if (!binding) throw new Error('Failed to update WeChat agent binding');
  return binding;
}

export async function unbindWeixinBot(): Promise<void> {
  const existing = await getWeixinConnectionRow();
  const accountId = existing?.accountId || getBoundWeixinAccountId();
  if (existing) {
    const db = getKyselyDatabase();
    await db
      .updateTable('channel_connections')
      .set({
        bind_status: 'revoked',
        credential_token: null,
        enabled: 0,
        updated_at: nowIso(),
      })
      .where('id', '=', existing.id)
      .execute();
  }
  if (accountId) {
    const { clearAccountFiles } = await import('./runtime/transport/account-store');
    clearAccountFiles(accountId);
  }
}

export async function getWeixinChannelConnection(): Promise<ChannelConnection | null> {
  return getWeixinConnectionRow();
}
