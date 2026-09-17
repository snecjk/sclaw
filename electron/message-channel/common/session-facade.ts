import { randomUUID } from 'node:crypto';
import { getAdapter } from '../../engines/manager';
import { rememberSessionEngineType } from '../../engines/session-engine';
import { getEngineSessionRegistryEntry } from '../../engines/session-registry';
import type { GatewayManager } from '../../gateway/manager';
import { DEFAULT_WORKSPACE_ID } from '../../db/models/domain/session-catalog';
import { runMainChatSend } from '../../services/chat-send-service';
import {
  ensureCatalogSessionInDefaultWorkspace,
  getLatestChannelCatalogSession,
  upsertCatalogSession,
} from '../../services/session-catalog-service';
import { getCatalogSessionRepository } from '../../db/repositories/catalog-session-repository';
import {
  FIXED_CHANNEL_BINDING,
  getChannelConnection,
} from '../hub/binding-service';
import {
  resolveChannelBaseAgentId,
  resolveChannelIdleTtlMs,
  resolveChannelSessionKey,
  shouldForceNewDingTalkSessionForEngine,
  type ChannelRuntimeEngine,
} from './session-lifecycle';
import { parseChannelSessionKey, type PlatformChannelType } from './session-key';
import { logger } from '../../utils/logger';
import { getSetting } from '../../utils/store';

export interface SessionFacadeCreateParams {
  agentId: string;
  channelType: PlatformChannelType;
  accountId?: string;
  peerId: string;
  engineType?: ChannelRuntimeEngine | 'openclaw';
  forceNew?: boolean;
  /** App 续聊：有值则优先复用；无效则策略 B 静默新建 */
  sessionKey?: string | null;
}

export interface SessionFacadeHandle {
  sessionKey: string;
  engineType: ChannelRuntimeEngine;
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

function isChannelRuntimeEngine(value: unknown): value is ChannelRuntimeEngine {
  return value === 'claude' || value === 'pi';
}

async function reuseRequestedSession(input: {
  usable: string;
  engineType: ChannelRuntimeEngine;
  agentId: string;
  channelType: PlatformChannelType;
  peerId: string;
  now: Date;
}): Promise<SessionFacadeHandle> {
  await rememberSessionEngineType(input.usable, input.engineType);
  await ensureCatalogSessionInDefaultWorkspace(input.usable);
  await upsertCatalogSession({
    workspaceId: DEFAULT_WORKSPACE_ID,
    sessionKey: input.usable,
    sessionType: 'channel',
    channelType: input.channelType,
    channelId: input.peerId,
    lastActivityAt: input.now.toISOString(),
  });
  return {
    sessionKey: input.usable,
    engineType: input.engineType,
    agentId: input.agentId,
  };
}

/**
 * Channel Session 桥：createOrGet → getAdapter（claude | pi）→ 页面对话同链。
 */
export async function createOrGetSession(
  params: SessionFacadeCreateParams,
): Promise<SessionFacadeHandle> {
  // Channel 会话只用 base agent，避免 sessionKey / currentAgentId 带上 proj-… 从而命中输入框项目名规则
  const agentId = resolveChannelBaseAgentId(params.agentId);
  const channelType = params.channelType;
  const engineType: ChannelRuntimeEngine = isChannelRuntimeEngine(params.engineType)
    ? params.engineType
    : FIXED_CHANNEL_BINDING.engineType;
  const now = new Date();

  const requestedKeyInitial = params.sessionKey?.trim() || '';
  let requestedKey = requestedKeyInitial;
  let forceNew = !!params.forceNew;

  if (requestedKey) {
    const usable = await findUsableSessionKey({
      sessionKey: requestedKey,
      channelType,
      agentId,
    });
    if (usable) {
      if (channelType === 'mobile') {
        const registered = await getEngineSessionRegistryEntry(usable);
        const engineOk = isChannelRuntimeEngine(registered?.engineType)
          ? registered.engineType === engineType
          : false;

        if (!engineOk) {
          forceNew = true;
          requestedKey = '';
          logger.warn('[SessionFacade] mobile sessionKey engine gate failed, forceNew', {
            requestedKey: requestedKeyInitial,
            boundEngineType: engineType,
            registeredEngineType: registered?.engineType ?? null,
          });
        } else {
          return reuseRequestedSession({
            usable,
            engineType,
            agentId,
            channelType,
            peerId: params.peerId,
            now,
          });
        }
      } else {
        return reuseRequestedSession({
          usable,
          engineType,
          agentId,
          channelType,
          peerId: params.peerId,
          now,
        });
      }
    } else {
      logger.info('[SessionFacade] sessionKeyIgnored, creating new', {
        channelType,
        requestedKey: requestedKeyInitial,
      });
    }
  }

  const latestSession = await getLatestChannelCatalogSession({
    channelType,
    channelId: params.peerId,
    agentId,
  });
  // mobile：无 sessionKey = 显式新建；有 peer 也不复用 latest（App 清空字段即新对话）
  // 引擎门禁失败时已清空 requestedKey，同样走这条路径
  if (channelType === 'mobile' && !requestedKey) {
    forceNew = true;
  }
  if (!forceNew && latestSession?.sessionKey) {
    const registered = await getEngineSessionRegistryEntry(latestSession.sessionKey);
    const registeredEngineType =
      registered?.engineType === 'claude'
      || registered?.engineType === 'openclaw'
      || registered?.engineType === 'pi'
        ? registered.engineType
        : null;
    const nextForceNew = shouldForceNewDingTalkSessionForEngine({
      boundEngineType: engineType,
      registeredEngineType,
    });
    if (
      !nextForceNew
      && registeredEngineType === null
      && (channelType === 'dingtalk' || channelType === 'wechat')
    ) {
      logger.warn('[SessionFacade] reuse key with missing registry', {
        sessionKey: latestSession.sessionKey,
        channelType,
        boundEngineType: engineType,
        registeredEngineType: registered?.engineType ?? null,
      });
    }
    forceNew = nextForceNew;
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
    sessionKeyIgnored: !!requestedKeyInitial && sessionKey !== requestedKeyInitial,
  };
}

export async function resolveChannelBinding(channelType: PlatformChannelType): Promise<{
  agentId: string;
  engineType: ChannelRuntimeEngine;
}> {
  if (channelType === 'wechat') {
    const { getWeixinBinding } = await import('../weixin/binding');
    const binding = await getWeixinBinding();
    if (!binding) {
      throw new Error('wechat bot not bound');
    }
    return {
      agentId: FIXED_CHANNEL_BINDING.agentId,
      engineType: FIXED_CHANNEL_BINDING.engineType,
    };
  }
  const conn = await getChannelConnection(channelType);
  if (!conn || conn.bindStatus !== 'bound') {
    throw new Error(`${channelType} hub not bound`);
  }
  return {
    agentId: FIXED_CHANNEL_BINDING.agentId,
    engineType: FIXED_CHANNEL_BINDING.engineType,
  };
}

export async function resolveDingTalkBinding(): Promise<{
  agentId: string;
  engineType: ChannelRuntimeEngine;
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
  const idempotencyKey = randomUUID();
  // 与主聊 IPC/gateway 同路：记忆注入 + idempotent + memory turn 绑定
  const result = await runMainChatSend(
    gatewayManager,
    {
      sessionKey: handle.sessionKey,
      message: text,
      sourceText: text,
      deliver: false,
      idempotencyKey,
      engineType: handle.engineType,
    },
    (params, memory) => adapter.prepareMemoryInjection(params, memory),
    (prepared) =>
      hasMedia
        ? adapter.sendMessageWithMedia(
            { gatewayManager },
            {
              ...prepared,
              media,
            },
          )
        : adapter.sendMessage({ gatewayManager }, prepared),
  );
  if (!result.success) {
    logger.warn('[SessionFacade] send failed', result.error);
    throw new Error(result.error || 'sendViaFacade failed');
  }
  return { runId: result.result?.runId };
}
