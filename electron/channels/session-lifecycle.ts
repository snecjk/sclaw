import { getBaseAgentIdFromProjectAgentId } from '../../shared/project-agent';
import { buildDingTalkSessionKey } from './session-key';

const DINGTALK_SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1000;

const NEW_SESSION_COMMANDS = new Set([
  '新对话',
  '新会话',
  '清空上下文',
  '/new',
  '/reset',
]);

/** 整句自然说法：开一个新会话 / 请新建对话 / 帮我清空上下文 等 */
const NEW_SESSION_NATURAL_RE = /^(?:请|帮我|麻烦)?(?:开|开启|创建|新建|换|开始)?(?:一)?(?:个)?新?(?:对话|会话)$/;
const CLEAR_CONTEXT_NATURAL_RE = /^(?:请|帮我|麻烦)?(?:清空|清除)(?:一下)?(?:上下文|会话|对话)$/;
const NEW_SESSION_SLASH_RE = /^\/(?:new|reset)$/;

export function buildNewDingTalkSessionKey(
  agentId: string,
  peerId: string,
  startedAt = new Date(),
  nonce?: string,
): string {
  return buildDingTalkSessionKey(agentId, peerId, startedAt, nonce);
}

export function shouldStartNewDingTalkSession(input: {
  nowMs: number;
  lastActivityAt?: string | null;
  forceNew?: boolean;
}): boolean {
  if (input.forceNew) return true;
  if (!input.lastActivityAt) return true;
  const lastActivityMs = Date.parse(input.lastActivityAt);
  if (!Number.isFinite(lastActivityMs)) return true;
  return input.nowMs - lastActivityMs >= DINGTALK_SESSION_IDLE_TTL_MS;
}

/**
 * 策略 C：改选脑后不得复用旧 sessionKey，也不得用新引擎改写旧 registry。
 * 仅当 registry 已登记引擎且与当前 Binding 不一致时强制新建。
 */
export function shouldForceNewDingTalkSessionForEngine(input: {
  forceNew?: boolean;
  boundEngineType: 'claude' | 'openclaw' | 'pi';
  registeredEngineType?: 'claude' | 'openclaw' | 'pi' | null;
}): boolean {
  if (input.forceNew) return true;
  const registered = input.registeredEngineType;
  if (registered === 'claude' || registered === 'openclaw' || registered === 'pi') {
    return registered !== input.boundEngineType;
  }
  return false;
}

export function resolveDingTalkSessionKey(input: {
  agentId: string;
  peerId: string;
  now?: Date;
  latestSession?: {
    sessionKey: string;
    lastActivityAt?: string | null;
  } | null;
  forceNew?: boolean;
  nonce?: string;
}): string {
  const now = input.now ?? new Date();
  if (
    input.latestSession
    && !shouldStartNewDingTalkSession({
      nowMs: now.getTime(),
      lastActivityAt: input.latestSession.lastActivityAt,
      forceNew: input.forceNew,
    })
  ) {
    return input.latestSession.sessionKey;
  }
  return buildNewDingTalkSessionKey(
    input.agentId,
    input.peerId,
    now,
    input.nonce,
  );
}

export function isDingTalkNewSessionCommand(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[!！.。？?]+$/u, '');
  if (!normalized) return false;
  if (NEW_SESSION_COMMANDS.has(normalized)) return true;
  if (NEW_SESSION_SLASH_RE.test(normalized)) return true;
  // 中文指令不做 toLowerCase 语义变化，但仍用 normalized（去首尾标点）
  return NEW_SESSION_NATURAL_RE.test(normalized)
    || CLEAR_CONTEXT_NATURAL_RE.test(normalized);
}

/**
 * Channel 会话只用 base agentId，避免 sessionKey 带上 proj-… 后
 * 切会话时 currentAgentId 命中输入框「· 项目名」规则。
 */
export function resolveChannelBaseAgentId(rawAgentId: string | null | undefined): string {
  const trimmed = (rawAgentId || 'main').trim().toLowerCase() || 'main';
  return getBaseAgentIdFromProjectAgentId(trimmed) ?? trimmed;
}
