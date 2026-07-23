import { randomUUID } from 'node:crypto';
import { getAdapter } from '../engines/manager';
import { rememberSessionEngineType } from '../engines/session-engine';
import { getEngineSessionRegistryEntry } from '../engines/session-registry';
import type { AgentEngineType } from '../engines/types';
import type { GatewayManager } from '../gateway/manager';
import { DEFAULT_WORKSPACE_ID } from '../db/models/domain/session-catalog';
import {
  ensureCatalogSessionInDefaultWorkspace,
  getLatestChannelCatalogSession,
  upsertCatalogSession,
} from '../services/session-catalog-service';
import { getCatalogSessionRepository } from '../db/repositories/catalog-session-repository';
import { getChannelConnection } from './binding-service';
import {
  resolveChannelBaseAgentId,
  resolveChannelIdleTtlMs,
  resolveChannelSessionKey,
  shouldForceNewDingTalkSessionForEngine,
} from './session-lifecycle';
import { parseChannelSessionKey, type PlatformChannelType } from './session-key';
import { logger } from '../utils/logger';
import { getSetting } from '../utils/store';

export interface SessionFacadeCreateParams {
  agentId: string;
  channelType: PlatformChannelType;
  accountId?: string;
  peerId: string;
  engineType?: AgentEngineType;
  forceNew?: boolean;
  /** App 续聊：有值则优先复用；无效则策略 B 静默新建 */
  sessionKey?: string | null;
}

export interface SessionFacadeHandle {
  sessionKey: string;
  engineType: AgentEngineType;
  agentId: string;
  /** 是否因无效 sessionKey 被忽略并新建 */
  sessionKeyIgnored?: boolean;
}

async function findUsableSessionKey(input: {
  sessionKey: string;
  channelType: PlatformChannelType;
  agentId: string;
}): Promise<string | null> {
  const parsed = parseChannelSessionKey(input.sessionKey);
  if (!parsed || parsed.channelType !== input.channelType) return null;
  if (parsed.agentId !== input.agentId) return null;
  const row = await getCatalogSessionRepository().findBySessionKey(input.sessionKey);
  if (!row || row.deletedAt) return null;
  if ((row.channelType || '').toLowerCase() !== input.channelType) return null;
  return input.sessionKey;
}

/**
 * 双引擎 Session 桥：createOrGet → getAdapter → 页面对话同链。
 */
export async function createOrGetSession(
  params: SessionFacadeCreateParams,
): Promise<SessionFacadeHandle> {
  // Channel 会话只用 base agent，避免 sessionKey / currentAgentId 带上 proj-… 从而命中输入框项目名规则
  const agentId = resolveChannelBaseAgentId(params.agentId);
  const channelType = params.channelType;
  const engineType: AgentEngineType =
    params.engineType === 'openclaw' || params.engineType === 'claude'
      ? params.engineType
      : 'claude';
  const now = new Date();

  const requestedKey = params.sessionKey?.trim() || '';
  if (requestedKey) {
    const usable = await findUsableSessionKey({
      sessionKey: requestedKey,
      channelType,
      agentId,
    });
    if (usable) {
      await rememberSessionEngineType(usable, engineType);
      await ensureCatalogSessionInDefaultWorkspace(usable);
      await upsertCatalogSession({
        workspaceId: DEFAULT_WORKSPACE_ID,
        sessionKey: usable,
        sessionType: 'channel',
        channelType,
        channelId: params.peerId,
        lastActivityAt: now.toISOString(),
      });
      return { sessionKey: usable, engineType, agentId };
    }
    logger.info('[SessionFacade] sessionKeyIgnored, creating new', {
      channelType,
      requestedKey,
    });
  }

  const latestSession = await getLatestChannelCatalogSession({
    channelType,
    channelId: params.peerId,
    agentId,
  });
  // 改选脑（策略 C）：同 agentId 的旧 channel session 若已登记为另一引擎，强制新 key
  let forceNew = !!params.forceNew || (channelType === 'mobile' && !requestedKey);
  // mobile：无 sessionKey = 显式新建；有 peer 也不复用 latest（App 清空字段即新对话）
  if (channelType === 'mobile' && !requestedKey) {
    forceNew = true;
  }
  if (!forceNew && latestSession?.sessionKey) {
    const registered = await getEngineSessionRegistryEntry(latestSession.sessionKey);
    forceNew = shouldForceNewDingTalkSessionForEngine({
      boundEngineType: engineType,
      registeredEngineType: registered?.engineType,
    });
  }
  const [idleEnabled, idleHours] = await Promise.all([
    getSetting('channelSessionIdleEnabled'),
    getSetting('channelSessionIdleHours'),
  ]);
  const idleTtlMs = resolveChannelIdleTtlMs({
    channelType,
    idleEnabled,
    idleHours,
  });
  const sessionKey = resolveChannelSessionKey({
    channelType,
    agentId,
    peerId: params.peerId,
    latestSession: channelType === 'mobile' && !requestedKey ? null : latestSession,
    forceNew,
    now,
    idleTtlMs,
  });
  await rememberSessionEngineType(sessionKey, engineType);
  await ensureCatalogSessionInDefaultWorkspace(sessionKey);
  await upsertCatalogSession({
    workspaceId: DEFAULT_WORKSPACE_ID,
    sessionKey,
    sessionType: 'channel',
    channelType,
    channelId: params.peerId,
    lastActivityAt: now.toISOString(),
  });
  return {
    sessionKey,
    engineType,
    agentId,
    sessionKeyIgnored: !!requestedKey,
  };
}

export async function resolveChannelBinding(channelType: PlatformChannelType): Promise<{
  agentId: string;
  engineType: AgentEngineType;
}> {
  const conn = await getChannelConnection(channelType);
  if (!conn || conn.bindStatus !== 'bound') {
    throw new Error(`${channelType} hub not bound`);
  }
  return {
    agentId: resolveChannelBaseAgentId(conn.agentId),
    engineType: conn.engineType === 'openclaw' ? 'openclaw' : 'claude',
  };
}

export async function resolveDingTalkBinding(): Promise<{
  agentId: string;
  engineType: AgentEngineType;
}> {
  return resolveChannelBinding('dingtalk');
}

export async function sendViaFacade(
  gatewayManager: GatewayManager,
  handle: SessionFacadeHandle,
  text: string,
  media?: Array<{ filePath: string; mimeType: string; fileName: string }>,
): Promise<{ runId?: string }> {
  const adapter = getAdapter(handle.engineType);
  const hasMedia = !!media && media.length > 0;
  const result = hasMedia
    ? await adapter.sendMessageWithMedia(
        { gatewayManager },
        {
          sessionKey: handle.sessionKey,
          message: text,
          media,
          deliver: false,
          idempotencyKey: randomUUID(),
        },
      )
    : await adapter.sendMessage(
        { gatewayManager },
        {
          sessionKey: handle.sessionKey,
          message: text,
          deliver: false,
          idempotencyKey: randomUUID(),
        },
      );
  if (!result.success) {
    logger.warn('[SessionFacade] send failed', result.error);
    throw new Error(result.error || 'sendViaFacade failed');
  }
  return { runId: result.result?.runId };
}
