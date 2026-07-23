import { randomUUID } from 'node:crypto';
import { getAdapter } from '../engines/manager';
import { rememberSessionEngineType } from '../engines/session-engine';
import { getEngineSessionRegistryEntry } from '../engines/session-registry';
import type { AgentEngineType } from '../engines/types';
import type { GatewayManager } from '../gateway/manager';
import {
  getLatestChannelCatalogSession,
  getSessionWorkspaceId,
  upsertCatalogSession,
} from '../services/session-catalog-service';
import { getChannelConnection } from './binding-service';
import {
  resolveDingTalkSessionKey,
  shouldForceNewDingTalkSessionForEngine,
} from './session-lifecycle';
import { logger } from '../utils/logger';

export interface SessionFacadeCreateParams {
  agentId: string;
  channelType: 'dingtalk';
  accountId?: string;
  peerId: string;
  engineType?: AgentEngineType;
  forceNew?: boolean;
}

export interface SessionFacadeHandle {
  sessionKey: string;
  engineType: AgentEngineType;
  agentId: string;
}

/**
 * 双引擎 Session 桥：createOrGet → getAdapter → 页面对话同链。
 */
export async function createOrGetSession(
  params: SessionFacadeCreateParams,
): Promise<SessionFacadeHandle> {
  const agentId = (params.agentId || 'main').trim() || 'main';
  const engineType: AgentEngineType =
    params.engineType === 'openclaw' || params.engineType === 'claude'
      ? params.engineType
      : 'claude';
  const now = new Date();
  const latestSession = await getLatestChannelCatalogSession({
    channelType: params.channelType,
    channelId: params.peerId,
    agentId,
  });
  // 改选脑（策略 C）：同 agentId 的旧 channel session 若已登记为另一引擎，强制新 key，
  // 避免 rememberSessionEngineType 覆盖旧 key 导致 PC「当前会话」看不到原引擎历史。
  let forceNew = !!params.forceNew;
  if (!forceNew && latestSession?.sessionKey) {
    const registered = await getEngineSessionRegistryEntry(latestSession.sessionKey);
    forceNew = shouldForceNewDingTalkSessionForEngine({
      boundEngineType: engineType,
      registeredEngineType: registered?.engineType,
    });
  }
  const sessionKey = resolveDingTalkSessionKey({
    agentId,
    peerId: params.peerId,
    latestSession,
    forceNew,
    now,
  });
  await rememberSessionEngineType(sessionKey, engineType);
  // 同一频道换新会话时继承原 workspace；首次创建才回落 default。
  const workspaceId = latestSession?.workspaceId
    ?? await getSessionWorkspaceId(sessionKey);
  await upsertCatalogSession({
    workspaceId,
    sessionKey,
    sessionType: 'channel',
    channelType: params.channelType,
    channelId: params.peerId,
    lastActivityAt: now.toISOString(),
  });
  return { sessionKey, engineType, agentId };
}

export async function resolveDingTalkBinding(): Promise<{
  agentId: string;
  engineType: AgentEngineType;
}> {
  const conn = await getChannelConnection('dingtalk');
  if (!conn || conn.bindStatus !== 'bound') {
    throw new Error('DingTalk hub not bound');
  }
  return {
    agentId: conn.agentId || 'main',
    engineType: conn.engineType === 'openclaw' ? 'openclaw' : 'claude',
  };
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
