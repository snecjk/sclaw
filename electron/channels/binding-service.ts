import { randomUUID } from 'node:crypto';
import { getKyselyDatabase } from '../db/connection';
import type {
  ChannelBindStatus,
  ChannelEngineType,
  ChannelType,
} from '../db/models/tables/channel-connection-table';
import { loadOrCreateDeviceIdentity } from '../utils/device-identity';
import { app } from 'electron';
import path from 'node:path';

export interface ChannelConnection {
  id: string;
  channelType: ChannelType;
  accountId: string;
  enabled: boolean;
  deviceId: string;
  externalUserId: string | null;
  providerAccountId: string | null;
  bindStatus: ChannelBindStatus;
  boundAt: string | null;
  lastOnlineAt: string | null;
  refreshToken: string | null;
  credentialToken: string | null;
  endpointBaseUrl: string | null;
  engineType: ChannelEngineType | null;
  agentId: string | null;
  extras: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: Record<string, unknown>): ChannelConnection {
  return {
    id: String(row.id),
    channelType: String(row.channel_type) as ChannelType,
    accountId: String(row.account_id),
    enabled: Number(row.enabled) === 1,
    deviceId: String(row.device_id),
    externalUserId: row.external_user_id == null ? null : String(row.external_user_id),
    providerAccountId: row.provider_account_id == null ? null : String(row.provider_account_id),
    bindStatus: String(row.bind_status) as ChannelBindStatus,
    boundAt: row.bound_at == null ? null : String(row.bound_at),
    lastOnlineAt: row.last_online_at == null ? null : String(row.last_online_at),
    refreshToken: row.refresh_token == null ? null : String(row.refresh_token),
    credentialToken: row.credential_token == null ? null : String(row.credential_token),
    endpointBaseUrl: row.endpoint_base_url == null ? null : String(row.endpoint_base_url),
    engineType: row.engine_type == null ? null : String(row.engine_type) as ChannelEngineType,
    agentId: row.agent_id == null ? null : String(row.agent_id),
    extras: row.extras_json == null
      ? null
      : JSON.parse(String(row.extras_json)) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function getLocalDeviceId(): Promise<string> {
  const identityPath = path.join(app.getPath('userData'), 'stoclaw-device-identity.json');
  const identity = await loadOrCreateDeviceIdentity(identityPath);
  return identity.deviceId;
}

export async function getChannelConnection(
  channelType: ChannelType,
  accountId = 'default',
): Promise<ChannelConnection | null> {
  const db = getKyselyDatabase();
  const row = await db
    .selectFrom('channel_connections')
    .selectAll()
    .where('channel_type', '=', channelType)
    .where('account_id', '=', accountId)
    .executeTakeFirst();
  return row ? mapRow(row as unknown as Record<string, unknown>) : null;
}

/**
 * 后绑覆盖：只更新身份/凭证相关字段；engine/agent 仅在首次为空时写入默认值。
 */
export async function upsertDingTalkHubBind(input: {
  externalUserId: string;
  refreshToken: string;
  endpointBaseUrl?: string | null;
}): Promise<ChannelConnection> {
  const db = getKyselyDatabase();
  const now = nowIso();
  const deviceId = await getLocalDeviceId();
  const existing = await getChannelConnection('dingtalk');

  if (!existing) {
    const id = randomUUID();
    await db
      .insertInto('channel_connections')
      .values({
        id,
        channel_type: 'dingtalk',
        account_id: 'default',
        enabled: 1,
        device_id: deviceId,
        external_user_id: input.externalUserId,
        provider_account_id: null,
        bind_status: 'bound',
        bound_at: now,
        last_online_at: null,
        refresh_token: input.refreshToken,
        credential_token: null,
        endpoint_base_url: input.endpointBaseUrl ?? null,
        engine_type: 'claude',
        agent_id: 'main',
        extras_json: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    const created = await getChannelConnection('dingtalk');
    if (!created) throw new Error('Failed to create dingtalk channel connection');
    return created;
  }

  await db
    .updateTable('channel_connections')
    .set({
      device_id: deviceId,
      external_user_id: input.externalUserId,
      refresh_token: input.refreshToken,
      bind_status: 'bound',
      bound_at: now,
      endpoint_base_url: input.endpointBaseUrl ?? existing.endpointBaseUrl,
      updated_at: now,
      // 选脑不变：不改 engine_type / agent_id
    })
    .where('id', '=', existing.id)
    .execute();

  const updated = await getChannelConnection('dingtalk');
  if (!updated) throw new Error('Failed to update dingtalk channel connection');
  return updated;
}

export async function revokeDingTalkHubBind(): Promise<void> {
  const existing = await getChannelConnection('dingtalk');
  if (!existing) return;
  const db = getKyselyDatabase();
  await db
    .updateTable('channel_connections')
    .set({
      bind_status: 'revoked',
      refresh_token: null,
      updated_at: nowIso(),
    })
    .where('id', '=', existing.id)
    .execute();
}

export async function touchDingTalkOnline(): Promise<void> {
  const existing = await getChannelConnection('dingtalk');
  if (!existing || existing.bindStatus !== 'bound') return;
  const db = getKyselyDatabase();
  await db
    .updateTable('channel_connections')
    .set({
      last_online_at: nowIso(),
      updated_at: nowIso(),
    })
    .where('id', '=', existing.id)
    .execute();
}

export async function updateDingTalkBindingAgent(input: {
  engineType: ChannelEngineType;
  agentId: string;
}): Promise<ChannelConnection> {
  const existing = await getChannelConnection('dingtalk');
  if (!existing) throw new Error('DingTalk channel not bound');
  const db = getKyselyDatabase();
  await db
    .updateTable('channel_connections')
    .set({
      engine_type: input.engineType,
      agent_id: input.agentId,
      updated_at: nowIso(),
    })
    .where('id', '=', existing.id)
    .execute();
  const updated = await getChannelConnection('dingtalk');
  if (!updated) throw new Error('Failed to update agent binding');
  return updated;
}
