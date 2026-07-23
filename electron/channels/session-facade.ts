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
import { getChannelConnection } from './binding-service';
import {
  resolveChannelBaseAgentId,
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
  // Channel 会话只用 base agent，避免 sessionKey / currentAgentId 带上 proj-… 从而命中输入框项目名规则
  const agentId = resolveChannelBaseAgentId(params.agentId);
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
  // Channel 会话固定挂 default（进「最近」），不继承侧栏项目 workspace，
  // 否则会命中输入框 sessionWorkspaceByKey → 「Main Agent · 测试2」。
  await ensureCatalogSessionInDefaultWorkspace(sessionKey);
  await upsertCatalogSession({
    workspaceId: DEFAULT_WORKSPACE_ID,
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
    agentId: resolveChannelBaseAgentId(conn.agentId),
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
