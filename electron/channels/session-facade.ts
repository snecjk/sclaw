import { randomUUID } from 'node:crypto';
import { getAdapter } from '../engines/manager';
import { rememberSessionEngineType } from '../engines/session-engine';
import type { AgentEngineType } from '../engines/types';
import type { GatewayManager } from '../gateway/manager';
import { getChannelConnection } from './binding-service';
import { buildDingTalkSessionKey } from './session-key';
import { logger } from '../utils/logger';

export interface SessionFacadeCreateParams {
  agentId: string;
  channelType: 'dingtalk';
  accountId?: string;
  peerId: string;
  engineType?: AgentEngineType;
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
  const sessionKey = buildDingTalkSessionKey(agentId, params.peerId);
  await rememberSessionEngineType(sessionKey, engineType);
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
