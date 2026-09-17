import { randomUUID } from 'node:crypto';
import { getKyselyDatabase } from '../../db/connection';
import type {
  ChannelBindStatus,
  ChannelEngineType,
  ChannelType,
} from '../../db/models/tables/channel-connection-table';
import { loadOrCreateDeviceIdentity } from '../../utils/device-identity';
import { app } from 'electron';
import path from 'node:path';
import { resolveSclawHubBaseUrl } from './hub-config';

/**
 * App 本地通道在 DB `channel_connections.channel_type` 存 `sto-mobile`（设计 CHECK），
 * 运行时 / Hub / sessionKey 仍用逻辑名 `mobile`。
 */
export const MOBILE_DB_CHANNEL_TYPE = 'sto-mobile';
export const MOBILE_LOGICAL_CHANNEL_TYPE = 'mobile';

function toDbChannelType(channelType: ChannelType): ChannelType {
  return channelType === MOBILE_LOGICAL_CHANNEL_TYPE ? MOBILE_DB_CHANNEL_TYPE : channelType;
}

function toLogicalChannelType(channelType: string): ChannelType {
  return channelType === MOBILE_DB_CHANNEL_TYPE ? MOBILE_LOGICAL_CHANNEL_TYPE : channelType;
}

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
    channelType: toLogicalChannelType(String(row.channel_type)),
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
  const dbType = toDbChannelType(channelType);
  let row = await db
    .selectFrom('channel_connections')
    .selectAll()
    .where('channel_type', '=', dbType)
    .where('account_id', '=', accountId)
    .executeTakeFirst();
  // 兼容迁移前误写入的 `mobile`
  if (!row && channelType === MOBILE_LOGICAL_CHANNEL_TYPE) {
    row = await db
      .selectFrom('channel_connections')
      .selectAll()
      .where('channel_type', '=', MOBILE_LOGICAL_CHANNEL_TYPE)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
  }
  return row ? mapRow(row as unknown as Record<string, unknown>) : null;
}

/**
 * Single-slot channels (e.g. WeChat) store a real provider accountId, not `default`.
 * Look up by channel_type only: prefer bound, then newest updated_at.
 * WeChat-only today — mobile uses `getChannelConnection('mobile')` instead.
 */
export async function findChannelConnectionByType(
  channelType: ChannelType,
): Promise<ChannelConnection | null> {
  const db = getKyselyDatabase();
  const dbType = toDbChannelType(channelType);
  const rows = await db
    .selectFrom('channel_connections')
    .selectAll()
    .where('channel_type', '=', dbType)
    .execute();
  if (rows.length === 0) return null;

  const mapped = rows.map((row) => mapRow(row as unknown as Record<string, unknown>));
  mapped.sort((left, right) => {
    const boundRank = (row: ChannelConnection) => (row.bindStatus === 'bound' ? 0 : 1);
    const byBound = boundRank(left) - boundRank(right);
    if (byBound !== 0) return byBound;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  return mapped[0] ?? null;
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
  return touchSharedHubOnline();
}

/** App / 钉钉共用一条 Desktop Hub WS 心跳：续期所有已 bound 本地行的 last_online */
export async function touchSharedHubOnline(): Promise<void> {
  const db = getKyselyDatabase();
  const now = nowIso();
  for (const channelType of ['dingtalk', 'mobile'] as const) {
    const existing = await getChannelConnection(channelType);
    if (!existing || existing.bindStatus !== 'bound') continue;
    await db
      .updateTable('channel_connections')
      .set({
        last_online_at: now,
        updated_at: now,
      })
      .where('id', '=', existing.id)
      .execute();
  }
}

/**
 * 解析共用 Hub 凭证：仅「仍有效绑定」行上的 refreshToken。
 * mobile：bound + enabled + token；dingtalk：bound + token。
 * 不含 revoked/disabled 行残留 token（避免误连）。
 */
export async function resolveSharedHubRefreshToken(): Promise<string | null> {
  const mobile = await getChannelConnection('mobile');
  if (mobile?.bindStatus === 'bound' && mobile.enabled && mobile.refreshToken) {
    return mobile.refreshToken;
  }
  const dingTalk = await getChannelConnection('dingtalk');
  if (dingTalk?.bindStatus === 'bound' && dingTalk.refreshToken) {
    return dingTalk.refreshToken;
  }
  return null;
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

/**
 * 打开「App 绑定」：本机 mobile 行 bound，并可写入 Hub 下发的 refreshToken（与钉钉共用一条设备绑定）。
 */
export async function enableMobileAppBind(input?: {
  refreshToken?: string | null;
}): Promise<ChannelConnection> {
  const db = getKyselyDatabase();
  const now = nowIso();
  const deviceId = await getLocalDeviceId();
  const existing = await getChannelConnection('mobile');
  const refreshToken = input?.refreshToken === undefined
    ? existing?.refreshToken ?? null
    : input.refreshToken;

  if (!existing) {
    const id = randomUUID();
    await db
      .insertInto('channel_connections')
      .values({
        id,
        channel_type: MOBILE_DB_CHANNEL_TYPE,
        account_id: 'default',
        enabled: 1,
        device_id: deviceId,
        external_user_id: null,
        provider_account_id: null,
        bind_status: 'bound',
        bound_at: now,
        last_online_at: now,
        refresh_token: refreshToken,
        credential_token: null,
        endpoint_base_url: resolveSclawHubBaseUrl() || null,
        engine_type: 'claude',
        agent_id: 'main',
        extras_json: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    const created = await getChannelConnection('mobile');
    if (!created) throw new Error('Failed to create mobile channel connection');
    return created;
  }

  await db
    .updateTable('channel_connections')
    .set({
      device_id: deviceId,
      enabled: 1,
      bind_status: 'bound',
      bound_at: existing.bindStatus === 'bound' ? existing.boundAt : now,
      last_online_at: now,
      updated_at: now,
      engine_type: existing.engineType ?? 'claude',
      agent_id: existing.agentId ?? 'main',
      ...(input?.refreshToken !== undefined
        ? {
            refresh_token: refreshToken,
            endpoint_base_url: resolveSclawHubBaseUrl() || existing.endpointBaseUrl,
          }
        : {}),
    })
    .where('id', '=', existing.id)
    .execute();

  const updated = await getChannelConnection('mobile');
  if (!updated) throw new Error('Failed to enable mobile channel connection');
  return updated;
}

/** 将 Hub refreshToken 同步到钉钉/移动端本地行（共用一条设备凭证） */
export async function syncSharedHubRefreshToken(input: {
  refreshToken: string;
  endpointBaseUrl?: string | null;
  dingUserId?: string | null;
}): Promise<void> {
  const db = getKyselyDatabase();
  const now = nowIso();
  const dingTalk = await getChannelConnection('dingtalk');
  if (dingTalk) {
    await db
      .updateTable('channel_connections')
      .set({
        refresh_token: input.refreshToken,
        ...(input.dingUserId
          ? { external_user_id: input.dingUserId }
          : {}),
        ...(input.endpointBaseUrl !== undefined
          ? { endpoint_base_url: input.endpointBaseUrl }
          : {}),
        updated_at: now,
        last_online_at: now,
      })
      .where('id', '=', dingTalk.id)
      .execute();
  }
  const mobile = await getChannelConnection('mobile');
  if (mobile) {
    await db
      .updateTable('channel_connections')
      .set({
        refresh_token: input.refreshToken,
        ...(input.endpointBaseUrl !== undefined
          ? { endpoint_base_url: input.endpointBaseUrl }
          : {}),
        updated_at: now,
        last_online_at: now,
      })
      .where('id', '=', mobile.id)
      .execute();
  }
}

/** 关闭「App 绑定」：revoked mobile 行；不改 dingtalk。 */
export async function disableMobileAppBind(): Promise<void> {
  const existing = await getChannelConnection('mobile');
  if (!existing) return;
  const db = getKyselyDatabase();
  await db
    .updateTable('channel_connections')
    .set({
      bind_status: 'revoked',
      enabled: 0,
      updated_at: nowIso(),
    })
    .where('id', '=', existing.id)
    .execute();
}

export async function updateMobileBindingAgent(input: {
  engineType: ChannelEngineType;
  agentId: string;
}): Promise<ChannelConnection> {
  const existing = await getChannelConnection('mobile');
  if (!existing || existing.bindStatus !== 'bound') {
    throw new Error('Mobile channel not bound');
  }
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
  const updated = await getChannelConnection('mobile');
  if (!updated) throw new Error('Failed to update mobile agent binding');
  return updated;
}
